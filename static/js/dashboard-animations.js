// Dashboard Animations and Interactions
document.addEventListener('DOMContentLoaded', function() {
    // Initialize AOS (Animate On Scroll)
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 800,
            easing: 'ease-out-cubic',
            once: true,
            offset: 100
        });
    }

    // Smooth scrolling for internal links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        const href = anchor.getAttribute('href');
        // Skip empty or invalid href values
        if (!href || href === '#' || href.trim() === '#') {
            return;
        }
        
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            try {
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            } catch (error) {
                console.warn('Invalid selector:', href);
            }
        });
    });

    // Enhanced carousel functionality
    initializeAnimationsCarousel();
    
    // View toggle functionality
    initializeViewToggle();
    
    // Search form enhancements
    initializeSearchForm();
    
    // Action cards hover effects
    initializeActionCards();
    
    // Statistics counter animation
    animateStatistics();
    
    // Lazy loading for images
    initializeLazyLoading();
});

// Carousel functionality
function initializeAnimationsCarousel() {
    const carousel = document.querySelector('.carousel');
    if (!carousel) return;

    let currentSlide = 0;
    const slides = carousel.querySelectorAll('.carousel-item');
    const totalSlides = slides.length;

    if (totalSlides === 0) return;

    // Auto-play carousel
    setInterval(() => {
        nextSlide();
    }, 5000);

    function nextSlide() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % totalSlides;
        slides[currentSlide].classList.add('active');
        updateIndicators();
    }

    function prevSlide() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
        slides[currentSlide].classList.add('active');
        updateIndicators();
    }

    function updateIndicators() {
        const indicators = carousel.querySelectorAll('.carousel-indicators .carousel-indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === currentSlide);
        });
    }

    // Add event listeners for controls
    const prevBtn = carousel.querySelector('.carousel-control-prev');
    const nextBtn = carousel.querySelector('.carousel-control-next');
    
    if (prevBtn) prevBtn.addEventListener('click', prevSlide);
    if (nextBtn) nextBtn.addEventListener('click', nextSlide);

    // Add keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') prevSlide();
        if (e.key === 'ArrowRight') nextSlide();
    });
}

// View toggle functionality
function initializeViewToggle() {
    const viewButtons = document.querySelectorAll('.view-btn');
    const itemsGrid = document.getElementById('itemsGrid');

    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            viewButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Toggle grid view
            const view = btn.dataset.view;
            if (itemsGrid) {
                itemsGrid.className = view === 'list' ? 'items-list' : 'items-grid';
            }
        });
    });
}

// Search form enhancements
function initializeSearchForm() {
    const searchForm = document.querySelector('.search-form');
    const filterToggle = document.querySelector('.filter-toggle');
    const advancedFilters = document.querySelector('.filters-grid');

    // Advanced filters toggle
    if (filterToggle && advancedFilters) {
        filterToggle.addEventListener('click', () => {
            const isCollapsed = filterToggle.classList.contains('collapsed');
            
            if (isCollapsed) {
                filterToggle.classList.remove('collapsed');
                advancedFilters.style.display = 'grid';
                setTimeout(() => {
                    advancedFilters.style.opacity = '1';
                    advancedFilters.style.transform = 'translateY(0)';
                }, 10);
            } else {
                filterToggle.classList.add('collapsed');
                advancedFilters.style.opacity = '0';
                advancedFilters.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    advancedFilters.style.display = 'none';
                }, 300);
            }
        });

        // Initialize as collapsed
        filterToggle.classList.add('collapsed');
        advancedFilters.style.display = 'none';
        advancedFilters.style.transition = 'all 0.3s ease';
    }

    // Form validation and enhancement
    if (searchForm) {
        const inputs = searchForm.querySelectorAll('input, select');
        
        inputs.forEach(input => {
            // Add floating label effect
            input.addEventListener('focus', () => {
                input.parentElement.classList.add('focused');
            });
            
            input.addEventListener('blur', () => {
                if (!input.value) {
                    input.parentElement.classList.remove('focused');
                }
            });
            
            // Check if input has value on load
            if (input.value) {
                input.parentElement.classList.add('focused');
            }
        });
    }
}

// Action cards hover effects
function initializeActionCards() {
    const actionCards = document.querySelectorAll('.action-card');
    
    actionCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            // Add ripple effect
            const ripple = document.createElement('div');
            ripple.className = 'ripple-effect';
            card.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
        
        // Add click animation
        card.addEventListener('click', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const clickEffect = document.createElement('div');
            clickEffect.className = 'click-effect';
            clickEffect.style.left = x + 'px';
            clickEffect.style.top = y + 'px';
            card.appendChild(clickEffect);
            
            setTimeout(() => {
                clickEffect.remove();
            }, 300);
        });
    });
}

// Statistics counter animation
function animateStatistics() {
    const statNumbers = document.querySelectorAll('.stat-number');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = entry.target;
                const finalValue = parseInt(target.textContent);
                animateCounter(target, 0, finalValue, 2000);
                observer.unobserve(target);
            }
        });
    });
    
    statNumbers.forEach(stat => observer.observe(stat));
}

function animateCounter(element, start, end, duration) {
    const startTime = performance.now();
    
    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function for smooth animation
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(start + (end - start) * easeOutCubic);
        
        element.textContent = current.toLocaleString();
        
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = end.toLocaleString();
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// Lazy loading for images
function initializeLazyLoading() {
    const images = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.add('loaded');
                imageObserver.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
}

// Utility function for smooth transitions
function smoothTransition(element, property, from, to, duration = 300) {
    return new Promise(resolve => {
        const start = performance.now();
        
        function animate(currentTime) {
            const elapsed = currentTime - start;
            const progress = Math.min(elapsed / duration, 1);
            
            const current = from + (to - from) * progress;
            element.style[property] = current + (property.includes('opacity') ? '' : 'px');
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve();
            }
        }
        
        requestAnimationFrame(animate);
    });
}

// Add CSS for ripple and click effects
const style = document.createElement('style');
style.textContent = `
    .ripple-effect {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: translate(-50%, -50%);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
        z-index: 10;
    }
    
    @keyframes ripple {
        to {
            width: 200px;
            height: 200px;
            opacity: 0;
        }
    }
    
    .click-effect {
        position: absolute;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(242, 140, 53, 0.6);
        transform: translate(-50%, -50%);
        animation: clickPulse 0.3s ease-out;
        pointer-events: none;
        z-index: 10;
    }
    
    @keyframes clickPulse {
        to {
            width: 40px;
            height: 40px;
            opacity: 0;
        }
    }
    
    .form-group.focused .form-label {
        color: var(--primary-orange);
        transform: translateY(-2px);
    }
    
    img.loaded {
        opacity: 1;
        transition: opacity 0.3s ease;
    }
    
    img[data-src] {
        opacity: 0;
    }
`;
document.head.appendChild(style);
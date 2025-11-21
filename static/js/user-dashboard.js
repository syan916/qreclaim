// Modern Orange Theme - User Dashboard JavaScript
// Qreclaim Lost & Found System

document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard components
    initializeSearch();
    initializeFilters();
    initializeItemsGrid();
    initializePagination();
    initializeLoadingStates();
    initializeCarousel();
    
    // Load initial data from Firebase
    loadFoundItemsFromFirebase();
});

// Global variables for pagination and data
let currentPage = 1;
let totalPages = 1;
let currentFilters = {
    search: '',
    category: '',
    location: '',
    status: 'unclaimed'
};

// Enhanced Carousel functionality with auto-rotation
let currentSlide = 0;
let totalSlides = 0;
let carouselInterval = null;
let isCarouselPaused = false;
let carouselConfig = {
    autoRotate: true,
    interval: 7000, // 7 seconds for a calmer pace
    pauseOnHover: true,
    pauseOnFocus: true,
    enableSwipe: true
};

function initializeCarousel() {
    const carousel = document.querySelector('.hero-carousel');
    const slides = document.querySelectorAll('.carousel-slide');
    const indicators = document.querySelectorAll('.indicator');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (!carousel || slides.length === 0) return;
    
    totalSlides = slides.length;
    
    // Initialize first slide
    showSlide(0);
    
    // Auto-rotation functionality
    function startAutoRotation() {
        if (!carouselConfig.autoRotate) return;
        // Prevent duplicate timers
        if (carouselInterval) {
            clearInterval(carouselInterval);
            carouselInterval = null;
        }
        if (!isCarouselPaused) {
            carouselInterval = setInterval(() => {
                if (!isCarouselPaused) {
                    nextSlide();
                }
            }, carouselConfig.interval);
        }
    }
    
    function stopAutoRotation() {
        if (carouselInterval) {
            clearInterval(carouselInterval);
            carouselInterval = null;
        }
    }
    
    function pauseAutoRotation() {
        isCarouselPaused = true;
        stopAutoRotation();
    }
    
    function resumeAutoRotation() {
        isCarouselPaused = false;
        startAutoRotation();
    }
    
    // Enhanced slide transition with smooth animations
    function showSlide(index, direction = 'next') {
        if (index < 0) index = totalSlides - 1;
        if (index >= totalSlides) index = 0;
        
        currentSlide = index;
        
        // Update slides with smooth transition
        slides.forEach((slide, i) => {
            slide.classList.remove('active', 'prev', 'next');
            if (i === index) {
                slide.classList.add('active');
            } else if (i === (index - 1 + totalSlides) % totalSlides) {
                slide.classList.add('prev');
            } else if (i === (index + 1) % totalSlides) {
                slide.classList.add('next');
            }
        });
        
        // Update indicators
        indicators.forEach((indicator, i) => {
            indicator.classList.toggle('active', i === index);
            indicator.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });
        
        // Update navigation buttons accessibility
        if (prevBtn) prevBtn.setAttribute('aria-label', `Go to slide ${index === 0 ? totalSlides : index}`);
        if (nextBtn) nextBtn.setAttribute('aria-label', `Go to slide ${index === totalSlides - 1 ? 1 : index + 2}`);
    }
    
    function nextSlide() {
        showSlide(currentSlide + 1, 'next');
    }
    
    function prevSlide() {
        showSlide(currentSlide - 1, 'prev');
    }
    
    // Event listeners for navigation
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            nextSlide();
            pauseAutoRotation();
            setTimeout(resumeAutoRotation, carouselConfig.interval);
        });
    }
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            prevSlide();
            pauseAutoRotation();
            setTimeout(resumeAutoRotation, carouselConfig.interval);
        });
    }
    
    // Indicator click handlers
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            showSlide(index);
            pauseAutoRotation();
            setTimeout(resumeAutoRotation, carouselConfig.interval);
        });
        
        // Keyboard support for indicators
        indicator.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showSlide(index);
                pauseAutoRotation();
                setTimeout(resumeAutoRotation, carouselConfig.interval);
            }
        });
    });
    
    // Pause on hover/focus functionality
    if (carouselConfig.pauseOnHover) {
        carousel.addEventListener('mouseenter', pauseAutoRotation);
        carousel.addEventListener('mouseleave', resumeAutoRotation);
    }
    
    if (carouselConfig.pauseOnFocus) {
        carousel.addEventListener('focusin', pauseAutoRotation);
        carousel.addEventListener('focusout', resumeAutoRotation);
    }
    
    // Touch/swipe support for mobile
    if (carouselConfig.enableSwipe) {
        let startX = 0;
        let startY = 0;
        let endX = 0;
        let endY = 0;
        
        carousel.addEventListener('touchstart', (e) => {
            if (e.target.closest('.carousel-btn') || e.target.closest('.indicator') || e.target.closest('.cta-button')) {
                pauseAutoRotation();
                return;
            }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            pauseAutoRotation();
        });
        
        carousel.addEventListener('touchmove', (e) => {
            if (e.target.closest('.carousel-btn') || e.target.closest('.indicator') || e.target.closest('.cta-button')) return;
            e.preventDefault(); // Prevent scrolling while swiping
        });
        
        carousel.addEventListener('touchend', (e) => {
            if (e.target.closest('.carousel-btn') || e.target.closest('.indicator') || e.target.closest('.cta-button')) {
                setTimeout(resumeAutoRotation, carouselConfig.interval);
                return;
            }
            endX = e.changedTouches[0].clientX;
            endY = e.changedTouches[0].clientY;
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            
            // Check if horizontal swipe is more significant than vertical
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    prevSlide();
                } else {
                    nextSlide();
                }
            }
            
            setTimeout(resumeAutoRotation, carouselConfig.interval);
        });
        
        // Mouse/pointer drag support for desktop
        let dragging = false;
        let pointerStartX = 0;
        let pointerStartY = 0;
        
        carousel.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.carousel-btn') || e.target.closest('.indicator') || e.target.closest('.cta-button')) {
                pauseAutoRotation();
                return;
            }
            // Only handle primary button drags
            if (e.isPrimary && e.button === 0) {
                dragging = true;
                pointerStartX = e.clientX;
                pointerStartY = e.clientY;
                pauseAutoRotation();
                try { carousel.setPointerCapture(e.pointerId); } catch (_) {}
            }
        });
        
        carousel.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            // Do not interfere with vertical scroll; we only act on release
        });
        
        carousel.addEventListener('pointerup', (e) => {
            if (!dragging) return;
            dragging = false;
            const dx = e.clientX - pointerStartX;
            const dy = e.clientY - pointerStartY;
            try { carousel.releasePointerCapture(e.pointerId); } catch (_) {}
            
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
                if (dx > 0) {
                    prevSlide();
                } else {
                    nextSlide();
                }
            }
            setTimeout(resumeAutoRotation, carouselConfig.interval);
        });
        
        carousel.addEventListener('pointercancel', () => {
            dragging = false;
        });
    }
    
    // Keyboard navigation
    carousel.addEventListener('keydown', (e) => {
        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                prevSlide();
                pauseAutoRotation();
                setTimeout(resumeAutoRotation, carouselConfig.interval);
                break;
            case 'ArrowRight':
                e.preventDefault();
                nextSlide();
                pauseAutoRotation();
                setTimeout(resumeAutoRotation, carouselConfig.interval);
                break;
        }
    });
    
    // Visibility API - pause when tab is not visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseAutoRotation();
        } else {
            resumeAutoRotation();
        }
    });
    
    // Start auto-rotation
    startAutoRotation();
    
    // Set global functions for HTML onclick handlers
    window.nextSlide = nextSlide;
    window.previousSlide = prevSlide;
    window.goToSlide = (index) => showSlide(index - 1); // Convert to 0-based index
    
    // Return control functions for external use
    return {
        next: nextSlide,
        prev: prevSlide,
        goTo: showSlide,
        pause: pauseAutoRotation,
        resume: resumeAutoRotation,
        config: carouselConfig
    };
}

// Global functions for HTML onclick handlers - these will be set by initializeCarousel()
window.nextSlide = function() { console.log('Carousel not initialized yet'); };
window.previousSlide = function() { console.log('Carousel not initialized yet'); };
window.goToSlide = function() { console.log('Carousel not initialized yet'); };

// Firebase data loading
async function loadFoundItemsFromFirebase(page = 1) {
    try {
        showLoading();
        
        // Build query parameters
        const params = new URLSearchParams({
            page: page,
            per_page: 12,
            search: currentFilters.search,
            category: currentFilters.category,
            location: currentFilters.location,
            status: currentFilters.status
        });
        
        const response = await fetch(`/user/api/found-items?${params}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayFoundItems(data.found_items);
            updatePaginationInfo(data.pagination);
            updateFilterOptions(data.filters);
            updateStatistics(data.pagination.total_items);
        } else {
            throw new Error(data.error || 'Failed to load found items');
        }
        
    } catch (error) {
        console.error('Error loading found items:', error);
        showNotification('Failed to load found items. Please try again.', 'error');
        displayEmptyState();
    } finally {
        hideLoading();
    }
}

// Display found items in the grid
function displayFoundItems(items) {
    const itemsGrid = document.getElementById('itemsGrid');
    const emptyState = document.getElementById('emptyState');
    
    if (!itemsGrid) return;
    
    if (items.length === 0) {
        displayEmptyState();
        return;
    }
    
    // Hide empty state and show grid
    if (emptyState) emptyState.style.display = 'none';
    itemsGrid.style.display = 'grid';
    
    // Generate HTML for items
    itemsGrid.innerHTML = items.map(item => createItemCard(item)).join('');
}

// Create HTML for individual item card
function createItemCard(item) {
    const imageUrl = item.image_url || '/static/images/placeholder.jpg';
    const statusClass = getStatusClass(item.status);
    const tagsHtml = item.tags ? item.tags.map(tag => `<span class="item-tag">${tag}</span>`).join('') : '';
    
    return `
        <div class="item-card" data-item-id="${item.id}">
            <div class="item-image">
                <img src="${imageUrl}" alt="${item.name}" onerror="this.src='/static/images/placeholder.jpg'">
                <div class="item-status ${statusClass}">${item.status}</div>
            </div>
            <div class="item-content">
                <h3 class="item-title">${item.name}</h3>
                <p class="item-description">${item.description}</p>
                <div class="item-meta">
                    <span class="item-category">${item.category}</span>
                    <span class="item-location">${item.location}</span>
                </div>
                ${tagsHtml ? `<div class="item-tags">${tagsHtml}</div>` : ''}
                <div class="item-actions">
                    <button class="btn btn-primary" onclick="handleClaimItem(this)">
                        <i class="fas fa-hand-paper"></i> Claim Item
                    </button>
                    <button class="btn btn-secondary" onclick="handleViewDetails(this)">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Get CSS class for item status
function getStatusClass(status) {
    const statusClasses = {
        'unclaimed': 'status-available',
        'claimed': 'status-claimed',
        'pending': 'status-pending',
        'returned': 'status-returned'
    };
    return statusClasses[status] || 'status-available';
}

// Display empty state
function displayEmptyState() {
    const itemsGrid = document.getElementById('itemsGrid');
    const emptyState = document.getElementById('emptyState');
    
    if (itemsGrid) itemsGrid.style.display = 'none';
    if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = `
            <div class="empty-state-content">
                <i class="fas fa-search fa-3x"></i>
                <h3>No Items Found</h3>
                <p>No found items match your current search criteria.</p>
                <button class="btn btn-primary" onclick="clearFilters()">Clear Filters</button>
            </div>
        `;
    }
}

// Update pagination information
function updatePaginationInfo(pagination) {
    currentPage = pagination.current_page;
    totalPages = pagination.total_pages;
    
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;
    
    // Update items count
    const itemsCount = document.getElementById('itemsCount');
    const totalItems = document.getElementById('totalItems');
    
    if (itemsCount) itemsCount.textContent = pagination.total_items;
    if (totalItems) totalItems.textContent = pagination.total_items;
    
    // Generate pagination buttons
    generatePaginationButtons(pagination);
}

// Generate pagination buttons
function generatePaginationButtons(pagination) {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;
    
    let paginationHtml = '';
    
    // Previous button
    paginationHtml += `
        <button class="pagination-btn" ${!pagination.has_prev ? 'disabled' : ''} 
                onclick="navigateToPage(${pagination.current_page - 1})">
            <i class="fas fa-chevron-left"></i> Previous
        </button>
    `;
    
    // Page numbers
    const startPage = Math.max(1, pagination.current_page - 2);
    const endPage = Math.min(pagination.total_pages, pagination.current_page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === pagination.current_page;
        paginationHtml += `
            <button class="pagination-btn ${isActive ? 'active' : ''}" 
                    onclick="navigateToPage(${i})">${i}</button>
        `;
    }
    
    // Next button
    paginationHtml += `
        <button class="pagination-btn" ${!pagination.has_next ? 'disabled' : ''} 
                onclick="navigateToPage(${pagination.current_page + 1})">
            Next <i class="fas fa-chevron-right"></i>
        </button>
    `;
    
    paginationContainer.innerHTML = paginationHtml;
}

// Update filter options
function updateFilterOptions(filters) {
    // Update category filter
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter && filters.categories) {
        const currentValue = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="">All Categories</option>';
        filters.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            if (category === currentValue) option.selected = true;
            categoryFilter.appendChild(option);
        });
    }
    
    // Update location filter
    const locationFilter = document.getElementById('locationFilter');
    if (locationFilter && filters.locations) {
        const currentValue = locationFilter.value;
        locationFilter.innerHTML = '<option value="">All Locations</option>';
        filters.locations.forEach(location => {
            const option = document.createElement('option');
            option.value = location;
            option.textContent = location;
            if (location === currentValue) option.selected = true;
            locationFilter.appendChild(option);
        });
    }
}

// Search functionality
function initializeSearch() {
    const searchForm = document.getElementById('searchForm');
    const searchQuery = document.getElementById('searchQuery');
    
    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            performSearch();
        });
    }
    
    if (searchQuery) {
        // Real-time search with debounce
        let searchTimeout;
        searchQuery.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (this.value.length >= 3 || this.value.length === 0) {
                    performSearch();
                }
            }, 500);
        });
    }
}

// Filter functionality
function initializeFilters() {
    const filters = ['categoryFilter', 'locationFilter', 'dateFilter', 'statusFilter'];
    
    filters.forEach(filterId => {
        const filter = document.getElementById(filterId);
        if (filter) {
            filter.addEventListener('change', function() {
                performSearch();
            });
        }
    });
}

// Perform search with filters
function performSearch() {
    // Update current filters
    currentFilters.search = document.getElementById('searchQuery')?.value || '';
    currentFilters.category = document.getElementById('categoryFilter')?.value || '';
    currentFilters.location = document.getElementById('locationFilter')?.value || '';
    currentFilters.status = document.getElementById('statusFilter')?.value || 'unclaimed';
    
    // Reset to first page and load data
    loadFoundItemsFromFirebase(1);
}

// Clear all filters
function clearFilters() {
    document.getElementById('searchQuery').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('locationFilter').value = '';
    document.getElementById('statusFilter').value = 'unclaimed';
    
    currentFilters = {
        search: '',
        category: '',
        location: '',
        status: 'unclaimed'
    };
    
    loadFoundItemsFromFirebase(1);
}

// Navigate to specific page
function navigateToPage(pageNumber) {
    if (pageNumber < 1 || pageNumber > totalPages) return;
    loadFoundItemsFromFirebase(pageNumber);
}

// Remove TabSystem override to prevent interference with carousel controls

// Make navigateToPage global for pagination buttons
window.navigateToPage = navigateToPage;

// Items grid functionality
function initializeItemsGrid() {
    const itemsGrid = document.getElementById('itemsGrid');
    
    if (itemsGrid) {
        // Add click handlers for item actions
        itemsGrid.addEventListener('click', function(e) {
            if (e.target.classList.contains('btn-primary')) {
                handleClaimItem(e.target);
            } else if (e.target.classList.contains('btn-secondary')) {
                handleViewDetails(e.target);
            }
        });
    }
}

// Handle item claiming
function handleClaimItem(button) {
    const itemCard = button.closest('.item-card');
    const itemTitle = itemCard.querySelector('.item-title')?.textContent || 'Item';
    
    const ok = await userConfirm(`Are you sure you want to claim "${itemTitle}"?`, {type:'info', title:'Claim Item'}); if (ok) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';
        
        // Simulate API call (replace with actual claim API)
        setTimeout(() => {
            button.innerHTML = '<i class="fas fa-check"></i> Claimed';
            button.classList.remove('btn-primary');
            button.classList.add('btn-success');
            
            // Update status
            const status = itemCard.querySelector('.item-status');
            if (status) {
                status.textContent = 'Claimed';
                status.className = 'item-status status-claimed';
            }
            
            showNotification('Item claimed successfully! You will receive further instructions via email.', 'success');
        }, 1500);
    }
}

// Handle view details
function handleViewDetails(button) {
    const itemCard = button.closest('.item-card');
    const itemTitle = itemCard.querySelector('.item-title')?.textContent || 'Item';
    
    // For now, show an alert (replace with modal or navigation)
    showNotification(`Viewing details for "${itemTitle}"`, 'info');
}

// View toggle functionality
function initializeViewToggle() {
    const viewButtons = document.querySelectorAll('.view-btn');
    const itemsGrid = document.getElementById('itemsGrid');
    
    viewButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Update active state
            viewButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Update grid view
            const view = this.dataset.view;
            if (itemsGrid) {
                itemsGrid.className = view === 'list' ? 'items-list' : 'items-grid';
            }
        });
    });
}

// Pagination functionality
function initializePagination() {
    // Pagination is now handled by generatePaginationButtons
}

// Loading states
function initializeLoadingStates() {
    // Initialize any loading state handlers
}

function showLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

// Update dashboard statistics
function updateStatistics(totalItems = 0) {
    const stats = [
        { id: 'totalItems', value: totalItems },
        { id: 'availableItems', value: Math.floor(totalItems * 0.7) },
        { id: 'claimedItems', value: Math.floor(totalItems * 0.3) }
    ];
    
    stats.forEach(stat => {
        const element = document.getElementById(stat.id);
        if (element) {
            animateNumber(element, 0, stat.value, 1000);
        }
    });
}

// Animate number counting
function animateNumber(element, start, end, duration) {
    const startTime = performance.now();
    
    function updateNumber(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const current = Math.floor(start + (end - start) * progress);
        element.textContent = current;
        
        if (progress < 1) {
            requestAnimationFrame(updateNumber);
        }
    }
    
    requestAnimationFrame(updateNumber);
}

// Notification system
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => notification.classList.add('show'), 100);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
    
    // Close button handler
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    });
}

function getNotificationIcon(type) {
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    return icons[type] || 'info-circle';
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Export functions for global access
window.QreclaimDashboard = {
    performSearch,
    showNotification,
    navigateToPage,
    clearFilters
};
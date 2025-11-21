// User Header JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // ============================================================
    // NAVIGATION ACTIVE STATE MANAGEMENT
    // Dynamically update active nav items based on current page
    // ============================================================
    function updateActiveNavItems() {
        const currentPath = window.location.pathname;
        const desktopNavItems = document.querySelectorAll('.nav-item');
        const mobileNavItems = document.querySelectorAll('.mobile-item');
        
        // Remove active class from all nav items first
        desktopNavItems.forEach(item => item.classList.remove('active'));
        mobileNavItems.forEach(item => item.classList.remove('active'));
        
        // Determine which nav item should be active based on current path
        let activeSelector = null;
        
        if (currentPath.includes('/dashboard')) {
            activeSelector = 'user.dashboard';
        } else if (currentPath.includes('/browse-found-items')) {
            activeSelector = 'user.browse_found_items';
        } else if (currentPath.includes('/report-lost-item') || currentPath.includes('/lost-item-report') || currentPath.includes('/lost-report-details')) {
            activeSelector = 'user.report_lost_item';
        } else if (currentPath.includes('/lost-item-history')) {
            activeSelector = 'user.lost_item_history';
        } else if (currentPath.includes('/claim-history')) {
            activeSelector = 'user.claim_history';
        } else if (currentPath.includes('/my-qr-code')) {
            activeSelector = 'user.my_qr_code';
        }
        
        // Apply active class based on current path
        if (activeSelector) {
            desktopNavItems.forEach(item => {
                const link = item.querySelector('a');
                if (link) {
                    // Check if this item's link matches current path
                    const href = link.getAttribute('href');
                    if (href && currentPath.includes(href.split('/').pop())) {
                        item.classList.add('active');
                    }
                    
                    // Also check for dropdown items (support both custom and Bootstrap classes)
                    const dropdownItems = item.querySelectorAll('.dropdown-link, .dropdown-item');
                    if (dropdownItems.length > 0) {
                        dropdownItems.forEach(dropdownLink => {
                            const dropdownHref = dropdownLink.getAttribute('href');
                            if (dropdownHref && currentPath.includes(dropdownHref.split('/').pop())) {
                                item.classList.add('active');
                            }
                        });
                    }
                }
            });
            
            // Apply same logic to mobile menu
            mobileNavItems.forEach(item => {
                const link = item.querySelector('a');
                if (link) {
                    const href = link.getAttribute('href');
                    if (href && currentPath.includes(href.split('/').pop())) {
                        item.classList.add('active');
                    }
                    
                    // Check mobile dropdown items
                    const mobileDropdownLinks = item.querySelectorAll('.mobile-dropdown-link');
                    if (mobileDropdownLinks.length > 0) {
                        mobileDropdownLinks.forEach(dropdownLink => {
                            const dropdownHref = dropdownLink.getAttribute('href');
                            if (dropdownHref && currentPath.includes(dropdownHref.split('/').pop())) {
                                item.classList.add('active');
                            }
                        });
                    }
                }
            });
        }
    }
    
    // Call on page load
    updateActiveNavItems();
    
    // Optional: Update on history changes (for SPA-like behavior)
    window.addEventListener('popstate', updateActiveNavItems);
    
    // Mobile menu toggle
    const mobileToggle = document.getElementById('userMenuToggle');
    const mobileNav = document.getElementById('mobileNav');
    const mobileClose = document.getElementById('mobileClose');
    const mobileOverlay = document.getElementById('mobileOverlay');

    function openMobileNav() {
        if (!mobileNav) return;
        mobileNav.classList.add('active');
        if (mobileOverlay) mobileOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        const firstItem = mobileNav.querySelector('.mobile-menu-item, a, button');
        if (firstItem) firstItem.focus();
        if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'true');
    }

    function closeMobileNav() {
        if (!mobileNav) return;
        mobileNav.classList.remove('active');
        if (mobileOverlay) mobileOverlay.classList.remove('active');
        document.body.style.overflow = '';
        if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
    }

    // Handle responsive layout changes
    function handleResponsiveLayout() {
        const headerActions = document.querySelector('.header-actions');
        const userProfile = document.querySelector('.user-profile');
        const windowWidth = window.innerWidth;
        
        // Close mobile nav and profile dropdown when switching to desktop
        if (windowWidth > 992) {
            closeMobileNav();
            if (userProfile) {
                userProfile.classList.remove('active');
                const trigger = userProfile.querySelector('.profile-trigger, .profile-btn, .user-profile > button, .user-profile > a') || userProfile;
                trigger.setAttribute('aria-expanded', 'false');
            }
        }
        
        // Ensure proper visibility states
        if (headerActions) {
            if (windowWidth <= 992) {
                headerActions.style.display = 'none';
            } else {
                headerActions.style.display = 'flex';
            }
        }
    }

    // Debounced resize handler to prevent excessive calls
    let resizeTimeout;
    function debouncedResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleResponsiveLayout, 150);
    }

    // Initialize responsive layout
    handleResponsiveLayout();
    
    // Add resize event listener
    window.addEventListener('resize', debouncedResize);
    
    if (mobileToggle && mobileNav) {
        mobileToggle.addEventListener('click', function() {
            openMobileNav();
        });
        mobileToggle.setAttribute('aria-controls', 'mobileNav');
        mobileToggle.setAttribute('aria-expanded', 'false');
    }
    
    if (mobileClose && mobileNav) {
        mobileClose.addEventListener('click', function() {
            closeMobileNav();
        });
    }

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', function() {
            closeMobileNav();
        });
    }
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', function(e) {
        if (mobileNav && mobileNav.classList.contains('active')) {
            if (!mobileNav.contains(e.target) && (!mobileToggle || !mobileToggle.contains(e.target))) {
                closeMobileNav();
            }
        }
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeMobileNav();
            closeAllDropdowns();
            if (userProfile) userProfile.classList.remove('active');
        }
    });
    
    // Mobile dropdown functionality
    const mobileDropdownToggles = document.querySelectorAll('.mobile-dropdown-toggle');
    
    mobileDropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            const mobileDropdown = this.closest('.mobile-dropdown');
            const isActive = mobileDropdown && mobileDropdown.classList.contains('active');
            
            // Close all mobile dropdowns
            document.querySelectorAll('.mobile-dropdown.active').forEach(d => {
                d.classList.remove('active');
            });
            
            // Toggle current mobile dropdown
            if (mobileDropdown && !isActive) {
                mobileDropdown.classList.add('active');
            }
        });
    });
    
    // Dropdown toggle behavior (exclude profile button to avoid double-binding)
    const dropdownToggles = Array.from(document.querySelectorAll('.dropdown-toggle')).filter(t => t.id !== 'profileDropdown');
    const dropdowns = document.querySelectorAll('.dropdown');

    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown.active').forEach(d => {
            d.classList.remove('active');
        });
        dropdownToggles.forEach(t => t.setAttribute('aria-expanded', 'false'));
        try { localStorage.setItem('dropdown_persist_closed', 'true'); } catch(_) {}
    }

    dropdownToggles.forEach(toggle => {
        toggle.setAttribute('aria-haspopup', 'true');
        toggle.setAttribute('aria-expanded', 'false');

        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            const dropdown = this.closest('.dropdown');
            const isActive = dropdown && dropdown.classList.contains('active');
            
            // Close all dropdowns
            closeAllDropdowns();
            
            // Toggle current dropdown
            if (dropdown && !isActive) {
                dropdown.classList.add('active');
                this.setAttribute('aria-expanded', 'true');
                try { localStorage.setItem('dropdown_persist_closed', 'false'); } catch(_) {}
            }
        });

        // Keyboard support
        toggle.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });

    // Touch/mobile device handling - only add click handlers for non-hover devices
    const isTouchDevice = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    
    if (isTouchDevice) {
        // For touch devices, handle dropdown opening/closing via click
        dropdowns.forEach(dropdown => {
            const toggle = dropdown.querySelector('.dropdown-toggle');
            if (toggle) {
                toggle.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const isActive = dropdown.classList.contains('active');
                    closeAllDropdowns();
                    
                    if (!isActive) {
                        dropdown.classList.add('active');
                        this.setAttribute('aria-expanded', 'true');
                    }
                });
            }
        });
    }
    
    // Initialize persisted state on load
    try {
        const persisted = localStorage.getItem('dropdown_persist_closed');
        if (persisted === 'true') {
            closeAllDropdowns();
        }
    } catch(_) {}

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.dropdown')) {
            closeAllDropdowns();
        }
    });

    // Prevent outside click handler from immediately closing when interacting within menus
    document.querySelectorAll('.dropdown-menu, .profile-dropdown-menu').forEach((menu) => {
        menu.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    });
    
    // Theme toggle functionality
    const themeToggle = document.getElementById('userThemeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            
            // Update icon
            const icon = this.querySelector('i');
            if (icon) {
                icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            }
            
            // Save preference
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
        
        // Load saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-sun';
            }
        }
    }
    
    // User profile dropdown - Enhanced for better touch/click handling
    const userProfile = document.querySelector('.user-profile');
    if (userProfile) {
        const trigger = userProfile.querySelector('.profile-trigger, .profile-btn, .user-profile > button, .user-profile > a') || userProfile;
        
        // Ensure proper ARIA attributes
        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) {
            trigger.setAttribute('tabindex', '0');
        }

        // Enhanced click handler for better reliability
        function toggleProfile(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const isActive = userProfile.classList.contains('active');
            
            // Close other profiles first
            document.querySelectorAll('.user-profile.active').forEach(p => {
                if (p !== userProfile) {
                    p.classList.remove('active');
                    const otherTrigger = p.querySelector('.profile-trigger, .profile-btn, .user-profile > button, .user-profile > a') || p;
                    otherTrigger.setAttribute('aria-expanded', 'false');
                }
            });
            
            // Toggle current profile
            userProfile.classList.toggle('active', !isActive);
            trigger.setAttribute('aria-expanded', (!isActive).toString());
            
            // Focus management for accessibility
            if (!isActive) {
                const firstMenuItem = userProfile.querySelector('.profile-dropdown a, .profile-dropdown button');
                if (firstMenuItem) {
                    setTimeout(() => firstMenuItem.focus(), 100);
                }
            }
        }

        // Multiple event listeners for better compatibility
        trigger.addEventListener('click', toggleProfile);
        trigger.addEventListener('touchend', function(e) {
            // Prevent double-firing on touch devices
            e.preventDefault();
            toggleProfile(e);
        });
        
        // Keyboard accessibility
        trigger.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleProfile(e);
            }
        });
        
        // Enhanced outside click handler
        document.addEventListener('click', function(e) {
            if (!userProfile.contains(e.target)) {
                userProfile.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
        
        // Touch outside handler for mobile devices
        document.addEventListener('touchstart', function(e) {
            if (!userProfile.contains(e.target)) {
                userProfile.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    }
});


// Logout confirmation function
function confirmLogout() {
    userConfirm('Are you sure you want to logout?', {type:'warning', title:'Logout'}).then(ok=>{ if(ok) window.location.href = '/logout'; });
    return false;
}

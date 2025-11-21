/**
 * Admin Common JavaScript
 * This file contains common JavaScript functionality for all admin pages
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize sidebar functionality
    initSidebar();
    
    // Initialize theme toggle
    initThemeToggle();
    
    // Set active menu item based on current page
    setActiveMenuItem();
    
    // Initialize dropdown menu behavior
    initDropdownMenu();
});

/**
 * Initialize sidebar functionality
 */
function initSidebar() {
    // Mobile toggle button
    const mobileToggle = document.querySelector('.mobile-toggle');
    const sidebarClose = document.querySelector('.sidebar-close');
    const sidebar = document.querySelector('.admin-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    // Toggle sidebar on mobile
    if (mobileToggle) {
        mobileToggle.addEventListener('click', function() {
            sidebar.classList.add('active');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent scrolling when sidebar is open
        });
    }
    
    // Close sidebar on mobile
    if (sidebarClose) {
        sidebarClose.addEventListener('click', function() {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = ''; // Re-enable scrolling
        });
    }
    
    // Close sidebar when clicking on overlay
    if (overlay) {
        overlay.addEventListener('click', function() {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = ''; // Re-enable scrolling
        });
    }
    
    // Toggle submenu
    const submenuItems = document.querySelectorAll('.sidebar-item.has-submenu');
    
    submenuItems.forEach(function(item) {
        const link = item.querySelector('.sidebar-link');
        
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Toggle active class on the clicked item
            item.classList.toggle('active');
            
            // Close other submenus
            submenuItems.forEach(function(otherItem) {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
        });
    });
}

/**
 * Initialize theme toggle functionality
 */
function initThemeToggle() {
    const themeToggle = document.querySelector('.theme-toggle');
    
    if (themeToggle) {
        // Check for saved theme preference or respect OS preference
        const savedTheme = localStorage.getItem('admin-theme');
        const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
        
        // Apply theme based on saved preference or OS preference
        if (savedTheme === 'dark' || (!savedTheme && prefersDarkScheme.matches)) {
            document.body.classList.add('dark-theme');
            updateThemeIcon(true);
        } else {
            document.body.classList.remove('dark-theme');
            updateThemeIcon(false);
        }
        
        // Toggle theme on click
        themeToggle.addEventListener('click', function() {
            const isDarkTheme = document.body.classList.toggle('dark-theme');
            localStorage.setItem('admin-theme', isDarkTheme ? 'dark' : 'light');
            updateThemeIcon(isDarkTheme);
        });
    }
    
    // Update theme icon based on current theme
    function updateThemeIcon(isDarkTheme) {
        if (!themeToggle) return;
        
        if (isDarkTheme) {
            themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        } else {
            themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        }
    }
}

/**
 * Set active menu item based on current page
 */
function setActiveMenuItem() {
    // Get current page URL
    const currentUrl = window.location.pathname;
    
    // Find all sidebar links
    const sidebarLinks = document.querySelectorAll('.sidebar-link, .submenu-link');
    
    // Loop through all links and check if the href matches the current URL
    sidebarLinks.forEach(function(link) {
        const href = link.getAttribute('href');
        
        if (href && currentUrl.includes(href)) {
            // Set active class on the link's parent item
            link.parentElement.classList.add('active');
            
            // If it's a submenu item, also set active class on the parent sidebar item
            if (link.classList.contains('submenu-link')) {
                const parentItem = link.closest('.sidebar-item.has-submenu');
                if (parentItem) {
                    parentItem.classList.add('active');
                }
            }
        }
    });
}

/**
 * Initialize dropdown menu behavior
 */
function initDropdownMenu() {
    const profileDropdown = document.querySelector('.profile-dropdown');
    const adminProfile = document.querySelector('.admin-profile');
    
    if (profileDropdown && adminProfile) {
        // Make sure dropdown stays visible when hovering over it
        profileDropdown.addEventListener('mouseenter', function() {
            profileDropdown.classList.add('active');
        });
        
        profileDropdown.addEventListener('mouseleave', function() {
            profileDropdown.classList.remove('active');
        });
        
        // Ensure dropdown items are clickable
        const dropdownItems = document.querySelectorAll('.dropdown-item');
        dropdownItems.forEach(function(item) {
            item.addEventListener('click', function(e) {
                // Prevent event bubbling but allow the link to work
                e.stopPropagation();
            });
        });
    }
}
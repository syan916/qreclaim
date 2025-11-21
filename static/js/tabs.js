/**
 * QReclaim Tab System - Reusable Tab Functionality
 * Based on carousel indicator pattern for consistent active state management
 * Provides accessibility features and smooth transitions
 */

// Tab System Configuration
const TabConfig = {
    defaultTabClass: 'tab-indicator',
    defaultContentClass: 'tab-content',
    activeClass: 'active',
    animationDuration: 300,
    enableKeyboard: true,
    enableSwipe: true,
    autoInitialize: true
};

// Global tab state management
const TabState = {
    instances: new Map(),
    activeTabs: new Map()
};

/**
 * Initialize tab system for a specific container
 * @param {HTMLElement} container - The container element containing tabs
 * @param {Object} options - Configuration options
 */
function initializeTabs(container, options = {}) {
    if (!container) return null;
    
    const config = { ...TabConfig, ...options };
    const tabId = container.id || `tabs-${Date.now()}`;
    
    // Find tab indicators and content panels
    const tabs = container.querySelectorAll(`[data-tab-target], .${config.defaultTabClass}`);
    const contents = container.querySelectorAll(`[data-tab-content], .${config.defaultContentClass}`);
    
    if (tabs.length === 0 || contents.length === 0) return null;
    
    // Store instance configuration
    TabState.instances.set(tabId, {
        container,
        tabs: Array.from(tabs),
        contents: Array.from(contents),
        config,
        currentIndex: 0
    });
    
    // Set up event listeners
    setupTabListeners(tabId);
    setupKeyboardNavigation(tabId);
    setupSwipeNavigation(tabId);
    
    // Initialize first tab as active
    activateTab(tabId, 0, false);
    
    return tabId;
}

/**
 * Set up click event listeners for tabs
 * @param {string} tabId - The tab instance ID
 */
function setupTabListeners(tabId) {
    const instance = TabState.instances.get(tabId);
    if (!instance) return;
    
    instance.tabs.forEach((tab, index) => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            activateTab(tabId, index);
        });
        
        // Add role and accessibility attributes
        tab.setAttribute('role', 'tab');
        tab.setAttribute('tabindex', '0');
        tab.setAttribute('aria-selected', 'false');
        
        // Add data attributes if not present
        if (!tab.hasAttribute('data-tab-target')) {
            tab.setAttribute('data-tab-target', `tab-content-${index}`);
        }
    });
    
    // Set up content panels
    instance.contents.forEach((content, index) => {
        content.setAttribute('role', 'tabpanel');
        content.setAttribute('aria-labelledby', `tab-${index}`);
        content.setAttribute('tabindex', '0');
        content.setAttribute('aria-hidden', 'true');
    });
}

/**
 * Set up keyboard navigation for tabs
 * @param {string} tabId - The tab instance ID
 */
function setupKeyboardNavigation(tabId) {
    const instance = TabState.instances.get(tabId);
    if (!instance || !instance.config.enableKeyboard) return;
    
    instance.tabs.forEach((tab, index) => {
        tab.addEventListener('keydown', (e) => {
            let newIndex = index;
            
            switch (e.key) {
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    newIndex = index > 0 ? index - 1 : instance.tabs.length - 1;
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    newIndex = index < instance.tabs.length - 1 ? index + 1 : 0;
                    break;
                case 'Home':
                    e.preventDefault();
                    newIndex = 0;
                    break;
                case 'End':
                    e.preventDefault();
                    newIndex = instance.tabs.length - 1;
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    activateTab(tabId, index);
                    return;
                default:
                    return;
            }
            
            activateTab(tabId, newIndex);
            instance.tabs[newIndex].focus();
        });
    });
}

/**
 * Set up swipe navigation for mobile devices
 * @param {string} tabId - The tab instance ID
 */
function setupSwipeNavigation(tabId) {
    const instance = TabState.instances.get(tabId);
    if (!instance || !instance.config.enableSwipe) return;
    
    const container = instance.container;
    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    
    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    });
    
    container.addEventListener('touchmove', (e) => {
        endX = e.touches[0].clientX;
        endY = e.touches[0].clientY;
    });
    
    container.addEventListener('touchend', (e) => {
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        
        // Only handle horizontal swipes
        if (absDeltaX > absDeltaY && absDeltaX > 50) {
            if (deltaX > 0) {
                // Swipe right - previous tab
                const newIndex = instance.currentIndex > 0 ? instance.currentIndex - 1 : instance.tabs.length - 1;
                activateTab(tabId, newIndex);
            } else {
                // Swipe left - next tab
                const newIndex = instance.currentIndex < instance.tabs.length - 1 ? instance.currentIndex + 1 : 0;
                activateTab(tabId, newIndex);
            }
        }
    });
}

/**
 * Activate a specific tab and show corresponding content
 * @param {string} tabId - The tab instance ID
 * @param {number} index - The tab index to activate
 * @param {boolean} animate - Whether to animate the transition
 */
function activateTab(tabId, index, animate = true) {
    const instance = TabState.instances.get(tabId);
    if (!instance || index < 0 || index >= instance.tabs.length) return;
    
    const { tabs, contents, config, currentIndex } = instance;
    
    // Deactivate current tab and content
    tabs[currentIndex].classList.remove(config.activeClass);
    tabs[currentIndex].setAttribute('aria-selected', 'false');
    
    if (contents[currentIndex]) {
        contents[currentIndex].classList.remove(config.activeClass);
        contents[currentIndex].setAttribute('aria-hidden', 'true');
    }
    
    // Activate new tab and content
    tabs[index].classList.add(config.activeClass);
    tabs[index].setAttribute('aria-selected', 'true');
    
    if (contents[index]) {
        contents[index].classList.add(config.activeClass);
        contents[index].setAttribute('aria-hidden', 'false');
    }
    
    // Update instance state
    instance.currentIndex = index;
    TabState.activeTabs.set(tabId, index);
    
    // Trigger custom event
    const event = new CustomEvent('tabActivated', {
        detail: { tabId, index, tab: tabs[index], content: contents[index] }
    });
    instance.container.dispatchEvent(event);
    
    // Handle animation if requested
    if (animate && config.animationDuration > 0) {
        handleTabAnimation(instance, index);
    }
}

/**
 * Handle tab transition animations
 * @param {Object} instance - The tab instance
 * @param {number} index - The active tab index
 */
function handleTabAnimation(instance, index) {
    const { contents, config } = instance;
    const content = contents[index];
    
    if (!content) return;
    
    // Add animation classes
    content.style.opacity = '0';
    content.style.transform = 'translateY(10px)';
    
    // Force reflow
    content.offsetHeight;
    
    // Animate in
    content.style.transition = `opacity ${config.animationDuration}ms ease, transform ${config.animationDuration}ms ease`;
    content.style.opacity = '1';
    content.style.transform = 'translateY(0)';
    
    // Clean up after animation
    setTimeout(() => {
        content.style.transition = '';
    }, config.animationDuration);
}

/**
 * Get the currently active tab index for a specific instance
 * @param {string} tabId - The tab instance ID
 * @returns {number} The active tab index
 */
function getActiveTabIndex(tabId) {
    const instance = TabState.instances.get(tabId);
    return instance ? instance.currentIndex : -1;
}

/**
 * Get all tab instances
 * @returns {Map} Map of tab instances
 */
function getAllTabInstances() {
    return TabState.instances;
}

/**
 * Destroy a tab instance and clean up event listeners
 * @param {string} tabId - The tab instance ID
 */
function destroyTabInstance(tabId) {
    const instance = TabState.instances.get(tabId);
    if (!instance) return;
    
    // Remove event listeners
    instance.tabs.forEach(tab => {
        tab.replaceWith(tab.cloneNode(true));
    });
    
    // Clean up state
    TabState.instances.delete(tabId);
    TabState.activeTabs.delete(tabId);
}

/**
 * Auto-initialize tabs on DOMContentLoaded
 */
function autoInitializeTabs() {
    const tabContainers = document.querySelectorAll('[data-tabs], .tab-container');
    
    tabContainers.forEach(container => {
        const options = {};
        
        // Parse data attributes for configuration
        if (container.hasAttribute('data-tabs-animation')) {
            options.animationDuration = parseInt(container.getAttribute('data-tabs-animation'));
        }
        
        if (container.hasAttribute('data-tabs-keyboard')) {
            options.enableKeyboard = container.getAttribute('data-tabs-keyboard') === 'true';
        }
        
        if (container.hasAttribute('data-tabs-swipe')) {
            options.enableSwipe = container.getAttribute('data-tabs-swipe') === 'true';
        }
        
        initializeTabs(container, options);
    });
}

/**
 * Initialize tabs when DOM is ready
 */
if (TabConfig.autoInitialize) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInitializeTabs);
    } else {
        autoInitializeTabs();
    }
}

// Export functionality for global use
window.TabSystem = {
    initializeTabs,
    activateTab,
    getActiveTabIndex,
    getAllTabInstances,
    destroyTabInstance,
    TabConfig,
    TabState
};
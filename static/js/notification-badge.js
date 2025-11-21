// Notification Badge Handler
class NotificationBadge {
    constructor() {
        this.headerBadgeEl = document.getElementById('notificationBadge');
        this.mobileBadgeEl = document.getElementById('mobileNotificationBadge');
        this.updateInterval = null;
        this.init();
    }

    init() {
        // Initial load
        this.updateNotificationCount();
        
        // Update every 30 seconds
        this.updateInterval = setInterval(() => {
            this.updateNotificationCount();
        }, 30000);
        
        // Update when page becomes visible (user switches back to tab)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.updateNotificationCount();
            }
        });
    }

    async updateNotificationCount() {
        try {
            const response = await fetch('/user/api/notifications/count', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin'
            });

            if (response.ok) {
                const data = await response.json();
                this.displayBadge(data.count);
            } else {
                console.error('Failed to fetch notification count:', response.statusText);
            }
        } catch (error) {
            console.error('Error fetching notification count:', error);
        }
    }

    displayBadge(count) {
        const headerEl = this.headerBadgeEl;
        const mobileEl = this.mobileBadgeEl;

        if (count > 0) {
            const text = count > 99 ? '99+' : count.toString();
            if (headerEl) {
                headerEl.textContent = text;
                headerEl.style.display = 'inline-block';
                // Add animation for new notifications
                headerEl.classList.add('notification-pulse');
                setTimeout(() => {
                    headerEl.classList.remove('notification-pulse');
                }, 1000);
            }
            if (mobileEl) {
                mobileEl.textContent = text;
                mobileEl.style.display = 'inline-flex';
            }
        } else {
            if (headerEl) headerEl.style.display = 'none';
            if (mobileEl) mobileEl.style.display = 'none';
        }
    }

    // Method to manually refresh (can be called from other scripts)
    refresh() {
        this.updateNotificationCount();
    }

    // Cleanup method
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}

// Initialize notification badge when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize if either header or mobile badge exists
    if (document.getElementById('notificationBadge') || document.getElementById('mobileNotificationBadge')) {
        window.notificationBadge = new NotificationBadge();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (window.notificationBadge) {
        window.notificationBadge.destroy();
    }
});
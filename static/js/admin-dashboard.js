/**
 * Admin Dashboard Specific JavaScript
 * This file contains functionality specific to the admin dashboard page
 * For common admin functionality, see admin.js
 */

$(document).ready(function() {
    // Initialize dashboard components
    initDashboard();
    
    // Initialize dashboard charts if any
    initDashboardCharts();
    
    // Initialize quick action buttons
    initQuickActions();
});

/**
 * Initialize dashboard components and fetch latest data
 */
function initDashboard() {
    // Fetch latest dashboard statistics
    updateDashboardStats();
    
    // Add animation to stat cards
    animateStatCards();
    
    // Initialize recent activity list
    initRecentActivity();
}

/**
 * Update dashboard statistics with latest data
 */
function updateDashboardStats() {
    // In a real application, this would fetch data from the server
    // For now, we'll use the existing data in the HTML
    
    // Example of how to update stats dynamically:
    // $.ajax({
    //     url: '/api/admin/dashboard/stats',
    //     method: 'GET',
    //     success: function(response) {
    //         $('#qr-requests-count').text(response.qrRequests);
    //         $('#lost-items-count').text(response.lostItems);
    //         $('#found-items-count').text(response.foundItems);
    //         $('#claimed-items-count').text(response.claimedItems);
    //     },
    //     error: function(error) {
    //         console.error('Error fetching dashboard stats:', error);
    //     }
    // });
    
    // For demo purposes, we'll just add a simple counter animation
    $('.stat-value').each(function() {
        const $this = $(this);
        const countTo = parseInt($this.text().trim());
        
        $({ countNum: 0 }).animate({
            countNum: countTo
        }, {
            duration: 1000,
            easing: 'swing',
            step: function() {
                $this.text(Math.floor(this.countNum));
            },
            complete: function() {
                $this.text(this.countNum);
            }
        });
    });
}

/**
 * Add animation effects to stat cards
 */
function animateStatCards() {
    // Add entrance animation to stat cards
    $('.stat-card').each(function(index) {
        $(this).css({
            'animation': `fadeInUp 0.5s ease-out ${index * 0.1}s forwards`,
            'opacity': '0',
            'transform': 'translateY(20px)'
        });
    });
    
    // Add CSS for the animation if not already in stylesheet
    if (!document.getElementById('dashboard-animations')) {
        const style = document.createElement('style');
        style.id = 'dashboard-animations';
        style.innerHTML = `
            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Update overdue items status
 */
function updateOverdueItems() {
    const button = document.getElementById('updateOverdueBtn');
    const originalText = button.querySelector('.action-label').textContent;
    
    // Disable button and show loading state
    button.disabled = true;
    button.querySelector('.action-label').textContent = 'Updating...';
    button.querySelector('.action-icon i').className = 'fas fa-spinner fa-spin';
    
    fetch('/admin/api/status/update-overdue', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`Successfully updated ${data.updated_count} items to overdue status.`);
            
            // Show details if any items were updated
            if (data.updated_count > 0 && data.updated_items) {
                let details = 'Updated items:\n';
                data.updated_items.forEach(item => {
                    details += `• ${item.name} (${item.days_overdue} days overdue)\n`;
                });
                console.log(details);
            }
            
            // Refresh the page to show updated statistics
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            alert('Error updating overdue items: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error updating overdue items:', error);
        alert('Failed to update overdue items. Please try again.');
    })
    .finally(() => {
        // Restore button state
        button.disabled = false;
        button.querySelector('.action-label').textContent = originalText;
        button.querySelector('.action-icon i').className = 'fas fa-clock';
    });
}

/**
 * Initialize recent activity list with interactive features
 */
function initRecentActivity() {
    // Add hover effects and click handlers for activity items
    $('.activity-item').hover(function() {
        $(this).find('.activity-icon').addClass('pulse');
    }, function() {
        $(this).find('.activity-icon').removeClass('pulse');
    });
    
    // Add CSS for the pulse animation if not already in stylesheet
    if (!document.getElementById('activity-animations')) {
        const style = document.createElement('style');
        style.id = 'activity-animations';
        style.innerHTML = `
            @keyframes pulse {
                0% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.1);
                }
                100% {
                    transform: scale(1);
                }
            }
            .activity-icon.pulse {
                animation: pulse 0.5s ease-in-out;
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Initialize dashboard charts using Chart.js
 * Requires Chart.js to be included in the page
 */
function initDashboardCharts() {
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js is not available. Skipping chart initialization.');
        return;
    }
    
    // Example: Initialize a chart for item statistics if the canvas exists
    const itemStatsCanvas = document.getElementById('itemStatsChart');
    if (itemStatsCanvas) {
        const ctx = itemStatsCanvas.getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                datasets: [{
                    label: 'Found Items',
                    data: [12, 19, 3, 5, 2, 3],
                    borderColor: 'rgba(46, 204, 113, 1)',
                    backgroundColor: 'rgba(46, 204, 113, 0.1)',
                    borderWidth: 2,
                    tension: 0.4
                }, {
                    label: 'Lost Items',
                    data: [5, 15, 10, 8, 12, 9],
                    borderColor: 'rgba(243, 156, 18, 1)',
                    backgroundColor: 'rgba(243, 156, 18, 0.1)',
                    borderWidth: 2,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Item Statistics'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
}

/**
 * Initialize quick action buttons
 */
function initQuickActions() {
    // Add click handlers for quick action buttons
    $('.action-button').click(function(e) {
        const action = $(this).data('action');
        
        // Add a ripple effect on click
        const ripple = $('<span class="ripple"></span>');
        const x = e.pageX - $(this).offset().left;
        const y = e.pageY - $(this).offset().top;
        
        ripple.css({
            top: y + 'px',
            left: x + 'px'
        });
        
        $(this).append(ripple);
        
        setTimeout(function() {
            ripple.remove();
        }, 600);
        
        // Handle different actions
        switch(action) {
            case 'post-found':
                window.location.href = '/admin/post-found';
                break;
            case 'manage-lost':
                window.location.href = '/admin/manage-lost';
                break;
            case 'qr-requests':
                window.location.href = '/admin/qr-requests';
                break;
            case 'analytics':
                window.location.href = '/admin/analytics';
                break;
            default:
                console.log('Action not defined:', action);
        }
    });
    
    // Add CSS for the ripple effect if not already in stylesheet
    if (!document.getElementById('ripple-effect')) {
        const style = document.createElement('style');
        style.id = 'ripple-effect';
        style.innerHTML = `
            .action-button {
                position: relative;
                overflow: hidden;
            }
            .ripple {
                position: absolute;
                border-radius: 50%;
                background-color: rgba(255, 255, 255, 0.7);
                width: 100px;
                height: 100px;
                margin-top: -50px;
                margin-left: -50px;
                animation: ripple 0.6s linear;
                transform: scale(0);
                opacity: 1;
            }
            @keyframes ripple {
                to {
                    transform: scale(2.5);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}
/**
 * Found Item Review Page JavaScript
 * Handles display and management of found items assigned to lockers for more than 31 days
 */

class FoundItemReview {
    constructor() {
        this.items = [];
        this.filteredItems = [];
        this.currentFilters = {
            category: '',
            status: '',
            locker: '',
            daysRange: ''
        };
        this.init();
    }

    /**
     * Initialize the page
     */
    async init() {
        try {
            this.showLoading(true);
            await this.loadFoundItems();
            this.setupEventListeners();
            this.renderItems();
            this.updateStatistics();
            this.showLoading(false);
        } catch (error) {
            console.error('Error initializing found item review:', error);
            this.showMessage('Failed to load found items. Please refresh the page.', 'error');
            this.showLoading(false);
        }
    }

    /**
     * Load found items from Firestore with filtering for items assigned to lockers for >31 days
     */
    async loadFoundItems() {
        try {
            const response = await fetch('/admin/api/found-items/review');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.items = data.found_items;
                this.statistics = data.statistics;
            } else {
                throw new Error(data.error || 'Failed to load items');
            }
            
            this.filteredItems = [...this.items];
            
        } catch (error) {
            console.error('Error loading found items:', error);
            throw error;
        }
    }

    /**
     * Setup event listeners for filters and actions
     */
    setupEventListeners() {
        // Filter controls
        const categoryFilter = document.getElementById('categoryFilter');
        const statusFilter = document.getElementById('statusFilter');
        const lockerFilter = document.getElementById('lockerFilter');
        const daysRangeFilter = document.getElementById('daysRangeFilter');
        const filterBtn = document.getElementById('filterBtn');
        const resetBtn = document.getElementById('resetBtn');

        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.currentFilters.category = categoryFilter.value;
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.currentFilters.status = statusFilter.value;
            });
        }

        if (lockerFilter) {
            lockerFilter.addEventListener('change', () => {
                this.currentFilters.locker = lockerFilter.value;
            });
        }

        if (daysRangeFilter) {
            daysRangeFilter.addEventListener('change', () => {
                this.currentFilters.daysRange = daysRangeFilter.value;
            });
        }

        if (filterBtn) {
            filterBtn.addEventListener('click', () => {
                this.applyFilters();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetFilters();
            });
        }
    }

    /**
     * Apply current filters to the items list
     */
    applyFilters() {
        this.filteredItems = this.items.filter(item => {
            // Category filter
            if (this.currentFilters.category && item.category !== this.currentFilters.category) {
                return false;
            }

            // Status filter
            if (this.currentFilters.status && item.status !== this.currentFilters.status) {
                return false;
            }

            // Locker filter
            if (this.currentFilters.locker && item.locker_assignment?.locker_id !== this.currentFilters.locker) {
                return false;
            }

            // Days range filter
            if (this.currentFilters.daysRange) {
                const daysSinceFound = this.calculateDaysSinceFound(item);
                const [min, max] = this.currentFilters.daysRange.split('-').map(Number);
                
                if (max) {
                    if (daysSinceFound < min || daysSinceFound > max) {
                        return false;
                    }
                } else {
                    if (daysSinceFound < min) {
                        return false;
                    }
                }
            }

            return true;
        });

        this.renderItems();
        this.updateStatistics();
    }

    /**
     * Reset all filters
     */
    resetFilters() {
        this.currentFilters = {
            category: '',
            status: '',
            locker: '',
            daysRange: ''
        };

        // Reset filter controls
        const categoryFilter = document.getElementById('categoryFilter');
        const statusFilter = document.getElementById('statusFilter');
        const lockerFilter = document.getElementById('lockerFilter');
        const daysRangeFilter = document.getElementById('daysRangeFilter');

        if (categoryFilter) categoryFilter.value = '';
        if (statusFilter) statusFilter.value = '';
        if (lockerFilter) lockerFilter.value = '';
        if (daysRangeFilter) daysRangeFilter.value = '';

        this.filteredItems = [...this.items];
        this.renderItems();
        this.updateStatistics();
    }

    /**
     * Calculate days since the item was found
     */
    calculateDaysSinceFound(item) {
        if (!item.time_found) {
            return 0;
        }
        
        const foundDate = new Date(item.time_found);
        const today = new Date();
        const diffTime = Math.abs(today - foundDate);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Render items in the table
     */
    renderItems() {
        const tableBody = document.getElementById('itemsTableBody');
        if (!tableBody) return;

        if (this.filteredItems.length === 0) {
            this.showEmptyState();
            return;
        }

        tableBody.innerHTML = this.filteredItems.map(item => {
            const daysSinceFound = this.calculateDaysSinceFound(item);
            const daysClass = daysSinceFound > 60 ? 'days-overdue' : daysSinceFound > 45 ? 'days-warning' : '';
            
            return `
                <tr data-item-id="${item.id}">
                    <td>
                        <img src="${item.image_url || '/static/images/no-image.png'}" 
                             alt="${item.found_item_name}" 
                             class="item-image"
                             onerror="this.src='/static/images/no-image.png'">
                    </td>
                    <td>
                        <div class="item-name" title="${item.found_item_name}">
                            ${this.escapeHtml(item.found_item_name)} (ID: ${item.id})
                        </div>
                    </td>
                    <td>
                        <span class="category-badge">
                            ${this.escapeHtml(item.category)}
                        </span>
                    </td>
                    <td>
                        <span class="status-badge status-${item.status.toLowerCase()}">
                            ${this.escapeHtml(item.status)}
                        </span>
                    </td>
                    <td>
                        <div class="locker-info">
                            ${item.locker_id || 'N/A'}
                        </div>
                    </td>
                    <td>
                        <span class="locker-status ${item.assigned_to_locker ? 'assigned' : 'not-assigned'}">
                            ${item.assigned_to_locker ? 'Yes' : 'No'}
                        </span>
                    </td>
                    <td>
                        ${this.formatDate(item.time_found)}
                    </td>
                    <td>
                        <span class="days-count ${daysClass}">
                            ${daysSinceFound} days
                        </span>
                    </td>
                    <td>
                        <div class="reviewed-by">
                            ${item.reviewed_by_name ? `${item.reviewed_by_name} (ID: ${item.reviewed_by_id})` : 'Not Reviewed'}
                        </div>
                    </td>
                    <td>
                        ${this.formatDate(item.last_updated)}
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-action btn-view" 
                                    onclick="foundItemReview.viewRemarks('${item.id}')"
                                    title="View Remarks">
                                View
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Show empty state when no items match filters
     */
    showEmptyState() {
        const tableBody = document.getElementById('itemsTableBody');
        if (!tableBody) return;

        tableBody.innerHTML = `
            <tr>
                <td colspan="11" class="empty-state">
                    <div class="empty-icon">📦</div>
                    <div class="empty-title">No Items Found</div>
                    <div class="empty-message">
                        No found items match the current filter criteria or have been in lockers for more than 31 days.
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Update statistics display
     */
    updateStatistics() {
        const totalItemsEl = document.getElementById('totalItems');
        const overdueItemsEl = document.getElementById('overdueItems');
        const avgDaysEl = document.getElementById('avgDays');

        if (totalItemsEl) {
            totalItemsEl.textContent = this.filteredItems.length;
        }

        if (overdueItemsEl) {
            const overdueCount = this.filteredItems.filter(item => 
                this.calculateDaysSinceFound(item) > 60
            ).length;
            overdueItemsEl.textContent = overdueCount;
        }

        if (avgDaysEl) {
            const totalDays = this.filteredItems.reduce((sum, item) => 
                sum + this.calculateDaysSinceFound(item), 0
            );
            const avgDays = this.filteredItems.length > 0 ? 
                Math.round(totalDays / this.filteredItems.length) : 0;
            avgDaysEl.textContent = avgDays;
        }
    }

    /**
     * View item remarks/notes
     */
    viewRemarks(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            this.showMessage('Item not found', 'error');
            return;
        }

        // Create and show remarks modal
        this.showRemarksModal(item);
    }

    /**
     * Show remarks modal
     */
    showRemarksModal(item) {
        // Remove existing modal if any
        const existingModal = document.getElementById('remarksModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHTML = `
            <div id="remarksModal" class="modal">
                <div class="modal-content remarks-modal-content">
                    <div class="modal-header">
                        <h3>Item Remarks & Notes</h3>
                        <span class="close" onclick="foundItemReview.closeRemarksModal()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div class="item-info-section">
                            <div class="item-header">
                                <h4>${this.escapeHtml(item.found_item_name)} (ID: ${item.id})</h4>
                                <span class="status-badge status-${item.status.toLowerCase()}">
                                    ${this.escapeHtml(item.status)}
                                </span>
                            </div>
                        </div>
                        <div class="remarks-section">
                            <h5>Admin Remarks</h5>
                            <div class="remarks-content">
                                ${item.admin_remarks ? this.escapeHtml(item.admin_remarks) : 'No remarks available'}
                            </div>
                        </div>
                        <div class="notes-section">
                            <h5>Additional Notes</h5>
                            <div class="notes-content">
                                ${item.notes ? this.escapeHtml(item.notes) : 'No additional notes'}
                            </div>
                        </div>
                        ${item.reviewed_by_name ? `
                        <div class="reviewed-info">
                            <h5>Reviewed By</h5>
                            <div class="reviewer-details">
                                ${this.escapeHtml(item.reviewed_by_name)} (ID: ${item.reviewed_by_id})
                                <br>
                                <small>Last Updated: ${this.formatDate(item.last_updated)}</small>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn-secondary" onclick="foundItemReview.closeRemarksModal()">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Show modal
        const modal = document.getElementById('remarksModal');
        modal.classList.add('show');
    }

    /**
     * Close remarks modal
     */
    closeRemarksModal() {
        const modal = document.getElementById('remarksModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    }

    /**
     * Send notification for overdue item
     */
    async sendNotification(itemId) {
        try {
            const item = this.items.find(i => i.id === itemId);
            if (!item) {
                throw new Error('Item not found');
            }

            const response = await fetch(`/admin/api/found-items/${itemId}/notify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'overdue_reminder',
                    days_since_found: this.calculateDaysSinceFound(item)
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.showMessage('Notification sent successfully!', 'success');
        } catch (error) {
            console.error('Error sending notification:', error);
            this.showMessage('Failed to send notification. Please try again.', 'error');
        }
    }

    /**
     * Remove item from locker
     */
    async removeFromLocker(itemId) {
        const ok = await adminConfirm('Are you sure you want to remove this item from locker assignment?', {type:'warning', title:'Remove Locker Assignment'}); if (!ok) { return; }
        
        try {
            const response = await fetch(`/admin/api/found-items/${itemId}/remove-from-locker`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showMessage('Item successfully removed from locker', 'success');
                // Reload items to reflect the change
                await this.loadFoundItems();
            } else {
                this.showMessage('Failed to remove item from locker: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            console.error('Error removing item from locker:', error);
            this.showMessage('Failed to remove item from locker. Please try again.', 'error');
        }
    }

    /**
     * Show/hide loading spinner
     */
    showLoading(show) {
        const loadingEl = document.getElementById('loadingSpinner');
        const tableContainer = document.getElementById('itemsTableContainer');
        
        if (loadingEl) {
            loadingEl.style.display = show ? 'flex' : 'none';
        }
        
        if (tableContainer) {
            tableContainer.style.display = show ? 'none' : 'block';
        }
    }

    /**
     * Show message with type (success or error)
     */
    showMessage(message, type = 'info') {
        if (window.messageBox) {
            if (type === 'success') {
                window.messageBox.showSuccess(message);
            } else if (type === 'error') {
                window.messageBox.showError(message);
            } else {
                window.messageBox.showInfo(message);
            }
        } else {
            alert(message);
        }
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    /**
     * Show error message
     */
    showError(message) {
        this.showMessage(message, 'error');
    }

    /**
     * Format date for display
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (error) {
            return 'Invalid Date';
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.foundItemReview = new FoundItemReview();
});
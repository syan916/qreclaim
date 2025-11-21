// Manage Found Items JavaScript
class ManageFoundItems {
    constructor() {
        this.currentPage = 1;
        this.itemsPerPage = 5; // Changed to 5 records per page for server-side pagination
        this.totalItems = 0;
        this.totalPages = 0;
        this.sortColumn = 'created_at';
        this.sortDirection = 'desc';
        this.searchTerm = '';
        this.categoryFilter = '';
        this.statusFilter = ''; // Default to show all items
        this.locationFilter = '';
        this.abortController = null; // For request cancellation
        this.availableCategories = [];
        this.availableLocations = [];
        this.isLoading = false;

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadFoundItems(); // Load items with server-side pagination
    }

    bindEvents() {
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce((e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.currentPage = 1; // Reset to first page when searching
                this.loadFoundItems();
            }, 300));
        }

        // Filter functionality
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.categoryFilter = e.target.value;
                this.currentPage = 1; // Reset to first page when filtering
                this.loadFoundItems();
            });
        }

        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.statusFilter = e.target.value;
                this.currentPage = 1; // Reset to first page when filtering
                this.loadFoundItems();
            });
        }

        const locationFilter = document.getElementById('locationFilter');
        if (locationFilter) {
            locationFilter.addEventListener('change', (e) => {
                this.locationFilter = e.target.value;
                this.currentPage = 1; // Reset to first page when filtering
                this.loadFoundItems();
            });
        }

        // Clear filters button
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        // Pagination controls
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('pagination-btn')) {
                const page = parseInt(e.target.dataset.page);
                if (page && page !== this.currentPage) {
                    this.goToPage(page);
                }
            }
        });

        // Table sorting
        document.addEventListener('click', (e) => {
            // Check if the clicked element or its parent has the sortable class
            const sortableElement = e.target.closest('.sortable');
            if (sortableElement) {
                const column = sortableElement.dataset.sort;
                this.sortTable(column);
            }
        });

        // Image modal functionality
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('item-image')) {
                this.showImageModal(e.target.src, e.target.alt);
            }
        });
    }

    // Debounce function for search input
    debounce(func, wait) {
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

    async loadFoundItems() {
        console.log('Starting loadFoundItems with server-side pagination...');
        
        // Cancel any existing request
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        
        // Prevent multiple simultaneous requests
        if (this.isLoading) {
            console.log('Already loading, skipping...');
            return;
        }
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            // Build query parameters
            const params = new URLSearchParams({
                page: this.currentPage,
                per_page: this.itemsPerPage
            });
            
            if (this.searchTerm) {
                params.append('search', this.searchTerm);
            }
            if (this.categoryFilter) {
                params.append('category', this.categoryFilter);
            }
            if (this.statusFilter) {
                params.append('status', this.statusFilter);
            }
            if (this.locationFilter) {
                params.append('location', this.locationFilter);
            }
            
            // Add sorting parameters
            if (this.sortColumn) {
                params.append('sort_by', this.sortColumn);
                params.append('sort_direction', this.sortDirection);
            }
            
            console.log('Making API request to /admin/api/found-items/bulk with params:', params.toString());
            const response = await fetch(`/admin/api/found-items/bulk?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin', // Include session cookies
                signal: this.abortController.signal
            });

            console.log('API response status:', response.status, response.statusText);

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    console.log('Error response data:', errorData);
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (jsonError) {
                    console.warn('Failed to parse error response as JSON:', jsonError);
                }
                
                // Handle authentication errors specifically
                if (response.status === 401) {
                    console.error('Authentication failed - redirecting to login');
                    window.location.href = '/login';
                    return;
                }
                
                throw new Error(errorMessage);
            }

            let data;
            try {
                data = await response.json();
                console.log('API response data:', data);
            } catch (jsonError) {
                console.error('Failed to parse response as JSON:', jsonError);
                throw new Error('Server returned invalid JSON response');
            }
            
            if (data.success) {
                // Update pagination info
                this.totalItems = data.pagination.total_items;
                this.totalPages = data.pagination.total_pages;
                this.currentPage = data.pagination.current_page;
                
                // Store filter options
                this.availableCategories = data.filters?.categories || [];
                this.availableLocations = data.filters?.locations || [];
                
                console.log('Data loaded successfully:', {
                    itemsCount: data.found_items.length,
                    totalItems: this.totalItems,
                    totalPages: this.totalPages,
                    currentPage: this.currentPage
                });
                
                // Populate filter dropdowns (only on first load)
                if (this.currentPage === 1) {
                    this.populateFilterOptions();
                }
                
                // Render the table with current page data
                this.renderTable(data.found_items);
                this.renderPagination();
                this.updateItemsCount();
                this.updateResultsMessage();
                
                console.log(`Loaded page ${this.currentPage} of ${this.totalPages} (${data.found_items.length} items)`);
            } else {
                console.error('API returned success=false:', data);
                this.showError('Failed to load found items: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Request was cancelled');
                return;
            }
            
            console.error('Error loading found items:', error);
            this.showError('Failed to load found items. Please try again.');
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    sortTable(column) {
        // Update sort direction
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        
        // Update visual indicators
        this.updateSortIndicators();
        
        // Reset to first page when sorting
        this.currentPage = 1;
        this.loadFoundItems();
    }

    updateSortIndicators() {
        // Remove all existing sort classes
        document.querySelectorAll('.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });
        
        // Add appropriate class to current sort column
        const currentSortHeader = document.querySelector(`[data-sort="${this.sortColumn}"]`);
        if (currentSortHeader) {
            currentSortHeader.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    }


    populateFilterOptions() {
        // Update category filter
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter && this.availableCategories) {
            const currentValue = categoryFilter.value;
            categoryFilter.innerHTML = '<option value="">All Categories</option>';
            this.availableCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                if (category === currentValue) option.selected = true;
                categoryFilter.appendChild(option);
            });
        }

        // Update location filter
        const locationFilter = document.getElementById('locationFilter');
        if (locationFilter && this.availableLocations) {
            const currentValue = locationFilter.value;
            locationFilter.innerHTML = '<option value="">All Locations</option>';
            this.availableLocations.forEach(location => {
                const option = document.createElement('option');
                option.value = location;
                option.textContent = location;
                if (location === currentValue) option.selected = true;
                locationFilter.appendChild(option);
            });
        }
    }



    renderTable(items = []) {
        const tableBody = document.getElementById('foundItemsTableBody');
        if (!tableBody) return;

        // Clear any existing content (including initial loading state)
        tableBody.innerHTML = '';

        if (items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>
                            <i class="fas fa-search"></i>
                            <h3>No items found</h3>
                            <p>Try adjusting your search criteria or filters</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Render items from server response
        const tableHTML = items.map(item => this.renderTableRow(item)).join('');
        tableBody.innerHTML = tableHTML;
    }

    renderTableRow(item) {
        const createdDate = this.formatDate(item.created_at);
        const timeFound = this.formatDate(item.time_found);
        const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
        const isFinalStatus = ['claimed', 'returned', 'donated', 'discarded'].includes(item.status.toLowerCase());
        
        // Calculate storage duration: time_found + current date (stop counting for final status)
        const storageDuration = this.calculateStorageDuration(item.time_found, item.status);
        
        // Button visibility logic based on status and admin review
        const isOverdue = item.status.toLowerCase() === 'overdue';
        const hasBeenReviewed = item.admin_review_id && item.admin_review_id.trim() !== '';
        const showUpdateStatus = !isFinalStatus && !isOverdue;
        const showAdminReview = isOverdue && !hasBeenReviewed;
        const showViewOnly = hasBeenReviewed;
        const showEditDelete = !isFinalStatus && !hasBeenReviewed;
        
        return `
            <tr data-item-id="${item.found_item_id}">
                <td>
                    <img src="${item.image_url || '/static/images/no-image.svg'}" 
                     alt="${item.found_item_name}" 
                     class="item-image"
                     onerror="this.src='/static/images/no-image.svg'">
                </td>
                <td>
                    <div class="item-info">
                        <strong>${this.escapeHtml(item.found_item_name || 'N/A')}</strong>
                        <small class="text-muted">${item.found_item_id}</small>
                    </div>
                </td>
                <td>${this.escapeHtml(item.category || 'N/A')}</td>
                <td>${this.escapeHtml(item.place_found || 'N/A')}</td>
                <td>${timeFound}</td>
                <td>
                    <span class="storage-duration ${!isFinalStatus && storageDuration > 31 ? 'overdue-highlight' : !isFinalStatus && storageDuration > 25 ? 'warning' : isFinalStatus ? 'final-status' : ''}">
                        ${isFinalStatus ? `${storageDuration} (Final)` : storageDuration}
                    </span>
                </td>
                <td>
                    <span class="status-badge status-${item.status}">
                        ${this.escapeHtml(item.status || 'unknown')}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <!-- View Button - Always visible -->
                        <button class="action-btn btn-view" onclick="editItem('${item.found_item_id}')" title="View Item Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        
                        <!-- Update Status Button - Hidden for final statuses and overdue items -->
                        ${showUpdateStatus ? `
                            <button class="action-btn btn-status" 
                                    onclick="openStatusUpdateModal('${item.found_item_id}', '${this.escapeHtml(item.found_item_name)}', '${item.status}')" 
                                    title="Update Status">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                        ` : ''}
                        
                        <!-- Admin Review Button - Only for 'Overdue' items that haven't been reviewed -->
                        ${showAdminReview ? `
                            <button class="action-btn btn-review" onclick="openAdminReviewModal('${item.found_item_id}', '${this.escapeHtml(item.found_item_name)}')" title="Admin Review">
                                <i class="fas fa-clipboard-check"></i>
                            </button>
                        ` : ''}
                        
                        <!-- View Review Button - For items that have been reviewed -->
                        ${showViewOnly && hasBeenReviewed ? `
                            <button class="action-btn btn-view-review" onclick="viewAdminReview('${item.admin_review_id}')" title="View Admin Review">
                                <i class="fas fa-clipboard-list"></i>
                            </button>
                        ` : ''}
                        
                        <!-- Delete Button - Hidden for final statuses and reviewed items -->
                        ${showEditDelete ? `
                            <button class="action-btn btn-delete" onclick="deleteItem('${item.found_item_id}')" title="Delete Item">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    // Calculate storage duration from time_found to current date
    calculateStorageDuration(timeFound, status = '') {
        if (!timeFound) return 0;
        
        try {
            const foundDate = new Date(timeFound);
            const isFinalStatus = ['claimed', 'returned', 'donated', 'discarded'].includes(status.toLowerCase());
            
            // For final status items, calculate duration up to when status was changed
            // Since we don't have status change date, we'll show the duration but mark it as final
            const currentDate = new Date();
            const timeDiff = currentDate.getTime() - foundDate.getTime();
            const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
            
            return Math.max(0, daysDiff); // Ensure non-negative
        } catch (error) {
            console.error('Error calculating storage duration:', error);
            return 0;
        }
    }

    // Update results message box to show filter information
    updateResultsMessage() {
        const messageBox = document.getElementById('resultsMessageBox');
        const resultsCount = document.getElementById('resultsCount');
        const filterSummary = document.getElementById('filterSummary');
        
        if (!messageBox || !resultsCount || !filterSummary) return;
        
        // Check if any filters are applied
        const hasFilters = this.searchTerm || this.categoryFilter || this.statusFilter || this.locationFilter;
        
        if (hasFilters) {
            // Show the message box
            messageBox.style.display = 'block';
            
            // Update results count
            resultsCount.textContent = `${this.totalItems} item${this.totalItems !== 1 ? 's' : ''} found`;
            
            // Build filter summary
            const activeFilters = [];
            if (this.searchTerm) activeFilters.push(`Search: "${this.searchTerm}"`);
            if (this.categoryFilter) activeFilters.push(`Category: ${this.categoryFilter}`);
            if (this.statusFilter) activeFilters.push(`Status: ${this.statusFilter}`);
            if (this.locationFilter) activeFilters.push(`Location: ${this.locationFilter}`);
            
            if (activeFilters.length > 0) {
                filterSummary.textContent = `(Filtered by: ${activeFilters.join(', ')})`;
            } else {
                filterSummary.textContent = '';
            }
        } else {
            // Hide the message box when no filters are applied
            messageBox.style.display = 'none';
        }
    }

    renderPagination() {
        const paginationContainer = document.getElementById('paginationControls');
        if (!paginationContainer) return;

        if (this.totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = `
            <button class="pagination-btn" data-page="${this.currentPage - 1}" 
                    ${this.currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i> Previous
            </button>
        `;

        // Page numbers
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(this.totalPages, this.currentPage + 2);

        if (startPage > 1) {
            paginationHTML += `<button class="pagination-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" 
                        data-page="${i}">${i}</button>
            `;
        }

        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
            paginationHTML += `<button class="pagination-btn" data-page="${this.totalPages}">${this.totalPages}</button>`;
        }

        paginationHTML += `
            <button class="pagination-btn" data-page="${this.currentPage + 1}" 
                    ${this.currentPage === this.totalPages ? 'disabled' : ''}>
                Next <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationContainer.innerHTML = paginationHTML;
    }

    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;
        
        this.currentPage = page;
        
        // Load new page from server
        this.loadFoundItems();
        
        // Scroll to table section
        document.querySelector('.table-section').scrollIntoView({ behavior: 'smooth' });
    }

    updateItemsCount() {
        const itemsCountElement = document.getElementById('itemsCount');
        if (itemsCountElement) {
            const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
            const endItem = Math.min(this.currentPage * this.itemsPerPage, this.totalItems);
            itemsCountElement.textContent = `Showing ${startItem}-${endItem} of ${this.totalItems} items`;
        }
    }

    clearAllFilters() {
        // Reset all filter values
        this.searchTerm = '';
        this.categoryFilter = '';
        this.statusFilter = '';
        this.locationFilter = '';
        this.currentPage = 1;

        // Reset form elements
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) categoryFilter.value = '';

        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) statusFilter.value = '';

        const locationFilter = document.getElementById('locationFilter');
        if (locationFilter) locationFilter.value = '';

        // Reload data from server
        this.loadFoundItems();
    }

    showLoading() {
        const tableBody = document.getElementById('foundItemsTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>
                            <i class="fas fa-spinner fa-spin"></i>
                            <h3>Loading found items...</h3>
                            <p>Please wait while we fetch the data</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    hideLoading() {
        // Loading state is cleared when renderTable is called
    }

    showError(message) {
        // Log error to console for debugging (backend only)
        console.error(message);
        // Remove alert to prevent user-facing error popups
        // Error is logged for debugging purposes only
    }

    showImageModal(src, alt) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('imageModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'imageModal';
            modal.className = 'image-modal';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="closeImageModal()">
                    <div class="modal-content" onclick="event.stopPropagation()">
                        <button class="modal-close" onclick="closeImageModal()">&times;</button>
                        <img id="modalImage" src="" alt="">
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const modalImage = document.getElementById('modalImage');
        modalImage.src = src;
        modalImage.alt = alt;
        modal.style.display = 'flex';
    }

    // Utility functions
    formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        
        let date;
        if (timestamp.seconds) {
            date = new Date(timestamp.seconds * 1000);
        } else {
            date = new Date(timestamp);
        }
        
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }
}

// Global request management
let globalAbortControllers = new Map();

// Function to show temporary success message
function showSuccessMessage(message, duration = 3000) {
    try { adminMsgBox.showSuccess(message, 'Success', duration); } catch(_) {}
}

// Global functions for action buttons
function editItem(itemId) {
    // Redirect to the detailed view page for editing
    window.location.href = `/admin/found-item-details/${itemId}`;
}

function deleteItem(itemId) {
    // Show confirmation dialog
    adminConfirm('Are you sure you want to delete this item? This action cannot be undone.', {type:'error', title:'Delete Item'}).then((ok)=>{ if(!ok) return;
        // Cancel any existing delete request for this item
        const requestKey = `delete-${itemId}`;
        if (globalAbortControllers.has(requestKey)) {
            globalAbortControllers.get(requestKey).abort();
        }
        
        // Create new abort controller for this request
        const abortController = new AbortController();
        globalAbortControllers.set(requestKey, abortController);
        
        fetch(`/admin/api/found-items/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: abortController.signal
        })
        .then(async response => {
            // Check if response is OK before parsing JSON
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
                    // If JSON parsing fails, use the HTTP status message
                }
                throw new Error(errorMessage);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                alert('Item deleted successfully');
                // Reload the page to refresh the data
                window.location.reload();
            } else {
                alert('Failed to delete item: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting item:', error);
            
            // Don't show error if request was cancelled
            if (error.name === 'AbortError') {
                return;
            }
            
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                alert('Network error: Unable to connect to server. Please check your connection.');
            } else if (error.message.includes('JSON')) {
                alert('Server error: Invalid response format. Please try again.');
            } else {
                alert('Failed to delete item: ' + error.message);
            }
        })
        .finally(() => {
            // Clean up the abort controller
            globalAbortControllers.delete(requestKey);
        });
    })
}

// Status Update Modal Functions

// Helper function to fetch complete item data by ID
async function fetchItemDataById(itemId) {
    try {
        const response = await fetch(`/admin/api/found-items/${itemId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success) {
            return data.data;
        } else {
            throw new Error(data.message || 'Failed to fetch item data');
        }
    } catch (error) {
        console.error('Error fetching item data:', error);
        return null;
    }
}

async function openStatusUpdateModal(itemId, itemName, currentStatus) {
    // Set modal title and basic item info
    document.getElementById('statusModalTitle').textContent = `Update Status - ${itemName}`;
    document.getElementById('statusItemId').textContent = itemId;
    document.getElementById('statusFoundItemId').value = itemId;
    
    // Show loading state for additional details
    document.getElementById('statusItemName').textContent = 'Loading...';
    document.getElementById('statusItemCategory').textContent = 'Loading...';
    document.getElementById('statusCurrentStatus').textContent = 'Loading...';
    document.getElementById('statusIsValuable').textContent = 'Loading...';
    document.getElementById('statusLockerAssignment').textContent = 'Loading...';
    document.getElementById('statusLockerId').textContent = 'Loading...';
    document.getElementById('statusFoundDate').textContent = 'Loading...';
    
    // Hide locker ID section initially
    const lockerIdSection = document.getElementById('lockerIdSection');
    if (lockerIdSection) {
        lockerIdSection.style.display = 'none';
    }
    
    // Clear and populate status options based on current status
    const statusSelect = document.getElementById('newStatus');
    statusSelect.innerHTML = '<option value="">Select Status</option>';
    
    // Define available status transitions
    let availableStatuses = [];
    
    if (currentStatus === 'unclaimed') {
        availableStatuses = [
            { value: 'claimed', label: 'Claimed' },
            { value: 'returned', label: 'Returned' }
        ];
    } else if (currentStatus === 'overdue') {
        availableStatuses = [
            { value: 'claimed', label: 'Claimed' },
            { value: 'returned', label: 'Returned' },
            { value: 'donated', label: 'Donated' },
            { value: 'discarded', label: 'Discarded' }
        ];
    } else if (['claimed', 'returned', 'donated', 'discarded'].includes(currentStatus)) {
        alert(`Cannot update status of ${currentStatus} items. This is a final status.`);
        return;
    } else {
        alert('Invalid current status');
        return;
    }
    
    // Populate status options
    availableStatuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status.value;
        option.textContent = status.label;
        statusSelect.appendChild(option);
    });
    
    // Show modal
    const modal = document.getElementById('statusUpdateModal');
    modal.style.display = 'flex';
    
    // Add show class for animation
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
    
    // Fetch complete item data
    try {
        const itemData = await fetchItemDataById(itemId);
        
        if (itemData) {
            // Update modal with complete item information
            document.getElementById('statusItemName').textContent = itemData.found_item_name || 'N/A';
            document.getElementById('statusItemCategory').textContent = itemData.category || 'N/A';
            
            // Format current status with proper badge styling
            const currentStatusElement = document.getElementById('statusCurrentStatus');
            currentStatusElement.textContent = currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1);
            currentStatusElement.className = `detail-value status-badge status-${currentStatus}`;
            
            // Update valuable status with badge
            const valuableElement = document.getElementById('statusIsValuable');
            const isValuable = itemData.is_valuable;
            valuableElement.textContent = isValuable ? 'Yes' : 'No';
            valuableElement.className = `detail-value valuable-badge ${isValuable ? 'valuable-yes' : 'valuable-no'}`;
            
            // Update locker assignment with badge
            const isAssignedToLocker = itemData.is_assigned_to_locker;
            const lockerAssignmentElement = document.getElementById('statusLockerAssignment');
            lockerAssignmentElement.textContent = isAssignedToLocker ? 'Yes' : 'No';
            lockerAssignmentElement.className = `detail-value locker-badge ${isAssignedToLocker ? 'locker-assigned' : 'locker-not-assigned'}`;
            
            // Show/hide and update locker ID
            if (isAssignedToLocker && itemData.locker_id) {
                const lockerIdSection = document.getElementById('lockerIdSection');
                if (lockerIdSection) {
                    lockerIdSection.style.display = 'flex';
                    document.getElementById('statusLockerId').textContent = itemData.locker_id;
                }
            }
            
            // Format and display found date
            let foundDateText = 'N/A';
            if (itemData.time_found) {
                let date;
                if (itemData.time_found.seconds) {
                    // Firestore timestamp
                    date = new Date(itemData.time_found.seconds * 1000);
                } else {
                    // Regular timestamp
                    date = new Date(itemData.time_found);
                }
                
                if (!isNaN(date.getTime())) {
                    foundDateText = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
            document.getElementById('statusFoundDate').textContent = foundDateText;
        }
    } catch (error) {
        console.error('Error loading additional item details:', error);
        // Keep the loading text if fetch fails
    }
}

function closeStatusUpdateModal() {
    const modal = document.getElementById('statusUpdateModal');
    if (modal) {
        // Remove show class for smooth animation
        modal.classList.remove('show');
        
        // Wait for animation to complete before hiding
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
        
        // Reset form
        document.getElementById('statusUpdateForm').reset();
    }
}

async function submitStatusUpdate() {
    const itemId = document.getElementById('statusFoundItemId').value;
    const newStatus = document.getElementById('newStatus').value;
    
    if (!newStatus) {
        alert('Please select a status.');
        return;
    }
    
    // Show confirmation
    const statusLabels = {
        'claimed': 'Claimed',
        'returned': 'Returned', 
        'donated': 'Donated',
        'discarded': 'Discarded'
    };
    const statusLabel = statusLabels[newStatus] || newStatus;
    const okStatus = await adminConfirm(`Are you sure you want to update the status to "${statusLabel}"?`, {type:'warning', title:'Update Status'});
    if (!okStatus) { return; }
    
    // Show loading state
    const submitBtn = document.querySelector('#statusUpdateModal .btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Updating...';
    submitBtn.disabled = true;
    
    updateStatus(itemId, newStatus);
    
    // Reset button state and close modal
    setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        closeStatusUpdateModal();
    }, 1000);
}

function updateStatus(itemId, newStatus) {
    // Cancel any existing status update request for this item
    if (statusUpdateRequests[itemId]) {
        statusUpdateRequests[itemId].abort();
        delete statusUpdateRequests[itemId];
    }

    // Create new AbortController for this request
    const controller = new AbortController();
    statusUpdateRequests[itemId] = controller;

    // Show loading state in table
    const statusCell = document.querySelector(`tr[data-item-id="${itemId}"] .status-badge`);
    const originalStatus = statusCell ? statusCell.textContent : '';
    if (statusCell) {
        statusCell.textContent = 'Updating...';
        statusCell.className = 'status-badge updating';
    }

    fetch(`/admin/api/found-items/${itemId}/update-status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
        signal: controller.signal
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showMessage('Status updated successfully!', 'success');
            // Reload the page to reflect changes
            setTimeout(() => {
                location.reload();
            }, 1000);
        } else {
            throw new Error(data.message || 'Failed to update status');
        }
    })
    .catch(error => {
        if (error.name === 'AbortError') {
            console.log('Status update request was cancelled');
            return;
        }
        
        console.error('Error updating status:', error);
        showMessage('Failed to update status: ' + error.message, 'error');
        
        // Restore original status on error
        if (statusCell) {
            statusCell.textContent = originalStatus;
            statusCell.className = `status-badge ${originalStatus.toLowerCase()}`;
        }
    })
    .finally(() => {
        // Clean up the request reference
        delete statusUpdateRequests[itemId];
    });
}

function updateStatus(itemId, newStatus) {
    // Cancel any existing status update request for this item
    const requestKey = `status-${itemId}`;
    if (globalAbortControllers.has(requestKey)) {
        globalAbortControllers.get(requestKey).abort();
    }
    
    // Create new abort controller for this request
    const abortController = new AbortController();
    globalAbortControllers.set(requestKey, abortController);
    
    fetch(`/admin/api/found-items/${itemId}/update-status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
        signal: abortController.signal
    })
    .then(async response => {
        // Check if response is OK before parsing JSON
        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (e) {
                // If JSON parsing fails, use the HTTP status message
            }
            throw new Error(errorMessage);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            const statusLabels = {
                'claimed': 'Claimed',
                'returned': 'Returned',
                'donated': 'Donated',
                'discarded': 'Discarded'
            };
            const statusLabel = statusLabels[newStatus] || newStatus;
            showSuccessMessage(`Item status updated to ${statusLabel} successfully!`);
            
            // Reload the page to refresh the data after a short delay
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            alert('Failed to update status: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error updating status:', error);
        
        // Don't show error if request was cancelled
        if (error.name === 'AbortError') {
            return;
        }
        
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            alert('Network error: Unable to connect to server. Please check your connection.');
        } else if (error.message.includes('JSON')) {
            alert('Server error: Invalid response format. Please try again.');
        } else {
            alert('Failed to update status: ' + error.message);
        }
    })
    .finally(() => {
        // Clean up the abort controller
        globalAbortControllers.delete(requestKey);
    });
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Initialize the manage found items functionality when the page loads
document.addEventListener('DOMContentLoaded', function() {
    new ManageFoundItems();
});

// Add CSS for image modal
const modalStyles = `
    .image-modal {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 80%;
        max-width: 800px;
        height: 80%;
        max-height: 600px;
        z-index: 10000;
        background: rgba(0, 0, 0, 0.8);
        border-radius: 8px;
        overflow: hidden;
    }

    .modal-overlay {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    }

    .modal-content {
        position: relative;
        width: 100%;
        height: 100%;
        background: white;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal-close {
        position: absolute;
        top: 10px;
        right: 15px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        font-size: 24px;
        cursor: pointer;
        width: 35px;
        height: 35px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
        transition: background-color 0.3s ease;
    }

    .modal-close:hover {
        background: rgba(0, 0, 0, 0.9);
    }

    .modal-content img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
    }

    @media (max-width: 768px) {
        .image-modal {
            width: 95%;
            height: 70%;
            max-width: none;
            max-height: none;
        }
    }
`;

// Add the modal styles to the page
const styleSheet = document.createElement('style');
styleSheet.textContent = modalStyles;
document.head.appendChild(styleSheet);

// Admin Review Modal Functions
async function openAdminReviewModal(itemId, itemName) {
    try {
        // Title at top
        const titleEl = document.getElementById('adminReviewModalTitle');
        if (titleEl) titleEl.textContent = `Admin Review - ${itemName || 'Item'} #${itemId}`;

        // Show loading state for details
        document.getElementById('reviewItemId').textContent = itemId;
        document.getElementById('reviewItemName').textContent = 'Loading...';
        document.getElementById('reviewItemCategory').textContent = 'Loading...';
        document.getElementById('reviewCurrentStatus').textContent = 'Loading...';
        document.getElementById('reviewItemValuable').textContent = 'Loading...';
        document.getElementById('reviewItemLocker').textContent = 'Loading...';
        document.getElementById('reviewFoundDate').textContent = 'Loading...';
        
        // Fetch complete item data
        const itemData = await fetchItemDataById(itemId);
        
        if (itemData) {
            // Populate item details from Firebase-backed API
            if (titleEl) titleEl.textContent = `Admin Review - ${itemData.found_item_name || itemName || 'Item'} #${itemData.found_item_id || itemId}`;
            document.getElementById('reviewItemId').textContent = itemData.found_item_id || itemId;
            document.getElementById('reviewItemName').textContent = itemData.found_item_name || 'N/A';
            document.getElementById('reviewItemCategory').textContent = itemData.category || 'N/A';
            document.getElementById('reviewCurrentStatus').textContent = itemData.status || 'N/A';
            document.getElementById('reviewItemValuable').textContent = itemData.is_valuable ? 'Yes' : 'No';
            document.getElementById('reviewItemLocker').textContent = itemData.locker_id ? itemData.locker_id : 'Not Assigned';
            document.getElementById('reviewFoundDate').textContent = itemData.found_date || 'N/A';
        }
        
        // Set hidden field for form submission
        document.getElementById('reviewFoundItemId').value = itemId;
        
        // Show modal
        const modal = document.getElementById('adminReviewModal');
        modal.style.display = 'block';
        setTimeout(() => modal.classList.add('show'), 10);
    } catch (error) {
        console.error('Error opening admin review modal:', error);
        // Fallback to basic display
        const titleEl = document.getElementById('adminReviewModalTitle');
        if (titleEl) titleEl.textContent = itemName || 'Item';
        document.getElementById('reviewItemId').textContent = itemId;
        document.getElementById('reviewFoundItemId').value = itemId;
        const modal = document.getElementById('adminReviewModal');
        modal.style.display = 'block';
        setTimeout(() => modal.classList.add('show'), 10);
    }
}

function closeAdminReviewModal() {
    const modal = document.getElementById('adminReviewModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

async function submitAdminReview() {
    const itemId = document.getElementById('reviewFoundItemId').value; // Fixed ID reference
    const reviewStatus = document.getElementById('reviewStatus').value;
    const reviewNotes = document.getElementById('reviewNotes').value;
    
    // Validate required fields
    if (!reviewStatus) {
        alert('Please select a review status.');
        return;
    }
    
    if (!reviewNotes.trim()) {
        alert('Please provide review notes.');
        return;
    }
    
    // Status mapping for user-friendly confirmation
    const statusLabels = {
        'claimed': 'Claimed',
        'donated': 'Donated',
        'discarded': 'Discarded',
        'returned': 'Returned'
    };
    
    const statusLabel = statusLabels[reviewStatus] || reviewStatus;
    
    // Show confirmation dialog
    const okReview = await adminConfirm(`Are you sure you want to submit this admin review with status "${statusLabel}"?`, {type:'info', title:'Submit Review'});
    if (!okReview) { return; }
    
    // Show loading state
    const submitBtn = document.querySelector('#adminReviewModal .btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Processing...';
    submitBtn.disabled = true;
    
    // Submit the review
    fetch('/admin/api/admin-reviews', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            found_item_id: itemId,
            review_status: reviewStatus,
            notes: reviewNotes
        })
    })
    .then(async response => {
        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (e) {
                // If JSON parsing fails, use the HTTP status message
            }
            throw new Error(errorMessage);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showSuccessMessage(`Admin review submitted successfully with status: ${statusLabel}`);
            closeAdminReviewModal();
            // Reload the page after a short delay to allow success message to be seen
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            alert('Failed to submit review: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error submitting admin review:', error);
        alert('Failed to submit review: ' + error.message);
    })
    .finally(() => {
        // Reset button state
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    });
}

// Function to view admin review details
async function viewAdminReview(adminReviewId) {
    try {
        const response = await fetch(`/admin/api/admin-reviews/${adminReviewId}`);
        const result = await response.json();

        if (response.ok) {
            const review = result.review;
            alert(`Admin Review Details:\n\nReview ID: ${review.admin_review_id}\nStatus: ${review.review_status}\nReviewer: ${review.reviewer}\nDate: ${new Date(review.review_date).toLocaleString()}\nNotes: ${review.notes || 'No notes provided'}`);
        } else {
            alert(result.error || 'Failed to load admin review');
        }
    } catch (error) {
        console.error('Error loading admin review:', error);
        alert('An error occurred while loading the review');
    }
}
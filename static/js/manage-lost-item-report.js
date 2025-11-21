// Manage Lost Item Reports JavaScript
class ManageLostReports {
    constructor() {
        this.searchTerm = '';
        this.categoryFilter = '';
        this.statusFilter = '';
        this.locationFilter = '';
        this.sortColumn = 'created_at';
        this.sortDirection = 'desc';
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.totalItems = 0;
        this.totalPages = 0;
        this.isLoading = false;
        this.availableCategories = [];
        this.availableLocations = [];
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadLostReports();
    }

    bindEvents() {
        // Search functionality with debounce
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce((e) => {
                this.searchTerm = e.target.value.trim();
                this.currentPage = 1;
                this.loadLostReports();
            }, 300));
        }

        // Filter functionality
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.categoryFilter = e.target.value;
                this.currentPage = 1;
                this.loadLostReports();
            });
        }

        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.statusFilter = e.target.value;
                this.currentPage = 1;
                this.loadLostReports();
            });
        }

        const locationFilter = document.getElementById('locationFilter');
        if (locationFilter) {
            locationFilter.addEventListener('change', (e) => {
                this.locationFilter = e.target.value;
                this.currentPage = 1;
                this.loadLostReports();
            });
        }

        // Clear filters button
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        // Pagination event delegation
        document.addEventListener('click', (e) => {
            if (e.target.matches('.pagination-btn[data-page]')) {
                e.preventDefault();
                const page = parseInt(e.target.dataset.page);
                this.goToPage(page);
            }
        });

        // Table sorting
        document.addEventListener('click', (e) => {
            if (e.target.matches('.sortable') || e.target.closest('.sortable')) {
                const sortableElement = e.target.matches('.sortable') ? e.target : e.target.closest('.sortable');
                const column = sortableElement.dataset.sort;
                if (column) {
                    this.sortTable(column);
                }
            }
        });

        // Image modal functionality
        document.addEventListener('click', (e) => {
            if (e.target.matches('.item-image')) {
                this.showImageModal(e.target.src, e.target.alt);
            }
        });
    }

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

    async loadLostReports() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading();

        // Cancel any existing request
        if (this.currentRequest) {
            this.currentRequest.abort();
        }

        // Create new AbortController for this request
        this.currentRequest = new AbortController();

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                per_page: this.itemsPerPage,
                sort_column: this.sortColumn,
                sort_direction: this.sortDirection
            });

            // Add filters if they exist
            if (this.searchTerm) params.append('search', this.searchTerm);
            if (this.categoryFilter) params.append('category', this.categoryFilter);
            if (this.statusFilter) params.append('status', this.statusFilter);
            if (this.locationFilter) params.append('location', this.locationFilter);

            console.log('Loading lost reports with params:', params.toString());

            const response = await fetch(`/admin/api/lost-item-reports?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: this.currentRequest.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update pagination info
                this.totalItems = data.pagination.total_items;
                this.totalPages = data.pagination.total_pages;
                this.currentPage = data.pagination.current_page;
                
                // Store filter options
                this.availableCategories = data.filters?.categories || [];
                this.availableLocations = data.filters?.locations || [];
                
                console.log('Data loaded successfully:', {
                    itemsCount: data.lost_reports.length,
                    totalItems: this.totalItems,
                    totalPages: this.totalPages,
                    currentPage: this.currentPage
                });
                
                // Populate filter dropdowns (only on first load)
                if (this.currentPage === 1) {
                    this.populateFilterOptions();
                }
                
                // Render the table with current page data
                this.renderTable(data.lost_reports);
                this.renderPagination();
                this.updateItemsCount();
                this.updateResultsMessage();
                
                console.log(`Loaded page ${this.currentPage} of ${this.totalPages} (${data.lost_reports.length} items)`);
            } else {
                console.error('API returned success=false:', data);
                this.showError('Failed to load lost reports: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Request was cancelled');
                return;
            }
            
            console.error('Error loading lost reports:', error);
            this.showError('Failed to load lost reports. Please try again.');
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
        this.loadLostReports();
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
        const tableBody = document.getElementById('lostReportsTableBody');
        if (!tableBody) return;

        // Clear any existing content (including initial loading state)
        tableBody.innerHTML = '';

        if (items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>
                            <i class="fas fa-search"></i>
                            <h3>No reports found</h3>
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
        // Initialize empty similar IDs cells
        items.forEach(item => {
            const cell = document.querySelector(`tr[data-item-id="${item.lost_report_id}"] .similar-ids`);
            if (cell) cell.textContent = '-';
        });
    }

    renderTableRow(item) {
        const createdDate = this.formatDate(item.created_at);
        const reportDate = this.formatDate(item.report_date);
        const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
        const statusKey = (item.status || '').toLowerCase().replace(/\s+/g,'_');
        const isFinalStatus = ['matched', 'closed', 'expired', 'completed'].includes(statusKey);
        
        // Calculate report duration: report_date + current date (stop counting for final status)
        const reportDuration = this.calculateReportDuration(item.report_date, item.status);
        
        // Button visibility logic based on status and admin review
        const isExpired = item.status.toLowerCase() === 'expired';
        const hasBeenReviewed = item.admin_review_id && item.admin_review_id.trim() !== '';
        const showUpdateStatus = false;
        const showAdminReview = isExpired && !hasBeenReviewed;
        const showViewOnly = hasBeenReviewed;
        const showEditDelete = !isFinalStatus && !hasBeenReviewed;
        const showMatch = statusKey === 'open' || statusKey === 'in_progress';
        const showProcess = statusKey === 'open';
        const showComplete = statusKey === 'in_progress';
        
        return `
            <tr data-item-id="${item.lost_report_id}">
                <td>
                    <img src="${item.image_url || '/static/images/no-image.svg'}" 
                     alt="${item.lost_item_name}" 
                     class="item-image"
                     onerror="this.src='/static/images/no-image.svg'">
                </td>
                <td>
                    <div class="item-info">
                        <strong>${this.escapeHtml(item.lost_item_name || 'N/A')}</strong>
                        <small class="text-muted">${item.lost_report_id}</small>
                    </div>
                </td>
                <td>${this.escapeHtml(item.category || 'N/A')}</td>
                <td>${this.escapeHtml(item.last_seen_location || 'N/A')}</td>
                <td>${reportDate}</td>
                <td>
                    <span class="report-duration ${!isFinalStatus && reportDuration > 31 ? 'expired-highlight' : !isFinalStatus && reportDuration > 25 ? 'warning' : isFinalStatus ? 'closed-status' : ''}">
                        ${isFinalStatus ? `${reportDuration} (Final)` : reportDuration}
                    </span>
                </td>
                <td>
                    <span class="status-badge status-${statusKey}">
                        ${this.escapeHtml(item.status || 'unknown')}
                    </span>
                </td>
                <td class="similar-ids">-</td>
                <td>
                    <div class="action-buttons">
                        <!-- View Button - Always visible -->
                        <button class="action-btn btn-view" onclick="viewReport('${item.lost_report_id}')" title="View Report Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        
                        <!-- Match Button - Only for 'Open' reports -->
                        ${showMatch ? `
                            <button class="action-btn btn-match" 
                                    onclick="matchSimilar('${item.lost_report_id}')" 
                                    title="Match Similar Found Items">
                                <i class="fas fa-link"></i>
                            </button>
                        ` : ''}
                        
                        <!-- Update Status Button - Hidden for final statuses and expired reports -->
                        ${showProcess ? `
                            <button class="action-btn btn-status" 
                                    onclick="processReport('${item.lost_report_id}')" 
                                    title="Set In Progress">
                                <i class="fas fa-briefcase"></i>
                            </button>
                        ` : ''}
                        
                        <!-- Admin Review Button - Only for 'Expired' reports that haven't been reviewed -->
                        ${showAdminReview ? `
                            <button class="action-btn btn-review" onclick="openAdminReviewModal('${item.lost_report_id}', '${this.escapeHtml(item.lost_item_name)}')" title="Admin Review">
                                <i class="fas fa-clipboard-check"></i>
                            </button>
                        ` : ''}
                        
                        <!-- View Review Button - For reports that have been reviewed -->
                        ${showViewOnly && hasBeenReviewed ? `
                            <button class="action-btn btn-view-review" onclick="viewAdminReview('${item.admin_review_id}')" title="View Admin Review">
                                <i class="fas fa-clipboard-list"></i>
                            </button>
                        ` : ''}
                        
                        <!-- Delete Button - Hidden for final statuses and reviewed reports -->
                        ${showComplete ? `
                            <button class="action-btn btn-delete" onclick="completeReport('${item.lost_report_id}')" title="Mark as Completed">
                                <i class="fas fa-check"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    // Calculate report duration from report_date to current date
    calculateReportDuration(reportDate, status = '') {
        if (!reportDate) return 0;
        
        try {
            const reportDateObj = new Date(reportDate);
            const isFinalStatus = ['matched', 'closed', 'expired'].includes(status.toLowerCase());
            
            // For final status reports, calculate duration up to when status was changed
            // Since we don't have status change date, we'll show the duration but mark it as final
            const currentDate = new Date();
            const timeDiff = currentDate.getTime() - reportDateObj.getTime();
            const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
            
            return Math.max(0, daysDiff); // Ensure non-negative
        } catch (error) {
            console.error('Error calculating report duration:', error);
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
            resultsCount.textContent = `${this.totalItems} report${this.totalItems !== 1 ? 's' : ''} found`;
            
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
        this.loadLostReports();
        
        // Scroll to table section
        document.querySelector('.table-section').scrollIntoView({ behavior: 'smooth' });
    }

    updateItemsCount() {
        const itemsCountElement = document.getElementById('itemsCount');
        if (itemsCountElement) {
            const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
            const endItem = Math.min(this.currentPage * this.itemsPerPage, this.totalItems);
            itemsCountElement.textContent = `Showing ${startItem}-${endItem} of ${this.totalItems} reports`;
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
        this.loadLostReports();
    }

    showLoading() {
        const tableBody = document.getElementById('lostReportsTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>
                            <i class="fas fa-spinner fa-spin"></i>
                            <h3>Loading lost reports...</h3>
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
        // You can implement a toast notification or modal here
        console.error(message);
        alert(message); // Simple alert for now
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
function viewReport(reportId) {
    // Redirect to the detailed view page for viewing
    window.location.href = `/admin/lost-report-details/${reportId}`;
}

async function matchSimilar(reportId) {
    try {
        const btn = document.querySelector(`tr[data-item-id="${reportId}"] .btn-match`);
        if (btn) { btn.disabled = true; btn.classList.add('loading'); }
        const res = await fetch(`/admin/api/ai-match/${reportId}`);
        const data = await res.json();
        const cell = document.querySelector(`tr[data-item-id="${reportId}"] .similar-ids`);
        if (data.success) {
            const ids = (data.matches || []).map(m => m.found_item_id).slice(0,3);
            cell.textContent = ids.length ? ids.join(', ') : '-';
        } else {
            cell.textContent = '-';
            alert(data.error || 'No matches found');
        }
    } catch (e) {
        console.error(e);
        alert('Failed to fetch matches');
    } finally {
        const btn = document.querySelector(`tr[data-item-id="${reportId}"] .btn-match`);
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
}

function deleteReport(reportId) {
    // Show confirmation dialog
    adminConfirm('Are you sure you want to delete this report? This action cannot be undone.', {type:'error', title:'Delete Report'}).then((ok)=>{ if(!ok) return;
        // Cancel any existing delete request for this report
        const requestKey = `delete-${reportId}`;
        if (globalAbortControllers.has(requestKey)) {
            globalAbortControllers.get(requestKey).abort();
        }
        
        // Create new abort controller for this request
        const abortController = new AbortController();
        globalAbortControllers.set(requestKey, abortController);
        
        fetch(`/admin/api/lost-item-reports/${reportId}`, {
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
                alert('Report deleted successfully');
                // Reload the page to refresh the data
                window.location.reload();
            } else {
                alert('Failed to delete report: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting report:', error);
            
            // Don't show error if request was cancelled
            if (error.name === 'AbortError') {
                return;
            }
            
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                alert('Network error: Unable to connect to server. Please check your connection.');
            } else if (error.message.includes('JSON')) {
                alert('Server error: Invalid response format. Please try again.');
            } else {
                alert('Failed to delete report: ' + error.message);
            }
        })
        .finally(() => {
            // Clean up the abort controller
            globalAbortControllers.delete(requestKey);
        });
    })
}

async function processReport(reportId) {
    try {
        const row = document.querySelector(`tr[data-item-id="${reportId}"]`);
        const statusEl = row?.querySelector('.status-badge');
        const current = (statusEl?.textContent || '').toLowerCase().replace(/\s+/g,'_');
        if (current === 'in_progress') { alert('Already in progress'); return; }
        const res = await fetch(`/admin/api/lost-item-reports/${reportId}/status`,{
            method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status:'In Progress' })
        });
        const data = await res.json();
        if (data.success) { showSuccessMessage('Report set to In Progress'); setTimeout(()=>window.location.reload(),800); }
        else alert(data.error||'Failed to update');
    } catch(e){ console.error(e); alert('Failed to update'); }
}

async function completeReport(reportId) {
    try {
        const ok = await adminConfirm('Mark this report as Completed? This will hide it from the list.', {type:'warning', title:'Mark as Completed'}); if (!ok) { return; }
        const res = await fetch(`/admin/api/lost-item-reports/${reportId}/status`,{
            method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status:'Completed' })
        });
        const data = await res.json();
        if (data.success) { showSuccessMessage('Report marked Completed'); setTimeout(()=>window.location.reload(),800); }
        else alert(data.error||'Failed to update');
    } catch(e){ console.error(e); alert('Failed to update'); }
}

// Status Update Modal Functions

// Helper function to fetch complete report data by ID
async function fetchReportDataById(reportId) {
    try {
        const response = await fetch(`/admin/api/lost-item-reports/${reportId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success) {
            return data.data;
        } else {
            throw new Error(data.message || 'Failed to fetch report data');
        }
    } catch (error) {
        console.error('Error fetching report data:', error);
        return null;
    }
}

async function openStatusUpdateModal(reportId, itemName, currentStatus) {
    // Set modal title and basic report info
    document.getElementById('statusModalTitle').textContent = `Update Status - ${itemName}`;
    document.getElementById('statusItemId').textContent = reportId;
    document.getElementById('statusLostReportId').value = reportId;
    
    // Show loading state for additional details
    document.getElementById('statusItemName').textContent = 'Loading...';
    document.getElementById('statusItemCategory').textContent = 'Loading...';
    document.getElementById('statusCurrentStatus').textContent = 'Loading...';
    document.getElementById('statusReportDate').textContent = 'Loading...';
    document.getElementById('statusLastSeenLocation').textContent = 'Loading...';
    
    // Clear and populate status options based on current status
    const statusSelect = document.getElementById('newStatus');
    statusSelect.innerHTML = '<option value="">Select Status</option>';
    
    // Define available status transitions for lost reports
    let availableStatuses = [];
    
    if (currentStatus === 'open') {
        availableStatuses = [
            { value: 'matched', label: 'Matched' },
            { value: 'closed', label: 'Closed' }
        ];
    } else if (currentStatus === 'expired') {
        availableStatuses = [
            { value: 'matched', label: 'Matched' },
            { value: 'closed', label: 'Closed' }
        ];
    } else if (['matched', 'closed'].includes(currentStatus)) {
        alert(`Cannot update status of ${currentStatus} reports. This is a final status.`);
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
    
    // Fetch complete report data
    try {
        const reportData = await fetchReportDataById(reportId);
        
        if (reportData) {
            // Update modal with complete report information
            document.getElementById('statusItemName').textContent = reportData.lost_item_name || 'N/A';
            document.getElementById('statusItemCategory').textContent = reportData.category || 'N/A';
            
            // Format current status with proper badge styling
            const currentStatusElement = document.getElementById('statusCurrentStatus');
            currentStatusElement.textContent = currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1);
            currentStatusElement.className = `detail-value status-badge status-${currentStatus}`;
            
            // Update last seen location
            document.getElementById('statusLastSeenLocation').textContent = reportData.last_seen_location || 'N/A';
            
            // Format and display report date
            let reportDateText = 'N/A';
            if (reportData.report_date) {
                let date;
                if (reportData.report_date.seconds) {
                    // Firestore timestamp
                    date = new Date(reportData.report_date.seconds * 1000);
                } else {
                    // Regular timestamp
                    date = new Date(reportData.report_date);
                }
                
                if (!isNaN(date.getTime())) {
                    reportDateText = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
            document.getElementById('statusReportDate').textContent = reportDateText;
        }
    } catch (error) {
        console.error('Error loading additional report details:', error);
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
    const reportId = document.getElementById('statusLostReportId').value;
    const newStatus = document.getElementById('newStatus').value;
    
    if (!newStatus) {
        alert('Please select a status.');
        return;
    }
    
    // Show confirmation
    const statusLabels = {
        'matched': 'Matched',
        'closed': 'Closed'
    };
    const statusLabel = statusLabels[newStatus] || newStatus;
    
    const okStatus = await adminConfirm(`Are you sure you want to update the status to "${statusLabel}"?`, {type:'warning', title:'Update Status'});
    if (!okStatus) { return; }
    
    // Show loading state
    const submitBtn = document.querySelector('#statusUpdateModal .btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Updating...';
    submitBtn.disabled = true;
    
    updateReportStatus(reportId, newStatus);
    
    // Reset button state and close modal
    setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        closeStatusUpdateModal();
    }, 1000);
}

function updateReportStatus(reportId, newStatus) {
    // Cancel any existing status update request for this report
    const requestKey = `status-${reportId}`;
    if (globalAbortControllers.has(requestKey)) {
        globalAbortControllers.get(requestKey).abort();
    }
    
    // Create new abort controller for this request
    const abortController = new AbortController();
    globalAbortControllers.set(requestKey, abortController);
    
    fetch(`/admin/api/lost-item-reports/${reportId}/status`, {
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
                'matched': 'Matched',
                'closed': 'Closed'
            };
            const statusLabel = statusLabels[newStatus] || newStatus;
            showSuccessMessage(`Report status updated to ${statusLabel} successfully!`);
            
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

// Initialize the manage lost reports functionality when the page loads
document.addEventListener('DOMContentLoaded', function() {
    new ManageLostReports();
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
async function openAdminReviewModal(reportId, itemName) {
    try {
        // Title at top
        const titleEl = document.getElementById('adminReviewModalTitle');
        if (titleEl) titleEl.textContent = `Admin Review - ${itemName || 'Report'} #${reportId}`;

        // Show loading state for details
        document.getElementById('reviewItemId').textContent = reportId;
        document.getElementById('reviewItemName').textContent = 'Loading...';
        document.getElementById('reviewItemCategory').textContent = 'Loading...';
        document.getElementById('reviewCurrentStatus').textContent = 'Loading...';
        document.getElementById('reviewReportDate').textContent = 'Loading...';
        document.getElementById('reviewLastSeenLocation').textContent = 'Loading...';
        
        // Fetch complete report data
        const reportData = await fetchReportDataById(reportId);
        
        if (reportData) {
            // Populate report details from Firebase-backed API
            if (titleEl) titleEl.textContent = `Admin Review - ${reportData.lost_item_name || itemName || 'Report'} #${reportData.lost_report_id || reportId}`;
            document.getElementById('reviewItemId').textContent = reportData.lost_report_id || reportId;
            document.getElementById('reviewItemName').textContent = reportData.lost_item_name || 'N/A';
            document.getElementById('reviewItemCategory').textContent = reportData.category || 'N/A';
            document.getElementById('reviewCurrentStatus').textContent = reportData.status || 'N/A';
            document.getElementById('reviewReportDate').textContent = reportData.report_date || 'N/A';
            document.getElementById('reviewLastSeenLocation').textContent = reportData.last_seen_location || 'N/A';
        }
        
        // Set hidden field for form submission
        document.getElementById('reviewLostReportId').value = reportId;
        
        // Show modal
        const modal = document.getElementById('adminReviewModal');
        modal.style.display = 'block';
        setTimeout(() => modal.classList.add('show'), 10);
    } catch (error) {
        console.error('Error opening admin review modal:', error);
        // Fallback to basic display
        const titleEl = document.getElementById('adminReviewModalTitle');
        if (titleEl) titleEl.textContent = itemName || 'Report';
        document.getElementById('reviewItemId').textContent = reportId;
        document.getElementById('reviewLostReportId').value = reportId;
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
    const reportId = document.getElementById('reviewLostReportId').value;
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
        'matched': 'Matched',
        'closed': 'Closed'
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
    fetch('/admin/api/lost-report-reviews', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            lost_report_id: reportId,
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
        const response = await fetch(`/admin/api/lost-report-reviews/${adminReviewId}`);
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
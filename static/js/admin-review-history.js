/**
 * Admin Review History Page JavaScript
 * Handles display and management of admin reviews
 */

class AdminReviewHistory {
    constructor() {
        this.currentPage = 1;
        this.perPage = 20;
        this.totalItems = 0;
        this.reviews = [];
        this.searchTerm = '';
        this.statusFilter = '';
        this.sortField = '';
        this.sortDirection = 'asc';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadReviews();
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('search-input');
        const clearSearchBtn = document.getElementById('clear-search');
        const searchBtn = document.getElementById('search-btn');
        const resetBtn = document.getElementById('reset-btn');
        const statusFilter = document.getElementById('status-filter');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.trim();
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = this.searchTerm ? 'block' : 'none';
                }
            });

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.searchTerm = '';
                clearSearchBtn.style.display = 'none';
                this.performSearch();
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.performSearch();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetFilters();
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.statusFilter = e.target.value;
                this.performSearch();
            });
        }

        // Setup sorting event listeners
        this.setupSortingListeners();

        // Pagination event listeners will be set up when pagination is rendered
    }

    performSearch() {
        this.currentPage = 1; // Reset to first page when searching
        this.loadReviews();
    }

    resetFilters() {
        const searchInput = document.getElementById('search-input');
        const statusFilter = document.getElementById('status-filter');
        const clearSearchBtn = document.getElementById('clear-search');

        if (searchInput) searchInput.value = '';
        if (statusFilter) statusFilter.value = '';
        if (clearSearchBtn) clearSearchBtn.style.display = 'none';

        this.searchTerm = '';
        this.statusFilter = '';
        this.currentPage = 1;
        this.loadReviews();
    }

    async loadReviews() {
        try {
            this.showLoading(true);

            const params = new URLSearchParams({
                page: this.currentPage,
                per_page: this.perPage
            });

            // Add search and filter parameters if they exist
            if (this.searchTerm) {
                params.append('search', this.searchTerm);
            }
            if (this.statusFilter) {
                params.append('status', this.statusFilter);
            }
            if (this.sortField) {
                params.append('sort_by', this.sortField);
                params.append('sort_order', this.sortDirection);
            }

            console.log('Loading reviews with params:', params.toString());
            const response = await fetch(`/admin/api/admin-reviews?${params}`);
            console.log('Response status:', response.status);
            
            const data = await response.json();
            console.log('Response data:', data);

            if (data.success) {
                this.reviews = data.reviews || [];
                this.totalItems = data.count || 0;
                console.log('Loaded reviews:', this.reviews.length, 'Total items:', this.totalItems);
                this.renderReviews();
                this.renderPagination();
            } else {
                throw new Error(data.error || 'Failed to load reviews');
            }
        } catch (error) {
            console.error('Error loading reviews:', error);
            this.showError('Failed to load admin reviews. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    showLoading(show) {
        const loadingSpinner = document.getElementById('loading-spinner');
        const tableContainer = document.getElementById('itemsTableContainer');
        
        if (loadingSpinner) {
            loadingSpinner.style.display = show ? 'block' : 'none';
        }
        
        if (tableContainer) {
            tableContainer.style.display = show ? 'none' : 'block';
        }
        
        // Show loading message in table body when loading
        const tableBody = document.getElementById('itemsTableBody');
        if (tableBody && show) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>
                            <i class="fas fa-spinner fa-spin"></i>
                            <h3>Loading admin reviews...</h3>
                            <p>Please wait while we fetch the data</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    showError(message) {
        const tableBody = document.getElementById('reviews-table-body');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="no-data">
                        <div class="no-data-message">
                            <i class="fas fa-exclamation-triangle"></i>
                            <p>${message}</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    renderReviews() {
        const tbody = document.getElementById('itemsTableBody');
        if (!tbody) {
            console.error('Reviews table body not found');
            return;
        }

        console.log('Rendering reviews:', this.reviews.length, 'total');

        if (this.reviews.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-4">
                        <div class="text-gray-500">
                            <i class="fas fa-inbox fa-2x mb-2"></i>
                            <p>No reviews match your criteria</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.reviews.map(review => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${review.review_id || 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${review.found_item_id || 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <a href="/admin/found-item-details/${review.found_item_id}" 
                       class="item-name-link text-blue-600 hover:text-blue-800 hover:underline font-medium">
                        ${review.item_name || 'Unknown Item'}
                    </a>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${this.getStatusClass(review.status)}">
                        ${this.formatStatus(review.status)}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${review.reviewed_by_name || review.reviewed_by || 'Unknown'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${this.formatDate(review.review_date)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title="${review.notes || ''}">
                    ${this.truncateText(review.notes || 'No notes', 50)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button onclick="adminReviewHistory.viewReview('${review.found_item_id}')" 
                            class="text-indigo-600 hover:text-indigo-900 mr-3">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `).join('');
    }

    getStatusClass(status) {
        const statusMap = {
            'donated': 'donated',
            'discarded': 'discarded',
            'returned': 'returned',
            'extend_storage': 'extended',
            'claimed': 'returned'
        };
        return statusMap[status] || 'default';
    }

    formatStatus(status) {
        const statusMap = {
            'donated': 'Donated',
            'discarded': 'Discarded',
            'returned': 'Returned',
            'extend_storage': 'Extended Storage',
            'claimed': 'Claimed'
        };
        return statusMap[status] || status;
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } catch (error) {
            return 'Invalid Date';
        }
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    renderPagination() {
        const paginationContainer = document.getElementById('pagination-container');
        if (!paginationContainer) return;

        const totalPages = Math.ceil(this.totalItems / this.perPage);
        
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
            return;
        }

        paginationContainer.style.display = 'flex';

        const startItem = (this.currentPage - 1) * this.perPage + 1;
        const endItem = Math.min(this.currentPage * this.perPage, this.totalItems);

        paginationContainer.innerHTML = `
            <div class="pagination-info">
                Showing ${startItem}-${endItem} of ${this.totalItems} reviews
            </div>
            <div class="pagination-controls">
                <button class="pagination-btn" id="prev-btn" ${this.currentPage <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
                <div class="page-numbers" id="page-numbers"></div>
                <button class="pagination-btn" id="next-btn" ${this.currentPage >= totalPages ? 'disabled' : ''}>
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;

        // Add page numbers
        this.renderPageNumbers(totalPages);

        // Add event listeners for pagination
        document.getElementById('prev-btn')?.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadReviews();
            }
        });

        document.getElementById('next-btn')?.addEventListener('click', () => {
            if (this.currentPage < totalPages) {
                this.currentPage++;
                this.loadReviews();
            }
        });
    }

    renderPageNumbers(totalPages) {
        const pageNumbersContainer = document.getElementById('page-numbers');
        if (!pageNumbersContainer) return;

        let startPage = Math.max(1, this.currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        let pageNumbersHtml = '';
        
        for (let i = startPage; i <= endPage; i++) {
            pageNumbersHtml += `
                <button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" 
                        onclick="adminReviewHistory.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        pageNumbersContainer.innerHTML = pageNumbersHtml;
    }

    goToPage(page) {
        this.currentPage = page;
        this.loadReviews();
    }

    // Navigate to found item details page
    viewReview(foundItemId) {
        if (foundItemId) {
            window.location.href = `/admin/found-item-details/${foundItemId}`;
        } else {
            console.error('Found item ID is required');
            alert('Unable to view item details: Item ID not found');
        }
    }

    async viewReviewDetails(reviewId) {
        try {
            const response = await fetch(`/admin/api/admin-reviews/${reviewId}`);
            const data = await response.json();

            if (data.success) {
                this.showReviewModal(data.review);
            } else {
                throw new Error(data.error || 'Failed to load review details');
            }
        } catch (error) {
            console.error('Error loading review details:', error);
            alert('Failed to load review details. Please try again.');
        }
    }

    showReviewModal(review) {
        // Create modal HTML
        const modalHtml = `
            <div class="modal fade" id="reviewDetailsModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Review Details - ${review.review_id}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <strong>Review ID:</strong><br>
                                    <span class="review-id">${review.review_id}</span>
                                </div>
                                <div class="col-md-6">
                                    <strong>Found Item ID:</strong><br>
                                    <span class="item-id">${review.found_item_id}</span>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-md-6">
                                    <strong>Item Name:</strong><br>
                                    ${review.item_name || 'N/A'}
                                </div>
                                <div class="col-md-6">
                                    <strong>Review Status:</strong><br>
                                    <span class="status-badge status-${this.getStatusClass(review.review_status)}">
                                        ${this.formatStatus(review.review_status)}
                                    </span>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-md-6">
                                    <strong>Reviewed By:</strong><br>
                                    ${review.reviewed_by_name || 'Unknown'}
                                </div>
                                <div class="col-md-6">
                                    <strong>Review Date:</strong><br>
                                    ${this.formatDate(review.created_at)}
                                </div>
                            </div>
                            <hr>
                            <div>
                                <strong>Notes:</strong><br>
                                <div class="review-notes-full">${review.notes || 'No notes provided'}</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('reviewDetailsModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('reviewDetailsModal'));
        modal.show();

        // Clean up modal when hidden
        document.getElementById('reviewDetailsModal').addEventListener('hidden.bs.modal', function () {
            this.remove();
        });
    }

    setupSortingListeners() {
        const sortableHeaders = document.querySelectorAll('.sortable');
        sortableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const sortField = header.getAttribute('data-sort');
                this.handleSort(sortField);
            });
        });
    }

    handleSort(field) {
        if (this.sortField === field) {
            // Toggle sort direction if same field
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            // New field, default to ascending
            this.sortField = field;
            this.sortDirection = 'asc';
        }

        // Update UI to show sort state
        this.updateSortUI();
        
        // Reset to first page and reload
        this.currentPage = 1;
        this.loadReviews();
    }

    updateSortUI() {
        // Remove all sort classes
        const sortableHeaders = document.querySelectorAll('.sortable');
        sortableHeaders.forEach(header => {
            header.classList.remove('sort-asc', 'sort-desc');
        });

        // Add sort class to current sorted column
        if (this.sortField) {
            const currentHeader = document.querySelector(`[data-sort="${this.sortField}"]`);
            if (currentHeader) {
                currentHeader.classList.add(`sort-${this.sortDirection}`);
            }
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.adminReviewHistory = new AdminReviewHistory();
});
/**
 * My QR Code JavaScript - Handles QR code display and management
 */

class MyQRCodeManager {
    constructor() {
        this.qrCodes = [];
        this.currentQR = null;
        
        this.init();
    }

    /**
     * Initialize the QR code manager
     */
    init() {
        this.bindEvents();
        this.loadQRCodes();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshQRCodes());
        }

        // Modal events
        const modal = document.getElementById('qrModal');
        const closeButtons = document.querySelectorAll('.modal-close');
        const downloadBtn = document.getElementById('downloadQRBtn');
        
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.closeModal());
        });
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadQRCode());
        }

        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
    }

    /**
     * Load QR codes from the API
     */
    async loadQRCodes() {
        try {
            this.showLoading();
            
            const response = await fetch('/api/qr/user/active', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.qrCodes = data.qr_codes || [];
                this.updateStats();
                this.renderQRCodes();
            } else {
                throw new Error(data.message || 'Failed to load QR codes');
            }
            
        } catch (error) {
            console.error('Error loading QR codes:', error);
            this.showError('Failed to load QR codes. Please try again.');
            this.showEmptyState();
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Refresh QR codes
     */
    async refreshQRCodes() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('loading');
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refreshing...';
        }

        try {
            await this.loadQRCodes();
            this.showSuccess('QR codes refreshed successfully');
        } catch (error) {
            this.showError('Failed to refresh QR codes');
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('loading');
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh QR Codes';
            }
        }
    }

    /**
     * Render QR codes
     */
    renderQRCodes() {
        const container = document.getElementById('qrCodesGrid');
        
        if (!container) return;

        if (this.qrCodes.length === 0) {
            this.showEmptyState();
            return;
        }

        container.innerHTML = this.qrCodes.map(qr => this.createQRCard(qr)).join('');
        container.style.display = 'grid';
        
        // Bind QR card events
        this.bindQRCardEvents();
    }

    /**
     * Create HTML for a QR code card
     */
    createQRCard(qr) {
        const isExpiringSoon = this.isExpiringSoon(qr.expires_at);
        const status = this.getQRStatus(qr);
        const statusClass = status.toLowerCase();
        
        // Format dates
        const generatedDate = this.formatDate(qr.created_at);
        const expiryDate = this.formatDate(qr.expires_at);
        const timeRemaining = this.getTimeRemaining(qr.expires_at);

        return `
            <div class="qr-card ${isExpiringSoon ? 'expiring-soon' : ''}" data-qr-id="${qr.id}">
                <div class="qr-header">
                    <div class="qr-status ${statusClass}">
                        <i class="fas fa-${this.getStatusIcon(status)}"></i>
                        ${status}
                    </div>
                    <h3 class="qr-title">${this.escapeHtml(qr.item_name || 'Unknown Item')}</h3>
                </div>
                
                <div class="qr-body">
                    <div class="qr-display">
                        ${qr.qr_image_url ? 
                            `<img src="${qr.qr_image_url}" alt="QR Code" class="qr-image" onclick="qrManager.showQRModal('${qr.id}')">` : 
                            '<div class="qr-placeholder"><i class="fas fa-qrcode"></i></div>'
                        }
                    </div>
                    
                    <div class="qr-metadata">
                        <div class="qr-detail-row">
                            <span class="qr-detail-label">Token:</span>
                            <span class="qr-detail-value qr-token">${this.truncateToken(qr.qr_token)}</span>
                        </div>
                        
                        <div class="qr-detail-row">
                            <span class="qr-detail-label">Generated:</span>
                            <span class="qr-detail-value">${generatedDate}</span>
                        </div>
                        
                        <div class="qr-detail-row">
                            <span class="qr-detail-label">Expires:</span>
                            <span class="qr-detail-value">${expiryDate}</span>
                        </div>
                        
                        <div class="qr-detail-row">
                            <span class="qr-detail-label">Time Left:</span>
                            <span class="qr-detail-value" style="color: ${isExpiringSoon ? '#856404' : 'var(--text-dark)'}">
                                ${timeRemaining}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="qr-footer">
                    <button class="btn btn-primary" onclick="qrManager.showQRModal('${qr.id}')">
                        <i class="fas fa-eye"></i>
                        View Details
                    </button>
                    <button class="btn btn-secondary" onclick="qrManager.downloadQRCode('${qr.id}')">
                        <i class="fas fa-download"></i>
                        Download
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Bind QR card events
     */
    bindQRCardEvents() {
        // Events are handled via onclick attributes for simplicity
        // This ensures proper context binding
    }

    /**
     * Show QR code modal
     */
    showQRModal(qrId) {
        const qr = this.qrCodes.find(q => q.id == qrId);
        if (!qr) return;

        this.currentQR = qr;

        // Populate modal content
        const modal = document.getElementById('qrModal');
        const modalImage = document.getElementById('modalQRImage');
        const modalItemName = document.getElementById('modalItemName');
        const modalToken = document.getElementById('modalToken');
        const modalGenerated = document.getElementById('modalGenerated');
        const modalExpires = document.getElementById('modalExpires');
        const modalStatus = document.getElementById('modalStatus');
        
        if (modalImage && qr.qr_image_url) {
            modalImage.src = qr.qr_image_url;
            modalImage.alt = `QR Code for ${qr.item_name}`;
        }
        
        if (modalItemName) modalItemName.textContent = qr.item_name || 'Unknown Item';
        if (modalToken) modalToken.textContent = qr.qr_token || 'N/A';
        if (modalGenerated) modalGenerated.textContent = this.formatDate(qr.created_at);
        if (modalExpires) modalExpires.textContent = this.formatDate(qr.expires_at);
        if (modalStatus) modalStatus.textContent = this.getQRStatus(qr);
        
        // Show modal
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Close modal
     */
    closeModal() {
        const modal = document.getElementById('qrModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
        this.currentQR = null;
    }

    /**
     * Download QR code
     */
    async downloadQRCode(qrId = null) {
        const qr = qrId ? this.qrCodes.find(q => q.id == qrId) : this.currentQR;
        if (!qr || !qr.qr_image_url) {
            this.showError('QR code image not available for download');
            return;
        }

        try {
            // Create download link
            const link = document.createElement('a');
            link.href = qr.qr_image_url;
            link.download = `qr-code-${qr.item_name || 'item'}-${qr.qr_token.substring(0, 8)}.png`;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showSuccess('QR code downloaded successfully');
            
        } catch (error) {
            console.error('Error downloading QR code:', error);
            this.showError('Failed to download QR code');
        }
    }

    /**
     * Update statistics display
     */
    updateStats() {
        const activeCount = this.qrCodes.length;
        const expiringCount = this.qrCodes.filter(qr => this.isExpiringSoon(qr.expires_at)).length;

        const activeElement = document.getElementById('activeQRCount');
        const expiringElement = document.getElementById('expiringCount');

        if (activeElement) activeElement.textContent = activeCount;
        if (expiringElement) expiringElement.textContent = expiringCount;
    }

    /**
     * Get QR status
     */
    getQRStatus(qr) {
        const now = new Date();
        const expiryDate = new Date(qr.expires_at);
        
        if (expiryDate <= now) {
            return 'Expired';
        } else if (this.isExpiringSoon(qr.expires_at)) {
            return 'Expiring';
        } else {
            return 'Active';
        }
    }

    /**
     * Check if QR code is expiring soon (within 24 hours)
     */
    isExpiringSoon(expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const timeDiff = expiry - now;
        const hoursRemaining = timeDiff / (1000 * 60 * 60);
        
        return hoursRemaining > 0 && hoursRemaining <= 24;
    }

    /**
     * Get time remaining until expiry
     */
    getTimeRemaining(expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const timeDiff = expiry - now;
        
        if (timeDiff <= 0) {
            return 'Expired';
        }
        
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    /**
     * Truncate token for display
     */
    truncateToken(token) {
        if (!token) return 'N/A';
        return token.length > 12 ? `${token.substring(0, 8)}...${token.substring(token.length - 4)}` : token;
    }

    /**
     * Show loading state
     */
    showLoading() {
        const loadingState = document.getElementById('loadingState');
        const qrCodesGrid = document.getElementById('qrCodesGrid');
        const emptyState = document.getElementById('emptyState');
        
        if (loadingState) loadingState.style.display = 'block';
        if (qrCodesGrid) qrCodesGrid.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        const loadingState = document.getElementById('loadingState');
        
        if (loadingState) loadingState.style.display = 'none';
    }

    /**
     * Show empty state
     */
    showEmptyState() {
        const emptyState = document.getElementById('emptyState');
        const qrCodesGrid = document.getElementById('qrCodesGrid');
        
        if (emptyState) emptyState.style.display = 'block';
        if (qrCodesGrid) qrCodesGrid.style.display = 'none';
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
     * Show message with type
     */
    showMessage(message, type = 'info') {
        const container = document.getElementById('messageContainer');
        if (!container) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `
            <i class="fas fa-${this.getMessageIcon(type)}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;

        container.appendChild(messageDiv);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 5000);
    }

    /**
     * Get status icon
     */
    getStatusIcon(status) {
        const icons = {
            'active': 'check-circle',
            'expiring': 'clock',
            'expired': 'times-circle'
        };
        return icons[status.toLowerCase()] || 'qrcode';
    }

    /**
     * Get message icon
     */
    getMessageIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * Format date for display
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get authentication token
     */
    getAuthToken() {
        // This should be implemented based on your authentication system
        return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
    }
}

// Global instance for onclick handlers
let qrManager;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    qrManager = new MyQRCodeManager();
});

// Export for potential use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MyQRCodeManager;
}
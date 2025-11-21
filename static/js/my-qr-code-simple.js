/**
 * My QR Code Simple - Focuses only on active QR code with countdown and download
 */

class SimpleQRCodeManager {
    constructor() {
        this.activeQR = null;
        this.countdownInterval = null;
        
        this.init();
    }

    /**
     * Initialize the QR code manager
     */
    init() {
        this.bindEvents();
        this.loadActiveQR();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Refresh button
        const refreshBtn = document.getElementById('refreshActiveQRBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshActiveQR());
        }

        // Download button
        const downloadBtn = document.getElementById('downloadActiveQRBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadActiveQR());
        }
    }

    /**
     * Load active QR code from the API
     */
    async loadActiveQR() {
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
            
            if (data.success && data.qr_codes && data.qr_codes.length > 0) {
                // Get the most recent active QR code
                this.activeQR = data.qr_codes[0];
                this.renderActiveQR();
            } else {
                this.showEmptyState();
            }
            
        } catch (error) {
            console.error('Error loading active QR code:', error);
            this.showEmptyState();
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Refresh active QR code
     */
    async refreshActiveQR() {
        const refreshBtn = document.getElementById('refreshActiveQRBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Refreshing...';
        }

        try {
            await this.loadActiveQR();
        } catch (error) {
            console.error('Error refreshing QR code:', error);
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
            }
        }
    }

    /**
     * Render active QR code
     */
    renderActiveQR() {
        if (!this.activeQR) return;

        const container = document.getElementById('activeQRContainer');
        const qrImage = document.getElementById('activeQRImage');
        const qrTitle = document.getElementById('activeQRTitle');
        const qrItemName = document.getElementById('activeQRItemName');
        const qrGenerated = document.getElementById('activeQRGenerated');
        const qrExpires = document.getElementById('activeQRExpires');

        if (!container || !qrImage) return;

        // Set QR image
        if (this.activeQR.qr_image_url) {
            qrImage.src = this.activeQR.qr_image_url;
            qrImage.alt = `QR Code for ${this.activeQR.item_name || 'item'}`;
        }

        // Set metadata
        if (qrTitle) qrTitle.textContent = this.activeQR.item_name || 'Your Active QR Code';
        if (qrItemName) qrItemName.textContent = this.activeQR.item_name || 'Unknown Item';
        if (qrGenerated) qrGenerated.textContent = this.formatDate(this.activeQR.created_at);
        if (qrExpires) qrExpires.textContent = this.formatDate(this.activeQR.expires_at);

        // Show container
        container.style.display = 'block';

        // Start countdown
        this.startCountdown(this.activeQR.expires_at);
    }

    /**
     * Start countdown timer
     */
    startCountdown(expiresAt) {
        // Clear existing interval
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }

        const countdownEl = document.getElementById('qrCountdown');
        if (!countdownEl) return;

        const tick = () => {
            const now = Date.now();
            const expires = new Date(expiresAt).getTime();
            const ms = Math.max(0, expires - now);
            
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            
            countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            // Update color based on time remaining
            if (ms <= 60000) { // Less than 1 minute
                countdownEl.style.color = '#dc3545'; // Red
            } else if (ms <= 300000) { // Less than 5 minutes
                countdownEl.style.color = '#ffc107'; // Yellow
            } else {
                countdownEl.style.color = '#28a745'; // Green
            }
            
            if (ms <= 0) {
                clearInterval(this.countdownInterval);
                this.handleQRExpired();
            }
        };

        // Initial tick
        tick();
        
        // Update every second
        this.countdownInterval = setInterval(tick, 1000);
    }

    /**
     * Handle QR code expiration
     */
    handleQRExpired() {
        const countdownEl = document.getElementById('qrCountdown');
        if (countdownEl) {
            countdownEl.textContent = '00:00';
            countdownEl.style.color = '#dc3545';
        }

        // Disable download button
        const downloadBtn = document.getElementById('downloadActiveQRBtn');
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fas fa-download"></i> Expired';
        }

        // Show expired message
        const statusEl = document.querySelector('.qr-status.active');
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Expired';
            statusEl.classList.remove('active');
            statusEl.classList.add('expired');
        }
    }

    /**
     * Download active QR code
     */
    async downloadActiveQR() {
        if (!this.activeQR || !this.activeQR.qr_image_url) {
            this.showError('No QR code available for download');
            return;
        }

        try {
            // Create download link with proper filename
            const link = document.createElement('a');
            link.href = this.activeQR.qr_image_url;
            
            // Generate filename with item name and timestamp
            const itemName = this.activeQR.item_name || 'item';
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const token = this.activeQR.qr_token ? this.activeQR.qr_token.substring(0, 8) : '';
            
            link.download = `qreclaim-${itemName.toLowerCase().replace(/\s+/g, '-')}-${token}-${timestamp}.png`;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (error) {
            console.error('Error downloading QR code:', error);
            this.showError('Failed to download QR code');
        }
    }

    /**
     * Show loading state
     */
    showLoading() {
        const loadingState = document.getElementById('loadingState');
        const activeContainer = document.getElementById('activeQRContainer');
        const emptyState = document.getElementById('emptyState');
        
        if (loadingState) loadingState.style.display = 'block';
        if (activeContainer) activeContainer.style.display = 'none';
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
        const activeContainer = document.getElementById('activeQRContainer');
        
        if (emptyState) emptyState.style.display = 'block';
        if (activeContainer) activeContainer.style.display = 'none';
        
        // Clear countdown if no QR
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
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
     * Get authentication token
     */
    getAuthToken() {
        return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
    }

    /**
     * Show error message
     */
    showError(message) {
        // Simple error display - could be enhanced with toast notifications
        console.error('QR Code Error:', message);
        alert(message); // Fallback for now
    }
}

// Global instance
let qrManager;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    qrManager = new SimpleQRCodeManager();
});
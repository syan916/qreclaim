/**
 * Temporary Message Box Utility
 * Displays temporary notification messages to users
 */

class MessageBox {
    constructor() {
        this.container = null;
        this.activeMessages = new Set();
        this.init();
    }

    init() {
        // Create container for messages if it doesn't exist
        if (!document.getElementById('message-container')) {
            this.container = document.createElement('div');
            this.container.id = 'message-container';
            this.container.style.cssText = `
                position: fixed;
                top: 0;
                right: 0;
                z-index: 10000;
                pointer-events: none;
            `;
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('message-container');
        }
    }

    /**
     * Show a success message
     * @param {string} message - The message text
     * @param {string} title - Optional title
     * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
     */
    showSuccess(message, title = 'Success', duration = 5000) {
        return this.show(message, 'success', title, duration);
    }

    /**
     * Show an error message
     * @param {string} message - The message text
     * @param {string} title - Optional title
     * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
     */
    showError(message, title = 'Error', duration = 7000) {
        return this.show(message, 'error', title, duration);
    }

    /**
     * Show a warning message
     * @param {string} message - The message text
     * @param {string} title - Optional title
     * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
     */
    showWarning(message, title = 'Warning', duration = 6000) {
        return this.show(message, 'warning', title, duration);
    }

    /**
     * Show an info message
     * @param {string} message - The message text
     * @param {string} title - Optional title
     * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
     */
    showInfo(message, title = 'Info', duration = 5000) {
        return this.show(message, 'info', title, duration);
    }

    /**
     * Show a message with specified type
     * @param {string} message - The message text
     * @param {string} type - Message type (success, error, warning, info)
     * @param {string} title - Optional title
     * @param {number} duration - Auto-hide duration in milliseconds (0 = no auto-hide)
     */
    show(message, type = 'info', title = '', duration = 5000) {
        const messageId = this.generateId();
        const messageElement = this.createMessageElement(messageId, message, type, title);
        
        // Add to container
        this.container.appendChild(messageElement);
        this.activeMessages.add(messageId);

        // Trigger show animation
        setTimeout(() => {
            messageElement.classList.add('show');
        }, 10);

        // Auto-hide if duration is specified
        if (duration > 0) {
            setTimeout(() => {
                this.hide(messageId);
            }, duration);
        }

        return messageId;
    }

    /**
     * Hide a specific message
     * @param {string} messageId - The message ID to hide
     */
    hide(messageId) {
        const messageElement = document.getElementById(`message-${messageId}`);
        if (messageElement && this.activeMessages.has(messageId)) {
            messageElement.classList.add('fade-out');
            
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.parentNode.removeChild(messageElement);
                }
                this.activeMessages.delete(messageId);
            }, 300);
        }
    }

    /**
     * Hide all active messages
     */
    hideAll() {
        this.activeMessages.forEach(messageId => {
            this.hide(messageId);
        });
    }

    /**
     * Create message element
     */
    createMessageElement(messageId, message, type, title) {
        const messageElement = document.createElement('div');
        messageElement.id = `message-${messageId}`;
        messageElement.className = `message-box ${type}`;
        messageElement.style.pointerEvents = 'auto';

        const icon = this.getIcon(type);
        
        messageElement.innerHTML = `
            <div class="message-box-icon">${icon}</div>
            <div class="message-box-content">
                ${title ? `<div class="message-box-title">${this.escapeHtml(title)}</div>` : ''}
                <div class="message-box-text">${this.escapeHtml(message)}</div>
            </div>
            <button class="message-box-close" onclick="messageBox.hide('${messageId}')" aria-label="Close message">
                <i class="fas fa-times"></i>
            </button>
        `;

        return messageElement;
    }

    /**
     * Get icon for message type
     */
    getIcon(type) {
        const icons = {
            success: '<i class="fas fa-check-circle"></i>',
            error: '<i class="fas fa-exclamation-circle"></i>',
            warning: '<i class="fas fa-exclamation-triangle"></i>',
            info: '<i class="fas fa-info-circle"></i>'
        };
        return icons[type] || icons.info;
    }

    /**
     * Generate unique ID for messages
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
const messageBox = new MessageBox();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MessageBox;
}
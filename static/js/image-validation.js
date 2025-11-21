/**
 * Shared Image Validation Module
 * Provides client-side image validation with server-side rule synchronization
 */

class ImageValidator {
    constructor() {
        this.rules = {
            minAspectRatio: 0.5,
            maxAspectRatio: 2.0,
            maxFileSize: 15 * 1024 * 1024, // 15MB
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png'],
            allowedExtensions: ['jpg', 'jpeg', 'png'],
            minResolution: { width: 200, height: 200 },
            maxResolution: { width: 6000, height: 6000 }
        };
        
        this.loadServerRules();
    }

    /**
     * Load validation rules from server to ensure consistency
     */
    async loadServerRules() {
        try {
            const response = await fetch('/api/validation/image-rules');
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.rules) {
                    this.rules = { ...this.rules, ...data.rules };
                }
            }
        } catch (error) {
            console.warn('Failed to load server validation rules, using defaults:', error);
        }
    }

    /**
     * Validate a single image file
     * @param {File} file - The image file to validate
     * @returns {Promise<{isValid: boolean, message: string}>}
     */
    async validateImageFile(file) {
        // Check file type
        if (!this.rules.allowedTypes.includes(file.type)) {
            return {
                isValid: false,
                message: `Invalid file type. Only ${this.rules.allowedExtensions.join(', ').toUpperCase()} files are allowed.`
            };
        }

        // Check file extension
        const extension = file.name.split('.').pop().toLowerCase();
        if (!this.rules.allowedExtensions.includes(extension)) {
            return {
                isValid: false,
                message: `Invalid file extension. Only ${this.rules.allowedExtensions.join(', ').toUpperCase()} files are allowed.`
            };
        }

        // Check file size
        if (file.size > this.rules.maxFileSize) {
            const maxSizeMB = this.rules.maxFileSize / (1024 * 1024);
            return {
                isValid: false,
                message: `File size too large. Maximum allowed size is ${maxSizeMB}MB.`
            };
        }

        // Check image dimensions and aspect ratio
        try {
            const dimensions = await this.getImageDimensions(file);
            
            // Check minimum resolution
            if (dimensions.width < this.rules.minResolution.width || 
                dimensions.height < this.rules.minResolution.height) {
                return {
                    isValid: false,
                    message: `Image resolution too low. Minimum required: ${this.rules.minResolution.width}x${this.rules.minResolution.height}px.`
                };
            }

            // Check maximum resolution
            if (dimensions.width > this.rules.maxResolution.width || 
                dimensions.height > this.rules.maxResolution.height) {
                return {
                    isValid: false,
                    message: `Image resolution too high. Maximum allowed: ${this.rules.maxResolution.width}x${this.rules.maxResolution.height}px.`
                };
            }

            // Check aspect ratio
            const aspectRatio = dimensions.width / dimensions.height;
            if (aspectRatio < this.rules.minAspectRatio || aspectRatio > this.rules.maxAspectRatio) {
                return {
                    isValid: false,
                    message: `Invalid aspect ratio. Image should be between 3:4 and 3:2 ratio (current: ${aspectRatio.toFixed(2)}).`
                };
            }

            return { isValid: true, message: 'Image validation passed.' };

        } catch (error) {
            return {
                isValid: false,
                message: 'Failed to read image file. Please ensure it\'s a valid image.'
            };
        }
    }

    /**
     * Get image dimensions from file
     * @param {File} file - The image file
     * @returns {Promise<{width: number, height: number}>}
     */
    getImageDimensions(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = function() {
                URL.revokeObjectURL(url);
                resolve({
                    width: this.naturalWidth,
                    height: this.naturalHeight
                });
            };

            img.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };

            img.src = url;
        });
    }

    /**
     * Validate multiple image files
     * @param {FileList|Array} files - Array of image files to validate
     * @returns {Promise<Array<{file: File, isValid: boolean, message: string}>>}
     */
    async validateMultipleFiles(files) {
        const results = [];
        
        for (const file of files) {
            const validation = await this.validateImageFile(file);
            results.push({
                file: file,
                isValid: validation.isValid,
                message: validation.message
            });
        }
        
        return results;
    }

    /**
     * Show validation error message to user
     * @param {string} message - Error message to display
     * @param {string} containerId - ID of container to show message in
     */
    showValidationError(message, containerId = 'validation-messages') {
        const container = document.getElementById(containerId);
        if (!container) {
            alert(message); // Fallback to alert if container not found
            return;
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'validation-error';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <span>${message}</span>
            <button type="button" class="close-error" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(errorDiv);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.remove();
            }
        }, 5000);
    }

    /**
     * Clear all validation messages
     * @param {string} containerId - ID of container to clear messages from
     */
    clearValidationMessages(containerId = 'validation-messages') {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = '';
        }
    }

    /**
     * Get validation rules for display
     * @returns {Object} Current validation rules
     */
    getValidationRules() {
        return { ...this.rules };
    }
}

// Create global instance
window.imageValidator = new ImageValidator();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageValidator;
}
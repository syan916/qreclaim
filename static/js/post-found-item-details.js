/**
 * Post Found Item Details JavaScript
 * Handles loading and displaying detailed information about a found item
 */

class FoundItemDetails {
    constructor() {
        this.itemId = null;
        this.itemData = null;
        this.isLoading = false;
        this.isEditMode = false;
        this.originalData = null;
        // Properties for manual tag editing
        this.editableTags = [];
        this.aiGeneratedTags = new Set();
        // Properties for locker management
        this.availableLockers = [];
        // Properties for venue management
        this.venues = [];
        this.uploadedImages = []; // Add uploaded images array
    }

    init() {
        // Extract item ID from URL
        this.itemId = this.extractItemIdFromUrl();
        
        if (!this.itemId) {
            this.showError('Invalid item ID');
            return;
        }

        // Setup UI event handlers for editing
        this.setupEditingHandlers();
        this.setupImageUpload(); // Add image upload setup

        // Load item details
        this.loadItemDetails();
    }

    extractItemIdFromUrl() {
        const pathParts = window.location.pathname.split('/');
        return pathParts[pathParts.length - 1];
    }

    async loadItemDetails() {
        if (this.isLoading) return;

        this.isLoading = true;
        this.showLoading(true);
        this.hideError();

        try {
            const response = await fetch(`/admin/api/found-items/${this.itemId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.itemData = data.data;
                this.originalData = JSON.parse(JSON.stringify(data.data)); // Deep copy
                this.displayItemDetails();
            } else {
                throw new Error(data.message || 'Failed to load item details');
            }
        } catch (error) {
            console.error('Error loading item details:', error);
            this.showError(error.message || 'Failed to load item details');
        } finally {
            this.isLoading = false;
            // Ensure loading overlay is hidden with a small delay to prevent race conditions
            setTimeout(() => {
                this.showLoading(false);
            }, 100);
        }
    }

    displayItemDetails() {
        if (!this.itemData) {
            console.error('No item data available to display');
            return;
        }

        const item = this.itemData;
        console.log('Displaying item details:', item);

        // Update page title
        document.title = `QReclaim - ${item.found_item_name || 'Found Item'} Details`;

        // Check if item status is final (cannot be edited/deleted)
        const isFinalStatus = ['claimed', 'returned', 'donated', 'discarded'].includes(item.status.toLowerCase());
        
        // Hide/show edit and delete buttons based on status
        this.toggleActionButtons(!isFinalStatus);

        // Display basic information
        this.setElementText('itemId', item.found_item_id);
        this.setElementText('itemName', item.found_item_name);
        this.setElementText('itemCategory', item.category);
        this.setElementText('itemDescription', item.description);

        // Set form values for edit mode
        this.setInputValue('itemNameEdit', item.found_item_name);
        this.setSelectValue('itemCategoryEdit', item.category);
        this.setSelectValue('itemStatusEdit', item.status);
        this.setTextareaValue('itemDescriptionEdit', item.description);
        this.setDateTimeValue('timeFoundEdit', item.time_found);
        
        // Set venue selector values
        this.setVenueValue(item.place_found);
        
        // Set new editable fields
        this.setInputValue('imageUrlEdit', item.image_url);
        
        // Make image URL field read-only
        const imageUrlField = document.getElementById('imageUrlEdit');
        if (imageUrlField) {
            imageUrlField.readOnly = true;
            imageUrlField.setAttribute('readonly', 'readonly');
        }
        
        // Initialize editable tags from item data
        this.editableTags = Array.isArray(item.tags) ? [...item.tags] : [];
        this.renderEditableTags();
        
        this.setSelectValue('isValuableEdit', item.is_valuable ? 'true' : 'false');
        
        // Load and sync locker assignment
        this.syncLockerAssignment(item.locker_id);
        
        this.setTextareaValue('remarksEdit', item.remarks);

        // Set category badge
        const categoryElement = document.getElementById('itemCategory');
        if (categoryElement) {
            categoryElement.className = 'category-badge display-mode';
        }

        // Set status badge with appropriate class
        const statusElement = document.getElementById('itemStatus');
        if (statusElement) {
            statusElement.textContent = item.status || 'unknown';
            statusElement.className = `status-badge status-${item.status || 'unknown'} display-mode`;
        }

        // Display location and time information
        this.setElementText('placeFound', item.place_found);
        this.setElementText('timeFound', this.formatDate(item.time_found));
        this.setElementText('datePosted', this.formatDate(item.created_at));
        this.setElementText('lastUpdated', this.formatDate(item.updated_at));

        // Display item image
        const imageElement = document.getElementById('itemImage');
        if (imageElement) {
            imageElement.src = item.image_url || '/static/images/no-image.svg';
        imageElement.alt = item.found_item_name || 'Found Item';
        imageElement.onerror = function() {
            this.src = '/static/images/no-image.svg';
        };
        }

        // Display AI tags if available
        if (item.tags && Array.isArray(item.tags)) {
            this.displayTags(item.tags);
        }

        // Display additional details
        this.setElementText('isValuable', item.is_valuable ? 'Yes' : 'No');
        this.setElementText('lockerId', item.locker_id || 'Not assigned');
        this.setElementText('remarks', item.remarks || 'No remarks');

        // Display admin information
        this.setElementText('adminName', item.uploaded_by || 'Unknown');
        this.setElementText('adminEmail', item.uploaded_by_email || 'Unknown');
        this.setElementText('adminPhone', item.uploaded_by_mobile || 'Not provided');
        this.setElementText('adminDepartment', item.uploaded_by_department || 'Not specified');

        // Display claim information if item is claimed
        if (item.status === 'claimed' && item.claim_info) {
            this.displayClaimInformation(item.claim_info, item.claim_info.claimed_at);
        }

        // Show the content
        const contentElement = document.getElementById('itemDetailsContent');
        if (contentElement) {
            contentElement.style.display = 'block';
            console.log('Content element shown');
        } else {
            console.error('Content element not found');
        }
        
        // Ensure loading overlay is hidden
        this.showLoading(false);
        console.log('Loading overlay hidden');
    }

    /**
     * Toggle visibility of edit and delete action buttons
     * @param {boolean} show - Whether to show the buttons
     */
    toggleActionButtons(show) {
        const editBtn = document.getElementById('editBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        
        if (editBtn) {
            editBtn.style.display = show ? 'inline-block' : 'none';
        }
        
        if (deleteBtn) {
            deleteBtn.style.display = show ? 'inline-block' : 'none';
        }
        
        // If buttons are hidden and we're in edit mode, exit edit mode
        if (!show && this.isEditMode) {
            this.exitEditMode();
        }
    }

    setInputValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.value = value || '';
        }
    }

    setSelectValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.value = value || '';
        }
    }

    setTextareaValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.value = value || '';
        }
    }

    setDateTimeValue(elementId, timestamp) {
        const element = document.getElementById(elementId);
        if (element && timestamp) {
            let date;
            
            // Handle different timestamp formats
            if (timestamp.seconds) {
                // Firestore timestamp format
                date = new Date(timestamp.seconds * 1000);
            } else if (timestamp._seconds) {
                // Alternative Firestore timestamp format
                date = new Date(timestamp._seconds * 1000);
            } else {
                // Regular timestamp or date string
                date = new Date(timestamp);
            }
            
            // Check if the date is valid before converting to ISO string
            if (!isNaN(date.getTime())) {
                const localDateTime = date.toISOString().slice(0, 16);
                element.value = localDateTime;
            } else {
                // If date is invalid, clear the input
                element.value = '';
                console.warn(`Invalid timestamp for ${elementId}:`, timestamp);
            }
        } else if (element) {
            // Clear the input if no timestamp provided
            element.value = '';
        }
    }

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        
        if (this.isEditMode) {
            this.enterEditMode();
        } else {
            this.exitEditMode();
        }
    }

    enterEditMode() {
        // Hide display elements and show edit elements
        const displayElements = document.querySelectorAll('.display-mode');
        const editElements = document.querySelectorAll('.edit-mode');
        
        displayElements.forEach(el => el.style.display = 'none');
        editElements.forEach(el => el.style.display = 'block');

        // Add editing state class for potential CSS toggles
        document.body.classList.add('editing');
        
        // Make image URL field read-only
        const imageUrlField = document.getElementById('imageUrlEdit');
        if (imageUrlField) {
            imageUrlField.readOnly = true;
            imageUrlField.setAttribute('readonly', 'readonly');
        }
        
        // Update buttons
        const editBtn = document.getElementById('editBtn');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    }

    exitEditMode() {
        // Show display elements and hide edit elements
        const displayElements = document.querySelectorAll('.display-mode');
        const editElements = document.querySelectorAll('.edit-mode');
        
        displayElements.forEach(el => {
            // Use appropriate display value based on element type
            if (el.tagName === 'DIV') {
                el.style.display = 'block';
            } else {
                el.style.display = 'inline-block';
            }
        });
        editElements.forEach(el => el.style.display = 'none');
        
        // Remove editing state class
        document.body.classList.remove('editing');
        
        // Make image URL field read-only again
        const imageUrlField = document.getElementById('imageUrlEdit');
        if (imageUrlField) {
            imageUrlField.readOnly = true;
            imageUrlField.setAttribute('readonly', 'readonly');
        }
        
        // Update buttons
        const editBtn = document.getElementById('editBtn');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        if (editBtn) editBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        // Clear uploaded images if not saved
        if (this.uploadedImages && this.uploadedImages.length > 0) {
            this.uploadedImages = [];
            this.updateImagePreview();
            this.updateMainImageDisplay();
        }
        
        // Clear any validation errors
        this.clearValidationErrors();
    }

    cancelEdit() {
        // Restore original values
        if (this.originalData) {
            this.setInputValue('itemNameEdit', this.originalData.found_item_name);
            this.setSelectValue('itemCategoryEdit', this.originalData.category);
            this.setSelectValue('itemStatusEdit', this.originalData.status);
            this.setTextareaValue('itemDescriptionEdit', this.originalData.description);
            // Venue/custom place
            this.setInputValue('place_found', this.originalData.place_found);
            this.setDateTimeValue('timeFoundEdit', this.originalData.time_found);
            
            // Restore new editable fields
            this.setInputValue('imageUrlEdit', this.originalData.image_url);
            this.editableTags = Array.isArray(this.originalData.tags) ? this.originalData.tags.slice() : [];
            this.renderEditableTags();
            this.setSelectValue('isValuableEdit', this.originalData.is_valuable ? 'true' : 'false');
            this.setSelectValue('locker_id', this.originalData.locker_id);
            this.setTextareaValue('remarksEdit', this.originalData.remarks);
        }
        
        this.isEditMode = false;
        this.exitEditMode();
    }

    async saveItem() {
        if (!this.validateForm()) {
            return;
        }

        const saveBtn = document.getElementById('saveBtn');
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;

        try {
            // Get form data as object
            const updatedData = this.getFormData();
            
            // Handle image upload with base64 encoding (similar to post-found-item)
            if (this.uploadedImages && this.uploadedImages.length > 0) {
                this.showNotification('Processing images...', 'info');
                
                // Convert the first uploaded image to base64 (same as post-found-item)
                const firstImage = this.uploadedImages[0];
                const base64Image = await this.convertImageToBase64(firstImage);
                updatedData.image_url = base64Image;
                
                this.showNotification('Images processed successfully!', 'success');
            }
            
            const response = await fetch(`/admin/api/found-items/${this.itemId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatedData)
            });

            const data = await response.json();

            if (data.success) {
                // Clear uploaded images array after successful save
                this.uploadedImages = [];
                this.updateImagePreview();
                
                // Update the item data and original data
                this.itemData = { ...this.itemData, ...updatedData };
                this.originalData = JSON.parse(JSON.stringify(this.itemData));
                
                // Update display elements
                this.updateDisplayElements(updatedData);
                
                // Update the main image display to show the new image
                this.updateMainImageDisplay();
                
                // Exit edit mode
                this.isEditMode = false;
                this.exitEditMode();
                
                // Show success message
                this.showNotification('Item updated successfully!', 'success');
            } else {
                throw new Error(data.message || 'Failed to update item');
            }
        } catch (error) {
            console.error('Error updating item:', error);
            this.showNotification('Failed to update item: ' + error.message, 'error');
        } finally {
            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;
        }
    }

    // Convert image file to base64 data URL (same format as post-found-item)
    async convertImageToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                // Compress and resize image if needed
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Calculate new dimensions (max 800px on longest side)
                    const maxSize = 800;
                    let { width, height } = img;
                    
                    if (width > height) {
                        if (width > maxSize) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    
                    // Draw and compress image
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                    resolve(compressedBase64);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    getFormData() {
        const timeFoundInput = document.getElementById('timeFoundEdit').value;
        let timeFoundTimestamp = null;
        
        if (timeFoundInput) {
            // Send as datetime string (consistent with create form)
            timeFoundTimestamp = timeFoundInput;
        } else if (this.itemData && this.itemData.time_found) {
            // Preserve original time_found if user didn't change it
            timeFoundTimestamp = this.itemData.time_found;
        }

        // Tags from editableTags array
        const tags = Array.isArray(this.editableTags) ? this.editableTags.slice() : [];

        // Place found from venue selector or custom input
        const venueSelect = document.getElementById('venue_select');
        const placeFoundInput = document.getElementById('place_found');
        let placeFoundValue = '';
        if (placeFoundInput && placeFoundInput.style.display !== 'none' && placeFoundInput.value?.trim()) {
            placeFoundValue = placeFoundInput.value.trim();
        } else if (venueSelect && venueSelect.value) {
            placeFoundValue = venueSelect.value;
        } else if (this.itemData?.place_found) {
            // Fallback to original place found if no new value is selected
            placeFoundValue = this.itemData.place_found;
        }

        // Locker assignment
        const isAssigned = document.getElementById('is_assigned_to_locker')?.checked;
        const lockerIdVal = document.getElementById('locker_id')?.value || '';
        const locker_id = isAssigned ? lockerIdVal : '';

        return {
            found_item_name: document.getElementById('itemNameEdit')?.value?.trim() || '',
            category: document.getElementById('itemCategoryEdit')?.value || '',
            status: document.getElementById('itemStatusEdit')?.value || '',
            description: document.getElementById('itemDescriptionEdit')?.value?.trim() || '',
            place_found: placeFoundValue,
            time_found: timeFoundTimestamp,
            image_url: this.itemData?.image_url || '', // Use existing image URL instead of non-existent input
            tags: tags,
            is_valuable: document.getElementById('isValuableEdit')?.value === 'true',
            locker_id: locker_id,
            remarks: document.getElementById('remarksEdit')?.value?.trim() || ''
        };
    }

    updateDisplayElements(updatedData) {
        this.setElementText('itemName', updatedData.found_item_name);
        this.setElementText('itemCategory', updatedData.category);
        this.setElementText('itemDescription', updatedData.description);
        this.setElementText('placeFound', updatedData.place_found);
        
        if (updatedData.time_found) {
            this.setElementText('timeFound', this.formatDate(updatedData.time_found));
        }

        // Update status badge
        const statusElement = document.getElementById('itemStatus');
        if (statusElement) {
            statusElement.textContent = updatedData.status;
            statusElement.className = `status-badge status-${updatedData.status} display-mode`;
        }

        // Update category badge
        const categoryElement = document.getElementById('itemCategory');
        if (categoryElement) {
            categoryElement.className = 'category-badge display-mode';
        }

        // Update last updated time
        this.setElementText('lastUpdated', this.formatDate(new Date()));
    }

    validateForm() {
        let isValid = true;
        this.clearValidationErrors();

        // Validate item name
        const itemName = document.getElementById('itemNameEdit').value.trim();
        if (!itemName) {
            this.showFieldError('itemNameEdit', 'Item name is required');
            isValid = false;
        }

        // Validate category
        const category = document.getElementById('itemCategoryEdit').value;
        if (!category) {
            this.showFieldError('itemCategoryEdit', 'Category is required');
            isValid = false;
        }

        // Validate status
        const status = document.getElementById('itemStatusEdit').value;
        if (!status) {
            this.showFieldError('itemStatusEdit', 'Status is required');
            isValid = false;
        }

        // Validate tags (minimum one tag required)
        if (!this.editableTags || this.editableTags.length === 0) {
            this.showError('At least one tag is required. Please add tags to describe the item.');
            isValid = false;
        }

        // Validate image (at least one image required)
        const hasOriginalImage = this.itemData && this.itemData.image_url;
        const hasUploadedImages = this.uploadedImages && this.uploadedImages.length > 0;
        if (!hasOriginalImage && !hasUploadedImages) {
            this.showError('At least one image is required. Please upload an image of the item.');
            isValid = false;
        }

        // Validate place found (from venue/custom)
        const venueSelect = document.getElementById('venue_select');
        const placeFoundInput = document.getElementById('place_found');
        const placeFound = (placeFoundInput && placeFoundInput.style.display !== 'none') 
            ? placeFoundInput.value.trim() 
            : (venueSelect ? venueSelect.value.trim() : '');
        if (!placeFound) {
            // Prefer highlighting the visible input
            if (placeFoundInput && placeFoundInput.style.display !== 'none') {
                this.showFieldError('place_found', 'Place found is required');
            } else if (venueSelect) {
                this.showFieldError('venue_select', 'Place found is required');
            }
            isValid = false;
        }

        // Validate valuables field immutability when assigned to locker
        const isValuableEdit = document.getElementById('isValuableEdit');
        const isAssignedToLocker = document.getElementById('is_assigned_to_locker');
        if (this.originalData && this.originalData.is_assigned_to_locker && 
            this.originalData.is_valuable !== (isValuableEdit.value === 'true')) {
            this.showFieldError('isValuableEdit', 'Cannot change valuable status when item is assigned to a locker');
            isValid = false;
        }

        // Validate locker ID selection when assigning to locker
        if (isAssignedToLocker && isAssignedToLocker.checked) {
            const lockerSelect = document.getElementById('locker_id');
            if (!lockerSelect || !lockerSelect.value) {
                this.showFieldError('locker_id', 'Please select a locker when assigning item to locker');
                isValid = false;
            }
        }

        // Validate locker changes - only allow if empty lockers are available
        const currentLockerId = this.originalData ? this.originalData.locker_id : null;
        const newLockerId = document.getElementById('locker_id') ? document.getElementById('locker_id').value : null;
        
        if (currentLockerId && newLockerId && currentLockerId !== newLockerId) {
            // Check if there are available lockers for reassignment
            if (!this.availableLockers || this.availableLockers.length === 0) {
                this.showFieldError('locker_id', 'No empty lockers available for reassignment');
                isValid = false;
            }
        }

        return isValid;
    }

    showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.add('error');
            
            // Create or update error message
            let errorMsg = field.parentNode.querySelector('.error-message-field');
            if (!errorMsg) {
                errorMsg = document.createElement('span');
                errorMsg.className = 'error-message-field';
                field.parentNode.appendChild(errorMsg);
            }
            errorMsg.textContent = message;
        }
    }

    clearFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.remove('error');
            
            // Remove error message
            const errorMsg = field.parentNode.querySelector('.error-message-field');
            if (errorMsg) {
                errorMsg.remove();
            }
        }
    }

    clearValidationErrors() {
        const errorFields = document.querySelectorAll('.form-input.error, .form-select.error, .form-textarea.error');
        errorFields.forEach(field => field.classList.remove('error'));
        
        const errorMessages = document.querySelectorAll('.error-message-field');
        errorMessages.forEach(msg => msg.remove());
    }

    showSuccessMessage(message) {
        if (typeof messageBox !== 'undefined') {
            messageBox.showSuccess(message);
        } else {
            // Fallback to existing success display
            const successDiv = document.createElement('div');
            successDiv.className = 'success-message';
            successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
            successDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #27ae60;
                color: white;
                padding: 12px 20px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            
            document.body.appendChild(successDiv);
            
            // Remove after 3 seconds
            setTimeout(() => {
                if (successDiv.parentNode) {
                    successDiv.parentNode.removeChild(successDiv);
                }
            }, 3000);
        }
    }

    displayTags(tags) {
        const tagsContainer = document.getElementById('aiTags');
        if (!tagsContainer) return;

        if (!tags || tags.length === 0) {
            tagsContainer.innerHTML = '<div class="no-tags">No AI tags available</div>';
            return;
        }

        const tagsHTML = tags.map(tag => `
            <span class="tag-item">
                <i class="fas fa-tag"></i>
                ${this.escapeHtml(tag)}
            </span>
        `).join('');

        tagsContainer.innerHTML = tagsHTML;
    }

    displayClaimInformation(claimer, claimDate) {
        const claimSection = document.getElementById('claimSection');
        if (!claimSection) return;

        this.setElementText('claimerName', claimer.name);
        this.setElementText('claimerEmail', claimer.email);
        this.setElementText('claimerPhone', claimer.phone);
        this.setElementText('claimDate', this.formatDate(claimDate));
        
        // Set verification status
        const verificationElement = document.getElementById('verificationStatus');
        if (verificationElement) {
            verificationElement.textContent = 'Verified';
            verificationElement.className = 'verification-badge';
        }

        claimSection.style.display = 'block';
    }

    setElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text || 'N/A';
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return 'N/A';

        let date;
        if (timestamp.seconds) {
            // Firestore timestamp
            date = new Date(timestamp.seconds * 1000);
        } else {
            // Regular timestamp
            date = new Date(timestamp);
        }

        if (isNaN(date.getTime())) return 'N/A';

        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading(show) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            if (show) {
                loadingOverlay.style.display = 'flex';
                // Ensure it's on top and blocking interactions
                loadingOverlay.style.position = 'fixed';
                loadingOverlay.style.zIndex = '9999';
                console.log('Loading overlay shown');
            } else {
                loadingOverlay.style.display = 'none';
                // Remove any inline styles that might interfere
                loadingOverlay.style.position = '';
                loadingOverlay.style.zIndex = '';
                console.log('Loading overlay hidden');
            }
        } else {
            console.error('Loading overlay element not found');
        }
    }

    showError(message) {
        if (typeof messageBox !== 'undefined') {
            messageBox.showError(message);
        } else {
            // Fallback to existing error display
            const errorElement = document.getElementById('errorMessage');
            const errorText = document.getElementById('errorText');
            
            if (errorElement && errorText) {
                errorText.textContent = message;
                errorElement.style.display = 'flex';
            } else {
                // Create temporary error message if no error element exists
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
                errorDiv.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #e74c3c;
                    color: white;
                    padding: 12px 20px;
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 10000;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;
                
                document.body.appendChild(errorDiv);
                
                // Remove after 5 seconds
                setTimeout(() => {
                    if (errorDiv.parentNode) {
                        errorDiv.parentNode.removeChild(errorDiv);
                    }
                }, 5000);
            }
        }
    }

    hideError() {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        console.log('showNotification called:', message, type); // Debug log
        console.log('messageBox available:', typeof messageBox !== 'undefined'); // Debug log
        console.log('messageBox object:', window.messageBox); // Debug log
        
        // Ensure messageBox is available
        if (typeof messageBox !== 'undefined' && messageBox) {
            console.log('Using messageBox for notification'); // Debug log
            try {
                switch(type) {
                    case 'success':
                        messageBox.showSuccess(message);
                        break;
                    case 'error':
                        messageBox.showError(message);
                        break;
                    case 'warning':
                        messageBox.showWarning(message);
                        break;
                    case 'info':
                    default:
                        messageBox.showInfo(message);
                        break;
                }
            } catch (error) {
                console.error('Error showing messageBox:', error);
                this.showFallbackNotification(message, type);
            }
        } else {
            console.log('messageBox not available, using fallback'); // Debug log
            this.showFallbackNotification(message, type);
        }
    }

    showFallbackNotification(message, type) {
        // Create a temporary notification element
        const notification = document.createElement('div');
        notification.className = `temp-notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        const colors = {
            success: '#27ae60',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    // Setup UI event handlers for tag editing and locker management
    setupEditingHandlers() {
        // Load venues for the venue selector
        this.loadVenues();
        
        // Tag input and add button
        const tagInput = document.getElementById('tagInput');
        const addTagBtn = document.getElementById('addTagBtn');
        
        if (tagInput && addTagBtn) {
            addTagBtn.addEventListener('click', () => {
                const tagValue = tagInput.value.trim();
                if (tagValue) {
                    this.addTag(tagValue);
                    tagInput.value = '';
                }
            });

            tagInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const tagValue = tagInput.value.trim();
                    if (tagValue) {
                        this.addTag(tagValue);
                        tagInput.value = '';
                    }
                }
            });
        }

        // Time found validation - prevent future dates
        const timeFoundInput = document.getElementById('timeFoundEdit');
        if (timeFoundInput) {
            // Set max attribute to current date and time
            const now = new Date();
            const maxDateTime = now.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:MM
            timeFoundInput.setAttribute('max', maxDateTime);
            
            // Add event listener for real-time validation
            timeFoundInput.addEventListener('change', (e) => {
                const selectedDateTime = new Date(e.target.value);
                const currentDateTime = new Date();
                
                if (selectedDateTime > currentDateTime) {
                    this.showFieldError('timeFoundEdit', 'Time found cannot be in the future');
                    e.target.value = ''; // Clear the invalid value
                } else {
                    this.clearFieldError('timeFoundEdit');
                }
            });
        }

        // Locker assignment checkbox
        const lockerCheckbox = document.getElementById('is_assigned_to_locker');
        const lockerSelection = document.getElementById('locker-selection');
        
        if (lockerCheckbox && lockerSelection) {
            lockerCheckbox.addEventListener('change', () => {
                if (lockerCheckbox.checked) {
                    lockerSelection.style.display = 'block';
                    this.loadAvailableLockers();
                } else {
                    lockerSelection.style.display = 'none';
                }
            });
        }
    }

    // Add a tag to the editable tags array
    addTag(tag, isAI = false) {
        if (!this.editableTags.includes(tag)) {
            this.editableTags.push(tag);
            if (isAI) {
                this.aiGeneratedTags.add(tag);
            }
            this.renderEditableTags();
        }
    }

    // Remove a tag from the editable tags array
    removeTag(tag) {
        const index = this.editableTags.indexOf(tag);
        if (index > -1) {
            this.editableTags.splice(index, 1);
            this.aiGeneratedTags.delete(tag);
            this.renderEditableTags();
        }
    }

    // Clear all tags
    clearAllTags() {
        this.editableTags = [];
        this.aiGeneratedTags.clear();
        this.renderEditableTags();
    }

    // Render the editable tags display
    renderEditableTags() {
        const tagsDisplay = document.getElementById('tagsDisplay');
        if (!tagsDisplay) return;

        tagsDisplay.innerHTML = '';
        
        this.editableTags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag-item';
            
            // Add AI indicator if it's an AI-generated tag
            if (this.aiGeneratedTags.has(tag)) {
                tagElement.classList.add('ai-tag');
            }
            
            tagElement.innerHTML = `
                ${this.escapeHtml(tag)}
                <button type="button" class="remove-tag" onclick="foundItemDetails.removeTag('${this.escapeHtml(tag)}')" title="Remove tag">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            tagsDisplay.appendChild(tagElement);
        });
    }

    // Load available lockers from API
    async loadAvailableLockers(currentLockerId = null) {
        try {
            const response = await fetch('/admin/api/available-lockers');
            const data = await response.json();
            
            if (response.ok && data.lockers) {
                this.availableLockers = data.lockers;
                this.populateLockerDropdown(currentLockerId);
            } else {
                console.error('Failed to load available lockers:', data.error);
            }
        } catch (error) {
            console.error('Error loading available lockers:', error);
        }
    }

    // Populate the locker dropdown with available lockers
    populateLockerDropdown(currentLockerId = null) {
        const lockerSelect = document.getElementById('locker_id');
        if (!lockerSelect) return;

        lockerSelect.innerHTML = '<option value="">Select a locker</option>';
        
        // Add current locker first if it exists (even if not in available list)
        if (currentLockerId) {
            const currentOption = document.createElement('option');
            currentOption.value = currentLockerId;
            currentOption.textContent = `Current Locker: ${currentLockerId}`;
            currentOption.selected = true;
            lockerSelect.appendChild(currentOption);
        }
        
        // Add available lockers
        this.availableLockers.forEach(locker => {
            // Skip if this is the current locker (already added above)
            if (currentLockerId && locker.id === currentLockerId) {
                return;
            }
            
            const option = document.createElement('option');
            option.value = locker.id;
            option.textContent = locker.name;
            lockerSelect.appendChild(option);
        });
        
        // Set the current locker as selected if it exists
        if (currentLockerId) {
            lockerSelect.value = currentLockerId;
        }
    }

    // Sync locker assignment UI with current locker ID
    syncLockerAssignment(lockerId) {
        const lockerCheckbox = document.getElementById('is_assigned_to_locker');
        const lockerSelection = document.getElementById('locker-selection');
        const lockerSelect = document.getElementById('locker_id');
        const lockerLabel = document.querySelector('label[for="is_assigned_to_locker"]');
        
        if (lockerId) {
            // Item is already assigned to a locker
            if (lockerCheckbox) {
                lockerCheckbox.checked = true;
                lockerCheckbox.disabled = false; // Allow unchecking to reassign
            }
            if (lockerSelection) lockerSelection.style.display = 'block';
            if (lockerLabel) {
                lockerLabel.innerHTML = '<i class="fas fa-exchange-alt"></i> Reassign to Different Locker?';
            }
            this.loadAvailableLockers(lockerId).then(() => {
                if (lockerSelect) lockerSelect.value = lockerId;
            });
        } else {
            // Item is not assigned to any locker
            if (lockerCheckbox) {
                lockerCheckbox.checked = false;
                lockerCheckbox.disabled = false;
            }
            if (lockerSelection) lockerSelection.style.display = 'none';
            if (lockerLabel) {
                lockerLabel.innerHTML = '<i class="fas fa-lock"></i> Assign to Locker?';
            }
        }
     }

    setVenueValue(placeFound) {
        const venueSelect = document.getElementById('venue_select');
        const customInput = document.getElementById('place_found');
        
        if (!venueSelect || !customInput) return;
        
        // Check if the place_found matches any venue option
        let foundVenue = false;
        for (let option of venueSelect.options) {
            if (option.value === placeFound) {
                venueSelect.value = placeFound;
                customInput.style.display = 'none';
                customInput.value = '';
                foundVenue = true;
                break;
            }
        }
        
        // If no matching venue found, use "other" option
        if (!foundVenue && placeFound) {
            venueSelect.value = 'other';
            customInput.style.display = 'block';
            customInput.value = placeFound;
        }
    }

    // Setup image upload functionality
    setupImageUpload() {
        const fileUploadArea = document.getElementById('fileUploadAreaDetails');
        const imageInput = document.getElementById('imageInput');
        const imagePreviewContainer = document.getElementById('imagePreviewContainer');

        if (!fileUploadArea || !imageInput || !imagePreviewContainer) return;

        // File upload area click handler
        fileUploadArea.addEventListener('click', () => {
            imageInput.click();
        });

        // Drag and drop handlers
        fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.classList.add('drag-over');
        });

        fileUploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('drag-over');
        });

        fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            this.handleImageFiles(files);
        });

        // File input change handler
        imageInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.handleImageFiles(files);
        });
    }

    // Handle selected image files
    async handleImageFiles(files) {
        // Clear any previous validation messages
        const validationContainer = document.querySelector('.validation-messages');
        if (validationContainer) {
            validationContainer.innerHTML = '';
        }

        // Use shared image validation if available
        if (window.imageValidator) {
            try {
                const validationResult = await window.imageValidator.validateMultipleFiles(files);
                
                // Display validation errors if any
                if (validationResult.errors.length > 0) {
                    validationResult.errors.forEach(error => {
                        this.showNotification(error, 'error');
                    });
                }

                // Display validation warnings if any
                if (validationResult.warnings.length > 0) {
                    validationResult.warnings.forEach(warning => {
                        this.showNotification(warning, 'warning');
                    });
                }

                // Process valid files
                if (validationResult.validFiles.length > 0) {
                    this.uploadedImages.push(...validationResult.validFiles);
                    this.updateImagePreview();
                    this.updateMainImageDisplay();
                    this.showNotification(`${validationResult.validFiles.length} image(s) uploaded successfully!`, 'success');
                }

                return;
            } catch (error) {
                console.warn('Shared image validator failed, falling back to basic validation:', error);
            }
        }

        // Fallback to basic validation if shared validator is not available
        const validFiles = [];
        const maxSize = 15 * 1024 * 1024; // 15MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        const minAspectRatio = 0.5; // more relaxed
        const maxAspectRatio = 2.0;  // more relaxed
        const minResolution = { width: 200, height: 200 };
        const maxResolution = { width: 6000, height: 6000 };

        let processedCount = 0;
        const totalFiles = files.length;

        files.forEach(file => {
            // Validate file type
            if (!allowedTypes.includes(file.type)) {
                this.showNotification(`${file.name} is not a valid image format. Please use JPG, PNG, or JPEG.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    this.finalizeImageFileSelection(validFiles);
                }
                return;
            }

            // Validate file size
            if (file.size > maxSize) {
                this.showNotification(`${file.name} is too large. Maximum file size is 10MB.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    this.finalizeImageFileSelection(validFiles);
                }
                return;
            }

            // Validate image dimensions and aspect ratio using FileReader and Image
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const width = img.width;
                    const height = img.height;
                    const aspectRatio = width / height;

                    // Validate resolution
                    if (width < minResolution.width || height < minResolution.height) {
                        this.showNotification(`${file.name} resolution (${width}x${height}) is too small. Minimum: ${minResolution.width}x${minResolution.height}`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            this.finalizeImageFileSelection(validFiles);
                        }
                        return;
                    }

                    if (width > maxResolution.width || height > maxResolution.height) {
                        this.showNotification(`${file.name} resolution (${width}x${height}) is too large. Maximum: ${maxResolution.width}x${maxResolution.height}`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            this.finalizeImageFileSelection(validFiles);
                        }
                        return;
                    }

                    // Validate aspect ratio
                    if (aspectRatio < minAspectRatio || aspectRatio > maxAspectRatio) {
                        this.showNotification(`${file.name} has invalid aspect ratio (${aspectRatio.toFixed(2)}). Allowed range: ${minAspectRatio} to ${maxAspectRatio} (3:4 to 3:2)`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            this.finalizeImageFileSelection(validFiles);
                        }
                        return;
                    }

                    // Add warning for edge cases
                    if (aspectRatio < 0.8 || aspectRatio > 1.4) {
                        this.showNotification(`${file.name} aspect ratio (${aspectRatio.toFixed(2)}) is near the limit. Consider using more standard ratios for better display.`, 'warning');
                    }

                    // File passed all validations
                    validFiles.push(file);
                    processedCount++;
                    
                    if (processedCount === totalFiles) {
                        this.finalizeImageFileSelection(validFiles);
                    }
                };
                
                img.onerror = () => {
                    this.showNotification(`${file.name} is corrupted or not a valid image file.`, 'error');
                    processedCount++;
                    if (processedCount === totalFiles) {
                        this.finalizeImageFileSelection(validFiles);
                    }
                };
                
                img.src = e.target.result;
            };
            
            reader.onerror = () => {
                this.showNotification(`Error reading ${file.name}. Please try again.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    this.finalizeImageFileSelection(validFiles);
                }
            };
            
            reader.readAsDataURL(file);
        });
    }

    // Finalize image file selection after all validations are complete
    finalizeImageFileSelection(validFiles) {
        if (validFiles.length > 0) {
            this.uploadedImages.push(...validFiles);
            this.updateImagePreview();
            this.updateMainImageDisplay();
            this.showNotification(`${validFiles.length} image(s) uploaded successfully!`, 'success');
        }
    }

    // Update image preview display
    updateImagePreview() {
        const fileUploadArea = document.getElementById('fileUploadAreaDetails');
        const imagePreviewContainer = document.getElementById('imagePreviewContainer');
        
        if (!imagePreviewContainer) return;

        if (this.uploadedImages.length === 0) {
            imagePreviewContainer.style.display = 'none';
            if (fileUploadArea) {
                fileUploadArea.style.display = 'block';
            }
            this.updateImageUrlField('');
            return;
        }

        // Hide upload area and show preview
        if (fileUploadArea) {
            fileUploadArea.style.display = 'none';
        }
        imagePreviewContainer.style.display = 'block';
        imagePreviewContainer.innerHTML = '';

        this.uploadedImages.forEach((file, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'image-preview-item';
            
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.alt = file.name;
            img.onclick = () => this.showImageModal(img.src);
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-image-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this.removeUploadedImage(index);
            };
            
            const fileName = document.createElement('div');
            fileName.className = 'image-file-name';
            fileName.textContent = file.name;
            
            previewItem.appendChild(img);
            previewItem.appendChild(removeBtn);
            previewItem.appendChild(fileName);
            imagePreviewContainer.appendChild(previewItem);
        });
        
        // Update image URL field with file names
        const fileNames = this.uploadedImages.map(file => file.name).join(', ');
        this.updateImageUrlField(`Uploaded: ${fileNames}`);
    }

    // Remove uploaded image
    removeUploadedImage(index) {
        this.uploadedImages.splice(index, 1);
        this.updateImagePreview();
        this.updateMainImageDisplay();
        
        if (this.uploadedImages.length === 0) {
            const imageInput = document.getElementById('imageInput');
            if (imageInput) imageInput.value = '';
        }
    }

    // Update main image display with uploaded image
    updateMainImageDisplay() {
        const imageElement = document.getElementById('itemImage');
        if (!imageElement) return;
        
        if (this.uploadedImages.length > 0) {
            // Show the first uploaded image in the main display
            const firstImage = this.uploadedImages[0];
            imageElement.src = URL.createObjectURL(firstImage);
            imageElement.alt = firstImage.name;
        } else if (this.itemData && this.itemData.image_url) {
            // Fallback to original image
            imageElement.src = this.itemData.image_url;
            imageElement.alt = this.itemData.found_item_name || 'Found Item';
        } else {
            // No image available
            imageElement.src = '/static/images/no-image.svg';
            imageElement.alt = 'No image available';
        }
    }
    
    // Update image URL field
    updateImageUrlField(value) {
        const imageUrlField = document.getElementById('imageUrlEdit');
        if (imageUrlField) {
            imageUrlField.value = value;
        }
    }

    // Show notification (placeholder - implement based on your notification system)
    showNotification(message, type) {
        console.log(`${type.toUpperCase()}: ${message}`);
        // Implement your notification system here
    }

    // Venue management methods (adapted from post-found-item.js)
    async loadVenues() {
        try {
            const response = await fetch('/static/venue.json');
            if (!response.ok) {
                throw new Error('Failed to load venues');
            }
            const data = await response.json();
            this.venues = data.venues;
            this.populateVenueDropdown();
        } catch (error) {
            console.error('Error loading venues:', error);
        }
    }

    populateVenueDropdown() {
        const venueSelect = document.getElementById('venue_select');
        if (!venueSelect) return;

        // Clear existing options except the first one
        venueSelect.innerHTML = '<option value="">Select a venue...</option>';

        // Group venues by category
        const groupedVenues = this.venues.reduce((groups, venue) => {
            const category = venue.category;
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(venue);
            return groups;
        }, {});

        // Add grouped options
        Object.keys(groupedVenues).sort().forEach(category => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category;
            
            groupedVenues[category].forEach(venue => {
                const option = document.createElement('option');
                option.value = venue.name;
                option.textContent = venue.name;
                optgroup.appendChild(option);
            });
            
            venueSelect.appendChild(optgroup);
        });

        // Add "Other" option
        const otherOption = document.createElement('option');
        otherOption.value = 'other';
        otherOption.textContent = 'Other (Custom Location)';
        venueSelect.appendChild(otherOption);

        // Add event listener for venue selection
        venueSelect.addEventListener('change', () => this.handleVenueSelection());
    }

    // Show image modal (method for the class)
    showImageModal(src, alt = 'Found Item Image') {
        showImageModal(src, alt);
    }

    // Handle venue selection
    handleVenueSelection() {
        const venueSelect = document.getElementById('venue_select');
        const customInput = document.getElementById('place_found');
        
        if (!venueSelect || !customInput) return;

        const selectedValue = venueSelect.value;
        
        if (selectedValue === 'other') {
            customInput.style.display = 'block';
            customInput.required = true;
            customInput.focus();
        } else {
            customInput.style.display = 'none';
            customInput.required = false;
            if (selectedValue) {
                customInput.value = selectedValue;
            }
        }
    }
}

// Global functions for UI interactions
function goBack() {
    // Go back to manage found items page
    window.location.href = '/admin/manage-found-item';
}

function toggleEditMode() {
    if (window.foundItemDetails) {
        window.foundItemDetails.toggleEditMode();
    }
}

function saveItem() {
    if (window.foundItemDetails) {
        window.foundItemDetails.saveItem();
    }
}

function cancelEdit() {
    if (window.foundItemDetails) {
        window.foundItemDetails.cancelEdit();
    }
}

function deleteItem() {
    if (!window.foundItemDetails || !window.foundItemDetails.itemId) return;

    const itemName = window.foundItemDetails.itemData?.found_item_name || 'this item';
    
    adminConfirm(`Are you sure you want to delete "${itemName}"? This action cannot be undone.`, {type:'error', title:'Delete Item'}).then((ok)=>{ if(!ok) return;
        deleteFoundItem(window.foundItemDetails.itemId);
    })
}

async function deleteFoundItem(itemId) {
    try {
        const response = await fetch(`/admin/api/found-items/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            alert('Item deleted successfully');
            window.location.href = '/admin/manage-found-item';
        } else {
            throw new Error(data.message || 'Failed to delete item');
        }
    } catch (error) {
        console.error('Error deleting item:', error);
        alert('Failed to delete item: ' + error.message);
    }
}

function retryLoad() {
    if (window.foundItemDetails) {
        window.foundItemDetails.loadItemDetails();
    }
}

function showImageModal(src, alt) {
    let modal = document.getElementById('imageModal');
    if (!modal) return;

    const modalImage = document.getElementById('modalImage');
    if (modalImage) {
        modalImage.src = src;
        modalImage.alt = alt;
    }
    
    modal.style.display = 'flex';
    
    // Prevent body scrolling when modal is open
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
        // Restore body scrolling
        document.body.style.overflow = '';
    }
}

// Preview image function for edit mode
function previewImage() {
    const imageUrl = document.getElementById('imageUrlEdit').value.trim();
    const imageElement = document.getElementById('itemImage');
    
    if (imageUrl && imageElement) {
        imageElement.src = imageUrl;
        imageElement.onerror = function() {
            this.src = '/static/images/no-image.svg';
            alert('Failed to load image from the provided URL. Please check the URL and try again.');
        };
    } else {
        alert('Please enter a valid image URL.');
    }
}

// Global function for confirming and clearing all tags (called from HTML)
function confirmDeleteAllTags() {
    // Create a modern confirmation dialog
    const modal = document.createElement('div');
    modal.className = 'confirmation-modal';
    modal.innerHTML = `
        <div class="confirmation-modal-content">
            <div class="confirmation-header">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Delete All Tags</h3>
            </div>
            <div class="confirmation-body">
                <p>Are you sure you want to delete all tags? This action cannot be undone.</p>
            </div>
            <div class="confirmation-actions">
                <button type="button" class="btn-cancel" onclick="closeConfirmationModal()">
                    <i class="fas fa-times"></i>
                    Cancel
                </button>
                <button type="button" class="btn-confirm-delete" onclick="confirmDeleteTags()">
                    <i class="fas fa-trash"></i>
                    Delete All Tags
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Show modal with animation
    setTimeout(() => modal.classList.add('show'), 10);
}

// Close confirmation modal
function closeConfirmationModal() {
    const modal = document.querySelector('.confirmation-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Confirm delete action
function confirmDeleteTags() {
    if (window.foundItemDetails) {
        window.foundItemDetails.clearAllTags();
    }
    closeConfirmationModal();
    showNotification('All tags deleted successfully', 'success');
}

// Show notification function
function showNotification(message, type = 'info') {
    if (window.foundItemDetails) {
        window.foundItemDetails.showNotification(message, type);
    }
}

// Legacy function for backward compatibility
function clearAllTagsFromDisplay() {
    confirmDeleteAllTags();
}

// Global functions for HTML onclick handlers
function saveItem() {
    if (window.foundItemDetails) {
        window.foundItemDetails.saveItem();
    }
}

function toggleEditMode() {
    if (window.foundItemDetails) {
        window.foundItemDetails.toggleEditMode();
    }
}

function cancelEdit() {
    if (window.foundItemDetails) {
        window.foundItemDetails.cancelEdit();
    }
}

// Initialize the FoundItemDetails instance
let foundItemDetails;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    foundItemDetails = new FoundItemDetails();
    window.foundItemDetails = foundItemDetails; // Make it globally accessible
    foundItemDetails.init();
});

// Handle escape key to close modal
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeImageModal();
    }
});
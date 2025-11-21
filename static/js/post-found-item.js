document.addEventListener('DOMContentLoaded', function() {
    let uploadedImages = [];
    let currentTags = [];
    let venues = [];

    // Load venues from JSON file
    loadVenues();

    // Initialize date/time input with current date/time
    const dateTimeInput = document.getElementById('date_time_found');
    if (dateTimeInput) {
        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        dateTimeInput.value = localDateTime.toISOString().slice(0, 16);
        
        // Add validation to prevent future dates
        dateTimeInput.addEventListener('change', function() {
            const selectedDate = new Date(this.value);
            const currentDate = new Date();
            
            if (selectedDate > currentDate) {
                showNotification('Date and time cannot be in the future', 'error');
                this.value = localDateTime.toISOString().slice(0, 16);
            }
        });
    }

    // Handle locker assignment checkbox
    const lockerCheckbox = document.getElementById('is_assigned_to_locker');
    const lockerSelection = document.getElementById('locker-selection');
    const lockerSelect = document.getElementById('locker_id');

    if (lockerCheckbox && lockerSelection && lockerSelect) {
        lockerCheckbox.addEventListener('change', function() {
            if (this.checked) {
                lockerSelection.style.display = 'block';
                loadAvailableLockers();
            } else {
                lockerSelection.style.display = 'none';
                lockerSelect.innerHTML = '<option value="">Loading available lockers...</option>';
            }
        });
    }

    // Handle image upload functionality - UNIFIED SYSTEM
    window.handleImageUpload = function(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;
        
        // Use the enhanced file selection handler
        handleFileSelection(files);
    };

    // Remove image function
    window.removeImage = function(index) {
        uploadedImages.splice(index, 1);
        updateImagePreview(); // Use the enhanced preview function
        updateAIDescriptionButton();
    };

    // Update AI Description button state
    function updateAIDescriptionButton() {
        const aiDescriptionBtn = document.getElementById('aiDescriptionBtn');
        if (aiDescriptionBtn) {
            aiDescriptionBtn.disabled = uploadedImages.length === 0;
        }
    }

    // Open image modal for full view
    window.openImageModal = function(imageSrc) {
        const modal = document.getElementById('imageModal');
        const modalImage = document.getElementById('modalImage');
        modalImage.src = imageSrc;
        modal.style.display = 'flex';
    };

    // Close image modal
    function closeImageModal() {
        const modal = document.getElementById('imageModal');
        modal.style.display = 'none';
    }

    // Modal event listeners
    document.addEventListener('click', function(event) {
        const modal = document.getElementById('imageModal');
        const modalClose = document.querySelector('.modal-close');
        
        if (event.target === modal || event.target === modalClose) {
            closeImageModal();
        }
    });

    // AI Description Generation
    async function generateAIDescription() {
        if (uploadedImages.length === 0) {
            showNotification('Please upload at least one image first', 'error');
            return;
        }

        const aiDescriptionBtn = document.getElementById('aiDescriptionBtn');
        const aiDescriptionLoading = document.getElementById('aiDescriptionLoading');
        const descriptionTextarea = document.getElementById('description');

        // Show loading state and overlay
        aiDescriptionBtn.disabled = true;
        aiDescriptionLoading.style.display = 'flex';
        showAIProcessingOverlay();

        try {
            const formData = new FormData();
            formData.append('image', uploadedImages[0]); // Use first image

            const response = await fetch('/admin/api/generate-description', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.description) {
                descriptionTextarea.value = data.description;
                showNotification('AI description generated successfully!', 'success');
            } else {
                throw new Error(data.error || 'Failed to generate description');
            }
        } catch (error) {
            console.error('Error generating AI description:', error);
            showNotification('Failed to generate AI description: ' + error.message, 'error');
        } finally {
            // Hide loading state and overlay
            aiDescriptionBtn.disabled = uploadedImages.length === 0;
            aiDescriptionLoading.style.display = 'none';
            hideAIProcessingOverlay();
        }
    }

    // Add event listener for AI Description button
    document.getElementById('aiDescriptionBtn')?.addEventListener('click', generateAIDescription);

    // Load available lockers when page loads
    async function loadAvailableLockers() {
        try {
            const response = await fetch('/admin/api/available-lockers');
            const data = await response.json();
            
            if (response.ok && data.lockers) {
                const lockerSelect = document.getElementById('locker_id');
                if (lockerSelect) {
                    lockerSelect.innerHTML = '<option value="">Select a locker</option>';
                    
                    // Add available lockers
                    data.lockers.forEach(locker => {
                        const option = document.createElement('option');
                        option.value = locker.id;
                        option.textContent = locker.name;
                        lockerSelect.appendChild(option);
                    });
                    
                    console.log(`Loaded ${data.lockers.length} available lockers`);
                }
            } else {
                console.error('Failed to load lockers:', data.error || 'Unknown error');
                showNotification('Failed to load available lockers', 'error');
            }
        } catch (error) {
            console.error('Error loading lockers:', error);
            showNotification('Error loading available lockers', 'error');
        }
    }

    // Handle image upload and preview
    const fileUploadArea = document.querySelector('.file-upload-area');
    const imageInput = document.getElementById('imageInput');

    // File upload area interactions
    if (fileUploadArea && imageInput) {
        fileUploadArea.addEventListener('click', function() {
            imageInput.click();
        });

        fileUploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.classList.add('drag-over');
        });

        fileUploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
        });

        fileUploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            
            const files = Array.from(e.dataTransfer.files);
            handleFileSelection(files);
        });

        imageInput.addEventListener('change', function(e) {
            const files = Array.from(e.target.files);
            handleFileSelection(files);
        });
    }

    // Enhanced image upload handling with validation
    function handleFileSelection(files) {
        if (files.length === 0) return;
        
        // Clear previous validation messages
        if (window.imageValidator) {
            window.imageValidator.clearValidationMessages('validation-messages');
        }
        
        // Use shared validator if available
        if (window.imageValidator) {
            window.imageValidator.validateMultipleFiles(files).then(validationResults => {
                const validFiles = [];
                let hasErrors = false;
                
                for (const result of validationResults) {
                    if (result.isValid) {
                        validFiles.push(result.file);
                    } else {
                        hasErrors = true;
                        window.imageValidator.showValidationError(result.message, 'validation-messages');
                    }
                }
                
                finalizeFileSelection(validFiles);
            });
            return;
        }
        
        // Fallback validation if imageValidator is not available
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
                showNotification(`${file.name} is not a valid image type. Only JPG, PNG, and JPEG are allowed.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    finalizeFileSelection(validFiles);
                }
                return;
            }

            // Validate file size (10MB = 10 * 1024 * 1024 bytes)
            if (file.size > maxSize) {
                showNotification(`${file.name} is too large. Maximum file size is 10MB.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    finalizeFileSelection(validFiles);
                }
                return;
            }

            // Validate image dimensions and aspect ratio using FileReader and Image
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const width = img.width;
                    const height = img.height;
                    const aspectRatio = width / height;

                    // Validate resolution
                    if (width < minResolution.width || height < minResolution.height) {
                        showNotification(`${file.name} resolution (${width}x${height}) is too small. Minimum: ${minResolution.width}x${minResolution.height}`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            finalizeFileSelection(validFiles);
                        }
                        return;
                    }

                    if (width > maxResolution.width || height > maxResolution.height) {
                        showNotification(`${file.name} resolution (${width}x${height}) is too large. Maximum: ${maxResolution.width}x${maxResolution.height}`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            finalizeFileSelection(validFiles);
                        }
                        return;
                    }

                    // Validate aspect ratio
                    if (aspectRatio < minAspectRatio || aspectRatio > maxAspectRatio) {
                        showNotification(`${file.name} has invalid aspect ratio (${aspectRatio.toFixed(2)}). Allowed range: ${minAspectRatio} to ${maxAspectRatio} (3:4 to 3:2)`, 'error');
                        processedCount++;
                        if (processedCount === totalFiles) {
                            finalizeFileSelection(validFiles);
                        }
                        return;
                    }

                    // Add warning for edge cases
                    if (aspectRatio < 0.8 || aspectRatio > 1.4) {
                        showNotification(`${file.name} aspect ratio (${aspectRatio.toFixed(2)}) is near the limit. Consider using more standard ratios for better display.`, 'warning');
                    }

                    // File passed all validations
                    validFiles.push(file);
                    processedCount++;
                    
                    if (processedCount === totalFiles) {
                        finalizeFileSelection(validFiles);
                    }
                };
                
                img.onerror = function() {
                    showNotification(`${file.name} is corrupted or not a valid image file.`, 'error');
                    processedCount++;
                    if (processedCount === totalFiles) {
                        finalizeFileSelection(validFiles);
                    }
                };
                
                img.src = e.target.result;
            };
            
            reader.onerror = function() {
                showNotification(`Error reading ${file.name}. Please try again.`, 'error');
                processedCount++;
                if (processedCount === totalFiles) {
                    finalizeFileSelection(validFiles);
                }
            };
            
            reader.readAsDataURL(file);
        });
    }

    // Finalize file selection after all validations are complete
    function finalizeFileSelection(validFiles) {
        if (validFiles.length === 0) {
            return;
        }

        // Add valid files to uploaded images array
        uploadedImages.push(...validFiles);
        updateImagePreview();
        updateAIDescriptionButton(); // Enable AI description button when images are uploaded
        
        // Show success notification
        showNotification(`${validFiles.length} image(s) uploaded successfully!`, 'success');
        
        // Generate AI tags for the first uploaded image
        if (validFiles.length > 0) {
            generateAITags(validFiles[0]);
        }
    }

    // Display image previews with enhanced styling
    function updateImagePreview() {
        const imagePreviewContainer = document.getElementById('imagePreviewContainer');
        const fileUploadArea = document.querySelector('.file-upload-area');
        const imageInput = document.getElementById('imageInput');
        
        if (!imagePreviewContainer) return;

        if (uploadedImages.length === 0) {
            imagePreviewContainer.style.display = 'none';
            // Restore the upload area when no images
            if (fileUploadArea) {
                fileUploadArea.style.display = 'block';
                fileUploadArea.style.cursor = 'pointer';
            }
            // Reset the file input to allow new uploads
            if (imageInput) {
                imageInput.value = '';
            }
            return;
        }
        
        imagePreviewContainer.style.display = 'flex';
        imagePreviewContainer.innerHTML = '';
        
        // Hide upload area when images are present
        if (fileUploadArea) {
            fileUploadArea.style.display = 'none';
        }
        
        uploadedImages.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const previewItem = document.createElement('div');
                previewItem.className = 'image-preview-item';
                previewItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview ${index + 1}">
                    <button type="button" class="remove-image-btn" onclick="removeImage(${index})" title="Remove image">
                        ×
                    </button>
                `;
                imagePreviewContainer.appendChild(previewItem);
            };
            reader.readAsDataURL(file);
        });
    }

    // Remove image from uploaded images array
    window.removeImage = function(index) {
        // If this is the first image and we have AI-generated tags, remove them
        if (index === 0 && aiGeneratedTags.size > 0) {
            // Remove all AI-generated tags
            currentTags = currentTags.filter(tag => !aiGeneratedTags.has(tag));
            aiGeneratedTags.clear();
            updateTagsDisplay();
            showNotification('Image and associated AI tags removed successfully!', 'info');
        } else {
            showNotification('Image removed successfully!', 'info');
        }
        
        uploadedImages.splice(index, 1);
        updateImagePreview();
        updateAIDescriptionButton(); // Update AI description button state when images are removed
        
        // If we still have images after removal, regenerate AI tags for the new first image
        if (uploadedImages.length > 0 && index === 0) {
            generateAITags(uploadedImages[0]);
        }
    };

    // Tag management with AI vs manual tracking
    let aiGeneratedTags = new Set();
    const MAX_TAGS = 8;

    const LEARNED_TAGS_KEY = 'qreclaim_learned_tags';
    function getLearnedTagStats(){ try { return JSON.parse(localStorage.getItem(LEARNED_TAGS_KEY)||'{}'); } catch(_) { return {}; } }
    function recordLearnedTag(tag){ const t=(tag||'').trim().toLowerCase(); if(!t) return; const stats=getLearnedTagStats(); stats[t]=(stats[t]||0)+1; localStorage.setItem(LEARNED_TAGS_KEY, JSON.stringify(stats)); }
    function getTopLearnedTags(limit){ const stats=getLearnedTagStats(); const entries=Object.entries(stats); entries.sort((a,b)=>b[1]-a[1]); return entries.slice(0,(limit||50)).map(([k])=>k); }

    // Add tag functionality with type tracking
    function addTag(tagText, isAIGenerated = false) {
        const trimmedTag = tagText.trim();
        if (!trimmedTag) return false;
        if (currentTags.includes(trimmedTag)) return false;
        if (currentTags.length >= MAX_TAGS) { showNotification(`Maximum ${MAX_TAGS} tags allowed`, 'error'); return false; }
        currentTags.push(trimmedTag);
        if (isAIGenerated) { aiGeneratedTags.add(trimmedTag); } else { recordLearnedTag(trimmedTag); }
        updateTagsDisplay();
        return true;
    }

    // Remove tag functionality
    function removeTag(tagText) {
        const index = currentTags.indexOf(tagText);
        if (index > -1) {
            currentTags.splice(index, 1);
            aiGeneratedTags.delete(tagText); // Remove from AI set if present
            updateTagsDisplay();
        }
    }

    // Clear all tags functionality
    function clearAllTags() {
        currentTags = [];
        aiGeneratedTags.clear();
        updateTagsDisplay();
        showNotification('All tags cleared', 'info');
    }

    // Update tags display with different colors for AI vs manual
    function updateTagsDisplay() {
        if (currentTags.length === 0) {
            tagsDisplay.innerHTML = '';
            return;
        }

        tagsDisplay.innerHTML = currentTags.map(tag => {
            const isAI = aiGeneratedTags.has(tag);
            const tagClass = isAI ? 'tag tag-ai' : 'tag tag-manual';
            
            return `
                <span class="${tagClass}" title="${isAI ? 'AI Generated' : 'Manually Added'}">
                    ${tag}
                    <button type="button" class="tag-remove" onclick="removeTagFromDisplay('${tag}')">
                        ×
                    </button>
                </span>
            `;
        }).join('');
    }

    // Global function for removing tags (called from HTML)
    window.removeTagFromDisplay = function(tag) {
        removeTag(tag);
    };

    // Global function for confirming and clearing all tags (called from HTML)
    window.confirmDeleteAllTags = function() {
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
    };

    // Close confirmation modal
    window.closeConfirmationModal = function() {
        const modal = document.querySelector('.confirmation-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
        }
    };

    // Confirm delete action
    window.confirmDeleteTags = function() {
        clearAllTags();
        closeConfirmationModal();
        showNotification('All tags deleted successfully', 'success');
    };

    // Legacy function for backward compatibility
    window.clearAllTagsFromDisplay = function() {
        confirmDeleteAllTags();
    };

    // Cancel action confirmation
    window.confirmCancelAction = function() {
        // Check if form has any data
        const hasData = checkFormHasData();
        
        if (hasData) {
            const modal = document.createElement('div');
            modal.className = 'confirmation-modal';
            modal.innerHTML = `
                <div class="confirmation-modal-content">
                    <div class="confirmation-header" style="background: linear-gradient(135deg, #ffc107, #ff8f00);">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>Unsaved Changes</h3>
                    </div>
                    <div class="confirmation-body">
                        <p>You have unsaved changes. Are you sure you want to leave without saving?</p>
                    </div>
                    <div class="confirmation-actions">
                        <button type="button" class="btn-cancel" onclick="closeConfirmationModal()">
                            <i class="fas fa-edit"></i>
                            Continue Editing
                        </button>
                        <button type="button" class="btn-confirm-delete" onclick="confirmLeave()">
                            <i class="fas fa-sign-out-alt"></i>
                            Leave Without Saving
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);
        } else {
            window.history.back();
        }
    };

    // Submit action confirmation
    window.confirmSubmitAction = function(event) {
        event.preventDefault();
        
        // First show confirmation dialog with instructions
        const modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.innerHTML = `
            <div class="confirmation-modal-content">
                <div class="confirmation-header">
                    <i class="fas fa-info-circle"></i>
                    <h3>Submit Found Item</h3>
                </div>
                <div class="confirmation-body">
                    <p>Please verify all information is correct before submitting. Are you ready to submit this found item report?</p>
                </div>
                <div class="confirmation-actions">
                    <button type="button" class="btn-cancel" onclick="closeConfirmationModal()">
                        <i class="fas fa-times"></i>
                        Cancel
                    </button>
                    <button type="button" class="btn-confirm-delete" onclick="validateAndSubmit()">
                        <i class="fas fa-check"></i>
                        Submit Found Item
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    };

    // Validate and submit function
    window.validateAndSubmit = function() {
        // Immediately close the confirmation modal when confirm is clicked
        closeConfirmationModal();

        // Check required fields
        const requiredFields = validateRequiredFields();
        
        if (requiredFields.missing.length > 0) {
            // Show error modal explaining missing fields
            setTimeout(() => {
                const errorModal = document.createElement('div');
                errorModal.className = 'confirmation-modal';
                errorModal.innerHTML = `
                    <div class="confirmation-modal-content">
                        <div class="confirmation-header error">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>Missing Required Fields</h3>
                        </div>
                        <div class="confirmation-body">
                            <p><strong>Please fill in the following required fields:</strong></p>
                            <ul style="text-align: left; margin: 16px 0; padding-left: 20px;">
                                ${requiredFields.missing.map(field => `<li>${field}</li>`).join('')}
                            </ul>
                            <p>All required fields must be completed before submission.</p>
                        </div>
                        <div class="confirmation-actions">
                            <button type="button" class="btn-cancel" onclick="closeConfirmationModal()">
                                <i class="fas fa-arrow-left"></i>
                                Go Back to Form
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(errorModal);
                setTimeout(() => errorModal.classList.add('show'), 10);
            }, 300);
        } else {
            // All fields are valid, submit the form
            submitForm();
        }
    };

    // Helper function to check if form has data
    function checkFormHasData() {
        const itemName = document.getElementById('itemName')?.value?.trim();
        const category = document.getElementById('category')?.value;
        const description = document.getElementById('description')?.value?.trim();
        const venue = document.getElementById('venue')?.value;
        const hasImages = uploadedImages && uploadedImages.length > 0;
        const hasTags = currentTags && currentTags.length > 0;
        
        return itemName || category || description || venue || hasImages || hasTags;
    }

    // Helper function to validate required fields
    function validateRequiredFields() {
        const missing = [];
        
        // Check item name (correct ID: item_name)
        const itemName = document.getElementById('item_name')?.value?.trim();
        if (!itemName) missing.push('Item Name');
        
        // Check category
        const category = document.getElementById('category')?.value;
        if (!category) missing.push('Category');
        
        // Check description
        const description = document.getElementById('description')?.value?.trim();
        if (!description) missing.push('Description');
        
        // Check venue - either from dropdown or custom input
        const venueSelect = document.getElementById('venue_select')?.value;
        const placeFound = document.getElementById('place_found')?.value?.trim();
        const hasVenue = venueSelect || placeFound;
        if (!hasVenue) missing.push('Place Found');
        
        // Check images
        const hasImages = uploadedImages && uploadedImages.length > 0;
        if (!hasImages) missing.push('At least one image');
        
        return { missing };
    }

    // Confirm leave action
    window.confirmLeave = function() {
        closeConfirmationModal();
        window.history.back();
    };

    // Remove legacy direct form submit to avoid double submissions and rely on enhanced submitForm()
    // (Intentionally left blank - handled by enhanced submitForm())

    // Manual tag management elements
    const tagInput = document.getElementById('tagInput');
    const addTagBtn = document.getElementById('addTagBtn');
    const tagsDisplay = document.getElementById('tagsDisplay');

    // Add tag button event listener
    if (addTagBtn) {
        addTagBtn.addEventListener('click', function() {
            const tagText = tagInput.value.trim();
            if (tagText) {
                if (addTag(tagText, false)) { // Mark as manually added
                    tagInput.value = '';
                    showNotification('Tag added successfully', 'success');
                } else {
                    showNotification('Tag already exists or is empty', 'error');
                }
            }
        });
    }

    // Add tag on Enter key press
    if (tagInput) {
        tagInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTagBtn.click();
            }
        });
    }

    // Generate AI tags from uploaded images
    function generateAITags(imageFile) {
        const tagsLoading = document.getElementById('tagsLoading');
        const tagsError = document.getElementById('tagsError');
        
        if (tagsLoading) tagsLoading.style.display = 'block';
        if (tagsError) tagsError.style.display = 'none';
        showAIProcessingOverlay();

        const formData = new FormData();
        formData.append('image', imageFile);
        try { formData.append('learned_tags', JSON.stringify(getTopLearnedTags(50))); } catch(_) {}

        fetch('/admin/api/generate-tags', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (tagsLoading) tagsLoading.style.display = 'none';
            hideAIProcessingOverlay();
            
            if (data.success && data.tags) {
                const remaining = MAX_TAGS - currentTags.length;
                const uniqueNew = (data.tags || []).filter(tag => !currentTags.includes(tag));
                const toAdd = uniqueNew.slice(0, Math.max(0, remaining));
                toAdd.forEach(tag => addTag(tag, true));
                showNotification(`Generated ${toAdd.length} AI tags`, 'success');
            } else {
                if (tagsError) {
                    tagsError.textContent = data.error || 'Failed to generate tags';
                    tagsError.style.display = 'block';
                }
                showNotification('Failed to generate AI tags', 'error');
            }
        })
        .catch(error => {
            console.error('Error generating tags:', error);
            if (tagsLoading) tagsLoading.style.display = 'none';
            hideAIProcessingOverlay();
            if (tagsError) {
                tagsError.textContent = 'Error generating tags';
                tagsError.style.display = 'block';
            }
            showNotification('Error generating AI tags', 'error');
        });
    }

    function displayTags() {
        if (tagsDisplay) {
            tagsDisplay.innerHTML = '';
            currentTags.forEach(tag => {
                const tagElement = document.createElement('span');
                tagElement.className = 'tag';
                tagElement.innerHTML = `
                    ${tag}
                    <button type="button" class="tag-remove" onclick="removeTag('${tag}')">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                tagsDisplay.appendChild(tagElement);
            });
        }
    }

    // Remove tag function (global scope)
    window.removeTag = function(tagText) {
        currentTags = currentTags.filter(tag => tag !== tagText);
        displayTags();
    };

    // Enhanced form submission with comprehensive validation
    function submitForm() {
        console.log('submitForm function called');
        // Validate required fields using correct IDs from HTML
        const itemName = document.getElementById('item_name').value.trim();
        const category = document.getElementById('category').value;
        const description = document.getElementById('description').value.trim();
        
        // Handle venue selection - either from dropdown or custom input
        const venueSelect = document.getElementById('venue_select').value;
        const customPlace = document.getElementById('place_found').value.trim();
        const placeFound = venueSelect === 'other' ? customPlace : (venueSelect || customPlace);
        
        const dateTimeFound = document.getElementById('date_time_found').value;
        
        // Check for required fields
        if (!itemName) {
            showNotification('Please enter the item name.', 'error');
            return;
        }
        
        if (!category) {
            showNotification('Please select a category.', 'error');
            return;
        }
        
        if (!description) {
            showNotification('Please enter a description.', 'error');
            return;
        }
        
        if (!placeFound) {
            showNotification('Please enter where the item was found.', 'error');
            return;
        }
        
        if (!dateTimeFound) {
            showNotification('Please enter the date and time when the item was found.', 'error');
            return;
        }
        
        // Validate at least one image is uploaded
        if (uploadedImages.length === 0) {
            showNotification('Please upload at least one image of the item.', 'error');
            return;
        }
        
        // Validate at least one tag is present
        if (currentTags.length === 0) {
            showNotification('Please add at least one tag for the item.', 'error');
            return;
        }
        
        // Prepare form data
        const formData = new FormData();
        formData.append('found_item_name', itemName);
        formData.append('category', category);
        formData.append('description', description);
        formData.append('place_found', placeFound);
        formData.append('time_found', dateTimeFound);
        formData.append('tags', JSON.stringify(currentTags));
        
        // Add remarks field if it has content
        const remarks = document.getElementById('remarks').value.trim();
        if (remarks) {
            formData.append('remarks', remarks);
        }
        
        // Add is_valuable checkbox value
        const isValuable = document.getElementById('is_valuable').checked;
        formData.append('is_valuable', isValuable);
        
        // Add locker assignment if checked
        const assignToLocker = document.getElementById('is_assigned_to_locker').checked;
        formData.append('is_assigned_to_locker', assignToLocker);
        if (assignToLocker) {
            const selectedLocker = document.getElementById('locker_id').value;
            if (selectedLocker) {
                formData.append('locker_id', selectedLocker);
            }
        }
        
        // Add images
        uploadedImages.forEach((file, index) => {
            formData.append(`image_${index}`, file);
        });
        
        // Show loading state
        const submitBtn = document.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Submitting...';
        submitBtn.disabled = true;
        
        // Submit form
        fetch('/admin/post-found-item', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Close any open confirmation modal first
                closeConfirmationModal();
                
                showNotification('Found item posted successfully!', 'success');
                // Reset form after successful submission
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                showNotification(data.message || 'Error posting found item. Please try again.', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification('Network error. Please check your connection and try again.', 'error');
        })
        .finally(() => {
            // Restore button state
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        });
    }

    // Form submission with validation
    const form = document.getElementById('postFoundItemForm');
    if (form) {
        console.log('Form found, adding submit event listener');
        form.addEventListener('submit', function(e) {
            console.log('Form submit event triggered');
            e.preventDefault();
            submitForm();
        });
    } else {
        console.error('Form with ID "postFoundItemForm" not found');
    }

    // Load venues from JSON file
    async function loadVenues() {
        try {
            const response = await fetch('/static/venue.json');
            if (!response.ok) {
                throw new Error('Failed to load venues');
            }
            const data = await response.json();
            venues = data.venues;
            populateVenueDropdown();
        } catch (error) {
            console.error('Error loading venues:', error);
            showNotification('Failed to load venue options', 'error');
        }
    }

    // Populate venue dropdown with options
    function populateVenueDropdown() {
        const venueSelect = document.getElementById('venue_select');
        if (!venueSelect) return;

        // Clear existing options except the first one
        venueSelect.innerHTML = '<option value="">Select a venue...</option>';

        // Group venues by category
        const groupedVenues = venues.reduce((groups, venue) => {
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
        venueSelect.addEventListener('change', handleVenueSelection);
    }

    // Handle venue selection
    function handleVenueSelection() {
        const venueSelect = document.getElementById('venue_select');
        const customInput = document.getElementById('place_found');
        
        if (venueSelect.value === 'other') {
            customInput.style.display = 'block';
            customInput.required = true;
            customInput.focus();
        } else {
            customInput.style.display = 'none';
            customInput.required = false;
            customInput.value = venueSelect.value;
        }
    }

    // Show AI Processing Overlay
    function showAIProcessingOverlay() {
        const overlay = document.getElementById('aiProcessingOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    // Hide AI Processing Overlay
    function hideAIProcessingOverlay() {
        const overlay = document.getElementById('aiProcessingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    // Notification system routed to adminMsgBox
    window.showNotification = function(message, type = 'info') {
        try {
            if (type === 'success') adminMsgBox.showSuccess(message);
            else if (type === 'error') adminMsgBox.showError(message);
            else if (type === 'warning') adminMsgBox.showWarning(message);
            else adminMsgBox.showInfo(message);
        } catch (_) { alert(message); }
    };
});

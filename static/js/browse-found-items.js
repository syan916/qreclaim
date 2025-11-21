/**
 * Browse Found Items - Interactive Functionality
 * Handles item claiming, QR approval requests, and view details
 */

// Global variables for pagination and filters
let currentPage = 1;
let totalPages = 1;
let currentFilters = {
    search: '',
    category: '',
    location: '',
    status: ''
};
let isLoading = false;
// Lightbox state for image navigation and zoom

let itemCardTemplateEl = null;
// Real-time UI update flags
let isUpdating = false;
let realTimeUpdateInterval = null;
let validationCache = new Map();
let lastGlobalValidationAt = 0;
const VALIDATION_TTL_MS = 15000;
const VALIDATION_POLL_MS = 12000;
const VALIDATION_CONCURRENCY = 6;
let itemsFetchController = null;
// Global local state for optimistic UI; buttons render from this only
window.userClaimState = window.userClaimState || { hasActive: false, status: 'none', claimItemId: null };

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', function() {
    // Cache template reference before any DOM modifications
    itemCardTemplateEl = document.getElementById('itemCardTemplate');
    if (!itemCardTemplateEl) {
        console.warn('Item card template not found during DOMContentLoaded; will attempt to locate later');
    }

    initializePage();
    setupEventListeners();
    // Initialize image click handlers and preloaders for existing content
    setupImageClickHandlers();
    setupImagePreloaders(document);
    // set initial view state for CSS and view-toggle visibility
    const itemsGridEl = document.getElementById('itemsGrid');
    if (itemsGridEl) {
        let initialView = itemsGridEl.classList.contains('items-list') ? 'list' : 'grid';
        const isMobile = window.matchMedia('(max-width: 576px)').matches;
        // On mobile, force vertical list layout by default
        if (isMobile && initialView !== 'list') {
            itemsGridEl.classList.add('items-list');
            itemsGridEl.classList.remove('items-grid');
            initialView = 'list';
        }
        document.body.dataset.itemsView = initialView;
    }

    try {
        if (realTimeUpdateInterval) {
            clearInterval(realTimeUpdateInterval);
        }
        // Lightweight backend sync that updates local state without blocking UI
        const sync = async () => { try { await syncUserClaimStateFromBackend(); } catch(_){} };
        realTimeUpdateInterval = setInterval(sync, VALIDATION_POLL_MS);
        sync();
    } catch (e) {
        console.warn('Failed to start real-time sync interval:', e);
    }
    try {
        document.addEventListener('visibilitychange', function(){
            if (document.hidden) return;
            // Background sync only; UI already reflects local state
            syncUserClaimStateFromBackend().catch(()=>{});
        });
        window.addEventListener('online', function(){
            // Do not block rendering; backend sync runs in background
            syncUserClaimStateFromBackend().catch(()=>{});
        });
    } catch(_){ }
});

// Initialize page
function initializePage() {
    // Update items count
    updateItemsCount();
    
    // Initialize search functionality
    initializeSearch();
    
    // Initialize filters
    initializeFilters();
    
    // Setup filter listeners
    setupFilterListeners();
    
    console.log('Browse Found Items page initialized');
    
    // Setup ESC key listener for modal
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeImageModal();
        }
    });
    
    // Ensure items are fetched on initial load
    loadFoundItemsLegacy();
}

// Enhanced Image Modal Functions with Loading States and Error Handling
function openImageModal(src, alt) {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    if (!modal || !modalImage) return;
    modalImage.src = src || '/static/images/placeholder-item.png';
    modalImage.alt = alt || 'Enlarged view';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}


function closeImageModal(event){
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    if (event && event.target !== modal && !event.target.classList.contains('modal-close')){
        return; // ignore clicks inside content
    }
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// [Removed] Legacy image preview helper functions (showImageLoading, hideImageLoading, showImageError, clearModalStates)
// Adopted minimal modal behavior from details.js; no custom loading/error overlays needed.

// Make functions globally available
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;

// Load found items from Firebase API
async function loadFoundItemsLegacy() {
    if (isLoading) return;
    
    isLoading = true;
    showLoadingState();
    
    try {
        // Build query parameters
        const params = new URLSearchParams({
            page: currentPage,
            per_page: 12,
            search: currentFilters.search,
            category: currentFilters.category,
            status: currentFilters.status,
            location: currentFilters.location
        });
        
        // Remove empty parameters
        for (let [key, value] of [...params]) {
            if (!value) params.delete(key);
        }
        if (itemsFetchController) {
            try { itemsFetchController.abort(); } catch(_){ }
        }
        itemsFetchController = new AbortController();
        const response = await fetch(`/user/api/found-items?${params}`, { signal: itemsFetchController.signal });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayItems(data.found_items);
            updatePagination(data.pagination);
            updateFilterOptions(data.filters);
            updateItemsCount(data.pagination.total_items);
            toggleEmptyState(data.found_items.length === 0);
        } else {
            throw new Error(data.error || 'Failed to load items');
        }
        
    } catch (error) {
        if (error && error.name === 'AbortError') {
            
        } else {
            console.error('Error loading found items:', error);
            showErrorState(error.message);
        }
    } finally {
        isLoading = false;
        hideLoadingState();
    }
}

// Display items in the grid (uses server response shape)
function displayItems(items) {
    const itemsGrid = document.getElementById('itemsGrid');
    if (!itemsGrid) {
        console.error('Items grid container not found');
        return;
    }

    if (!Array.isArray(items) || items.length === 0) {
        itemsGrid.innerHTML = '';
        toggleEmptyState(true);
        return;
    }

    toggleEmptyState(false);
    itemsGrid.innerHTML = '';

    items.forEach((item, index) => {
        // Normalize item fields from API
        const normalized = {
            id: item.id || item.item_id || item.doc_id || '',
            item_name: item.name || item.found_item_name || item.item_name || item.title || 'Unnamed Item',
            description: item.description || '',
            category: item.category || 'Uncategorized',
            tags: item.tags || [],
            status: item.status || 'unclaimed',
            is_valuable: !!(item.is_valuable),
            image_url: item.image_url || item.image || '/static/images/placeholder-item.png',
            found_location: item.location || item.found_location || 'Unknown Location',
            found_date: item.time_found || item.found_date || item.foundDate || item.created_at || null,
        };
        
        const cardElement = createItemCard(normalized, index);
        if (cardElement) {
            itemsGrid.appendChild(cardElement);
        } else {
            console.error('Failed to create item card for item:', normalized);
        }
    });
    
    // After rendering, attach preloaders for thumbnails (show spinner until loaded)
    setupImagePreloaders(itemsGrid);

    // Apply dynamic grid class based on count to satisfy UX requirement
    try {
        applyGridLayout(items.length);
    } catch (e) {
        console.warn('applyGridLayout failed:', e);
    }
    
    try {
        observeCardsForValidation(itemsGrid);
    } catch(_){ }
}

// Validate all button states after items are loaded
async function validateAllButtonStates() {
    const cards = Array.from(document.querySelectorAll('.item-card[data-item-id]')).filter(isElementInViewport);
    await runLimitedQueue(cards, VALIDATION_CONCURRENCY, async (card) => {
        const itemId = card.dataset.itemId;
        if (!itemId) return;
        try { await applyQRStatusToCard(card, itemId); } catch(_){}
    });
}

// Create item card DOM element using template and normalized item fields
function createItemCard(item, index = 0) {
    // Get the template and clone it
    const template = itemCardTemplateEl || document.getElementById('itemCardTemplate');
    if (!template) {
        console.error('Item card template not found');
        return null;
    }
    
    const cardElement = template.content.cloneNode(true);
    const card = cardElement.querySelector('.item-card');
    
    if (!card) {
        console.error('Item card element not found in template');
        return null;
    }
    
    // Set animation delay
    card.setAttribute('data-aos-delay', String(Math.min(index * 50, 200)));

    // Safely escape and prepare data
    const safeName = escapeHtml(item.item_name || 'Unnamed Item');
    const safeCat = escapeHtml(item.category || 'Uncategorized');
    const safeLocation = escapeHtml(item.found_location || 'Unknown Location');
    const safeDescription = escapeHtml(item.description || '');
    const formattedDate = item.found_date ? formatDate(item.found_date) : 'Unknown Date';
    const imgSrc = item.image_url || '/static/images/placeholder-item.png';

    // Attach dataset for sorting/filtering reliability
    card.dataset.category = (item.category || '').toString().toLowerCase();
    card.dataset.location = (item.found_location || '').toString().toLowerCase();
    // Also attach item id for robust lookups after actions (e.g., QR approval)
    // We set both dataset and attribute to support different selector styles.
    if (item.id != null) {
        try {
            card.dataset.itemId = String(item.id);
            card.setAttribute('data-item-id', String(item.id));
        } catch (e) {
            console.warn('createItemCard: failed to set data-item-id', e);
        }
    }
    try {
        if (item.found_date && typeof item.found_date === 'object' && 'seconds' in item.found_date) {
            card.dataset.date = String((item.found_date.seconds * 1000) + Math.floor((item.found_date.nanoseconds || 0) / 1e6));
        } else if (typeof item.found_date === 'number' || (typeof item.found_date === 'string' && /^\d+$/.test(item.found_date))) {
            card.dataset.date = String(Number(item.found_date));
        } else if (item.found_date) {
            const d = new Date(item.found_date);
            card.dataset.date = isNaN(d) ? '' : String(d.getTime());
        } else {
            card.dataset.date = '';
        }
    } catch(e) {
        card.dataset.date = '';
    }

    // Map status to badge class and text (English)
    const statusMap = {
        unclaimed: { text: 'Unclaimed' },
        approved: { text: 'Approved' },
        pending:   { text: 'Pending' },
        claimed:   { text: 'Claimed' },
    };
    const statusInfo = statusMap[item.status] || statusMap['unclaimed'];

    // Populate image
    const img = card.querySelector('.item-image');
    const imageContainer = card.querySelector('.item-image-container');
    if (img) {
        img.src = imgSrc;
        img.alt = safeName;
        // Image error fallback
        img.addEventListener('error', () => { 
            img.src = '/static/images/placeholder-item.png'; 
        }, { once: true });
    }
    if (imageContainer) {
        imageContainer.setAttribute('aria-label', `Image of ${safeName}`);
    }

    // Populate content
    const itemName = card.querySelector('.item-name');
    const itemTitle = card.querySelector('.item-title');
    const itemCategory = card.querySelector('.item-category');
    const itemLocation = card.querySelector('.item-location');
    const itemDate = card.querySelector('.item-date');
    const itemDescription = card.querySelector('.item-description');
    const statusBadge = card.querySelector('.item-status-badge');

    // Safely populate content with null checks
    if (itemName) {
        itemName.textContent = safeName;
        itemName.title = safeName;
    }
    if (itemTitle) {
        itemTitle.textContent = safeName;
        itemTitle.title = safeName;
    }
    if (itemCategory) {
        itemCategory.textContent = safeCat;
    }
    if (itemLocation) {
        itemLocation.textContent = safeLocation;
    }
    if (itemDate) {
        itemDate.textContent = formattedDate;
    }
    
    // Handle description
    if (itemDescription && safeDescription) {
        itemDescription.textContent = safeDescription;
        itemDescription.title = safeDescription;
        itemDescription.style.display = 'block';
    } else if (itemDescription) {
        itemDescription.style.display = 'none';
    }

    // Handle date row visibility
    const dateRow = card.querySelector('.item-date-row');
    if (dateRow) {
        if (item.found_date) {
            dateRow.style.display = 'flex';
        } else {
            dateRow.style.display = 'none';
        }
    }

    // Update category icon
    const categoryIcon = card.querySelector('.item-meta-row i');
    if (categoryIcon) {
        categoryIcon.className = getCategoryIcon(item.category);
    }

    // Populate tags
    const tagsContainer = card.querySelector('.tags-container');
    if (tagsContainer) {
        if (Array.isArray(item.tags) && item.tags.length > 0) {
            tagsContainer.innerHTML = '';
            item.tags.slice(0, 8).forEach((tag, tagIndex) => {
                if (tagIndex === 7 && item.tags.length > 8) {
                    const moreTag = document.createElement('span');
                    moreTag.className = 'tag-chip tag-more';
                    moreTag.textContent = `+${item.tags.length - 7} more...`;
                    tagsContainer.appendChild(moreTag);
                } else {
                    const tagElement = document.createElement('span');
                    tagElement.className = 'tag-chip';
                    tagElement.textContent = escapeHtml(tag);
                    tagsContainer.appendChild(tagElement);
                }
            });
            tagsContainer.style.display = 'block';
        } else {
            tagsContainer.style.display = 'none';
        }
    }

    // Handle buttons based on item value and status
    const claimBtn = card.querySelector('.btn-claim');
    const requestBtn = card.querySelector('.btn-qr-approval');

    // Attach action identifiers for centralized state updates
    if (claimBtn) claimBtn.setAttribute('data-action', 'claim');
    if (requestBtn) requestBtn.setAttribute('data-action', 'request-approval');

    if (item.id != null) {
        try { card.dataset.valuable = item.is_valuable ? '1' : '0'; } catch(_){ }
    }
    if (claimBtn && requestBtn) {
        if (item.is_valuable) {
            claimBtn.style.display = 'none';
            requestBtn.style.display = 'inline-block';
            requestBtn.disabled = false;
            requestBtn.textContent = 'Request Approval';
            requestBtn.classList.remove('btn-disabled');
        } else {
            claimBtn.style.display = 'inline-block';
            claimBtn.disabled = false;
            claimBtn.textContent = 'Claim';
            claimBtn.classList.remove('btn-disabled');
            requestBtn.style.display = 'none';
        }
    }

    // Update status badge
    if (statusBadge) {
        statusBadge.textContent = statusInfo.text;
        statusBadge.dataset.status = item.status;
    }

    // Image error fallback
    // (Already handled above in img null check)

    // Button event handlers
    if (claimBtn) claimBtn.addEventListener('click', (e) => { e.stopPropagation(); claimItem(String(item.id)); });
    if (requestBtn) requestBtn.addEventListener('click', (e) => { e.stopPropagation(); requestQRApproval(String(item.id)); });
    
    const viewBtn = card.querySelector('.btn-details');
    if (viewBtn) viewBtn.addEventListener('click', (e) => { e.stopPropagation(); viewDetails(String(item.id)); });

    // Make whole card clickable to open item details (mobile-friendly)
    try {
        card.classList.add('clickable-card');
        card.addEventListener('click', (e) => {
            // Ignore clicks on interactive elements inside the card
            const interactive = e.target.closest('button, a, .btn, .item-actions');
            if (interactive) return;
            viewDetails(String(item.id));
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                viewDetails(String(item.id));
            }
        });
    } catch (e) {
        console.warn('Failed to make card clickable', e);
    }

    return cardElement;
}

/**
 * Update the visible action button and status badge based on validation.
 * This swaps between Request Approval and Claim when appropriate, and
 * maintains consistent button styles and disabled states.
 */
function updateItemState(cardEl, validation) {
    if (!cardEl || !validation) return;

    const claimBtn = cardEl.querySelector('[data-action="claim"]');
    const requestBtn = cardEl.querySelector('[data-action="request-approval"]');
    const statusBadge = cardEl.querySelector('.item-status-badge');

    const showBtn = (btn, text, enabled, title = '') => {
        if (!btn) return;
        // Hide both first to avoid flicker
        if (claimBtn) claimBtn.style.display = 'none';
        if (requestBtn) requestBtn.style.display = 'none';
        btn.style.display = 'inline-block';
        // Use textContent for simple, safe label updates
        btn.textContent = text;
        btn.disabled = !enabled;
        btn.title = title || '';
        btn.classList.toggle('btn-disabled', !enabled);
        
        // Add Bootstrap tooltip if title is provided and button is disabled
        if (!enabled && title) {
            btn.setAttribute('data-bs-toggle', 'tooltip');
            btn.setAttribute('data-bs-placement', 'top');
            btn.setAttribute('data-bs-title', title);
            
            // Initialize or update tooltip
            if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
                // Remove existing tooltip instance if any
                const existingTooltip = bootstrap.Tooltip.getInstance(btn);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                // Create new tooltip
                new bootstrap.Tooltip(btn);
            }
        } else {
            // Remove tooltip attributes if button is enabled
            btn.removeAttribute('data-bs-toggle');
            btn.removeAttribute('data-bs-placement');
            btn.removeAttribute('data-bs-title');
            
            // Dispose of existing tooltip instance
            if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
                const existingTooltip = bootstrap.Tooltip.getInstance(btn);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
            }
        }
    };

    // Preserve existing badge color and text; do not mutate status styling here
    const setBadgeStatusFromReason = () => {};

    switch (validation.reason) {
        case 'approved_can_claim':
            // After admin approval for a valuable item, allow the student to proceed
            // with the standard claim flow (face capture -> finalize -> QR generation).
            // UAT requirement: the card should show an enabled "Claim" button.
            showBtn(claimBtn || requestBtn, 'Claim', true);
            setBadgeStatusFromReason('approved_can_claim');
            break;
        case 'item_approved':
            // Item has been approved by admin but user hasn't completed the claim process yet
            showBtn(claimBtn || requestBtn, 'Approved', false, 'This item has been approved for claiming');
            setBadgeStatusFromReason('item_approved');
            break;
        case 'can_claim_directly':
            // Non-valuable items: direct claim is allowed
            showBtn(claimBtn, 'Claim', true);
            setBadgeStatusFromReason('can_claim_directly');
            break;
        case 'pending_approval':
            // While waiting for admin approval, disable interactions and show "Pending"
            showBtn(requestBtn, 'Pending', false, 'Waiting for admin approval');
            setBadgeStatusFromReason('pending_approval');
            break;
        case 'active_qr': {
            // When the user already has a fully registered QR code, show
            // an unclickable "Claim now" to reflect readiness without action here.
            const title = validation.message || 'A QR code is already active for this item';
            showBtn(claimBtn || requestBtn, 'Claim now', false, title);
            setBadgeStatusFromReason('active_qr');
            break;
        }
        case 'has_other_active_claims': {
            const title = validation.message || 'Please complete or cancel your existing claims first';
            // Keep current layout but disable action
            showBtn(claimBtn || requestBtn, (claimBtn ? 'Claim' : 'Request Approval'), false, title);
            setBadgeStatusFromReason('has_other_active_claims');
            break;
        }
        case 'invalid_approving_admin': {
            const title = validation.message || 'Approving admin is no longer valid. Please re-request approval.';
            showBtn(claimBtn || requestBtn, (claimBtn ? 'Claim' : 'Request Approval'), false, title);
            setBadgeStatusFromReason('invalid_approving_admin');
            break;
        }
        case 'item_not_available': {
            const title = 'This item is no longer available for claiming';
            showBtn(claimBtn || requestBtn, (claimBtn ? 'Claim' : 'Request Approval'), false, title);
            setBadgeStatusFromReason('item_not_available');
            break;
        }
        case 'item_approved': {
            const title = validation.message || 'This item has been approved for claiming by another user';
            showBtn(claimBtn || requestBtn, 'Approved', false, title);
            setBadgeStatusFromReason('item_approved');
            break;
        }
        case 'can_request_approval':
            showBtn(requestBtn, 'Request Approval', true);
            setBadgeStatusFromReason('can_request_approval');
            break;
        default:
            // Fallback: prefer enabling request if allowed, else disable
            if (validation.can_request) {
                showBtn(requestBtn, 'Request Approval', true);
                setBadgeStatusFromReason('can_request_approval');
            } else {
                // Default to disabling whichever is visible initially
                const visibleBtn = claimBtn && claimBtn.style.display !== 'none' ? claimBtn : requestBtn;
                showBtn(visibleBtn, visibleBtn === claimBtn ? 'Claim' : 'Request Approval', false, validation.message || 'Action not available');
                setBadgeStatusFromReason('item_not_available');
            }
            break;
    }

    // Do not alter the badge UI; server-provided status styling remains intact
}
// Determine current count of rendered item cards
function getRenderedItemCount() {
    try {
        const grid = document.getElementById('itemsGrid');
        if (!grid) return 0;
        return grid.querySelectorAll('.item-card').length;
    } catch { return 0; }
}

// Apply grid layout classes based on item count
function applyGridLayout(count) {
    const grid = document.getElementById('itemsGrid');
    if (!grid) return;

    // If in list view, do nothing; grid classes apply only to grid view
    const isListView = grid.classList.contains('items-list') || (document.body.dataset.itemsView === 'list');
    if (isListView) return;

    // Ensure base class and remove previous dynamic classes
    grid.classList.remove('grid-1', 'grid-2', 'grid-3');
    if (!grid.classList.contains('items-grid')) {
        grid.classList.add('items-grid');
    }

    if (count <= 1) {
        grid.classList.add('grid-1');
    } else if (count === 2) {
        grid.classList.add('grid-2');
    } else {
        grid.classList.add('grid-3');
    }
}

// Utility functions
function escapeHtml(str) {
    if (typeof str !== 'string') {
        if (str === null || str === undefined) return '';
        return String(str);
    }
    return str.replace(/[&<>"'`]/g, function(s) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#96;'
        };
        return map[s] || s;
    });
}

function getStatusText(status) {
    const statusMap = {
        'available': 'Available',
        'processing': 'Processing',
        'claimed': 'Claimed',
        'pending': 'Pending',
        'unclaimed': 'Unclaimed',
        'returned': 'Returned',
        'overdue': 'Overdue',
        'donated': 'Donated',
        'discarded': 'Discarded'
    };
    return statusMap[status] || 'Unknown';
}

// Fetch QR registration status for an item
async function fetchQRStatus(itemId){
    try {
        // Use user-specific QR status endpoint so we only block actions for the current student's own active QR
        const res = await fetch(`/user/api/qr/status/${encodeURIComponent(itemId)}/me`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data && data.error ? data.error : `Failed to get QR status (${res.status})`);
        }
        // Expected: { registered: bool, active: bool, expires_at?: string }
        return data;
    } catch (err) {
        console.warn('QR status fetch error:', err);
        return { registered: false, active: false };
    }
}

// Apply QR status to a specific card and centrally update its UI (button + badge)
async function applyQRStatusToCard(cardEl, itemId){
    // We now use a centralized updater (updateItemState) so the card can
    // automatically switch between "Request Approval" and "Claim" when
    // server-side status changes, without requiring a page reload.
    if (!cardEl || !itemId) return;

    try {
        if (!navigator.onLine) return;
        const key = String(itemId);
        const cached = validationCache.get(key);
        let validation;
        if (cached && (Date.now() - cached.ts) < VALIDATION_TTL_MS) {
            validation = cached.data;
        } else {
            const response = await fetch(`/user/api/qr/validation/${encodeURIComponent(itemId)}/me`);
            if (!response.ok) {
                return;
            }
            validation = await response.json();
            validationCache.set(key, { ts: Date.now(), data: validation });
        }
        if (validation) {
            try { updateItemState(cardEl, validation); } catch(_){}
            const r = validation.reason;
            if (r === 'pending_approval' || r === 'approved_can_claim' || r === 'active_qr') {
                window.userClaimState.hasActive = true;
                window.userClaimState.status = (r === 'approved_can_claim') ? 'approved' : (r === 'active_qr' ? 'active' : 'pending');
                window.userClaimState.claimItemId = String(itemId);
                updateButtonsUI();
            }
        }
    } catch (_) { }
}

// Helper function to determine status class from validation
function getStatusClassFromValidation(validation) {
    switch (validation.reason) {
        case 'pending_approval':
            return 'status-pending';
        case 'active_qr':
            return 'status-pending';
        case 'item_not_available':
            return 'status-unavailable';
        case 'approved_can_claim':
            return 'status-available';
        case 'item_approved':
            return 'status-available';
        case 'can_request_approval':
            return 'status-available';
        case 'can_claim_directly':
            return 'status-available';
        default:
            return 'status-available';
    }
}

// Helper function to determine status text from validation
function getStatusTextFromValidation(validation) {
    switch (validation.reason) {
        case 'pending_approval':
            return 'Pending';
        case 'active_qr':
            // Show QR Active status; keep concise text on cards
            return 'QR Active';
        case 'item_not_available':
            return 'Not Available';
        case 'approved_can_claim':
            // After approval, reflect approval on the badge
            return 'Approved';
        case 'item_approved':
            return 'Approved';
        default:
            return 'Unclaimed';
    }
}

function getCategoryIcon(category) {
    const iconMap = {
        'electronics': 'fas fa-laptop',
        'clothing': 'fas fa-tshirt',
        'accessories': 'fas fa-glasses',
        'books': 'fas fa-book',
        'personal': 'fas fa-user',
        'jewelry': 'fas fa-gem',
        'bags': 'fas fa-briefcase',
        'keys': 'fas fa-key',
        'documents': 'fas fa-file-alt',
        'sports': 'fas fa-football-ball',
        'other': 'fas fa-question-circle'
    };
    return iconMap[category?.toLowerCase()] || 'fas fa-tag';
}

function formatDate(dateInput) {
    try {
        // Handle Firestore Timestamp ({seconds, nanoseconds})
        if (dateInput && typeof dateInput === 'object') {
            if ('seconds' in dateInput) {
                const ms = (dateInput.seconds * 1000) + Math.floor((dateInput.nanoseconds || 0) / 1e6);
                const d = new Date(ms);
                return d.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
            }
            // Handle ISO string in nested field (e.g., { _iso: '2025-10-01T...' })
            if ('_iso' in dateInput && typeof dateInput._iso === 'string') {
                const d = new Date(dateInput._iso);
                return isNaN(d) ? 'Unknown Date' : d.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
            }
        }
        // Handle numeric epoch or numeric string
        if (typeof dateInput === 'number' || (typeof dateInput === 'string' && /^\d+$/.test(dateInput))) {
            const d = new Date(Number(dateInput));
            return isNaN(d) ? 'Unknown Date' : d.toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
        }
        // Fallback: assume ISO date string
        const d = new Date(dateInput);
        return isNaN(d) ? 'Unknown Date' : d.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    } catch(e) {
        console.warn('formatDate: failed to parse', dateInput, e);
        return 'Unknown Date';
    }
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (searchInput && searchBtn) {
        searchInput.addEventListener('input', debounce(performSearch, 500));
        searchBtn.addEventListener('click', performSearch);
        
        // Enter key support
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    // View toggle buttons
    const headerViewBtns = document.querySelectorAll('.view-btn');
    headerViewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const viewType = btn.dataset.view || 'grid';
            toggleView(viewType);
        });
    });

    // Filter functionality
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const locationFilter = document.getElementById('locationFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    
    if (categoryFilter) categoryFilter.addEventListener('change', applyFilters);
    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
    if (locationFilter) locationFilter.addEventListener('change', applyFilters);
    if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);

    // Sort functionality
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', loadFoundItems);
    }
}

function updateItemsCount() {
    const itemCards = document.querySelectorAll('.item-card');
    const itemsCount = document.getElementById('itemsCount');
    const totalItems = document.getElementById('totalItems');
    
    if (itemsCount && totalItems) {
        const count = itemCards.length;
        itemsCount.textContent = count;
        totalItems.textContent = count;
    }
}

function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // Add real-time search functionality
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                performSearch(this.value);
            }, 300);
        });
    }
}

function initializeFilters() {
    // Set default filter values if needed
    const sortFilter = document.getElementById('sortFilter');
    if (sortFilter && !sortFilter.value) {
        sortFilter.value = 'newest';
    }
}

function handleSearch(event) {
    event.preventDefault();
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    
    showLoadingState();
    
    // Simulate search delay
    setTimeout(() => {
        performSearch(searchTerm);
        hideLoadingState();
    }, 500);
}

// Perform search
function performSearch() {
    const searchTerm = document.getElementById('searchInput').value.trim();
    currentFilters.search = searchTerm;
    currentPage = 1; // Reset to first page
    loadFoundItemsLegacy();
}

// Map UI status values to backend status values
function mapStatusToBackend(uiStatus) {
    // The user API for found items expects 'unclaimed' for items shown as 'Available' in the UI.
    // Keep other statuses as-is if they match backend values.
    const map = {
        'available': 'unclaimed',
        'unclaimed': 'unclaimed',
        'claimed': 'claimed',
        'returned': 'returned',
        'pending': 'pending',
        'processing': 'processing'
    };
    return map[uiStatus] || uiStatus;
}

// View toggle removed: grid view is default and responsive for mobile

function handleFilterChange(event) {
    const filter = event.target;
    const filterType = filter.id;
    const filterValue = filter.value;
    
    console.log(`Filter changed: ${filterType} = ${filterValue}`);
    
    // Apply filters
    applyFilters();
}

// Apply filters
function applyFilters() {
    const categoryFilter = document.getElementById('categoryFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    const locationFilter = document.getElementById('locationFilter').value;
    
    currentFilters.category = categoryFilter;
    // Translate UI status to backend expected value
    currentFilters.status = mapStatusToBackend(statusFilter);
    currentFilters.location = locationFilter;
    currentPage = 1; // Reset to first page
    
    loadFoundItemsLegacy();
}

function sortItems(cards, sortType) {
    const container = document.getElementById('itemsGrid');
    if (!container) return;
    
    const sortedCards = [...cards].sort((a, b) => {
        switch (sortType) {
            case 'newest': {
                // Sort by numeric ms timestamp stored in data-date (fallback to parsed .item-date)
                const dateA = Number(a.dataset.date || 0) || new Date(a.querySelector('.item-date')?.textContent || '').getTime();
                const dateB = Number(b.dataset.date || 0) || new Date(b.querySelector('.item-date')?.textContent || '').getTime();
                return dateB - dateA;
            }
            case 'oldest': {
                const dateA = Number(a.dataset.date || 0) || new Date(a.querySelector('.item-date')?.textContent || '').getTime();
                const dateB = Number(b.dataset.date || 0) || new Date(b.querySelector('.item-date')?.textContent || '').getTime();
                return dateA - dateB;
            }
            case 'location': {
                // Sort by location alphabetically (use data attribute when available)
                const locationA = (a.dataset.location || a.querySelector('.item-location')?.textContent || '').toLowerCase();
                const locationB = (b.dataset.location || b.querySelector('.item-location')?.textContent || '').toLowerCase();
                return locationA.localeCompare(locationB);
            }
            case 'category': {
                // Sort by category alphabetically (use data attribute when available)
                const categoryA = (a.dataset.category || a.querySelector('.item-category')?.textContent || '').toLowerCase();
                const categoryB = (b.dataset.category || b.querySelector('.item-category')?.textContent || '').toLowerCase();
                return categoryA.localeCompare(categoryB);
            }
            default:
                return 0;
        }
    });
    
    // Reorder DOM elements
    sortedCards.forEach(card => {
        container.appendChild(card);
    });
}

function toggleEmptyState(show) {
    let emptyState = document.querySelector('.empty-state');
    
    if (show && !emptyState) {
        // Create empty state
        emptyState = document.createElement('div');
        emptyState.className = 'empty-state text-center py-5';
        emptyState.innerHTML = `
            <div class="empty-icon mb-4">
                <i class="fas fa-search fa-4x text-muted"></i>
            </div>
            <h3 class="empty-title h4 mb-3">No Items Found</h3>
            <p class="empty-description text-muted mb-4">
                No items match your current search criteria. Try adjusting your filters or search terms.
            </p>
            <div class="d-flex gap-2 justify-content-center">
                <button class="btn btn-outline-secondary" onclick="clearFilters()">
                    <i class="fas fa-times me-2"></i>Clear Filters
                </button>
                <button class="btn btn-outline-secondary" onclick="location.reload()">
                    <i class="fas fa-refresh me-2"></i>Refresh
                </button>
            </div>
        `;
        
        const itemsGrid = document.getElementById('itemsGrid');
        if (itemsGrid) {
            itemsGrid.appendChild(emptyState);
        }
    } else if (!show && emptyState) {
        emptyState.remove();
    }
}

// Reset all filters back to defaults and reload
function clearFilters() {
    const categoryEl = document.getElementById('categoryFilter');
    const statusEl = document.getElementById('statusFilter');
    const locationEl = document.getElementById('locationFilter');
    const searchEl = document.getElementById('searchInput');

    if (categoryEl) categoryEl.value = '';
    if (statusEl) statusEl.value = '';
    if (locationEl) locationEl.value = '';
    if (searchEl) searchEl.value = '';

    currentFilters = {
        search: '',
        category: '',
        status: '',
        location: ''
    };
    currentPage = 1;
    loadFoundItemsLegacy();
}

// New pagination rendering for Browse Found Items
function updatePagination(pagination) {
  try {
    if (!pagination) return;
    // Sync globals
    currentPage = Number(pagination.current_page) || currentPage;
    totalPages = Number(pagination.total_pages) || totalPages;

    const container = document.getElementById('pagination');
    if (!container) return;

    // Compute range
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    let html = '<ul class="pagination">';
    // Previous
    html += `
      <li class="page-item ${pagination.has_prev ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${Math.max(1, currentPage - 1)}">
          <i class="fas fa-chevron-left me-1"></i>Previous
        </a>
      </li>
    `;

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      html += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }

    // Next
    html += `
      <li class="page-item ${pagination.has_next ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${Math.min(totalPages, currentPage + 1)}">
          Next<i class="fas fa-chevron-right ms-1"></i>
        </a>
      </li>
    `;
    html += '</ul>';

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.page-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const page = parseInt(this.dataset.page, 10);
        if (!isNaN(page)) {
          navigateToPage(page);
        }
      });
    });
  } catch (err) {
    console.error('Failed to update pagination:', err);
  }
}

// Navigate to a specific page (local to Browse Found Items)
function navigateToPage(page) {
  if (typeof page !== 'number') page = Number(page);
  if (!page || page < 1 || page > totalPages || page === currentPage) return;
  currentPage = page;
  loadFoundItemsLegacy();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.navigateToPage = navigateToPage;

// Update filter options in the UI based on API response
function updateFilterOptions(filters) {
  try {
    // Category filter
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter && Array.isArray(filters?.categories)) {
      const currentValue = categoryFilter.value;
      categoryFilter.innerHTML = '<option value="">All Categories</option>';
      filters.categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        if (category === currentValue) option.selected = true;
        categoryFilter.appendChild(option);
      });
    }

    // Location filter
    const locationFilter = document.getElementById('locationFilter');
    if (locationFilter && Array.isArray(filters?.locations)) {
      const currentValue = locationFilter.value;
      locationFilter.innerHTML = '<option value="">All Locations</option>';
      filters.locations.forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        if (location === currentValue) option.selected = true;
        locationFilter.appendChild(option);
      });
    }

    // Status filter (optional)
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter && Array.isArray(filters?.statuses)) {
      const currentValue = statusFilter.value;
      // Default to showing all statuses
      statusFilter.innerHTML = '<option value="">All Statuses</option>';
      filters.statuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = getStatusText(status);
        if (status === currentValue) option.selected = true;
        statusFilter.appendChild(option);
      });
    }
  } catch (err) {
    console.warn('updateFilterOptions failed:', err);
  }
}

// toggleView removed

// Ensure filter listeners exist (no-op if already attached)
function setupFilterListeners() {
  const categoryFilter = document.getElementById('categoryFilter');
  const statusFilter = document.getElementById('statusFilter');
  const locationFilter = document.getElementById('locationFilter');
  const clearFiltersBtn = document.getElementById('clearFilters');

  const attach = (el, type, handler) => {
    if (!el) return;
    if (!el.dataset.listenerAttached) {
      el.addEventListener(type, handler);
      el.dataset.listenerAttached = '1';
    }
  };

  attach(categoryFilter, 'change', applyFilters);
  attach(statusFilter, 'change', applyFilters);
  attach(locationFilter, 'change', applyFilters);
  if (clearFiltersBtn && !clearFiltersBtn.dataset.listenerAttached) {
    clearFiltersBtn.addEventListener('click', clearFilters);
    clearFiltersBtn.dataset.listenerAttached = '1';
  }
}

function showLoadingState() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
    // Disable interactive buttons globally during async operations to prevent premature actions
    try {
        const buttons = document.querySelectorAll('.item-card button, .item-card .btn, .item-actions button');
        buttons.forEach(btn => {
            if (!btn.disabled) {
                btn.dataset.wasEnabledBeforeLoading = '1';
            }
            btn.disabled = true;
            btn.classList.add('btn-disabled');
            btn.setAttribute('aria-disabled', 'true');
        });
    } catch (e) {
        console.warn('Failed to disable interactive buttons during loading:', e);
    }
}

function hideLoadingState() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
    // Re-enable buttons that we disabled (but do not override buttons already disabled for other reasons)
    try {
        const buttons = document.querySelectorAll('.item-card button, .item-card .btn, .item-actions button');
        buttons.forEach(btn => {
            if (btn.dataset.wasEnabledBeforeLoading === '1') {
                btn.disabled = false;
                btn.classList.remove('btn-disabled');
                btn.removeAttribute('aria-disabled');
                delete btn.dataset.wasEnabledBeforeLoading;
            }
        });
    } catch (e) {
        console.warn('Failed to re-enable interactive buttons after loading:', e);
    }
}

// Generic error state handler
function showErrorState(message) {
    const itemsGrid = document.getElementById('itemsGrid');
    if (itemsGrid) {
        itemsGrid.innerHTML = `<div class="alert alert-danger w-100" role="alert">${escapeHtml(message || 'Something went wrong loading items.')}</div>`;
    }
    showNotification(message || 'Failed to load items. Please try again.', 'error');
}

// Item Action Functions
// Optimistic UI: update local state immediately; backend call in background
async function claimItem(itemId) {
    console.log(`Claiming item ${itemId} with optimistic UI`);
    try {
        window.userClaimState.hasActive = true;
        window.userClaimState.status = 'pending';
        window.userClaimState.claimItemId = String(itemId);
        updateButtonsUI();
        const ok = await userConfirm('Proceed to claim this item?', { type: 'info', title: 'Confirm Action' }); if (!ok) { window.userClaimState.status = 'none'; window.userClaimState.hasActive = false; window.userClaimState.claimItemId = null; updateButtonsUI(); return; }
        const claimResponse = await fetch('/user/api/claims/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
        });
        const claimData = await claimResponse.json().catch(()=>({}));
        if (!claimResponse.ok) {
            showNotification(claimData.error || 'Failed to start claim', 'error');
            window.userClaimState.status = 'none';
            window.userClaimState.hasActive = false;
            window.userClaimState.claimItemId = null;
            updateButtonsUI();
            return;
        }
        const nextStep = claimData.next_step;
        if (nextStep === 'proceed_to_verification') {
            window.userClaimState.status = 'approved';
        } else {
            window.userClaimState.status = 'pending';
        }
        updateButtonsUI();
        showNotification(claimData.message || 'Claim started', 'success');
        // Background sync confirms/rectifies local state after backend completes
        syncUserClaimStateFromBackend().catch(()=>{});
    } catch (error) {
        window.userClaimState.status = 'none';
        window.userClaimState.hasActive = false;
        window.userClaimState.claimItemId = null;
        updateButtonsUI();
        showNotification('An error occurred while processing your claim. Please try again.', 'error');
    }
}

// Helper function to update claim button state
function updateClaimButtonState(itemId, state, text) {
    const cards = document.querySelectorAll('.item-card');
    cards.forEach(card => {
        const cardItemId = card.dataset.itemId || card.getAttribute('data-item-id');
        if (cardItemId === itemId) {
            const claimBtn = card.querySelector('.btn-claim');
            if (claimBtn) {
                claimBtn.disabled = (state === 'disabled');
                claimBtn.innerHTML = `<i class="fas fa-${state === 'disabled' ? 'clock' : 'hand-paper'} me-2"></i>${text}`;
                
                if (state === 'disabled') {
                    claimBtn.classList.add('btn-disabled');
                } else {
                    claimBtn.classList.remove('btn-disabled');
                }
            }
        }
    });
}

// Helper function to update item status badge
function updateItemStatusBadge(itemId, statusText, statusClass) {
    const cards = document.querySelectorAll('.item-card');
    cards.forEach(card => {
        const cardItemId = card.dataset.itemId || card.getAttribute('data-item-id');
        if (cardItemId === itemId) {
            const statusBadge = card.querySelector('.item-status-badge');
            if (statusBadge) {
                statusBadge.textContent = statusText;
                statusBadge.className = `item-status-badge ${statusClass}`;
            }
        }
    });
}

// Legacy implementation kept for backward compatibility in older sections.
// Note: The primary, validated implementation of requestQRApproval is defined earlier in this file.
// This legacy function should NOT override window.requestQRApproval.
async function requestQRApprovalLegacy(itemId) {
    console.log(`Requesting QR approval for item ${itemId}`);

    try {
        // First, validate if the user can proceed with the request
        const validationResponse = await fetch(`/user/api/qr/validation/${itemId}/me`);
        if (!validationResponse.ok) {
            showNotification('Failed to validate request. Please try again.', 'error');
            return;
        }
        
        const validation = await validationResponse.json();
        
        // Check if user can proceed
        if (!validation.can_request) {
            let message = 'Cannot submit approval request: ';
            switch (validation.reason) {
                case 'pending_approval':
                    message += 'You already have a pending approval request for this item.';
                    break;
                case 'active_qr':
                    message += 'You already have an active QR code for this item.';
                    break;
                case 'item_not_available':
                    message += 'This item is no longer available.';
                    break;
                default:
                    message += validation.message || 'Unknown reason.';
            }
            showNotification(message, 'warning');
            return;
        }

        // Show information dialog
        const okVal = await userConfirm('This is a valuable item that requires admin approval. You will need to wait for approval before proceeding with the claim. Continue?', {type:'warning', title:'Valuable Item'}); if (okVal) {
            showLoadingState();

            // Call the approval request endpoint
            const response = await fetch('/user/api/claims/request-approval', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    item_id: itemId,
                    student_remarks: 'Approval request from browse page'
                })
            });

            const result = await response.json();
            hideLoadingState();

            if (response.ok && result.success) {
                // Show success message
                showNotification('Approval request submitted successfully! Please wait for admin approval.', 'success');

                // Find the item card reliably using data-item-id set at render time
                const card = document.querySelector(`.item-card[data-item-id="${itemId}"]`) 
                              || Array.from(document.querySelectorAll('.item-card')).find(el => (el.dataset.itemId === String(itemId)));
                if (card) {
                    // Use the existing applyQRStatusToCard function to update the UI consistently
                    await applyQRStatusToCard(card, itemId);
                } else {
                    // Fallback: iterate visible cards and apply status; helper will fetch validation itself
                    for (const el of document.querySelectorAll('.item-card')) {
                        try { await applyQRStatusToCard(el, itemId); } catch {}
                    }
                }
            } else {
                showNotification(result.message || 'Failed to submit approval request. Please try again.', 'error');
            }
        }
    } catch (error) {
        hideLoadingState();
        console.error('Error requesting approval:', error);
        showNotification('Failed to submit approval request. Please try again.', 'error');
    }
}

function viewDetails(itemId) {
    try {
        if (!itemId) {
            showNotification('Invalid item id', 'error');
            return;
        }
        const url = `/user/found-item-details/${encodeURIComponent(itemId)}`;
        window.location.href = url;
    } catch (e) {
        console.error('Failed to navigate to item details:', e);
        showNotification('Failed to open item details. Please try again.', 'error');
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 100px; right: 20px; z-index: 9999; max-width: 400px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// Export functions for global access
window.claimItem = claimItem;
window.requestQRApproval = requestQRApproval;
window.viewDetails = viewDetails;
window.clearFilters = clearFilters;

function adjustMainPaddingForFooter() {
  const footer = document.querySelector('.user-footer');
  const main = document.querySelector('main');
  if (footer && main) {
    const h = footer.offsetHeight || 200;
    main.style.paddingBottom = `${h + 24}px`;
  }
}
window.addEventListener('load', adjustMainPaddingForFooter);
window.addEventListener('resize', (function(){
  let t;
  return function(){
    clearTimeout(t);
    t = setTimeout(function(){
      adjustMainPaddingForFooter();
      const itemsGrid = document.getElementById('itemsGrid');
      const viewToggle = document.querySelector('.view-toggle');
      if (itemsGrid && viewToggle) {
        const currentView = itemsGrid.classList.contains('items-list') ? 'list' : 'grid';
        document.body.dataset.itemsView = currentView;
        const isMobile = window.matchMedia('(max-width: 576px)').matches;
        viewToggle.style.display = (isMobile && currentView === 'list') ? 'none' : '';
      }
    }, 200);
  };
})());
// Setup delegated image preview interactions (click + keyboard) for item image containers
(function(){
  if (window.__imagePreviewHandlersInitialized) return;
  window.__imagePreviewHandlersInitialized = true;

  document.addEventListener('click', function(e){
    const container = e.target.closest('.item-image-container.clickable-image');
    if (!container) return;
    handleImageClick(e);
  });

  document.addEventListener('keydown', function(e){
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const isClickableContainer = target.classList.contains('item-image-container') && target.classList.contains('clickable-image');
    if (!isClickableContainer) return;
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      handleImageClick({ target });
    }
  });
})();

// Enhanced image click handler with better error handling
// Duplicate handleImageClick definition removed; using the earlier definition.

// Add click handlers for image containers to open modal
function setupImageClickHandlers() {
    // Delegated handlers are initialized at module load to avoid duplicate per-node listeners.
    console.debug('Image preview delegated handlers active');
}

// Thumbnail preloaders to show spinner overlay until images load
function setupImagePreloaders(root = document) {
    const containers = root.querySelectorAll('.item-image-container');
    containers.forEach(container => {
        const img = container.querySelector('img');
        if (!img) return;

        const markLoaded = () => {
            container.classList.remove('loading');
            container.classList.add('loaded');
        };
        const markError = () => {
            container.classList.remove('loading');
            container.classList.add('error');
        };

        if (!img.complete || img.naturalWidth === 0) {
            container.classList.add('loading');
            img.addEventListener('load', markLoaded, { once: true });
            img.addEventListener('error', markError, { once: true });
        } else {
            // Already loaded
            markLoaded();
        }
    });
}

// Enhanced function to create item card HTML with proper structure
function createItemCardHTML_DEPRECATED(item) {
    const statusClass = getStatusClass(item.status);
    const statusIcon = getStatusIcon(item.status);
    const statusText = getStatusText(item.status);
    
    // Format date
    const dateFound = item.time_found ? new Date(item.time_found).toLocaleDateString() : 'Unknown';
    
    // Truncate description if too long
    const description = item.description && item.description.length > 100 
        ? item.description.substring(0, 100) + '...' 
        : item.description || 'No description available';
    
    return `
        <div class="item-card" data-aos="fade-up" data-aos-delay="100">
            <div class="item-image-container">
                <img src="${item.image_url || '/static/images/placeholder-item.jpg'}" 
                     alt="${item.name}" 
                     class="item-image" 
                     loading="lazy"
                     onerror="this.src='/static/images/placeholder-item.jpg'">
                <div class="image-overlay" onclick="openImageModal('${item.image_url || '/static/images/placeholder-item.jpg'}', '${item.name}')">
                    <i class="fas fa-search-plus overlay-icon"></i>
                </div>
                <div class="status-badge ${statusClass}">
                    <i class="fas ${statusIcon}"></i>
                    <span>${statusText}</span>
                </div>
            </div>
            <div class="item-content">
                <h3 class="item-title">${item.name}</h3>
                <p class="item-description">${description}</p>
                <div class="item-meta">
                    <div class="item-meta-row">
                        <i class="fas fa-tag"></i>
                        <span class="item-category">${item.category || 'Uncategorized'}</span>
                    </div>
                    <div class="item-meta-row">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="item-location">${item.location || 'Unknown location'}</span>
                    </div>
                    <div class="item-meta-row">
                        <i class="fas fa-calendar"></i>
                        <span class="item-date">${dateFound}</span>
                    </div>
                </div>
                <div class="item-actions">
                    ${item.status === 'unclaimed' ? `
                        <button class="btn btn-primary claim-btn" data-item-id="${item.id}" onclick="claimItem('${item.id}')">
                            <i class="fas fa-hand-paper"></i>
                            Claim Item
                        </button>
                    ` : `
                        <button class="btn btn-secondary" disabled>
                            <i class="fas fa-check"></i>
                            ${item.status === 'claimed' ? 'Claimed' : 'Unavailable'}
                        </button>
                    `}
                    <button class="btn btn-outline-secondary details-btn" data-item-id="${item.id}" onclick="viewItemDetails('${item.id}')">
                        <i class="fas fa-info-circle"></i>
                        Details
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Helper functions for status handling
function getStatusClass(status) {
    switch(status) {
        case 'unclaimed': return 'status-unclaimed';
        case 'claimed': return 'status-claimed';
        case 'pending': return 'status-pending';
        default: return 'status-unclaimed';
    }
}

function getStatusIcon(status) {
    switch(status) {
        case 'unclaimed': return 'fa-clock';
        case 'claimed': return 'fa-check';
        case 'pending': return 'fa-hourglass-half';
        default: return 'fa-clock';
    }
}

function getStatusText(status) {
    switch(status) {
        case 'unclaimed': return 'Unclaimed';
        case 'claimed': return 'Claimed';
        case 'pending': return 'Pending';
        default: return 'Unclaimed';
    }
}

// Enhanced load found items function
async function loadFoundItemsLegacy2() {
    const itemsGrid = document.getElementById('itemsGrid');
    const loadingState = document.getElementById('itemsLoading');
    const emptyState = document.getElementById('emptyState');
    const itemsCount = document.getElementById('itemsCount');
    const totalItems = document.getElementById('totalItems');
    
    if (!itemsGrid) return;
    
    // Show loading state
    showLoadingState();
    
    try {
        // Build query parameters
        const params = new URLSearchParams({
            page: currentPage,
            per_page: itemsPerPage,
            search: currentFilters.search || '',
            category: currentFilters.category || '',
            status: currentFilters.status || 'unclaimed',
            location: currentFilters.location || ''
        });
        
        const response = await fetch(`/api/found-items?${params}`);
        const data = await response.json();
        
        if (data.success) {
            const items = data.found_items || [];
            
            // Clear existing items (except template and states)
            const existingCards = itemsGrid.querySelectorAll('.item-card:not([style*="display: none"])');
            existingCards.forEach(card => card.remove());
            
            if (items.length === 0) {
                showEmptyState();
            } else {
                hideLoadingAndEmptyStates();
                
                // Create and append item cards
                items.forEach((item, index) => {
                    const cardHTML = createItemCard(item);
                    const cardElement = document.createElement('div');
                    cardElement.innerHTML = cardHTML;
                    const card = cardElement.firstElementChild;
                    
                    // Add staggered animation delay
                    card.setAttribute('data-aos-delay', (index * 100).toString());
                    
                    itemsGrid.appendChild(card);
                });
                
                // Update counters
                if (itemsCount && totalItems) {
                    itemsCount.textContent = items.length;
                    totalItems.textContent = data.pagination?.total_items || items.length;
                }
                
                // Update pagination
                updatePagination(data.pagination);
                
                // Refresh AOS animations
                if (typeof AOS !== 'undefined') {
                    AOS.refresh();
                }
            }
        } else {
            throw new Error(data.message || 'Failed to load items');
        }
    } catch (error) {
        console.error('Error loading found items:', error);
        showErrorState(error.message);
    }
}

// State management functions
function showLoadingState() {
    const loadingState = document.getElementById('itemsLoading');
    const emptyState = document.getElementById('emptyState');
    
    if (loadingState) loadingState.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
}

function showEmptyState() {
    const loadingState = document.getElementById('itemsLoading');
    const emptyState = document.getElementById('emptyState');
    
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
}

function hideLoadingAndEmptyStates() {
    const loadingState = document.getElementById('itemsLoading');
    const emptyState = document.getElementById('emptyState');
    
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
}

function showErrorState(message) {
    const itemsGrid = document.getElementById('itemsGrid');
    const loadingState = document.getElementById('itemsLoading');
    const emptyState = document.getElementById('emptyState');
    
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    
    // Create error state
    const errorHTML = `
        <div class="error-state">
            <div class="error-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3>Error Loading Items</h3>
            <p>${message}</p>
            <button class="btn btn-primary" onclick="loadFoundItemsLegacy()">
                <i class="fas fa-refresh"></i>
                Try Again
            </button>
        </div>
    `;
    
    const errorElement = document.createElement('div');
    errorElement.innerHTML = errorHTML;
    itemsGrid.appendChild(errorElement.firstElementChild);
}

// Item interaction functions
// claimItem function implemented above with comprehensive validation

function viewItemDetails(itemId) {
    // TODO: Implement view details functionality
    console.log('Viewing details for item:', itemId);
    // This would typically open a details modal or redirect to details page
}

// Clear filters function
function clearFilters() {
    currentFilters = {
        search: '',
        category: '',
        status: '',
        location: ''
    };
    currentPage = 1;
    
    // Reset form inputs
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const locationFilter = document.getElementById('locationFilter');
    
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    if (locationFilter) locationFilter.value = '';
    
    // Reload items
    loadFoundItemsLegacy();
}

// New pagination rendering for Browse Found Items
function updatePagination(pagination) {
  try {
    if (!pagination) return;
    // Sync globals
    currentPage = Number(pagination.current_page) || currentPage;
    totalPages = Number(pagination.total_pages) || totalPages;

    const container = document.getElementById('pagination');
    if (!container) return;

    // Compute range
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    let html = '<ul class="pagination">';
    // Previous
    html += `
      <li class="page-item ${pagination.has_prev ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${Math.max(1, currentPage - 1)}">
          <i class="fas fa-chevron-left me-1"></i>Previous
        </a>
      </li>
    `;

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      html += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }

    // Next
    html += `
      <li class="page-item ${pagination.has_next ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${Math.min(totalPages, currentPage + 1)}">
          Next<i class="fas fa-chevron-right ms-1"></i>
        </a>
      </li>
    `;
    html += '</ul>';

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.page-link').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const page = parseInt(this.dataset.page, 10);
        if (!isNaN(page)) {
          navigateToPage(page);
        }
      });
    });
  } catch (err) {
    console.error('Failed to update pagination:', err);
  }
}

// Navigate to a specific page (local to Browse Found Items)
function navigateToPage(page) {
  if (typeof page !== 'number') page = Number(page);
  if (!page || page < 1 || page > totalPages || page === currentPage) return;
  currentPage = page;
  loadFoundItemsLegacy();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.navigateToPage = navigateToPage;

// Update filter options in the UI based on API response
function updateFilterOptions(filters) {
  try {
    // Category filter
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter && Array.isArray(filters?.categories)) {
      const currentValue = categoryFilter.value;
      categoryFilter.innerHTML = '<option value="">All Categories</option>';
      filters.categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        if (category === currentValue) option.selected = true;
        categoryFilter.appendChild(option);
      });
    }

    // Location filter
    const locationFilter = document.getElementById('locationFilter');
    if (locationFilter && Array.isArray(filters?.locations)) {
      const currentValue = locationFilter.value;
      locationFilter.innerHTML = '<option value="">All Locations</option>';
      filters.locations.forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        if (location === currentValue) option.selected = true;
        locationFilter.appendChild(option);
      });
    }

    // Status filter (optional)
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter && Array.isArray(filters?.statuses)) {
      const currentValue = statusFilter.value;
      // Default to showing all statuses
      statusFilter.innerHTML = '<option value="">All Statuses</option>';
      filters.statuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = getStatusText(status);
        if (status === currentValue) option.selected = true;
        statusFilter.appendChild(option);
      });
    }
  } catch (err) {
    console.warn('updateFilterOptions failed:', err);
  }
}

// toggleView duplicate removed

// Ensure filter listeners exist (no-op if already attached)
function setupFilterListeners() {
  const categoryFilter = document.getElementById('categoryFilter');
  const statusFilter = document.getElementById('statusFilter');
  const locationFilter = document.getElementById('locationFilter');
  const clearFiltersBtn = document.getElementById('clearFilters');

  const attach = (el, type, handler) => {
    if (!el) return;
    if (!el.dataset.listenerAttached) {
      el.addEventListener(type, handler);
      el.dataset.listenerAttached = '1';
    }
  };

  attach(categoryFilter, 'change', applyFilters);
  attach(statusFilter, 'change', applyFilters);
  attach(locationFilter, 'change', applyFilters);
  if (clearFiltersBtn && !clearFiltersBtn.dataset.listenerAttached) {
    clearFiltersBtn.addEventListener('click', clearFilters);
    clearFiltersBtn.dataset.listenerAttached = '1';
  }
}

function showLoadingState() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
}

function hideLoadingState() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

// Generic error state handler
function showErrorState(message) {
    const itemsGrid = document.getElementById('itemsGrid');
    if (itemsGrid) {
        itemsGrid.innerHTML = `<div class="alert alert-danger w-100" role="alert">${escapeHtml(message || 'Something went wrong loading items.')}</div>`;
    }
    showNotification(message || 'Failed to load items. Please try again.', 'error');
}

// Item Action Functions
// claimItem function implemented above with comprehensive validation

async function requestQRApproval(itemId) {
    console.log(`Requesting QR approval for item ${itemId}`);
    const okValuable = await userConfirm('This is a valuable item that requires admin approval. Continue?', { type: 'warning', title: 'Valuable Item' }); if (!okValuable) return;
    window.userClaimState.hasActive = true;
    window.userClaimState.status = 'pending';
    window.userClaimState.claimItemId = String(itemId);
    updateButtonsUI();
    try {
        const response = await fetch('/user/api/claims/request-approval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, student_remarks: 'Approval request from browse page' })
        });
        const result = await response.json().catch(()=>({}));
        if (response.ok && result.success) {
            showNotification('Approval request submitted successfully! Please wait for admin approval.', 'success');
            syncUserClaimStateFromBackend().catch(()=>{});
        } else {
            showNotification(result.message || 'Failed to submit approval request. Please try again.', 'error');
            window.userClaimState.status = 'none';
            window.userClaimState.hasActive = false;
            window.userClaimState.claimItemId = null;
            updateButtonsUI();
        }
    } catch (error) {
        showNotification('Failed to submit approval request. Please try again.', 'error');
        window.userClaimState.status = 'none';
        window.userClaimState.hasActive = false;
        window.userClaimState.claimItemId = null;
        updateButtonsUI();
    }
}

function viewDetails(itemId) {
    try {
        if (!itemId) {
            showNotification('Invalid item id', 'error');
            return;
        }
        const url = `/user/found-item-details/${encodeURIComponent(itemId)}`;
        window.location.href = url;
    } catch (e) {
        console.error('Failed to navigate to item details:', e);
        showNotification('Failed to open item details. Please try again.', 'error');
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 100px; right: 20px; z-index: 9999; max-width: 400px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// Export functions for global access
window.claimItem = claimItem;
// Do NOT override window.requestQRApproval here; the primary implementation is bound earlier.
window.viewDetails = viewDetails;
window.clearFilters = clearFilters;

function adjustMainPaddingForFooter() {
  const footer = document.querySelector('.user-footer');
  const main = document.querySelector('main');
  if (footer && main) {
    const h = footer.offsetHeight || 200;
    main.style.paddingBottom = `${h + 24}px`;
  }
}
window.addEventListener('load', adjustMainPaddingForFooter);
window.addEventListener('resize', (function(){
  let t;
  return function(){
    clearTimeout(t);
    t = setTimeout(function(){
      adjustMainPaddingForFooter();
      const itemsGrid = document.getElementById('itemsGrid');
      const viewToggle = document.querySelector('.view-toggle');
      if (itemsGrid && viewToggle) {
        const currentView = itemsGrid.classList.contains('items-list') ? 'list' : 'grid';
        document.body.dataset.itemsView = currentView;
        const isMobile = window.matchMedia('(max-width: 576px)').matches;
        viewToggle.style.display = (isMobile && currentView === 'list') ? 'none' : '';
      }
    }, 200);
  };
})());
// (Removed) duplicate image click listener; delegated handlers are initialized at module load

// Enhanced image click handler with better error handling
function handleImageClick(event) {
    const container = event.target.closest('.item-image-container');
    if (!container) return;

    const card = container.closest('.item-card');
    const img = container.querySelector('.item-image');
    
    if (!img || !card) {
        console.error('Image or card element not found');
        return;
    }
    
    // Get item title for better accessibility
    const titleElement = card.querySelector('.item-title, h5, .card-title');
    const itemTitle = titleElement ? titleElement.textContent.trim() : 'Found Item';
    
    // Get high-resolution image source if available
    const highResSrc = img.dataset.fullsize || img.src;
    
    openImageModal(highResSrc, itemTitle);
}

// Add click handlers for image containers to open modal
// setupImageClickHandlers is now a no-op; delegated handlers are globally installed at module load.

// Global real-time update function for button states after QR generation
window.updateAllItemButtonStates = async function(force = false) {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const now = Date.now();
        if (!navigator.onLine) return;
        const recent = (now - lastGlobalValidationAt) < VALIDATION_TTL_MS;
        const visibleCards = Array.from(document.querySelectorAll('.item-card[data-item-id]')).filter(isElementInViewport);
        await runLimitedQueue(visibleCards, VALIDATION_CONCURRENCY, async (card) => {
            const itemId = card.dataset.itemId;
            if (!itemId) return;
            const cached = validationCache.get(String(itemId));
            if (!force && recent && cached && (now - cached.ts) < VALIDATION_TTL_MS) return;
            try { await window.applyQRStatusToCard(card, itemId); } catch(_){}
        });
        lastGlobalValidationAt = now;
        
        // Update browse-found-items-details.html if we're on that page
        if (window.applyExistingStatusToUI && window.state && window.state.itemId) {
            try {
                await window.applyExistingStatusToUI();
            } catch (error) {
                console.warn('Failed to update details page:', error);
            }
        }
        
        console.log('Real-time button state update completed');
    } catch (error) {
        console.error('Error during real-time button state update:', error);
    } finally {
        isUpdating = false;
    }
};

function isElementInViewport(el){
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= vh && rect.left <= vw;
}

let validationObserver = null;
function observeCardsForValidation(root){
    if (!root) return;
    if (!validationObserver) {
        validationObserver = new IntersectionObserver((entries)=>{
            entries.forEach(entry=>{
                if (!entry.isIntersecting) return;
                const card = entry.target;
                const itemId = card.dataset.itemId;
                if (!itemId) return;
                applyQRStatusToCard(card, itemId);
            });
        }, { threshold: 0.1 });
    }
    root.querySelectorAll('.item-card[data-item-id]').forEach(el=>{
        try { validationObserver.observe(el); } catch(_){ }
    });
}

async function runLimitedQueue(queue, limit, fn){
    const size = Math.min(limit, queue.length);
    let index = 0;
    const workers = Array.from({ length: size }, async () => {
        while (index < queue.length) {
            const current = queue[index++];
            await fn(current);
        }
    });
    await Promise.all(workers);
}
// Optimistic button rendering: instant updates based only on userClaimState
function updateButtonsUI() {
    const cards = document.querySelectorAll('.item-card[data-item-id]');
    const s = (window.userClaimState && window.userClaimState.status) || 'none';
    const cid = (window.userClaimState && window.userClaimState.claimItemId) || null;
    cards.forEach(card => {
        const itemId = card.dataset.itemId;
        const isValuable = String(card.dataset.valuable).toLowerCase() === '1' || String(card.dataset.valuable).toLowerCase() === 'true';
        const claimBtn = card.querySelector('.btn-claim');
        const requestBtn = card.querySelector('.btn-qr-approval');
        const statusBadge = card.querySelector('.item-status-badge');
        const show = (btn, text, enabled) => {
            if (!btn) return;
            if (claimBtn) claimBtn.style.display = 'none';
            if (requestBtn) requestBtn.style.display = 'none';
            btn.style.display = 'inline-block';
            btn.textContent = text;
            btn.disabled = !enabled;
            btn.classList.toggle('btn-disabled', !enabled);
        };
        if (s === 'none') {
            if (isValuable) { show(requestBtn, 'Request Approval', true); }
            else { show(claimBtn, 'Claim', true); }
            return;
        }
        if (s === 'pending') {
            if (cid && cid === itemId) {
                if (isValuable) { show(requestBtn, 'Pending Approval', false); }
                else { show(claimBtn, 'Pending', false); }
                
            } else {
                if (isValuable) { show(requestBtn, 'Unavailable', false); }
                else { show(claimBtn, 'Unavailable', false); }
            }
            return;
        }
        if (s === 'approved') {
            if (cid && cid === itemId) {
                show(claimBtn, 'Claim Now', true);
            } else {
                if (isValuable) { show(requestBtn, 'Unavailable', false); }
                else { show(claimBtn, 'Unavailable', false); }
            }
            return;
        }
        if (s === 'active') {
            if (isValuable) { show(requestBtn, 'Unavailable', false); }
            else { show(claimBtn, 'Unavailable', false); }
            return;
        }
        if (isValuable) { show(requestBtn, 'Request Approval', true); }
        else { show(claimBtn, 'Claim', true); }
    });
}

async function syncUserClaimStateFromBackend() {
    try {
        const res = await fetch('/user/api/claims/user-status', { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const hasActiveQr = !!data.has_active_qr;
        const pendingCount = Number(data.pending_claims_count || 0);
        const approvedCount = Number(data.approved_claims_count || 0);
        const activeCount = Number(data.active_claims_count || 0);
        let status = 'none';
        if (hasActiveQr || activeCount > 0) status = 'active';
        else if (approvedCount > 0) status = 'approved';
        else if (pendingCount > 0) status = 'pending';
        const hasAny = (status !== 'none');
        window.userClaimState.hasActive = hasAny;
        window.userClaimState.status = status;
        // Do not alter claimItemId here; only set it on explicit user actions or item-specific validations
        updateButtonsUI();
    } catch(_){ }
}

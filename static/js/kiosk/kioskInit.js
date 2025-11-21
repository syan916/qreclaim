/**
 * Kiosk Mode Initialization
 * Handles manual controls and canvas synchronization
 * Firebase configuration is handled in the HTML template
 */

// Development-only Firebase config helper
function showConfigHelper() {
    const helper = document.getElementById('config-helper');
    if (helper) {
        helper.classList.remove('hidden');
    }
}

function hideConfigHelper() {
    const helper = document.getElementById('config-helper');
    if (helper) {
        helper.classList.add('hidden');
    }
}

function applyFirebaseConfig() {
    const configText = document.getElementById('firebase-config-textarea')?.value;
    if (configText) {
        try {
            const config = JSON.parse(configText);
            localStorage.setItem('firebaseConfig', JSON.stringify(config));
            alert('Firebase config applied. Please refresh the page.');
            location.reload();
        } catch (error) {
            alert('Invalid JSON format. Please check your configuration.');
        }
    }
}

// Manual controls wiring
function setupManualControls() {
    const restartButton = document.getElementById('restart-scanner');
    if (restartButton) {
        restartButton.addEventListener('click', function() {
            console.log('Manual restart requested');
            if (window.kioskApp && typeof window.kioskApp.restartQRScanner === 'function') {
                window.kioskApp.restartQRScanner();
            } else {
                console.warn('KioskApp not ready or restartQRScanner method unavailable');
            }
        });
    }

    // Setup config helper buttons
    const applyConfigBtn = document.getElementById('apply-config');
    const closeConfigBtn = document.getElementById('close-config');
    
    if (applyConfigBtn) {
        applyConfigBtn.addEventListener('click', applyFirebaseConfig);
    }
    
    if (closeConfigBtn) {
        closeConfigBtn.addEventListener('click', hideConfigHelper);
    }
}

// Canvas size synchronization for face verification
function syncCanvasSize() {
    try {
        const video = document.getElementById('verification-video');
        const canvas = document.getElementById('verification-canvas');
        if (!video || !canvas) return;
        
        function updateCanvasSize() {
            const vw = video.videoWidth || 0;
            const vh = video.videoHeight || 0;
            // Guard against zero-size video metadata
            if (vw <= 0 || vh <= 0) {
                // Fallback to typical SD dimensions to prevent 0-size canvas
                canvas.width = 640;
                canvas.height = 480;
                return;
            }
            // Set canvas drawing buffer size to match actual video resolution
            canvas.width = vw;
            canvas.height = vh;
            canvas.style.width = video.clientWidth + 'px';
            canvas.style.height = video.clientHeight + 'px';
        }
        
        video.addEventListener('loadedmetadata', updateCanvasSize, { once: false });
        video.addEventListener('resize', updateCanvasSize);
        
        // Initial sync
        if (video.videoWidth && video.videoHeight) {
            updateCanvasSize();
        } else {
            // Fallback sync shortly after DOM load
            setTimeout(updateCanvasSize, 500);
        }
        
        // Re-sync on window resize
        window.addEventListener('resize', updateCanvasSize);
    } catch (e) {
        console.warn('Failed to sync canvas size:', e);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    setupManualControls();
    syncCanvasSize();
    
    // Show config helper if needed (development only)
    if (localStorage.getItem('showConfigHelper') === 'true') {
        showConfigHelper();
    }
});

// Export functions for use in other modules
window.KioskInit = {
    showConfigHelper,
    hideConfigHelper,
    applyFirebaseConfig
};
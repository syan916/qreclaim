/**
 * Kiosk Application Main Controller
 * Orchestrates QR scanning, verification, and locker operations
 */

class KioskApp {
    constructor() {
        // Module instances
        this.qrScanner = null;
        this.faceVerifier = null;
        this.rfidVerifier = null;
        this.lockerController = null;
        
        // State
        this.currentClaim = null;
        this.isProcessing = false;
        this._lastNoQRErrorTime = 0; // For filtering continuous "no QR" errors
        // Enhanced state tracking to control scanner restarts and error recovery
        this.state = {
            scanning: false,
            processingFailed: false,
            claimSuccess: false,
            lastScannedQR: null, // normalized data from QRScanner.validateQRFormat
            lastRawQR: null,     // raw decoded text for potential retry
            errorState: null,    // { code, message, severity }
            // Track current UI mode: 'qr' | 'face'
            mode: 'qr'
        };
        // Simple metrics for monitoring
        this.metrics = {
            scans: 0,
            successes: 0,
            failures: 0,
            permissionErrors: 0,
            networkErrors: 0
        };
        
        // UI elements
        this.elements = {};
        
        // Audio context for feedback sounds
        this.audioContext = null;
        this.audioEnabled = true;
        
        // Constants
        this.RESET_DELAY = 3000; // 3 seconds (kept for legacy callers, but manual restart is preferred)
        this.VERIFICATION_TIMEOUT = 60000; // 60 seconds timeout for verification processes
        this.RFID_TIMEOUT = 60000; // 60 seconds for RFID verification
        this.FACE_TIMEOUT = 60000; // 60 seconds for face verification
        // Timer id for face verification timeout
        this._faceTimeoutId = null;
        this._faceTimeoutTriggered = false;
        // Auto-restart configuration (kiosk automation)
        this.INVALID_QR_RESET_DELAY = 4000; // restart after invalid QR (4s)
        this.FACE_FAIL_RESET_DELAY = 5000; // restart after face timeout/mismatch (5s)
        this.SUCCESS_RESET_DELAY = 8000; // restart after successful claim (8s)
        this._restartCountdownInterval = null;
        
        // Visual feedback elements
        this.qrOverlay = null;
        this.qrStatusText = null;
        this.qrSuccessAnimation = null;

        // Accessibility features
        this.announcements = null; // For screen reader announcements
        this.keyboardShortcuts = new Map();

        // Feature flags / integration switches
        // Enable the new FaceCaptureHelper-based flow by default to mirror registration preprocessing
        // If CDN access is blocked or helper fails to initialize, we will gracefully fall back to the
        // legacy face-api.js descriptor-based verification.
        this.useFaceCaptureHelper = true;
    }

    /**
     * Initialize the kiosk application
     */
    async init() {
        try {
            this.log('info', '🚀 Initializing Qreclaim Kiosk...');

            // Cache UI elements
            this.cacheElements();
            
            // Initialize step management
            this.currentStep = 1;
            this.maxSteps = 3;

            // Initialize loading overlay
        this.initializeLoadingOverlay();
        
        // Initialize help button
        this.initializeHelpButton();
        
        // Initialize step indicator
        this.updateStepIndicator(1);

            // Initialize audio context
            this.initializeAudio();

            // Initialize accessibility features
            this.initializeAccessibility();

            // Initialize services
            await this.initializeServices();

            // Initialize QR scanner
            await this.startScanning();

            this.showStatus('Ready', 'Scan QR code to begin claim process', 'info');
            
            this.log('info', '✓ Kiosk initialized successfully');
        } catch (error) {
            this.log('error', 'Kiosk initialization error', { error: error.message });
            this.showStatus('Error', 'Failed to initialize kiosk: ' + error.message, 'error');
        }
    }

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            qrReader: document.getElementById('qr-reader'),
            statusCard: document.getElementById('status-card'),
            statusIcon: document.getElementById('status-icon'),
            statusTitle: document.getElementById('status-title'),
            statusMessage: document.getElementById('status-message'),
            progressBar: document.getElementById('progress-bar'),
            videoContainer: document.getElementById('video-container'),
            video: document.getElementById('verification-video'),
            canvas: document.getElementById('verification-canvas'),
            claimInfo: document.getElementById('claim-info'),
            qrScannerStatus: document.getElementById('qr-scanner-status'),
            qrScannerSuccess: document.getElementById('qr-scanner-success'),
            // Loading overlay elements
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingTitle: document.getElementById('loading-title'),
            loadingMessage: document.getElementById('loading-message'),
            // Step indicator and instructions
            stepIndicator: document.getElementById('step-indicator'),
            instructionsPanel: document.getElementById('instructions-panel'),
            instructionsTitle: document.getElementById('instructions-title'),
            instructionsList: document.getElementById('instructions-list'),
            helpButton: document.getElementById('help-button'),
            // Dedicated face instruction and feedback zone
            faceInstructionZone: document.getElementById('face-instruction-zone'),
            faceInstructionText: document.getElementById('face-instruction-text'),
            faceFeedback: document.getElementById('face-feedback'),
            feedbackAlignmentItem: document.getElementById('feedback-alignment'),
            feedbackBrightnessItem: document.getElementById('feedback-brightness'),
            feedbackSharpnessItem: document.getElementById('feedback-sharpness'),
            feedbackAlignmentValue: document.getElementById('feedback-alignment-value'),
            feedbackBrightnessValue: document.getElementById('feedback-brightness-value'),
            feedbackSharpnessValue: document.getElementById('feedback-sharpness-value')
        };
        
        // Cache QR overlay elements
        this.qrOverlay = document.querySelector('.qr-scanner-overlay');
        this.qrStatusText = this.elements.qrScannerStatus;
        this.qrSuccessAnimation = this.elements.qrScannerSuccess;

        // Cache face scanner overlay elements
        this.faceScannerOverlay = document.getElementById('face-scanner-overlay');
        this.faceScannerFrame = this.faceScannerOverlay ? this.faceScannerOverlay.querySelector('.face-scanner-frame') : null;
    }

    /**
     * Initialize all services
     */
    async initializeServices() {
        // Initialize Firebase
        await firebaseService.init();

        // Initialize modules
        this.faceVerifier = new FaceVerifier();
        this.rfidVerifier = new RFIDVerifier();
        this.lockerController = new LockerController();

        this.log('info', '✓ Services initialized');
    }

    /**
     * Initialize audio context for feedback sounds
     */
    initializeAudio() {
        try {
            // Create audio context on first user interaction
            const createAudioContext = () => {
                if (!this.audioContext) {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
            };

            // Create audio context on first user interaction
            document.addEventListener('click', createAudioContext, { once: true });
            document.addEventListener('touchstart', createAudioContext, { once: true });

            this.log('info', '✓ Audio context initialized');
        } catch (error) {
            this.log('warn', 'Audio initialization failed', { error: error.message });
            this.audioEnabled = false;
        }
    }

    /**
     * Initialize loading overlay
     */
    initializeLoadingOverlay() {
        // Add loading class to status card for enhanced animations
        this.elements.statusCard.classList.add('loading');
    }

    /**
     * Show loading overlay
     */
    showLoadingOverlay(title = 'Processing...', message = 'Please wait while we process your request') {
        if (this.elements.loadingOverlay) {
            this.elements.loadingTitle.textContent = title;
            this.elements.loadingMessage.innerHTML = message + '<span class="loading-dots"></span>';
            this.elements.loadingOverlay.classList.add('active');
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoadingOverlay() {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.remove('active');
        }
    }

    /**
     * Hide QR and Face scanner frames/overlays to avoid visual clutter when showing status messages
     * Useful on success screens where we no longer need the scanning frames.
     */
    hideScannerFrames() {
        try {
            if (this.qrOverlay) {
                this.qrOverlay.style.opacity = '0';
            }
            if (this.faceScannerOverlay) {
                this.faceScannerOverlay.style.opacity = '0';
            }
            // Ensure video container is hidden
            if (this.elements.videoContainer) {
                this.elements.videoContainer.classList.add('hidden');
                this.elements.videoContainer.classList.remove('overlay-video');
            }
        } catch (e) {
            this.log('warn', 'Failed to hide scanner frames', { error: e.message });
        }
    }

    /**
     * Update step indicator
     */
    updateStepIndicator(step) {
        this.currentStep = step;
        
        // Update all steps
        for (let i = 1; i <= this.maxSteps; i++) {
            const stepElement = document.getElementById(`step-${i}`);
            if (!stepElement) continue;
            
            stepElement.classList.remove('active', 'completed');
            
            if (i < step) {
                stepElement.classList.add('completed');
            } else if (i === step) {
                stepElement.classList.add('active');
            }
        }
        
        // Update instructions based on current step
        this.updateInstructions(step);
    }

    /**
     * Update instructions based on current step
     */
    updateInstructions(step) {
        const instructions = {
            1: {
                title: 'How to Scan Your QR Code',
                items: [
                    'Position your <strong>QR code</strong> within the scanner frame',
                    'Keep your phone steady until the code is recognized',
                    'Ensure good lighting for better scanning',
                    'If scanning fails, try adjusting the distance'
                ]
            },
            2: {
                title: 'Identity Verification',
                items: [
                    'Look at the camera for <strong>face verification</strong>',
                    'Remove glasses or hats if asked',
                    'Stand still during the verification process',
                    'Alternative: Tap your <strong>RFID card</strong> on the reader'
                ]
            },
            3: {
                title: 'Collect Your Item',
                items: [
                    'Wait for the <strong>locker to open automatically</strong>',
                    'Collect your item from the locker',
                    'Close the locker door firmly',
                    'Your claim is now complete!'
                ]
            }
        };
        
        const instruction = instructions[step] || instructions[1];
        this.elements.instructionsTitle.textContent = instruction.title;
        
        // Update instruction list
        this.elements.instructionsList.innerHTML = instruction.items
            .map(item => `<li>${item}</li>`)
            .join('');
    }

    /**
     * Show help overlay with detailed instructions
     */
    showHelp() {
        const helpContent = {
            title: 'Need Help?',
            message: 'This kiosk helps you claim your lost items securely.',
            instructions: [
                'Step 1: Scan the QR code sent to your email',
                'Step 2: Verify your identity using face recognition',
                'Step 3: Collect your item from the assigned locker',
                'If you encounter issues, please contact staff for assistance.'
            ]
        };
        
        // Show help in a modal-like overlay
        this.showStatus('info', helpContent.title, helpContent.instructions.join('<br><br>'));
        
        // Extend auto-hide time for help content
        setTimeout(() => {
            this.elements.statusCard.classList.add('hidden');
        }, 10000);
    }

    /**
     * Initialize help button
     */
    initializeHelpButton() {
        this.elements.helpButton.addEventListener('click', () => {
            this.playSound('scan'); // Play feedback sound
            this.showHelp();
        });
        
        // Add keyboard shortcut for help (F1 key)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F1') {
                e.preventDefault();
                this.showHelp();
            }
        });
    }

    /**
     * Play feedback sound
     */
    playSound(type = 'success') {
        if (!this.audioEnabled || !this.audioContext) return;

        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            switch (type) {
                case 'success':
                    oscillator.frequency.setValueAtTime(523.25, this.audioContext.currentTime); // C5
                    oscillator.frequency.setValueAtTime(659.25, this.audioContext.currentTime + 0.1); // E5
                    gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
                    break;
                case 'error':
                    oscillator.frequency.setValueAtTime(200, this.audioContext.currentTime);
                    oscillator.frequency.setValueAtTime(150, this.audioContext.currentTime + 0.1);
                    gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
                    break;
                case 'scan':
                    oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
                    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
                    break;
            }

            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.5);
        } catch (error) {
            console.warn('Sound playback failed:', error);
        }
    }

    /**
     * Update QR scanner visual feedback
     */
    updateQRScannerFeedback(state, message = '') {
        if (!this.qrOverlay) return;

        const frame = this.qrOverlay.querySelector('.qr-scanner-frame');
        const line = this.qrOverlay.querySelector('.qr-scanner-line');
        const statusText = this.qrStatusText;

        switch (state) {
            case 'scanning':
                frame.style.borderColor = 'rgba(52, 152, 219, 0.8)';
                line.style.display = 'block';
                statusText.textContent = message || 'Position QR code within the frame';
                statusText.classList.add('active');
                break;
            case 'detected':
                frame.style.borderColor = 'rgba(243, 156, 18, 0.8)';
                line.style.display = 'block';
                statusText.textContent = message || 'QR code detected, processing...';
                statusText.classList.add('active');
                break;
            case 'success':
                frame.style.borderColor = 'rgba(39, 174, 96, 0.8)';
                line.style.display = 'none';
                statusText.textContent = message || 'QR code scanned successfully!';
                statusText.classList.add('active');
                this.showQRSuccessAnimation();
                this.playSound('success');
                break;
            case 'error':
                frame.style.borderColor = 'rgba(231, 76, 60, 0.8)';
                line.style.display = 'none';
                statusText.textContent = message || 'Invalid QR code';
                statusText.classList.add('active');
                this.playSound('error');
                break;
        }
    }

    /**
     * Show QR success animation
     */
    showQRSuccessAnimation() {
        if (!this.qrSuccessAnimation) return;

        this.qrSuccessAnimation.classList.add('active');
        setTimeout(() => {
            this.qrSuccessAnimation.classList.remove('active');
        }, 600);
    }

    /**
     * Start QR code scanning
     */
    async startScanning() {
        try {
            // Ensure UI is in QR mode before starting scanner (important after face mode)
            if (this.elements.qrReader) {
                this.elements.qrReader.classList.remove('swap-to-face');
            }
            if (this.qrOverlay) {
                this.qrOverlay.style.opacity = '';
            }
            if (this.elements.videoContainer) {
                // Keep video container hidden while scanning; it may already be inside qr-reader
                this.elements.videoContainer.classList.add('hidden');
                this.elements.videoContainer.classList.remove('overlay-video');
            }
            // Stop any face streams if still alive (defensive cleanup)
            if (this.faceVerifier) {
                this.faceVerifier.stopVideo();
            }

            this.qrScanner = new QRScanner(
                'qr-reader',
                this.onQRScanned.bind(this),
                this.onQRScanError.bind(this)
            );

            // Ensure container has non-zero dimensions before starting camera
            this.qrScanner.ensureContainerSize();
            await this.qrScanner.start();
            this.state.scanning = true;
            this.state.mode = 'qr';
            
            // Initialize QR scanner visual feedback
            this.updateQRScannerFeedback('scanning');
            this.updateStepIndicator(1); // Step 1: QR Scanning
            
            // Add scanning animation class to container
            try {
                const el = document.getElementById('qr-reader');
                el && el.classList.add('scanning');
            } catch (_) {}
            
            this.showProgress('Scanning for QR codes...');
        } catch (error) {
            this.log('error', 'Failed to start scanner', { error: error.message });
            this.showStatus('Error', 'Camera access denied or unavailable', 'error');
            this.updateQRScannerFeedback('error', 'Camera access denied');
        }
    }

    /**
     * Handle QR code scan success
     */
    async onQRScanned(decodedText, decodedResult) {
        // Prevent duplicate processing
        if (this.isProcessing) {
            this.log('info', 'Already processing a claim, ignoring scan');
            return;
        }

        this.isProcessing = true;
        this.metrics.scans += 1;
        
        try {
            this.log('info', 'QR Code scanned', { decodedText });
            
            // Update visual feedback for QR detection
            this.updateQRScannerFeedback('detected', 'QR code detected, processing...');
            this.playSound('scan');

            // Stop scanner temporarily
            await this.qrScanner.stop();
            this.state.scanning = false;
            // Remove scanning animation while processing
            try {
                const el = document.getElementById('qr-reader');
                el && el.classList.remove('scanning');
            } catch (_) {}

            // Validate QR format
            const validation = QRScanner.validateQRFormat(decodedText);

            if (!validation.valid) {
                this.updateQRScannerFeedback('error', validation.error || 'Unrecognized QR code format');
                // Show error and automatically restart the scanner after a few seconds
                this.showStatus('Invalid QR', validation.error || 'Unrecognized QR code format', 'error');
                this.startAutoRestartCountdown({
                    seconds: Math.round(this.INVALID_QR_RESET_DELAY/1000),
                    type: 'warning',
                    title: 'Invalid QR',
                    message: 'Unrecognized QR code. Restarting scanner...',
                    immediateSwitch: false
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                return;
            }

            // Show success feedback for valid QR
            this.updateQRScannerFeedback('success', 'QR code valid, processing claim...');

            // Process the claim
            // Cache raw and normalized data for potential retry
            this.state.lastScannedQR = validation.data;
            this.state.lastRawQR = decodedText;
            await this.processClaim(validation.data, decodedText);

        } catch (error) {
            this.log('error', 'QR processing error', { error: error.message });
            this.updateQRScannerFeedback('error', 'Processing failed');
            this.showStatus('Error', error.message, 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
            this.isProcessing = false;
            this.state.processingFailed = true;
        }
    }

    /**
     * Handle QR scan errors with noise filtering
     */
    onQRScanError(error) {
        // Suppress continuous 'NotFoundException' (normal while scanning)
        if (!error) return;
        const msg = typeof error === 'string' ? error : (error.message || String(error));
        if (msg.includes('NotFoundException')) return;

        // Filter out continuous "no QR code detected" errors to reduce console noise
        if (msg.includes('No MultiFormat Readers were able to detect the code')) {
            // This is normal behavior when camera is scanning but no QR is in view
            // Only log this occasionally to avoid console spam
            if (!this._lastNoQRErrorTime || Date.now() - this._lastNoQRErrorTime > 5000) {
                this.log('info', 'QR scanner active - no code detected (this is normal)');
                this._lastNoQRErrorTime = Date.now();
            }
            return;
        }

        // Handle rare getImageData IndexSizeError from underlying canvas with zero width/height
        if (/IndexSizeError|getImageData/gi.test(msg)) {
            console.warn('QR scan IndexSizeError detected — attempting recovery by resizing container and restarting scanner');
            try {
                // Ensure container has minimum dimensions
                this.qrScanner?.ensureContainerSize();
                // Soft-restart scanner
                this.qrScanner?.reset()?.then(() => this.qrScanner?.start());
                return;
            } catch (e) {
                this.log('error', 'Recovery attempt failed', { error: e.message });
            }
        }

        // Enhanced error handling with user-friendly messages
        if (msg.includes('Camera streaming not supported')) {
            this.showStatus('Camera Not Supported', 
                'Your browser does not support camera streaming. Please use Chrome, Firefox, Safari, or Edge.', 'error');
            
            // Show fallback options
            this.showFallbackOptions();
            return;
        }

        if (msg.includes('NotAllowedError') || msg.includes('Camera access denied')) {
            this.showStatus('Camera Access Denied', 
                'Please allow camera access in your browser settings to scan QR codes.', 'error');
            
            // Show camera permission instructions
            this.showPermissionInstructions();
            return;
        }

        if (msg.includes('NotFoundError') || msg.includes('No camera found')) {
            this.showStatus('No Camera Found', 
                'No camera was detected on this device. Please ensure a camera is connected.', 'error');
            return;
        }

        if (msg.includes('NotReadableError') || msg.includes('already in use')) {
            this.showStatus('Camera In Use', 
                'Camera is already in use by another application. Please close other camera apps and try again.', 'error');
            return;
        }

        if (msg.includes('SecurityError') || msg.includes('HTTPS')) {
            this.showStatus('Security Error', 
                'Camera access requires HTTPS or localhost. Please use a secure connection.', 'error');
            return;
        }

        // Default error handling
        this.showStatus('QR Scanner Error', msg, 'error', {
            actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
        });
        this.log('warn', 'QR scan error', { message: msg });
    }

    /**
     * Initialize accessibility features
     */
    initializeAccessibility() {
        // Create screen reader announcement container
        this.createAnnouncementContainer();
        
        // Setup keyboard navigation
        this.setupKeyboardNavigation();
        
        // Add ARIA labels and roles to interactive elements
        this.enhanceARIA();
        
        this.log('info', 'Accessibility features initialized');
    }

    /**
     * Create screen reader announcement container
     */
    createAnnouncementContainer() {
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.classList.add('sr-only');
        announcement.id = 'screen-reader-announcements';
        document.body.appendChild(announcement);
        this.announcements = announcement;
    }

    /**
     * Announce message to screen readers
     */
    announceToScreenReader(message) {
        try {
            if (this.announcements) {
                this.announcements.textContent = message;
                // Clear after announcement to avoid repetition
                setTimeout(() => {
                    if (this.announcements) {
                        this.announcements.textContent = '';
                    }
                }, 1000);
            }
        } catch (error) {
            console.warn('Screen reader announcement failed:', error);
        }
    }

    /**
     * Setup keyboard navigation shortcuts
     */
    setupKeyboardNavigation() {
        document.addEventListener('keydown', (event) => {
            try {
                // Prevent shortcuts when typing in input fields
                if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                    return;
                }

                switch (event.key) {
                    case 'F1':
                        event.preventDefault();
                        this.showHelpOverlay();
                        break;
                    case 'Escape':
                        event.preventDefault();
                        this.hideHelpOverlay();
                        this.hideStatusCard();
                        break;
                    case 'r':
                    case 'R':
                        if (this.state.processingFailed) {
                            event.preventDefault();
                            this.resetToScanning();
                        }
                        break;
                    case 'h':
                    case 'H':
                        event.preventDefault();
                        this.announceToScreenReader('Press F1 for help, Escape to close dialogs, R to restart scanning');
                        break;
                }
            } catch (error) {
                console.warn('Keyboard navigation error:', error);
            }
        });
    }

    /**
     * Enhance ARIA labels and roles
     */
    enhanceARIA() {
        // Add labels to main sections
        const qrReader = document.getElementById('qr-reader');
        if (qrReader) {
            qrReader.setAttribute('role', 'region');
            qrReader.setAttribute('aria-label', 'QR Code Scanner');
        }

        const videoContainer = document.getElementById('video-container');
        if (videoContainer) {
            videoContainer.setAttribute('role', 'region');
            videoContainer.setAttribute('aria-label', 'Face Verification Camera');
        }

        // Add descriptive labels to buttons
        const helpButton = document.querySelector('.help-button');
        if (helpButton) {
            helpButton.setAttribute('aria-label', 'Show help and keyboard shortcuts (F1)');
        }

        // Enhance status cards
        const statusCards = document.querySelectorAll('.status-card');
        statusCards.forEach(card => {
            card.setAttribute('role', 'alert');
            card.setAttribute('aria-live', 'assertive');
        });
    }



    /**
     * Hide status card
     */
    hideStatusCard() {
        const statusCard = document.querySelector('.status-card');
        if (statusCard && statusCard.classList.contains('active')) {
            statusCard.classList.remove('active');
        }
    }

    /**
     * Enhanced help overlay with accessibility information
     */
    showHelpOverlay() {
        // Create or get help overlay
        let helpOverlay = document.getElementById('help-overlay');
        if (!helpOverlay) {
            helpOverlay = this.createHelpOverlay();
        }
        
        helpOverlay.classList.add('active');
        helpOverlay.setAttribute('aria-hidden', 'false');
        
        // Focus on the close button for accessibility
        const closeButton = helpOverlay.querySelector('.help-close');
        if (closeButton) {
            closeButton.focus();
        }
        
        this.announceToScreenReader('Help overlay opened');
    }

    /**
     * Create help overlay with accessibility information
     */
    createHelpOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'help-overlay';
        overlay.className = 'help-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-labelledby', 'help-title');
        overlay.setAttribute('aria-modal', 'true');
        
        overlay.innerHTML = `
            <div class="help-content">
                <button class="help-close" aria-label="Close help" onclick="kioskApp.hideHelpOverlay()">×</button>
                <h2 id="help-title">Kiosk Help & Keyboard Shortcuts</h2>
                
                <div class="help-section">
                    <h3>How to Use</h3>
                    <ol>
                        <li><strong>Scan QR Code:</strong> Position your QR code within the scanner frame</li>
                        <li><strong>Face Verification:</strong> Look directly at the camera when prompted</li>
                        <li><strong>RFID Verification:</strong> Tap your card when requested</li>
                        <li><strong>Collect Item:</strong> Follow instructions to open the correct locker</li>
                    </ol>
                </div>
                
                <div class="help-section">
                    <h3>Keyboard Shortcuts</h3>
                    <ul>
                        <li><kbd>F1</kbd> - Show this help</li>
                        <li><kbd>Escape</kbd> - Close dialogs</li>
                        <li><kbd>R</kbd> - Restart scanning (when available)</li>
                        <li><kbd>H</kbd> - Hear keyboard shortcuts</li>
                    </ul>
                </div>
                
                <div class="help-section">
                    <h3>Accessibility Features</h3>
                    <ul>
                        <li>Screen reader announcements for status updates</li>
                        <li>Keyboard navigation support</li>
                        <li>High contrast mode compatibility</li>
                        <li>Reduced motion support</li>
                        <li>Large text mode support</li>
                    </ul>
                </div>
                
                <div class="help-section">
                    <h3>Need More Help?</h3>
                    <p>If you need assistance, please contact staff or press the call button if available.</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Hide help overlay
     */
    hideHelpOverlay() {
        const helpOverlay = document.getElementById('help-overlay');
        if (helpOverlay) {
            helpOverlay.classList.remove('active');
            helpOverlay.setAttribute('aria-hidden', 'true');
            this.announceToScreenReader('Help overlay closed');
        }
    }

    /**
     * Test harness hook: unified QR error handler
     * Accepts either a string or Error object and delegates to onQRScanError.
     * This keeps our internal error handling in one place while allowing
     * test-kiosk-mode.html to simulate different error flows.
     */
    _handleQrError(err) {
        try {
            const message = (typeof err === 'string')
                ? err
                : (err && err.message ? err.message : String(err));
            // Log for diagnostics but avoid deep nesting in conditionals
            this.log('error', 'QR error (test harness)', {
                message,
                name: err && err.name ? err.name : undefined
            });
            // Delegate to production error handler
            this.onQRScanError(message);
        } catch (e) {
            // Fall back to a generic status update to avoid silent failures
            this.showStatus('QR Scanner Error', e && e.message ? e.message : 'Unexpected error in _handleQrError', 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
        }
    }

    /**
     * Process claim verification
     */
    async processClaim(qrData, rawQR) {
        try {
            // Step 1: Verify QR code with backend (happens as part of Step 1 processing)
            this.showProgress('Verifying QR code...');

            // Check network connectivity first
            const isOnline = await this.checkNetworkConnectivity();
            if (!isOnline) {
                this.metrics.networkErrors += 1;
                this.state.errorState = { code: 'NETWORK_OFFLINE', severity: 'error', message: 'Client offline' };
                this.showStatus('Network Error', 'Client is offline. Please check your internet connection.', 'error', {
                    actions: [
                        { id: 'retry-process', label: 'Retry Now', handler: () => this.processClaim(this.state.lastScannedQR, this.state.lastRawQR) },
                        { id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }
                    ]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                return;
            }

            // Verify QR code with backend
            const qrVerification = await this.verifyQRCode(rawQR);

            if (!qrVerification.success) {
                this.metrics.failures += 1;
                this.state.errorState = { code: 'QR_VERIFY_FAILED', severity: 'error', message: qrVerification.error };
                this.showStatus('Invalid QR', qrVerification.error || 'QR verification failed', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                // Auto-restart countdown after QR verification failure
                this.startAutoRestartCountdown(false, 'warning', 'Scanner will restart in a moment...');
                return;
            }

            // Build claim data from QR verification response
            this.currentClaim = {
                claim_id: qrVerification.claim_id,
                student_id: qrVerification.student_id,
                verification_method: qrVerification.verification_method,
                found_item_id: qrVerification.found_item_id,
                status: qrVerification.claim_status,
                expires_at: qrVerification.expires_at
            };

            // Try to get additional details from Firestore, but don't fail if offline
            // or when rules block reads. Surface a friendly info message and continue.
            try {
                const claimResult = await firebaseService.getClaim(qrVerification.claim_id);
                if (claimResult && claimResult.success && claimResult.data) {
                    // Merge Firestore data with QR verification data
                    this.currentClaim = { ...this.currentClaim, ...claimResult.data };
                } else if (claimResult && !claimResult.success) {
                    // Show guidance when Firestore is unavailable or permissions are restricted
                    const msg = claimResult.error || 'Firestore details unavailable.';
                    this.log('warn', 'Limited data mode: proceeding with QR-only details', { error: msg });
                    this.showStatus('Limited Data Mode',
                        'Firestore read is restricted or unavailable. Proceeding with QR-only details. Some features may be limited.',
                        'info',
                        {
                            actions: [
                                {
                                    id: 'retry-firestore',
                                    label: 'Retry Fetch Details',
                                    handler: async () => {
                                        try {
                                            this.showProgress('Retrying claim details from Firestore...');
                                            const retry = await firebaseService.getClaim(qrVerification.claim_id);
                                            if (retry && retry.success && retry.data) {
                                                this.currentClaim = { ...this.currentClaim, ...retry.data };
                                                this.displayClaimInfo(this.currentClaim);
                                                this.showStatus('Info', 'Claim details fetched successfully from Firestore.', 'success');
                                            } else {
                                                const errMsg = (retry && retry.error) ? retry.error : 'Still unable to fetch details.';
                                                this.showStatus('Info', errMsg, 'warning');
                                            }
                                        } catch (err) {
                                            this.showStatus('Error', err.message, 'error');
                                        }
                                    }
                                },
                                { id: 'view-guide', label: 'Permission Fix Guide', handler: () => this.showFirestoreHelp() },
                                { id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }
                            ]
                        }
                    );
                }
            } catch (firestoreError) {
                // Unexpected exception path (e.g., SDK not initialized). Continue gracefully.
                this.log('warn', 'Firestore connection failed, using QR verification data', { error: firestoreError.message });
            }

            // Display claim info
            this.displayClaimInfo(this.currentClaim);

            // Step 2: Verify identity based on verification method (Face Recognition)
            this.updateStepIndicator(2); // Move to Step 2: Identity Verification
            const verifyMethod = this.currentClaim.verification_method;

            if (verifyMethod === 'qr_face' || verifyMethod === 'face') {
                await this.verifyWithFace();
            } else if (verifyMethod === 'qr_rfid' || verifyMethod === 'rfid') {
                await this.verifyWithRFID();
            } else {
                this.metrics.failures += 1;
                this.showStatus('Error', 'Unknown verification method: ' + verifyMethod, 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
            }

        } catch (error) {
            this.log('error', 'Claim processing error', { error: error.message });
            this.metrics.failures += 1;
            this.showStatus('Error', error.message, 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
            this.isProcessing = false;
            this.state.processingFailed = true;
            
            // Auto-restart countdown for general processing errors
            this.startAutoRestartCountdown(false, 'error', 'Scanner will restart in a moment...');
        }
    }

    /**
     * Verify QR code with backend API
     */
    async verifyQRCode(rawQR) {
        try {
            const response = await fetch('/api/qr/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_raw: rawQR })
            });

            const data = await response.json();

            if (!response.ok || !data.valid) {
                return { 
                    success: false, 
                    error: data.error || 'QR verification failed' 
                };
            }

            return {
                success: true,
                claim_id: data.claim_id,
                student_id: data.student_id,
                verification_method: data.verification_method
            };
        } catch (error) {
            console.error('QR verification error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Draw face detection overlay on canvas
     */
    drawFaceOverlay(detection) {
        const canvas = this.elements.canvas;
        const video = this.elements.video;
        const ctx = canvas.getContext('2d');
        
        // Clear previous drawings
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!detection) return;
        
        // Draw video frame as background
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Get detection box
        const box = detection.box || detection;
        const x = box.x || box._x || 0;
        const y = box.y || box._y || 0;
        const width = box.width || box._width || 0;
        const height = box.height || box._height || 0;
        
        // Draw face detection rectangle with corner brackets
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        
        // Draw corner brackets for a cleaner look
        const cornerLength = Math.min(width, height) * 0.2;
        
        // Top-left corner
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLength);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLength, y);
        ctx.stroke();
        
        // Top-right corner
        ctx.beginPath();
        ctx.moveTo(x + width - cornerLength, y);
        ctx.lineTo(x + width, y);
        ctx.lineTo(x + width, y + cornerLength);
        ctx.stroke();
        
        // Bottom-right corner
        ctx.beginPath();
        ctx.moveTo(x + width, y + height - cornerLength);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x + width - cornerLength, y + height);
        ctx.stroke();
        
        // Bottom-left corner
        ctx.beginPath();
        ctx.moveTo(x + cornerLength, y + height);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x, y + height - cornerLength);
        ctx.stroke();
        
        // Add "Face Detected" text
        ctx.fillStyle = '#00ff00';
        ctx.font = '16px Arial';
        ctx.fillText('Face Detected', x, y - 10);
    }

    /**
     * Start face detection overlay animation
     */
    startFaceDetection() {
        if (this.faceDetectionAnimation) {
            cancelAnimationFrame(this.faceDetectionAnimation);
        }
        
        const detectAndDraw = async () => {
            try {
                // Get current face detection
                const detection = await this.faceVerifier.getCurrentFaceDetection();
                if (detection && detection.detection) {
                    this.drawFaceOverlay(detection.detection);
                } else {
                    // Clear canvas if no face detected
                    const canvas = this.elements.canvas;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    // Draw video frame only
                    ctx.drawImage(this.elements.video, 0, 0, canvas.width, canvas.height);
                }
            } catch (error) {
                console.warn('Face detection overlay error:', error);
            }
            
            if (this.faceDetectionActive) {
                this.faceDetectionAnimation = requestAnimationFrame(detectAndDraw);
            }
        };
        
        this.faceDetectionActive = true;
        detectAndDraw();
    }

    /**
     * Stop face detection overlay animation
     */
    stopFaceDetection() {
        this.faceDetectionActive = false;
        if (this.faceDetectionAnimation) {
            cancelAnimationFrame(this.faceDetectionAnimation);
            this.faceDetectionAnimation = null;
        }
        
        // Clear canvas
        const canvas = this.elements.canvas;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    /**
     * Switch UI from QR scanner to face scanner positioned in the same container
     * - Stops QR scanning (if still running)
     * - Hides QR overlay and moves video elements into #qr-reader
     * - Applies smooth transition classes
     */
    async switchToFaceUI() {
        try {
            // Stop QR scanner defensively (onQRScanned already stops, but ensure no camera contention)
            if (this.qrScanner && this.state.scanning) {
                await this.qrScanner.stop();
                this.state.scanning = false;
            }

            // Hide QR overlay and prepare container for face mode
            if (this.elements.qrReader) {
                this.elements.qrReader.classList.add('swap-to-face');
                // Remove scanning animation class
                this.elements.qrReader.classList.remove('scanning');
            }
            if (this.qrOverlay) {
                this.qrOverlay.style.opacity = '0';
            }

            // Move video container into the QR reader and size it as overlay
            if (this.elements.videoContainer && this.elements.qrReader) {
                try {
                    this.elements.qrReader.appendChild(this.elements.videoContainer);
                } catch (_) { /* appendChild is idempotent for same parent */ }
                this.elements.videoContainer.classList.add('overlay-video');
                this.elements.videoContainer.classList.remove('hidden');
                // Make sure face scanner overlay is visible when in face mode
                if (this.faceScannerOverlay) {
                    this.faceScannerOverlay.style.opacity = '1';
                    this.setFaceOverlayState('active'); // default state when switching to face mode
                }
                // Ensure the frame itself is visible (helps when CSS or previous state hid it)
                if (this.faceScannerFrame) {
                    this.faceScannerFrame.style.display = '';
                }
                // Show aspect ratio indicator for square frame
                const aspectIndicator = document.getElementById('aspect-ratio-indicator');
                if (aspectIndicator) {
                    aspectIndicator.classList.add('active');
                }
                // Show the dedicated instruction zone and reset feedback values
                if (this.elements.faceInstructionZone) {
                    this.elements.faceInstructionZone.classList.remove('hidden');
                }
                if (this.elements.faceInstructionText) {
                    this.elements.faceInstructionText.textContent = 'Center your face within the blue frame';
                }
                // Reset feedback values and state classes
                const resetVal = (el) => { if (el) el.textContent = '–'; };
                resetVal(this.elements.feedbackAlignmentValue);
                resetVal(this.elements.feedbackBrightnessValue);
                resetVal(this.elements.feedbackSharpnessValue);
                ['feedbackAlignmentItem','feedbackBrightnessItem','feedbackSharpnessItem'].forEach(k => {
                    const el = this.elements[k];
                    if (el) el.classList.remove('ok','warn','bad');
                });
            }

            // Update mode
            this.state.mode = 'face';
            this.log('info', 'Switched UI to face mode', { overlay: true, container: !!this.elements.videoContainer });
        } catch (e) {
            this.log('warn', 'switchToFaceUI failed', { error: e.message });
        }
    }

    /**
     * Revert UI back to QR scanner mode
     * - Stops face detection and video
     * - Hides video overlay and shows QR overlay
     */
    async switchToQRUI() {
        try {
            // Clear face timeout if any
            if (this._faceTimeoutId) {
                clearTimeout(this._faceTimeoutId);
                this._faceTimeoutId = null;
                this._faceTimeoutTriggered = false;
            }

            // Stop face detection and video, hide elements
            this.stopFaceDetection();
            // Stop FaceCaptureHelper loop if it is running
            try {
                if (this.useFaceCaptureHelper && window.FaceCaptureHelper && typeof window.FaceCaptureHelper.stop === 'function') {
                    window.FaceCaptureHelper.stop();
                }
            } catch (_) { /* ignore */ }
            if (this.faceVerifier) {
                this.faceVerifier.stopVideo();
            }
            if (this.elements.videoContainer) {
                this.elements.videoContainer.classList.add('hidden');
                this.elements.videoContainer.classList.remove('overlay-video');
                if (this.faceScannerOverlay) {
                    this.faceScannerOverlay.style.opacity = '';
                }
                if (this.faceScannerFrame) {
                    this.faceScannerFrame.style.display = 'none';
                }
            }
            // Hide aspect ratio indicator when leaving face mode
            const aspectIndicator = document.getElementById('aspect-ratio-indicator');
            if (aspectIndicator) {
                aspectIndicator.classList.remove('active');
            }
            // Hide instruction/feedback zone and stop feedback loop when leaving face mode
            if (this.elements.faceInstructionZone) {
                this.elements.faceInstructionZone.classList.add('hidden');
            }
            this.stopFaceFeedbackLoop();

            // Restore QR overlay visuals
            if (this.elements.qrReader) {
                this.elements.qrReader.classList.remove('swap-to-face');
                this.elements.qrReader.classList.add('scanning');
            }
            if (this.qrOverlay) {
                this.qrOverlay.style.opacity = '';
            }

            // Restart QR scanner
            if (this.qrScanner) {
                await this.qrScanner.start();
                this.state.scanning = true;
            }
            this.state.mode = 'qr';

            // Dim/disable face overlay visuals when leaving face mode
            if (this.faceScannerOverlay) {
                this.setFaceOverlayState('inactive');
            }

            // Update status
            this.showStatus('Ready', 'Scan QR code to begin claim process', 'info');
            this.log('info', 'Switched UI back to QR mode');
        } catch (e) {
            this.log('warn', 'switchToQRUI failed', { error: e.message });
        }
    }

    /**
     * Start real-time feedback loop using FaceCaptureHelper diagnostics
     * Updates alignment, brightness, and sharpness indicators in the instruction zone.
     */
    startFaceFeedbackLoop() {
        // Avoid duplicate loops
        if (this._feedbackRafId) return;
        const updateItem = (itemEl, valueEl, status, text) => {
            if (valueEl) valueEl.textContent = text;
            if (!itemEl) return;
            itemEl.classList.remove('ok','warn','bad');
            itemEl.classList.add(status);
        };
        const loop = () => {
            // Stop if not in face mode or instruction zone missing
            if (this.state.mode !== 'face' || !this.elements.faceInstructionZone) {
                this._feedbackRafId = null;
                return;
            }
            const d = window.__faceCaptureDiag || {};
            // Alignment
            const alignOk = !!d.lastAlignmentOk;
            updateItem(this.elements.feedbackAlignmentItem, this.elements.feedbackAlignmentValue, alignOk ? 'ok' : 'warn', alignOk ? 'Aligned' : 'Adjust');
            // Brightness
            const b = typeof d.lastBrightness === 'number' ? Math.round(d.lastBrightness) : null;
            if (b !== null) {
                let bStatus = 'ok'; let bText = 'Good';
                if (b < 60) { bStatus = 'bad'; bText = 'Too Low'; }
                else if (b < 85) { bStatus = 'warn'; bText = 'Low'; }
                else if (b > 230) { bStatus = 'bad'; bText = 'Too High'; }
                else if (b > 200) { bStatus = 'warn'; bText = 'Bright'; }
                updateItem(this.elements.feedbackBrightnessItem, this.elements.feedbackBrightnessValue, bStatus, bText);
                d._bStatus = bStatus; // expose for combined decision
            }
            // Sharpness
            const s = typeof d.lastSharpness === 'number' ? d.lastSharpness : null;
            if (s !== null) {
                let sStatus = 'ok'; let sText = 'Good';
                if (s < 1.4) { sStatus = 'bad'; sText = 'Low'; }
                else if (s < 1.7) { sStatus = 'warn'; sText = 'Borderline'; }
                updateItem(this.elements.feedbackSharpnessItem, this.elements.feedbackSharpnessValue, sStatus, sText);
                d._sStatus = sStatus; // expose for combined decision
            }
            // Provide focused instruction if there are specific quality reasons
            if (Array.isArray(d.lastQualityReasons) && d.lastQualityReasons.length && this.elements.faceInstructionText) {
                const r = d.lastQualityReasons[0].toLowerCase();
                let msg = 'Center your face within the blue frame';
                if (r.includes('light')) msg = 'Adjust lighting: avoid backlight and face the camera';
                else if (r.includes('blur')) msg = 'Hold steady for a moment';
                else if (r.includes('frame') || r.includes('outside')) msg = 'Move to center of the blue frame';
                else if (r.includes('size')) msg = 'Move slightly closer/farther';
                else if (r.includes('tilt')) msg = 'Keep your head level';
                this.elements.faceInstructionText.textContent = msg;
            }
            // Toggle overlay visual states to mirror detection quality
            try {
                const allOk = alignOk && (!d._bStatus || d._bStatus === 'ok') && (!d._sStatus || d._sStatus === 'ok');
                const readyOk = alignOk && (d._bStatus !== 'bad') && (d._sStatus !== 'bad') && !allOk;
                if (allOk) {
                    this.setFaceOverlayState('detected');
                } else if (readyOk) {
                    this.setFaceOverlayState('ready');
                } else {
                    this.setFaceOverlayState('active');
                }
            } catch (_) {}
            this._feedbackRafId = requestAnimationFrame(loop);
        };
        this._feedbackRafId = requestAnimationFrame(loop);
    }

    /**
     * Stop the feedback loop if running
     */
    stopFaceFeedbackLoop() {
        if (!this._feedbackRafId) return;
        try { cancelAnimationFrame(this._feedbackRafId); } catch (e) {}
        this._feedbackRafId = null;
    }

    /**
     * Update face scanner overlay visual state
     * - active: default blue frame
     * - ready: amber frame, user almost there
     * - detected: green frame, ready for capture
     * - inactive: dimmed (used when leaving face mode)
     */
    setFaceOverlayState(state = 'active') {
        if (!this.faceScannerOverlay) return;
        const cls = this.faceScannerOverlay.classList;
        cls.remove('ready','detected','inactive');
        if (state === 'ready') cls.add('ready');
        else if (state === 'detected') cls.add('detected');
        else if (state === 'inactive') cls.add('inactive');
        // Announce key transitions for accessibility and kiosk guidance
        if (state === 'ready') {
            this.announceToScreenReader('Face positioned. Hold steady.');
        } else if (state === 'detected') {
            this.announceToScreenReader('Face detected. Capturing.');
            this.playSound('scan');
        }
    }

    /**
     * Verify identity using facial recognition
     */
    async verifyWithFace() {
        try {
            this.updateStepIndicator(2); // Step 2: Identity Verification
            this.showProgress('Preparing face verification...');

            // Swap UI to face verification in the same position as QR scanner
            await this.switchToFaceUI();

            // Early return if no face embedding on claim
            if (!this.currentClaim.face_embedding) {
                this.metrics.failures += 1;
                this.showStatus('Error', 'No face data registered for this claim', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                // Automatically return to Step 1 with a countdown (fully automated kiosk)
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'warning',
                    title: 'Missing Face Data',
                    message: 'No face data registered for this claim.',
                    immediateSwitch: true
                });
                return;
            }

            // Show video container and start camera
            this.elements.videoContainer.classList.remove('hidden');
            this.showProgress('Starting camera...');
            
            // Store initialization parameters for potential restart
            const initParams = {
                videoElement: this.elements.video,
                idealWidth: 640,
                idealHeight: 480, // optimized for face detection
                facingMode: 'user'
            };
            
            const videoReady = await this.faceVerifier.initializeVideo(this.elements.video, initParams);
            if (!videoReady) {
                this.metrics.permissionErrors += 1;
                this.showStatus('Error', 'Failed to access camera', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'error',
                    title: 'Camera Error',
                    message: 'Failed to access camera.',
                    immediateSwitch: true
                });
                return;
            }

            // Set up canvas dimensions to match video
            const setupCanvas = () => {
                const canvas = this.elements.canvas;
                const video = this.elements.video;
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                console.log(`Canvas set to ${canvas.width}x${canvas.height}`);
            };
            
            // Wait for video metadata to load
            if (this.elements.video.videoWidth === 0) {
                await new Promise(resolve => {
                    this.elements.video.onloadedmetadata = () => {
                        setupCanvas();
                        resolve();
                    };
                });
            } else {
                setupCanvas();
            }

            // Start a 60-second timeout window for face verification with performance tracking
            this._faceTimeoutTriggered = false;
            if (this._faceTimeoutId) {
                clearTimeout(this._faceTimeoutId);
            }
            
            const faceStartTime = Date.now();
            this.log('info', 'Starting face verification', { 
                claimId: this.currentClaim.claim_id,
                timeout: this.FACE_TIMEOUT,
                method: this.useFaceCaptureHelper ? 'FaceCaptureHelper' : 'face-api.js'
            });
            
            this._faceTimeoutId = setTimeout(async () => {
                try {
                    this._faceTimeoutTriggered = true;
                    const elapsed = Date.now() - faceStartTime;
                    this.log('warn', 'Face verification timeout', { 
                        elapsed: elapsed,
                        timeout: this.FACE_TIMEOUT 
                    });
                    this.playSound('error');
                    this.showStatus('Timeout', `Face verification timed out after ${Math.round(this.FACE_TIMEOUT/1000)} seconds. Returning to QR scanning...`, 'warning');
                    // Clean up camera resources and revert UI automatically
                    this.stopFaceDetection();
                    try {
                        if (this.useFaceCaptureHelper && window.FaceCaptureHelper && typeof window.FaceCaptureHelper.stop === 'function') {
                            window.FaceCaptureHelper.stop();
                        }
                    } catch (_) { /* ignore */ }
                    if (this.faceVerifier) this.faceVerifier.stopVideo();
                    if (this.elements.videoContainer) this.elements.videoContainer.classList.add('hidden');
                    await this.startAutoRestartCountdown({
                        seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                        type: 'warning',
                        title: 'Timeout',
                        message: `Face verification timed out after ${Math.round(this.FACE_TIMEOUT/1000)} seconds.`,
                        immediateSwitch: true
                    });
                } catch (e) {
                    this.log('warn', 'Timeout cleanup failed', { error: e.message });
                }
            }, this.FACE_TIMEOUT);
            // Prefer FaceCaptureHelper (MediaPipe) auto-capture path to match registration preprocessing
            if (this.useFaceCaptureHelper && window.FaceCaptureHelper) {
                this.showProgress('Initializing auto-capture...');
                let captures = 0;
                try {
                    await window.FaceCaptureHelper.init({
                        // Pass kiosk video/canvas so helper draws guidance overlay in the same container
                        videoEl: this.elements.video,
                        canvasEl: this.elements.canvas,
                        // Use statusMessage element to print occasional diagnostics (optional)
                        statusEl: this.elements.statusMessage,
                        // Offer minimal instructions text outside canvas (optional)
                        instructionsEl: this.elements.faceInstructionText,
                        // Auto-capture callback: send 384x384 PNG to server-side verifier
                        onAutoCapture: async (dataUrl) => {
                            captures += 1;
                            // If timeout already triggered, ignore capture
                            if (this._faceTimeoutTriggered) return;
                            this.showProgress('Verifying face...');
                            const serverResult = await this.faceVerifier.verifyFaceServer(
                                this.currentClaim.face_embedding,
                                dataUrl,
                                this.currentClaim.claim_id
                            );
                            if (this._faceTimeoutTriggered) return; // honor timeout

                            if (serverResult.success && serverResult.match) {
                                // Success — stop timer & resources, proceed to unlock
                                if (this._faceTimeoutId) { clearTimeout(this._faceTimeoutId); this._faceTimeoutId = null; }
                                const elapsed = Date.now() - faceStartTime;
                                this.log('info', 'FaceCaptureHelper verification succeeded', { 
                                    claimId: this.currentClaim.claim_id,
                                    similarity: serverResult.similarity,
                                    threshold: serverResult.threshold,
                                    elapsed: elapsed,
                                    method: 'FaceCaptureHelper'
                                });
                                this.playSound('success');
                                this.showProgress('Face verified! Unlocking locker...');
                                try { window.FaceCaptureHelper.stop(); } catch (e) {}
                                this.faceVerifier.stopVideo();
                                this.elements.videoContainer.classList.add('hidden');
                                this.stopFaceFeedbackLoop();
                                await this.unlockLocker();
                                return;
                            }

                            // Failure/mismatch
                            this.playSound('error');
                            const elapsed = Date.now() - faceStartTime;
                            this.log('warn', 'FaceCaptureHelper verification failed', { 
                                claimId: this.currentClaim.claim_id,
                                success: serverResult.success,
                                similarity: serverResult.similarity,
                                threshold: serverResult.threshold,
                                elapsed: elapsed,
                                method: 'FaceCaptureHelper',
                                error: serverResult.error
                            });
                            const msg = serverResult.success
                                ? `Similarity distance ${Number(serverResult.similarity).toFixed(3)} (≤ ${serverResult.threshold} required).`
                                : (serverResult.error || 'Server verification failed');
                            const isLastCapture = captures >= 2; // allow one quick retake
                            this.showStatus(
                                serverResult.success ? 'Face Mismatch' : 'Verification Failed',
                                msg + (isLastCapture ? '' : '\nRetake will start automatically.'),
                                'error'
                            );
                            if (!isLastCapture) {
                                // Restart helper for a second capture attempt; re-init to reset internal flags
                                try { window.FaceCaptureHelper.stop(); } catch (e) {}
                                try {
                                    await window.FaceCaptureHelper.init({
                                        videoEl: this.elements.video,
                                        canvasEl: this.elements.canvas,
                                        statusEl: this.elements.statusMessage,
                                        instructionsEl: this.elements.instructionsTitle,
                                        onAutoCapture: arguments.callee // reuse same callback
                                    });
                                    await window.FaceCaptureHelper.start();
                                } catch (reErr) {
                                    console.warn('Retake init failed:', reErr);
                                }
                                return; // wait for next capture
                            }

                            // After two failed captures, choose fallback
                            try { window.FaceCaptureHelper.stop(); } catch (e) {}
                            this.faceVerifier.stopVideo();
                            this.elements.videoContainer.classList.add('hidden');
                            this.stopFaceFeedbackLoop();

                            if (this.currentClaim.rfid_uid) {
                                this.showStatus('Switching Method', 'Face verification failed. Please tap your student card on the reader.', 'warning');
                                await this.verifyWithRFID();
                                // If RFID did not complete the claim, auto-return to Step 1
                                if (!this.state.claimSuccess) {
                                    await this.startAutoRestartCountdown({
                                        seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                                        type: 'warning',
                                        title: 'Returning to QR',
                                        message: 'Switching back to QR scanning automatically...',
                                        immediateSwitch: true
                                    });
                                }
                            } else {
                                this.showStatus('Verification Failed', 'Unable to verify identity. Returning to QR scanning...', 'error');
                                this.isProcessing = false;
                                this.state.processingFailed = true;
                                await this.startAutoRestartCountdown({
                                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                                    type: 'error',
                                    title: 'Verification Failed',
                                    message: 'Restarting scanning automatically...',
                                    immediateSwitch: true
                                });
                            }
                        }
                    });
                    await window.FaceCaptureHelper.start();
                    // Begin real-time feedback updates while in face mode
                    this.startFaceFeedbackLoop();
                    return; // Leave function — further flow handled by onAutoCapture/timeout
                } catch (helperErr) {
                    // Helper failed to initialize — fall back to legacy face-api flow below
                    console.warn('FaceCaptureHelper unavailable, falling back to face-api verification:', helperErr);
                }
            }

            // ===== Legacy face-api.js descriptor-based verification (fallback) =====
            // Ensure models are loaded before verification
            this.showProgress('Loading face detection models...');
            const modelsLoaded = await this.faceVerifier.loadModels();
            if (!modelsLoaded) {
                this.metrics.failures += 1;
                const diag = this.faceVerifier.modelDiagnostics || { baseUrl: '/static/models', missingFiles: [] };
                const details = diag.missingFiles && diag.missingFiles.length
                    ? `Missing files: ${diag.missingFiles.join(', ')}\nBase URL: ${diag.baseUrl}`
                    : `Base URL: ${diag.baseUrl}\nError: ${this.faceVerifier.lastError || 'Unknown model loading error'}`;
                this.showStatus('Error', `Failed to load face detection models.\n${details}`, 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.faceVerifier.stopVideo();
                this.isProcessing = false;
                this.state.processingFailed = true;
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'error',
                    title: 'Model Load Error',
                    message: 'Failed to load face detection models. Restarting scanning...',
                    immediateSwitch: true
                });
                return;
            }

            // Start face detection overlay
            this.startFaceDetection();

            // Attempt face verification up to 3 times with user-friendly hints
            const MAX_ATTEMPTS = 3;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                if (this._faceTimeoutTriggered) break; // stop if timed out
                this.showProgress(`Attempt ${attempt} of ${MAX_ATTEMPTS}: Please look at the camera`, 'Verifying your face...');
                await this.sleep(800);

                const verifyResult = await this.faceVerifier.verifyFace(this.currentClaim.face_embedding);

                if (this._faceTimeoutTriggered) break;

                if (!verifyResult.success) {
                    this.playSound('error');
                    const elapsed = Date.now() - faceStartTime;
                    this.log('warn', 'Face-api.js verification failed', { 
                        claimId: this.currentClaim.claim_id,
                        success: false,
                        error: verifyResult.error,
                        elapsed: elapsed,
                        method: 'face-api.js',
                        attempts: attempt
                    });
                    const isLast = attempt === MAX_ATTEMPTS;
                    const hint = 'Tips: Center your face in the frame, remove glasses/hats, and ensure good lighting.';
                    const err = verifyResult.error || '';
                    const modelIssue = /shape|tensor|weights|insufficient|manifest|shard/i.test(err);
                    const guidance = modelIssue
                        ? `Model error detected: ${err}. Please ensure all model files are present (especially face_recognition_model-shard2) in ${this.faceVerifier.modelDiagnostics.baseUrl}.`
                        : (verifyResult.error || 'No face detected');
                    const remaining = MAX_ATTEMPTS - attempt;
                    const extra = !isLast ? `\nRemaining attempts: ${remaining}. ${hint}` : `\n${hint}`;
                    this.showStatus(
                        isLast ? 'Verification Failed' : 'No Face Detected',
                        guidance + extra,
                        'error',
                        isLast ? { actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }] } : undefined
                    );
                    if (!isLast) {
                        await this.sleep(1000);
                        continue; // retry
                    }
                } else if (!verifyResult.match) {
                    this.playSound('error');
                    const elapsed = Date.now() - faceStartTime;
                    this.log('warn', 'Face-api.js face mismatch', { 
                        claimId: this.currentClaim.claim_id,
                        success: true,
                        match: false,
                        similarity: verifyResult.similarity,
                        threshold: verifyResult.threshold,
                        elapsed: elapsed,
                        method: 'face-api.js',
                        attempts: attempt
                    });
                    const isLast = attempt === MAX_ATTEMPTS;
                    const msg = `Similarity distance ${verifyResult.similarity.toFixed(3)} (≤ ${verifyResult.threshold} required).`;
                    const remaining = MAX_ATTEMPTS - attempt;
                    const hint = 'Tips: Face the camera directly and keep a neutral expression.';
                    const extra = !isLast ? `\nRemaining attempts: ${remaining}. ${hint}` : `\n${hint}`;
                    this.showStatus(
                        isLast ? 'Face Mismatch' : `Face Mismatch (Attempt ${attempt}/${MAX_ATTEMPTS})`,
                        `${msg} Try adjusting your position and retake.` + extra,
                        'error',
                        isLast ? { actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }] } : undefined
                    );
                    if (!isLast) {
                        await this.sleep(1000);
                        continue; // retry
                    }
                } else {
                    // Matched — proceed to unlock
                    if (this._faceTimeoutId) { clearTimeout(this._faceTimeoutId); this._faceTimeoutId = null; }
                    const elapsed = Date.now() - faceStartTime;
                    this.log('info', 'Face-api.js verification succeeded', { 
                        claimId: this.currentClaim.claim_id,
                        similarity: verifyResult.similarity,
                        threshold: verifyResult.threshold,
                        elapsed: elapsed,
                        method: 'face-api.js',
                        attempts: attempt
                    });
                    this.playSound('success');
                    this.showProgress('Face verified! Unlocking locker...');
                    this.stopFaceDetection();
                    this.faceVerifier.stopVideo();
                    this.elements.videoContainer.classList.add('hidden');
                    await this.unlockLocker();
                    return;
                }
            }

            // All attempts exhausted — stop video and decide fallback
            if (!this._faceTimeoutTriggered) {
                if (this._faceTimeoutId) { clearTimeout(this._faceTimeoutId); this._faceTimeoutId = null; }
                this.stopFaceDetection();
                this.faceVerifier.stopVideo();
                this.elements.videoContainer.classList.add('hidden');
            }

            if (this.currentClaim.rfid_uid) {
                this.showStatus('Switching Method', 'Face verification failed. Please tap your student card on the reader.', 'warning');
                await this.verifyWithRFID();
                if (!this.state.claimSuccess) {
                    await this.startAutoRestartCountdown({
                        seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                        type: 'warning',
                        title: 'Returning to QR',
                        message: 'Switching back to QR scanning automatically...',
                        immediateSwitch: true
                    });
                }
                return;
            }

            this.showStatus('Verification Failed', 'Unable to verify identity. Returning to QR scanning...', 'error');
            this.isProcessing = false;
            this.state.processingFailed = true;
            await this.startAutoRestartCountdown({
                seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                type: 'error',
                title: 'Verification Failed',
                message: 'Restarting scanning automatically...',
                immediateSwitch: true
            });

        } catch (error) {
            this.log('error', 'Face verification error', { error: error.message });
            // Ensure video is stopped and UI cleaned up on unexpected errors
            if (this._faceTimeoutId) {
                clearTimeout(this._faceTimeoutId);
                this._faceTimeoutId = null;
            }
            this.stopFaceDetection();
            try {
                if (this.useFaceCaptureHelper && window.FaceCaptureHelper && typeof window.FaceCaptureHelper.stop === 'function') {
                    window.FaceCaptureHelper.stop();
                }
            } catch (_) { /* ignore */ }
            this.faceVerifier.stopVideo();
            this.elements.videoContainer.classList.add('hidden');
            this.showStatus('Error', error.message, 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
            this.isProcessing = false;
            this.state.processingFailed = true;
            await this.startAutoRestartCountdown({
                seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                type: 'error',
                title: 'Unexpected Error',
                message: 'Restarting scanning automatically...',
                immediateSwitch: true
            });
        }
    }

    

    /**
     * Verify identity using RFID card
     */
    async verifyWithRFID() {
        try {
            this.updateStepIndicator(2); // Step 2: Identity Verification
            this.showProgress('Tap your student card on the reader...');

            // Check if RFID UID exists in claim
            if (!this.currentClaim.rfid_uid) {
                this.metrics.failures += 1;
                this.showStatus('Error', 'No RFID card registered for this claim', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                // Auto-return to QR scanning with a short visible countdown so kiosk keeps flowing
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'error',
                    title: 'RFID Not Available',
                    message: 'Returning to QR scanning automatically...',
                    immediateSwitch: true
                });
                return;
            }

            // Start timing for performance metrics
            const startTime = Date.now();
            this.log('info', 'Starting RFID verification', { 
                claimId: this.currentClaim.claim_id,
                timeout: this.RFID_TIMEOUT 
            });

            // Wait for card scan with 60-second timeout
            const scanResult = await this.rfidVerifier.waitForCardScan(this.RFID_TIMEOUT);
            
            // Log verification duration
            const duration = Date.now() - startTime;
            this.log('info', 'RFID scan completed', { 
                success: scanResult.success,
                duration: duration,
                timeout: duration >= this.RFID_TIMEOUT 
            });

            if (!scanResult.success) {
                this.playSound('error');
                this.showStatus('RFID Error', scanResult.error || 'Card scan failed', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                // Keep kiosk moving: show countdown while immediately switching back to QR scanning
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.RFID_TIMEOUT/1000) >= 60 ? 5 : Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'error',
                    title: 'RFID Scan Failed',
                    message: 'Restarting QR scanner automatically...',
                    immediateSwitch: true
                });
                return;
            }

            // Verify UID
            const verifyResult = this.rfidVerifier.verifyUID(
                scanResult.uid, 
                this.currentClaim.rfid_uid
            );

            if (!verifyResult.success || !verifyResult.match) {
                this.playSound('error');
                this.showStatus(
                    'Card Mismatch',
                    'The scanned card does not match the registered card',
                    'error',
                    { actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }] }
                );
                this.isProcessing = false;
                this.state.processingFailed = true;
                // Consistent with face flow: auto-switch to QR with countdown
                await this.startAutoRestartCountdown({
                    seconds: Math.round(this.FACE_FAIL_RESET_DELAY/1000),
                    type: 'error',
                    title: 'Card Mismatch',
                    message: 'Switching back to QR scanning automatically...',
                    immediateSwitch: true
                });
                return;
            }

            // Success - proceed to unlock
            this.playSound('success');
            this.showProgress('Card verified! Unlocking locker...');
            await this.unlockLocker();

        } catch (error) {
            this.log('error', 'RFID verification error', { error: error.message });
            this.showStatus('Error', error.message, 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
            this.isProcessing = false;
            this.state.processingFailed = true;
        }
    }

    /**
     * Simulate RFID scan (for testing without hardware)
     */
    async simulateRFIDScan() {
        // Simulate RFID scan delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // For testing, return the expected RFID UID
        // In production, this would interface with actual RFID hardware
        return this.currentClaim.rfid_uid;
    }

    /**
     * Unlock locker and complete claim
     */
    async unlockLocker() {
        try {
            this.updateStepIndicator(3); // Step 3: Collect Item
            const lockerId = this.currentClaim.locker_id;

            // If no locker is assigned, finalize the claim via public API
            // This covers items that are not stored in lockers (e.g., handled by staff)
            if (!lockerId) {
                try {
                    const timestamp = new Date().toISOString();
                    this.showProgress('No locker assigned. Finalizing claim...', 'Processing...');

                    const finalizeResult = await this.finalizeClaimPublic(this.currentClaim.claim_id, 10);

                    if (!finalizeResult.success) {
                        this.playSound('error');
                        this.showStatus('Finalize Error', finalizeResult.error || 'Failed to finalize claim', 'error', {
                            actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                        });
                        this.isProcessing = false;
                        this.state.processingFailed = true;
                        return;
                    }

                    // Success: claim is marked completed server-side
                    this.playSound('success');
                    this.showStatus(
                        'Success!',
                        'Your claim has been finalized. Please contact staff to collect your item.',
                        'success',
                        { actions: [{ id: 'new-claim', label: 'Start New Claim', handler: () => this.startNewClaim() }] }
                    );
                    // Hide scanner frames to avoid leftover square overlays
                    this.hideScannerFrames();
                    this.metrics.successes += 1;
                    this.isProcessing = false;
                    this.state.claimSuccess = true;
                    this.state.lastScannedQR = null;
                    this.state.lastRawQR = null;
                    // Auto-restart to Step 1 after a short delay with visible countdown
                    await this.startAutoRestartCountdown({
                        seconds: Math.round(this.SUCCESS_RESET_DELAY/1000),
                        type: 'success',
                        title: 'Claim Complete',
                        message: 'Starting a new claim automatically...',
                        immediateSwitch: false
                    });
                    return;
                } catch (err) {
                    this.log('error', 'Finalize error (no locker)', { error: err && err.message ? err.message : String(err) });
                    this.showStatus('Error', (err && err.message) ? err.message : 'Failed to finalize claim', 'error', {
                        actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                    });
                    this.isProcessing = false;
                    this.state.processingFailed = true;
                    return;
                }
            }

            // Open locker
            const timestamp = new Date().toISOString();
            const unlockResult = await this.lockerController.openLocker(
                lockerId,
                this.currentClaim.claim_id,
                this.currentClaim.student_id,
                timestamp
            );

            if (!unlockResult.success) {
                this.showStatus('Error', unlockResult.error || 'Failed to unlock locker', 'error', {
                    actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
                });
                this.isProcessing = false;
                this.state.processingFailed = true;
                return;
            }

            // Update claim status
            const updateResult = await firebaseService.updateClaimStatus(
                this.currentClaim.claim_id,
                timestamp
            );

            if (!updateResult.success) {
                this.log('warn', 'Failed to update claim status', { error: updateResult.error });
            }

            // Show success
            this.playSound('success');
            this.showStatus(
                'Success!',
                `Locker ${lockerId} is now open. Please collect your item.`,
                'success',
                {
                    actions: [{ id: 'new-claim', label: 'Start New Claim', handler: () => this.startNewClaim() }]
                }
            );
            // Hide scanner frames to avoid leftover square overlays
            this.hideScannerFrames();
            // Auto-restart scanning after success with visible countdown
            this.metrics.successes += 1;
            this.isProcessing = false;
            this.state.claimSuccess = true;
            this.state.lastScannedQR = null;
            this.state.lastRawQR = null;
            await this.startAutoRestartCountdown({
                seconds: Math.round(this.SUCCESS_RESET_DELAY/1000),
                type: 'success',
                title: 'Locker Opened',
                message: 'Process will restart automatically after you collect your item.',
                immediateSwitch: false
            });

        } catch (error) {
            this.log('error', 'Unlock error', { error: error.message });
            this.showStatus('Error', error.message, 'error', {
                actions: [{ id: 'restart-scan', label: 'Restart Scanning', handler: () => this.resetToScanning() }]
            });
            this.isProcessing = false;
            this.state.processingFailed = true;
        }
    }

    /**
     * Finalize claim via public API when no locker is assigned
     * This endpoint marks the claim as 'completed' server-side and returns
     * a payload with verification and optional locker details.
     *
     * @param {string} claimId - Claim ID
     * @param {number} durationSec - Auto-close duration if a locker were involved (default 10)
     * @returns {Promise<{success: boolean, data?: any, error?: string}>}
     */
    async finalizeClaimPublic(claimId, durationSec = 10) {
        try {
            const response = await fetch(`${window.location.origin}/api/claim/${claimId}/finalize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ duration_sec: durationSec })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                return { success: false, error: data.error || 'Failed to finalize claim' };
            }
            return { success: true, data };
        } catch (error) {
            return { success: false, error: (error && error.message) ? error.message : 'Network error while finalizing claim' };
        }
    }

    /**
     * Display claim information
     */
    displayClaimInfo(claim) {
        if (!this.elements.claimInfo) return;

        const html = `
            <div class="claim-details">
                <p><strong>Claim ID:</strong> ${claim.claim_id}</p>
                <p><strong>Student ID:</strong> ${claim.student_id}</p>
                <p><strong>Verification Method:</strong> ${this.formatVerificationMethod(claim.verification_method)}</p>
                ${claim.locker_id ? `<p><strong>Locker:</strong> ${claim.locker_id}</p>` : ''}
            </div>
        `;

        this.elements.claimInfo.innerHTML = html;
        this.elements.claimInfo.classList.remove('hidden');
    }

    /**
     * Format verification method for display
     */
    formatVerificationMethod(method) {
        const methods = {
            'qr_face': 'Facial Recognition',
            'qr_rfid': 'RFID Card',
            'face': 'Facial Recognition',
            'rfid': 'RFID Card'
        };
        return methods[method] || method;
    }

    /**
     * Show status message with consistent styling
     */
    showStatus(type, title, message, options = {}) {
        // Normalize arguments to support both (type, title, message) and (title, message, type)
        // This makes the function resilient to older call sites and README examples.
        const validTypes = ['info', 'warning', 'error', 'success'];
        if (!validTypes.includes(type) && validTypes.includes(message)) {
            // Called as (title, message, type)
            const originalType = type;
            type = message;
            message = title;
            title = originalType;
        } else if (!validTypes.includes(type)) {
            // Fallback: default to info type and treat first arg as title
            message = title || '';
            title = String(type);
            type = 'info';
        }

        const icons = {
            info: 'fas fa-info-circle',
            warning: 'fas fa-exclamation-triangle',
            error: 'fas fa-times-circle',
            success: 'fas fa-check-circle'
        };
        
        const colors = {
            info: 'text-blue-600',
            warning: 'text-yellow-600',
            error: 'text-red-600',
            success: 'text-green-600'
        };
        
        const cardClasses = {
            info: 'status-card info',
            warning: 'status-card warning',
            error: 'status-card error shake',
            success: 'status-card success'
        };
        
        // Ensure loading overlay is hidden when we switch to status view
        this.hideLoadingOverlay();

        // Fix duplicate icon issue: always preserve the container class
        // and update/replace the child <i> element instead of assigning icon classes to the div itself.
        try {
            const container = this.elements.statusIcon; // <div id="status-icon" class="status-icon">
            if (container) {
                // Keep container styling class for spacing
                container.className = 'status-icon';

                // Remove any existing children to avoid duplicates
                while (container.firstChild) container.removeChild(container.firstChild);

                // Create a new <i> icon element with the correct classes
                const iconEl = document.createElement('i');
                iconEl.className = `${icons[type]} ${colors[type]} text-4xl`;
                iconEl.setAttribute('aria-hidden', 'true');
                container.appendChild(iconEl);
            }
        } catch (e) {
            this.log('warn', 'Failed to render status icon', { error: e.message });
        }

        // Update title/message
        this.elements.statusTitle.textContent = title;
        this.elements.statusMessage.innerHTML = message;

        // Update card variant classes
        this.elements.statusCard.className = cardClasses[type];
        this.elements.statusCard.classList.remove('hidden');

        // Progress bar should be hidden for normal statuses
        if (this.elements.progressBar) {
            this.elements.progressBar.classList.add('hidden');
        }
        
        // Play appropriate sound
        if (type === 'success' || type === 'error') {
            this.playSound(type);
        }
        // Render action buttons if provided
        try {
            // Remove existing actions container if present
            let actionsContainer = this.elements.statusCard.querySelector('#status-actions');
            if (actionsContainer) {
                actionsContainer.remove();
            }
            if (options && Array.isArray(options.actions) && options.actions.length > 0) {
                actionsContainer = document.createElement('div');
                actionsContainer.id = 'status-actions';
                actionsContainer.className = 'status-actions';
                options.actions.forEach(action => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-primary';
                    btn.textContent = action.label || 'Action';
                    btn.id = action.id || '';
                    btn.addEventListener('click', (e) => {
                        try {
                            action.handler && action.handler(e);
                        } catch (err) {
                            this.log('error', 'Status action handler error', { error: err.message });
                        }
                    });
                    actionsContainer.appendChild(btn);
                });
                this.elements.statusCard.appendChild(actionsContainer);
            }
        } catch (err) {
            this.log('warn', 'Failed to render status actions', { error: err.message });
        }

        // Auto-hide only for info/warning; keep error/success visible until user acts
        if (type === 'info' || type === 'warning') {
            const duration = type === 'warning' ? 5000 : 3000;
            setTimeout(() => {
                this.elements.statusCard.classList.add('hidden');
            }, duration);
        }

        // Announce to screen reader for accessibility
        this.announceToScreenReader(`${title}: ${message}`);
    }

    /**
     * Show progress message
     */
    showProgress(message, title = 'Processing...') {
        // Use loading overlay for better user experience
        this.showLoadingOverlay(title, message);

        // Also update status card as a persistent panel
        try {
            const container = this.elements.statusIcon;
            if (container) {
                container.className = 'status-icon';
                while (container.firstChild) container.removeChild(container.firstChild);
                const iconEl = document.createElement('i');
                iconEl.className = 'fas fa-spinner fa-spin text-blue-600 text-4xl';
                iconEl.setAttribute('aria-hidden', 'true');
                container.appendChild(iconEl);
            }
        } catch (e) {
            this.log('warn', 'Failed to render progress icon', { error: e.message });
        }

        this.elements.statusTitle.textContent = title;
        this.elements.statusMessage.textContent = message;

        if (this.elements.progressBar) {
            this.elements.progressBar.classList.remove('hidden');
        }
        this.elements.statusCard.classList.remove('hidden');
        this.elements.statusCard.classList.add('loading');
    }

    /**
     * Start a visible countdown and automatically restart the kiosk to Step 1 (QR scanning).
     * - seconds: countdown duration in seconds
     * - type/title/message: status visuals
     * - immediateSwitch: when true, immediately switch UI to QR mode and keep scanning
     *   while the countdown message updates; when false, wait for the countdown to finish
     *   before performing the reset.
     */
    async startAutoRestartCountdown({ seconds = 3, type = 'info', title = 'Restarting', message = 'Returning to Step 1...', immediateSwitch = false } = {}) {
        try {
            // Clear any existing countdown
            if (this._restartCountdownInterval) {
                try { clearInterval(this._restartCountdownInterval); } catch (_) {}
                this._restartCountdownInterval = null;
            }

            let remaining = Math.max(1, parseInt(seconds, 10));
            const compose = (n) => `${message} Restarting in ${n}s...`;

            if (immediateSwitch) {
                // Return to QR UI immediately so the user sees Step 1 while the countdown runs
                await this.switchToQRUI();
                // Update title/message for the countdown in status card
                if (this.elements.statusTitle) this.elements.statusTitle.textContent = title;
                if (this.elements.statusMessage) this.elements.statusMessage.textContent = compose(remaining);
            } else {
                // Remain in current UI, show status with initial countdown message
                this.showStatus(type, title, compose(remaining));
            }

            const updateMessageEl = () => {
                if (!this.elements || !this.elements.statusMessage) return;
                this.elements.statusMessage.textContent = compose(remaining);
            };

            this._restartCountdownInterval = setInterval(async () => {
                remaining -= 1;
                if (remaining > 0) {
                    updateMessageEl();
                    return;
                }
                try { clearInterval(this._restartCountdownInterval); } catch (_) {}
                this._restartCountdownInterval = null;
                if (!immediateSwitch) {
                    await this.resetToScanning();
                }
                // If immediateSwitch is true, scanner already running via switchToQRUI()
            }, 1000);
        } catch (e) {
            this.log('warn', 'startAutoRestartCountdown failed', { error: e.message });
            await this.sleep((seconds || 3) * 1000);
            if (!immediateSwitch) {
                await this.resetToScanning();
            }
        }
    }

    /**
     * Reset to scanning mode after delay
     */
    async resetAfterDelay() {
        await this.sleep(this.RESET_DELAY);
        await this.resetToScanning();
    }

    /**
     * Reset kiosk to scanning mode
     */
    async resetToScanning() {
        try {
            this.log('info', 'Resetting to scanning mode', {
                timestamp: new Date().toISOString(),
                wasProcessing: this.isProcessing,
                hadClaim: !!this.currentClaim,
                faceVerifierRestartCount: this.faceVerifier ? this.faceVerifier.restartCount : 0,
                mode: this.state.mode
            });
            
            this.isProcessing = false;
            this.currentClaim = null;
            this.state.processingFailed = false;
            this.state.claimSuccess = false;
            this.state.errorState = null;
            this.state.mode = 'qr';

            // Reset step indicator to step 1
            this.updateStepIndicator(1);

            // Reset QR scanner visual feedback
            this.updateQRScannerFeedback('scanning');

            // Hide claim info
            if (this.elements.claimInfo) {
                this.elements.claimInfo.classList.add('hidden');
            }

            // Hide video
            if (this.elements.videoContainer) {
                this.elements.videoContainer.classList.add('hidden');
                this.elements.videoContainer.classList.remove('overlay-video');
            }

            // Ensure QR overlay is visible again
            if (this.elements.qrReader) {
                this.elements.qrReader.classList.remove('swap-to-face');
                this.elements.qrReader.classList.add('scanning');
            }
            if (this.qrOverlay) {
                this.qrOverlay.style.opacity = '';
            }

            // Stop any ongoing streams and reset face verifier state
            if (this.faceVerifier) {
                this.faceVerifier.stopVideo();
                // Reset restart count after successful reset
                this.faceVerifier.resetRestartCounter();
            }

            // Clear face timeout if any
            if (this._faceTimeoutId) {
                clearTimeout(this._faceTimeoutId);
                this._faceTimeoutId = null;
                this._faceTimeoutTriggered = false;
            }

            // Restart scanner only when user restarts scanning
            if (this.qrScanner) {
                await this.qrScanner.start();
                this.state.scanning = true;
            }
            // Re-add scanning animation class
            try {
                const el = document.getElementById('qr-reader');
                el && el.classList.add('scanning');
            } catch (_) {}

            this.showStatus('Ready', 'Scan QR code to begin claim process', 'info');
            
            this.log('info', 'Reset to scanning mode completed', {
                timestamp: new Date().toISOString(),
                scannerActive: this.state.scanning
            });
        } catch (error) {
            this.log('error', 'Reset error', { error: error.message, timestamp: new Date().toISOString() });
        }
    }

    /**
     * Explicitly start a new claim after success
     */
    async startNewClaim() {
        this.log('info', 'Starting new claim');
        await this.resetToScanning();
    }

    /**
     * Show fallback options when camera is not available
     */
    showFallbackOptions() {
        const fallbackHtml = `
            <div class="fallback-options">
                <h3>Camera Not Available</h3>
                <p>Please try one of these alternatives:</p>
                <div class="fallback-buttons">
                    <button onclick="kioskApp.showManualEntry()" class="btn btn-primary">
                        Enter Claim Code Manually
                    </button>
                    <button onclick="kioskApp.showHelp()" class="btn btn-secondary">
                        Contact Support
                    </button>
                    <button onclick="location.reload()" class="btn btn-outline">
                        Refresh Page
                    </button>
                </div>
                <div class="browser-info">
                    <p><strong>Browser:</strong> ${this.qrScanner.detectBrowser()}</p>
                    <p><strong>HTTPS:</strong> ${location.protocol === 'https:' ? 'Yes' : 'No'}</p>
                </div>
            </div>
        `;
        
        this.elements.statusMessage.innerHTML = fallbackHtml;
        this.elements.statusMessage.className = 'status-message status-error';
        this.elements.statusMessage.classList.remove('hidden');
    }

    /**
     * Show camera permission instructions
     */
    showPermissionInstructions() {
        const browser = this.qrScanner.detectBrowser();
        let instructions = '';
        
        switch (browser) {
            case 'chrome':
                instructions = `
                    <h4>Chrome Camera Permissions:</h4>
                    <ol>
                        <li>Click the camera icon in the address bar</li>
                        <li>Select "Allow" for camera access</li>
                        <li>Refresh the page</li>
                    </ol>
                `;
                break;
            case 'firefox':
                instructions = `
                    <h4>Firefox Camera Permissions:</h4>
                    <ol>
                        <li>Click the camera icon in the address bar</li>
                        <li>Click "Allow" when prompted</li>
                        <li>Refresh the page</li>
                    </ol>
                `;
                break;
            case 'safari':
                instructions = `
                    <h4>Safari Camera Permissions:</h4>
                    <ol>
                        <li>Go to Safari > Settings for This Website</li>
                        <li>Set Camera to "Allow"</li>
                        <li>Refresh the page</li>
                    </ol>
                `;
                break;
            default:
                instructions = `
                    <h4>Camera Permissions:</h4>
                    <p>Please allow camera access when prompted by your browser.</p>
                    <p>If you've blocked camera access, please:</p>
                    <ol>
                        <li>Check your browser settings</li>
                        <li>Allow camera access for this site</li>
                        <li>Refresh the page</li>
                    </ol>
                `;
        }
        
        const permissionHtml = `
            <div class="permission-instructions">
                <h3>Camera Access Required</h3>
                ${instructions}
                <button onclick="location.reload()" class="btn btn-primary">
                    Refresh and Try Again
                </button>
            </div>
        `;
        
        this.elements.statusMessage.innerHTML = permissionHtml;
        this.elements.statusMessage.className = 'status-message status-error';
        this.elements.statusMessage.classList.remove('hidden');
    }

    /**
     * Show Firestore permission/availability help for kiosk mode
     * Provides actionable steps to enable read access for kiosk and health checks.
     */
    showFirestoreHelp() {
        const guideHtml = `
            <div class="permission-instructions">
                <h3>Firestore Access Guide</h3>
                <p>The kiosk can operate with QR-only details, but reading claim data from Firestore improves the experience.</p>
                <ol>
                    <li>Ensure Firebase Web configuration is set in <code>config/firebase_web_config.json</code> or via environment variables.</li>
                    <li>Optionally enable the Firestore emulator using environment variables: <code>USE_FIRESTORE_EMULATOR=true</code>, <code>FIRESTORE_EMULATOR_HOST</code>, and <code>FIRESTORE_EMULATOR_PORT</code>.</li>
                    <li>Update your <code>firestore.rules</code> to allow read of <code>claims</code> and a health check collection:</li>
                </ol>
                <pre style="white-space:pre-wrap; word-break:break-word;">
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Health check for connectivity
    match /_health/{doc} {
      allow read: if true;
      allow write: if false;
    }
    // Kiosk claim reads (browser is unauthenticated)
    match /claims/{claimId} {
      allow read: if true;
      // Optional (development): allow status-only updates to Claimed
      allow update: if request.resource.data.status == 'Claimed' &&
                    request.resource.data.claim_id == resource.data.claim_id &&
                    request.resource.data.student_id == resource.data.student_id &&
                    request.resource.data.found_item_id == resource.data.found_item_id &&
                    request.resource.data.verification_method == resource.data.verification_method &&
                    request.resource.data.expires_at == resource.data.expires_at &&
                    request.resource.data.locker_id == resource.data.locker_id &&
                    request.resource.data.face_embedding == resource.data.face_embedding &&
                    request.resource.data.face_image_base64 == resource.data.face_image_base64 &&
                    request.resource.data.rfid_uid == resource.data.rfid_uid;
    }
  }
}
                </pre>
                <div class="fallback-buttons">
                    <button onclick="location.reload()" class="btn btn-primary">Reload Page</button>
                    <button id="retry-firestore" class="btn btn-secondary">Retry Fetch Details</button>
                </div>
            </div>
        `;

        this.elements.statusMessage.innerHTML = guideHtml;
        this.elements.statusMessage.className = 'status-message status-error';
        this.elements.statusMessage.classList.remove('hidden');

        // Wire up local retry button to call the same retry flow used in processClaim
        const retryBtn = document.getElementById('retry-firestore');
        if (retryBtn && this.currentClaim && this.currentClaim.claim_id) {
            retryBtn.addEventListener('click', async () => {
                try {
                    this.showProgress('Retrying claim details from Firestore...');
                    const retry = await firebaseService.getClaim(this.currentClaim.claim_id);
                    if (retry && retry.success && retry.data) {
                        this.currentClaim = { ...this.currentClaim, ...retry.data };
                        this.displayClaimInfo(this.currentClaim);
                        this.showStatus('Info', 'Claim details fetched successfully from Firestore.', 'success');
                    } else {
                        const errMsg = (retry && retry.error) ? retry.error : 'Still unable to fetch details.';
                        this.showStatus('Info', errMsg, 'warning');
                    }
                } catch (err) {
                    this.showStatus('Error', err.message, 'error');
                }
            });
        }
    }

    /**
     * Check network connectivity
     */
    async checkNetworkConnectivity() {
        try {
            // Check if browser is online
            if (!navigator.onLine) {
                return false;
            }

            // Try to ping a reliable endpoint
            const response = await fetch('/api/health', {
                method: 'GET',
                cache: 'no-cache',
                timeout: 5000
            });

            return response.ok;
        } catch (error) {
            this.log('warn', 'Network connectivity check failed', { error: error.message });
            return false;
        }
    }

    /**
     * Show manual claim code entry form
     */
    showManualEntry() {
        const entryHtml = `
            <div class="manual-entry-form">
                <h3>Enter Claim Code Manually</h3>
                <p>Please enter your claim code provided when you reported your item:</p>
                <input type="text" id="manualClaimCode" placeholder="Enter claim code (e.g., C0001)" 
                       class="form-input" maxlength="10">
                <div class="manual-entry-buttons">
                    <button onclick="kioskApp.processManualClaim()" class="btn btn-primary">
                        Submit Claim Code
                    </button>
                    <button onclick="kioskApp.resetToScanning()" class="btn btn-secondary">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        this.elements.statusMessage.innerHTML = entryHtml;
        this.elements.statusMessage.className = 'status-message';
        this.elements.statusMessage.classList.remove('hidden');
    }

    /**
     * Process manual claim code entry
     */
    async processManualClaim() {
        const claimCode = document.getElementById('manualClaimCode').value.trim();
        
        if (!claimCode) {
            this.showStatus('Error', 'Please enter a claim code', 'error');
            return;
        }
        
        try {
            this.showProgress('Verifying claim code...');
            
            // Simulate QR verification with manual claim code
            const qrData = `QRC|${claimCode}|MANUAL|manual`;
            await this.processClaim(qrData, qrData);
            
        } catch (error) {
            console.error('Manual claim processing error:', error);
            this.showStatus('Error', 'Invalid claim code or processing failed', 'error');
        }
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Unified logger with timestamp, severity, and optional context
     * Adds standardized output for debugging and monitoring
     */
    log(level = 'info', message = '', context = {}) {
        const ts = new Date().toISOString();
        const payload = { ts, level, message, ...context };
        // Use console methods by severity
        switch (level) {
            case 'error':
                console.error(payload);
                break;
            case 'warn':
                console.warn(payload);
                break;
            default:
                console.log(payload);
        }
    }
}

// Initialize kiosk when DOM is ready (guarded to kiosk page only)
document.addEventListener('DOMContentLoaded', () => {
    const isKioskPage = !!document.getElementById('qr-reader') || !!document.querySelector('.kiosk-container');
    if (isKioskPage) {
        const kioskApp = new KioskApp();
        // Expose instance for debugging and automated visual tests
        // Note: This does not change user-visible behavior; it simply allows tests to
        // call methods like onQRScanned to simulate scanning flows.
        window.kioskApp = kioskApp;
        kioskApp.init();
    } else {
        console.log('KioskApp: Non-kiosk page detected, skipping kiosk initialization.');
    }

    // Development/Test helpers for /kiosk-test page
    const isKioskTestPage = document.body.classList.contains('kiosk-test') || !!document.getElementById('qrOutput');
    if (isKioskTestPage) {
        // Expose test helper functions globally so existing onclick handlers continue to work
        // These are scoped to the test page via the body.kiosk-test class check above

        // QR Code Generation Tests
        window.generatePipeFormat = function generatePipeFormat() {
            const qrData = 'QRC|C0001|1234567|face';
            window.displayQR(qrData, 'Pipe Format QR Code', qrData);
        };

        window.generateJSONFormat = function generateJSONFormat() {
            const data = {
                claim_id: 'C0001',
                student_id: '1234567',
                token: 'test_token_' + Math.random().toString(36).substr(2, 16)
            };
            const qrData = JSON.stringify(data);
            window.displayQR(qrData, 'JSON Format QR Code', qrData);
        };

        window.generateEncryptedFormat = function generateEncryptedFormat() {
            // Mock encrypted format
            const qrData = 'v1:' + btoa(JSON.stringify({
                claim_id: 'C0001',
                student_id: '1234567',
                token: 'encrypted_token'
            }));
            window.displayQR(qrData, 'Encrypted Format QR Code (Mock)', qrData);
        };

        window.displayQR = function displayQR(data, title, rawData) {
            const canvas = document.getElementById('testQR');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            // Requires qrcodejs library (loaded via CDN in kiosk_test.html)
            if (typeof QRCode === 'undefined') {
                console.warn('QRCode library missing. Include https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
                return;
            }
            // Generate QR code
            new QRCode(canvas, {
                text: data,
                width: 300,
                height: 300
            });

            const out = document.getElementById('qrOutput');
            if (out) {
                out.innerHTML = `
                    <div class="status info">
                        <strong>${title}</strong><br>
                        <pre>${rawData}</pre>
                    </div>
                `;
            }
        };

        // API Testing
        window.testQRVerify = async function testQRVerify() {
            const testData = {
                qr_raw: JSON.stringify({
                    claim_id: 'C0001',
                    student_id: '1234567',
                    token: 'test_token'
                })
            };

            try {
                const response = await fetch('/api/qr/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testData)
                });

                const result = await response.json();
                const out = document.getElementById('apiOutput');
                if (out) {
                    out.innerHTML = `
                        <div class="status ${response.ok ? 'success' : 'error'}">
                            <strong>QR Verify Result:</strong><br>
                            <pre>${JSON.stringify(result, null, 2)}</pre>
                        </div>
                    `;
                }
            } catch (error) {
                const out = document.getElementById('apiOutput');
                if (out) {
                    out.innerHTML = `
                        <div class="status error">
                            <strong>Error:</strong> ${error.message}
                        </div>
                    `;
                }
            }
        };

        window.testLockerOpen = async function testLockerOpen() {
            try {
                const response = await fetch('/api/lockers/L001/open', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        claim_id: 'C0001',
                        student_id: '1234567',
                        timestamp: new Date().toISOString()
                    })
                });

                const result = await response.json();
                const out = document.getElementById('apiOutput');
                if (out) {
                    out.innerHTML = `
                        <div class="status ${response.ok ? 'success' : 'error'}">
                            <strong>Locker Open Result:</strong><br>
                            <pre>${JSON.stringify(result, null, 2)}</pre>
                        </div>
                    `;
                }
            } catch (error) {
                const out = document.getElementById('apiOutput');
                if (out) {
                    out.innerHTML = `
                        <div class="status error">
                            <strong>Error:</strong> ${error.message}
                        </div>
                    `;
                }
            }
        };

        window.testFirestore = function testFirestore() {
            const out = document.getElementById('apiOutput');
            if (typeof firebase !== 'undefined') {
                out && (out.innerHTML = `
                    <div class="status success">
                        Firebase SDK loaded successfully
                    </div>
                `);
            } else {
                out && (out.innerHTML = `
                    <div class="status error">
                        Firebase SDK not loaded. Check configuration.
                    </div>
                `);
            }
        };

        // Face Recognition Tests
        window.testFaceAPI = async function testFaceAPI() {
            const output = document.getElementById('faceOutput');
            if (output) output.innerHTML = '<div class="status info">Loading face-api.js models...</div>';

            try {
                // Check if face-api is loaded
                if (typeof faceapi === 'undefined') {
                    output && (output.innerHTML = `
                        <div class="status error">
                            face-api.js not loaded. Include the library first.
                        </div>
                    `);
                    return;
                }

                output && (output.innerHTML = `
                    <div class="status success">
                        face-api.js is available. Models need to be loaded from /static/models/
                    </div>
                `);
            } catch (error) {
                output && (output.innerHTML = `
                    <div class="status error">
                        Error: ${error.message}
                    </div>
                `);
            }
        };

        window.testFaceDetection = async function testFaceDetection() {
            const output = document.getElementById('faceOutput');
            output && (output.innerHTML = '<div class="status info">Starting camera...</div>');

            try {
                const video = document.getElementById('testVideo');
                if (!video) throw new Error('testVideo element not found');
                video.style.display = 'block';

                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = stream;

                output && (output.innerHTML = `
                    <div class="status success">
                        Camera started successfully. Face detection ready.
                    </div>
                `);
            } catch (error) {
                output && (output.innerHTML = `
                    <div class="status error">
                        Camera error: ${error.message}
                    </div>
                `);
            }
        };

        // RFID Tests
        window.simulateRFIDScan = function simulateRFIDScan(uid) {
            const out = document.getElementById('rfidOutput');
            out && (out.innerHTML = `
                <div class="status info">
                    <strong>Simulated RFID Scan:</strong><br>
                    UID: ${uid}
                </div>
            `);
        };

        window.testRFIDWebSocket = async function testRFIDWebSocket() {
            const out = document.getElementById('rfidOutput');
            out && (out.innerHTML = '<div class="status info">Connecting to RFID WebSocket...</div>');

            try {
                const ws = new WebSocket('ws://localhost:5001/rfid');
                ws.onopen = () => {
                    out && (out.innerHTML = '<div class="status success">WebSocket connected!</div>');
                };
                ws.onerror = () => {
                    out && (out.innerHTML = `
                        <div class="status error">
                            WebSocket error. Ensure Raspberry Pi server is running.
                        </div>
                    `);
                };
            } catch (error) {
                out && (out.innerHTML = `
                    <div class="status error">
                        Error: ${error.message}
                    </div>
                `);
            }
        };

        // Module Tests
        window.testQRScanner = function testQRScanner() {
            const out = document.getElementById('moduleOutput');
            if (typeof Html5Qrcode !== 'undefined') {
                out && (out.innerHTML = `
                    <div class="status success">
                        ✓ QRScanner module available<br>
                        Html5Qrcode library loaded
                    </div>
                `);
            } else {
                out && (out.innerHTML = `
                    <div class="status error">
                        ✗ Html5Qrcode library not found
                    </div>
                `);
            }
        };

        window.testFaceVerifier = function testFaceVerifier() {
            const out = document.getElementById('moduleOutput');
            out && (out.innerHTML = `
                <div class="status info">
                    FaceVerifier module requires face-api.js models to be loaded.<br>
                    Check: /static/models/
                </div>
            `);
        };

        window.testRFIDVerifier = function testRFIDVerifier() {
            const out = document.getElementById('moduleOutput');
            out && (out.innerHTML = `
                <div class="status info">
                    RFIDVerifier module ready.<br>
                    Requires Raspberry Pi backend at ws://localhost:5001/rfid
                </div>
            `);
        };

        window.testLockerController = function testLockerController() {
            const out = document.getElementById('moduleOutput');
            out && (out.innerHTML = `
                <div class="status info">
                    LockerController module ready.<br>
                    API endpoint: /api/lockers/{locker_id}/open
                </div>
            `);
        };
    }
});

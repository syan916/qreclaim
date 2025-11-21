/**
 * QR Scanner Module for Kiosk Mode
 * Handles camera access and QR code scanning using html5-qrcode
 */

class QRScanner {
    constructor(containerId, onScanSuccess, onScanError) {
        this.containerId = containerId;
        this.onScanSuccess = onScanSuccess;
        this.onScanError = onScanError;
        this.html5QrCode = null;
        this.isScanning = false;
        this.isMobile = this.detectMobile();
        this._containerReady = false;
        this.browserSupport = this.checkBrowserSupport();
        this._lastNoCodeErrorTime = 0; // For filtering continuous "no code" errors
        // Serialize start/stop/reset operations to avoid race conditions and camera conflicts
        // This ensures only one transition is happening at a time.
        this._opChain = Promise.resolve();
    }

    /**
     * Detect if device is mobile
     */
    detectMobile() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    }

    /**
     * Check browser support for camera streaming
     */
    checkBrowserSupport() {
        const support = {
            getUserMedia: false,
            mediaDevices: false,
            secureContext: false,
            webRTC: false,
            errors: []
        };

        // Check if we're in a secure context (HTTPS or localhost)
        support.secureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (!support.secureContext) {
            support.errors.push('Camera access requires HTTPS or localhost');
        }

        // Check for getUserMedia API
        support.getUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        if (!support.getUserMedia) {
            support.errors.push('getUserMedia API not supported');
        }

        // Check for mediaDevices
        support.mediaDevices = !!navigator.mediaDevices;
        if (!support.mediaDevices) {
            support.errors.push('MediaDevices API not available');
        }

        // Check for WebRTC support
        support.webRTC = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
        if (!support.webRTC) {
            support.errors.push('WebRTC not supported');
        }

        // Check for HTML5 QR Code library
        support.html5QrCode = typeof Html5Qrcode !== 'undefined';
        if (!support.html5QrCode) {
            support.errors.push('HTML5 QR Code library not loaded');
        }

        support.isSupported = support.secureContext && support.getUserMedia && support.mediaDevices && support.html5QrCode;
        
        console.log('Browser support check:', support);
        return support;
    }

    /**
     * Start QR code scanning with comprehensive error handling
     */
    async start() {
        // Queue the start operation to be concurrency-safe
        return this._queue('start', async () => {
            // If already scanning, ignore duplicate start requests
            if (this.isScanning) {
                console.log('QRScanner.start() ignored: already scanning');
                return true;
            }
            try {
            // Check browser support first
            if (!this.browserSupport.isSupported) {
                const errorMsg = this.browserSupport.errors.join(', ') || 'Camera streaming not supported by the browser';
                console.error('Browser support check failed:', errorMsg);
                if (this.onScanError) {
                    this.onScanError(errorMsg);
                }
                return false;
            }

            // Import html5-qrcode dynamically
            if (typeof Html5Qrcode === 'undefined') {
                console.error('Html5Qrcode library not loaded');
                if (this.onScanError) {
                    this.onScanError('QR Scanner library not loaded');
                }
                return false;
            }

            // Ensure container exists and has non-zero dimensions to avoid getImageData IndexSizeError
            const ready = this.ensureContainerSize();
            if (!ready) {
                console.warn('QR container had zero size. Applied fallback min-dimensions. Retrying start in 250ms...');
                await new Promise(r => setTimeout(r, 250));
            }

            // If we have a previous instance that wasn't cleared properly, try to reset it first
            if (this.html5QrCode) {
                try { await this.reset(); } catch (e) { console.warn('Previous QR instance reset failed, continuing:', e); }
            }

            this.html5QrCode = new Html5Qrcode(this.containerId);

            // Configure camera based on device
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                // Disable camera flip to reduce internal canvas re-sizing on some devices
                disableFlip: true,
            };

            // Choose camera facing mode
            const facingMode = this.isMobile ? "environment" : "user";
            
            console.log(`Starting QR scanner (${this.isMobile ? 'mobile' : 'desktop'} mode, camera: ${facingMode})`);

            // Request camera permissions with proper error handling
            try {
                // First, try to get user media to check permissions
                const permissionCheck = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: facingMode }, 
                    audio: false 
                });
                
                // Immediately stop the test stream
                permissionCheck.getTracks().forEach(track => track.stop());
                
                console.log('Camera permission granted');
            } catch (permissionError) {
                console.error('Camera permission denied:', permissionError);
                let errorMessage = 'Camera access denied';
                
                if (permissionError.name === 'NotAllowedError') {
                    errorMessage = 'Camera access denied by user. Please allow camera access to scan QR codes.';
                } else if (permissionError.name === 'NotFoundError') {
                    errorMessage = 'No camera found. Please ensure a camera is connected.';
                } else if (permissionError.name === 'NotReadableError') {
                    errorMessage = 'Camera is already in use by another application.';
                } else if (permissionError.name === 'OverconstrainedError') {
                    errorMessage = 'Camera constraints not satisfied. Please try a different camera.';
                }
                
                if (this.onScanError) {
                    this.onScanError(errorMessage);
                }
                return false;
            }

            await this.html5QrCode.start(
                { facingMode: facingMode },
                config,
                this.onScanSuccess,
                (errorMessage) => {
                    // Filter out continuous "no QR code detected" errors to reduce noise
                    if (errorMessage && errorMessage.includes('No MultiFormat Readers were able to detect the code')) {
                        // This is normal during active scanning - only pass through occasionally
                        if (!this._lastNoCodeErrorTime || Date.now() - this._lastNoCodeErrorTime > 3000) {
                            this._lastNoCodeErrorTime = Date.now();
                            // Only log to console occasionally, don't trigger error callback
                            console.log('QR scanner active - scanning for codes...');
                        }
                        return;
                    }
                    
                    // Pass through actual errors
                    if (this.onScanError) {
                        this.onScanError(errorMessage);
                    }
                }
            );

            this.isScanning = true;
            console.log('✓ QR Scanner started successfully');
            // Attach adaptive brightness controller to the underlying video element created by html5-qrcode
            try {
                if (window.AdaptiveBrightnessController) {
                    // Html5Qrcode injects a <video> into the container; query for it
                    const container = document.getElementById(this.containerId);
                    const video = container ? container.querySelector('video') : null;
                    if (video) {
                        this.brightnessCtrl = new window.AdaptiveBrightnessController({
                            videoEl: video,
                            previewEl: video,
                            targetLuma: 0.52, // QR prefers slightly lower brightness to preserve contrast
                            lowThreshold: 0.32,
                            highThreshold: 0.86,
                            autoTorch: true,
                            samplingIntervalMs: 500,
                            enableExposureTuning: true
                        });
                        this.brightnessCtrl.start();
                    }
                }
            } catch (e) {
                console.warn('AdaptiveBrightnessController for QR failed:', e);
            }
            return true;
        } catch (error) {
            console.error('Error starting QR scanner:', error);
            
            let errorMessage = 'Failed to start camera';
            
            // Handle specific HTML5 QR Code errors
            if (error.message) {
                if (error.message.includes('Camera streaming not supported')) {
                    errorMessage = 'Camera streaming not supported by this browser. Please use a modern browser like Chrome, Firefox, or Safari.';
                } else if (error.message.includes('getUserMedia')) {
                    errorMessage = 'Camera access failed. Please ensure camera permissions are granted.';
                } else if (error.message.includes('IndexSizeError')) {
                    errorMessage = 'Camera initialization error. Please refresh the page and try again.';
                } else if (error.message.includes('NotAllowedError')) {
                    errorMessage = 'Camera access denied. Please allow camera access in your browser settings.';
                } else {
                    errorMessage = error.message;
                }
            }
            
            // Handle specific error types
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Camera access denied. Please allow camera access to scan QR codes.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No camera found. Please ensure a camera is connected to your device.';
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Camera is already in use by another application. Please close other camera apps and try again.';
            } else if (error.name === 'OverconstrainedError') {
                errorMessage = 'Camera constraints not satisfied. The requested camera settings are not supported.';
            } else if (error.name === 'AbortError') {
                errorMessage = 'Camera request was aborted. Please try again.';
            } else if (error.name === 'SecurityError') {
                errorMessage = 'Camera access blocked by security settings. Please use HTTPS or localhost.';
            }
            
            if (this.onScanError) {
                this.onScanError(errorMessage);
            }
            return false;
        }
        });
    }

    /**
     * Stop QR code scanning
     */
    async stop() {
        // Queue the stop operation to serialize transitions and avoid conflicts
        return this._queue('stop', async () => {
            try {
                if (this.html5QrCode && this.isScanning) {
                    await this.html5QrCode.stop();
                    this.isScanning = false;
                    console.log('✓ QR Scanner stopped');
                    // Stop adaptive brightness controller if running
                    try {
                        if (this.brightnessCtrl) {
                            this.brightnessCtrl.stop();
                            this.brightnessCtrl = null;
                        }
                    } catch (_) {}
                    return true;
                }
                // Nothing to stop; return early to avoid deep nesting
                return false;
            } catch (error) {
                console.error('Error stopping QR scanner:', error);
                return false;
            }
        });
    }

    /**
     * Reset scanner (stop and clear)
     */
    async reset() {
        // Queue reset to ensure it runs after any in-flight start/stop
        return this._queue('reset', async () => {
            try {
                await this.stop();
                if (this.html5QrCode) {
                    this.html5QrCode.clear();
                }
                // Ensure filter cleanup in case the video element remained in DOM
                try {
                    const container = document.getElementById(this.containerId);
                    const video = container ? container.querySelector('video') : null;
                    if (video && video.style) {
                        video.style.filter = '';
                    }
                } catch (_) {}
            } catch (error) {
                console.error('Error resetting scanner:', error);
            }
        });
    }

    /**
     * Ensure the scanner container has non-zero dimensions before starting the camera
     * This guards against Html5Qrcode's internal getImageData calls with width/height=0
     */
    ensureContainerSize() {
        try {
            const el = document.getElementById(this.containerId);
            if (!el) {
                console.error(`QR container '${this.containerId}' not found`);
                return false;
            }
            const rect = el.getBoundingClientRect();
            // If width or height are 0, enforce sensible minimums
            if ((rect.width || 0) < 50 || (rect.height || 0) < 50) {
                // Apply minimum dimensions suitable for mobile-first PWA
                el.style.minWidth = el.style.minWidth || '280px';
                el.style.minHeight = el.style.minHeight || '280px';
                // Ensure element is visible
                if (getComputedStyle(el).display === 'none') {
                    el.style.display = 'block';
                }
                this._containerReady = false;
                return false;
            }
            this._containerReady = true;
            return true;
        } catch (e) {
            console.warn('Failed to validate QR container size:', e);
            return false;
        }
    }

    /**
     * Get fallback instructions for unsupported browsers
     */
    getFallbackInstructions() {
        const browser = this.detectBrowser();
        const instructions = {
            chrome: 'Please update Google Chrome to the latest version or ensure you\'re using HTTPS.',
            firefox: 'Please update Firefox to the latest version and ensure camera permissions are granted.',
            safari: 'Please ensure you\'re using Safari 11+ on iOS 11+ or macOS High Sierra+.',
            edge: 'Please update Microsoft Edge to the latest version.',
            other: 'Please use a modern browser like Chrome, Firefox, Safari, or Edge.'
        };
        
        return instructions[browser] || instructions.other;
    }

    /**
     * Detect current browser
     */
    detectBrowser() {
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('chrome') && !userAgent.includes('edge')) return 'chrome';
        if (userAgent.includes('firefox')) return 'firefox';
        if (userAgent.includes('safari') && !userAgent.includes('chrome')) return 'safari';
        if (userAgent.includes('edge')) return 'edge';
        return 'other';
    }

    /**
     * Validate QR code format
     * Expected format: QRC|<claim_id>|<student_id>|<verify_method>
     * OR encrypted JSON: {"claim_id":"C0001","student_id":"1234567","token":"abc123"}
     * @param {string} qrData - Scanned QR data
     * @returns {Object} Validation result
     */
    static validateQRFormat(qrData) {
        try {
            // Guard against empty or whitespace-only payloads
            if (qrData == null || String(qrData).trim().length === 0) {
                return { valid: false, error: 'Empty QR code' };
            }
            // Try parsing as JSON first (encrypted or plain JSON format)
            try {
                const parsed = JSON.parse(qrData);
                if (parsed.claim_id && parsed.student_id && parsed.token) {
                    return {
                        valid: true,
                        format: 'json',
                        data: parsed
                    };
                }
            } catch (e) {
                // Not JSON, try pipe-delimited format
            }

            // Check for QRC|claim_id|student_id|verify_method format
            const parts = qrData.split('|');
            if (parts.length === 4 && parts[0] === 'QRC') {
                const [prefix, claimId, studentId, verifyMethod] = parts;
                
                // Validate claim_id format (C followed by 4 digits)
                if (!/^C\d{4}$/.test(claimId)) {
                    return { valid: false, error: 'Invalid claim ID format' };
                }

                // Validate student_id format (7 digits)
                if (!/^\d{7}$/.test(studentId)) {
                    return { valid: false, error: 'Invalid student ID format' };
                }

                // Validate verify_method
                if (!['face', 'rfid', 'qr_face', 'qr_rfid'].includes(verifyMethod)) {
                    return { valid: false, error: 'Invalid verification method' };
                }

                return {
                    valid: true,
                    format: 'pipe',
                    data: {
                        claim_id: claimId,
                        student_id: studentId,
                        verify_method: verifyMethod
                    }
                };
            }

            // Check if it might be an encrypted envelope (v1: or v2: prefix)
            if (qrData.startsWith('v1:') || qrData.startsWith('v2:')) {
                return {
                    valid: true,
                    format: 'encrypted',
                    data: { encrypted: qrData }
                };
            }

            return { valid: false, error: 'Unrecognized QR code format' };
        } catch (error) {
            console.error('QR validation error:', error);
            return { valid: false, error: 'QR validation failed' };
        }
    }

    /**
     * Internal helper to serialize operations in a simple FIFO chain
     * Avoids deep nesting and unnecessary complexity while ensuring safe transitions.
     */
    _queue(opName, fn) {
        const run = this._opChain.then(async () => {
            try {
                return await fn();
            } catch (e) {
                // Log and rethrow so callers can handle specific failures
                console.error(`QRScanner ${opName} failed:`, e);
                throw e;
            }
        });
        // Maintain the chain even if the current op fails
        this._opChain = run.catch(() => {});
        return run;
    }
}

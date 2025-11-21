/**
 * Face Verification Module for Kiosk Mode
 * Handles face detection and comparison using face-api.js
 */

class FaceVerifier {
    constructor() {
        this.modelsLoaded = false;
        this.videoElement = null;
        this.canvasElement = null;
        this.SIMILARITY_THRESHOLD = 0.6; // Cosine similarity threshold (≤ 0.6 for match)
        // Diagnostics to help surface precise load failures (e.g., missing shards)
        this.lastError = null;
        this.modelDiagnostics = { baseUrl: null, missingFiles: [], checkedFiles: [] };
        // Server-side verification options (used when local descriptor dimension mismatches stored embedding)
        this.serverVerifyEndpoint = '/api/face/verify';

        this.modelsLoaded = false;
        this.videoElement = null;
        this.brightnessCtrl = null;
        this.currentStream = null;
        this.initializationParams = null;
        this.restartCount = 0;
        this.maxRestarts = 3;
    }

    detectorOptions() {
        try {
            return new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        } catch (_) {
            return new faceapi.TinyFaceDetectorOptions();
        }
    }

    /**
     * Load face-api.js models
     */
    async loadModels() {
        if (this.modelsLoaded) return true;

        try {
            // Check if face-api is available
            if (typeof faceapi === 'undefined') {
                console.error('face-api.js library not loaded');
                return false;
            }

            // Resolve model base URL against current origin to avoid localhost/127.0.0.1 mismatches
            const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
                ? window.location.origin
                : '';
            const MODEL_URL = origin + '/static/models';
            this.modelDiagnostics.baseUrl = MODEL_URL;
            // Preflight check to give clear 404 guidance before attempting to load
            const preflightOk = await this.preflightModelFiles(MODEL_URL);
            if (!preflightOk) {
                const msg = `Missing model file(s): ${this.modelDiagnostics.missingFiles.join(', ')}`;
                this.lastError = msg;
                console.error('[FaceVerifier] Preflight failed:', msg);
                return false;
            }
            
            console.log('Loading face detection models...');
            
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);

            this.modelsLoaded = true;
            console.log('✓ Face detection models loaded');
            return true;
        } catch (error) {
            console.error('Error loading face models:', error);
            this.lastError = error && error.message ? error.message : String(error);
            return false;
        }
    }

    /**
     * Preflight check: verify all required model manifest files and shards exist.
     * Provides explicit names for missing files to solve 404 errors quickly.
     * @param {string} baseUrl - Absolute base URL to the models directory
     * @returns {Promise<boolean>} Whether all files appear available
     */
    async preflightModelFiles(baseUrl) {
        const checked = [];
        const missing = [];
        // Some servers (including certain Flask static configurations) may not implement HEAD for static files
        // reliably. We try HEAD first, and if that fails, we fall back to a lightweight GET to confirm existence.
        const head = async (path) => {
            const url = `${baseUrl}/${path}`;
            try {
                const resp = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                checked.push(path);
                return true;
            } catch (e) {
                // Fallback to GET if HEAD returns 404/405 or other errors
                try {
                    const getResp = await fetch(url, { method: 'GET', cache: 'no-cache' });
                    if (!getResp.ok) throw new Error(`HTTP ${getResp.status}`);
                    checked.push(path);
                    return true;
                } catch (err) {
                    missing.push(path);
                    return false;
                }
            }
        };

        // Manifests
        const manifests = [
            'tiny_face_detector_model-weights_manifest.json',
            'face_landmark_68_model-weights_manifest.json',
            'face_recognition_model-weights_manifest.json'
        ];

        for (const mf of manifests) {
            await head(mf);
        }

        // Read recognition manifest to determine expected shards
        try {
            const recManifestUrl = `${baseUrl}/face_recognition_model-weights_manifest.json`;
            const resp = await fetch(recManifestUrl, { method: 'GET', cache: 'no-cache' });
            if (resp.ok) {
                const manifest = await resp.json();
                const paths = Array.isArray(manifest) && manifest[0] && Array.isArray(manifest[0].paths)
                    ? manifest[0].paths
                    : [];
                // Verify each shard listed in the manifest; fall back to GET when HEAD fails
                for (const p of paths) {
                    await head(p);
                }
            } else {
                // If even the manifest can't be fetched, flag it
                missing.push('face_recognition_model-weights_manifest.json');
            }
        } catch (e) {
            missing.push('face_recognition_model-weights_manifest.json');
        }

        // Landmark shards (usually single shard)
        await head('face_landmark_68_model-shard1');
        // Tiny face detector shards (usually single shard)
        await head('tiny_face_detector_model-shard1');

        this.modelDiagnostics.checkedFiles = checked;
        this.modelDiagnostics.missingFiles = missing;
        return missing.length === 0;
    }

    /**
     * Initialize video stream for face capture with optimized aspect ratio for better detection
     * @param {HTMLVideoElement} videoElement - Video element
     * @param {Object} params - Initialization parameters to preserve
     * @returns {Promise<boolean>} Success status
     */
    async initializeVideo(videoElement, params = {}) {
        try {
            this.videoElement = videoElement;
            this.initializationParams = params;
            
            // Log initialization start
            console.log(`[FaceVerifier] Starting video initialization with optimized aspect ratio. Restart count: ${this.restartCount}`);

            // Request optimized aspect ratio for better face detection
            // Use 640x480 for better performance and detection reliability
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 }, // optimized for face detection
                    height: { ideal: 480 },
                    facingMode: 'user'
                },
                audio: false
            });

            // Store stream reference for restart procedures
            this.currentStream = stream;

            // Try to apply additional camera capabilities for better lighting if available.
            // Not all devices support these; we guard with capability checks and ignore failures.
            try {
                const track = stream.getVideoTracks()[0];
                const caps = track.getCapabilities ? track.getCapabilities() : {};
                const advanced = [];
                // Attempt to enable torch on supported mobile devices (front camera usually doesn't support it)
                if (caps.torch) advanced.push({ torch: true });
                // Slight exposure compensation toward brighter image when supported
                if (caps.exposureCompensation) {
                    const mid = (caps.exposureCompensation.min + caps.exposureCompensation.max) / 2;
                    advanced.push({ exposureCompensation: Math.min(caps.exposureCompensation.max, mid + 0.25) });
                }
                // Subtle brightness/contrast adjustments if supported by constraints
                if (caps.brightness) advanced.push({ brightness: Math.min(caps.brightness.max, (caps.brightness.min + caps.brightness.max) / 2) });
                if (caps.contrast) advanced.push({ contrast: Math.min(caps.contrast.max, (caps.contrast.min + caps.contrast.max) / 2) });
                if (advanced.length) await track.applyConstraints({ advanced });
            } catch (_) {
                // Silently ignore if capabilities aren't supported
            }

            videoElement.srcObject = stream;
            
            return new Promise((resolve) => {
                videoElement.onloadedmetadata = () => {
                    videoElement.play();
                    console.log('✓ Video stream initialized');
                    // Start adaptive brightness controller once video is ready
                    try {
                        if (window.AdaptiveBrightnessController) {
                            this.brightnessCtrl = new window.AdaptiveBrightnessController({
                                videoEl: videoElement,
                                previewEl: videoElement, // apply CSS filter directly to visible video
                                targetLuma: 0.58, // slightly brighter target for face landmarks
                                lowThreshold: 0.35,
                                highThreshold: 0.82,
                                autoTorch: true,
                                samplingIntervalMs: 450,
                                enableExposureTuning: true
                            });
                            this.brightnessCtrl.start();
                        }
                    } catch (e) {
                        console.warn('AdaptiveBrightnessController init failed:', e);
                    }
                    resolve(true);
                };
            });
        } catch (error) {
            console.error('Error initializing video:', error);
            
            // Log error with timestamp and error code
            const errorCode = this.getErrorCode(error);
            console.error(`[FaceVerifier] Video initialization error [${errorCode}] at ${new Date().toISOString()}:`, error.message);
            
            // Attempt restart if within retry limit
            if (this.restartCount < this.maxRestarts) {
                this.restartCount++;
                console.log(`[FaceVerifier] Attempting restart ${this.restartCount}/${this.maxRestarts}`);
                return await this.restartVideo();
            }
            
            return false;
        }
    }

    /**
     * Restart video stream while maintaining camera session continuity
     * @returns {Promise<boolean>} Success status
     */
    async restartVideo() {
        try {
            console.log(`[FaceVerifier] Restarting video with preserved parameters`);
            
            // Stop current stream if exists
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => track.stop());
                this.currentStream = null;
            }
            
            // Re-initialize with preserved parameters
            if (this.videoElement && this.initializationParams) {
                return await this.initializeVideo(this.videoElement, this.initializationParams);
            }
            
            return false;
        } catch (error) {
            console.error(`[FaceVerifier] Video restart failed:`, error);
            return false;
        }
    }

    /**
     * Get standardized error code for logging
     * @param {Error} error - Error object
     * @returns {string} Error code
     */
    getErrorCode(error) {
        if (error.name === 'NotAllowedError') return 'CAMERA_PERMISSION_DENIED';
        if (error.name === 'NotFoundError') return 'NO_CAMERA_FOUND';
        if (error.name === 'NotReadableError') return 'CAMERA_IN_USE';
        if (error.name === 'OverconstrainedError') return 'CONSTRAINT_NOT_SUPPORTED';
        if (error.name === 'AbortError') return 'OPERATION_ABORTED';
        return 'UNKNOWN_ERROR';
    }

    /**
     * Reset restart counter after successful operation
     */
    resetRestartCounter() {
        this.restartCount = 0;
        console.log(`[FaceVerifier] Restart counter reset`);
    }

    /**
     * Stop video stream with proper cleanup
     */
    stopVideo() {
        console.log(`[FaceVerifier] Stopping video stream`);
        
        // Stop current stream if exists
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
        }
        
        // Stop video element stream
        if (this.videoElement && this.videoElement.srcObject) {
            const stream = this.videoElement.srcObject;
            const tracks = stream.getTracks();
            tracks.forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }
        
        // Stop brightness controller
        if (this.brightnessCtrl) {
            this.brightnessCtrl.stop();
            this.brightnessCtrl = null;
        }
        
        // Reset restart counter
        this.resetRestartCounter();
    }

    /**
     * Get current face detection without extracting descriptor
     * @returns {Promise<Object>} Current face detection or null
     */
    async getCurrentFaceDetection() {
        try {
            if (!this.modelsLoaded) {
                await this.loadModels();
            }

            if (!this.videoElement) {
                return null;
            }

            const detection = await faceapi
                .detectSingleFace(this.videoElement, this.detectorOptions())
                .withFaceLandmarks();

            return detection || null;
        } catch (error) {
            console.warn('Error getting current face detection:', error);
            return null;
        }
    }

    /**
     * Capture a face descriptor from the current video frame with enhanced logging
     * @returns {Promise<{success: boolean, descriptor?: Array, error?: string, timestamp?: string}>}
     */
    async captureFaceDescriptor() {
        try {
            if (!this.modelsLoaded) {
                const ok = await this.loadModels();
                if (!ok) {
                    return { success: false, error: this.lastError || 'Failed to load models' };
                }
            }

            if (!this.videoElement) {
                return { success: false, error: 'Video not initialized' };
            }

            const timestamp = new Date().toISOString();
            console.log(`[FaceVerifier] Starting face descriptor capture at ${timestamp}`);
            
            // Log video dimensions for debugging
            const video = this.videoElement;
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            console.log(`[FaceVerifier] Video dimensions for descriptor capture: ${vw}x${vh}`);
            
            const detection = await faceapi
                .detectSingleFace(this.videoElement, this.detectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) {
                return { success: false, error: 'No face detected. Please position your face in the camera.', code: 'NO_FACE_DETECTED', timestamp };
            }

            console.log('✓ Face detected and descriptor extracted');
            
            // Reset restart counter on successful capture
            this.resetRestartCounter();
            
            return {
                success: true,
                descriptor: Array.from(detection.descriptor),
                detection: detection.detection,
                timestamp,
                code: 'FACE_DESCRIPTOR_CAPTURED'
            };
        } catch (error) {
            console.error('[FaceVerifier] Error capturing face descriptor:', error);
            
            // Log error with timestamp and error code
            const errorCode = this.getErrorCode(error);
            console.error(`[FaceVerifier] Face descriptor capture error [${errorCode}] at ${new Date().toISOString()}:`, error.message);
            
            return { success: false, error: error.message, errorCode, code: 'DESCRIPTOR_CAPTURE_ERROR', timestamp: new Date().toISOString() };
        }
    }

    /**
     * Capture a square face crop from the current video frame as a PNG data URL.
     * Optimized for face detection with enhanced error handling.
     * - Uses detection box with margin when available; otherwise central crop.
     * - Optimized for better face detection and capture reliability
     * @param {number} size - Output square size in pixels (default 384)
     * @returns {Promise<{success: boolean, dataUrl?: string, error?: string, aspectRatio?: number}>}
     */
    async captureFaceCropDataURL(size = 384) {
        try {
            if (!this.modelsLoaded) {
                const ok = await this.loadModels();
                if (!ok) return { success: false, error: this.lastError || 'Failed to load models' };
            }
            if (!this.videoElement) {
                return { success: false, error: 'Video not initialized' };
            }

            // Log capture attempt with video dimensions
            const video = this.videoElement;
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            const aspectRatio = vw / vh;
            
            console.log(`[FaceVerifier] Capturing face crop. Video dimensions: ${vw}x${vh}, aspect ratio: ${aspectRatio.toFixed(2)}`);

            // Attempt a lightweight detection to obtain bounding box
            const det = await faceapi
                .detectSingleFace(this.videoElement, this.detectorOptions())
                .withFaceLandmarks();

            // Create offscreen canvas for square output
            const off = document.createElement('canvas');
            off.width = size;
            off.height = size;
            const ctx = off.getContext('2d');
            // Improve resampling quality when scaling to the output size
            try {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
            } catch (e) {}

            // Compute crop region
            let sx = 0, sy = 0, sw = vw, sh = vh;
            try {
                const box = det && det.detection ? det.detection.box || det.detection : null;
                if (box) {
                    const x = box.x || box._x || 0;
                    const y = box.y || box._y || 0;
                    const w = box.width || box._width || vw;
                    const h = box.height || box._height || vh;
                    const centerX = x + w / 2;
                    const centerY = y + h / 2;
                    const side = Math.min(Math.floor(Math.max(w, h) * 1.08), Math.min(vw, vh));
                    sx = Math.max(0, Math.min(vw - side, Math.round(centerX - side / 2)));
                    sy = Math.max(0, Math.min(vh - side, Math.round(centerY - side / 2)));
                    sw = side;
                    sh = side;
                } else {
                    // Central square crop when detection not available
                    const side = Math.min(vw, vh);
                    sx = Math.round((vw - side) / 2);
                    sy = Math.round((vh - side) / 2);
                    sw = side;
                    sh = side;
                }
            } catch (_) {
                const side = Math.min(vw, vh);
                sx = Math.round((vw - side) / 2);
                sy = Math.round((vh - side) / 2);
                sw = side;
                sh = side;
            }

            // Draw cropped region scaled to square output
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, size, size);

            const dataUrl = off.toDataURL('image/png');
            console.log(`[FaceVerifier] Face crop captured successfully. Output size: ${size}x${size}`);
            return { success: true, dataUrl, aspectRatio, code: 'FACE_CROP_CAPTURED' };
        } catch (error) {
            console.error('[FaceVerifier] Error capturing face crop data URL:', error);
            
            // Log error with timestamp and error code
            const errorCode = this.getErrorCode(error);
            console.error(`[FaceVerifier] Face capture error [${errorCode}] at ${new Date().toISOString()}:`, error.message);
            
            return { success: false, error: error.message, errorCode, code: 'FACE_CROP_ERROR' };
        }
    }

    /**
     * Compare two face descriptors using cosine similarity
     * @param {Array} descriptor1 - First face descriptor
     * @param {Array} descriptor2 - Second face descriptor (from database)
     * @returns {Object} Comparison result
     */
    compareFaces(descriptor1, descriptor2) {
        try {
            if (!descriptor1 || !descriptor2) {
                return { match: false, similarity: 0, error: 'Missing descriptor' };
            }
            // Convert to Float32Array if needed
            const desc1 = new Float32Array(descriptor1);
            const desc2 = new Float32Array(descriptor2);

            // Dimension validation before attempting similarity
            if (desc1.length !== desc2.length) {
                const dims = { current_dim: desc1.length, stored_dim: desc2.length };
                console.warn('[FaceVerifier] Embedding dimension mismatch:', dims);
                return {
                    match: false,
                    similarity: 1, // Max distance
                    threshold: this.SIMILARITY_THRESHOLD,
                    error: 'EMBEDDING_DIMENSION_MISMATCH',
                    dims
                };
            }

            // Calculate cosine similarity distance (1 - similarity)
            const similarity = this.cosineSimilarity(desc1, desc2);
            
            // Match if similarity distance ≤ threshold
            const match = similarity <= this.SIMILARITY_THRESHOLD;

            console.log(`Face comparison: similarity=${similarity.toFixed(4)}, match=${match}`);

            return {
                match: match,
                similarity: similarity,
                threshold: this.SIMILARITY_THRESHOLD
            };
        } catch (error) {
            console.error('Error comparing faces:', error);
            return { match: false, similarity: 0, error: error.message };
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     * Lower distance means more similar (typically use threshold ≤ 0.6)
     */
    cosineSimilarity(vec1, vec2) {
        // Local function expects equal shapes. This should only be called when lengths match.
        if (vec1.length !== vec2.length) {
            // Return max distance to avoid throwing; caller should handle mismatch (we already do above).
            return 1;
        }

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
        
        if (magnitude === 0) {
            return 1; // Maximum distance
        }

        // Return distance (1 - similarity) so lower is better
        return 1 - (dotProduct / magnitude);
    }

    /**
     * Verify face against stored embedding
     * @param {Array} storedEmbedding - Stored face embedding from claim
     * @returns {Promise<Object>} Verification result
     */
    async verifyFace(storedEmbedding, claimId = null) {
        try {
            // Capture current face
            const captureResult = await this.captureFaceDescriptor();
            
            if (!captureResult.success) {
                return captureResult;
            }

            // Compare faces
            const comparison = this.compareFaces(captureResult.descriptor, storedEmbedding);

            // If dimension mismatch, fall back to server-side verification that mirrors registration pipeline
            if (comparison && comparison.error === 'EMBEDDING_DIMENSION_MISMATCH') {
                console.log('[FaceVerifier] Falling back to server-side verification due to embedding dim mismatch');
                const crop = await this.captureFaceCropDataURL(384);
                if (!crop.success) {
                    return { success: false, error: crop.error || 'Failed to capture face image for server verification' };
                }
                const serverResult = await this.verifyFaceServer(storedEmbedding, crop.dataUrl, claimId);
                return serverResult;
            }

            return {
                success: true,
                match: comparison.match,
                similarity: comparison.similarity,
                threshold: comparison.threshold,
                code: comparison.match ? 'FACE_MATCH' : 'FACE_MISMATCH'
            };
        } catch (error) {
            console.error('Face verification error:', error);
            return { success: false, error: error.message, code: 'FACE_VERIFY_ERROR' };
        }
    }

    /**
     * Server-side verification fallback: send current face crop and stored embedding for comparison.
     * Converts server cosine score to distance form used by kiosk UI for consistency.
     * @param {Array<number>} storedEmbedding - Embedding from claim
     * @param {string} faceDataUrl - PNG data URL of current face crop
     * @returns {Promise<{success: boolean, match?: boolean, similarity?: number, threshold?: number, error?: string}>}
     */
    async verifyFaceServer(storedEmbedding, faceDataUrl, claimId = null) {
        try {
            const payload = {
                face_data_url: faceDataUrl,
                stored_embedding: Array.isArray(storedEmbedding) ? storedEmbedding : [],
                method: 'cosine',
                threshold: 0.85 // Align with backend default for LBP/DeepFace
            };
            if (claimId) {
                payload.claim_id = claimId;
            }
            const resp = await fetch(this.serverVerifyEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                const err = data && data.error ? data.error : `HTTP ${resp.status}`;
                return { success: false, error: `Server verification failed: ${err}`, code: 'SERVER_VERIFICATION_FAILED' };
            }
            // Convert server cosine score (higher is better) to distance (lower better) for kiosk UI
            const distance = 1 - Number(data.score || 0);
            const thresholdDistance = 1 - Number(data.threshold || 0.85);

            return {
                success: true,
                match: Boolean(data.match),
                similarity: distance,
                threshold: thresholdDistance,
                code: data.match ? 'FACE_MATCH' : 'FACE_MISMATCH'
            };
        } catch (error) {
            console.error('Server verification error:', error);
            return { success: false, error: error.message, code: 'SERVER_VERIFICATION_ERROR' };
        }
    }
}

/**
 * Firebase Service for Kiosk Mode
 * Handles Firestore operations for claim verification
 */

class FirebaseService {
    constructor() {
        this.db = null;
        this.initialized = false;
        // Track whether we have forced long polling for environments
        // where WebChannel is blocked by proxies/VPN/ad-blockers.
        this.longPollingEnabled = false;
        // Retry configuration
        this.MAX_ATTEMPTS = 3;
        this.BASE_DELAY_MS = 400; // base delay for exponential backoff
    }

    /**
     * Initialize Firebase (if not already initialized)
     */
    async init() {
        if (this.initialized) return true;

        try {
            // Check if Firebase is already initialized globally
            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                // Enable long polling in development to avoid WebChannel transport issues
                // Common causes: corporate proxies, VPNs, strict firewalls, certain extensions.
                try {
                    firebase.firestore().settings({
                        experimentalForceLongPolling: true,
                        useFetchStreams: false
                    });
                    this.longPollingEnabled = true;
                } catch (settingsErr) {
                    // Settings may throw if called after Firestore is in use; log and continue.
                    console.warn('Firestore settings could not be applied:', settingsErr);
                }

                this.db = firebase.firestore();
                this.initialized = true;
                console.log('✓ Firebase Service initialized');
                return true;
            } else {
                // SDK may be loaded, but the app is not initialized due to missing web config.
                // Run in offline mode gracefully without spamming errors.
                console.warn('Firebase SDK detected but app is not initialized. Running kiosk in offline mode. Provide firebaseConfig to enable Firestore.');
                return false;
            }
        } catch (error) {
            console.error('Firebase initialization error:', error);
            return false;
        }
    }

    /**
     * Proactively check connectivity to Firestore and attempt to recover
     * from offline mode. Returns true if a simple read succeeds.
     */
    async checkConnectivity() {
        try {
            if (!this.initialized) {
                await this.init();
            }

            // If still not initialized, we are in offline mode
            if (!this.initialized || !this.db) {
                return false;
            }

            // Attempt to ensure network is enabled
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore().enableNetwork) {
                await firebase.firestore().enableNetwork().catch(() => {});
            }

            // Lightweight read to confirm connectivity
            const pingRef = this.db.collection('_health').doc('ping');
            await pingRef.get();
            return true;
        } catch (err) {
            console.warn('Firestore connectivity check failed:', err && err.message ? err.message : err);
            return false;
        }
    }

    /**
     * Determine if an error is transient (network-related or retryable)
     */
    isTransientError(error) {
        const msg = (error && error.message) ? error.message : String(error);
        return /UNAVAILABLE|DEADLINE_EXCEEDED|client is offline|network|Failed to fetch|timeout/i.test(msg);
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetch claim data from Firestore
     * @param {string} claimId - Claim ID
     * @returns {Promise<Object>} Claim data or error
     */
    async getClaim(claimId) {
        let attempt = 0;
        while (attempt < this.MAX_ATTEMPTS) {
            try {
                if (!this.initialized) {
                    await this.init();
                }

                // If we are offline, try to recover and provide clearer error feedback
                const online = await this.checkConnectivity();
                if (!online) {
                    return { success: false, error: 'Offline: Firestore disabled (no firebaseConfig). QR-only flow is available.' };
                }

                const claimRef = this.db.collection('claims').doc(claimId);
                const snapshot = await claimRef.get();

                if (!snapshot.exists) {
                    return { success: false, error: 'Claim not found' };
                }

                const data = snapshot.data();
                return { 
                    success: true, 
                    data: {
                        claim_id: data.claim_id || claimId,
                        student_id: data.student_id,
                        found_item_id: data.found_item_id,
                        verification_method: data.verification_method,
                        status: data.status,
                        face_embedding: data.face_embedding,
                        face_image_base64: data.face_image_base64,
                        rfid_uid: data.rfid_uid,
                        expires_at: data.expires_at,
                        locker_id: data.locker_id
                    }
                };
            } catch (error) {
                console.error('Error fetching claim (attempt ' + (attempt + 1) + '):', error);
                const msg = (error && error.message) ? error.message : String(error);
                if (this.isTransientError(error) && attempt < this.MAX_ATTEMPTS - 1) {
                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt);
                    await this.sleep(delay);
                    attempt++;
                    continue; // retry
                }
                if (/Missing or insufficient permissions|PERMISSION_DENIED/i.test(msg)) {
                    return { success: false, error: 'Missing or insufficient permissions for claims collection. Update Firestore rules.' };
                }
                if (msg.includes('client is offline') || msg.includes('UNAVAILABLE')) {
                    return { success: false, error: 'Offline: Firestore unavailable. Verify internet connectivity and Firebase project configuration.' };
                }
                return { success: false, error: msg };
            }
        }
    }

    async getClaimByToken(token) {
        let attempt = 0;
        while (attempt < this.MAX_ATTEMPTS) {
            try {
                if (!this.initialized) {
                    await this.init();
                }
                const online = await this.checkConnectivity();
                if (!online) {
                    return { success: false, error: 'Offline: Firestore disabled (no firebaseConfig). QR-only flow is available.' };
                }
                let snapshot = null;
                const col = this.db.collection('claims');
                snapshot = await col.where('token', '==', token).limit(1).get();
                if (snapshot && snapshot.empty) {
                    snapshot = await col.where('qr_token', '==', token).limit(1).get();
                }
                if (!snapshot || snapshot.empty) {
                    return { success: false, error: 'Claim not found' };
                }
                const doc = snapshot.docs[0];
                const data = doc.data() || {};
                return {
                    success: true,
                    data: {
                        claim_id: data.claim_id || doc.id,
                        student_id: data.student_id,
                        found_item_id: data.found_item_id,
                        verification_method: data.verification_method,
                        status: data.status,
                        face_embedding: data.face_embedding,
                        face_image_base64: data.face_image_base64,
                        rfid_uid: data.rfid_uid,
                        expires_at: data.expires_at,
                        locker_id: data.locker_id
                    }
                };
            } catch (error) {
                console.error('Error fetching claim by token (attempt ' + (attempt + 1) + '):', error);
                const msg = (error && error.message) ? error.message : String(error);
                if (this.isTransientError(error) && attempt < this.MAX_ATTEMPTS - 1) {
                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt);
                    await this.sleep(delay);
                    attempt++;
                    continue;
                }
                if (/Missing or insufficient permissions|PERMISSION_DENIED/i.test(msg)) {
                    return { success: false, error: 'Missing or insufficient permissions for claims collection. Update Firestore rules.' };
                }
                if (msg.includes('client is offline') || msg.includes('UNAVAILABLE')) {
                    return { success: false, error: 'Offline: Firestore unavailable. Verify internet connectivity and Firebase project configuration.' };
                }
                return { success: false, error: msg };
            }
        }
    }

    /**
     * Update claim status to claimed
     * @param {string} claimId - Claim ID
     * @param {string} claimedTime - Claimed timestamp
     * @returns {Promise<Object>} Update result
     */
    async updateClaimStatus(claimId, claimedTime) {
        let attempt = 0;
        while (attempt < this.MAX_ATTEMPTS) {
            try {
                if (!this.initialized) {
                    await this.init();
                }

                // If Firestore is unavailable, surface a friendly error
                if (!this.initialized || !this.db) {
                    return { success: false, error: 'Offline: Firestore not available. Provide firebaseConfig to update claim status.' };
                }

                const claimRef = this.db.collection('claims').doc(claimId);
                const snap = await claimRef.get();
                const data = snap.exists ? (snap.data() || {}) : {};
                await claimRef.update({
                    status: 'completed',
                    claimed_time: claimedTime,
                    verified_at: firebase.firestore.FieldValue.serverTimestamp(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
                const fi = data.found_item_id;
                const sid = data.student_id;
                if (fi) {
                    await this.db.collection('found_items').doc(fi).update({
                        status: 'claimed',
                        claimed_by: sid || null,
                        claimed_at: firebase.firestore.FieldValue.serverTimestamp(),
                        updated_at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

                console.log(`✓ Claim ${claimId} updated to Claimed status`);
                return { success: true };
            } catch (error) {
                console.error('Error updating claim status (attempt ' + (attempt + 1) + '):', error);
                const msg = (error && error.message) ? error.message : String(error);
                if (this.isTransientError(error) && attempt < this.MAX_ATTEMPTS - 1) {
                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt);
                    await this.sleep(delay);
                    attempt++;
                    continue; // retry
                }
                if (/Missing or insufficient permissions|PERMISSION_DENIED/i.test(msg)) {
                    return { success: false, error: 'Missing or insufficient permissions for updating claim status. Please update Firestore rules.' };
                }
                return { success: false, error: msg };
            }
        }
    }

    /**
     * Get found item details
     * @param {string} itemId - Found item ID
     * @returns {Promise<Object>} Item data
     */
    async getFoundItem(itemId) {
        try {
            if (!this.initialized) {
                await this.init();
            }

            if (!this.initialized || !this.db) {
                return { success: false, error: 'Offline: Firestore not available. Provide firebaseConfig to fetch item details.' };
            }

            const itemRef = this.db.collection('found_items').doc(itemId);
            const snapshot = await itemRef.get();

            if (!snapshot.exists) {
                return { success: false, error: 'Item not found' };
            }

            const data = snapshot.data();
            return { 
                success: true, 
                data: {
                    found_item_id: data.found_item_id,
                    found_item_name: data.found_item_name,
                    locker_id: data.locker_id
                }
            };
        } catch (error) {
            console.error('Error fetching item:', error);
            return { success: false, error: error.message };
        }
    }
}

// Export singleton instance
const firebaseService = new FirebaseService();

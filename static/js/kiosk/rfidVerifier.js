/**
 * RFID Verification Module for Kiosk Mode
 * Handles RFID card scanning via REST/WebSocket communication with Raspberry Pi
 */

class RFIDVerifier {
    constructor() {
        this.websocket = null;
        this.isConnected = false;
        this.timeout = 60000; // 60 seconds timeout for RFID verification
        this.piEndpoint = 'http://localhost:5001'; // Raspberry Pi REST endpoint
        this.wsEndpoint = 'ws://localhost:5001/rfid'; // WebSocket endpoint
        this.useWebSocket = true; // Prefer WebSocket over REST
        this.scanStartTime = null; // Track scan start time for performance metrics
    }

    /**
     * Initialize WebSocket connection to Raspberry Pi
     */
    async initWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                console.log('Connecting to RFID reader via WebSocket...');
                
                this.websocket = new WebSocket(this.wsEndpoint);
                
                this.websocket.onopen = () => {
                    this.isConnected = true;
                    console.log('✓ WebSocket connected to RFID reader');
                    resolve(true);
                };

                this.websocket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.isConnected = false;
                    reject(error);
                };

                this.websocket.onclose = () => {
                    this.isConnected = false;
                    console.log('WebSocket connection closed');
                };

            } catch (error) {
                console.error('Error initializing WebSocket:', error);
                reject(error);
            }
        });
    }

    /**
     * Wait for RFID card scan (WebSocket method)
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<Object>} Scanned UID or error
     */
    async waitForCardScanWS(timeoutMs = this.timeout) {
        return new Promise(async (resolve, reject) => {
            if (!this.isConnected) {
                try {
                    await this.initWebSocket();
                } catch (error) {
                    return resolve({ 
                        success: false, 
                        error: 'Could not connect to RFID reader',
                        fallback: 'rest'
                    });
                }
            }

            const timer = setTimeout(() => {
                this.websocket.onmessage = null;
                const elapsed = this.scanStartTime ? Date.now() - this.scanStartTime : timeoutMs;
                console.warn(`RFID scan timeout after ${elapsed}ms`);
                resolve({ success: false, error: `Timeout: No card detected within ${Math.round(timeoutMs/1000)} seconds` });
            }, timeoutMs);

            this.websocket.onmessage = (event) => {
                clearTimeout(timer);
                
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.uid) {
                        console.log('✓ RFID card detected:', data.uid);
                        resolve({ success: true, uid: data.uid });
                    } else if (data.error) {
                        resolve({ success: false, error: data.error });
                    } else {
                        resolve({ success: false, error: 'Invalid RFID response' });
                    }
                } catch (error) {
                    console.error('Error parsing RFID data:', error);
                    resolve({ success: false, error: 'Failed to parse RFID data' });
                }
            };

            // Send scan request
            try {
                this.websocket.send(JSON.stringify({ action: 'scan' }));
            } catch (error) {
                clearTimeout(timer);
                resolve({ success: false, error: 'Failed to send scan request' });
            }
        });
    }

    /**
     * Wait for RFID card scan (REST API method - fallback)
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<Object>} Scanned UID or error
     */
    async waitForCardScanREST(timeoutMs = this.timeout) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const pollInterval = 500; // Poll every 500ms

            const poll = async () => {
                try {
                    const response = await fetch(`${this.piEndpoint}/api/rfid/scan`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timeout: 1 })
                    });

                    const data = await response.json();

                    if (data.success && data.uid) {
                        console.log('✓ RFID card detected:', data.uid);
                        resolve({ success: true, uid: data.uid });
                        return;
                    }
                } catch (error) {
                    console.error('RFID poll error:', error);
                }

                // Check timeout
                if (Date.now() - startTime >= timeoutMs) {
                    console.warn(`RFID REST scan timeout after ${Date.now() - startTime}ms`);
                    resolve({ success: false, error: `Timeout: No card detected within ${Math.round(timeoutMs/1000)} seconds` });
                    return;
                }

                // Continue polling
                setTimeout(poll, pollInterval);
            };

            poll();
        });
    }

    /**
     * Main method to wait for card scan (tries WebSocket first, then REST)
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<Object>} Scanned UID or error
     */
    async waitForCardScan(timeoutMs = this.timeout) {
        this.scanStartTime = Date.now();
        console.log(`Starting RFID card scan with ${Math.round(timeoutMs/1000)}s timeout...`);
        
        if (this.useWebSocket) {
            const result = await this.waitForCardScanWS(timeoutMs);
            
            // Fallback to REST if WebSocket fails
            if (!result.success && result.fallback === 'rest') {
                console.log('Falling back to REST API for RFID...');
                const restResult = await this.waitForCardScanREST(timeoutMs);
                const totalDuration = Date.now() - this.scanStartTime;
                console.log(`RFID scan completed in ${totalDuration}ms (with fallback)`);
                return restResult;
            }
            
            const totalDuration = Date.now() - this.scanStartTime;
            console.log(`RFID scan completed in ${totalDuration}ms`);
            return result;
        } else {
            const result = await this.waitForCardScanREST(timeoutMs);
            const totalDuration = Date.now() - this.scanStartTime;
            console.log(`RFID scan completed in ${totalDuration}ms (REST mode)`);
            return result;
        }
    }

    /**
     * Verify RFID UID against stored UID
     * @param {string} scannedUID - Scanned RFID UID
     * @param {string} storedUID - Stored UID from claim
     * @returns {Object} Verification result
     */
    verifyUID(scannedUID, storedUID) {
        try {
            if (!scannedUID || !storedUID) {
                return { 
                    success: false, 
                    match: false, 
                    error: 'Missing UID data' 
                };
            }

            // Normalize UIDs (remove spaces, convert to uppercase)
            const normalizedScanned = scannedUID.replace(/\s+/g, '').toUpperCase();
            const normalizedStored = storedUID.replace(/\s+/g, '').toUpperCase();

            const match = normalizedScanned === normalizedStored;

            console.log(`RFID verification: ${match ? 'MATCH' : 'MISMATCH'}`);
            console.log(`  Scanned: ${normalizedScanned}`);
            console.log(`  Stored:  ${normalizedStored}`);

            return {
                success: true,
                match: match,
                scanned: normalizedScanned,
                stored: normalizedStored
            };
        } catch (error) {
            console.error('RFID verification error:', error);
            return { 
                success: false, 
                match: false, 
                error: error.message 
            };
        }
    }

    /**
     * Close WebSocket connection
     */
    disconnect() {
        if (this.websocket && this.isConnected) {
            this.websocket.close();
            this.isConnected = false;
            console.log('✓ RFID WebSocket disconnected');
        }
    }
}

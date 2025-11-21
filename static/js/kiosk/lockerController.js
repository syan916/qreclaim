/**
 * Locker Controller Module for Kiosk Mode
 * Handles locker operations via REST API
 */

class LockerController {
    constructor() {
        this.apiBaseUrl = window.location.origin; // Use current origin
    }

    /**
     * Open locker by ID
     * @param {string} lockerId - Locker ID
     * @param {string} claimId - Claim ID
     * @param {string} studentId - Student ID
     * @param {string} timestamp - Claim timestamp
     * @returns {Promise<Object>} Open result
     */
    async openLocker(lockerId, claimId, studentId, timestamp) {
        try {
            console.log(`Opening locker: ${lockerId} for claim: ${claimId}`);

            const response = await fetch(`${this.apiBaseUrl}/api/lockers/${lockerId}/open`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    claim_id: claimId,
                    student_id: studentId,
                    timestamp: timestamp,
                    duration_sec: 10 // Auto-close after 10 seconds
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('Failed to open locker:', data);
                return { 
                    success: false, 
                    error: data.error || 'Failed to open locker' 
                };
            }

            console.log('✓ Locker opened successfully');
            return { 
                success: true, 
                message: data.message,
                auto_close_at: data.auto_close_at
            };
        } catch (error) {
            console.error('Error opening locker:', error);
            return { 
                success: false, 
                error: error.message || 'Network error while opening locker' 
            };
        }
    }

    /**
     * Close locker by ID
     * @param {string} lockerId - Locker ID
     * @returns {Promise<Object>} Close result
     */
    async closeLocker(lockerId) {
        try {
            console.log(`Closing locker: ${lockerId}`);

            const response = await fetch(`${this.apiBaseUrl}/api/lockers/${lockerId}/close`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('Failed to close locker:', data);
                return { 
                    success: false, 
                    error: data.error || 'Failed to close locker' 
                };
            }

            console.log('✓ Locker closed successfully');
            return { success: true, message: data.message };
        } catch (error) {
            console.error('Error closing locker:', error);
            return { 
                success: false, 
                error: error.message || 'Network error while closing locker' 
            };
        }
    }

    /**
     * Get locker status
     * @param {string} lockerId - Locker ID
     * @returns {Promise<Object>} Locker status
     */
    async getLockerStatus(lockerId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/lockers`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: 'Failed to fetch locker status' };
            }

            const locker = data.lockers?.find(l => l.locker_id === lockerId);

            if (!locker) {
                return { success: false, error: 'Locker not found' };
            }

            return { 
                success: true, 
                status: locker.status,
                location: locker.location
            };
        } catch (error) {
            console.error('Error getting locker status:', error);
            return { 
                success: false, 
                error: error.message || 'Network error while checking locker status' 
            };
        }
    }
}

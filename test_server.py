#!/usr/bin/env python3
"""
Simple test server for Qreclaim Kiosk Mode
This server provides a minimal Flask application to test the kiosk interface
"""

from flask import Flask, render_template, jsonify, request
import json
import time
from datetime import datetime

app = Flask(__name__)

# Mock data for testing
MOCK_CLAIMS = {
    "TEST12345": {
        "claim_id": "TEST12345",
        "student_id": "S12345678",
        "item_description": "Black laptop bag with red zipper",
        "found_location": "Library 3rd floor",
        "found_date": "2024-01-15",
        "locker_id": "A-01",
        "verification_method": "qr_face",
        "face_embedding": [0.1, 0.2, 0.3, 0.4, 0.5],  # Mock embedding
        "rfid_uid": None,
        "status": "verified",
        "created_at": datetime.now().isoformat()
    }
}

# Simple in-memory locker states and audit trail for testing
LOCKER_STATES = {
    "A-01": {"status": "closed", "updated_at": None},
    "B-02": {"status": "closed", "updated_at": None},
}

AUDIT_LOG = []

def audit(event_type: str, detail: dict):
    entry = {
        "ts": datetime.now().isoformat(timespec='seconds'),
        "event": event_type,
        "detail": detail,
    }
    AUDIT_LOG.append(entry)
    # Also print for visibility in console
    print(f"[AUDIT] {entry['ts']} {event_type}: {json.dumps(detail)}")

def update_claim_status_in_db(claim_id: str, new_status: str):
    """Update claim status in the mock database with error handling."""
    try:
        claim = MOCK_CLAIMS.get(claim_id)
        if not claim:
            return False, "Claim not found"
        prev = claim.get("status")
        claim["status"] = new_status
        claim["updated_at"] = datetime.now().isoformat()
        audit("claim_status_update", {"claim_id": claim_id, "from": prev, "to": new_status})
        return True, None
    except Exception as e:
        return False, f"DB error: {e}"

def update_locker_status_in_db(locker_id: str, new_status: str, meta: dict = None):
    """Update locker status with error handling and audit."""
    try:
        state = LOCKER_STATES.get(locker_id)
        if not state:
            # initialize unknown locker for test purposes
            LOCKER_STATES[locker_id] = {"status": "unknown", "updated_at": None}
            state = LOCKER_STATES[locker_id]
        prev = state.get("status")
        state["status"] = new_status
        state["updated_at"] = datetime.now().isoformat()
        audit("locker_status_update", {"locker_id": locker_id, "from": prev, "to": new_status, **(meta or {})})
        return True, None
    except Exception as e:
        return False, f"DB error: {e}"

@app.route('/')
def index():
    """Main page redirecting to kiosk mode"""
    return render_template('kiosks/test-kiosk-mode.html')

@app.route('/kiosk')
def kiosk_mode():
    """Kiosk mode interface"""
    return render_template('kiosks/kiosk-mode.html')

@app.route('/api/qr/verify', methods=['POST'])
def verify_qr():
    """Mock QR code verification"""
    data = request.get_json()
    qr_raw = data.get('qr_raw', '')
    
    # Simulate processing delay
    time.sleep(0.5)
    
    # Mock validation - accept any QR containing "TEST"
    if "TEST" in qr_raw:
        return jsonify({
            "valid": True,
            "claim_id": "TEST12345",
            "student_id": "S12345678",
            "verification_method": "qr_face"
        })
    else:
        return jsonify({
            "valid": False,
            "error": "Invalid QR code format"
        }), 400

@app.route('/api/locker/unlock', methods=['POST'])
def unlock_locker():
    """Legacy mock locker unlock endpoint (kept for backward compatibility)."""
    data = request.get_json() or {}
    locker_id = data.get('locker_id')
    if not locker_id:
        return jsonify({"success": False, "error": "locker_id required"}), 400
    # Simulate processing delay
    time.sleep(0.6)
    ok, err = update_locker_status_in_db(locker_id, 'open', {"source": "legacy_unlock"})
    if not ok:
        return jsonify({"success": False, "error": err}), 500
    return jsonify({
        "success": True,
        "message": f"Locker {locker_id} unlocked successfully",
        "locker": {"locker_id": locker_id, **LOCKER_STATES.get(locker_id, {})}
    })

@app.route('/api/lockers/<locker_id>/open', methods=['POST'])
def open_locker(locker_id):
    """LockerController-compatible route to open a locker.
    Expects JSON: {claim_id, student_id, timestamp, duration_sec}
    """
    data = request.get_json() or {}
    claim_id = data.get('claim_id')
    student_id = data.get('student_id')
    ts = data.get('timestamp') or datetime.now().isoformat()
    duration_sec = data.get('duration_sec')
    # Simulate the physical open action delay
    time.sleep(0.6)
    ok, err = update_locker_status_in_db(locker_id, 'open', {
        "claim_id": claim_id,
        "student_id": student_id,
        "timestamp": ts,
        "duration_sec": duration_sec
    })
    if not ok:
        return jsonify({"success": False, "error": err}), 500
    # Verification step: read back state
    state = LOCKER_STATES.get(locker_id)
    verified = state and state.get('status') == 'open'
    return jsonify({
        "success": True,
        "verified": verified,
        "message": f"Locker {locker_id} opened",
        "locker": {"locker_id": locker_id, **(state or {})}
    })

@app.route('/api/claim/<claim_id>')
def get_claim(claim_id):
    """Mock claim retrieval"""
    # Simulate processing delay
    time.sleep(0.3)
    
    if claim_id in MOCK_CLAIMS:
        return jsonify({
            "success": True,
            "data": MOCK_CLAIMS[claim_id]
        })
    else:
        return jsonify({
            "success": False,
            "error": "Claim not found"
        }), 404

@app.route('/api/claim/<claim_id>/status', methods=['PUT'])
def update_claim_status(claim_id):
    """Mock claim status update with verification and audit."""
    # Simulate processing delay
    time.sleep(0.2)
    payload = request.get_json() or {}
    new_status = payload.get('status') or 'completed'
    ok, err = update_claim_status_in_db(claim_id, new_status)
    if not ok:
        return jsonify({"success": False, "error": err}), 404 if err == 'Claim not found' else 500
    # Verification step
    claim = MOCK_CLAIMS.get(claim_id)
    verified = claim and claim.get('status') == new_status
    return jsonify({
        "success": True,
        "verified": verified,
        "message": f"Claim {claim_id} status set to {new_status}",
        "data": claim
    })

@app.route('/api/claim/<claim_id>/finalize', methods=['POST'])
def finalize_claim_after_verification(claim_id):
    """Implements sequence after successful QR scan and identity verification.
    1) If the item has a locker_id: mark locker as 'open' and keep claim 'verified'.
    2) If no locker_id: skip locker and set claim to 'completed'.
    All actions are audited and verified.
    """
    # Simulate short processing delay
    time.sleep(0.3)

    claim = MOCK_CLAIMS.get(claim_id)
    if not claim:
        return jsonify({"success": False, "error": "Claim not found"}), 404

    locker_id = claim.get('locker_id')
    log_meta = {
        "student_id": claim.get('student_id'),
        "claim_id": claim_id
    }

    if locker_id:
        # Open locker and keep existing claim status flow
        ok, err = update_locker_status_in_db(locker_id, 'open', {**log_meta, "source": "finalize"})
        if not ok:
            return jsonify({"success": False, "error": err}), 500
        # Verification
        verified = LOCKER_STATES.get(locker_id, {}).get('status') == 'open'
        return jsonify({
            "success": True,
            "verified": verified,
            "message": f"Locker {locker_id} opened; claim remains {claim.get('status')}",
            "locker": {"locker_id": locker_id, **LOCKER_STATES.get(locker_id, {})},
            "claim": claim
        })
    else:
        # No locker – directly complete the claim
        ok, err = update_claim_status_in_db(claim_id, 'completed')
        if not ok:
            return jsonify({"success": False, "error": err}), 500
        verified = MOCK_CLAIMS.get(claim_id, {}).get('status') == 'completed'
        return jsonify({
            "success": True,
            "verified": verified,
            "message": "Claim completed (no locker assigned)",
            "claim": MOCK_CLAIMS.get(claim_id)
        })

@app.route('/api/face/verify', methods=['POST'])
def verify_face():
    """Mock face verification"""
    # Simulate processing delay
    time.sleep(2.0)
    
    # Randomly succeed or fail for testing
    import random
    if random.random() > 0.3:  # 70% success rate
        return jsonify({
            "success": True,
            "match": True,
            "similarity": 0.95,
            "message": "Face verification successful"
        })
    else:
        return jsonify({
            "success": True,
            "match": False,
            "similarity": 0.45,
            "error": "Face verification failed - low similarity"
        })

@app.route('/api/rfid/verify', methods=['POST'])
def verify_rfid():
    """Mock RFID verification"""
    # Simulate processing delay
    time.sleep(1.0)
    
    data = request.get_json()
    scanned_uid = data.get('uid')
    expected_uid = data.get('expected_uid')
    
    if scanned_uid == expected_uid:
        return jsonify({
            "success": True,
            "match": True,
            "message": "RFID verification successful"
        })
    else:
        return jsonify({
            "success": True,
            "match": False,
            "error": "RFID card mismatch"
        })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for network connectivity testing"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "qreclaim-kiosk",
        "audit_count": len(AUDIT_LOG)
    })

if __name__ == '__main__':
    print("Starting Qreclaim Kiosk Test Server...")
    print("Access the test interface at: http://localhost:5000/")
    print("Access the production kiosk at: http://localhost:5000/kiosk")
    print("\nTest Controls Available:")
    print("- Step Indicator: Test all 3 steps")
    print("- Audio Feedback: Success, Error, Scan sounds")
    print("- Loading States: Show/hide loading overlay")
    print("- Status Messages: Info, Success, Error states")
    print("- QR Scanner: All visual states")
    print("- Help System: Help overlay and instructions")
    print("- Full Workflow: Complete simulation")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
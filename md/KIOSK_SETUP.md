# Qreclaim Kiosk Mode - Setup Guide

## Overview
The Qreclaim Kiosk Mode is a comprehensive claim verification system that uses QR code scanning, facial recognition, and RFID card verification to securely release items from lockers.

## Features
- ✅ **Auto-adaptive UI** - Works on desktop browsers, mobile browsers, and PWA mode
- ✅ **QR Code Scanning** - Continuous scanning with html5-qrcode
- ✅ **QR Format Validation** - Supports encrypted (AES/JWT) and plaintext QR codes
- ✅ **Facial Recognition** - Uses face-api.js for biometric verification
- ✅ **RFID Verification** - Integrates with Raspberry Pi via REST/WebSocket
- ✅ **Locker Control** - Automatic unlock on successful verification
- ✅ **Real-time Status** - Firebase Firestore integration for claim updates
- ✅ **Error Handling** - Comprehensive timeout and mismatch detection

---

## Architecture

### Modular JavaScript Design

```
static/js/kiosk/
├── firebaseService.js    - Firestore operations
├── qrScanner.js          - QR scanning & validation
├── faceVerifier.js       - Face detection & comparison
├── rfidVerifier.js       - RFID card scanning
├── lockerController.js   - Locker API integration
└── kioskApp.js          - Main orchestration
```

### QR Code Format

**Expected Format:**
```
QRC|<claim_id>|<student_id>|<verify_method>

Example: QRC|C0001|1234567|face
```

**OR Encrypted JSON:**
```json
{
  "claim_id": "C0001",
  "student_id": "1234567",
  "token": "abc123xyz789..."
}
```

The system also supports encrypted envelope formats (v1:/v2: prefix).

---

## Prerequisites

### 1. Firebase Setup (Web App Config)
Firebase Web config is now injected from the backend to avoid hardcoding in HTML. This supports different environments cleanly.

Steps:
1) Copy the example file and fill in values from Firebase Console → Project Settings → Your apps → SDK setup and configuration
```
cp config/firebase_web_config.example.json config/firebase_web_config.json
```

2) Edit `config/firebase_web_config.json`:
```json
{
  "apiKey": "AIza...",
  "authDomain": "smart-lost-and-found.firebaseapp.com",
  "projectId": "smart-lost-and-found",
  "storageBucket": "smart-lost-and-found.appspot.com",
  "messagingSenderId": "1234567890",
  "appId": "1:1234567890:web:abc..."
}
```

3) Start the Flask server and open `/kiosk-mode`. If the config is missing, the page shows "Configuration Required" and logs a console message.

Advanced:
- You can set `FIREBASE_WEB_CONFIG_JSON` (stringified JSON) in the environment, or `FIREBASE_WEB_CONFIG_PATH` to point to a custom file.

### 2. Face-API.js Models
Download pre-trained models from [face-api.js releases](https://github.com/justadudewhohacks/face-api.js/tree/master/weights)

Place in: `static/models/`
- `tiny_face_detector_model-weights_manifest.json`
- `face_landmark_68_model-weights_manifest.json`
- `face_recognition_model-weights_manifest.json`

### 3. Camera Permissions
Ensure HTTPS or localhost for camera access:
- Desktop: `https://your-domain.com/kiosk-mode`
- Development: `http://localhost:5000/kiosk-mode`

#### 3.1 Google API Key Restrictions (Recommended)
If you restrict your Firebase Web API key, add these referrers:
- `http://localhost:5000/*`
- `http://127.0.0.1:5000/*`
- `https://your-domain.com/*`
- Any other dev ports (e.g., `http://localhost:5173/*`)

Note: Firebase API keys are not secrets, but referrer restrictions help prevent misuse from unknown origins.

### 4. RFID Hardware (Optional)
**Raspberry Pi Setup:**
- RC522 RFID module connected via SPI
- Python backend running on Pi (Flask/FastAPI)
- Endpoints:
  - REST: `http://pi-ip:5001/api/rfid/scan`
  - WebSocket: `ws://pi-ip:5001/rfid`

Update in `rfidVerifier.js`:
```javascript
this.piEndpoint = 'http://YOUR_PI_IP:5001';
this.wsEndpoint = 'ws://YOUR_PI_IP:5001/rfid';
```

## Development Notes

### App Check (Optional but Recommended)
If Firebase App Check is enforced, you have two options for development:
1) Enable debug mode on your dev machine:
   - In the browser console, before Firebase initializes:
   ```javascript
   // Include App Check SDK if using it (v9 compat):
   // <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-check-compat.js"></script>
   self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // or set a specific token string
   // After firebase.initializeApp(firebaseConfig):
   firebase.appCheck().activate('YOUR_RECAPTCHA_V3_SITE_KEY', true); // true enables debug
   ```
2) Use reCAPTCHA v3 site key for production and set `FIREBASE_APPCHECK_DEBUG_TOKEN` locally during development.

### Firestore Long Polling
Some networks (VPNs, proxies, strict firewalls) break Firestore's default WebChannel transport. The kiosk forces long polling in `firebaseService.js`:
```javascript
firebase.firestore().settings({
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
```
If you see connectivity errors, verify this block runs during kiosk initialization.

### Firestore Emulator (Optional)
Run the Firestore emulator and point the kiosk to it via environment variables.

1) Install Firebase CLI and start Firestore:
```bash
npm install -g firebase-tools
firebase login
firebase emulators:start --only firestore
```

2) Set env vars before starting Flask:
```powershell
$env:USE_FIRESTORE_EMULATOR = "true"           # Windows PowerShell
$env:FIRESTORE_EMULATOR_HOST = "localhost"
$env:FIRESTORE_EMULATOR_PORT = "8080"
python app.py
```

3) The template calls `firebase.firestore().useEmulator(host, port)` if available, or `settings({ host, ssl:false })` fallback.

---

## Installation

### 1. Install Dependencies
The kiosk uses CDN-hosted libraries, but for production:

```bash
npm install html5-qrcode face-api.js
```

### 2. Configure Backend API
Ensure these endpoints are available:

**QR Verification:**
```
POST /api/qr/verify
Body: { "qr_raw": "..." }
Response: { "valid": true, "claim_id": "C0001", "verification_method": "face" }
```

**Locker Control:**
```
POST /api/lockers/<locker_id>/open
Body: { "claim_id": "C0001", "student_id": "1234567", "timestamp": "2025-11-09T..." }
```

### 3. Firestore Security Rules
Update your Firestore rules to allow kiosk access:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /claims/{claimId} {
      allow read: if true;  // Kiosk needs read access
      allow write: if request.auth != null;
    }
  }
}
```

---

## Usage Flow

### 1. Student Workflow
1. Student registers claim via web portal
2. Selects verification method (Face or RFID)
3. Captures face or registers RFID card
4. Receives QR code with 5-minute expiry

### 2. Kiosk Workflow
```
┌─────────────────┐
│  Scan QR Code   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validate QR    │ ──► Invalid? → Show Error (3s) → Reset
└────────┬────────┘
         │ Valid
         ▼
┌─────────────────┐
│  Fetch Claim    │ ──► Not Found? → Show Error → Reset
│   (Firestore)   │
└────────┬────────┘
         │
         ▼
   ┌────────────┐
   │ Verify     │
   │ Method?    │
   └──┬────┬────┘
      │    │
  Face│    │RFID
      ▼    ▼
┌─────────┐  ┌──────────┐
│ Capture │  │ Scan Card│
│  Face   │  │ (15s max)│
└────┬────┘  └────┬─────┘
     │            │
     ▼            ▼
┌─────────────────────┐
│  Compare Embedding  │ ──► Mismatch? → Show Error → Reset
│  or UID (≤0.6 sim)  │
└─────────┬───────────┘
          │ Match
          ▼
┌─────────────────────┐
│  Unlock Locker      │
│  Update Claim       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Show Success (5s)  │
│  → Reset to Scan    │
└─────────────────────┘
```

---

## Configuration

### Timeout Settings
Edit `kioskApp.js`:

```javascript
this.RESET_DELAY = 3000; // Error message display time (ms)
this.VERIFICATION_TIMEOUT = 15000; // RFID scan timeout (ms)
```

### Face Recognition Threshold
Edit `faceVerifier.js`:

```javascript
this.SIMILARITY_THRESHOLD = 0.6; // Lower = stricter (0.4-0.7 recommended)
```

### Camera Settings
Edit `qrScanner.js`:

```javascript
const config = {
    fps: 10,  // Frames per second
    qrbox: { width: 250, height: 250 }, // Scan box size
    aspectRatio: 1.0
};
```

---

## Testing

### 1. Test QR Scanning
Generate test QR codes:
```python
import qrcode
import json

data = {
    "claim_id": "C0001",
    "student_id": "1234567",
    "token": "test_token_abc123"
}

qr = qrcode.make(json.dumps(data))
qr.save("test_qr.png")
```

### 2. Test Face Verification
Use browser console:
```javascript
const faceVerifier = new FaceVerifier();
await faceVerifier.loadModels();
const result = await faceVerifier.captureFaceDescriptor();
console.log(result);
```

### 3. Test RFID (without hardware)
Mock RFID server:
```python
from flask import Flask, jsonify
app = Flask(__name__)

@app.route('/api/rfid/scan', methods=['POST'])
def scan():
    return jsonify({"success": True, "uid": "04:5A:B2:C3"})

app.run(port=5001)
```

---

## Deployment

### Desktop Kiosk
1. Use Chromium/Chrome in kiosk mode:
```bash
chromium-browser --kiosk --app=https://your-domain.com/kiosk-mode
```

2. Disable sleep/screensaver on kiosk machine

### Tablet/PWA Mode
1. Enable PWA features in manifest.json
2. Add to home screen for fullscreen mode
3. Ensure camera permissions are granted

### Raspberry Pi Display
```bash
# Install Chromium
sudo apt-get install chromium-browser unclutter

# Auto-start on boot (add to /etc/xdg/lxsession/LXDE-pi/autostart)
@chromium-browser --kiosk --app=http://localhost:5000/kiosk-mode
@unclutter -idle 0
```

---

## Troubleshooting

### Camera Not Working
- ✅ Check HTTPS is enabled (or use localhost)
- ✅ Grant camera permissions in browser
- ✅ Verify `getUserMedia` is supported

### QR Scanner Not Detecting
- ✅ Ensure html5-qrcode is loaded
- ✅ Check camera is not blocked by other apps
- ✅ Increase lighting on QR code

### Face Verification Fails
- ✅ Ensure face-api models are in `/static/models/`
- ✅ Check face is centered and well-lit
- ✅ Adjust `SIMILARITY_THRESHOLD` (try 0.7 for lenient)

### RFID Not Responding
- ✅ Verify Raspberry Pi is powered on
- ✅ Check network connection to Pi
- ✅ Test REST endpoint manually with curl
- ✅ Enable CORS on Pi backend

### Locker Won't Unlock
- ✅ Verify locker API endpoint is correct
- ✅ Check locker status in database (must be "occupied")
- ✅ Ensure claim has valid `locker_id`

---

## Security Considerations

### 1. QR Encryption
- All QR codes should use AES encryption with 5-minute expiry
- Tokens are single-use (validated via Firestore status)

### 2. Face Data Storage
- Face embeddings are stored (not raw images)
- Embeddings deleted after claim completion

### 3. Network Security
- Use HTTPS for all production deployments
- Implement rate limiting on verification endpoints
- Log all verification attempts for audit

### 4. Physical Security
- Mount kiosk in monitored area
- Use tamper-resistant enclosure for Raspberry Pi
- Implement emergency override for admins

---

## API Reference

### Firestore Collections

**claims/**
```javascript
{
  claim_id: "C0001",
  student_id: "1234567",
  found_item_id: "F0001",
  verification_method: "qr_face" | "qr_rfid",
  status: "pending" | "Claimed",
  face_embedding: [0.123, 0.456, ...], // 512-dim array
  rfid_uid: "04:5A:B2:C3",
  locker_id: "L001",
  expires_at: Timestamp,
  claimed_time: Timestamp
}
```

### Backend Routes

**POST /api/qr/verify**
```json
Request:  { "qr_raw": "encrypted_or_plain_json" }
Response: { "valid": true, "claim_id": "C0001", "student_id": "1234567" }
```

**POST /api/lockers/{locker_id}/open**
```json
Request:  { "claim_id": "C0001", "student_id": "1234567", "timestamp": "ISO8601" }
Response: { "success": true, "auto_close_at": "ISO8601" }
```

---

## Performance Optimization

1. **Lazy Load Models** - Load face-api models only when needed
2. **Cache Claims** - Use short-lived cache (30s) to reduce Firestore reads
3. **WebSocket for RFID** - Preferred over polling for faster response
4. **Optimize QR Scanner** - Reduce FPS if performance issues occur

---

## License
Part of the Qreclaim Lost & Found System  
© 2025 TAR UMT Johor

---

## Support
For issues, contact the project maintainer or check:
- Project documentation: `README.md`
- Backend services: `backend/services/`
- Test suite: `tests/`

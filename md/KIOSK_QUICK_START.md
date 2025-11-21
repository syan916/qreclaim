# 🚀 Kiosk Mode - Quick Start Guide

## ⚡ 5-Minute Setup

### Step 1: Configure Firebase (2 min)
Edit `templates/kiosks/kiosk-mode.html` around line 270:

```javascript
const firebaseConfig = {
    apiKey: "AIza...",                    // Get from Firebase Console
    authDomain: "qreclaim-xxx.firebaseapp.com",
    projectId: "qreclaim-xxx",
    storageBucket: "qreclaim-xxx.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc..."
};
```

**Where to find:** Firebase Console → Project Settings → Your apps → SDK setup and configuration

---

### Step 2: Download Face Models (1 min)
```bash
# Create models directory
mkdir -p static/models

# Download from: https://github.com/justadudewhohacks/face-api.js/tree/master/weights
# Required files:
- tiny_face_detector_model-weights_manifest.json
- tiny_face_detector_model-shard1
- face_landmark_68_model-weights_manifest.json  
- face_landmark_68_model-shard1
- face_recognition_model-weights_manifest.json
- face_recognition_model-shard1
```

---

### Step 3: Start Server (1 min)
```bash
# Navigate to project directory
cd /path/to/Qreclaim_LNF_System

# Start Flask server
python app.py

# Should see:
# * Running on http://0.0.0.0:5000
```

---

### Step 4: Test (1 min)
Open browser and navigate to:

**Test Interface:** http://localhost:5000/kiosk-test
- Generate test QR codes
- Test camera access
- Verify API endpoints

**Kiosk Mode:** http://localhost:5000/kiosk-mode
- Full kiosk interface
- Scan QR codes
- Verify face/RFID

---

## 🎯 Common Commands

### Generate Test QR Code
```python
import qrcode
import json

data = {"claim_id": "C0001", "student_id": "1234567", "token": "test123"}
qr = qrcode.make(json.dumps(data))
qr.save("test_qr.png")
```

### Open Kiosk in Fullscreen
```bash
# Chrome/Chromium
chromium-browser --kiosk --app=http://localhost:5000/kiosk-mode

# With auto-start (Linux)
@chromium-browser --kiosk --app=http://localhost:5000/kiosk-mode
```

### Check Logs
```bash
# View Flask logs
tail -f app.log

# Browser console (F12)
# Check for errors or verification logs
```

---

## 🔧 Quick Fixes

### Camera Not Working?
```bash
✅ Use HTTPS or localhost
✅ Grant camera permissions (chrome://settings/content/camera)
✅ Close other apps using camera
```

### QR Not Scanning?
```bash
✅ Print QR larger (at least 5cm x 5cm)
✅ Ensure good lighting
✅ Hold QR steady for 1-2 seconds
```

### Face Not Matching?
```bash
✅ Increase threshold to 0.7 in faceVerifier.js line 16
✅ Ensure good face lighting
✅ Look directly at camera
```

---

## 📱 Access URLs

| Page | URL | Purpose |
|------|-----|---------|
| Kiosk Mode | `/kiosk-mode` | Production interface |
| Test Interface | `/kiosk-test` | Testing tools |
| Admin Dashboard | `/admin-dashboard` | Manage claims |
| Login | `/login` | User authentication |

---

## 🎨 Customization

### Change Colors
Edit `templates/kiosks/kiosk-mode.html` around line 24:
```css
:root {
    --primary-color: #3498db;    /* Main blue */
    --success-color: #27ae60;    /* Green */
    --error-color: #e74c3c;      /* Red */
}
```

### Adjust Timeouts
Edit `static/js/kiosk/kioskApp.js` around line 18:
```javascript
this.RESET_DELAY = 3000;              // Error display time (3s)
this.VERIFICATION_TIMEOUT = 15000;    // RFID wait time (15s)
```

### Face Match Threshold
Edit `static/js/kiosk/faceVerifier.js` line 16:
```javascript
this.SIMILARITY_THRESHOLD = 0.6;  // Lower = stricter (0.4-0.7)
```

---

## 📊 File Structure

```
Qreclaim_LNF_System/
├── app.py                              # Main Flask app
├── templates/
│   └── kiosks/
│       └── kiosk-mode.html             # Kiosk UI
├── static/
│   ├── css/
│   │   └── kiosk-mode.css              # Kiosk styles
│   ├── js/
│   │   └── kiosk/                      # All kiosk modules
│   │       ├── firebaseService.js
│   │       ├── qrScanner.js
│   │       ├── faceVerifier.js
│   │       ├── rfidVerifier.js
│   │       ├── lockerController.js
│   │       └── kioskApp.js
│   └── models/                         # Face-API models (download)
├── tests/
│   └── kiosk_test.html                 # Test interface
├── KIOSK_SETUP.md                      # Full documentation
├── KIOSK_IMPLEMENTATION_SUMMARY.md     # Implementation details
└── KIOSK_QUICK_START.md                # This file
```

---

## ✅ Pre-Flight Checklist

Before going live:

- [ ] Firebase config updated
- [ ] Face-API models downloaded
- [ ] HTTPS enabled (or localhost)
- [ ] Camera permissions granted
- [ ] QR codes generated for testing
- [ ] Locker API endpoints working
- [ ] Finalize endpoint working for items without lockers
- [ ] RFID hardware configured (if using)
- [ ] Test at least 3 successful claims
- [ ] Error scenarios tested (invalid QR, mismatch)
- [ ] Auto-reset verified

---

## 🆘 Emergency Recovery

### Kiosk Stuck or Frozen?
```bash
# Refresh page
Press F5 or Ctrl+R

# Force reload (clear cache)
Press Ctrl+Shift+R

# Restart browser
Close and reopen browser
```

### Reset Claim Process
```bash
# Manually reset via Firebase Console
1. Go to Firestore → claims collection
2. Find claim by claim_id
3. Update status to "pending"
4. Remove claimed_time field
```

---

## 📞 Support

**Documentation:**
- Full Setup: `KIOSK_SETUP.md`
- Implementation: `KIOSK_IMPLEMENTATION_SUMMARY.md`
- Project Docs: `fyp_report_extracted.txt`

**Testing:**
- Test Interface: http://localhost:5000/kiosk-test
- Generate QR: Use test interface or Python script
- Public API (Kiosk):
  - List lockers: GET `/api/lockers`
  - Open locker: POST `/api/lockers/{locker_id}/open` JSON `{ "duration_sec": 10 }`
  - Finalize claim (no locker): POST `/api/claim/{claim_id}/finalize` JSON `{ "duration_sec": 10 }`

**Logs:**
- Browser Console: F12 → Console tab
- Flask Logs: Terminal output or app.log

---

## 🎓 Learning Resources

**HTML5 QR Code Scanner:**
https://github.com/mebjas/html5-qrcode

**Face-API.js:**
https://github.com/justadudewhohacks/face-api.js

**Firebase Firestore:**
https://firebase.google.com/docs/firestore

---

**Ready to go? Start with Step 1 above! 🚀**

---

*Last updated: November 2025*  
*Part of Qreclaim Lost & Found System*

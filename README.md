# Qreclaim: Smart Lost-and-Found System

This repository powers the Qreclaim backend and web UI (Flask + Firebase) for reporting found/lost items, student claims, AI-assisted tagging, and kiosk verification with QR + face/RFID.

## Raspberry Pi Deployment

- Recommended: Raspberry Pi 4/5 with Raspberry Pi OS (64-bit), Python 3.10/3.11.
- Ensure network access and a Google Firebase project with Admin credentials.

### 1) System Prep

- Update packages:
  ```bash
  sudo apt update && sudo apt upgrade -y
  ```
- Install build/runtime libs helpful for Python wheels:
  ```bash
  sudo apt install -y python3-pip python3-venv libatlas-base-dev libjpeg-dev zlib1g-dev libopenblas-dev
  ```
- Optional OpenCV via apt (recommended on Pi):
  ```bash
  sudo apt install -y python3-opencv
  ```

### 2) Project Setup

- Copy the project folder to the Pi.
- Create virtual environment and install Python deps:
  ```bash
  cd Qreclaim_LNF_System
  python3 -m venv venv
  source venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
  ```
  - If `opencv-python-headless` fails, install apt `python3-opencv` and remove opencv from venv:
    ```bash
    pip uninstall -y opencv-python-headless || true
    ```

### 3) Environment Variables (.env)

Create `.env` at project root with values for your environment. The app loads it automatically.

```env
# Flask
SECRET_KEY=replace_with_random_24_bytes
HOST=0.0.0.0
PORT=5000

# Firebase Admin
# Place firebaseAdminKey.json at project root OR set one of these:
GOOGLE_APPLICATION_CREDENTIALS=/home/pi/Qreclaim_LNF_System/firebaseAdminKey.json
FIREBASE_STORAGE_BUCKET=your-project.appspot.com

# SMTP (Gmail App Password recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USE_SSL=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=Qreclaim <your_email@gmail.com>

# QR Encryption (optional but recommended)
# Generate a key: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
QRECLAIM_FERNET_KEYS={"v1":"paste_generated_key_here"}
QRECLAIM_FERNET_ACTIVE=v1
```

- Place `firebaseAdminKey.json` at the project root or point `GOOGLE_APPLICATION_CREDENTIALS` to its path.

### 4) Run the Server

```bash
source venv/bin/activate
python app.py
```
- Access the app at `http://<pi-ip>:5000/`.
- Health check: `curl http://<pi-ip>:5000/api/health`

### 5) Troubleshooting

- NumPy build errors on Pi:
  - Try `sudo apt install -y python3-numpy` and remove the venv numpy: `pip uninstall -y numpy`.
- OpenCV pip errors:
  - Use apt `python3-opencv`, uninstall pip opencv.
- SMTP not sending:
  - Confirm `.env` values and Gmail App Password; check console logs for warnings from `backend/services/SMTP_server.py`.
- QR encryption errors:
  - Without `cryptography`/keys, the system falls back to plaintext QR; set `QRECLAIM_FERNET_KEYS` to enable encryption.

### 6) Running on Boot (optional)

- Use `systemd` to run on boot. Example unit file (`/etc/systemd/system/qreclaim.service`):
  ```ini
  [Unit]
  Description=Qreclaim Flask Server
  After=network.target

  [Service]
  WorkingDirectory=/home/pi/Qreclaim_LNF_System
  ExecStart=/home/pi/Qreclaim_LNF_System/venv/bin/python /home/pi/Qreclaim_LNF_System/app.py
  Environment=PYTHONUNBUFFERED=1
  Restart=always
  User=pi

  [Install]
  WantedBy=multi-user.target
  ```
  Then:
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl enable qreclaim
  sudo systemctl start qreclaim
  sudo systemctl status qreclaim
  ```

## Notes

- Face capture uses the browser camera; the Pi runs the Flask server and does not require a webcam unless you use it as a kiosk client.
- DeepFace is optional and heavy; the server falls back to OpenCV/PIL when DeepFace isn’t installed.
- Firebase indices: some analytics endpoints may require Firestore composite indexes. Create them as prompted in errors.

## Development

- `.env` is loaded automatically.
- Run in debug with `python app.py`.
- API health: `GET /api/health`.

## License

For academic use as part of Final Year Project.

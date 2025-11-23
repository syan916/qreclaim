# -------------------------------------------------------------------------------------------------------
# Module: Qreclaim Smart Lost & Found Kiosk
# Author: Adapted for FYP by En Yan
# Date: 22/11/2025
# -------------------------------------------------------------------------------------------------------

# -------------------------------------------------------------------------------------------------------
# Libraries
# -------------------------------------------------------------------------------------------------------
import time
import grovepi
from grove.i2c import Bus
from grove_rgb_lcd import *
from picamera import PiCamera
import pyrebase
from gc import collect
import os
import io
import json
try:
    from pyzbar.pyzbar import decode as pyzbar_decode
    from PIL import Image
except Exception:
    pyzbar_decode = None
    Image = None
try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None

# -------------------------------------------------------------------------------------------------------
# Raspberry Pi + GrovePi Configuration
# -------------------------------------------------------------------------------------------------------
# Example usage:
setText("Qreclaim Lost and Found System")       # Display text
# Disable RGB backlight
# Just ignore the RGB function since 0x62 chip is missing
def setRGB(r, g, b):
    return
            # Set RGB backlight color

# GrovePi digital pins
buzzer_pin = 3       # D3
relay_pin = 4        # D4
digit_display_pin = 2 # D2 (4-digit display)

grovepi.pinMode(buzzer_pin, "OUTPUT")
grovepi.pinMode(relay_pin, "OUTPUT")

# Camera
camera = PiCamera()
camera.resolution = (800, 600)
camera.framerate = 15
camera.brightness = 50

# -------------------------------------------------------------------------------------------------------
# Firebase Configuration
# -------------------------------------------------------------------------------------------------------
firebase_config = {
    "apiKey": "AIzaSyCBW8Du4iQEPjLNriK2jMYcqynKumgS1XI",
    "authDomain": "smart-lost-and-found.firebaseapp.com",
    "databaseURL": "https://smart-lost-and-found-default-rtdb.asia-southeast1.firebasedatabase.app",
    "storageBucket": "smart-lost-and-found.firebasestorage.app"
}

firebase = pyrebase.initialize_app(firebase_config)
auth = firebase.auth()
db = firebase.database()
storage = firebase.storage()

user = None

def ensure_auth():
    global user
    if user:
        return user
    try:
        email = os.environ.get("QRECLAIM_FB_EMAIL")
        password = os.environ.get("QRECLAIM_FB_PASSWORD")
        if email and password:
            user = auth.sign_in_with_email_and_password(email, password)
    except Exception:
        user = None
    return user

def get_token():
    try:
        u = ensure_auth()
        return u['idToken'] if u and 'idToken' in u else None
    except Exception:
        return None

# -------------------------------------------------------------------------------------------------------
# Utility Functions
# -------------------------------------------------------------------------------------------------------

def display_message(text):
    try:
        setText(str(text)[:32])
    except Exception:
        try:
            print(text)
        except Exception:
            pass

def buzzer_sound(times=1, interval=0.2):
    """Sound buzzer specified times"""
    for _ in range(times):
        grovepi.digitalWrite(buzzer_pin, 1)
        time.sleep(interval)
        grovepi.digitalWrite(buzzer_pin, 0)
        time.sleep(interval)

def open_locker(duration_sec=60):
    """Open relay-controlled locker for specified seconds"""
    grovepi.digitalWrite(relay_pin, 1)  # open
    start_time = time.time()
    while time.time() - start_time < duration_sec:
        # Optional: display countdown on 4-digit
        try:
            remaining = int(duration_sec - (time.time() - start_time))
            grovepi.digitalWrite(digit_display_pin, remaining)
        except Exception:
            pass
        time.sleep(0.1)
    grovepi.digitalWrite(relay_pin, 0)  # close

def capture_photo(filename="/home/pi/Desktop/qreclaim_capture.jpg"):
    """Capture image with PiCamera"""
    camera.start_preview()
    time.sleep(1)
    camera.capture(filename)
    camera.stop_preview()
    return filename

def upload_photo_to_firebase(file_path, firebase_path):
    """Upload captured photo to Firebase Storage"""
    storage.child(firebase_path).put(file_path)

def decode_qr_payload(qr_text):
    try:
        obj = json.loads(str(qr_text))
        if isinstance(obj, dict):
            return {
                "claim_id": obj.get("claim_id"),
                "student_id": obj.get("student_id"),
                "token": obj.get("token"),
                "verify_method": obj.get("verification_method") or obj.get("verify_method"),
            }
    except Exception:
        pass
    try:
        parts = str(qr_text).split("|")
        if len(parts) == 4 and parts[0] == "QRC":
            return {
                "claim_id": parts[1],
                "student_id": parts[2],
                "verify_method": parts[3],
            }
    except Exception:
        pass
    return {"raw": str(qr_text)}

def scan_qr_with_camera(timeout_sec=30):
    try:
        display_message("Please scan your QR code")
        camera.start_preview()
        start = time.time()
        while time.time() - start < timeout_sec:
            try:
                stream = io.BytesIO()
                camera.capture(stream, format='jpeg', use_video_port=True)
                data = stream.getvalue()
                if pyzbar_decode and Image:
                    try:
                        stream.seek(0)
                        img = Image.open(stream)
                        codes = pyzbar_decode(img)
                        if codes:
                            payload = codes[0].data
                            camera.stop_preview()
                            return payload.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
                if cv2 is not None and np is not None:
                    try:
                        arr = np.frombuffer(data, dtype=np.uint8)
                        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        detector = cv2.QRCodeDetector()
                        val, _, _ = detector.detectAndDecode(frame)
                        if val:
                            camera.stop_preview()
                            return str(val)
                    except Exception:
                        pass
            except Exception:
                time.sleep(0.1)
            time.sleep(0.05)
        camera.stop_preview()
        return None
    except Exception:
        try:
            camera.stop_preview()
        except Exception:
            pass
        return None

def verify_qr(qr_data):
    """Check QR data in Firebase"""
    token = None
    claim_id = None
    if isinstance(qr_data, dict):
        token = qr_data.get("token")
        claim_id = qr_data.get("claim_id")
    else:
        token = str(qr_data) if qr_data else None
    key = token or claim_id
    if not key:
        return None
    record = db.child("lost_found_items").child(key).get(get_token())
    if record.val():
        return record.val()  # returns dict with item info
    return None

def verify_face(student_id, image_path):
    """Stub for face verification"""
    # Here you can integrate your face recognition
    # Return True if matched, False otherwise
    return True

def verify_rfid(rfid_code):
    """Check RFID in Firebase"""
    record = db.child("student_ids").child(rfid_code).get(get_token())
    if record.val():
        return record.val()  # returns student info
    return None

def record_claim(item_id, student_id, photo_path):
    """Save claimed item record to Firebase"""
    timestamp = time.strftime("%Y%m%d%H%M%S")
    data = {
        "item_id": item_id,
        "student_id": student_id,
        "time": timestamp,
        "photo": f"claims/{timestamp}.jpg"
    }
    db.child("claimed_items").child(timestamp).set(data, get_token())
    upload_photo_to_firebase(photo_path, f"claims/{timestamp}.jpg")

# -------------------------------------------------------------------------------------------------------
# Main Kiosk Loop
# -------------------------------------------------------------------------------------------------------
def main_loop():
    display_message("Please scan your QR code")
    while True:
        try:
            qr_raw = scan_qr_with_camera(30)
            if not qr_raw:
                display_message("QR not detected")
                buzzer_sound(2, 0.1)
                continue
            qr_info = decode_qr_payload(qr_raw)
            item_record = verify_qr(qr_info)
            if not item_record:
                display_message("QR invalid!")
                buzzer_sound(2, 0.1)
                continue

            # Step 2: Determine verification type
            verification_type = item_record.get("verification_type") or qr_info.get("verify_method")
            student_id = item_record.get("student_id") or qr_info.get("student_id")
            if verification_type == "face":
                display_message("Scan Face...")
                # Step 2a: capture face image
                img_path = capture_photo()
                if verify_face(student_id, img_path):
                    display_message("Verified! Opening locker...")
                    buzzer_sound(1)
                    open_locker()
                    record_claim(qr_info.get("claim_id") or qr_info.get("token") or qr_raw, student_id, img_path)
                    buzzer_sound(2)
                else:
                    display_message("Face not match!")
                    buzzer_sound(2, 0.1)
            elif verification_type == "rfid" or verification_type == "qr_rfid":
                display_message("Scan Student ID...")
                # Step 2b: read RFID (replace with actual RFID code)
                rfid_code = input("Enter RFID code for testing: ")  # placeholder
                student_info = verify_rfid(rfid_code)
                if student_info and student_info.get("id") == student_id:
                    display_message("Verified! Opening locker...")
                    buzzer_sound(1)
                    open_locker()
                    img_path = capture_photo()
                    record_claim(qr_info.get("claim_id") or qr_info.get("token") or qr_raw, student_id, img_path)
                    buzzer_sound(2)
                else:
                    display_message("RFID not match!")
                    buzzer_sound(2, 0.1)
            display_message("Please scan your QR code")
            collect()  # garbage collection

        except KeyboardInterrupt:
            display_message("System stopped")
            break
        except Exception as e:
            print("Error:", e)
            display_message("Error occurred")
            buzzer_sound(3, 0.1)
            collect()

# -------------------------------------------------------------------------------------------------------
# Execute
# -------------------------------------------------------------------------------------------------------
if __name__ == "__main__":
    main_loop()


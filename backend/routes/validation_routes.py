"""Validation routes for client-side validation rules and public verification APIs."""
from flask import Blueprint, jsonify, request
from ..services.image_validation_service import ImageValidationService
from ..services.claim_service import verify_claim_qr_data, finalize_claim_kiosk, update_claim_status
from ..database import db
from firebase_admin import firestore
import datetime
from ..services.face_recognition_service import is_match
import base64
import io
import os
import numpy as np
from PIL import Image

# Optional OpenCV integration (mirrors claim_service checks)
_OPENCV_AVAILABLE = False
_FACE_CASCADE = None
_OPENCV_VERSION = None
try:
    import cv2  # type: ignore
    _OPENCV_VERSION = getattr(cv2, '__version__', 'unknown')
    cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
    _FACE_CASCADE = cv2.CascadeClassifier(cascade_path)
    if _FACE_CASCADE is not None and not _FACE_CASCADE.empty():
        _OPENCV_AVAILABLE = True
except Exception:
    _OPENCV_AVAILABLE = False
    _FACE_CASCADE = None

validation_bp = Blueprint('validation', __name__)

@validation_bp.route('/api/validation/image-rules', methods=['GET'])
def get_image_validation_rules():
    """
    Get image validation rules for client-side validation.
    
    Returns:
        JSON response with validation rules
    """
    try:
        validation_service = ImageValidationService()
        rules = validation_service.get_validation_rules()
        
        return jsonify({
            'success': True,
            'rules': rules
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to get validation rules: {str(e)}'
        }), 500


@validation_bp.route('/api/qr/verify', methods=['POST'])
def verify_qr_code_api():
    """
    Public endpoint to verify scanned QR JSON payload.
    Expects JSON body containing one of: qr_raw (string), qr_json (string), payload (string), or qr (string).
    Returns structured verification result.
    """
    try:
        body = request.get_json(silent=True) or {}
        qr_raw = body.get('qr_raw') or body.get('qr_json') or body.get('payload') or body.get('qr')
        # Support direct dict submission as well
        if qr_raw is None and isinstance(body.get('data'), dict):
            import json
            qr_raw = json.dumps(body['data'])
        if qr_raw is None:
            return jsonify({'error': 'Missing QR data (qr_raw/qr_json/payload/qr)'}), 400
        success, resp, status = verify_claim_qr_data(qr_raw)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': f'Failed to verify QR: {str(e)}'}), 500


@validation_bp.route('/api/face/verify', methods=['POST'])
def verify_face_api():
    """
    Server-side face verification that mirrors registration embedding pipeline.

    Request JSON body supports two modes:
      - Provide both: face_data_url (string) and stored_embedding (list[float]).
        The server computes an embedding from the image using the same prioritized pipeline
        (DeepFace Facenet512 -> OpenCV LBP 256 -> PIL 256) and compares it to the provided stored embedding.
      - Alternatively, provide claim_id and face_data_url. In this implementation we only compare
        against the provided stored_embedding to avoid extra Firestore reads. If claim-based lookup
        is needed later, we can extend this endpoint.

    Optional:
      - method: 'cosine' or 'l2' (default 'cosine')
      - threshold: float (default 0.85 for cosine)

    Response:
      { success, match, score, method, threshold, embedding_dim, compare_dim, details, metrics }

    Notes:
      - We do not persist any data here.
      - We select the computed embedding that matches the stored_embedding dimension whenever possible.
    """
    try:
        body = request.get_json(silent=True) or {}
        data_url = body.get('face_data_url') or body.get('data_url')
        stored_embedding = body.get('stored_embedding') or body.get('embedding')
        method = str(body.get('method') or 'cosine').lower()
        try:
            threshold = float(body.get('threshold') or 0.85)
        except Exception:
            threshold = 0.85

        # Basic validation
        if not data_url or not isinstance(data_url, str) or not data_url.startswith('data:image'):
            return jsonify({'success': False, 'error': 'Invalid or missing face_data_url'}), 400
        if not stored_embedding or not isinstance(stored_embedding, (list, tuple)):
            return jsonify({'success': False, 'error': 'Missing stored_embedding (list of numbers)'}), 400

        # Decode data URL safely
        try:
            header, b64 = data_url.split(',', 1)
            img_bytes = base64.b64decode(b64)
        except Exception as de:
            return jsonify({'success': False, 'error': f'Invalid data URL: {str(de)}'}), 400

        # Compute embeddings using prioritized pipeline (DeepFace -> OpenCV LBP -> PIL)
        # We compute up to two embeddings and pick the one that matches stored dim if available.
        computed_embeddings: list[tuple[str, list]] = []  # (label, vector)
        face_detected = False
        used_backend = None
        import time
        t_start = time.perf_counter()

        # 1) Try DeepFace (optional heavy dependency) to get 512-dim vector
        try:
            from deepface import DeepFace  # type: ignore
            # Persist bytes to a temp file for DeepFace
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp.write(img_bytes)
                temp_path = tmp.name
            try:
                reps = DeepFace.represent(img_path=temp_path, model_name='Facenet512', detector_backend='opencv', enforce_detection=False)
                if isinstance(reps, list) and len(reps) > 0 and isinstance(reps[0], dict):
                    vec = reps[0].get('embedding') or reps[0].get('facial_embedding')
                    if isinstance(vec, (list, tuple, np.ndarray)):
                        v = vec.tolist() if isinstance(vec, np.ndarray) else list(vec)
                        computed_embeddings.append(('deepface_facenet512', [round(float(x), 6) for x in v]))
            finally:
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
        except Exception:
            # DeepFace not available or failed — continue with OpenCV/PIL
            pass

        # 2) Try OpenCV LBP histogram (256-dim), similar to claim_service
        if _OPENCV_AVAILABLE:
            try:
                np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
                bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                if bgr is not None:
                    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                    faces = []
                    try:
                        faces = _FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
                    except Exception:
                        faces = []
                    roi_gray = None
                    if isinstance(faces, (list, tuple)) and len(faces) > 0:
                        x, y, w, h = max(faces, key=lambda rect: rect[2] * rect[3])
                        mx, my = int(0.15 * w), int(0.15 * h)
                        x0 = max(0, x - mx)
                        y0 = max(0, y - my)
                        x1 = min(gray.shape[1], x + w + mx)
                        y1 = min(gray.shape[0], y + h + my)
                        roi_gray = gray[y0:y1, x0:x1]
                        face_detected = True
                    else:
                        # Central crop fallback when detection fails
                        h, w = gray.shape
                        side = min(h, w)
                        side = max(32, side)
                        cx, cy = w // 2, h // 2
                        half = side // 2
                        x0 = max(0, cx - half)
                        y0 = max(0, cy - half)
                        x1 = min(w, cx + half)
                        y1 = min(h, cy + half)
                        roi_gray = gray[y0:y1, x0:x1]
                    try:
                        roi_gray = cv2.equalizeHist(roi_gray)
                    except Exception:
                        pass
                    # LBP helper
                    def _lbp_embedding(gray_arr: np.ndarray) -> list:
                        try:
                            gray_small = cv2.resize(gray_arr, (64, 64), interpolation=cv2.INTER_AREA)
                        except Exception:
                            gray_small = np.array(Image.fromarray(gray_arr).resize((64, 64))).astype(np.uint8)
                        h2, w2 = gray_small.shape
                        hist = np.zeros(256, dtype=np.float32)
                        for i in range(1, h2 - 1):
                            row_up = gray_small[i - 1]
                            row = gray_small[i]
                            row_dn = gray_small[i + 1]
                            for j in range(1, w2 - 1):
                                c = int(row[j])
                                code = 0
                                code |= (int(row_up[j - 1]) >= c) << 7
                                code |= (int(row_up[j]) >= c) << 6
                                code |= (int(row_up[j + 1]) >= c) << 5
                                code |= (int(row[j + 1]) >= c) << 4
                                code |= (int(row_dn[j + 1]) >= c) << 3
                                code |= (int(row_dn[j]) >= c) << 2
                                code |= (int(row_dn[j - 1]) >= c) << 1
                                code |= (int(row[j - 1]) >= c) << 0
                                hist[code] += 1.0
                        total = float(hist.sum())
                        if total > 0:
                            hist /= total
                        return [round(float(v), 6) for v in hist.tolist()]
                    computed_embeddings.append(('opencv_lbp256', _lbp_embedding(roi_gray)))
            except Exception:
                pass

        # 3) PIL fallback (256-dim downsample) if needed
        if not computed_embeddings:
            try:
                buf = io.BytesIO(img_bytes)
                img = Image.open(buf).convert('L')
                img = img.resize((16, 16))
                pixels = list(img.getdata())
                max_val = 255.0
                computed_embeddings.append(('pil_256', [round(p / max_val, 6) for p in pixels]))
            except Exception as e:
                return jsonify({'success': False, 'error': f'Failed to compute embedding: {str(e)}'}), 500

        # Choose embedding that matches stored dimension when possible
        stored_dim = int(len(stored_embedding))
        chosen_label, chosen_vec = None, None
        for label, vec in computed_embeddings:
            if len(vec) == stored_dim:
                chosen_label, chosen_vec = label, vec
                break
        if chosen_vec is None:
            # Default to the first embedding if no dimension match; report mismatch
            chosen_label, chosen_vec = computed_embeddings[0]

        # Compare using face_recognition_service
        try:
            match, score = is_match(chosen_vec, list(stored_embedding), method=method, threshold=threshold)
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Comparison failed: {str(e)}',
                'details': {
                    'computed_dim': len(chosen_vec),
                    'stored_dim': stored_dim,
                    'method': method
                }
            }), 422

        t_end = time.perf_counter()
        proc_ms = int((t_end - t_start) * 1000)

        # Prepare response with diagnostics
        resp = {
            'success': True,
            'match': bool(match),
            'score': float(score),
            'method': method,
            'threshold': float(threshold),
            'embedding_dim': int(len(chosen_vec)),
            'compare_dim': stored_dim,
            'used_backend': chosen_label,
            'metrics': {
                'processing_ms': proc_ms,
                'opencv_available': _OPENCV_AVAILABLE,
                'opencv_version': _OPENCV_VERSION or 'unknown',
                'face_detected': face_detected
            }
        }

        # If dimensions differ, include a friendly hint for migration/backward compatibility
        if len(chosen_vec) != stored_dim:
            resp['dimension_mismatch'] = {
                'computed_dim': len(chosen_vec),
                'stored_dim': stored_dim,
                'hint': 'Stored embedding dimension does not match current pipeline. Consider re-capturing or using server-side verification.'
            }

        return jsonify(resp), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to verify face: {str(e)}'}), 500


@validation_bp.route('/api/claim/<claim_id>/finalize', methods=['POST'])
def public_finalize_claim_api(claim_id: str):
    """
    Public endpoint to finalize a claim at the kiosk after QR/identity verification.
    - Does not require admin session
    - Atomically marks claim as 'completed' and opens locker when applicable

    Optional JSON body:
      { duration_sec: number }  # how long the locker should stay open (default 10 sec, max 3600 sec)
    """
    try:
        body = request.get_json(silent=True) or {}
        try:
            duration_sec = int(body.get('duration_sec') or 10)
        except Exception:
            duration_sec = 10
        success, resp, status = finalize_claim_kiosk(claim_id, duration_sec=duration_sec)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to finalize claim: {str(e)}'}), 500


@validation_bp.route('/api/claim/<claim_id>/status', methods=['PUT'])
def public_update_claim_status_api(claim_id: str):
    """
    Public endpoint to update claim status with limited allowed transitions.
    Currently supports: approved -> completed
    """
    try:
        body = request.get_json(silent=True) or {}
        new_status = body.get('status') or body.get('new_status')
        success, resp, status = update_claim_status(claim_id, new_status)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to update claim status: {str(e)}'}), 500


@validation_bp.route('/api/lockers/<locker_id>/open', methods=['POST'])
def kiosk_open_locker_api(locker_id: str):
    """Public locker open endpoint for kiosks.
    Mirrors admin open behavior but without admin session requirement.
    Only allows opening when current status is 'occupied'.

    Optional JSON body:
      { duration_sec: number }
    """
    try:
        payload = request.get_json(silent=True) or {}
        try:
            duration_sec = int(payload.get('duration_sec') or 10)
        except Exception:
            duration_sec = 10
        if duration_sec <= 0 or duration_sec > 3600:
            duration_sec = 10

        ref = db.collection('lockers').document(locker_id)
        snap = ref.get()
        if not snap.exists:
            return jsonify({'success': False, 'error': 'Locker not found'}), 404

        data = snap.to_dict() or {}
        status = str(data.get('status', '')).strip().lower()
        if status == 'open':
            return jsonify({'success': False, 'error': 'Locker is already open'}), 400
        if status != 'occupied':
            return jsonify({'success': False, 'error': 'Only occupied lockers can be opened'}), 400

        close_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=duration_sec)

        ref.update({
            'status': 'open',
            'open_started_at': firestore.SERVER_TIMESTAMP,
            'opened_by': 'kiosk',
            'auto_close_at': close_at,
            'updated_at': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'success': True, 'message': 'Locker opened', 'auto_close_at': close_at.isoformat() + 'Z'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to open locker: {str(e)}'}), 500


@validation_bp.route('/api/lockers/<locker_id>/close', methods=['POST'])
def kiosk_close_locker_api(locker_id: str):
    """Public locker close endpoint for kiosks.
    Reverts locker back to 'occupied' state and clears auto_close_at.
    """
    try:
        ref = db.collection('lockers').document(locker_id)
        snap = ref.get()
        if not snap.exists:
            return jsonify({'success': False, 'error': 'Locker not found'}), 404

        ref.update({
            'status': 'occupied',
            'closed_at': firestore.SERVER_TIMESTAMP,
            'auto_close_at': None,
            'updated_at': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'success': True, 'message': 'Locker closed'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to close locker: {str(e)}'}), 500


@validation_bp.route('/api/lockers', methods=['GET'])
def kiosk_get_lockers_api():
    """Public endpoint to list lockers for kiosk UI.
    Returns a simplified list of lockers similar to the admin endpoint, without requiring admin session.
    """
    try:
        lockers = []
        for doc in db.collection('lockers').stream():
            data = doc.to_dict() or {}
            lockers.append({
                'id': doc.id,
                'locker_id': doc.id,  # include explicit locker_id key for frontend compatibility
                'status': str(data.get('status', '')).strip().lower(),
                'location': data.get('location', 'Unknown'),
                'item_name': data.get('item_name', ''),
                'image_url': data.get('image_url', ''),
                'found_item_id': data.get('found_item_id', ''),
                'updated_at': data.get('updated_at'),
                'auto_close_at': data.get('auto_close_at'),
            })
        return jsonify({'success': True, 'lockers': lockers}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to fetch lockers: {str(e)}'}), 500
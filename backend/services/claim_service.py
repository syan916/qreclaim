"""
Claim service for handling item claim lifecycle:
- Start a claim
- Capture and store face image
- Select verification method
- Generate a time-limited QR code
"""
import os
import io
import uuid
import secrets
import base64
from datetime import datetime, timedelta, timezone
import logging
from PIL import Image, ImageDraw, ImageFont
from firebase_admin import firestore
from google.cloud import firestore as gc_firestore
from ..database import db
from .storage_service import upload_image_to_storage
from .crypto_service import (
    encrypt_bytes_with_envelope,
    decrypt_envelope_to_bytes,
    CryptoConfigError,
    InvalidToken,
)
from .claim_validation_service import ClaimValidationService
from .SMTP_server import send_email
import numpy as np

# Optional OpenCV integration for robust face detection and feature extraction
_OPENCV_AVAILABLE = False
_OPENCV_VERSION = None
_FACE_CASCADE = None
try:
    import cv2  # Ensure opencv-python is installed
    _OPENCV_VERSION = getattr(cv2, '__version__', 'unknown')
    cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
    _FACE_CASCADE = cv2.CascadeClassifier(cascade_path)
    # Validate cascade loaded
    if _FACE_CASCADE is not None and not _FACE_CASCADE.empty():
        _OPENCV_AVAILABLE = True
except Exception:
    # OpenCV not available; will fall back to PIL-only placeholder embedding
    _OPENCV_AVAILABLE = False
    _FACE_CASCADE = None

# Simple in-process cache for frequently accessed claim documents
# Cache format: { claim_id: { 'doc': dict, 'ts': datetime.utcnow() } }
_CLAIM_CACHE = {}
_CLAIM_CACHE_TTL_SECONDS = 30
_logger = logging.getLogger(__name__)
_logger.setLevel(logging.INFO)

def _get_claim_data_cached(claim_id: str):
    """Fetch claim data with a short-lived cache to reduce Firestore reads.
    Returns: (ok: bool, data_or_error: dict, status_code: int)
    """
    try:
        now = datetime.utcnow()
        cached = _CLAIM_CACHE.get(claim_id)
        if cached and (now - cached['ts']).total_seconds() < _CLAIM_CACHE_TTL_SECONDS:
            return True, cached['doc'], 200
        ref = db.collection('claims').document(claim_id)
        snap = ref.get()
        if not snap.exists:
            return False, {'error': 'Claim not found'}, 404
        data = snap.to_dict()
        _CLAIM_CACHE[claim_id] = {'doc': data, 'ts': now}
        return True, data, 200
    except Exception as e:
        return False, {'error': str(e)}, 500

def clear_claim_cache(claim_id: str | None = None):
    """Clear claim cache for a specific claim_id or all if None."""
    try:
        if claim_id:
            _CLAIM_CACHE.pop(claim_id, None)
        else:
            _CLAIM_CACHE.clear()
    except Exception:
        pass

def _generate_next_claim_id():
    """Generate next claim_id like C0001."""
    try:
        query = db.collection('claims').order_by('claim_id', direction=firestore.Query.DESCENDING).limit(1)
        docs = list(query.stream())
        last_id = docs[0].to_dict().get('claim_id') if docs else None
        if not last_id:
            return 'C0001'
        num = int(str(last_id)[1:])
        return f"C{num+1:04d}"
    except Exception:
        # Fallback
        return f"C{uuid.uuid4().hex[:4]}"

def start_claim(user_id: str, found_item_id: str, student_remarks: str | None = None):
    """
    Create a new claim document for a user and found item with comprehensive validation.
    Uses multi-layered validation system for enhanced security and data integrity.
    Returns: (success, response, status_code)
    """
    try:
        # Normalize and validate remarks first
        remarks = (student_remarks or '').strip()
        if remarks and len(remarks) > 300:
            return False, {'error': 'Remarks must be 300 characters or fewer'}, 400

        # Execute comprehensive multi-layered validation
        validation_success, validation_result = ClaimValidationService.validate_comprehensive_claim_request(
            user_id=user_id,
            item_id=found_item_id,
            student_remarks=remarks
        )

        if not validation_success:
            # Validation failed - return specific error with validation context
            error_response = {
                'error': validation_result.get('error', 'Validation failed'),
                'code': validation_result.get('code', 'VALIDATION_FAILED'),
                'validation_details': validation_result.get('validation_results', {}),
                'layers_passed': validation_result.get('validation_results', {}).get('layers_passed', [])
            }
            status_code = validation_result.get('status_code', 400)
            return False, error_response, status_code

        # All validations passed - extract validated data
        item_data = validation_result['item_data']
        valuable_item_info = validation_result.get('valuable_item_info', {})
        is_valuable = item_data.get('is_valuable', False)

        # Check if an existing claim already exists for this user and item
        # This prevents creating duplicate claims and allows reusing existing ones
        existing_claim_ok, existing_claim_data, existing_claim_status = get_user_claim_status_for_item(user_id, found_item_id)
        if existing_claim_ok and existing_claim_data.get('exists'):
            existing_claim_id = existing_claim_data.get('claim_id')
            existing_status = existing_claim_data.get('status')
            
            # If claim exists and is in a valid state (pending, approved, pending_approval), reuse it
            valid_statuses = ['pending', 'approved', 'pending_approval']
            if existing_status in valid_statuses:
                _logger.info(f"Reusing existing claim {existing_claim_id} for user {user_id} and item {found_item_id} (status: {existing_status})")
                
                # Release the per-user session lock since we're not creating a new claim
                try:
                    ClaimValidationService.release_user_session_lock(user_id)
                except Exception:
                    pass
                
                # Return the existing claim information
                response = {
                    'success': True,
                    'claim_id': existing_claim_id,
                    'validation_summary': {
                        'layers_passed': validation_result.get('layers_passed', []),
                        'is_valuable_item': is_valuable,
                        'requires_admin_approval': valuable_item_info.get('requires_admin_approval', False),
                        'session_locked': validation_result.get('session_locked', False),
                        'existing_claim_reused': True,
                        'existing_claim_status': existing_status
                    }
                }
                
                return True, response, 200

        # Note: Do NOT require remarks at this stage
        # Rationale: For valuable items, student remarks are already collected
        # during the early request-approval phase. Subsequent claim operations
        # (validation, face capture, method selection, QR generation) should not
        # block on remarks being present in the current request payload.
        # We continue to store remarks when provided, but absence of remarks no
        # longer prevents claim creation.

        # Double-check item availability outside of transaction (simpler, reduces contention).
        # The session lock from validation already prevents concurrent attempts by the same user.
        try:
            item_ref = db.collection('found_items').document(found_item_id)
            item_doc = item_ref.get()
            if not item_doc.exists:
                ClaimValidationService.release_user_session_lock(user_id)
                return False, {'error': 'Item no longer exists', 'code': 'ITEM_NOT_FOUND'}, 404

            current_item_data = item_doc.to_dict() or {}
            if str(current_item_data.get('status', '')).lower() != 'unclaimed':
                ClaimValidationService.release_user_session_lock(user_id)
                return False, {'error': 'Item is no longer available for claiming', 'code': 'ITEM_UNAVAILABLE'}, 409

            # Generate claim ID and create claim document
            claim_id = _generate_next_claim_id()
            
            # Determine initial status based on item type
            # Non-valuable items are automatically approved, valuable items require admin approval
            initial_status = 'approved' if not is_valuable else 'pending'
            approved_by = 'system_auto_approval' if not is_valuable else None
            approved_at = datetime.now(timezone.utc) if not is_valuable else None
            
            claim_doc = {
                'claim_id': claim_id,
                'found_item_id': found_item_id,
                'student_id': user_id,
                'face_embedding': None,
                'face_image_base64': None,
                'verification_method': None,
                'status': initial_status,
                'qr_token': None,
                'qr_image_url': None,
                'expires_at': None,
                'student_remarks': remarks if remarks else None,
                'admin_remarks': None,
                'approved_by': approved_by,
                'approved_at': approved_at,
                'verified_at': None,
                'created_at': datetime.now(timezone.utc)
            }

            # Create the claim document
            claim_ref = db.collection('claims').document(claim_id)
            claim_ref.set(claim_doc)

            # Clear claim cache for this new claim
            clear_claim_cache(claim_id)

            # Prepare success response with validation context
            response = {
                'success': True,
                'claim_id': claim_id,
                'validation_summary': {
                    'layers_passed': validation_result.get('layers_passed', []),
                    'is_valuable_item': is_valuable,
                    'requires_admin_approval': valuable_item_info.get('requires_admin_approval', False),
                    'session_locked': validation_result.get('session_locked', False),
                    'existing_claim_reused': False,
                    'existing_claim_status': None
                }
            }

            _logger.info(f"Claim created successfully: {claim_id} for user {user_id} and item {found_item_id}")
            
            # Log automatic approval for non-valuable items
            if not is_valuable:
                _logger.info(f"Non-valuable item automatically approved: claim_id={claim_id}, item_id={found_item_id}, user_id={user_id}")
            else:
                _logger.info(f"Valuable item claim created, awaiting admin approval: claim_id={claim_id}, item_id={found_item_id}, user_id={user_id}")

            # Release the per-user session lock once the claim has been created.
            # Rationale:
            # - The session lock is only intended to protect the claim creation transaction
            #   from concurrent attempts by the same user.
            # - Ongoing claim lifecycle is already gated by business rules
            #   (e.g., one active claim at a time via check_user_global_claim_status),
            #   so keeping the lock would incorrectly block legitimate actions like
            #   starting a new claim after completing the previous one.
            # - Not releasing the lock results in the user seeing
            #   "Another claim process is already in progress" for up to
            #   CLAIM_SESSION_LOCK_DURATION_MINUTES even when there are no active claims.
            try:
                ClaimValidationService.release_user_session_lock(user_id)
            except Exception:
                # Swallow any errors during lock release to avoid masking success response
                pass

            return True, response, 201
        except Exception as create_err:
            # Release session lock on creation failure
            ClaimValidationService.release_user_session_lock(user_id)
            _logger.error(f"Claim creation failed: {str(create_err)}")
            return False, {
                'error': 'Failed to create claim',
                'code': 'CLAIM_CREATION_FAILED'
            }, 500

    except Exception as e:
        # Release session lock on unexpected error
        ClaimValidationService.release_user_session_lock(user_id)
        _logger.error(f"Unexpected error in start_claim: {str(e)}")
        return False, {'error': 'Internal server error during claim creation'}, 500

def save_face_image_for_claim(claim_id: str, data_url: str, upload_folder: str):
    """
    Save canvas-captured face image (data URL) and store a computed face embedding on the claim.
    For free-tier compatibility, we DO NOT require Firebase Storage; instead we compute a lightweight
    embedding from the image and save it to 'face_embedding'.

    Returns: (success, response, status_code)
    """
    try:
        # Validate claim exists
        claim_ref = db.collection('claims').document(claim_id)
        claim_doc = claim_ref.get()
        if not claim_doc.exists:
            return False, {'error': 'Claim not found'}, 404

        # Extract base64 from data URL
        if not data_url or not data_url.startswith('data:image'):
            return False, {'error': 'Invalid face image data'}, 400
        try:
            header, b64 = data_url.split(',', 1)
        except Exception:
            return False, {'error': 'Invalid face image data (malformed data URL)'}, 400
        try:
            img_bytes = base64.b64decode(b64)
        except Exception as de:
            return False, {'error': f'Invalid face image data (base64 decode failed): {str(de)}'}, 400
        _logger.info('Capture received for claim %s (data_url_len=%d, bytes=%d)', claim_id, len(data_url), len(img_bytes))

        # Helper: compute 256-dim LBP histogram embedding using OpenCV
        def _lbp_embedding(gray: np.ndarray) -> list:
            # Resize to a small canonical size for stability
            try:
                gray_small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
            except Exception:
                # Fallback to numpy resizing if OpenCV resize fails
                gray_small = np.array(Image.fromarray(gray).resize((64, 64))).astype(np.uint8)
            h, w = gray_small.shape
            hist = np.zeros(256, dtype=np.float32)
            # Compute basic 8-neighbor LBP code
            for i in range(1, h - 1):
                row_up = gray_small[i - 1]
                row = gray_small[i]
                row_dn = gray_small[i + 1]
                for j in range(1, w - 1):
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
            # Round to 6 decimals for compact storage
            return [round(float(v), 6) for v in hist.tolist()]

        # Compute embedding: prefer DeepFace, then OpenCV LBP, finally PIL fallback.
        # Track processing time for performance metrics.
        import time
        t_start = time.perf_counter()
        embedding = None
        try:
            # Try DeepFace if available
            from deepface import DeepFace  # optional heavy dependency
            _logger.info('DeepFace available; attempting to compute embedding for claim %s', claim_id)
            # Persist bytes to a temp file for DeepFace
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp.write(img_bytes)
                temp_path = tmp.name
            try:
                # Use a lightweight model to balance performance; Facenet512 returns 512-dim
                # Detector backend set to 'opencv' to reduce extra heavy dependencies
                reps = DeepFace.represent(img_path=temp_path, model_name='Facenet512', detector_backend='opencv', enforce_detection=False)
                if isinstance(reps, list) and len(reps) > 0 and isinstance(reps[0], dict):
                    vec = reps[0].get('embedding') or reps[0].get('facial_embedding')
                    if isinstance(vec, (list, tuple, np.ndarray)):
                        # Round to 6 decimals for compact storage
                        embedding = [round(float(v), 6) for v in (vec.tolist() if isinstance(vec, np.ndarray) else list(vec))]
            finally:
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
        except Exception as e:
            # DeepFace not installed or failed; continue with OpenCV/PIL
            _logger.info('DeepFace embedding not used for claim %s: %s', claim_id, str(e))

        # If DeepFace failed, fall back to OpenCV LBP embedding
        face_detected = False
        if embedding is None:
            if _OPENCV_AVAILABLE:
                try:
                    np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
                    bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                    if bgr is None:
                        raise ValueError('Failed to decode image')
                    # Convert to grayscale
                    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                    # Attempt face detection
                    faces = []
                    try:
                        faces = _FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
                    except Exception:
                        faces = []
                    roi_gray = None
                    if isinstance(faces, (list, tuple)) and len(faces) > 0:
                        # Choose the largest face
                        x, y, w, h = max(faces, key=lambda rect: rect[2] * rect[3])
                        # Add margin
                        mx = int(0.15 * w)
                        my = int(0.15 * h)
                        x0 = max(0, x - mx)
                        y0 = max(0, y - my)
                        x1 = min(gray.shape[1], x + w + mx)
                        y1 = min(gray.shape[0], y + h + my)
                        roi_gray = gray[y0:y1, x0:x1]
                        face_detected = True
                        # Detection area ratio as a proxy for confidence/framing accuracy
                        try:
                            frame_area = float(gray.shape[0] * gray.shape[1])
                            roi_area = float(max(1, roi_gray.shape[0] * roi_gray.shape[1]))
                            det_area_ratio = float(min(1.0, roi_area / max(1.0, frame_area)))
                        except Exception:
                            det_area_ratio = 0.0
                        # Server-side basic quality checks: brightness and blur
                        try:
                            # Brightness (mean intensity)
                            mean_brightness = float(np.mean(roi_gray))
                            # Blur measure: variance of Laplacian
                            lap_var = float(cv2.Laplacian(roi_gray, cv2.CV_64F).var())
                            # Minimum heuristic thresholds
                            if mean_brightness < 40 or lap_var < 50:
                                _logger.warning('Low-quality face capture for claim %s (brightness=%.2f, blur=%.2f)', claim_id, mean_brightness, lap_var)
                        except Exception:
                            pass
                    else:
                        # No face detected; record and proceed with fallback embedding.
                        face_detected = False
                        # Fallback: central crop to maintain robustness when faces are not detected (e.g., synthetic test image)
                        h, w = gray.shape
                        side = min(h, w)
                        side = max(32, side)  # ensure reasonable size
                        cx, cy = w // 2, h // 2
                        half = side // 2
                        x0 = max(0, cx - half)
                        y0 = max(0, cy - half)
                        x1 = min(w, cx + half)
                        y1 = min(h, cy + half)
                        roi_gray = gray[y0:y1, x0:x1]
                        # When no face is detected, area ratio is small and considered low-confidence
                        try:
                            frame_area = float(gray.shape[0] * gray.shape[1])
                            roi_area = float(max(1, roi_gray.shape[0] * roi_gray.shape[1]))
                            det_area_ratio = float(min(1.0, roi_area / max(1.0, frame_area)))
                        except Exception:
                            det_area_ratio = 0.0
                    # Equalize and embed
                    try:
                        roi_gray = cv2.equalizeHist(roi_gray)
                    except Exception:
                        pass
                    embedding = _lbp_embedding(roi_gray)
                except Exception as embed_err:
                    # Fallback to PIL strategy if OpenCV fails
                    try:
                        from io import BytesIO
                        buf = BytesIO(img_bytes)
                        img = Image.open(buf).convert('L')  # grayscale
                        img = img.resize((16, 16))
                        pixels = list(img.getdata())
                        max_val = 255.0
                        embedding = [round(p / max_val, 6) for p in pixels]
                    except Exception:
                        return False, {'error': f'Failed to compute face embedding: {str(embed_err)}'}, 500
            else:
                # Compute a simple deterministic embedding using PIL downsampling when OpenCV is unavailable
                try:
                    from io import BytesIO
                    buf = BytesIO(img_bytes)
                    img = Image.open(buf).convert('L')  # grayscale
                    img = img.resize((16, 16))
                    pixels = list(img.getdata())
                    max_val = 255.0
                    embedding = [round(p / max_val, 6) for p in pixels]  # 256-dim vector
                except Exception as embed_err:
                    return False, {'error': f'Failed to compute face embedding: {str(embed_err)}'}, 500

        # --- Embedding quality validation and performance metrics ---
        t_end = time.perf_counter()
        proc_ms = int((t_end - t_start) * 1000)

        try:
            arr = np.array(embedding, dtype=np.float32).reshape(-1)
            dim = int(arr.shape[0])
            nonzero = int(np.count_nonzero(arr))
            zero_ratio = float((dim - nonzero) / max(1, dim))
            norm = float(np.linalg.norm(arr))
            mean_val = float(np.mean(arr))
            std_val = float(np.std(arr))
            has_nan = bool(np.isnan(arr).any())
            has_inf = bool(np.isinf(arr).any())
        except Exception as qerr:
            _logger.error('Embedding quality eval failed for claim %s: %s', claim_id, str(qerr))
            return False, {'error': 'Invalid embedding data'}, 500

        # Get claim data to check if this is a valuable item
        claim_data = claim_doc.to_dict() or {}
        found_item_id = claim_data.get('found_item_id')
        
        # Check if item is valuable to determine validation strictness
        is_valuable = False
        if found_item_id:
            try:
                item_ref = db.collection('found_items').document(found_item_id)
                item_doc = item_ref.get()
                if item_doc.exists:
                    item_data = item_doc.to_dict() or {}
                    is_valuable = item_data.get('is_valuable', False)
            except Exception as item_err:
                _logger.warning('Could not determine item value for claim %s: %s', claim_id, str(item_err))
                # Default to strict validation if can't determine
                is_valuable = True
        
        # Validate numeric integrity and non-triviality
        if has_nan or has_inf:
            return False, {'error': 'Embedding contains invalid values'}, 422
        
        # Apply different quality thresholds based on item value
        if is_valuable:
            # Strict validation for valuable items
            if norm <= 1e-6 or nonzero < max(4, int(dim * 0.015)):
                _logger.warning('Rejecting low-quality embedding for valuable item claim %s (dim=%d, nonzero=%d, norm=%.6f)', claim_id, dim, nonzero, norm)
                return False, {
                    'error': 'Face capture quality too low; please retake',
                    'details': {
                        'embedding_dim': dim,
                        'nonzero': nonzero,
                        'norm': norm,
                        'std': std_val
                    }
                }, 422
        else:
            # Lenient validation for non-valuable items - only reject completely invalid embeddings
            if norm <= 1e-8 or nonzero < max(2, int(dim * 0.005)):
                _logger.warning('Rejecting invalid embedding for non-valuable item claim %s (dim=%d, nonzero=%d, norm=%.6f)', claim_id, dim, nonzero, norm)
                return False, {
                    'error': 'Face capture quality too low; please retake',
                    'details': {
                        'embedding_dim': dim,
                        'nonzero': nonzero,
                        'norm': norm,
                        'std': std_val
                    }
                }, 422
        
        # Additional framing/detection validation when OpenCV was used
        try:
            det_ratio_val = float(locals().get('det_area_ratio', 0.0))
            if is_valuable:
                # Strict validation for valuable items
                if _OPENCV_AVAILABLE and det_ratio_val < 0.07:
                    _logger.warning('Rejecting capture due to small detection area ratio for valuable item claim %s (ratio=%.4f)', claim_id, det_ratio_val)
                    return False, {
                        'error': 'Face too small in frame; move closer and retry',
                        'details': { 'detection_area_ratio': det_ratio_val }
                    }, 422
            else:
                # Very lenient validation for non-valuable items - only reject if face is extremely small
                if _OPENCV_AVAILABLE and det_ratio_val < 0.02:
                    _logger.warning('Rejecting capture due to very small detection area ratio for non-valuable item claim %s (ratio=%.4f)', claim_id, det_ratio_val)
                    return False, {
                        'error': 'Face too small in frame; move closer and retry',
                        'details': { 'detection_area_ratio': det_ratio_val }
                    }, 422
        except Exception:
            pass

        # Update claim doc with embedding and raw base64 image (Data URL)
        # Warning: Storing large images in Firestore can exceed document size limits (~1 MiB).
        # Keep capture resolution reasonable on the client (e.g., 640x480) to avoid oversized documents.
        # Compose metrics payload for diagnostics (returned to client, not stored in Firestore per schema requirements)
        metrics = {
            'processing_ms': proc_ms,
            'opencv_available': _OPENCV_AVAILABLE,
            'opencv_version': _OPENCV_VERSION or 'unknown',
            'face_detected': face_detected,
            'detection_area_ratio': round(float(locals().get('det_area_ratio', 0.0)), 6),
            'embedding_dim': int(len(embedding) if embedding else 0),
            'embedding_nonzero': nonzero,
            'embedding_zero_ratio': round(zero_ratio, 6),
            'embedding_norm': round(norm, 6),
            'embedding_mean': round(mean_val, 6),
            'embedding_std': round(std_val, 6)
        }

        # Update only fields defined in the sample claim structure
        claim_ref.update({
            'face_embedding': embedding,
            'face_image_base64': data_url,
        })

        _logger.info('Saved face embedding for claim %s (dim=%d, face_detected=%s)', claim_id, len(embedding) if embedding else 0, str(face_detected))
        _logger.info('Face capture metrics for claim %s (returned to client only): %s', claim_id, metrics)
        return True, {
            'success': True,
            'embedding_dim': len(embedding),
            'face_detected': face_detected,
            'metrics': metrics,
            # No longer returning backend-only fields to maintain target claim schema
        }, 200
    except Exception as e:
        _logger.error('Error saving face image for claim %s: %s', claim_id, str(e))
        return False, {'error': str(e)}, 500

def set_verification_method(claim_id: str, method: str):
    """Update verification method for a claim."""
    try:
        claim_ref = db.collection('claims').document(claim_id)
        if not claim_ref.get().exists:
            return False, {'error': 'Claim not found'}, 404
        # Validate method
        allowed = {'qr_face', 'qr_rfid'}
        if method not in allowed:
            return False, {'error': 'Invalid method'}, 400
        # Per request: remove method_selected_at attribute; only store the selected method
        claim_ref.update({'verification_method': method})
        return True, {'success': True}, 200
    except Exception as e:
        return False, {'error': str(e)}, 500

def finalize_claim(claim_id: str):
    """
    Finalize a claim before QR generation (student-side flow).
    Validations:
    - Claim must exist
    - Face image/embedding must be captured
    - A verification method must be selected

    Behavior:
    - No longer records finalized_at (removed from schema)
    - Keeps status as 'pending' to remain compatible with existing QR verification

    Returns: (success, response, status_code)
    """
    try:
        claim_ref = db.collection('claims').document(claim_id)
        snap = claim_ref.get()
        if not snap.exists:
            return False, {'error': 'Claim not found'}, 404

        data = snap.to_dict() or {}
        # Basic validations
        embedding = data.get('face_embedding')
        method = data.get('verification_method')

        if not embedding or not isinstance(embedding, (list, tuple)):
            return False, {'error': 'Face data not captured yet'}, 400
        if not method:
            return False, {'error': 'Verification method not selected yet'}, 400

        # Do not change status to avoid breaking verify_claim_qr_data (expects 'pending')
        # Per request: finalized_at removed from schema, so skip writing any additional fields
        pass

        # Clear short-lived cache to ensure subsequent reads include new fields
        try:
            clear_claim_cache(claim_id)
        except Exception:
            pass

        return True, {'success': True}, 200
    except Exception as e:
        return False, {'error': str(e)}, 500

def finalize_claim_kiosk(claim_id: str, duration_sec: int = 10):
    """
    Kiosk-side finalize that performs atomic status update and locker opening.
    Intended to be called after QR verification and identity verification.

    Validations:
    - Claim must exist and be in 'approved' status
    - Claim must have face_embedding and verification_method set

    Behavior:
    - If the associated found item has a locker_id:
        * Open the locker (set status 'open' and auto_close_at)
        * Mark the claim status to 'completed'
        * Perform both updates in a single Firestore batch for atomicity
    - If no locker_id:
        * Mark the claim status to 'completed'

    Returns: (success, response, status_code)
    Response includes: verified, claim (id/status), locker (status/id) when applicable
    """
    try:
        if duration_sec <= 0 or duration_sec > 3600:
            duration_sec = 10

        claim_ref = db.collection('claims').document(claim_id)
        snap = claim_ref.get()
        if not snap.exists:
            return False, {'error': 'Claim not found'}, 404

        data = snap.to_dict() or {}

        # Validate claim has capture + method
        embedding = data.get('face_embedding')
        method = data.get('verification_method')
        if not embedding or not isinstance(embedding, (list, tuple)):
            return False, {'error': 'Face data not captured yet'}, 400
        if not method:
            return False, {'error': 'Verification method not selected yet'}, 400

        # Ensure claim is approved (only approved claims can be finalized at kiosk)
        status = str(data.get('status', '')).lower()
        if status != 'approved':
            return False, {'error': f"Claim status must be 'approved' to finalize at kiosk (got '{status}')"}, 409

        found_item_id = data.get('found_item_id')
        locker_id = None
        if found_item_id:
            item_doc = db.collection('found_items').document(found_item_id).get()
            if item_doc.exists:
                item_data = item_doc.to_dict() or {}
                locker_id = item_data.get('locker_id')

        # Prepare response payload
        resp_payload = {
            'success': True,
            'verified': True,  # Capture + method were validated
            'claim': {
                'claim_id': claim_id,
                'status': 'completed'
            }
        }

        # If locker assigned, open it and set auto_close_at in the same batch as claim status update
        if locker_id:
            locker_ref = db.collection('lockers').document(locker_id)
            locker_snap = locker_ref.get()
            if not locker_snap.exists:
                return False, {'error': 'Locker not found'}, 404
            locker_data = locker_snap.to_dict() or {}
            locker_status = str(locker_data.get('status', '')).strip().lower()
            if locker_status == 'open':
                return False, {'error': 'Locker is already open'}, 400
            if locker_status != 'occupied':
                return False, {'error': 'Only occupied lockers can be opened'}, 400

            # Compute auto-close timestamp
            import datetime as _dt
            close_at = _dt.datetime.utcnow() + _dt.timedelta(seconds=duration_sec)

            batch = db.batch()
            # Update claim status to completed
            batch.update(claim_ref, {
                'status': 'completed',
                'completed_at': firestore.SERVER_TIMESTAMP,
                'updated_at': firestore.SERVER_TIMESTAMP
            })
            # Also mark the related found item as claimed
            if found_item_id:
                fi_ref = db.collection('found_items').document(found_item_id)
                batch.update(fi_ref, {
                    'status': 'claimed',
                    'claimed_by': data.get('student_id'),
                    'claimed_at': firestore.SERVER_TIMESTAMP,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })
            # Open locker with auto-close metadata
            batch.update(locker_ref, {
                'status': 'open',
                'open_started_at': firestore.SERVER_TIMESTAMP,
                'opened_by': data.get('student_id') or 'kiosk',
                'auto_close_at': close_at,
                'updated_at': firestore.SERVER_TIMESTAMP
            })
            batch.commit()

            resp_payload['locker'] = {
                'locker_id': locker_id,
                'status': 'open',
                'auto_close_at': close_at.isoformat() + 'Z'
            }
        else:
            # No locker assigned — just mark claim as completed
            claim_ref.update({
                'status': 'completed',
                'completed_at': firestore.SERVER_TIMESTAMP,
                'updated_at': firestore.SERVER_TIMESTAMP
            })
            # Also mark the related found item as claimed
            if found_item_id:
                db.collection('found_items').document(found_item_id).update({
                    'status': 'claimed',
                    'claimed_by': data.get('student_id'),
                    'claimed_at': firestore.SERVER_TIMESTAMP,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })

        # Clear cache so subsequent reads reflect updated state
        try:
            clear_claim_cache(claim_id)
        except Exception:
            pass

        try:
            item_name = None
            fi = data.get('found_item_id')
            if fi:
                idoc = db.collection('found_items').document(fi).get()
                if idoc.exists:
                    item_name = (idoc.to_dict() or {}).get('found_item_name')
            _create_notification(
                user_id=data.get('student_id'),
                title='Claim completed',
                message=f"You have successfully claimed {item_name or 'your item'}",
                link='/user/claim-history',
                ntype='claim_success'
            )
            try:
                subj = 'Claim completed successfully'
                txt = f"You have successfully claimed {item_name or 'your item'} at the kiosk."
                html = f"<p>You have successfully claimed <strong>{item_name or 'your item'}</strong> at the kiosk.</p>"
                _queue_trigger_email(data.get('student_id'), subj, html, txt)
            except Exception:
                pass
        except Exception:
            pass

        return True, resp_payload, 200
    except Exception as e:
        _logger.error('Error finalizing claim at kiosk for %s: %s', claim_id, str(e))
        return False, {'error': str(e)}, 500

def update_claim_status(claim_id: str, new_status: str):
    """
    Update claim status with basic validation used by public API.
    Currently supports transitioning an 'approved' claim to 'completed'.

    Returns: (success, response, status_code)
    """
    try:
        desired = str(new_status or '').strip().lower()
        if desired not in ['completed']:
            return False, {'error': f"Unsupported status '{new_status}'"}, 400

        ref = db.collection('claims').document(claim_id)
        snap = ref.get()
        if not snap.exists:
            return False, {'error': 'Claim not found'}, 404

        data = snap.to_dict() or {}
        current = str(data.get('status', '')).strip().lower()

        # Enforce simple allowed transition: approved -> completed
        if current != 'approved':
            return False, {'error': f"Invalid transition from '{current}' to '{desired}'"}, 409

        ref.update({
            'status': 'completed',
            'completed_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        })

        try:
            clear_claim_cache(claim_id)
        except Exception:
            pass

        try:
            item_name = None
            fi = data.get('found_item_id')
            if fi:
                idoc = db.collection('found_items').document(fi).get()
                if idoc.exists:
                    item_name = (idoc.to_dict() or {}).get('found_item_name')
            _create_notification(
                user_id=data.get('student_id'),
                title='Claim completed',
                message=f"You have successfully claimed {item_name or 'your item'}",
                link='/user/claim-history',
                ntype='claim_success'
            )
        except Exception:
            pass

        return True, {'success': True, 'claim_id': claim_id, 'status': 'completed'}, 200
    except Exception as e:
        return False, {'error': str(e)}, 500

def _generate_qr_image(payload: str, upload_folder: str, embed_logo: bool = True, logo_path: str | None = None):
    """
    Generate a QR image for the payload and save to a temp file.
    Tries to use `qrcode` library; if unavailable, falls back to a simple placeholder image.
    Returns: (success, temp_path_or_error)
    """
    try:
        try:
            import qrcode
            qr = qrcode.QRCode(version=1, box_size=10, border=4)
            qr.add_data(payload)
            qr.make(fit=True)
            img = qr.make_image(fill_color='black', back_color='white').convert('RGBA')

            # Optionally embed a logo at the center
            if embed_logo:
                try:
                    # Default logo path under project static/images
                    if not logo_path:
                        logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'images', 'Logo.png'))
                    if os.path.exists(logo_path):
                        logo = Image.open(logo_path).convert('RGBA')
                        # Scale logo to ~20% of QR image width
                        qr_w, qr_h = img.size
                        target_w = max(40, int(qr_w * 0.2))
                        # Maintain aspect ratio
                        ratio = target_w / float(logo.size[0])
                        target_h = int(logo.size[1] * ratio)
                        # Use a high-quality resampling filter for logo scaling
                        logo = logo.resize((target_w, target_h), Image.LANCZOS)
                        # Paste centered with alpha
                        pos = ((qr_w - target_w) // 2, (qr_h - target_h) // 2)
                        img.alpha_composite(logo, dest=pos)
                except Exception:
                    # If logo embedding fails, continue with plain QR
                    pass

            # Save to temp path
            filename = f"qr_{uuid.uuid4().hex}.png"
            temp_path = os.path.join(upload_folder, filename)
            img.save(temp_path)
            return True, temp_path
        except Exception:
            # Fallback: draw text payload into image (not scannable QR, placeholder)
            img = Image.new('RGB', (400, 400), color=(255, 255, 255))
            draw = ImageDraw.Draw(img)
            text = f"QR Token\n{payload[:200]}"
            # Try to load a default font
            try:
                font = ImageFont.load_default()
            except Exception:
                font = None
            draw.multiline_text((20, 160), text, fill=(0, 0, 0), font=font, align='center')
            filename = f"qr_{uuid.uuid4().hex}.png"
            temp_path = os.path.join(upload_folder, filename)
            img.save(temp_path, format='PNG')
            return True, temp_path
    except Exception as e:
        return False, str(e)

def generate_claim_qr(claim_id: str, upload_folder: str):
    """
    Generate a time-limited QR code for the claim, upload it to storage, and update the claim.
    The QR content is a raw JSON string with required fields only (no URLs):
    {
        "claim_id": "<claim_id>",
        "student_id": "<student_id>",
        "token": "<secure_token>"
    }
    Returns: (success, response, status_code)
    """
    try:
        claim_ref = db.collection('claims').document(claim_id)
        claim_doc = claim_ref.get()
        if not claim_doc.exists:
            return False, {'error': 'Claim not found', 'code': 'CLAIM_NOT_FOUND'}, 404

        # Validate claim state before generating QR (predictable client errors should be 4xx)
        cdata = claim_doc.to_dict() or {}
        embedding = cdata.get('face_embedding')
        method = cdata.get('verification_method')

        # Ensure required fields were captured and the claim was finalized by the user
        if not embedding or not isinstance(embedding, (list, tuple)):
            return False, {
                'error': 'Face data not captured yet',
                'code': 'FACE_NOT_CAPTURED'
            }, 409
        if not method:
            return False, {
                'error': 'Verification method not selected yet',
                'code': 'METHOD_NOT_SELECTED'
            }, 409
        # Per request: do not require finalized_at; proceed when method and face_embedding are set

        # Enforce admin approval for valuable items before QR generation
        try:
            found_item_id = cdata.get('found_item_id')
            if found_item_id:
                item_doc = db.collection('found_items').document(found_item_id).get()
                if item_doc.exists:
                    item_data = item_doc.to_dict() or {}
                    is_valuable = bool(item_data.get('is_valuable', False))
                    if is_valuable:
                        # Require explicit admin approval recorded on the claim
                        approved_by = cdata.get('approved_by')
                        status_val = str(cdata.get('status', '')).lower()
                        if not approved_by and status_val != 'approved':
                            return False, {
                                'error': 'Admin approval required before generating QR for valuable item',
                                'code': 'ADMIN_APPROVAL_REQUIRED'
                            }, 403
        except Exception as e:
            _logger.warning('Valuable item approval precheck failed for claim %s: %s', claim_id, str(e))

        # Enforce one active QR per user-item pair: if another active QR exists, block generation
        try:
            found_item_id = cdata.get('found_item_id')
            student_id = cdata.get('student_id')
            if found_item_id and student_id:
                now_utc = datetime.now(timezone.utc)
                query = db.collection('claims').where('found_item_id', '==', found_item_id).where('student_id', '==', student_id).where('qr_token', '!=', None)
                docs = list(query.stream())
                for d in docs:
                    if d.id == claim_id:
                        continue
                    dd = d.to_dict() or {}
                    exp = dd.get('expires_at')
                    if exp:
                        try:
                            exp_dt = exp if isinstance(exp, datetime) else datetime.fromtimestamp(float(exp), tz=timezone.utc)
                        except Exception:
                            exp_dt = None
                        if exp_dt and now_utc < exp_dt:
                            return False, {
                                'error': 'Another active QR is already registered for this item for your account',
                                'code': 'QR_ALREADY_REGISTERED_FOR_USER'
                            }, 409
        except Exception as e:
            _logger.warning('QR uniqueness precheck failed for claim %s: %s', claim_id, str(e))

        # Create cryptographically secure token and expiration
        # Use alphanumeric-only token (8-32 chars) per spec; choose 24 for strong entropy
        import string
        alphabet = string.ascii_letters + string.digits
        token = ''.join(secrets.choice(alphabet) for _ in range(24))
        # Use timezone-aware UTC timestamp to avoid client parsing ambiguity
        expires_at_dt = datetime.now(timezone.utc) + timedelta(minutes=5)
        # Payload encodes required fields only (JSON, no URL prefixes)
        student_id = claim_doc.to_dict().get('student_id')
        payload = {
            'claim_id': claim_id,
            'student_id': student_id,
            'token': token,
        }
        import json
        # Convert JSON to bytes then encrypt with Fernet; envelope is a JSON string
        payload_json = json.dumps(payload)
        payload_bytes = payload_json.encode('utf-8')

        # Preflight encryption configuration: if misconfigured, gracefully fall back to plaintext QR
        qr_encrypted = True
        try:
            # Import here to avoid circulars
            from .crypto_service import get_active_fernet
            _ver, _f = get_active_fernet()  # Will raise CryptoConfigError if misconfigured
        except CryptoConfigError as e:
            _logger.warning('Encryption not configured for QR generation (claim=%s): %s. Falling back to plaintext JSON.', claim_id, str(e))
            qr_encrypted = False
        except Exception as e:
            # Unexpected error while loading crypto deps — prefer availability over failure
            _logger.warning('Encryption preflight failed for claim=%s: %s. Falling back to plaintext JSON.', claim_id, str(e))
            qr_encrypted = False

        # Attempt encryption when available; otherwise use plaintext JSON as payload
        if qr_encrypted:
            try:
                envelope_str = encrypt_bytes_with_envelope(payload_bytes)
            except CryptoConfigError as e:
                # Configuration error while encrypting — fallback to plaintext
                _logger.warning('Encryption configuration error while generating QR for claim=%s: %s. Falling back to plaintext JSON.', claim_id, str(e))
                envelope_str = payload_json
                qr_encrypted = False
            except Exception as e:
                _logger.warning('Encryption failed for claim=%s: %s. Falling back to plaintext JSON.', claim_id, str(e))
                envelope_str = payload_json
                qr_encrypted = False
        else:
            envelope_str = payload_json

        # Generate QR using encrypted envelope string
        ok, temp_or_err = _generate_qr_image(envelope_str, upload_folder, embed_logo=True)
        if not ok:
            return False, {
                'error': temp_or_err,
                'code': 'QR_IMAGE_GENERATION_FAILED'
            }, 500

        # Upload to storage
        ok2, url_or_err = upload_image_to_storage(temp_or_err, folder_name='claims/qrs')
        try:
            os.remove(temp_or_err)
        except Exception:
            pass
        if not ok2:
            return False, {
                'error': url_or_err,
                'code': 'UPLOAD_FAILED'
            }, 502

        # Update claim doc (and auto-approve non-valuable items)
        update_data = {
            'qr_token': token,
            'qr_image_url': url_or_err,
            'expires_at': expires_at_dt,
        }

        # If the found item is non-valuable, auto-set approval fields
        try:
            found_item_id = claim_doc.to_dict().get('found_item_id')
            if found_item_id:
                item_doc = db.collection('found_items').document(found_item_id).get()
                if item_doc.exists:
                    item_data = item_doc.to_dict()
                    is_valuable = item_data.get('is_valuable', False)
                    if not is_valuable:
                        update_data['approved_by'] = 'system generate no approved required'
                        update_data['approved_at'] = firestore.SERVER_TIMESTAMP
        except Exception:
            # If any error occurs during item check, skip auto-approve (fail-safe)
            pass

        claim_ref.update(update_data)

        try:
            _create_notification(
                user_id=student_id,
                title='QR code registered',
                message='Your QR code has been successfully registered',
                link='/user/my-qr-code',
                ntype='registration_success'
            )
            try:
                item_name = None
                fi = cdata.get('found_item_id')
                if fi:
                    idoc = db.collection('found_items').document(fi).get()
                    if idoc.exists:
                        item_name = (idoc.to_dict() or {}).get('found_item_name')
                subj = 'Your QR code is ready'
                txt = f"Your QR code for {item_name or 'your item'} has been generated. It expires in 5 minutes."
                html = f"<p>Your QR code for <strong>{item_name or 'your item'}</strong> has been generated.</p><p>It expires in 5 minutes for security.</p>"
                _queue_trigger_email(student_id, subj, html, txt)
            except Exception:
                pass
        except Exception:
            pass

        return True, {
            'success': True,
            'qr_image_url': url_or_err,
            # Return ISO8601 with milliseconds and explicit Z suffix for UTC
            'expires_at': expires_at_dt.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            # Also return a numeric timestamp to make client countdown robust
            'expires_at_ms': int(expires_at_dt.timestamp() * 1000)
        }, 200
    except Exception as e:
        return False, {
            'error': str(e),
            'code': 'UNHANDLED_SERVER_ERROR'
        }, 500

def get_qr_status_for_item(found_item_id: str):
    """
    Check if there is an active (non-expired) QR registered for the given found item.
    Returns: (success, response, status_code)
      response: {
        'registered': bool,
        'active': bool,
        'claim_id': str | None,
        'expires_at': str | None
      }
    """
    try:
        now_utc = datetime.now(timezone.utc)
        query = db.collection('claims').where('found_item_id', '==', found_item_id).where('qr_token', '!=', None)
        docs = list(query.stream())
        _logger.info('QR status query: item=%s, claims_with_qr=%d', found_item_id, len(docs))
        active_claim_id = None
        active_exp = None
        for d in docs:
            data = d.to_dict() or {}
            exp = data.get('expires_at')
            exp_dt = None
            if exp:
                try:
                    exp_dt = exp if isinstance(exp, datetime) else datetime.fromtimestamp(float(exp), tz=timezone.utc)
                except Exception:
                    exp_dt = None
            if exp_dt and now_utc < exp_dt:
                active_claim_id = data.get('claim_id', d.id)
                active_exp = exp_dt
                break
        if active_claim_id:
            _logger.info('QR active found for item=%s, claim_id=%s, expires_at=%s', found_item_id, active_claim_id, active_exp)
            return True, {
                'registered': True,
                'active': True,
                'claim_id': active_claim_id,
                'expires_at': active_exp.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            }, 200
        # No active QR; if any QR exists but expired, still registered but inactive
        if docs:
            _logger.info('QR found but inactive/expired for item=%s, claim_id=%s', found_item_id, (docs[0].to_dict() or {}).get('claim_id', docs[0].id))
            return True, {
                'registered': True,
                'active': False,
                'claim_id': (docs[0].to_dict() or {}).get('claim_id', docs[0].id),
                'expires_at': None
            }, 200
        _logger.info('No QR registered for item=%s', found_item_id)
        return True, {
            'registered': False,
            'active': False,
            'claim_id': None,
            'expires_at': None
        }, 200
    except Exception as e:
        _logger.error('Error getting QR status for item=%s: %s', found_item_id, str(e))
        return False, {'error': str(e)}, 500

def get_qr_status_for_user_item(student_id: str, found_item_id: str):
    """
    Enhanced user-specific QR registration status for a found item.
    Now includes comprehensive validation of QR status and linked claim validity.
    
    Returns: (success, response, status_code)
      response: {
        'registered': bool,
        'active': bool,
        'claim_id': str | None,
        'expires_at': str | None,
        'claim_status': str | None,
        'claim_valid': bool,
        'has_active_qr': bool  # For backward compatibility
      }
    """
    try:
        now_utc = datetime.now(timezone.utc)
        query = db.collection('claims').where('found_item_id', '==', found_item_id).where('student_id', '==', student_id).where('qr_token', '!=', None)
        docs = list(query.stream())
        
        active_claim_id = None
        active_exp = None
        claim_status = None
        claim_valid = False
        
        for d in docs:
            data = d.to_dict() or {}
            exp = data.get('expires_at')
            exp_dt = None
            
            # Parse expiration date
            if exp:
                try:
                    exp_dt = exp if isinstance(exp, datetime) else datetime.fromtimestamp(float(exp), tz=timezone.utc)
                except Exception:
                    exp_dt = None
            
            # Check if QR is still active (not expired)
            if exp_dt and now_utc < exp_dt:
                # QR is active, now validate the linked claim
                claim_status = data.get('status', '').lower()
                
                # Determine if the claim is still valid/uncompleted
                # Valid claim statuses for active QR: pending, pending_approval, approved
                valid_claim_statuses = ['pending', 'pending_approval', 'approved']
                claim_valid = claim_status in valid_claim_statuses
                
                # Additional validation: ensure claim hasn't been completed/rejected
                if claim_status == 'completed' or claim_status == 'rejected' or claim_status == 'cancelled':
                    claim_valid = False
                    _logger.info('QR found but claim is completed/rejected/cancelled for user=%s item=%s claim_status=%s', 
                               student_id, found_item_id, claim_status)
                    continue  # Skip this QR as it's linked to an invalid claim
                
                # If we reach here, both QR is active and claim is valid
                active_claim_id = data.get('claim_id', d.id)
                active_exp = exp_dt
                break
        
        if active_claim_id and claim_valid:
            _logger.info('Valid active QR found for user=%s item=%s claim_id=%s status=%s expires_at=%s', 
                        student_id, found_item_id, active_claim_id, claim_status, active_exp)
            return True, {
                'registered': True,
                'active': True,
                'claim_id': active_claim_id,
                'expires_at': active_exp.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                'claim_status': claim_status,
                'claim_valid': True,
                'has_active_qr': True  # For backward compatibility
            }, 200
        
        if docs:
            # QR exists but either expired or linked to invalid claim
            latest_doc = docs[0]
            latest_data = latest_doc.to_dict() or {}
            _logger.info('QR found but inactive/invalid for user=%s item=%s claim_id=%s', 
                        student_id, found_item_id, latest_data.get('claim_id', latest_doc.id))
            return True, {
                'registered': True,
                'active': False,
                'claim_id': latest_data.get('claim_id', latest_doc.id),
                'expires_at': None,
                'claim_status': latest_data.get('status'),
                'claim_valid': False,
                'has_active_qr': False
            }, 200
        
        # No QR registered at all
        _logger.info('No QR registered for user=%s item=%s', student_id, found_item_id)
        return True, {
            'registered': False,
            'active': False,
            'claim_id': None,
            'expires_at': None,
            'claim_status': None,
            'claim_valid': False,
            'has_active_qr': False
        }, 200
        
    except Exception as e:
        _logger.error('Error getting QR status for user=%s item=%s: %s', student_id, found_item_id, str(e))
        return False, {'error': str(e)}, 500

def get_active_qr_for_user(student_id: str):
    try:
        if not student_id:
            return False, {'error': 'Missing student_id'}, 400
        now_utc = datetime.now(timezone.utc)
        query = db.collection('claims').where('student_id', '==', student_id).where('qr_token', '!=', None).order_by('created_at', direction=firestore.Query.DESCENDING)
        try:
            docs = list(query.limit(20).stream())
        except Exception:
            docs = list(db.collection('claims').where('student_id','==',student_id).where('qr_token','!=',None).stream())
        active = None
        for d in docs:
            data = d.to_dict() or {}
            exp = data.get('expires_at')
            exp_dt = None
            if exp:
                try:
                    exp_dt = exp if isinstance(exp, datetime) else datetime.fromtimestamp(float(exp), tz=timezone.utc)
                except Exception:
                    exp_dt = None
            if exp_dt and now_utc < exp_dt:
                active = (d.id, data)
                break
        if not active:
            return True, {'success': True, 'qr_code': None}, 200
        claim_id, cdata = active
        item_name = None
        if cdata.get('found_item_id'):
            idoc = db.collection('found_items').document(cdata.get('found_item_id')).get()
            if idoc.exists:
                item_name = (idoc.to_dict() or {}).get('found_item_name')
        resp = {
            'success': True,
            'qr_code': {
                'claim_id': claim_id,
                'item_name': item_name,
                'qr_image_url': cdata.get('qr_image_url'),
                'created_at': _isoformat_or_none(cdata.get('created_at')),
                'expires_at': _isoformat_or_none(cdata.get('expires_at')),
                'expires_at_ms': int((cdata.get('expires_at') or now_utc).timestamp() * 1000) if hasattr((cdata.get('expires_at') or now_utc), 'timestamp') else None,
                'token': cdata.get('qr_token')
            }
        }
        return True, resp, 200
    except Exception as e:
        return False, {'error': str(e)}, 500

def get_user_claim_status_for_item(student_id: str, found_item_id: str):
    """
    Get the latest claim status for a specific user-item pair.
    Returns: (success, response, status_code)
      response: {
        'exists': bool,
        'status': str | None,
        'claim_id': str | None,
        'approved_by': str | None,
        'approved_at': str | None
      }
    """
    try:
        # Avoid composite index requirements: fetch and sort in Python
        query = db.collection('claims').where('found_item_id', '==', found_item_id).where('student_id', '==', student_id)
        docs = list(query.stream())
        if not docs:
            return True, {'exists': False, 'status': None, 'claim_id': None, 'approved_by': None, 'approved_at': None}, 200

        def _created_at_or_min(doc):
            data = doc.to_dict() or {}
            dt = data.get('created_at')
            # Firestore returns datetime; if missing, sort lowest
            from datetime import datetime
            try:
                return dt if isinstance(dt, datetime) else datetime.min
            except Exception:
                return datetime.min

        # Prefer pending-like statuses, otherwise pick latest by created_at
        pending_statuses = {'pending', 'pending_approval'}
        pending_docs = [d for d in docs if str((d.to_dict() or {}).get('status', '')).lower() in pending_statuses]
        if pending_docs:
            d = sorted(pending_docs, key=_created_at_or_min, reverse=True)[0]
        else:
            d = sorted(docs, key=_created_at_or_min, reverse=True)[0]

        data = d.to_dict() or {}
        status = data.get('status')
        return True, {
            'exists': True,
            'status': status,
            'claim_id': data.get('claim_id', d.id),
            'approved_by': data.get('approved_by'),
            'approved_at': data.get('approved_at'),
        }, 200
    except Exception as e:
        _logger.error('Error getting user claim status for user=%s item=%s: %s', student_id, found_item_id, str(e))
        return False, {'error': str(e)}, 500


def check_user_global_claim_status(student_id: str, exclude_item_id: str = None):
    """
    Check if user has any active or pending claims across all items.
    This enforces the "one active claim at a time" business rule.
    
    Args:
        student_id (str): ID of the student
        exclude_item_id (str, optional): Item ID to exclude from the check (for current item validation)
    
    Returns: (success, response, status_code)
      response: {
        'has_active_claims': bool,
        'active_claims_count': int,
        'active_claims': list,  # List of active claim details
        'blocking_claim': dict | None  # Details of the first blocking claim found
      }
    """
    try:
        # Define statuses that are considered "active" and should block new claims
        active_statuses = ['pending', 'pending_approval', 'approved']
        
        # Query for all claims by this user with active statuses
        query = db.collection('claims').where('student_id', '==', student_id)
        all_claims = list(query.stream())
        
        active_claims = []
        blocking_claim = None
        
        for claim_doc in all_claims:
            claim_data = claim_doc.to_dict() or {}
            claim_status = claim_data.get('status', '').lower()
            claim_item_id = claim_data.get('found_item_id')
            
            # Skip if this is the item we're excluding (current item being validated)
            if exclude_item_id and claim_item_id == exclude_item_id:
                continue
            
            # Check if this claim is in an active status
            if claim_status in active_statuses:
                claim_details = {
                    'claim_id': claim_data.get('claim_id', claim_doc.id),
                    'found_item_id': claim_item_id,
                    'status': claim_status,
                    'created_at': claim_data.get('created_at'),
                    'item_name': None  # Will be populated if needed
                }
                
                # Try to get item name for better user experience
                try:
                    if claim_item_id:
                        item_doc = db.collection('found_items').document(claim_item_id).get()
                        if item_doc.exists:
                            item_data = item_doc.to_dict() or {}
                            claim_details['item_name'] = item_data.get('found_item_name', 'Unknown Item')
                except Exception:
                    pass  # Continue without item name if fetch fails
                
                active_claims.append(claim_details)
                
                # Set the first active claim as the blocking claim
                if not blocking_claim:
                    blocking_claim = claim_details
        
        has_active_claims = len(active_claims) > 0
        
        if has_active_claims:
            _logger.info('User %s has %d active claims, blocking new claim attempts', 
                        student_id, len(active_claims))
        else:
            _logger.info('User %s has no active claims, can proceed with new claim', student_id)
        
        return True, {
            'has_active_claims': has_active_claims,
            'active_claims_count': len(active_claims),
            'active_claims': active_claims,
            'blocking_claim': blocking_claim
        }, 200
        
    except Exception as e:
        _logger.error('Error checking global claim status for user=%s: %s', student_id, str(e))
        return False, {'error': str(e)}, 500

def validate_admin_status_for_approval(admin_id: str):
    """
    Validate that the approving admin has active status.
    This ensures only active admins can approve valuable item claims.
    
    Args:
        admin_id (str): ID of the admin who approved the claim
    
    Returns: (success, response, status_code)
      response: {
        'is_valid': bool,
        'admin_status': str | None,
        'admin_name': str | None,
        'error_reason': str | None
      }
    """
    try:
        if not admin_id:
            return True, {
                'is_valid': False,
                'admin_status': None,
                'admin_name': None,
                'error_reason': 'No admin ID provided'
            }, 200
        
        # Get admin user document
        admin_doc = db.collection('users').document(admin_id).get()
        
        if not admin_doc.exists:
            _logger.warning('Admin validation failed: admin document not found for ID %s', admin_id)
            return True, {
                'is_valid': False,
                'admin_status': None,
                'admin_name': None,
                'error_reason': 'Admin not found in system'
            }, 200
        
        admin_data = admin_doc.to_dict() or {}
        admin_status = admin_data.get('status', '').lower()
        admin_name = admin_data.get('name', 'Unknown Admin')
        admin_role = admin_data.get('role', '').lower()
        
        # Validate admin role
        if admin_role != 'admin':
            _logger.warning('Admin validation failed: user %s is not an admin (role: %s)', admin_id, admin_role)
            return True, {
                'is_valid': False,
                'admin_status': admin_status,
                'admin_name': admin_name,
                'error_reason': f'User is not an admin (role: {admin_role})'
            }, 200
        
        # Validate admin status is active
        if admin_status != 'active':
            _logger.warning('Admin validation failed: admin %s status is not active (status: %s)', admin_id, admin_status)
            return True, {
                'is_valid': False,
                'admin_status': admin_status,
                'admin_name': admin_name,
                'error_reason': f'Admin status is not active (status: {admin_status})'
            }, 200
        
        # Admin is valid
        _logger.info('Admin validation successful: admin %s (%s) is active', admin_id, admin_name)
        return True, {
            'is_valid': True,
            'admin_status': admin_status,
            'admin_name': admin_name,
            'error_reason': None
        }, 200
        
    except Exception as e:
        _logger.error('Error validating admin status for admin=%s: %s', admin_id, str(e))
        return False, {'error': str(e)}, 500


def verify_claim_qr_data(qr_raw: str):
    """
    Verify scanned QR data.
    - Parse raw QR string as JSON using json.loads()
    - Validate presence of required fields: claim_id, student_id, token
    - Match claim_id + token + student_id against Firestore claim document
    - Ensure claim status is 'pending' and not expired

    Returns: (success: bool, response: dict, status_code: int)
    """
    try:
        import json
        import re
        # Normalize raw input: support encrypted envelope (preferred) and legacy plaintext JSON
        if isinstance(qr_raw, dict):
            # Assume already decrypted JSON dict
            data = qr_raw
        elif isinstance(qr_raw, (bytes, bytearray)):
            # Attempt to decrypt if bytes provided
            try:
                decrypted = decrypt_envelope_to_bytes(qr_raw.decode('utf-8'))
                data = json.loads(decrypted.decode('utf-8'))
            except InvalidToken:
                return False, {'error': 'Invalid encryption or tampered data'}, 400
        elif isinstance(qr_raw, str):
            # Try decrypting envelope first
            try:
                decrypted = decrypt_envelope_to_bytes(qr_raw)
                data = json.loads(decrypted.decode('utf-8'))
            except InvalidToken:
                # Fallback: try legacy/plaintext JSON
                try:
                    data = json.loads(qr_raw)
                except Exception:
                    return False, {'error': 'Invalid QR data: cannot decrypt or parse JSON'}, 400
            except CryptoConfigError:
                # If encryption is not configured, treat payload as plaintext JSON
                try:
                    data = json.loads(qr_raw)
                except Exception as e:
                    return False, {'error': f'Encryption configuration error and plaintext parse failed: {str(e)}'}, 500
            except Exception as e:
                return False, {'error': f'Decryption failed: {str(e)}'}, 500
        else:
            return False, {'error': 'Unsupported QR data type'}, 400

        if not isinstance(data, dict):
            return False, {'error': 'QR payload must be a JSON object'}, 400

        # Validate required fields
        required = ('claim_id', 'student_id', 'token')
        for key in required:
            val = data.get(key)
            if not isinstance(val, str) or not val.strip():
                return False, {'error': f'Missing or invalid field: {key}'}, 400

        claim_id = data['claim_id'].strip()
        student_id = data['student_id'].strip()
        token = data['token'].strip()

        # Schema validation per spec
        if not re.fullmatch(r'C\d{4}', claim_id):
            return False, {'error': 'Invalid claim_id format'}, 400
        if not re.fullmatch(r'\d{7}', student_id):
            return False, {'error': 'Invalid student_id format'}, 400
        if not re.fullmatch(r'[A-Za-z0-9]{8,32}', token):
            return False, {'error': 'Invalid token format'}, 400

        # Fetch claim doc
        claim_ref = db.collection('claims').document(claim_id)
        ok_doc, cdata_or_err, status_code = _get_claim_data_cached(claim_id)
        if not ok_doc:
            return False, cdata_or_err, status_code
        cdata = cdata_or_err

        # Field checks
        # Ensure the claim belongs to the same student
        if cdata.get('student_id') != student_id:
            return False, {'error': 'Student mismatch'}, 403

        # Ensure a QR token exists on the claim and matches the scanned token
        stored_token = cdata.get('qr_token')
        if not stored_token or not isinstance(stored_token, str) or not stored_token.strip():
            return False, {'error': 'QR token missing for this claim'}, 400
        if stored_token.strip() != token:
            import os
            if os.environ.get('ALLOW_QR_TOKEN_FALLBACK', 'false').lower() in ('1','true','yes'):
                _logger.warning('QR token mismatch for claim %s but ALLOW_QR_TOKEN_FALLBACK enabled; proceeding', claim_id)
            else:
                return False, {'error': 'Invalid or mismatched token'}, 403

        # Enforce claim approval status per new validation requirements
        status_val = str(cdata.get('status', '')).strip().lower()
        if status_val != 'approved':
            return False, {'error': 'Claim is not approved'}, 409

        # Verify the student account exists and is active
        try:
            user_doc = db.collection('users').document(student_id).get()
            if not user_doc.exists:
                return False, {'error': 'Student account does not exist'}, 404
            user_data = user_doc.to_dict() or {}
            account_status = str((user_data.get('status') or '')).strip().lower()
            if account_status != 'active':
                import os
                if os.environ.get('ALLOW_QR_TOKEN_FALLBACK', 'false').lower() in ('1','true','yes'):
                    _logger.warning('User %s not active (status=%s) but ALLOW_QR_TOKEN_FALLBACK enabled; proceeding', student_id, user_data.get('status'))
                else:
                    return False, {'error': f'User account is not active (status: {user_data.get("status")})'}, 403
        except Exception as e:
            _logger.error('Error validating user account for student_id=%s: %s', student_id, str(e))
            return False, {'error': 'Failed to validate user account'}, 500

        # Expiration check
        exp = cdata.get('expires_at')
        if not exp:
            return False, {'error': 'QR expiration not set'}, 400

        # Normalize Firestore timestamp/datetime
        exp_dt = exp
        if isinstance(exp_dt, datetime):
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        else:
            # If stored as epoch seconds
            try:
                exp_dt = datetime.fromtimestamp(float(exp), tz=timezone.utc)
            except Exception:
                exp_dt = None
        if not exp_dt:
            return False, {'error': 'Invalid expiration value'}, 400

        now = datetime.now(timezone.utc)
        if now > exp_dt:
            return False, {'error': 'QR code expired'}, 410

        # Per request: avoid writing extra fields not present in data.sql; skip recording last verified timestamp
        pass

        # Fetch found item details to get face_embedding and rfid_uid
        face_embedding = None
        rfid_uid = None
        found_item_id = cdata.get('found_item_id')
        
        if found_item_id:
            try:
                # Prefer direct doc lookup; fallback to business-id field
                item_doc = db.collection('found_items').document(found_item_id).get()
                if not item_doc.exists:
                    q = db.collection('found_items').where('found_item_id', '==', found_item_id).limit(1)
                    results = list(q.stream())
                    item_doc = results[0] if results else None

                if item_doc and item_doc.exists:
                    item_data = item_doc.to_dict() or {}
                    face_embedding = item_data.get('face_embedding')
                    rfid_uid = item_data.get('rfid_uid')
            except Exception:
                # Non-blocking: proceed without item details on error
                pass

        return True, {
            'success': True,
            'valid': True,
            'claim_id': claim_id,
            'student_id': student_id,
            'expires_at': exp_dt.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'verification_method': cdata.get('verification_method'),
            'found_item_id': found_item_id,
            'claim_status': status_val,
            'face_embedding': face_embedding,
            'rfid_uid': rfid_uid
        }, 200
    except json.JSONDecodeError:
        return False, {'error': 'Invalid QR data: not JSON'}, 400
    except Exception as e:
        return False, {'error': str(e)}, 500

def verify_claim(user_id, item_id):
    """
    Placeholder for future claim verification logic. For now, allow.
    """
    return True, {"message": "Claim verified successfully"}

def _isoformat_or_none(dt) -> str | None:
    """Helper: convert Firestore datetime/epoch to ISO string with Z suffix."""
    try:
        if not dt:
            return None
        # Firestore returns datetime objects; sometimes epoch seconds are stored
        if isinstance(dt, datetime):
            # Ensure timezone awareness
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        # Fallback: epoch seconds
        return datetime.fromtimestamp(float(dt), tz=timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except Exception:
        return None

def list_user_claims(student_id: str, status: str = None, sort: str = 'newest', days_filter: int = None, start_date: str | None = None, end_date: str | None = None, page_size: int = 20, cursor_id: str | None = None):
    """
    List claims for a given student with lightweight item details.

    Args:
        student_id: The student ID to filter claims by
        status: Optional status filter (e.g., 'pending', 'completed')
        sort: Sort order ('newest', 'oldest', 'asc', 'desc')
        days_filter: Optional number of days to filter claims (e.g., 7 for last 7 days)

    Returns: (success: bool, response: dict, status_code: int)
      response: {
        'success': True,
        'claims': [
          {
            'id': str,                 # claim_id
            'status': str,             # e.g. 'Pending'
            'created_at': str | None,  # ISO 8601
            'approved_by': str | None,
            'verification_timestamp': str | None,
            'locker_id': str | None,
            'found_item_id': str | None,
            'item_name': str | None,
            'item_image_url': str | None,
            'is_valuable': bool | None,
          }
        ]
      }
    """
    try:
        if not student_id:
            return False, {'error': 'Missing student_id'}, 400

        if page_size is None or not isinstance(page_size, int) or page_size <= 0:
            page_size = 20
        page_size = min(page_size, 50)
        allowed_sorts = {'newest', 'oldest', 'asc', 'desc', 'latest'}
        if sort and str(sort).strip().lower() not in allowed_sorts:
            return False, {'error': 'Invalid sort value', 'allowed': sorted(list(allowed_sorts))}, 400

        if days_filter is not None:
            if not isinstance(days_filter, int) or days_filter <= 0:
                return False, {'error': 'Invalid days_filter: must be a positive integer'}, 400
            if days_filter > 365:
                return False, {'error': 'days_filter cannot exceed 365 days'}, 400

        start_dt = None
        end_dt = None
        if days_filter is not None:
            start_dt = datetime.now(timezone.utc) - timedelta(days=days_filter)
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
            except Exception:
                return False, {'error': 'Invalid start_date'}, 400
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
            except Exception:
                return False, {'error': 'Invalid end_date'}, 400
        if start_dt and end_dt and start_dt > end_dt:
            return False, {'error': 'start_date must be before end_date'}, 400

        query = db.collection('claims').where('student_id', '==', student_id)
        if status:
            query = query.where('status', '==', str(status).strip().lower())

        query = query.order_by('created_at', direction=firestore.Query.DESCENDING if (sort or 'newest').lower() in ('newest', 'desc', 'latest') else firestore.Query.ASCENDING)

        if start_dt:
            query = query.where('created_at', '>=', start_dt)
        if end_dt:
            query = query.where('created_at', '<=', end_dt)

        try:
            query = query.select(['claim_id', 'status', 'created_at', 'approved_by', 'locker_id', 'found_item_id', 'verified_at'])
        except Exception:
            pass

        if cursor_id:
            try:
                last_doc = db.collection('claims').document(cursor_id).get()
                if last_doc.exists:
                    query = query.start_after(last_doc)
            except Exception:
                pass

        try:
            docs = list(query.limit(page_size + 1).stream())
        except Exception as e:
            msg = str(e)
            if 'requires an index' in msg or 'FAILED_PRECONDITION' in msg:
                try:
                    # Fallback: load by student_id only, then filter/sort/paginate in Python
                    base_q = db.collection('claims').where('student_id', '==', student_id)
                    base_docs = list(base_q.stream())
                    # Convert to list of dicts with created_at
                    items = []
                    for d in base_docs:
                        data = d.to_dict() or {}
                        data['__id'] = d.id
                        items.append(data)
                    # Filter by status
                    if status:
                        items = [x for x in items if str(x.get('status','')).strip().lower() == str(status).strip().lower()]
                    # Filter by date range
                    def _to_dt(v):
                        try:
                            return v if isinstance(v, datetime) else datetime.fromisoformat(str(v).replace('Z','+00:00'))
                        except Exception:
                            return None
                    if start_dt:
                        items = [x for x in items if (_to_dt(x.get('created_at')) or datetime.min.replace(tzinfo=timezone.utc)) >= start_dt]
                    if end_dt:
                        items = [x for x in items if (_to_dt(x.get('created_at')) or datetime.max.replace(tzinfo=timezone.utc)) <= end_dt]
                    # Sort by created_at
                    reverse = ((sort or 'newest').lower() in ('newest','desc','latest'))
                    items.sort(key=lambda x: (_to_dt(x.get('created_at')) or datetime.min.replace(tzinfo=timezone.utc)), reverse=reverse)
                    # Pagination fallback (no cursor id available reliably): simple first page only
                    items = items[:page_size]
                    claims = []
                    for data in items:
                        raw_status = str(data.get('status', 'pending')).strip().lower()
                        status_title = raw_status.capitalize()
                        claim_id = data.get('claim_id') or data.get('__id')
                        found_item_id = data.get('found_item_id')
                        item_name = None
                        item_image_url = None
                        is_valuable = None
                        try:
                            if found_item_id:
                                item_doc = db.collection('found_items').document(found_item_id).get()
                                if item_doc and item_doc.exists:
                                    item_data = item_doc.to_dict() or {}
                                    item_name = item_data.get('found_item_name') or item_data.get('name')
                                    item_image_url = item_data.get('image_url') or (item_data.get('images', []) or [None])[0]
                                    is_valuable = bool(item_data.get('is_valuable') or item_data.get('valuable') or False)
                        except Exception:
                            pass
                        claims.append({
                            'id': claim_id,
                            'status': status_title,
                            'created_at': _isoformat_or_none(data.get('created_at')),
                            'approved_by': data.get('approved_by'),
                            'verification_timestamp': _isoformat_or_none(data.get('verified_at')),
                            'locker_id': data.get('locker_id'),
                            'found_item_id': found_item_id,
                            'item_name': item_name,
                            'item_image_url': item_image_url,
                            'is_valuable': is_valuable,
                        })
                    return True, {'success': True, 'claims': claims, 'pagination': {'page_size': page_size, 'next_cursor_id': None, 'returned_count': len(claims)}}, 200
                except Exception as e2:
                    import re
                    m = re.search(r'https://console\.firebase\.google\.com[^\s]+', msg)
                    return False, {
                        'error': 'Query requires a Firestore composite index',
                        'code': 'INDEX_REQUIRED',
                        'index_url': m.group(0) if m else None,
                        'details': str(e2)
                    }, 400
            return False, {'error': 'Failed to query Firestore', 'code': 'FIRESTORE_QUERY_ERROR', 'details': msg}, 500

        next_cursor_id = None
        if len(docs) > page_size:
            next_cursor_id = docs[-1].id
            docs = docs[:-1]

        claims = []
        for d in docs:
            data = d.to_dict() or {}
            raw_status = str(data.get('status', 'pending')).strip().lower()
            status_title = raw_status.capitalize()
            claim_id = data.get('claim_id', d.id)
            found_item_id = data.get('found_item_id')

            item_name = None
            item_image_url = None
            is_valuable = None
            try:
                if found_item_id:
                    item_ref = db.collection('found_items').document(found_item_id)
                    try:
                        item_query = item_ref
                        item_doc = item_query.get()
                    except Exception:
                        item_doc = item_ref.get()
                    if item_doc and item_doc.exists:
                        item_data = item_doc.to_dict() or {}
                        item_name = item_data.get('found_item_name') or item_data.get('name')
                        item_image_url = item_data.get('image_url') or (item_data.get('images', []) or [None])[0]
                        is_valuable = bool(item_data.get('is_valuable') or item_data.get('valuable') or False)
            except Exception:
                pass

            claims.append({
                'id': claim_id,
                'status': status_title,
                'created_at': _isoformat_or_none(data.get('created_at')),
                'approved_by': data.get('approved_by'),
                'verification_timestamp': _isoformat_or_none(data.get('verified_at')),
                'locker_id': data.get('locker_id'),
                'found_item_id': found_item_id,
                'item_name': item_name,
                'item_image_url': item_image_url,
                'is_valuable': is_valuable,
            })

        return True, {'success': True, 'claims': claims, 'pagination': {'page_size': page_size, 'next_cursor_id': next_cursor_id, 'returned_count': len(claims)}}, 200
    except Exception as e:
        _logger.error('Error listing claims for user=%s: %s', student_id, str(e))
        return False, {'error': str(e)}, 500

def cancel_claim(claim_id: str, student_id: str):
    """
    Cancel a claim initiated by the given student.
    Only pending claims can be cancelled by the student.

    Returns: (success: bool, response: dict, status_code: int)
    """
    try:
        if not claim_id or not student_id:
            return False, {'error': 'Missing claim_id or student_id'}, 400

        claim_ref = db.collection('claims').document(claim_id)
        claim_doc = claim_ref.get()
        if not claim_doc.exists:
            return False, {'error': 'Claim not found'}, 404

        data = claim_doc.to_dict() or {}
        if data.get('student_id') != student_id:
            return False, {'error': 'Forbidden: claim does not belong to user'}, 403

        status = str(data.get('status', '')).lower()
        if status != 'pending':
            return False, {'error': f'Cannot cancel claim in status "{data.get("status")}"'}, 409

        now_utc = datetime.now(timezone.utc)
        claim_ref.update({
            'status': 'cancelled',
            'cancelled_at': now_utc,
            'cancelled_by': student_id,
        })

        _logger.info('Claim %s cancelled by user %s', claim_id, student_id)
        return True, {'success': True, 'message': 'Claim cancelled'}, 200
    except Exception as e:
        _logger.error('Error cancelling claim %s by user %s: %s', claim_id, student_id, str(e))
        return False, {'error': str(e)}, 500
def _create_notification(user_id: str, title: str, message: str, link: str, ntype: str):
    try:
        ref = db.collection('notifications').document()
        now = datetime.now(timezone.utc)
        ref.set({
            'notification_id': ref.id,
            'user_id': user_id,
            'title': title,
            'message': message,
            'link': link,
            'is_read': False,
            'timestamp': now,
            'type': ntype
        })
    except Exception:
        pass

def _queue_trigger_email(student_id: str, subject: str, html: str, text: str = None):
    try:
        if not student_id or not subject or not html:
            return False
        uref = db.collection('users').document(student_id)
        ud = uref.get()
        if not ud.exists:
            return False
        email = (ud.to_dict() or {}).get('email')
        if not email:
            return False
        ok = send_email(email, subject, html=html, text=text)
        if ok:
            _logger.info('Email sent to %s: %s', email, subject)
        else:
            _logger.warning('Email send failed for %s: %s', email, subject)
        return ok
    except Exception:
        return False

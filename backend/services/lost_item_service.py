"""
Lost item service for handling lost item reports and basic user-related helpers.
Includes image validation, AI tags generation, and Firestore persistence.
"""
import os
import base64
import uuid
from datetime import datetime
from firebase_admin import firestore
from ..database import db
from .image_validation_service import ImageValidationService

# Helper: generate next lost item ID (LI0001, LI0002, ...)
def generate_lost_item_id():
    """
    Generate a unique ID for a new lost item report.
    Returns: str in the format LIXXXX
    """
    # Query the last lost item to get its ID
    lost_items = db.collection('lost_items').order_by('lost_item_id', direction=firestore.Query.DESCENDING).limit(1).stream()
    last_id = None
    for item in lost_items:
        try:
            item_data = item.to_dict()
            last_id = item_data.get('lost_item_id')
        except Exception:
            last_id = None
        break
    if not last_id:
        return 'LI0001'
    # Extract numeric part and increment
    try:
        numeric_part = int(str(last_id)[2:])
    except Exception:
        numeric_part = 0
    next_numeric = numeric_part + 1
    return f"LI{next_numeric:04d}"

def create_lost_item(data, image_file, user_id, upload_folder):
    """
    Create a new lost item report.
    Mirrors the validation and image handling used in create_found_item.

    Args:
        data (dict): Form data containing report details
        image_file (FileStorage): The uploaded image file
        user_id (str): ID of the reporting user
        upload_folder (str): Path to temporary upload folder

    Returns:
        tuple: (success: bool, response: dict, status_code: int)
    """
    try:
        if not image_file:
            return False, {"error": "Image file is required"}, 400

        # Validate image file using saved temp path
        validation_service = ImageValidationService()
        filename = f"{uuid.uuid4()}.{image_file.filename.split('.')[-1]}"
        temp_path = os.path.join(upload_folder, filename)
        image_file.save(temp_path)

        result = validation_service.validate_image_file(
            temp_path,
            file_size=getattr(image_file, 'content_length', None),
            mime_type=getattr(image_file, 'mimetype', None)
        )
        if not result.get('success', True):
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return False, {
                'error': 'Image validation failed',
                'details': result.get('errors', []),
                'warnings': result.get('warnings', [])
            }, 400

        # Import here to avoid circular imports
        from .image_service import generate_tags

        # Generate tags using AI and extract only the tag list
        ai_result = generate_tags(temp_path)
        ai_tags = []
        try:
            ai_tags = (ai_result or {}).get('tags', []) if isinstance(ai_result, dict) else (ai_result or [])
        except Exception:
            ai_tags = []
        # Use user-provided tags if present; otherwise fallback to AI tags
        user_tags_raw = data.get('tags')
        tags = []
        if user_tags_raw:
            try:
                import re
                tags = [t.strip('# ').lower() for t in re.split(r'[\s,]+', str(user_tags_raw)) if t.strip()]
                # Deduplicate while keeping order
                tags = list(dict.fromkeys(tags))
            except Exception:
                tags = []
        if not tags:
            tags = ai_tags

        # Compress and encode image to base64
        from PIL import Image
        import io
        with Image.open(temp_path) as img:
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            # Resize if too large (max 800px on longest side)
            max_size = 800
            if max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='JPEG', quality=85, optimize=True)
            img_data = base64.b64encode(img_buffer.getvalue()).decode('utf-8')

        # Clean up temp file
        try:
            os.remove(temp_path)
        except Exception:
            pass

        # Generate business ID and prepare fields
        lost_item_id = generate_lost_item_id()

        # Boolean fields
        is_valuable_raw = data.get('is_valuable', False)
        is_valuable = is_valuable_raw if isinstance(is_valuable_raw, bool) else str(is_valuable_raw).lower() == 'true'

        # Parse date_lost if provided (YYYY-MM-DD)
        date_lost_str = data.get('date_lost') or data.get('time_lost')
        date_lost_value = None
        if date_lost_str:
            try:
                # Prefer date-only; fallback to datetime ISO
                if 'T' in str(date_lost_str):
                    date_lost_value = datetime.fromisoformat(str(date_lost_str))
                else:
                    # Parse as date; store as datetime at midnight
                    date_only = datetime.strptime(str(date_lost_str), '%Y-%m-%d')
                    date_lost_value = date_only
            except Exception:
                date_lost_value = firestore.SERVER_TIMESTAMP
        else:
            date_lost_value = firestore.SERVER_TIMESTAMP

        # Create lost item document (aligns with admin routes expectations)
        lost_item_doc = {
            'lost_item_id': lost_item_id,
            'reported_by': user_id,
            'category': data.get('category', ''),
            'item_name': data.get('lost_item_name', '') or data.get('item_name', ''),
            'lost_item_name': data.get('lost_item_name', '') or data.get('item_name', ''),  # duplicate for frontend compatibility
            'description': data.get('description', ''),
            'image_url': f"data:image/jpeg;base64,{img_data}",
            'tags': tags,
            'place_lost': data.get('place_lost', ''),
            'date_lost': date_lost_value,
            'time_lost': date_lost_value,  # keep both for schema compatibility
            'is_valuable': is_valuable,
            'remarks': data.get('remarks', None),
            'status': 'Open',
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        }

        # Persist to Firestore under business ID
        db.collection('lost_items').document(lost_item_id).set(lost_item_doc)

        return True, {
            'success': True,
            'message': 'Lost item report submitted successfully',
            'lost_item_id': lost_item_id
        }, 201

    except Exception as e:
        return False, {'error': str(e)}, 500

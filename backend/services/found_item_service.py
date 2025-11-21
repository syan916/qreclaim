"""Found item service for handling found item CRUD operations.
This service can be used by both admin and regular users."""
import os
import base64
import uuid
from datetime import datetime, timedelta
from flask import request, jsonify, current_app
from firebase_admin import firestore
from ..database import db
import time
from firebase_admin import firestore as fb_fs

_stats_cache = {'data': None, 'ts': 0}
_activities_cache = {'data': None, 'ts': 0}
from .image_validation_service import ImageValidationService

def get_dashboard_statistics():
    """
    Get dashboard statistics for admin panel.
    
    Returns:
        dict: Dictionary containing various statistics
    """
    try:
        now = time.time()
        if _stats_cache['data'] and now - _stats_cache['ts'] < 60:
            return _stats_cache['data']

        claims_ref = db.collection('claims')
        lost_items_ref = db.collection('lost_items')
        found_items_ref = db.collection('found_items')

        def _count(q):
            try:
                agg = q.count()
                res = agg.get()
                return res[0].value
            except Exception:
                return len(list(q.select(['status']).stream()))

        qr_requests_count = _count(claims_ref.where('status', '==', 'pending'))
        lost_items_count = _count(lost_items_ref.where('status', '==', 'open'))
        found_items_count = _count(found_items_ref)
        claimed_items_count = _count(claims_ref.where('status', '==', 'approved'))

        data = {
            'qr_requests_count': qr_requests_count,
            'lost_items_count': lost_items_count,
            'found_items_count': found_items_count,
            'claimed_items_count': claimed_items_count
        }
        _stats_cache['data'] = data
        _stats_cache['ts'] = now
        return data
    except Exception:
        return {
            'qr_requests_count': 0,
            'lost_items_count': 0,
            'found_items_count': 0,
            'claimed_items_count': 0
        }

def get_recent_activities(limit=5):
    """
    Get recent activities for admin dashboard.
    
    Args:
        limit (int): Number of recent activities to return
        
    Returns:
        list: List of recent activities
    """
    try:
        now = time.time()
        if _activities_cache['data'] and now - _activities_cache['ts'] < 30:
            return _activities_cache['data'][:limit]

        recent_activities = []

        found_items_ref = db.collection('found_items')
        lost_items_ref = db.collection('lost_items')
        claims_ref = db.collection('claims')

        recent_found_items = list(found_items_ref.order_by('created_at', direction=fb_fs.Query.DESCENDING).limit(3).stream())
        recent_lost_items = list(lost_items_ref.order_by('created_at', direction=fb_fs.Query.DESCENDING).limit(3).stream())
        recent_qr_requests = list(claims_ref.order_by('created_at', direction=fb_fs.Query.DESCENDING).limit(3).stream())

        user_ids = set()
        for item in recent_found_items:
            d = item.to_dict() or {}
            uid = d.get('uploaded_by')
            if uid:
                user_ids.add(uid)
        for item in recent_lost_items:
            d = item.to_dict() or {}
            uid = d.get('reported_by')
            if uid:
                user_ids.add(uid)
        for req in recent_qr_requests:
            d = req.to_dict() or {}
            uid = d.get('student_id')
            if uid:
                user_ids.add(uid)

        users_map = {}
        ids_list = list(user_ids)
        if ids_list:
            try:
                CHUNK = 10
                for i in range(0, len(ids_list), CHUNK):
                    chunk = ids_list[i:i+CHUNK]
                    q = db.collection('users').where(fb_fs.FieldPath.document_id(), 'in', chunk)
                    for udoc in q.stream():
                        users_map[udoc.id] = (udoc.to_dict() or {}).get('name') or 'Unknown'
            except Exception:
                for uid in ids_list:
                    try:
                        doc = db.collection('users').document(uid).get()
                        if doc.exists:
                            users_map[uid] = (doc.to_dict() or {}).get('name') or 'Unknown'
                    except Exception:
                        users_map[uid] = 'Unknown'

        def fmt(dt):
            try:
                return dt.strftime("%d %b %Y, %H:%M") if dt else "Unknown"
            except Exception:
                return "Unknown"

        def ts(dt):
            try:
                return dt.timestamp() if dt else 0
            except Exception:
                return 0

        for item in recent_found_items:
            d = item.to_dict() or {}
            admin_id = d.get('uploaded_by')
            admin_name = users_map.get(admin_id) or 'Unknown'
            recent_activities.append({
                'type': 'found',
                'title': f"New Found Item: {d.get('found_item_name')}",
                'description': f"Posted by {admin_name}",
                'time': fmt(d.get('created_at')),
                '_ts': ts(d.get('created_at'))
            })

        for item in recent_lost_items:
            d = item.to_dict() or {}
            student_id = d.get('reported_by')
            student_name = users_map.get(student_id) or 'Unknown'
            recent_activities.append({
                'type': 'lost',
                'title': f"New Lost Report: {d.get('lost_item_name')}",
                'description': f"Reported by {student_name}",
                'time': fmt(d.get('created_at')),
                '_ts': ts(d.get('created_at'))
            })

        for req in recent_qr_requests:
            d = req.to_dict() or {}
            student_id = d.get('student_id')
            student_name = users_map.get(student_id) or 'Unknown'
            recent_activities.append({
                'type': 'qr',
                'title': f"New QR Request: {req.id}",
                'description': f"Requested by {student_name}",
                'time': fmt(d.get('created_at')),
                '_ts': ts(d.get('created_at'))
            })

        recent_activities.sort(key=lambda x: x.get('_ts') or 0, reverse=True)
        recent_activities = recent_activities[:limit]
        _activities_cache['data'] = recent_activities
        _activities_cache['ts'] = now
        return recent_activities
    except Exception:
        return []

# Helper function to generate the next found item ID
def generate_found_item_id():
    """
    Generate a unique ID for a new found item.
    
    Returns:
        str: A unique found item ID in the format FIXXXX
    """
    # Query the last found item to get its ID
    found_items = db.collection('found_items').order_by('found_item_id', direction=firestore.Query.DESCENDING).limit(1).stream()
    
    last_id = None
    for item in found_items:
        last_id = item.get('found_item_id')
        break
    
    if not last_id:
        # If no found items exist yet, start with FI0001
        return "FI0001"
    
    # Extract the numeric part and increment
    numeric_part = int(last_id[2:])
    next_numeric = numeric_part + 1
    
    # Format back to FIXXXX format
    return f"FI{next_numeric:04d}"


def create_found_item(data, image_file, user_id, upload_folder):
    """
    Create a new found item record.
    
    Args:
        data (dict): Form data containing item details
        image_file: The uploaded image file
        user_id (str): ID of the user creating the record
        upload_folder (str): Path to temporary upload folder
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        # Validate image file using a saved temp path (dict-based return)
        validation_service = ImageValidationService()
        
        # Generate a unique filename and save temporarily
        filename = f"{uuid.uuid4()}.{image_file.filename.split('.')[-1]}"
        temp_path = os.path.join(upload_folder, filename)
        image_file.save(temp_path)
        
        # Perform validation with file path, size, and MIME type when available
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
        
        # Generate AI suggestions only as a fallback; do not force-merge
        ai_result = generate_tags(temp_path)
        ai_tag_list = []
        try:
            ai_tag_list = (ai_result or {}).get('tags', []) if isinstance(ai_result, dict) else (ai_result or [])
        except Exception:
            ai_tag_list = []
        
        # Compress and encode image to base64 (with size optimization)
        from PIL import Image
        import io
        
        # Open and compress the image
        with Image.open(temp_path) as img:
            # Convert to RGB if necessary (for JPEG compatibility)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            
            # Resize if too large (max 800px on longest side)
            max_size = 800
            if max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            # Save to bytes with compression
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='JPEG', quality=85, optimize=True)
            img_data = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        
        # Clean up the temporary file
        os.remove(temp_path)
        
        # Generate a new found item ID
        found_item_id = generate_found_item_id()
        
        # Helper to robustly coerce values to boolean
        def _to_bool(value, default=False):
            if isinstance(value, bool):
                return value
            if value is None:
                return default
            val = str(value).strip().lower()
            return val in ('true', '1', 'yes', 'on')

        # Process boolean fields - handle both string and boolean values
        is_valuable = _to_bool(data.get('is_valuable', False), False)
        
        # Use the correct field name expected from the route: is_assigned_to_locker
        is_assigned_to_locker_flag = _to_bool(data.get('is_assigned_to_locker', False), False)
        
        # Process locker assignment consistently
        locker_id = data.get('locker_id', '') if is_assigned_to_locker_flag else ''
        is_assigned_to_locker = bool(locker_id) and is_assigned_to_locker_flag
        
        # Process time_found - convert from datetime-local format to Firestore timestamp
        time_found_str = data.get('time_found')
        time_found_timestamp = None
        if time_found_str:
            try:
                # Parse the datetime-local format (YYYY-MM-DDTHH:MM)
                from datetime import datetime
                time_found_dt = datetime.fromisoformat(time_found_str)
                time_found_timestamp = time_found_dt
            except (ValueError, TypeError):
                # Fallback to server timestamp if parsing fails
                time_found_timestamp = firestore.SERVER_TIMESTAMP
        else:
            time_found_timestamp = firestore.SERVER_TIMESTAMP
        
        # Use frontend-selected tags if provided; otherwise fall back to AI suggestions
        manual_tags_raw = data.get('tags', [])
        manual_tags = []
        if isinstance(manual_tags_raw, list):
            manual_tags = manual_tags_raw
        elif isinstance(manual_tags_raw, str):
            try:
                import json
                parsed = json.loads(manual_tags_raw)
                if isinstance(parsed, list):
                    manual_tags = parsed
            except Exception:
                manual_tags = []

        # Normalize tags: remove leading '#', trim, and drop empties
        def _clean_tag(t):
            try:
                return t.lstrip('#').strip()
            except Exception:
                return ''

        cleaned_manual = [_clean_tag(t) for t in manual_tags if isinstance(t, str)]
        cleaned_ai = [_clean_tag(t) for t in ai_tag_list if isinstance(t, str)]
        combined_tags = []
        seen = set()
        source_list = cleaned_manual if cleaned_manual else cleaned_ai
        for t in source_list:
            if t and t not in seen:
                seen.add(t)
                combined_tags.append(t)

        # Create the found item document (matching data.sql schema exactly)
        found_item = {
            "found_item_id": found_item_id,
            "uploaded_by": user_id,
            "locker_id": locker_id if locker_id else None,
            "category": data.get('category', ''),
            "found_item_name": data.get('found_item_name', ''),
            "description": data.get('description', ''),
            "image_url": f"data:image/jpeg;base64,{img_data}",  # Store as base64 data URL
            "tags": combined_tags,  # Keep tags without # prefix to match schema
            "place_found": data.get('place_found', ''),
            "time_found": time_found_timestamp,
            "is_valuable": is_valuable,
            "is_assigned_to_locker": is_assigned_to_locker,
            "remarks": data.get('remarks', None),
            "status": "unclaimed",
            "created_at": firestore.SERVER_TIMESTAMP
        }
        
        # Save to Firestore
        db.collection("found_items").document(found_item_id).set(found_item)
        
        # If assigned to a locker, update the locker status
        if locker_id:
            db.collection("lockers").document(locker_id).update({
                "status": "occupied",
                "assigned_item_id": found_item_id,  # Match data.sql schema
                "last_updated": firestore.SERVER_TIMESTAMP
            })
        
        return True, {
            'success': True,
            'message': 'Found item created successfully',
            'found_item_id': found_item_id
        }, 201
        
    except Exception as e:
        return False, {'error': str(e)}, 500

def get_found_items_paginated(page=1, per_page=10, search='', category_filter='', status_filter='', location_filter='', sort_by='created_at', sort_order='desc'):
    """
    Get paginated found items with filtering and search capabilities.
    Default sorting: newest first (created_at DESC)
    Manual sorting: proper order based on user selection (e.g., ID ASC shows FI0001, FI0002...)
    
    Args:
        page (int): Page number (1-based)
        per_page (int): Number of items per page
        search (str): Search term for item name, description, category, place_found, and tags
        category_filter (str): Filter by category
        status_filter (str): Filter by status
        location_filter (str): Filter by location
        sort_by (str): Field to sort by
        sort_order (str): Sort order ('asc' or 'desc')
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        from firebase_admin import firestore
        
        # Check if this is default sorting (created_at DESC) or manual sorting
        is_default_sort = (sort_by == 'created_at' and sort_order == 'desc')
        
        found_items_ref = db.collection('found_items')
        
        if is_default_sort:
            # For default sorting, use server-side ordering by created_at DESC
            server_query = found_items_ref.order_by('created_at', direction=firestore.Query.DESCENDING)
        else:
            # For manual sorting, get all documents without server-side ordering to avoid index issues
            server_query = found_items_ref
        
        # Get all documents from server
        all_docs = list(server_query.stream())
        
        # Apply client-side filtering
        filtered_docs = []
        for doc in all_docs:
            data = doc.to_dict()
            should_include = True
            
            # Apply status filter
            if status_filter and should_include:
                if data.get('status') != status_filter:
                    should_include = False
            
            # Apply category filter
            if category_filter and should_include:
                if data.get('category') != category_filter:
                    should_include = False
            
            # Apply location filter
            if location_filter and should_include:
                if data.get('place_found') != location_filter:
                    should_include = False
            
            # Apply search filter
            if search and should_include:
                search_lower = search.lower()
                tags_text = ' '.join(data.get('tags', [])) if data.get('tags') else ''
                searchable_text = f"{data.get('found_item_name', '')} {data.get('description', '')} {data.get('category', '')} {data.get('place_found', '')} {tags_text}".lower()
                if search_lower not in searchable_text:
                    should_include = False
            
            if should_include:
                filtered_docs.append(doc)
        
        # Apply client-side sorting for manual sorting
        if not is_default_sort:
            def get_sort_key(doc):
                data = doc.to_dict()
                value = data.get(sort_by)
                
                # Handle different data types for sorting
                if value is None:
                    return '' if sort_by in ['found_item_name', 'category', 'place_found', 'status', 'found_item_id'] else 0
                
                # Convert timestamps to comparable format
                if hasattr(value, 'timestamp'):
                    return value.timestamp()
                
                # Handle status-based ordering: non-final status before final status
                if sort_by == 'status':
                    final_statuses = ['claimed', 'overdue', 'disposed']
                    is_final = str(value).lower() in final_statuses
                    # Return tuple: (is_final, status_value) for proper ordering
                    return (is_final, str(value).lower())
                
                # Handle ID sorting properly (FI0001, FI0002, etc.)
                if sort_by == 'found_item_id':
                    # Extract numeric part for proper sorting
                    import re
                    match = re.search(r'(\d+)', str(value))
                    if match:
                        return int(match.group(1))
                    return 0
                
                return str(value).lower() if isinstance(value, str) else value
            
            reverse_sort = (sort_order == 'desc')
            filtered_docs.sort(key=get_sort_key, reverse=reverse_sort)
        
        # Calculate pagination
        total_items = len(filtered_docs)
        total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        
        # Get items for current page
        page_docs = filtered_docs[start_index:end_index]
        
        # Format items for response
        found_items = []
        current_time = datetime.now()
        
        for doc in page_docs:
            data = doc.to_dict()
            
            # Auto-check and update overdue status (fast processing)
            time_found = data.get('time_found')
            storage_duration_days = 0
            current_status = data.get('status', 'unclaimed')
            
            if time_found:
                # Handle different timestamp formats for time_found
                found_date = None
                if hasattr(time_found, 'timestamp'):
                    # Firestore timestamp
                    found_date = datetime.fromtimestamp(time_found.timestamp())
                elif isinstance(time_found, datetime):
                    # datetime object
                    found_date = time_found
                else:
                    # Try to parse as string
                    try:
                        found_date = datetime.fromisoformat(str(time_found))
                    except:
                        pass
                
                if found_date:
                    # Calculate storage duration in days
                    storage_duration_days = (current_time - found_date).days
                    
                    # Auto-update to overdue if unclaimed and > 31 days
                    if current_status == 'unclaimed' and storage_duration_days > 31:
                        current_status = 'overdue'
                        # Update in database (fast operation)
                        try:
                            doc.reference.update({'status': 'overdue'})
                        except:
                            pass  # Continue if update fails
            
            # Get admin name
            admin_name = "Unknown Admin"
            if data.get('uploaded_by'):
                try:
                    admin_doc = db.collection('users').document(data['uploaded_by']).get()
                    if admin_doc.exists:
                        admin_name = admin_doc.to_dict().get('name', 'Unknown Admin')
                except:
                    pass
            
            # Format the item
            item = {
                'found_item_id': data.get('found_item_id', doc.id),
                'found_item_name': data.get('found_item_name', ''),
                'category': data.get('category', ''),
                'place_found': data.get('place_found', ''),
                'time_found': data.get('time_found'),
                'storage_duration_days': storage_duration_days,
                'image_url': data.get('image_url', ''),
                'status': current_status,  # Use updated status
                'uploaded_by': admin_name,
                'created_at': data.get('created_at'),
                'locker_id': data.get('locker_id', ''),
                'tags': data.get('tags', []),
                'is_valuable': data.get('is_valuable', False),
                'is_assigned_to_locker': data.get('is_assigned_to_locker', False),
                'remarks': data.get('remarks', '')
            }
            found_items.append(item)
        
        # Get unique categories and locations for filter options
        all_items = list(db.collection('found_items').stream())
        
        categories = set()
        locations = set()
        for doc in all_items:
            data = doc.to_dict()
            if data.get('category'):
                categories.add(data['category'])
            if data.get('place_found'):
                locations.add(data['place_found'])
        
        response_data = {
            'found_items': found_items,
            'pagination': {
                'current_page': page,
                'total_pages': total_pages,
                'total_items': total_items,
                'per_page': per_page,
                'has_next': page < total_pages,
                'has_prev': page > 1
            },
            'filters': {
                'categories': sorted(list(categories)),
                'locations': sorted(list(locations))
            }
        }
        
        return True, response_data, 200
    
    except Exception as e:
        return False, {'error': f'Server error: {str(e)}'}, 500


def get_found_item_details(item_id):
    """
    Get detailed information for a specific found item.
    
    Args:
        item_id (str): ID of the found item
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        # Get the found item document
        found_item_doc = db.collection('found_items').document(item_id).get()
        
        if not found_item_doc.exists:
            return False, {'error': 'Found item not found'}, 404
        
        data = found_item_doc.to_dict()
        
        # Get admin name who uploaded the item
        admin_name = "Unknown Admin"
        admin_email = ""
        if data.get('uploaded_by'):
            try:
                admin_doc = db.collection('users').document(data['uploaded_by']).get()
                if admin_doc.exists:
                    admin_data = admin_doc.to_dict()
                    admin_name = admin_data.get('name', 'Unknown Admin')
                    admin_email = admin_data.get('email', '')
            except:
                pass
        
        # Get claim information if item is claimed
        claim_info = None
        if data.get('status') == 'claimed' and data.get('claimed_by'):
            try:
                claimer_doc = db.collection('users').document(data['claimed_by']).get()
                if claimer_doc.exists:
                    claimer_data = claimer_doc.to_dict()
                    claim_info = {
                        'claimer_name': claimer_data.get('name', 'Unknown User'),
                        'claimer_email': claimer_data.get('email', ''),
                        'claimed_at': data.get('claimed_at'),
                        'verification_method': data.get('verification_method', 'Not specified')
                    }
            except:
                pass
        
        # Format the detailed item information
        item_details = {
            'found_item_id': data.get('found_item_id', item_id),
            'found_item_name': data.get('found_item_name', ''),
            'category': data.get('category', ''),
            'description': data.get('description', ''),
            'place_found': data.get('place_found', ''),
            'time_found': data.get('time_found'),
            'image_url': data.get('image_url', ''),
            'status': data.get('status', 'unclaimed'),
            'uploaded_by': admin_name,
            'uploaded_by_email': admin_email,
            'created_at': data.get('created_at'),
            'locker_id': data.get('locker_id', ''),
            'tags': data.get('tags', []),
            'is_valuable': data.get('is_valuable', False),
            'is_assigned_to_locker': data.get('is_assigned_to_locker', False),
            'remarks': data.get('remarks', ''),
            'claim_info': claim_info,
            'rfid_tag': data.get('rfid_tag', ''),
            'color': data.get('color', ''),
            'brand': data.get('brand', ''),
            'model': data.get('model', ''),
            'serial_number': data.get('serial_number', ''),
            'additional_notes': data.get('additional_notes', '')
        }
        
        return True, {'item': item_details}, 200
    
    except Exception as e:
        return False, {'error': f'Server error: {str(e)}'}, 500


def get_found_item(found_item_id):
    """
    Get a found item by ID.
    
    Args:
        found_item_id (str): ID of the found item
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        doc_ref = db.collection("found_items").document(found_item_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return False, {'error': 'Found item not found'}, 404
            
        found_item = doc.to_dict()
        return True, found_item, 200
        
    except Exception as e:
        return False, {'error': str(e)}, 500

def update_found_item(found_item_id, data, image_file=None, upload_folder=None):
    """
    Update a found item record.
    
    Args:
        found_item_id (str): ID of the found item to update
        data (dict): Form data containing updated item details
        image_file: The uploaded image file (optional)
        upload_folder (str): Path to temporary upload folder (required if image_file is provided)
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        # Get the found item document
        doc_ref = db.collection("found_items").document(found_item_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return False, {'error': 'Found item not found'}, 404
            
        # Get the current found item data
        current_data = doc.to_dict()
        
        # Process image if provided
        if image_file and upload_folder:
            # Validate image file using saved temp path and dict-based return
            validation_service = ImageValidationService()
            
            # Generate a unique filename and save temporarily
            filename = f"{uuid.uuid4()}.{image_file.filename.split('.')[-1]}"
            temp_path = os.path.join(upload_folder, filename)
            image_file.save(temp_path)
            
            # Perform validation with file path, size, and MIME type when available
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
            tags = []
            try:
                tags = (ai_result or {}).get('tags', []) if isinstance(ai_result, dict) else (ai_result or [])
            except Exception:
                tags = []
            
            # Compress and encode image to base64 (with size optimization)
            from PIL import Image
            import io
            
            # Open and compress the image
            with Image.open(temp_path) as img:
                # Convert to RGB if necessary (for JPEG compatibility)
                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGB')
                
                # Resize if too large (max 800px on longest side)
                max_size = 800
                if max(img.size) > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                
                # Save to bytes with compression
                img_buffer = io.BytesIO()
                img.save(img_buffer, format='JPEG', quality=85, optimize=True)
                img_data = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
            
            # Clean up the temporary file
            os.remove(temp_path)
            
            # Update image and tags (matching data.sql schema)
            current_data['image_url'] = f"data:image/jpeg;base64,{img_data}"
            current_data['tags'] = tags  # Keep tags without # prefix to match schema
        
        # Helper to robustly coerce values to boolean
        def _to_bool(value, default=False):
            if isinstance(value, bool):
                return value
            if value is None:
                return default
            val = str(value).strip().lower()
            return val in ('true', '1', 'yes', 'on')

        # Process boolean fields
        is_valuable = _to_bool(data.get('is_valuable', current_data.get('is_valuable', False)), False)
        # Use the correct field name expected from the route: is_assigned_to_locker
        is_assigned_to_locker_flag = _to_bool(data.get('is_assigned_to_locker', current_data.get('is_assigned_to_locker', False)), False)
        
        # Process time_found - convert from datetime-local format to datetime object (consistent with create)
        time_found_str = data.get('time_found')
        time_found_timestamp = None
        if time_found_str:
            try:
                # Parse the datetime-local format (YYYY-MM-DDTHH:MM)
                from datetime import datetime
                time_found_dt = datetime.fromisoformat(time_found_str)
                time_found_timestamp = time_found_dt
            except (ValueError, TypeError):
                # Keep the current value if parsing fails
                time_found_timestamp = current_data.get('time_found')
        else:
            # Keep the current value if no new time_found provided
            time_found_timestamp = current_data.get('time_found')
        
        # Process locker assignment
        new_locker_id = data.get('locker_id', '') if is_assigned_to_locker_flag else ''
        old_locker_id = current_data.get('locker_id')
        
        # Update fields
        update_data = {
            "category": data.get('category', current_data.get('category', '')),
            "found_item_name": data.get('found_item_name', current_data.get('found_item_name', '')),
            "description": data.get('description', current_data.get('description', '')),
            "place_found": data.get('place_found', current_data.get('place_found', '')),
            "time_found": time_found_timestamp,
            "is_valuable": is_valuable,
            "remarks": data.get('remarks', current_data.get('remarks')),
        }
        
        # Handle locker reassignment
        if new_locker_id != old_locker_id:
            # If removing from a locker
            if old_locker_id and not new_locker_id:
                update_data["locker_id"] = None
                update_data["is_assigned_to_locker"] = False
                # Remove stored_in_locker field as it's not in data.sql schema
                
                # Update old locker status
                db.collection("lockers").document(old_locker_id).update({
                    "status": "available",
                    "assigned_item_id": None,  # Match data.sql schema
                    "last_updated": firestore.SERVER_TIMESTAMP
                })
                
            # If assigning to a new locker
            elif new_locker_id:
                update_data["locker_id"] = new_locker_id
                update_data["is_assigned_to_locker"] = True
                # Remove stored_in_locker field as it's not in data.sql schema
                
                # Update new locker status
                db.collection("lockers").document(new_locker_id).update({
                    "status": "occupied",
                    "assigned_item_id": found_item_id,  # Match data.sql schema
                    "last_updated": firestore.SERVER_TIMESTAMP
                })
                
                # If there was an old locker, update it too
                if old_locker_id:
                    db.collection("lockers").document(old_locker_id).update({
                        "status": "available",
                        "assigned_item_id": None,  # Match data.sql schema
                        "last_updated": firestore.SERVER_TIMESTAMP
                    })
        
        # Update the found item
        doc_ref.update(update_data)
        
        return True, {
            'success': True,
            'message': 'Found item updated successfully'
        }, 200
        
    except Exception as e:
        return False, {'error': str(e)}, 500

def delete_found_item(found_item_id):
    """
    Delete a found item record.
    
    Args:
        found_item_id (str): ID of the found item to delete
        
    Returns:
        tuple: (success, response_data, status_code)
    """
    try:
        # Get the found item document
        doc_ref = db.collection("found_items").document(found_item_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return False, {'error': 'Found item not found'}, 404
            
        found_item = doc.to_dict()
        
        # If the item is assigned to a locker, update the locker status
        if found_item.get('locker_id'):
            db.collection("lockers").document(found_item['locker_id']).update({
                "status": "available",
                "assigned_item_id": None,  # Match data.sql schema
                "last_updated": firestore.SERVER_TIMESTAMP
            })
        
        # Delete the found item
        doc_ref.delete()
        
        return True, {
            'success': True,
            'message': 'Found item deleted successfully'
        }, 200
        
    except Exception as e:
        return False, {'error': str(e)}, 500

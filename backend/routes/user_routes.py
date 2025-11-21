from flask import Blueprint, render_template, redirect, url_for, session, jsonify, request, current_app
from firebase_admin import firestore
from datetime import datetime, timezone
from ..auth import is_authenticated, is_student, student_required
from ..database import db
from ..services.user_service import get_user_profile
from ..services.lost_item_service import create_lost_item
from ..services.image_service import generate_tags
from ..services.found_item_service import get_found_item_details
from ..services.claim_service import (
    start_claim,
    save_face_image_for_claim,
    set_verification_method,
    generate_claim_qr,
    finalize_claim,
    get_qr_status_for_item,
    get_qr_status_for_user_item,
    get_user_claim_status_for_item,
    check_user_global_claim_status,
    validate_admin_status_for_approval,
    list_user_claims,
    cancel_claim,
)
from ..services.claim_validation_service import ClaimValidationService

user_bp = Blueprint('user', __name__, url_prefix='/user')

@user_bp.route('/api/notifications/count', methods=['GET'])
def get_notification_count():
    """API endpoint to get unread notification count for current user"""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401
        
        # Query notifications collection for unread notifications for current user
        notifications_ref = db.collection('notifications')
        query = notifications_ref.where('user_id', '==', user_id).where('is_read', '==', False)
        unread_notifications = list(query.stream())
        if not unread_notifications:
            legacy_q = notifications_ref.where('recipient_id', '==', user_id).where('read', '==', False)
            unread_notifications = list(legacy_q.stream())
        count = len(unread_notifications)
        
        return jsonify({
            'success': True,
            'count': count
        }), 200
        
    except Exception as e:
        print(f"Error getting notification count: {str(e)}")
        return jsonify({'error': 'Failed to get notification count'}), 500

@user_bp.route('/api/notifications/list', methods=['GET'])
def list_notifications():
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401
        limit = int(request.args.get('limit', 50))
        days = int(request.args.get('days', 30))
        if limit < 1 or limit > 200:
            limit = 50
        if days < 1 or days > 180:
            days = 30
        from datetime import datetime, timedelta, timezone
        since = datetime.now(timezone.utc) - timedelta(days=days)
        ref = db.collection('notifications')
        q = ref.where('user_id', '==', user_id).where('timestamp', '>=', since).order_by('timestamp', direction=firestore.Query.DESCENDING).limit(limit)
        docs = list(q.stream())
        items = []
        for d in docs:
            data = d.to_dict() or {}
            items.append({
                'notificationId': data.get('notification_id', d.id),
                'userId': data.get('user_id'),
                'title': data.get('title'),
                'message': data.get('message'),
                'link': data.get('link'),
                'isRead': bool(data.get('is_read', False)),
                'timestamp': data.get('timestamp'),
                'type': data.get('type')
            })
        return jsonify({'success': True, 'notifications': items}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to list notifications'}), 500

@user_bp.route('/api/notifications/mark-all-read', methods=['POST'])
def mark_all_notifications_read():
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401
        ref = db.collection('notifications')
        q = ref.where('user_id', '==', user_id).where('is_read', '==', False)
        docs = list(q.stream())
        batch = db.batch()
        for d in docs:
            batch.update(ref.document(d.id), {'is_read': True})
        if docs:
            batch.commit()
        return jsonify({'success': True, 'updated': len(docs)}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to mark all read'}), 500

@user_bp.route('/api/notifications/mark-read', methods=['POST'])
def mark_notification_read():
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401
        data = request.get_json() or {}
        nid = data.get('notificationId')
        if not nid:
            return jsonify({'error': 'Missing notificationId'}), 400
        doc_ref = db.collection('notifications').document(nid)
        doc = doc_ref.get()
        if not doc.exists:
            return jsonify({'error': 'Notification not found'}), 404
        body = doc.to_dict() or {}
        if body.get('user_id') != user_id:
            return jsonify({'error': 'Forbidden'}), 403
        doc_ref.update({'is_read': True})
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to mark read'}), 500

@user_bp.route('/api/firebase-config', methods=['GET'])
def get_firebase_web_config():
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        import json, os
        cfg_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', 'config', 'firebase_web_config.json')
        cfg_path = os.path.abspath(cfg_path)
        with open(cfg_path, 'r') as f:
            data = json.load(f)
        return jsonify({'success': True, 'config': data, 'userId': session.get('user_id')}), 200
    except Exception as e:
        return jsonify({'error': 'Config not available'}), 404

@user_bp.route('/dashboard')
def dashboard():
    if not is_student():
        return redirect(url_for('login'))
    
    # Get user profile information
    user_profile = get_user_profile(session.get('user_id'))
    
    return render_template('users/dashboard.html', user=user_profile)

@user_bp.route('/api/found-items', methods=['GET'])
def get_found_items_api():
    """API endpoint to get found items for user dashboard"""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get query parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 12))  # Default 12 items for dashboard grid
        search = request.args.get('search', '').strip().lower()
        category_filter = request.args.get('category', '').strip()
        status_filter = request.args.get('status', 'unclaimed').strip()  # Default to unclaimed items
        location_filter = request.args.get('location', '').strip()
        
        # Validate pagination parameters
        if page < 1:
            page = 1
        if per_page < 1 or per_page > 50:
            per_page = 12
        
        # Get found items from Firebase
        found_items_ref = db.collection('found_items')
        
        # Apply status filter (show only unclaimed items by default for users)
        if status_filter:
            query = found_items_ref.where('status', '==', status_filter)
        else:
            query = found_items_ref.where('status', '==', 'unclaimed')
        
        # Order by created_at descending (newest first)
        query = query.order_by('created_at', direction=firestore.Query.DESCENDING)
        
        # Get all documents for filtering
        all_docs = list(query.stream())
        
        # Apply client-side filtering
        filtered_items = []
        categories = set()
        locations = set()
        
        for doc in all_docs:
            item_data = doc.to_dict()
            item_data['id'] = doc.id
            
            # Collect filter options
            if item_data.get('category'):
                categories.add(item_data['category'])
            if item_data.get('place_found'):
                locations.add(item_data['place_found'])
            
            # Apply filters
            should_include = True
            
            # Search filter
            if search:
                searchable_text = ' '.join([
                    item_data.get('found_item_name', '').lower(),
                    item_data.get('description', '').lower(),
                    item_data.get('category', '').lower(),
                    item_data.get('place_found', '').lower(),
                    ' '.join(item_data.get('tags', [])).lower()
                ])
                if search not in searchable_text:
                    should_include = False
            
            # Category filter
            if category_filter and item_data.get('category') != category_filter:
                should_include = False
            
            # Location filter
            if location_filter and item_data.get('place_found') != location_filter:
                should_include = False
            
            if should_include:
                # Format the item for frontend
                formatted_item = {
                    'id': item_data.get('found_item_id', doc.id),
                    'name': item_data.get('found_item_name', 'Unknown Item'),
                    'description': item_data.get('description', ''),
                    'category': item_data.get('category', ''),
                    'location': item_data.get('place_found', ''),
                    'image_url': item_data.get('image_url', ''),
                    'tags': item_data.get('tags', []),
                    'status': item_data.get('status', 'unclaimed'),
                    'time_found': item_data.get('time_found'),
                    'is_valuable': item_data.get('is_valuable', False),
                    'created_at': item_data.get('created_at')
                }
                filtered_items.append(formatted_item)
        
        # Apply pagination
        total_items = len(filtered_items)
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        paginated_items = filtered_items[start_index:end_index]
        
        # Calculate pagination info
        total_pages = (total_items + per_page - 1) // per_page
        has_next = page < total_pages
        has_prev = page > 1
        
        return jsonify({
            'success': True,
            'found_items': paginated_items,
            'pagination': {
                'current_page': page,
                'per_page': per_page,
                'total_items': total_items,
                'total_pages': total_pages,
                'has_next': has_next,
                'has_prev': has_prev
            },
            'filters': {
                'categories': sorted(list(categories)),
                'locations': sorted(list(locations))
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/browse-found-items')
def browse_found_items():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/browse-found-items.html', user=user_profile)

# New: Found Item Details Page
@user_bp.route('/found-item-details/<found_item_id>')
def found_item_details(found_item_id):
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/browse-found-items-details.html', user=user_profile, found_item_id=found_item_id)

# New: Found Item Details API for Users
@user_bp.route('/api/found-items/<item_id>', methods=['GET'])
def get_found_item_details_api(item_id):
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        # Support both Firestore document ID and business ID (found_item_id)
        doc_ref = db.collection('found_items').document(item_id)
        doc = doc_ref.get()
        resolved_id = None
        if doc.exists:
            resolved_id = item_id
        else:
            # Try to resolve by found_item_id field
            query = db.collection('found_items').where('found_item_id', '==', item_id).limit(1).stream()
            for qdoc in query:
                resolved_id = qdoc.id
                break
        if not resolved_id:
            return jsonify({'error': 'Found item not found'}), 404
        success, data, status = get_found_item_details(resolved_id)
        return jsonify(data), status
    except Exception as e:
        return jsonify({'error': f'Failed to get item details: {str(e)}'}), 500

@user_bp.route('/report-lost-item')
def report_lost_item():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/report-lost-item.html', user=user_profile)

# Create: Lost Item Report (API)
@user_bp.route('/api/lost-items', methods=['POST'])
def create_lost_item_api():
    """API endpoint to submit a lost item report (students only)."""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401

        # Expect multipart/form-data with image file and form fields
        image_file = request.files.get('image')
        form_data = request.form.to_dict()

        # Resolve temp upload folder
        upload_folder = current_app.config.get('UPLOAD_FOLDER')
        if not upload_folder:
            import tempfile
            upload_folder = tempfile.gettempdir()

        success, response, status = create_lost_item(form_data, image_file, user_id, upload_folder)
        return jsonify(response), status
    except Exception as e:
        return jsonify({'error': f'Failed to submit report: {str(e)}'}), 500

# AI: Generate Tags from Image (User)
@user_bp.route('/api/generate-tags', methods=['POST'])
def user_generate_tags_api():
    """Generate AI tags for an uploaded image (students only)."""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        file = request.files.get('image')
        if not file:
            return jsonify({'error': 'No image file provided'}), 400

        # Save to temp file
        import os, uuid, tempfile
        temp_dir = tempfile.gettempdir()
        filename = f"{uuid.uuid4()}.{file.filename.split('.')[-1]}"
        temp_path = os.path.join(temp_dir, filename)
        file.save(temp_path)

        learned_raw = request.form.get('learned_tags')
        extra_candidates = []
        try:
            if learned_raw:
                import json as _json
                extra_candidates = _json.loads(learned_raw)
        except Exception:
            extra_candidates = []
        result = generate_tags(temp_path, extra_candidates=extra_candidates)

        # Clean up temp file
        try:
            os.remove(temp_path)
        except Exception:
            pass

        return jsonify({'success': True, 'tags': result.get('tags', [])}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to generate tags: {str(e)}'}), 500

# AI: Generate Description/Caption from Image (User)
@user_bp.route('/api/generate-description', methods=['POST'])
def user_generate_description_api():
    """Generate an AI description from an uploaded image (students only)."""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        file = request.files.get('image')
        if not file:
            return jsonify({'error': 'No image file provided'}), 400

        # Basic validation for file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'webp'}
        filename = file.filename or ''
        extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if extension not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: png, jpg, jpeg'}), 400

        # Save to temp file
        import os, uuid, tempfile
        temp_dir = tempfile.gettempdir()
        temp_name = f"{uuid.uuid4()}.{extension}"
        temp_path = os.path.join(temp_dir, temp_name)
        file.save(temp_path)

        # Use AI caption generation
        from ..ai_image_tagging import generate_caption_for_image
        caption = generate_caption_for_image(temp_path)

        # Clean up
        try:
            os.remove(temp_path)
        except Exception:
            pass

        return jsonify({'success': True, 'description': caption}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to generate description: {str(e)}'}), 500

@user_bp.route('/api/my-lost-items', methods=['GET'])
def get_my_lost_items_api():
    """List current user's lost item reports with search, filters, sort, and pagination."""
    if not is_student():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User not found'}), 401

        # Query params
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        search = (request.args.get('search') or '').strip().lower()
        category_filter = (request.args.get('category') or '').strip()
        status_filter = (request.args.get('status') or '').strip()
        location_filter = (request.args.get('location') or '').strip()
        sort_by = (request.args.get('sort_by') or 'created_at').strip()
        sort_dir = (request.args.get('sort_dir') or 'desc').strip().lower()  # 'asc' or 'desc'

        if page < 1:
            page = 1
        if per_page < 1 or per_page > 50:
            per_page = 10

        # Fetch all current user's lost items
        query = db.collection('lost_items').where('reported_by', '==', user_id)
        docs = list(query.stream())

        items = []
        categories = set()
        locations = set()
        statuses = set()

        for doc in docs:
            d = doc.to_dict()
            # Collect filter options
            if d.get('category'):
                categories.add(d['category'])
            if d.get('place_lost'):
                locations.add(d['place_lost'])
            if d.get('status'):
                statuses.add(d['status'])

            # Apply client-side filters
            include = True
            if search:
                searchable = ' '.join([
                    (d.get('lost_item_name') or d.get('item_name') or '').lower(),
                    (d.get('description') or '').lower(),
                    (d.get('category') or '').lower(),
                    (d.get('place_lost') or '').lower(),
                    ' '.join(d.get('tags') or [])
                ])
                if search not in searchable:
                    include = False
            if category_filter and d.get('category') != category_filter:
                include = False
            if status_filter and d.get('status') != status_filter:
                include = False
            if location_filter and d.get('place_lost') != location_filter:
                include = False

            if not include:
                continue

            # Format for response
            items.append({
                'id': d.get('lost_item_id', doc.id),
                'lost_report_id': d.get('lost_item_id', doc.id),
                'item_name': d.get('lost_item_name') or d.get('item_name') or 'Unknown Item',
                'lost_item_name': d.get('lost_item_name') or d.get('item_name') or 'Unknown Item',
                'category': d.get('category', ''),
                'description': d.get('description', ''),
                'tags': d.get('tags', []),
                'place_lost': d.get('place_lost', ''),
                'date_lost': d.get('date_lost'),
                'created_at': d.get('created_at'),
                'status': d.get('status', 'Open'),
                'image_url': d.get('image_url', '')
            })

        # Sorting (client-side)
        reverse = sort_dir != 'asc'
        def sort_key(x):
            val = x.get(sort_by)
            # Firestore timestamp or datetime objects should sort naturally; for strings, keep as-is
            return val if val is not None else ''
        try:
            items.sort(key=sort_key, reverse=reverse)
        except Exception:
            # Fallback to created_at desc
            items.sort(key=lambda x: x.get('created_at') or '', reverse=True)

        # Pagination
        total = len(items)
        start = (page - 1) * per_page
        end = start + per_page
        page_items = items[start:end]
        total_pages = (total + per_page - 1) // per_page

        return jsonify({
            'success': True,
            'lost_items': page_items,
            'pagination': {
                'current_page': page,
                'per_page': per_page,
                'total_items': total,
                'total_pages': total_pages,
                'has_next': page < total_pages,
                'has_prev': page > 1
            },
            'filters': {
                'categories': sorted(list(categories)),
                'locations': sorted(list(locations)),
                'statuses': sorted(list(statuses))
            }
        }), 200
    except Exception as e:
        return jsonify({'error': f'Failed to fetch lost items: {str(e)}'}), 500

@user_bp.route('/lost-item-history')
def lost_item_history():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/lost-item-report-history.html', user=user_profile)

@user_bp.route('/lost-report-details/<report_id>')
def lost_item_report_details(report_id):
    if not is_student():
        return redirect(url_for('login'))
    try:
        # Try document ID first
        doc_ref = db.collection('lost_items').document(report_id)
        doc = doc_ref.get()
        report = None
        if doc.exists:
            report = doc.to_dict() or {}
        else:
            # Fallback by business id
            query = db.collection('lost_items').where('lost_item_id', '==', report_id).limit(1).stream()
            for qdoc in query:
                report = qdoc.to_dict() or {}
                break
        user_profile = get_user_profile(session.get('user_id'))
        return render_template('users/lost-item-report-details.html', user=user_profile, report=report)
    except Exception as e:
        user_profile = get_user_profile(session.get('user_id'))
        return render_template('users/lost-item-report-details.html', user=user_profile, report=None, error=str(e))

@user_bp.route('/claim-history')
def claim_history():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/claim-history.html', user=user_profile)

@user_bp.route('/my-qr-code')
def my_qr_code():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    # Render the dedicated My QR Code page (was incorrectly pointing to qr-code-history)
    return render_template('users/my-qr-code.html', user=user_profile)


@user_bp.route('/notifications')
def notifications():
    if not is_student():
        return redirect(url_for('login'))
    
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/user-notifications.html', user=user_profile)

@user_bp.route('/profile')
def profile():
    if not is_student():
        return redirect(url_for('login'))
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/user-profile.html', user=user_profile)

@user_bp.route('/settings')
def settings():
    if not is_student():
        return redirect(url_for('login'))
    user_profile = get_user_profile(session.get('user_id'))
    return render_template('users/user-settings.html', user=user_profile)

# ========================
# Claims API (student)
# ========================

@user_bp.route('/api/claims/start', methods=['POST'])
def user_start_claim_api():
    """
    Enhanced claim start endpoint with comprehensive multi-layered validation.
    Implements defense-in-depth security approach for claim processing.
    """
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'User session not found'}), 401
            
        data = request.get_json() or {}
        found_item_id = data.get('item_id')
        student_remarks = data.get('student_remarks')
        
        if not found_item_id:
            return jsonify({'error': 'Missing item_id'}), 400
        
        # Enhanced claim processing with comprehensive validation
        success, resp, status = start_claim(user_id, found_item_id, student_remarks=student_remarks)
        
        # Add additional context for frontend handling
        if success and 'validation_summary' in resp:
            validation_summary = resp['validation_summary']
            resp['enhanced_validation'] = True
            resp['security_layers_passed'] = len(validation_summary.get('layers_passed', []))
            
            # Provide guidance for next steps based on validation results
            if validation_summary.get('requires_admin_approval', False):
                resp['next_step'] = 'await_admin_approval'
                resp['message'] = 'Claim created successfully. Awaiting admin approval for valuable item.'
            else:
                resp['next_step'] = 'proceed_to_verification'
                resp['message'] = 'Claim created successfully. You can now proceed with verification.'
        
        return jsonify(resp), status
        
    except Exception as e:
        # Log the error for debugging while providing safe error message
        current_app.logger.error(f"Error in user_start_claim_api: {str(e)}")
        return jsonify({
            'error': 'Internal server error during claim processing',
            'code': 'CLAIM_PROCESSING_ERROR'
        }), 500

@user_bp.route('/api/claims/request-approval', methods=['POST'])
def user_request_approval_api():
    """
    Create a pending claim for valuable items that require admin approval.
    This endpoint creates the claim and stops - no face capture or verification.
    """
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        user_id = session.get('user_id')
        data = request.get_json() or {}
        found_item_id = data.get('item_id')
        student_remarks = data.get('student_remarks', '').strip()
        
        if not found_item_id:
            return jsonify({'error': 'Missing item_id'}), 400
        if not student_remarks:
            return jsonify({'error': 'Student remarks are required for approval requests'}), 400
        if len(student_remarks) > 300:
            return jsonify({'error': 'Remarks must be 300 characters or fewer'}), 400
        
        # Verify the item exists and is valuable
        item_ref = db.collection('found_items').document(found_item_id)
        item_doc = item_ref.get()
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        item_data = item_doc.to_dict() or {}
        if not item_data.get('is_valuable', False):
            return jsonify({'error': 'This item does not require approval'}), 400
        
        # Create the pending claim using the existing start_claim function
        success, resp, status = start_claim(user_id, found_item_id, student_remarks=student_remarks)
        
        if success:
            # Ensure the response indicates this is an approval request
            resp['message'] = 'Approval request submitted successfully'
            resp['requires_admin_approval'] = True
            
        return jsonify(resp), status
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/claims/capture-face', methods=['POST'])
def user_capture_face_api():
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.get_json() or {}
        claim_id = data.get('claim_id')
        face_data_url = data.get('face_data_url')
        if not claim_id or not face_data_url:
            return jsonify({'error': 'Missing claim_id or face_data_url'}), 400
        # Determine upload folder
        import tempfile
        upload_folder = current_app.config.get('UPLOAD_FOLDER') or tempfile.gettempdir()
        try:
            current_app.logger.info('capture-face: claim_id=%s, data_url_len=%d', claim_id, len(face_data_url or ''))
        except Exception:
            pass
        success, resp, status = save_face_image_for_claim(claim_id, face_data_url, upload_folder)
        try:
            current_app.logger.info('capture-face: status=%s, resp_keys=%s', status, list(resp.keys()))
        except Exception:
            pass
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/claims/select-method', methods=['POST'])
def user_select_verification_method_api():
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.get_json() or {}
        claim_id = data.get('claim_id')
        method = data.get('method')
        if not claim_id or not method:
            return jsonify({'error': 'Missing claim_id or method'}), 400
        success, resp, status = set_verification_method(claim_id, method)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/claims/finalize', methods=['POST'])
def user_finalize_claim_api():
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.get_json() or {}
        claim_id = data.get('claim_id')
        if not claim_id:
            return jsonify({'error': 'Missing claim_id'}), 400
        success, resp, status = finalize_claim(claim_id)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/claims/generate-qr', methods=['POST'])
def user_generate_claim_qr_api():
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.get_json() or {}
        claim_id = data.get('claim_id')
        if not claim_id:
            return jsonify({'error': 'Missing claim_id'}), 400
        import tempfile
        upload_folder = current_app.config.get('UPLOAD_FOLDER') or tempfile.gettempdir()
        success, resp, status = generate_claim_qr(claim_id, upload_folder)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# QR registration status for a found item (student)
@user_bp.route('/api/qr/status/<item_id>', methods=['GET'])
def user_qr_status_api(item_id):
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        ok, resp, status = get_qr_status_for_item(item_id)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# User-specific QR registration status (for current student)
@user_bp.route('/api/qr/status/<item_id>/me', methods=['GET'])
def user_qr_status_for_me_api(item_id):
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        user_id = session.get('user_id')
        ok, resp, status = get_qr_status_for_user_item(user_id, item_id)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# User-specific claim status for this found item (latest claim by current student)
@user_bp.route('/api/claims/status/<item_id>/me', methods=['GET'])
def user_claim_status_for_me_api(item_id):
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        user_id = session.get('user_id')
        ok, resp, status = get_user_claim_status_for_item(user_id, item_id)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Get user's overall claim status (active claims, pending claims, etc.)
@user_bp.route('/api/claims/user-status', methods=['GET'])
def user_claims_status_api():
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        user_id = session.get('user_id')
        
        # Get all claims for this user
        claims_query = db.collection('claims').where('student_id', '==', user_id)
        claims = list(claims_query.stream())
        
        active_claims = []
        pending_claims = []
        approved_claims = []
        
        for claim_doc in claims:
            claim_data = claim_doc.to_dict()
            claim_status = claim_data.get('status', 'unknown')
            
            claim_info = {
                'claim_id': claim_doc.id,
                'found_item_id': claim_data.get('found_item_id'),
                'status': claim_status,
                'created_at': claim_data.get('created_at'),
                'expires_at': claim_data.get('expires_at')
            }
            
            if claim_status == 'pending':
                pending_claims.append(claim_info)
            elif claim_status == 'approved':
                approved_claims.append(claim_info)
            elif claim_status == 'active':
                active_claims.append(claim_info)
        
        # Check for active QR codes
        has_active_qr = False
        for claim in approved_claims:
            if claim.get('expires_at'):
                try:
                    # Check if QR is still valid
                    expires_at = claim['expires_at']
                    if isinstance(expires_at, datetime):
                        if expires_at > datetime.now(timezone.utc):
                            has_active_qr = True
                            break
                    else:
                        # Handle timestamp format
                        expires_timestamp = expires_at if isinstance(expires_at, (int, float)) else float(expires_at)
                        if expires_timestamp > time.time():
                            has_active_qr = True
                            break
                except Exception:
                    continue
        
        return jsonify({
            'success': True,
            'has_active_claims': len(active_claims) > 0 or len(pending_claims) > 0 or has_active_qr,
            'active_claims_count': len(active_claims),
            'pending_claims_count': len(pending_claims),
            'approved_claims_count': len(approved_claims),
            'has_active_qr': has_active_qr,
            'user_id': user_id
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# List all claims for the current student
@user_bp.route('/api/claims/user', methods=['GET'])
@student_required
def user_list_claims_api():
    try:
        student_id = session.get('user_id')

        days_filter = request.args.get('days', type=int)
        status = request.args.get('status', type=str)
        sort = request.args.get('sort', type=str, default='newest')
        start_date = request.args.get('start', type=str)
        end_date = request.args.get('end', type=str)
        page_size = request.args.get('page_size', default=20, type=int)
        cursor_id = request.args.get('cursor', type=str)

        ok, resp, status_code = list_user_claims(
            student_id,
            status=status,
            sort=sort,
            days_filter=days_filter,
            start_date=start_date,
            end_date=end_date,
            page_size=page_size,
            cursor_id=cursor_id,
        )
        return jsonify(resp), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ========================
# User Profile & Settings API
# ========================

@user_bp.route('/api/user/profile', methods=['GET', 'PUT'])
@student_required
def api_user_profile():
    try:
        user_id = session.get('user_id')
        ref = db.collection('users').document(user_id)
        if request.method == 'GET':
            doc = ref.get()
            if not doc.exists:
                return jsonify({'error': 'User not found'}), 404
            data = doc.to_dict() or {}
            return jsonify({'success': True, 'user': data}), 200
        payload = request.get_json() or {}
        allowed_fields = {'name', 'email', 'phone', 'department'}
        update_data = {k: v for k, v in payload.items() if k in allowed_fields}
        if not update_data:
            return jsonify({'error': 'No updatable fields provided'}), 400
        ref.update(update_data)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/user/profile/picture', methods=['POST'])
@student_required
def api_user_profile_picture():
    try:
        user_id = session.get('user_id')
        data = request.get_json() or {}
        b64 = data.get('image_base64')
        if not b64 or not isinstance(b64, str):
            return jsonify({'error': 'Invalid image payload'}), 400
        # Validate size (~2MB base64 ≈ 2,600,000 chars)
        if len(b64) > 2600000:
            return jsonify({'error': 'Image too large (max 2MB)'}), 413
        db.collection('users').document(user_id).update({'profile_picture_base64': b64})
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@user_bp.route('/api/user/settings', methods=['GET', 'PUT'])
@student_required
def api_user_settings():
    try:
        user_id = session.get('user_id')
        ref = db.collection('users').document(user_id)
        if request.method == 'GET':
            doc = ref.get()
            if not doc.exists:
                return jsonify({'error': 'User not found'}), 404
            data = doc.to_dict() or {}
            return jsonify({'success': True, 'settings': data.get('preferences', {})}), 200
        payload = request.get_json() or {}
        prefs = payload.get('preferences', {})
        # Validate theme and notifications shape
        theme = prefs.get('theme')
        if theme and theme not in {'system', 'light', 'dark'}:
            return jsonify({'error': 'Invalid theme'}), 400
        notifications = prefs.get('notifications') or {}
        if not isinstance(notifications, dict):
            return jsonify({'error': 'Invalid notifications object'}), 400
        security = prefs.get('security') or {}
        if not isinstance(security, dict):
            return jsonify({'error': 'Invalid security object'}), 400
        ref.update({'preferences': {'theme': theme or 'system', 'notifications': notifications, 'security': security}})
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Cancel a pending claim for the current student
@user_bp.route('/api/claims/<claim_id>/cancel', methods=['POST'])
@student_required
def user_cancel_claim_api(claim_id):
    try:
        student_id = session.get('user_id')
        ok, resp, status = cancel_claim(claim_id, student_id)
        return jsonify(resp), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Enhanced QR request validation endpoint
@user_bp.route('/api/qr/validation/<item_id>/me', methods=['GET'])
def user_qr_validation_api(item_id):
    """
    Comprehensive QR request validation endpoint that checks:
    - Existing pending approval requests
    - Active QR codes
    - Item availability
    - User eligibility
    """
    try:
        if not is_student():
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_id = session.get('user_id')
        
        # Get found item details
        found_item_ok, found_item_data, found_item_status = get_found_item_details(item_id)
        if not found_item_ok:
            return jsonify({'error': 'Item not found'}), 404

        # NOTE:
        # get_found_item_details returns an object shaped like { 'item': { ...fields } }
        # Previously the code accessed found_item_data['status'] directly, which is incorrect and
        # causes every item to be treated as "Not Available". We normalize here for clarity.
        # This keeps the logic resilient even if the service later returns a flat object.
        item_details = found_item_data.get('item', found_item_data) or {}

        # Check if item is still available (status should be 'unclaimed' for available items)
        if item_details.get('status') != 'unclaimed':
            return jsonify({
                'can_request': False,
                'reason': 'item_not_available',
                'message': 'This item is no longer available for claiming.',
                'button_state': 'disabled',
                'button_text': 'Not Available'
            }), 200
        
        # Check for global user claim status (one active claim at a time)
        global_claim_ok, global_claim_data, global_claim_status = check_user_global_claim_status(user_id, item_id)
        if global_claim_ok and global_claim_data.get('has_active_claims'):
            # Align with check_user_global_claim_status response keys
            # { has_active_claims, active_claims_count, active_claims, blocking_claim }
            active_claims = global_claim_data.get('active_claims', [])
            first_claim = global_claim_data.get('blocking_claim', {})

            return jsonify({
                'can_request': False,
                'reason': 'has_other_active_claims',
                'message': f'You already have {global_claim_data.get("active_claims_count", 0)} active claim(s). Please complete or cancel your existing claims before requesting a new one.',
                'button_state': 'disabled',
                'button_text': 'Has Active Claims',
                'blocking_claim': first_claim,
                'active_claims_count': global_claim_data.get('active_claims_count', 0)
            }), 200

        # Get user's claim status for this item
        claim_ok, claim_data, claim_status = get_user_claim_status_for_item(user_id, item_id)
        
        # Get enhanced QR status for this user-item pair (includes claim validation)
        qr_ok, qr_data, qr_status = get_qr_status_for_user_item(user_id, item_id)
        
        # Determine if item requires approval (valuable items)
        requires_approval = item_details.get('is_valuable', False)
        
        # Check for existing claim for this item (pending_approval/approved/rejected)
        # Align with get_user_claim_status_for_item which returns { exists, status, claim_id, ... }
        if claim_ok and claim_data.get('exists'):
            claim_status_value = claim_data.get('status')
            
            if claim_status_value == 'pending_approval':
                return jsonify({
                    'can_request': False,
                    'reason': 'pending_approval',
                    'message': 'You have already requested approval for this item. Please wait for admin review.',
                    'button_state': 'disabled',
                    'button_text': 'Requested Approval',
                    'claim_id': claim_data.get('claim_id')
                }), 200
            
            elif claim_status_value == 'approved':
                # For approved claims, validate that the approving admin is still active
                approved_by = claim_data.get('approved_by')
                if approved_by and requires_approval:
                    admin_valid_ok, admin_valid_data, admin_valid_status = validate_admin_status_for_approval(approved_by)
                    if admin_valid_ok and not admin_valid_data.get('is_valid', False):
                        # Approving admin is no longer valid
                        return jsonify({
                            'can_request': False,
                            'reason': 'invalid_approving_admin',
                            'message': f'The admin who approved this claim is no longer active. Please request re-approval. Reason: {admin_valid_data.get("error_reason", "Unknown")}',
                            'button_state': 'disabled',
                            'button_text': 'Re-approval Required',
                            'claim_id': claim_data.get('claim_id'),
                            'approved_by': approved_by,
                            'admin_status': admin_valid_data.get('admin_status'),
                            'admin_name': admin_valid_data.get('admin_name')
                        }), 200
                
                return jsonify({
                    'can_request': True,
                    'reason': 'approved_can_claim',
                    'message': 'Your approval request has been approved. You can now claim this item.',
                    'button_state': 'enabled',
                    'button_text': 'Claim',
                    'claim_id': claim_data.get('claim_id'),
                    'approved_at': claim_data.get('approved_at'),
                    'approved_by': claim_data.get('approved_by')
                }), 200
            
            elif claim_status_value == 'rejected':
                return jsonify({
                    'can_request': False,
                    'reason': 'rejected',
                    'message': 'Your approval request was rejected. Please contact admin for more information.',
                    'button_state': 'disabled',
                    'button_text': 'Request Rejected',
                    'claim_id': claim_data.get('claim_id'),
                    'rejected_at': claim_data.get('rejected_at')
                }), 200
        
        # Check for active QR code with enhanced validation
        if qr_ok and qr_data.get('has_active_qr'):
            # Check if the QR's linked claim is still valid
            if not qr_data.get('claim_valid', False):
                # QR exists but linked claim is invalid - allow new request
                current_app.logger.warning(f'User {user_id} has active QR for item {item_id} but linked claim is invalid (status: {qr_data.get("claim_status")})')
            else:
                # QR exists and linked claim is valid - block request
                return jsonify({
                    'can_request': False,
                    'reason': 'active_qr',
                    'message': 'You already have an active QR code for this item with a valid claim.',
                    'button_state': 'disabled',
                    'button_text': 'QR Active',
                    'qr_expires_at': qr_data.get('expires_at'),
                    'claim_id': qr_data.get('claim_id'),
                    'claim_status': qr_data.get('claim_status')
                }), 200
        
        # Default case - user can request/claim
        if requires_approval:
            return jsonify({
                'can_request': True,
                'reason': 'can_request_approval',
                'message': 'This valuable item requires admin approval before claiming.',
                'button_state': 'enabled',
                'button_text': 'Request Approval',
                'requires_approval': True
            }), 200
        else:
            return jsonify({
                'can_request': True,
                'reason': 'can_claim_directly',
                'message': 'You can claim this item directly.',
                'button_state': 'enabled',
                'button_text': 'Claim',
                'requires_approval': False
            }), 200
            
    except Exception as e:
        current_app.logger.error(f"Error in QR validation: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

# Comprehensive claim validation endpoint
@user_bp.route('/api/claims/validate/<item_id>', methods=['GET'])
@student_required
def comprehensive_claim_validation_api(item_id):
    """
    Comprehensive claim validation endpoint that performs all security checks
    before allowing a claim attempt. This implements the defense-in-depth
    validation approach without actually creating a claim.
    """
    try:
        user_id = session.get('user_id')
        
        # Get user's existing claim status for this item to provide claim_id and reason
        claim_ok, claim_data, claim_status = get_user_claim_status_for_item(user_id, item_id)
        existing_claim_id = None
        claim_reason = None
        
        if claim_ok and claim_data.get('exists'):
            existing_claim_id = claim_data.get('claim_id')
            claim_status_value = claim_data.get('status')
            
            # Map claim status to reason codes expected by frontend
            if claim_status_value == 'pending_approval':
                claim_reason = 'pending_approval'
            elif claim_status_value == 'approved':
                # Check if this approved claim belongs to the current user
                approved_by_user = claim_data.get('student_id') == user_id
                if approved_by_user:
                    claim_reason = 'approved_can_claim'
                else:
                    # Item is approved but by another user
                    claim_reason = 'item_approved'
            elif claim_status_value == 'rejected':
                claim_reason = 'rejected'
            elif claim_status_value == 'pending':
                # Check if there's an active QR for this claim
                qr_ok, qr_data, qr_status = get_qr_status_for_user_item(user_id, item_id)
                if qr_ok and qr_data.get('has_active_qr'):
                    claim_reason = 'active_qr'
        
        # Perform comprehensive validation (dry run)
        validation_success, validation_result = ClaimValidationService.validate_comprehensive_claim_request(
            user_id=user_id,
            item_id=item_id,
            student_remarks=None,  # No remarks needed for validation check
            dry_run=True  # Don't create any records, just validate
        )
        
        # Extract validation details
        is_valid = validation_success
        validation_summary = validation_result.get('validation_results', {}) if validation_success else {}
        layers_passed = validation_summary.get('layers_passed', [])
        failed_layer = validation_result.get('code') if not validation_success else None
        
        # Prepare response with detailed validation information
        response = {
            'valid': is_valid,
            'item_id': item_id,
            'user_id': user_id,
            'claim_id': existing_claim_id,  # Add claim_id field expected by frontend
            'reason': claim_reason,  # Add reason field expected by frontend
            'validation_summary': {
                'total_layers': 8,  # Total number of validation layers
                'layers_passed': len(layers_passed),
                'layers_passed_list': layers_passed,
                'failed_layer': failed_layer,
                'requires_admin_approval': validation_result.get('requires_admin_approval', False) if validation_success else False,
                'is_valuable_item': validation_result.get('is_valuable_item', False) if validation_success else False,
                'has_active_claims': validation_summary.get('has_active_claims', False),
                'claim_limit_reached': validation_summary.get('claim_limit_reached', False)
            },
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        # Add specific guidance based on validation results
        if is_valid:
            response['message'] = 'All validation checks passed. You can proceed with the claim.'
            response['next_action'] = 'proceed_with_claim'
            response['button_state'] = 'enabled'
            response['button_text'] = 'Claim Item'
            
            if validation_result.get('requires_admin_approval', False):
                response['approval_required'] = True
                response['approval_message'] = 'This valuable item requires admin approval.'
        else:
            # Provide specific error messages based on failed layer
            error_messages = {
                'ITEM_NOT_AVAILABLE': 'Item is not available for claiming',
                'ITEM_ALREADY_CLAIMED': 'This item has already been claimed by another user',
                'ITEM_APPROVED_BY_OTHER_USER': 'This item has been approved for claiming by another user',
                'ITEM_PENDING_VERIFICATION': 'This item is currently pending verification',
                'USER_NOT_ELIGIBLE': 'You are not eligible to claim this item',
                'ADMIN_APPROVAL_REQUIRED': 'Admin approval required for valuable items',
                'INVALID_CLAIM_STATE': 'Invalid claim state detected',
                'CLAIM_LIMIT_EXCEEDED': 'You have reached the maximum number of active claims',
                'SECURITY_VALIDATION_FAILED': 'Security validation failed',
                'RATE_LIMIT_EXCEEDED': 'Too many claim attempts. Please wait before trying again'
            }
            
            response['error'] = validation_result.get('error', 'Validation failed')
            response['error_detail'] = error_messages.get(failed_layer, 'Unknown validation error')
            response['failed_layer'] = failed_layer
            response['button_state'] = 'disabled'
            response['button_text'] = 'Cannot Claim'
            
            # Add specific guidance for different failure types
            if failed_layer == 'CLAIM_LIMIT_EXCEEDED':
                response['guidance'] = 'Complete or cancel your existing claim before starting a new one.'
            elif failed_layer == 'ITEM_NOT_AVAILABLE':
                response['guidance'] = 'This item may have been claimed by another user.'
            elif failed_layer == 'ADMIN_APPROVAL_REQUIRED':
                response['guidance'] = 'Contact an admin for approval to claim this valuable item.'
        
        # Add security audit information
        response['security_audit'] = {
            'validation_layers_executed': len(layers_passed) + (1 if failed_layer else 0),
            'security_level': 'high' if len(layers_passed) >= 6 else 'medium' if len(layers_passed) >= 3 else 'low',
            'validation_time': validation_result.get('validation_time', 0)
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        # Log the error for security auditing
        current_app.logger.error(f"Error in comprehensive_claim_validation_api: {str(e)}")
        return jsonify({
            'valid': False,
            'error': 'Internal server error during validation',
            'code': 'VALIDATION_ERROR',
            'button_state': 'disabled',
            'button_text': 'Error'
        }), 500

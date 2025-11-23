from flask import Blueprint, render_template, redirect, url_for, session, request, jsonify, Response
from ..auth import is_admin
from ..database import db
from ..services.scheduler_service import get_scheduler, start_scheduler, stop_scheduler
from ..services import scheduler_service
from ..services.matching_service import ai_match_top3
from flask import stream_with_context
import queue
import threading
import datetime
import os
import tempfile
import json
from firebase_admin import firestore  # For SERVER_TIMESTAMP
from google.api_core.exceptions import FailedPrecondition  # Handle missing Firestore composite indexes gracefully
from ..services.locker_service import get_available_lockers
from ..services.found_item_service import get_dashboard_statistics, get_recent_activities, create_found_item
from ..services.image_service import generate_tags
from ..services.status_service import update_overdue_items, validate_status_transition, is_status_final
from ..services.admin_review_service import create_admin_review, get_admin_reviews, get_admin_review_by_id
from ..services.claim_service import validate_admin_status_for_approval  # Validate admin before approving/rejecting

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# =============================
# Network Info Page & API
# =============================
@admin_bp.route('/network-info')
def network_info_page():
    if not is_admin():
        return redirect(url_for('login'))
    return render_template('admins/network-info.html')

@admin_bp.route('/api/network-info', methods=['GET'])
def api_network_info():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    info = {
        'success': True,
        'server_time': datetime.datetime.utcnow().isoformat() + 'Z',
        'db_status': 'unknown',
        'counts': {'users': 0, 'found_items': 0, 'lost_items': 0, 'claims': 0}
    }
    try:
        info['counts']['users'] = len(list(db.collection('users').select(['user_id']).stream()))
        info['counts']['found_items'] = len(list(db.collection('found_items').select(['found_item_id']).stream()))
        info['counts']['lost_items'] = len(list(db.collection('lost_items').select(['lost_item_id']).stream()))
        info['counts']['claims'] = len(list(db.collection('claims').select(['claim_id']).stream()))
        info['db_status'] = 'online'
    except Exception as e:
        info['db_status'] = 'error'
        info['error'] = str(e)
        info['success'] = False
    return jsonify(info), 200 if info['success'] else 500

@admin_bp.route('/session-expired')
def session_expired_page():
    return render_template('network-access-info.html', code=401, message='Session Expired'), 401

# =============================
# Global Error Handlers
# =============================
@admin_bp.app_errorhandler(404)
def handle_404(error):
    try:
        return render_template('network-access-info.html', code=404, message='Page Not Found'), 404
    except Exception:
        return '404 - Page Not Found', 404

@admin_bp.app_errorhandler(500)
def handle_500(error):
    try:
        return render_template('network-access-info.html', code=500, message='Server Error'), 500
    except Exception:
        return '500 - Server Error', 500

@admin_bp.app_errorhandler(401)
def handle_401(error):
    try:
        return render_template('network-access-info.html', code=401, message='Session Expired'), 401
    except Exception:
        return '401 - Session Expired', 401

@admin_bp.route('/admin-dashboard')
def dashboard():
    if not is_admin():
        return redirect(url_for('login'))
    
    # Get dashboard statistics from service layer
    stats = get_dashboard_statistics()
    
    # Get recent activities from service layer
    recent_activities = get_recent_activities(limit=5)
    
    return render_template('admins/admin-dashboard.html',
                          qr_requests_count=stats['qr_requests_count'],
                          lost_items_count=stats['lost_items_count'],
                          found_items_count=stats['found_items_count'],
                          claimed_items_count=stats['claimed_items_count'],
                          recent_activities=recent_activities)

@admin_bp.route('/admin-notifications')
def admin_notifications():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/admin-notifications.html')

@admin_bp.route('/admin-review-history/<found_item_id>')
def admin_review_history_detail(found_item_id):
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/admin-review-history.html', found_item_id=found_item_id)

@admin_bp.route('/admin-review-history')
def admin_review_history():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/admin-review-history.html')

@admin_bp.route('/lost-item-report-details/<lost_item_id>')
def lost_item_report_details(lost_item_id):
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/lost-item-report-details.html')

@admin_bp.route('/manage-found-item')
def manage_found_item():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/manage-found-item.html')

@admin_bp.route('/manage-lost-item-report')
def manage_lost_item_report():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/manage-lost-item-report.html')

@admin_bp.route('/found-item-details/<found_item_id>')
def found_item_details(found_item_id):
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/post-found-item-details.html', found_item_id=found_item_id)

@admin_bp.route('/post-found-item', methods=['GET', 'POST'])
def post_found_item():
    if not is_admin():
        return redirect(url_for('login'))
    
    if request.method == 'GET':
        return render_template('admins/post-found-item.html')
    
    # Handle POST request - form submission
    try:
        # Get form data
        found_item_name = request.form.get('found_item_name')
        category = request.form.get('category')
        description = request.form.get('description')
        remarks = request.form.get('remarks', '')  # Optional field
        place_found = request.form.get('place_found')
        time_found = request.form.get('time_found')
        
        # Handle checkbox values properly - check for 'true' string from JavaScript
        is_valuable = request.form.get('is_valuable') in ['true', 'on', True]
        is_assigned_to_locker = request.form.get('is_assigned_to_locker') in ['true', 'on', True]
        locker_id = request.form.get('locker_id') if is_assigned_to_locker else None
        tags = request.form.get('tags', '[]')
        
        # Validate required fields
        if not all([found_item_name, category, description, place_found, time_found]):
            return jsonify({'success': False, 'message': 'Missing required fields'}), 400
        
        # Validate locker assignment if is_valuable is True
        if is_valuable and is_assigned_to_locker and not locker_id:
            return jsonify({'success': False, 'message': 'Locker ID is required for valuable items'}), 400
        
        # Parse tags from JSON string and store clean keywords (no hashtag prefix)
        import json
        try:
            tags_list = json.loads(tags)
            # Clean tags - remove hashtag prefix if present
            cleaned_tags = []
            for tag in tags_list:
                if isinstance(tag, str):
                    # Remove '#' prefix if present
                    clean_tag = tag.lstrip('#').strip()
                    if clean_tag:  # Only add non-empty tags
                        cleaned_tags.append(clean_tag)
            tags_list = cleaned_tags
        except:
            tags_list = []
        
        # Handle image uploads
        uploaded_images = []
        image_file = None
        for key in request.files:
            if key.startswith('image_'):
                file = request.files[key]
                if file and file.filename:
                    image_file = file
                    break  # Use the first image file
        
        if not image_file:
            return jsonify({'success': False, 'message': 'At least one image is required'}), 400
        
        # Prepare data for service layer
        item_data = {
            'found_item_name': found_item_name,
            'category': category,
            'description': description,
            'remarks': remarks,
            'place_found': place_found,
            'time_found': time_found,
            'is_valuable': is_valuable,
            'is_assigned_to_locker': is_assigned_to_locker,
            'locker_id': locker_id,
            'tags': tags_list
        }
        
        # Use service layer to create found item
        upload_folder = tempfile.mkdtemp()
        success, response_data, status_code = create_found_item(
            item_data, 
            image_file, 
            session.get('user_id'), 
            upload_folder
        )
        
        # Clean up temporary folder
        try:
            os.rmdir(upload_folder)
        except:
            pass
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Found item posted successfully!',
                'item_id': response_data.get('found_item_id')
            }), 200
        else:
            return jsonify({
                'success': False,
                'message': response_data.get('error', 'Failed to create found item')
            }), status_code
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error posting found item: {str(e)}'
        }), 500

@admin_bp.route('/qr-register-request')
def qr_register_request():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/qr-register-request.html')

@admin_bp.route('/admin-setting')
def admin_setting():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/admin-setting.html')

@admin_bp.route('/scan-qr-code')
def scan_qr_code():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/scan-qr-code.html')

@admin_bp.route('/report-export')
def report_export():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/report-export.html')

# =============================
# Report Export APIs
# =============================

def _parse_date_range():
    try:
        start_str = (request.args.get('start') or '').strip()
        end_str = (request.args.get('end') or '').strip()
        if not start_str or not end_str:
            end_dt = datetime.datetime.utcnow().date()
            start_dt = end_dt - datetime.timedelta(days=30)
        else:
            start_dt = datetime.datetime.fromisoformat(start_str).date()
            end_dt = datetime.datetime.fromisoformat(end_str).date()
        start = datetime.datetime.combine(start_dt, datetime.time.min)
        end = datetime.datetime.combine(end_dt + datetime.timedelta(days=1), datetime.time.min)
        return start.replace(tzinfo=None), end.replace(tzinfo=None)
    except Exception:
        now = datetime.datetime.utcnow().date()
        start = datetime.datetime.combine(now - datetime.timedelta(days=30), datetime.time.min)
        end = datetime.datetime.combine(now + datetime.timedelta(days=1), datetime.time.min)
        return start, end

@admin_bp.route('/api/reports/claim-verification', methods=['GET'])
def report_claim_verification():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        start, end = _parse_date_range()
        claims_ref = db.collection('claims')
        q = (claims_ref
             .where('created_at', '>=', start)
             .where('created_at', '<', end)
             .select(['claim_id','found_item_id','student_id','status','verification_method','created_at','approved_at'])
             .order_by('created_at'))
        rows = []
        item_ids = set()
        student_ids = set()
        status_counts = {'pending':0,'approved':0,'rejected':0,'verified':0}
        try:
            docs = list(q.stream())
        except FailedPrecondition:
            docs = list(claims_ref.select(['claim_id','found_item_id','student_id','status','verification_method','created_at','approved_at']).stream())
        for d in docs:
            data = d.to_dict() or {}
            s = str(data.get('status','')).lower()
            status_counts[s] = status_counts.get(s,0)+1
            item_id = data.get('found_item_id')
            student_id = data.get('student_id')
            if item_id: item_ids.add(item_id)
            if student_id: student_ids.add(student_id)
            rows.append({
                'claim_id': data.get('claim_id') or d.id,
                'found_item_id': item_id,
                'student_id': student_id,
                'status': s,
                'verification_method': data.get('verification_method'),
                'created_at': data.get('created_at'),
                'approved_at': data.get('approved_at')
            })

        items_map = {}
        for iid in list(item_ids):
            try:
                snap = db.collection('found_items').document(iid).get()
                if snap.exists:
                    items_map[iid] = snap.to_dict() or {}
            except Exception:
                pass
        users_map = {}
        for uid in list(student_ids):
            try:
                snap = db.collection('users').document(uid).get()
                if snap.exists:
                    users_map[uid] = snap.to_dict() or {}
            except Exception:
                pass
        lockers_map = {}
        for iid, item in items_map.items():
            lid = item.get('locker_id')
            if lid and lid not in lockers_map:
                try:
                    lsnap = db.collection('lockers').document(lid).get()
                    if lsnap.exists:
                        lockers_map[lid] = lsnap.to_dict() or {}
                except Exception:
                    pass

        enriched = []
        for r in rows:
            item = items_map.get(r.get('found_item_id'), {})
            user = users_map.get(r.get('student_id'), {})
            locker_id = item.get('locker_id')
            enriched.append({
                **r,
                'item_name': item.get('found_item_name') or item.get('name'),
                'category': item.get('category'),
                'locker_id': locker_id,
                'student_name': user.get('name'),
            })

        enriched.sort(key=lambda x: (x.get('created_at') or datetime.datetime.min))
        return jsonify({'success': True, 'rows': enriched, 'summary': status_counts, 'pagination': { 'total_items': len(enriched) }}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/reports/found-items-summary', methods=['GET'])
def report_found_items_summary():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        start, end = _parse_date_range()
        ref = db.collection('found_items')
        q1 = ref.where('created_at','>=',start).where('created_at','<',end).select(['category','status','is_valuable','created_at'])
        q2 = ref.where('time_found','>=',start).where('time_found','<',end).select(['category','status','is_valuable','time_found'])
        items = {}
        for snap in q1.stream(): items[snap.id] = snap.to_dict() or {}
        for snap in q2.stream(): items.setdefault(snap.id, snap.to_dict() or {})
        agg = {}
        ts_map = {}
        day_labels = []
        day_index = {}
        cur = start
        while cur < end:
            label = cur.strftime('%Y-%m-%d')
            day_index[label] = len(day_labels)
            day_labels.append(label)
            cur += datetime.timedelta(days=1)
        found_series = [0]*len(day_labels)
        claimed_series = [0]*len(day_labels)
        unclaimed_series = [0]*len(day_labels)
        for d in items.values():
            cat = (d.get('category') or 'Uncategorized')
            status = str(d.get('status','')).lower()
            valuable = bool(d.get('is_valuable'))
            when = d.get('created_at') or d.get('time_found')
            if hasattr(when,'strftime'):
                label = when.strftime('%Y-%m-%d')
                idx = day_index.get(label)
                if idx is not None:
                    found_series[idx] += 1
                    if status == 'claimed': claimed_series[idx] += 1
                    elif status == 'unclaimed': unclaimed_series[idx] += 1
            entry = agg.get(cat) or {'category':cat,'total':0,'claimed':0,'unclaimed':0,'valuable_count':0}
            entry['total'] += 1
            entry['valuable_count'] += (1 if valuable else 0)
            if status == 'claimed': entry['claimed'] += 1
            elif status == 'unclaimed': entry['unclaimed'] += 1
            agg[cat] = entry
        rows = []
        for v in agg.values():
            total = max(1, v['total'])
            rows.append({ 'category': v['category'], 'total': v['total'], 'claimed': v['claimed'], 'unclaimed': v['unclaimed'], 'valuable_pct': v['valuable_count']*100.0/total })
        rows.sort(key=lambda x: x['total'], reverse=True)
        return jsonify({'success': True, 'rows': rows, 'time_series': { 'labels': day_labels, 'found': found_series, 'claimed': claimed_series, 'unclaimed': unclaimed_series } }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/reports/unclaimed-items', methods=['GET'])
def report_unclaimed_items():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        start, end = _parse_date_range()
        ref = db.collection('found_items')
        q = (ref.where('status','==','unclaimed')
             .where('time_found','>=',start)
             .where('time_found','<',end)
             .select(['found_item_name','category','time_found','locker_id','uploaded_by','status']))
        docs = list(q.stream())
        rows = []
        review_cache = {}
        for snap in docs:
            d = snap.to_dict() or {}
            tf = d.get('time_found')
            days_unclaimed = 0
            try:
                if tf: days_unclaimed = max(0, (datetime.datetime.utcnow() - tf).days)
            except Exception:
                pass
            admin_review_status = None
            try:
                rev_stream = db.collection('admin_reviews').where('found_item_id','==', snap.id).order_by('review_date', direction=firestore.Query.DESCENDING).limit(1).stream()
                for r in rev_stream:
                    admin_review_status = (r.to_dict() or {}).get('review_status')
                    break
            except Exception:
                pass
            notifications = []
            try:
                notif_stream = db.collection('notifications').where('user_id','==', d.get('uploaded_by')).order_by('timestamp', direction=firestore.Query.DESCENDING).limit(20).stream()
                for n in notif_stream:
                    nd = n.to_dict() or {}
                    link = str(nd.get('link',''))
                    if snap.id in link:
                        notifications.append({ 'title': nd.get('title',''), 'timestamp': nd.get('timestamp') })
                    if len(notifications) >= 5:
                        break
            except Exception:
                pass
            rows.append({
                'found_item_id': snap.id,
                'item_name': d.get('found_item_name') or d.get('name') or 'Unknown',
                'category': d.get('category'),
                'time_found': tf,
                'days_unclaimed': days_unclaimed,
                'admin_review_status': admin_review_status,
                'locker_id': d.get('locker_id'),
                'notifications': notifications
            })
        rows.sort(key=lambda x: x['days_unclaimed'], reverse=True)
        return jsonify({'success': True, 'rows': rows, 'pagination': { 'total_items': len(rows) }}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/report-analytics')
def report_analytics():
    if not is_admin():
        return redirect(url_for('login'))
    # Render analytics page; charts fetch live data from Firebase via APIs below.
    # No mock or placeholder datasets are passed to the template.
    return render_template('admins/report-analytics.html')

# =============================
# Analytics API Endpoints for Charts
# =============================

def _month_buckets_last_12():
    """Helper: build last 12 month buckets and labels.
    Returns a list of dicts: { 'start': datetime, 'end': datetime, 'label': 'Jan' }
    """
    now = datetime.datetime.utcnow()
    # Normalize to first day of current month
    month_start = datetime.datetime(now.year, now.month, 1)
    buckets = []
    for i in range(11, -1, -1):
        # Compute start of bucket i months ago
        year = month_start.year
        month = month_start.month - i
        while month <= 0:
            month += 12
            year -= 1
        start = datetime.datetime(year, month, 1)
        # Compute end as start of next month
        end_year = year + (1 if month == 12 else 0)
        end_month = 1 if month == 12 else month + 1
        end = datetime.datetime(end_year, end_month, 1)
        label = start.strftime('%b')
        buckets.append({'start': start, 'end': end, 'label': label})
    return buckets

def _safe_dt(value):
    """Coerce Firestore timestamp/datetime to naive UTC datetime for comparison.
    - If tz-aware, convert to UTC and drop tzinfo
    - If naive, return as-is
    - If None or invalid, return None
    """
    try:
        if value is None:
            return None
        if hasattr(value, 'tzinfo') and value.tzinfo is not None:
            return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        return value
    except Exception:
        return None

@admin_bp.route('/api/analytics/item-handling-monthly', methods=['GET'])
def analytics_item_handling_monthly():
    """Aggregates last 12 months of item handling stats.
    - Found: count of found_items created in month
    - Claimed: count of claims approved in month (proxy for item claims)
    - Unclaimed: count of found_items created in month that still have status 'unclaimed'
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        # Build 12 monthly buckets and restrict query windows to avoid full scans
        buckets = _month_buckets_last_12()
        labels = [b['label'] for b in buckets]
        range_start = buckets[0]['start']
        range_end = buckets[-1]['end']

        # Optimize found_items query: select only fields used and restrict by time
        found_items_ref = db.collection('found_items')
        # We have two possible date fields; Firestore does not support OR in a single query.
        # Perform two efficient range queries and merge results by id.
        q_created = (
            found_items_ref
            .where('created_at', '>=', range_start)
            .where('created_at', '<', range_end)
            .order_by('created_at')
            .select(['created_at', 'status'])
            .limit(5000)
        )
        q_time_found = (
            found_items_ref
            .where('time_found', '>=', range_start)
            .where('time_found', '<', range_end)
            .order_by('time_found')
            .select(['time_found', 'status'])
            .limit(5000)
        )

        # Merge snapshots, deduplicate by document id
        merged = {}
        for snap in q_created.stream():
            merged[snap.id] = snap.to_dict() or {}
        for snap in q_time_found.stream():
            if snap.id not in merged:
                merged[snap.id] = snap.to_dict() or {}

        found_counts = [0] * len(buckets)
        unclaimed_counts = [0] * len(buckets)
        for data in merged.values():
            created = _safe_dt(data.get('created_at')) or _safe_dt(data.get('time_found'))
            status = str(data.get('status', '')).strip().lower()
            if not created:
                continue
            for idx, b in enumerate(buckets):
                if b['start'] <= created < b['end']:
                    found_counts[idx] += 1
                    if status == 'unclaimed':
                        unclaimed_counts[idx] += 1
                    break

        # Optimize claims query with indexed fields and selective retrieval
        claims_ref = db.collection('claims')
        claims_query = (
            claims_ref
            .where('status', '==', 'approved')
            .where('approved_at', '>=', range_start)
            .where('approved_at', '<', range_end)
            .order_by('approved_at')
            .select(['approved_at', 'status'])
            .limit(5000)
        )
        claimed_counts = [0] * len(buckets)
        try:
            for snap in claims_query.stream():
                data = snap.to_dict() or {}
                approved_at = _safe_dt(data.get('approved_at'))
                if not approved_at:
                    continue
                for idx, b in enumerate(buckets):
                    if b['start'] <= approved_at < b['end']:
                        claimed_counts[idx] += 1
                        break
        except FailedPrecondition:
            # Fallback to avoid composite index requirement: filter by time in Python
            fallback_stream = (
                claims_ref
                .where('status', '==', 'approved')
                .select(['approved_at', 'status'])
                .limit(10000)
                .stream()
            )
            for snap in fallback_stream:
                data = snap.to_dict() or {}
                approved_at = _safe_dt(data.get('approved_at'))
                if not approved_at or approved_at < range_start or approved_at >= range_end:
                    continue
                for idx, b in enumerate(buckets):
                    if b['start'] <= approved_at < b['end']:
                        claimed_counts[idx] += 1
                        break

        current_idx = len(buckets) - 1
        current_month_summary = {
            'found_total': found_counts[current_idx],
            'claimed_total': claimed_counts[current_idx]
        }

        return jsonify({
            'success': True,
            'labels': labels,
            'datasets': {
                'found': found_counts,
                'claimed': claimed_counts,
                'unclaimed': unclaimed_counts
            },
            'current_month_summary': current_month_summary
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/analytics/locker-usage', methods=['GET'])
def analytics_locker_usage():
    """Locker usage analytics.
    - Trend: for last 14 days or 12 weeks, count found items assigned to a locker
    - Occupancy: current lockers status counts (occupied vs available)
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        granularity = (request.args.get('granularity', 'day') or 'day').strip().lower()
        now = datetime.datetime.utcnow()

        # Build ranges based on granularity
        ranges = []  # list of (start, end, label)
        if granularity == 'week':
            today = now.date()
            last_monday = today - datetime.timedelta(days=today.weekday())
            for i in range(11, -1, -1):
                start_date = last_monday - datetime.timedelta(weeks=i)
                end_date = start_date + datetime.timedelta(days=7)
                start = datetime.datetime.combine(start_date, datetime.time.min)
                end = datetime.datetime.combine(end_date, datetime.time.min)
                ranges.append((start, end, f"Week of {start.strftime('%b %d')}"))
        else:
            for i in range(13, -1, -1):
                day = now.date() - datetime.timedelta(days=i)
                start = datetime.datetime.combine(day, datetime.time.min)
                end = datetime.datetime.combine(day + datetime.timedelta(days=1), datetime.time.min)
                ranges.append((start, end, day.strftime('%b %d')))

        labels = [r[2] for r in ranges]
        trend_counts = [0] * len(ranges)

        # Optimize query: restrict by time window and locker assignment flag
        range_start = ranges[0][0]
        range_end = ranges[-1][1]
        fi_ref = db.collection('found_items')
        q = (
            fi_ref
            .where('is_assigned_to_locker', '==', True)
            .where('created_at', '>=', range_start)
            .where('created_at', '<', range_end)
            .order_by('created_at')
            .select(['created_at'])
            .limit(5000)
        )
        # Also consider records that use time_found instead of created_at
        q_time = (
            fi_ref
            .where('is_assigned_to_locker', '==', True)
            .where('time_found', '>=', range_start)
            .where('time_found', '<', range_end)
            .order_by('time_found')
            .select(['time_found'])
            .limit(5000)
        )

        try:
            # Primary optimized queries (may require composite indexes)
            for snap in q.stream():
                data = snap.to_dict() or {}
                created = _safe_dt(data.get('created_at'))
                for idx, (start, end, _) in enumerate(ranges):
                    if created and start <= created < end:
                        trend_counts[idx] += 1
                        break
            for snap in q_time.stream():
                data = snap.to_dict() or {}
                tf = _safe_dt(data.get('time_found'))
                for idx, (start, end, _) in enumerate(ranges):
                    if tf and start <= tf < end:
                        trend_counts[idx] += 1
                        break
        except FailedPrecondition:
            # Fallback: degrade to a simpler query that avoids composite index requirements
            fallback_stream = (
                fi_ref
                .where('is_assigned_to_locker', '==', True)
                .select(['created_at', 'time_found'])
                .limit(10000)
                .stream()
            )
            for snap in fallback_stream:
                data = snap.to_dict() or {}
                created = _safe_dt(data.get('created_at'))
                tf = _safe_dt(data.get('time_found'))
                when = created or tf
                if not when:
                    continue
                for idx, (start, end, _) in enumerate(ranges):
                    if start <= when < end:
                        trend_counts[idx] += 1
                        break

        # Occupancy: only retrieve the status field for counting
        occupied = 0
        available = 0
        for doc in db.collection('lockers').select(['status']).stream():
            data = doc.to_dict() or {}
            status = str(data.get('status', '')).strip().lower()
            if status == 'occupied':
                occupied += 1
            else:
                available += 1

        return jsonify({
            'success': True,
            'labels': labels,
            'trend': trend_counts,
            'occupancy': { 'occupied': occupied, 'available': available }
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/analytics/qr-trend', methods=['GET'])
def analytics_qr_trend():
    """QR registration & approval trend over months.
    - Requests: number of claims created per month
    - Approvals: number of claims approved per month
    - Approval rate: approvals / requests for the period
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        period = (request.args.get('period', 'month') or 'month').strip().lower()
        buckets = _month_buckets_last_12()
        labels = [b['label'] for b in buckets]
        range_start = buckets[0]['start']
        range_end = buckets[-1]['end']

        requests_counts = [0] * len(buckets)
        approvals_counts = [0] * len(buckets)

        claims_ref = db.collection('claims')
        # Requests: created_at in range
        q_requests = (
            claims_ref
            .where('created_at', '>=', range_start)
            .where('created_at', '<', range_end)
            .order_by('created_at')
            .select(['created_at'])
            .limit(5000)
        )
        for snap in q_requests.stream():
            data = snap.to_dict() or {}
            created_at = _safe_dt(data.get('created_at'))
            if not created_at:
                continue
            for idx, b in enumerate(buckets):
                if b['start'] <= created_at < b['end']:
                    requests_counts[idx] += 1
                    break

        # Approvals: status==approved and approved_at in range
        q_approvals = (
            claims_ref
            .where('status', '==', 'approved')
            .where('approved_at', '>=', range_start)
            .where('approved_at', '<', range_end)
            .order_by('approved_at')
            .select(['approved_at', 'status'])
            .limit(5000)
        )
        try:
            for snap in q_approvals.stream():
                data = snap.to_dict() or {}
                approved_at = _safe_dt(data.get('approved_at'))
                if not approved_at:
                    continue
                for idx, b in enumerate(buckets):
                    if b['start'] <= approved_at < b['end']:
                        approvals_counts[idx] += 1
                        break
        except FailedPrecondition:
            # Fallback: avoid composite indexes by filtering approvals in Python
            fallback_stream = (
                claims_ref
                .where('status', '==', 'approved')
                .select(['approved_at', 'status'])
                .limit(10000)
                .stream()
            )
            for snap in fallback_stream:
                data = snap.to_dict() or {}
                approved_at = _safe_dt(data.get('approved_at'))
                if not approved_at or approved_at < range_start or approved_at >= range_end:
                    continue
                for idx, b in enumerate(buckets):
                    if b['start'] <= approved_at < b['end']:
                        approvals_counts[idx] += 1
                        break

        total_requests = sum(requests_counts) or 0
        total_approvals = sum(approvals_counts) or 0
        approval_rate = (total_approvals / total_requests * 100.0) if total_requests > 0 else 0.0

        return jsonify({
            'success': True,
            'labels': labels,
            'requests': requests_counts,
            'approvals': approvals_counts,
            'approval_rate': approval_rate
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/analytics/verification-methods', methods=['GET'])
def analytics_verification_methods():
    """Verification method usage across claims.
    Buckets into three categories for simplicity:
    - 'QR + Face' (verification_method == 'qr_face')
    - 'QR + RFID' (verification_method == 'qr_rfid')
    - 'Manual/Other' (anything else or missing)
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        # Select only necessary field to reduce payload
        counts = {'QR + Face': 0, 'QR + RFID': 0, 'Manual/Other': 0}
        total = 0
        for doc in db.collection('claims').select(['verification_method']).stream():
            data = doc.to_dict() or {}
            method = str(data.get('verification_method', '')).strip().lower()
            if method == 'qr_face':
                counts['QR + Face'] += 1
            elif method == 'qr_rfid':
                counts['QR + RFID'] += 1
            else:
                counts['Manual/Other'] += 1
            total += 1

        methods = [
            { 'label': 'QR + Face', 'count': counts['QR + Face'] },
            { 'label': 'QR + RFID', 'count': counts['QR + RFID'] },
            { 'label': 'Manual/Other', 'count': counts['Manual/Other'] }
        ]

        top = max(methods, key=lambda m: m['count']) if methods else None
        top_method = None
        if top:
            pct = (top['count'] / total * 100.0) if total > 0 else 0.0
            top_method = { 'label': top['label'], 'count': top['count'], 'percent': pct }

        return jsonify({ 'success': True, 'methods': methods, 'top_method': top_method }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/analytics/top-found-categories', methods=['GET'])
def analytics_top_found_categories():
    """Top found item categories within a date range.
    Range options: last7, last30, semester (approx 120 days)
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        range_key = (request.args.get('range', 'last30') or 'last30').strip().lower()
        now = datetime.datetime.utcnow()
        if range_key == 'last7':
            start = now - datetime.timedelta(days=7)
        elif range_key == 'semester':
            start = now - datetime.timedelta(days=120)
        else:
            start = now - datetime.timedelta(days=30)

        start_naive = start.replace(tzinfo=None)
        counters = {}

        fi_ref = db.collection('found_items')
        q_created = (
            fi_ref
            .where('created_at', '>=', start_naive)
            .order_by('created_at')
            .select(['created_at', 'category'])
            .limit(5000)
        )
        q_time = (
            fi_ref
            .where('time_found', '>=', start_naive)
            .order_by('time_found')
            .select(['time_found', 'category'])
            .limit(5000)
        )
        for snap in q_created.stream():
            data = snap.to_dict() or {}
            created = _safe_dt(data.get('created_at'))
            if not created or created < start_naive:
                continue
            cat = (data.get('category') or '').strip() or 'Uncategorized'
            counters[cat] = counters.get(cat, 0) + 1
        for snap in q_time.stream():
            data = snap.to_dict() or {}
            tf = _safe_dt(data.get('time_found'))
            if not tf or tf < start_naive:
                continue
            cat = (data.get('category') or '').strip() or 'Uncategorized'
            counters[cat] = counters.get(cat, 0) + 1

        top_items = sorted(counters.items(), key=lambda kv: kv[1], reverse=True)[:10]
        labels = [k for k, _ in top_items]
        counts = [v for _, v in top_items]

        return jsonify({ 'success': True, 'labels': labels, 'counts': counts }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

# =============================================================
# Server-Sent Events (SSE) streams for real-time analytics
# =============================================================

def _sse_message(payload: dict) -> str:
    """Format payload as SSE data string.
    Uses only the 'data' field for simplicity; clients parse JSON.
    """
    try:
        return f"data: {json.dumps(payload)}\n\n"
    except Exception:
        # Fallback minimal message
        return "data: {\"success\": false}\n\n"

@admin_bp.route('/api/analytics/stream/item-handling')
def sse_item_handling():
    """Real-time stream for Item Handling Summary using Firestore on_snapshot.
    Sends aggregated monthly counts when relevant docs change.
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    buckets = _month_buckets_last_12()
    labels = [b['label'] for b in buckets]
    range_start = buckets[0]['start']
    range_end = buckets[-1]['end']

    def gen():
        q = queue.Queue(maxsize=100)
        stop_event = threading.Event()

        def compute_and_push():
            try:
                # Reuse optimized queries from REST endpoint for consistency
                found_counts = [0] * len(buckets)
                unclaimed_counts = [0] * len(buckets)

                fi_ref = db.collection('found_items')
                q_created = (
                    fi_ref.where('created_at', '>=', range_start)
                          .where('created_at', '<', range_end)
                          .order_by('created_at')
                          .select(['created_at', 'status'])
                          .limit(5000)
                )
                q_time = (
                    fi_ref.where('time_found', '>=', range_start)
                          .where('time_found', '<', range_end)
                          .order_by('time_found')
                          .select(['time_found', 'status'])
                          .limit(5000)
                )
                merged = {}
                for snap in q_created.stream():
                    merged[snap.id] = snap.to_dict() or {}
                for snap in q_time.stream():
                    if snap.id not in merged:
                        merged[snap.id] = snap.to_dict() or {}
                for data in merged.values():
                    created = _safe_dt(data.get('created_at')) or _safe_dt(data.get('time_found'))
                    if not created:
                        continue
                    status = str(data.get('status', '')).strip().lower()
                    for idx, b in enumerate(buckets):
                        if b['start'] <= created < b['end']:
                            found_counts[idx] += 1
                            if status == 'unclaimed':
                                unclaimed_counts[idx] += 1
                            break

                claims_ref = db.collection('claims')
                q_approvals = (
                    claims_ref.where('status', '==', 'approved')
                              .where('approved_at', '>=', range_start)
                              .where('approved_at', '<', range_end)
                              .order_by('approved_at')
                              .select(['approved_at'])
                              .limit(5000)
                )
                claimed_counts = [0] * len(buckets)
                for snap in q_approvals.stream():
                    data = snap.to_dict() or {}
                    approved_at = _safe_dt(data.get('approved_at'))
                    if not approved_at:
                        continue
                    for idx, b in enumerate(buckets):
                        if b['start'] <= approved_at < b['end']:
                            claimed_counts[idx] += 1
                            break

                event = {
                    'success': True,
                    'labels': labels,
                    'datasets': {
                        'found': found_counts,
                        'claimed': claimed_counts,
                        'unclaimed': unclaimed_counts
                    },
                    'meta': {
                        'read_time': datetime.datetime.utcnow().isoformat() + 'Z'
                    }
                }
                q.put(_sse_message(event))
            except Exception as e:
                q.put(_sse_message({'success': False, 'error': str(e)}))

        # Watchers: on any change, recompute lightweight aggregates
        watch_handles = []

        def on_found_snapshot(col_snapshot, changes, read_time):
            compute_and_push()

        def on_claims_snapshot(col_snapshot, changes, read_time):
            compute_and_push()

        try:
            watch_handles.append(
                db.collection('found_items').on_snapshot(on_found_snapshot)
            )
            watch_handles.append(
                db.collection('claims').on_snapshot(on_claims_snapshot)
            )
            # Push initial payload
            compute_and_push()
        except Exception as e:
            q.put(_sse_message({'success': False, 'error': f'watch-init: {str(e)}'}))

        # Keep-alive every 30s
        def keepalive():
            while not stop_event.is_set():
                try:
                    q.put("data: {\"event\": \"keepalive\"}\n\n")
                except Exception:
                    pass
                stop_event.wait(30)

        ka_thread = threading.Thread(target=keepalive, daemon=True)
        ka_thread.start()

        try:
            while not stop_event.is_set():
                try:
                    msg = q.get(timeout=1.0)
                    yield msg
                except queue.Empty:
                    continue
        finally:
            stop_event.set()
            # Unsubscribe watchers
            try:
                for w in watch_handles:
                    w.unsubscribe()
            except Exception:
                pass

    return Response(stream_with_context(gen()), mimetype='text/event-stream')


@admin_bp.route('/api/analytics/stream/locker-usage')
def sse_locker_usage():
    """Real-time stream for Locker Usage analytics.
    Recomputes trend/occupancy when relevant docs change.
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    granularity = (request.args.get('granularity', 'day') or 'day').strip().lower()

    def gen():
        q = queue.Queue(maxsize=100)
        stop_event = threading.Event()

        def compute_and_push():
            try:
                # Reuse logic of analytics_locker_usage
                now = datetime.datetime.utcnow()
                ranges = []
                if granularity == 'week':
                    today = now.date()
                    last_monday = today - datetime.timedelta(days=today.weekday())
                    for i in range(11, -1, -1):
                        start_date = last_monday - datetime.timedelta(weeks=i)
                        end_date = start_date + datetime.timedelta(days=7)
                        start = datetime.datetime.combine(start_date, datetime.time.min)
                        end = datetime.datetime.combine(end_date, datetime.time.min)
                        ranges.append((start, end, f"Week of {start.strftime('%b %d')}"))
                else:
                    for i in range(13, -1, -1):
                        day = now.date() - datetime.timedelta(days=i)
                        start = datetime.datetime.combine(day, datetime.time.min)
                        end = datetime.datetime.combine(day + datetime.timedelta(days=1), datetime.time.min)
                        ranges.append((start, end, day.strftime('%b %d')))

                labels = [r[2] for r in ranges]
                trend_counts = [0] * len(ranges)
                range_start = ranges[0][0]
                range_end = ranges[-1][1]

                fi_ref = db.collection('found_items')
                q1 = (fi_ref
                      .where('is_assigned_to_locker', '==', True)
                      .where('created_at', '>=', range_start)
                      .where('created_at', '<', range_end)
                      .order_by('created_at')
                      .select(['created_at'])
                      .limit(5000))
                q2 = (fi_ref
                      .where('is_assigned_to_locker', '==', True)
                      .where('time_found', '>=', range_start)
                      .where('time_found', '<', range_end)
                      .order_by('time_found')
                      .select(['time_found'])
                      .limit(5000))
                for snap in q1.stream():
                    dt = _safe_dt(snap.to_dict().get('created_at'))
                    for idx, (start, end, _) in enumerate(ranges):
                        if dt and start <= dt < end:
                            trend_counts[idx] += 1
                            break
                for snap in q2.stream():
                    dt = _safe_dt(snap.to_dict().get('time_found'))
                    for idx, (start, end, _) in enumerate(ranges):
                        if dt and start <= dt < end:
                            trend_counts[idx] += 1
                            break

                occupied = 0
                available = 0
                for doc in db.collection('lockers').select(['status']).stream():
                    status = str((doc.to_dict() or {}).get('status', '')).strip().lower()
                    if status == 'occupied':
                        occupied += 1
                    else:
                        available += 1

                event = {
                    'success': True,
                    'labels': labels,
                    'trend': trend_counts,
                    'occupancy': { 'occupied': occupied, 'available': available },
                    'meta': { 'read_time': datetime.datetime.utcnow().isoformat() + 'Z' }
                }
                q.put(_sse_message(event))
            except Exception as e:
                q.put(_sse_message({'success': False, 'error': str(e)}))

        watch_handles = []

        def on_found_snapshot(col_snapshot, changes, read_time):
            compute_and_push()

        def on_lockers_snapshot(col_snapshot, changes, read_time):
            compute_and_push()

        try:
            watch_handles.append(db.collection('found_items').on_snapshot(on_found_snapshot))
            watch_handles.append(db.collection('lockers').on_snapshot(on_lockers_snapshot))
            compute_and_push()
        except Exception as e:
            q.put(_sse_message({'success': False, 'error': f'watch-init: {str(e)}'}))

        def keepalive():
            while not stop_event.is_set():
                try:
                    q.put("data: {\"event\": \"keepalive\"}\n\n")
                except Exception:
                    pass
                stop_event.wait(30)

        stop_event = threading.Event()
        ka_thread = threading.Thread(target=keepalive, daemon=True)
        ka_thread.start()

        try:
            while not stop_event.is_set():
                try:
                    msg = q.get(timeout=1.0)
                    yield msg
                except queue.Empty:
                    continue
        finally:
            stop_event.set()
            try:
                for w in watch_handles:
                    w.unsubscribe()
            except Exception:
                pass

    return Response(stream_with_context(gen()), mimetype='text/event-stream')

@admin_bp.route('/manage-locker')
def manage_locker():
    if not is_admin():
        return redirect(url_for('login'))
    
    return render_template('admins/manage-locker.html')

# =============================
# Locker Management APIs
# =============================

@admin_bp.route('/api/lockers', methods=['GET'])
def get_lockers_api():
    """Return all lockers with key fields for the Manage Lockers page."""
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        lockers = []
        for doc in db.collection('lockers').stream():
            data = doc.to_dict() or {}
            assigned_item_id = data.get('assigned_item_id') or data.get('found_item_id') or ''
            item_name = data.get('item_name', '')
            if assigned_item_id and not item_name:
                try:
                    fi = db.collection('found_items').document(assigned_item_id).get()
                    if fi.exists:
                        item_name = (fi.to_dict() or {}).get('found_item_name', '')
                except Exception:
                    pass
            lockers.append({
                'id': doc.id,
                'status': str(data.get('status', '')).strip().lower(),
                'location': data.get('location', 'Unknown'),
                'item_name': item_name,
                'image_url': data.get('image_url', ''),
                'found_item_id': assigned_item_id,
                'assigned_item_id': assigned_item_id,
                'updated_at': data.get('updated_at'),
                'auto_close_at': data.get('auto_close_at'),
            })
        return jsonify({'success': True, 'lockers': lockers}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to fetch lockers: {str(e)}'}), 500


# Note: unify SSE message formatter. A single helper is defined earlier
# in this file as `def _sse_message(payload: dict) -> str`. Remove duplicate
# local definitions to avoid confusion and shadowing.


@admin_bp.route('/api/lockers/stream')
def sse_lockers_stream():
    """Real-time stream for lockers collection changes.
    Pushes a simplified list of lockers whenever the collection changes.
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    def gen():
        q = queue.Queue(maxsize=100)
        stop_event = threading.Event()

        def compute_and_push():
            try:
                payload = []
                for doc in db.collection('lockers').select(['status', 'location', 'item_name', 'image_url', 'found_item_id', 'assigned_item_id', 'updated_at', 'auto_close_at']).stream():
                    d = doc.to_dict() or {}
                    assigned_item_id = d.get('assigned_item_id') or d.get('found_item_id') or ''
                    item_name = d.get('item_name', '')
                    if assigned_item_id and not item_name:
                        try:
                            fi = db.collection('found_items').document(assigned_item_id).get()
                            if fi.exists:
                                item_name = (fi.to_dict() or {}).get('found_item_name', '')
                        except Exception:
                            pass
                    payload.append({
                        'id': doc.id,
                        'status': str(d.get('status', '')).strip().lower(),
                        'location': d.get('location', 'Unknown'),
                        'item_name': item_name,
                        'image_url': d.get('image_url', ''),
                        'found_item_id': assigned_item_id,
                        'assigned_item_id': assigned_item_id,
                        'updated_at': d.get('updated_at'),
                        'auto_close_at': d.get('auto_close_at'),
                    })
                q.put(_sse_message({'success': True, 'lockers': payload, 'meta': {'read_time': datetime.datetime.utcnow().isoformat() + 'Z'}}))
            except Exception as e:
                q.put(_sse_message({'success': False, 'error': str(e)}))

        watch_handle = None

        def on_lockers_snapshot(col_snapshot, changes, read_time):
            compute_and_push()

        try:
            watch_handle = db.collection('lockers').on_snapshot(on_lockers_snapshot)
            compute_and_push()
        except Exception as e:
            q.put(_sse_message({'success': False, 'error': f'watch-init: {str(e)}'}))

        def keepalive():
            while not stop_event.is_set():
                try:
                    q.put("data: {\"event\": \"keepalive\"}\n\n")
                except Exception:
                    pass
                stop_event.wait(30)

        ka_thread = threading.Thread(target=keepalive, daemon=True)
        ka_thread.start()

        try:
            while not stop_event.is_set():
                try:
                    msg = q.get(timeout=1.0)
                    yield msg
                except queue.Empty:
                    continue
        finally:
            stop_event.set()
            try:
                if watch_handle:
                    watch_handle.unsubscribe()
            except Exception:
                pass

    return Response(stream_with_context(gen()), mimetype='text/event-stream')


@admin_bp.route('/api/lockers/<locker_id>/open', methods=['POST'])
def open_locker_api(locker_id):
    """Set locker status to 'open' and store auto-close timestamp.
    Only allowed if current status is 'occupied'.
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        payload = request.get_json(silent=True) or {}
        duration_sec = int(payload.get('duration_sec') or 10)
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

        # Compute auto-close time
        close_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=duration_sec)

        ref.update({
            'status': 'open',
            'open_started_at': firestore.SERVER_TIMESTAMP,
            'opened_by': session.get('user_id'),
            'auto_close_at': close_at,
            'updated_at': firestore.SERVER_TIMESTAMP,
        })
        try:
            _notify_locker_event(locker_id, data, 'Locker opened', f'Locker {locker_id} opened for timed access', 'open')
        except Exception:
            pass
        return jsonify({'success': True, 'message': 'Locker opened', 'auto_close_at': close_at.isoformat() + 'Z'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to open locker: {str(e)}'}), 500


@admin_bp.route('/api/lockers/<locker_id>/close', methods=['POST'])
def close_locker_api(locker_id):
    """Revert locker status to 'occupied'.
    After the timed opening period finishes, lockers should generally
    return to the occupied state (item remains inside). If your workflow
    requires distinguishing between 'closed' vs 'occupied', consider adding
    a separate field (e.g., door_state) rather than overloading `status`.
    """
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

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
        try:
            _notify_locker_event(locker_id, data, 'Locker closed', f'Locker {locker_id} closed after timed access', 'close')
        except Exception:
            pass
        return jsonify({'success': True, 'message': 'Locker closed'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to close locker: {str(e)}'}), 500

# =============================
# Scheduler Control APIs
# =============================

@admin_bp.route('/api/scheduler/start', methods=['POST'])
def api_scheduler_start():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        start_scheduler()
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/stop', methods=['POST'])
def api_scheduler_stop():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        stop_scheduler()
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/jobs', methods=['GET'])
def api_scheduler_jobs():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        sch = get_scheduler()
        jobs = []
        for j in sch.get_jobs():
            jobs.append({
                'id': j.id,
                'name': j.name,
                'next_run': j.next_run_time.isoformat() + 'Z' if j.next_run_time else None,
                'trigger': str(j.trigger),
            })
        return jsonify({'success': True, 'jobs': jobs}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/status', methods=['GET'])
def api_scheduler_status():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        sch = get_scheduler()
        return jsonify({'success': True, 'running': sch.is_running}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/run/overdue', methods=['POST'])
def api_scheduler_run_overdue():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        sch = get_scheduler()
        sch._update_overdue_items_job()
        return jsonify({'success': True, 'message': 'Overdue items update executed'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/run/expired', methods=['POST'])
def api_scheduler_run_expired():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        sch = get_scheduler()
        sch.update_expired_claims()
        return jsonify({'success': True, 'message': 'Expired claims update executed'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/scheduler/expired-interval', methods=['POST'])
def api_scheduler_set_expired_interval():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        minutes = int((request.json or {}).get('minutes', 1))
        if minutes <= 0 or minutes > 1440:
            return jsonify({'success': False, 'error': 'Minutes must be between 1 and 1440'}), 400
        sch = get_scheduler()
        # Reschedule the existing job id
        trig = IntervalTrigger(minutes=minutes, timezone=timezone.utc)
        sch.scheduler.reschedule_job('update_expired_claims', trigger=trig)
        return jsonify({'success': True, 'minutes': minutes}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================
# AI Matching API
# =============================

@admin_bp.route('/api/ai-match/<lost_item_id>', methods=['GET'])
def api_ai_match(lost_item_id: str):
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        # Optional weights from query
        w_text = float(request.args.get('w_text', 0.5))
        w_image = float(request.args.get('w_image', 0.3))
        w_cat = float(request.args.get('w_cat', 0.1))
        w_tags = float(request.args.get('w_tags', 0.1))
        top3 = ai_match_top3(lost_item_id, (w_text, w_image, w_cat, w_tags))
        return jsonify({'success': True, 'matches': top3}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/register-student-rfid')
def register_student_rfid():
    if not is_admin():
        return redirect(url_for('login'))
    try:
        users_ref = db.collection('users')
        all_docs = list(users_ref.stream())
        students = []
        for doc in all_docs:
            data = doc.to_dict() or {}
            role = str(data.get('role', '')).lower()
            if role == 'admin':
                continue
            students.append({
                'id': doc.id,
                'user_id': data.get('user_id') or doc.id,
                'name': data.get('name') or '',
                'course': data.get('course') or data.get('department') or '',
                'email': data.get('email') or '',
                'rfid_id': data.get('rfid_id'),
                'contact_number': data.get('contact_number') or data.get('phone') or data.get('mobile')
            })
        students.sort(key=lambda u: (u.get('name') or '').lower())
        return render_template('admins/register-student-rfid.html', students=students)
    except Exception as e:
        return render_template('admins/register-student-rfid.html', students=[], error=str(e))

@admin_bp.route('/api/register-rfid', methods=['POST'])
def api_register_rfid():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id') or data.get('userid')
        rfid_id = data.get('rfid_id') or data.get('rfid_hex') or data.get('rfid_uid')
        if not user_id or not rfid_id:
            return jsonify({'success': False, 'error': 'Missing user_id or rfid_id'}), 400

        force = bool(data.get('force'))
        existing_doc = None
        q = db.collection('users').where('rfid_id', '==', rfid_id).stream()
        for doc in q:
            if doc.id != user_id:
                existing_doc = doc
                break
        if existing_doc and not force:
            existing = existing_doc.to_dict() or {}
            return jsonify({'success': False, 'error': f"RFID already assigned to {existing.get('user_id') or existing_doc.id}", 'assigned_to': existing.get('user_id') or existing_doc.id}), 409

        if existing_doc and force:
            try:
                db.collection('users').document(existing_doc.id).update({'rfid_id': None})
            except Exception:
                pass

        user_ref = db.collection('users').document(user_id)
        snap = user_ref.get()
        if not snap.exists:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        update_data = {'rfid_id': rfid_id}
        user_ref.update(update_data)
        return jsonify({'success': True, 'user_id': user_id, 'rfid_id': rfid_id}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/api/available-lockers')
def get_available_lockers_api():
    """API endpoint to get available lockers for found item assignment"""
    if not is_admin():
        return {'error': 'Unauthorized'}, 401
    
    try:
        # Get available lockers from database
        lockers_ref = db.collection('lockers')
        available_lockers = []
        
        # Query lockers with status 'empty' or 'available'
        for locker in lockers_ref.where('status', 'in', ['empty', 'available']).stream():
            locker_data = locker.to_dict()
            available_lockers.append({
                'id': locker.id,
                'name': f"{locker.id} - {locker_data.get('location', 'Unknown Location')}"
            })
        
        return {'lockers': available_lockers}, 200
        
    except Exception as e:
        return {'error': str(e)}, 500

# =============================
# QR Register Requests APIs
# =============================

@admin_bp.route('/api/qr-register-requests', methods=['GET'])
def get_qr_register_requests_api():
    """
    List valuable item claim requests that require admin action.
    Supports optional status filter and pagination.
    """
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        # Query params
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        status_filter = (request.args.get('status', 'pending') or 'pending').strip().lower()

        valid_statuses = ['pending', 'approved', 'rejected']
        statuses = valid_statuses if status_filter == 'all' else [status_filter]
        # Guard invalid status
        if any(s not in valid_statuses for s in statuses):
            statuses = ['pending']

        # Fetch claims for valuable items only
        claims_ref = db.collection('claims')
        # Firestore cannot chain 'in' and another filter in some index configurations.
        # We'll fetch client-side to avoid index issues and then filter.
        all_docs = list(claims_ref.stream())

        # Prepare results with client-side filtering
        filtered = []
        for doc in all_docs:
            data = doc.to_dict() or {}
            status_raw = str(data.get('status', '')).lower()
            # Normalize legacy 'pending_approval' to 'pending' for admin list
            status = 'pending' if status_raw in ['pending', 'pending_approval'] else status_raw
            if status not in statuses and status_filter != 'all':
                continue

            # Join found item and user details (best-effort)
            item_name = 'Unknown Item'
            category = ''
            place_found = ''
            time_found = None
            is_valuable_item = False
            try:
                if data.get('found_item_id'):
                    item_doc = db.collection('found_items').document(data['found_item_id']).get()
                    if item_doc.exists:
                        item = item_doc.to_dict() or {}
                        item_name = item.get('found_item_name') or item.get('name') or item_name
                        category = item.get('category', '')
                        place_found = item.get('place_found', '')
                        time_found = item.get('time_found')
                        is_valuable_item = bool(item.get('is_valuable', False))
            except Exception:
                pass

            # Only include claims for valuable items
            if not is_valuable_item:
                continue

            student_name = ''
            try:
                if data.get('student_id'):
                    stu_doc = db.collection('users').document(data['student_id']).get()
                    if stu_doc.exists:
                        stu = stu_doc.to_dict() or {}
                        student_name = stu.get('name', '')
            except Exception:
                pass

            filtered.append({
                'claim_id': doc.id,
                'found_item_id': data.get('found_item_id'),
                'item_name': item_name,
                'category': category,
                'place_found': place_found,
                'time_found': time_found,
                'is_valuable': is_valuable_item,
                'student_id': data.get('student_id'),
                'student_name': student_name,
                'student_remarks': data.get('student_remarks', ''),
                'status': status,
                'approved_by': data.get('approved_by'),
                'approved_at': data.get('approved_at'),
                'rejected_at': data.get('rejected_at'),
                'created_at': data.get('created_at'),
                'qr_image_url': data.get('qr_image_url', ''),
                'expires_at': data.get('expires_at'),
                'face_captured': bool(data.get('face_image_base64') or data.get('face_embedding')),
                'verification_method': data.get('verification_method', '')
            })

        # Sort by created_at DESC (fallback to None last)
        def sort_key(d):
            ts = d.get('created_at')
            try:
                return ts.timestamp() if hasattr(ts, 'timestamp') else 0
            except Exception:
                return 0
        filtered.sort(key=sort_key, reverse=True)

        # Pagination
        total_items = len(filtered)
        start_index = max((page - 1) * per_page, 0)
        end_index = start_index + per_page
        paginated = filtered[start_index:end_index]

        return jsonify({
            'success': True,
            'requests': paginated,
            'pagination': {
                'total_items': total_items,
                'current_page': page,
                'per_page': per_page,
                'total_pages': (total_items + per_page - 1) // per_page
            }
        }), 200
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/qr-register-requests/<claim_id>/approve', methods=['POST'])
def approve_qr_register_request_api(claim_id):
    """Approve a valuable item claim, allowing QR generation later."""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        admin_id = session.get('user_id')
        admin_check_ok, admin_result, _ = validate_admin_status_for_approval(admin_id)
        if not admin_check_ok:
            return jsonify({'error': 'Failed to validate admin'}), 500
        if not admin_result.get('is_valid'):
            return jsonify({'error': admin_result.get('error_reason', 'Admin not valid')}), 403

        # Get optional remarks
        data = request.get_json(silent=True) or {}
        admin_remarks = data.get('admin_remarks', '')

        claim_ref = db.collection('claims').document(claim_id)
        claim_doc = claim_ref.get()
        if not claim_doc.exists:
            return jsonify({'error': 'Claim not found'}), 404

        claim_data = claim_doc.to_dict() or {}
        current_status = str(claim_data.get('status', '')).lower()
        if current_status != 'pending':
            return jsonify({'error': f'Claim already processed (status={current_status})'}), 400

        # Approve atomically
        try:
            claim_ref.update({
                'status': 'approved',
                'approved_by': admin_id,
                'approved_at': firestore.SERVER_TIMESTAMP,
                'admin_remarks': admin_remarks
            })
            
            # Automatically cancel all other pending claims for the same item
            # This ensures only one approved claim per item
            found_item_id = claim_data.get('found_item_id')
            if found_item_id:
                try:
                    # Get all pending claims for this item (excluding the current one)
                    pending_claims_query = db.collection('claims').where('found_item_id', '==', found_item_id).where('status', '==', 'pending')
                    pending_claims = list(pending_claims_query.stream())
                    
                    for pending_doc in pending_claims:
                        if pending_doc.id != claim_id:  # Don't cancel the approved claim
                            pending_claim_ref = db.collection('claims').document(pending_doc.id)
                            pending_claim_ref.update({
                                'status': 'cancelled',
                                'cancelled_by': 'system_auto_cancellation',
                                'cancelled_at': firestore.SERVER_TIMESTAMP,
                                'cancellation_reason': 'Another claim was approved for this item'
                            })
                            
                            # Log the auto-cancellation
                            current_app.logger.info(f"Auto-cancelled pending claim {pending_doc.id} for item {found_item_id} after approving claim {claim_id}")
                            
                except Exception as cancel_err:
                    # Log the error but don't fail the approval
                    current_app.logger.error(f"Error auto-cancelling pending claims for item {found_item_id}: {str(cancel_err)}")
            
        except Exception as ue:
            return jsonify({'error': f'Update failed: {str(ue)}'}), 500

        return jsonify({'success': True, 'claim_id': claim_id, 'new_status': 'approved'}), 200
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/qr-register-requests/<claim_id>/reject', methods=['POST'])
def reject_qr_register_request_api(claim_id):
    """Reject a valuable item claim. Student will be informed and cannot proceed."""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        admin_id = session.get('user_id')
        admin_check_ok, admin_result, _ = validate_admin_status_for_approval(admin_id)
        if not admin_check_ok:
            return jsonify({'error': 'Failed to validate admin'}), 500
        if not admin_result.get('is_valid'):
            return jsonify({'error': admin_result.get('error_reason', 'Admin not valid')}), 403

        # Get optional remarks
        data = request.get_json(silent=True) or {}
        admin_remarks = data.get('admin_remarks', '')

        claim_ref = db.collection('claims').document(claim_id)
        claim_doc = claim_ref.get()
        if not claim_doc.exists:
            return jsonify({'error': 'Claim not found'}), 404

        claim_data = claim_doc.to_dict() or {}
        current_status = str(claim_data.get('status', '')).lower()
        if current_status != 'pending':
            return jsonify({'error': f'Claim already processed (status={current_status})'}), 400

        # Reject atomically
        try:
            claim_ref.update({
                'status': 'rejected',
                'rejected_by': admin_id,
                'rejected_at': firestore.SERVER_TIMESTAMP,
                'admin_remarks': admin_remarks
            })
        except Exception as ue:
            return jsonify({'error': f'Update failed: {str(ue)}'}), 500

        return jsonify({'success': True, 'claim_id': claim_id, 'new_status': 'rejected'}), 200
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/upload-image', methods=['POST'])
def upload_image_api():
    """API endpoint to upload image and return image URL"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Check if image file is provided
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        if image_file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif'}
        if not ('.' in image_file.filename and 
                image_file.filename.rsplit('.', 1)[1].lower() in allowed_extensions):
            return jsonify({'error': 'Invalid file type. Only PNG, JPG, JPEG, and GIF are allowed'}), 400
        
        # Save the uploaded file temporarily and upload to Firebase Storage
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            image_file.save(temp_file.name)
            temp_path = temp_file.name
        
        try:
            # Import storage service
            from ..services.storage_service import upload_image_to_storage
            
            # Upload to Firebase Storage - pass the file path, not the file object
            success, result = upload_image_to_storage(temp_path, f"found_items/{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{image_file.filename}")
            
            # Clean up temporary file
            os.unlink(temp_path)
            
            if success:
                return jsonify({
                    'success': True,
                    'image_url': result,
                    'message': 'Image uploaded successfully'
                }), 200
            else:
                return jsonify({
                    'success': False,
                    'error': result,
                    'message': 'Failed to upload image'
                }), 500
            
        except Exception as upload_error:
            # Clean up temporary file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise upload_error
            
    except Exception as e:
        print(f"Error in upload_image_api: {str(e)}")
        return jsonify({'error': f'Failed to upload image: {str(e)}'}), 500

@admin_bp.route('/api/generate-tags', methods=['POST'])
def generate_tags_api():
    """API endpoint to generate AI tags from uploaded image"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Check if image file is provided
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        if image_file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif'}
        if not ('.' in image_file.filename and 
                image_file.filename.rsplit('.', 1)[1].lower() in allowed_extensions):
            return jsonify({'error': 'Invalid file type. Only PNG, JPG, JPEG, and GIF are allowed'}), 400
        
        # Save the uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            image_file.save(temp_file.name)
            temp_path = temp_file.name
        
        try:
            learned_raw = request.form.get('learned_tags')
            extra_candidates = []
            try:
                if learned_raw:
                    extra_candidates = json.loads(learned_raw)
            except Exception:
                extra_candidates = []
            result = generate_tags(temp_path, extra_candidates=extra_candidates)
            tags = result.get('tags', [])
            
            # Clean up temporary file
            os.unlink(temp_path)
            
            return jsonify({
                'success': True,
                'tags': tags,
                'message': f'Generated {len(tags)} tags successfully'
            }), 200
            
        except Exception as ai_error:
            # Clean up temporary file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            
            return jsonify({
                'success': False,
                'error': f'AI processing failed: {str(ai_error)}',
                'tags': []
            }), 500
            
    except Exception as e:
        print(f"Error in update_found_item_api: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/<item_id>', methods=['PUT'])
def update_found_item_api(item_id):
    """Update a found item"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Check if request contains files (FormData) or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            # Handle FormData request (with potential image uploads)
            data = {}
            
            # Extract form fields
            for key in request.form:
                value = request.form[key]
                if key == 'tags':
                    try:
                        data[key] = json.loads(value)
                    except:
                        data[key] = []
                elif key == 'time_found':
                    try:
                        data[key] = json.loads(value)
                    except:
                        data[key] = value
                elif key in ['is_valuable', 'is_assigned_to_locker']:
                    data[key] = value.lower() in ['true', '1', 'yes']
                else:
                    data[key] = value
            
            # Handle image uploads (similar to post-found-item)
            image_file = None
            for key in request.files:
                if key.startswith('image_'):
                    file = request.files[key]
                    if file and file.filename:
                        image_file = file
                        break  # Use the first image file
            
            # If there's a new image, upload it and update the image_url
            if image_file:
                from ..services.storage_service import upload_image_to_storage
                import tempfile
                
                # Save file temporarily
                temp_dir = tempfile.mkdtemp()
                temp_path = os.path.join(temp_dir, image_file.filename)
                image_file.save(temp_path)
                
                # Upload to storage
                success, result = upload_image_to_storage(temp_path)
                
                # Clean up temp file
                try:
                    os.remove(temp_path)
                    os.rmdir(temp_dir)
                except:
                    pass
                
                if success:
                    # If there's an existing image, append the new one
                    existing_image = data.get('image_url', '')
                    if existing_image and existing_image.strip():
                        data['image_url'] = f"{existing_image},{result}"
                    else:
                        data['image_url'] = result
                else:
                    return jsonify({'success': False, 'message': f'Failed to upload image: {result}'}), 500
        else:
            # Handle JSON request (no image uploads)
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400
        
        # Get the current item to verify it exists
        item_ref = db.collection('found_items').document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        # Prepare update data
        update_data = {}
        
        # Fields that can be updated
        updatable_fields = [
            'found_item_name', 'category', 'description', 
            'place_found', 'time_found', 'status', 'image_url',
            'tags', 'is_valuable', 'remarks', 'locker_id'
        ]
        
        for field in updatable_fields:
            if field in data:
                # Handle special field types
                if field == 'is_valuable':
                    # Convert to boolean
                    update_data[field] = bool(data[field])
                elif field == 'tags':
                    # Ensure tags is a list
                    if isinstance(data[field], list):
                        update_data[field] = data[field]
                    elif isinstance(data[field], str):
                        # If it's a string, split by comma and clean up
                        update_data[field] = [tag.strip() for tag in data[field].split(',') if tag.strip()]
                    else:
                        update_data[field] = []
                elif field == 'time_found':
                    # Process time_found - convert from datetime-local format to datetime object (consistent with create)
                    time_found_str = data[field]
                    if time_found_str:
                        try:
                            # Parse the datetime-local format (YYYY-MM-DDTHH:MM)
                            time_found_dt = datetime.datetime.fromisoformat(time_found_str)
                            update_data[field] = time_found_dt
                        except (ValueError, TypeError):
                            # If parsing fails, keep the original value
                            update_data[field] = data[field]
                    else:
                        update_data[field] = data[field]
                else:
                    update_data[field] = data[field]
        
        # Validate status if provided
        if 'status' in update_data:
            valid_statuses = ['unclaimed', 'claimed', 'returned']
            if update_data['status'] not in valid_statuses:
                return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        # Add updated timestamp
        update_data['updated_at'] = datetime.datetime.now()
        
        # Update the item
        item_ref.update(update_data)
        
        return jsonify({
            'success': True, 
            'message': 'Item updated successfully',
            'updated_fields': list(update_data.keys())
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


# Lost Item Report Management API Endpoints

@admin_bp.route('/api/lost-item-reports', methods=['GET'])
def get_lost_item_reports_api():
    """API endpoint to get lost item reports with pagination, search, filter, and sort functionality"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        from firebase_admin import firestore
        
        # Get query parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        search = request.args.get('search', '').strip()
        category_filter = request.args.get('category', '').strip()
        location_filter = request.args.get('location', '').strip()
        status_filter = request.args.get('status', '').strip()
        sort_column = request.args.get('sort_column', 'created_at')
        sort_direction = request.args.get('sort_direction', 'desc')
        
        # Check if this is default sorting (created_at DESC) or manual sorting
        is_default_sort = (sort_column == 'created_at' and sort_direction == 'desc')
        
        lost_items_ref = db.collection('lost_items')
        
        if is_default_sort:
            # For default sorting, use server-side ordering by created_at DESC
            query = lost_items_ref.order_by('created_at', direction=firestore.Query.DESCENDING)
        else:
            # For manual sorting, get all documents without server-side ordering to avoid index issues
            query = lost_items_ref
        
        # Get all documents from server
        all_docs = list(query.stream())
        
        # Apply client-side filtering
        filtered_docs = []
        for doc in all_docs:
            data = doc.to_dict()
            should_include = True
            
            # Apply category filter
            if category_filter and should_include:
                categories = [cat.strip() for cat in category_filter.split(',') if cat.strip()]
                if categories and data.get('category') not in categories:
                    should_include = False
            
            # Apply location filter
            if location_filter and should_include:
                locations = [loc.strip() for loc in location_filter.split(',') if loc.strip()]
                if locations and data.get('place_lost') not in locations:
                    should_include = False
            
            # Apply status filter (case-insensitive, support new statuses)
            if status_filter and should_include:
                statuses = [stat.strip().lower() for stat in status_filter.split(',') if stat.strip()]
                current_status = str(data.get('status','')).strip().lower().replace(' ', '_')
                # Map spaces to underscores for inputs like "in_progress"
                if statuses and current_status not in statuses:
                    should_include = False
            
            # Apply search filter
            if search and should_include:
                search_lower = search.lower()
                searchable_fields = [
                    str(data.get('item_name', '')),
                    str(data.get('description', '')),
                    str(data.get('category', '')),
                    str(data.get('place_lost', '')),
                    str(data.get('reported_by', '')),
                    str(data.get('tags', ''))
                ]
                if not any(search_lower in field.lower() for field in searchable_fields):
                    should_include = False
            
            if should_include:
                filtered_docs.append(doc)
        
        # Apply client-side sorting for manual sorting
        if not is_default_sort:
            def get_sort_key(doc):
                data = doc.to_dict()
                value = data.get(sort_column)
                
                # Handle different data types for sorting
                if value is None:
                    return '' if sort_column in ['item_name', 'category', 'place_lost', 'status', 'reported_by', 'lost_item_id'] else 0
                
                # Convert timestamps to comparable format
                if hasattr(value, 'timestamp'):
                    return value.timestamp()
                
                # Handle status-based ordering: non-final status before final status
                if sort_column == 'status':
                    final_statuses = ['Closed', 'Matched']
                    is_final = str(value) in final_statuses
                    # Return tuple: (is_final, status_value) for proper ordering
                    return (is_final, str(value).lower())
                
                # Handle ID sorting properly (LI0001, LI0002, etc.)
                if sort_column == 'lost_item_id':
                    # Extract numeric part for proper sorting
                    import re
                    match = re.search(r'(\d+)', str(value))
                    if match:
                        return int(match.group(1))
                    return 0
                
                return str(value).lower() if isinstance(value, str) else value
            
            reverse_sort = (sort_direction == 'desc')
            filtered_docs.sort(key=get_sort_key, reverse=reverse_sort)
        
        # Calculate pagination
        total_items = len(filtered_docs)
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        paginated_docs = filtered_docs[start_index:end_index]
        
        # Format the results
        reports = []
        for doc in paginated_docs:
            data = doc.to_dict()
            
            # Get reporter verification status
            reporter_verified = False
            if data.get('reported_by'):
                try:
                    user_doc = db.collection('users').document(data['reported_by']).get()
                    if user_doc.exists:
                        user_data = user_doc.to_dict()
                        reporter_verified = user_data.get('verified', False)
                except:
                    pass
            
            # Format the report
            report = {
                'id': doc.id,
                'lost_report_id': doc.id,  # Add this for JavaScript compatibility
                'item_name': data.get('item_name', ''),
                'lost_item_name': data.get('item_name', ''),  # Add this for JavaScript compatibility
                'category': data.get('category', ''),
                'description': data.get('description', ''),
                'tags': data.get('tags', ''),
                'place_lost': data.get('place_lost', ''),
                'last_seen_location': data.get('place_lost', ''),  # Add this for JavaScript compatibility
                'reported_by': data.get('reported_by', ''),
                'reporter_verified': reporter_verified,
                'date_lost': data.get('date_lost', ''),
                'report_date': data.get('created_at'),  # Add this for JavaScript compatibility
                'status': data.get('status', 'Open'),
                'matched_item_id': data.get('matched_item_id'),
                'admin_notes': data.get('admin_notes', ''),
                'admin_review_id': data.get('admin_review_id', ''),  # Add this for JavaScript compatibility
                'created_at': data.get('created_at'),
                'image_url': data.get('image_url', '')
            }
            reports.append(report)
        
        return jsonify({
            'success': True,
            'lost_reports': reports,
            'pagination': {
                'total_items': total_items,
                'current_page': page,
                'per_page': per_page,
                'total_pages': (total_items + per_page - 1) // per_page
            }
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-statistics', methods=['GET'])
def get_lost_item_statistics_api():
    """API endpoint to get lost item statistics for dashboard"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        lost_items_ref = db.collection('lost_items')
        
        # Get all lost items
        all_items = list(lost_items_ref.stream())
        
        # Calculate statistics
        total = len(all_items)
        open_count = 0
        matched_count = 0
        closed_count = 0
        
        for item in all_items:
            data = item.to_dict()
            status = data.get('status', 'Open').lower()
            
            if status == 'open':
                open_count += 1
            elif status == 'matched':
                matched_count += 1
            elif status == 'closed':
                closed_count += 1
        
        statistics = {
            'total': total,
            'open': open_count,
            'matched': matched_count,
            'closed': closed_count
        }
        
        return jsonify({
            'success': True,
            'statistics': statistics
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>', methods=['GET'])
def get_lost_item_report_api(report_id):
    """API endpoint to get a single lost item report by ID"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get the lost item document
        lost_item_ref = db.collection('lost_items').document(report_id)
        lost_item_doc = lost_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        # Get the document data
        lost_item_data = lost_item_doc.to_dict()
        lost_item_data['id'] = lost_item_doc.id
        
        # Convert datetime objects to strings for JSON serialization
        if 'created_at' in lost_item_data and lost_item_data['created_at']:
            lost_item_data['created_at'] = lost_item_data['created_at'].isoformat()
        if 'updated_at' in lost_item_data and lost_item_data['updated_at']:
            lost_item_data['updated_at'] = lost_item_data['updated_at'].isoformat()
        if 'date_lost' in lost_item_data and lost_item_data['date_lost']:
            if hasattr(lost_item_data['date_lost'], 'isoformat'):
                lost_item_data['date_lost'] = lost_item_data['date_lost'].isoformat()
        
        return jsonify({
            'success': True,
            'lost_report': lost_item_data
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>/notes', methods=['PUT'])
def update_lost_item_notes_api(report_id):
    """API endpoint to update admin notes for a lost item report"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        notes = data.get('notes', '')
        
        # Update the lost item document
        lost_item_ref = db.collection('lost_items').document(report_id)
        lost_item_doc = lost_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        # Update notes and timestamp
        lost_item_ref.update({
            'admin_notes': notes,
            'updated_at': datetime.datetime.now()
        })
        
        return jsonify({
            'success': True,
            'message': 'Notes updated successfully'
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>/status', methods=['PUT'])
def update_lost_item_status_api(report_id):
    """API endpoint to update status for a lost item report"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        new_status = data.get('status')
        
        if not new_status:
            return jsonify({'error': 'Status is required'}), 400
        
        # Normalize and validate status values (accept lowercase and new statuses)
        norm = (new_status or '').strip()
        norm = norm[0:1].upper() + norm[1:].lower() if norm else ''
        # Map common lowercase inputs
        mapping = {
            'open':'Open',
            'matched':'Matched',
            'closed':'Closed',
            'expired':'Expired',
            'in progress':'In Progress',
            'in_progress':'In Progress',
            'completed':'Completed'
        }
        status_final = mapping.get(new_status.lower(), norm)
        valid_statuses = ['Open','Matched','Closed','Expired','In Progress','Completed']
        if status_final not in valid_statuses:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        # Update the lost item document
        lost_item_ref = db.collection('lost_items').document(report_id)
        lost_item_doc = lost_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        # Update status and timestamp
        update_data = {
            'status': status_final,
            'updated_at': datetime.datetime.now()
        }
        
        # If status is being set to Matched, require matched_item_id
        if status_final == 'Matched':
            matched_item_id = data.get('matched_item_id')
            if matched_item_id:
                update_data['matched_item_id'] = matched_item_id
        
        lost_item_ref.update(update_data)
        
        return jsonify({
            'success': True,
            'message': f'Status updated to {status_final}',
            'new_status': status_final
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/bulk-update', methods=['PUT'])
def bulk_update_lost_items_api():
    """API endpoint to bulk update lost item reports"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        item_ids = data.get('item_ids', [])
        update_type = data.get('update_type')  # 'status' or 'notes'
        
        if not item_ids:
            return jsonify({'error': 'No items selected'}), 400
        
        if not update_type:
            return jsonify({'error': 'Update type is required'}), 400
        
        updated_count = 0
        errors = []
        
        for item_id in item_ids:
            try:
                lost_item_ref = db.collection('lost_items').document(item_id)
                lost_item_doc = lost_item_ref.get()
                
                if not lost_item_doc.exists:
                    errors.append(f'Item {item_id} not found')
                    continue
                
                update_data = {'updated_at': datetime.datetime.now()}
                
                if update_type == 'status':
                    new_status = data.get('status')
                    if new_status:
                        update_data['status'] = new_status
                elif update_type == 'notes':
                    notes = data.get('notes', '')
                    update_data['admin_notes'] = notes
                
                lost_item_ref.update(update_data)
                updated_count += 1
                
            except Exception as e:
                errors.append(f'Error updating item {item_id}: {str(e)}')
        
        return jsonify({
            'success': True,
            'message': f'Successfully updated {updated_count} items',
            'updated_count': updated_count,
            'errors': errors
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/export', methods=['POST'])
def export_lost_item_reports_api():
    """API endpoint to export lost item reports as CSV"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        import csv
        import io
        from flask import make_response
        
        data = request.get_json()
        selected_columns = data.get('columns', [])
        item_ids = data.get('item_ids', [])  # If empty, export all filtered items
        filters = data.get('filters', {})
        
        # Get lost items based on filters or selected IDs
        lost_items_ref = db.collection('lost_items')
        
        if item_ids:
            # Export specific items
            items = []
            for item_id in item_ids:
                doc = lost_items_ref.document(item_id).get()
                if doc.exists:
                    items.append({'id': doc.id, 'data': doc.to_dict()})
        else:
            # Export all items with current filters
            query = lost_items_ref
            
            # Apply filters (similar to get_lost_item_reports_api)
            if filters.get('category'):
                categories = [cat.strip() for cat in filters['category'].split(',') if cat.strip()]
                if categories:
                    query = query.where('category', 'in', categories)
            
            if filters.get('location'):
                locations = [loc.strip() for loc in filters['location'].split(',') if loc.strip()]
                if locations:
                    query = query.where('place_lost', 'in', locations)
            
            if filters.get('status'):
                statuses = [stat.strip() for stat in filters['status'].split(',') if stat.strip()]
                if statuses:
                    query = query.where('status', 'in', statuses)
            
            docs = list(query.stream())
            items = [{'id': doc.id, 'data': doc.to_dict()} for doc in docs]
        
        # Create CSV content
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Define all possible columns
        all_columns = {
            'id': 'Lost Item ID',
            'item_name': 'Item Name',
            'category': 'Category',
            'description': 'Description',
            'tags': 'Tags',
            'place_lost': 'Place Lost',
            'reported_by': 'Reported By',
            'date_lost': 'Date Lost',
            'status': 'Status',
            'matched_item_id': 'Matched Item ID',
            'admin_notes': 'Admin Notes',
            'created_at': 'Report Date'
        }
        
        # Use selected columns or all columns
        if not selected_columns:
            selected_columns = list(all_columns.keys())
        
        # Write header
        header = [all_columns.get(col, col) for col in selected_columns]
        writer.writerow(header)
        
        # Write data rows
        for item in items:
            row = []
            for col in selected_columns:
                if col == 'id':
                    value = item['id']
                elif col == 'created_at':
                    created_at = item['data'].get('created_at')
                    value = created_at.strftime('%Y-%m-%d %H:%M:%S') if created_at else ''
                else:
                    value = str(item['data'].get(col, ''))
                row.append(value)
            writer.writerow(row)
        
        # Create response
        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Type'] = 'text/csv'
        response.headers['Content-Disposition'] = 'attachment; filename=lost_item_reports.csv'
        
        return response
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>', methods=['DELETE'])
def delete_lost_item_report_api(report_id):
    """API endpoint to delete a lost item report"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get the lost item document
        lost_item_ref = db.collection('lost_items').document(report_id)
        lost_item_doc = lost_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        # Delete the document
        lost_item_ref.delete()
        
        return jsonify({
            'success': True,
            'message': 'Lost item report deleted successfully'
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>/auto-match', methods=['POST'])
def auto_match_lost_item_api(report_id):
    """API endpoint to find potential matches for a lost item report"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get the lost item
        lost_item_ref = db.collection('lost_items').document(report_id)
        lost_item_doc = lost_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        lost_item_data = lost_item_doc.to_dict()
        
        # Get all found items that are not yet claimed
        found_items_ref = db.collection('found_items')
        found_items_query = found_items_ref.where('status', 'in', ['Found', 'Verified'])
        found_items = list(found_items_query.stream())
        
        # Calculate match scores
        matches = []
        
        for found_doc in found_items:
            found_data = found_doc.to_dict()
            
            # Calculate similarity score based on multiple factors
            score = 0
            max_score = 100
            
            # Category match (30 points)
            if lost_item_data.get('category', '').lower() == found_data.get('category', '').lower():
                score += 30
            
            # Item name similarity (25 points)
            lost_name = lost_item_data.get('item_name', '').lower()
            found_name = found_data.get('item_name', '').lower()
            if lost_name and found_name:
                # Simple word matching
                lost_words = set(lost_name.split())
                found_words = set(found_name.split())
                if lost_words and found_words:
                    common_words = lost_words.intersection(found_words)
                    name_similarity = len(common_words) / max(len(lost_words), len(found_words))
                    score += int(name_similarity * 25)
            
            # Location proximity (20 points)
            lost_location = lost_item_data.get('place_lost', '').lower()
            found_location = found_data.get('location_found', '').lower()
            if lost_location and found_location:
                # Simple location matching (can be enhanced with actual distance calculation)
                if lost_location == found_location:
                    score += 20
                elif any(word in found_location for word in lost_location.split()):
                    score += 10
            
            # Date proximity (15 points)
            lost_date = lost_item_data.get('date_lost')
            found_date = found_data.get('date_found')
            if lost_date and found_date:
                try:
                    # Convert to datetime if they're strings
                    if isinstance(lost_date, str):
                        lost_date = datetime.strptime(lost_date, '%Y-%m-%d')
                    if isinstance(found_date, str):
                        found_date = datetime.strptime(found_date, '%Y-%m-%d')
                    
                    # Calculate date difference
                    date_diff = abs((found_date - lost_date).days)
                    if date_diff <= 1:
                        score += 15
                    elif date_diff <= 7:
                        score += 10
                    elif date_diff <= 30:
                        score += 5
                except:
                    pass
            
            # Description/tags similarity (10 points)
            lost_desc = (lost_item_data.get('description', '') + ' ' + lost_item_data.get('tags', '')).lower()
            found_desc = (found_data.get('description', '') + ' ' + found_data.get('tags', '')).lower()
            if lost_desc and found_desc:
                lost_desc_words = set(lost_desc.split())
                found_desc_words = set(found_desc.split())
                if lost_desc_words and found_desc_words:
                    common_desc_words = lost_desc_words.intersection(found_desc_words)
                    desc_similarity = len(common_desc_words) / max(len(lost_desc_words), len(found_desc_words))
                    score += int(desc_similarity * 10)
            
            # Only include matches with score > 20%
            if score >= 20:
                match = {
                    'found_item_id': found_doc.id,
                    'found_item_name': found_data.get('item_name', ''),
                    'found_category': found_data.get('category', ''),
                    'found_location': found_data.get('location_found', ''),
                    'found_date': found_data.get('date_found', ''),
                    'found_description': found_data.get('description', ''),
                    'found_image_url': found_data.get('image_url', ''),
                    'match_score': min(score, max_score),
                    'match_percentage': min(int((score / max_score) * 100), 100),
                    'match_factors': []
                }
                
                # Add match factors for explanation
                if score >= 30:
                    match['match_factors'].append('Category match')
                if 'name_similarity' in locals() and name_similarity > 0.5:
                    match['match_factors'].append('Similar item name')
                if lost_location and found_location and lost_location == found_location:
                    match['match_factors'].append('Same location')
                if 'date_diff' in locals() and date_diff <= 7:
                    match['match_factors'].append('Close date range')
                
                matches.append(match)
        
        # Sort by match score (highest first)
        matches.sort(key=lambda x: x['match_score'], reverse=True)
        
        # Limit to top 10 matches
        matches = matches[:10]
        
        return jsonify({
            'success': True,
            'lost_item_id': report_id,
            'lost_item_name': lost_item_data.get('item_name', ''),
            'matches': matches,
            'total_matches': len(matches)
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/lost-item-reports/<report_id>/confirm-match', methods=['POST'])
def confirm_match_lost_item_api(report_id):
    """API endpoint to confirm a match between lost and found items"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        found_item_id = data.get('found_item_id')
        
        if not found_item_id:
            return jsonify({'error': 'Found item ID is required'}), 400
        
        # Get both items
        lost_item_ref = db.collection('lost_items').document(report_id)
        found_item_ref = db.collection('found_items').document(found_item_id)
        
        lost_item_doc = lost_item_ref.get()
        found_item_doc = found_item_ref.get()
        
        if not lost_item_doc.exists:
            return jsonify({'error': 'Lost item report not found'}), 404
        
        if not found_item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        # Update both items
        current_time = datetime.now()
        
        # Update lost item status to Matched
        lost_item_ref.update({
            'status': 'Matched',
            'matched_item_id': found_item_id,
            'matched_at': current_time,
            'updated_at': current_time
        })
        
        # Update found item status to Matched
        found_item_ref.update({
            'status': 'Matched',
            'matched_lost_item_id': report_id,
            'matched_at': current_time,
            'updated_at': current_time
        })
        
        return jsonify({
            'success': True,
            'message': 'Match confirmed successfully',
            'lost_item_id': report_id,
            'found_item_id': found_item_id
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/lost-item-reports/export-selected', methods=['POST'])
def export_selected_lost_item_reports_api():
    """API endpoint to export selected lost item reports as CSV"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        import csv
        import io
        from flask import make_response
        
        data = request.get_json()
        selected_ids = data.get('selected_ids', [])
        columns = data.get('columns', ['id', 'item_name', 'category', 'place_lost', 'reported_by', 'date_lost', 'status'])
        sort_by = data.get('sort_by', 'created_at')
        sort_order = data.get('sort_order', 'desc')
        
        if not selected_ids:
            return jsonify({'error': 'No items selected'}), 400
        
        # Get selected lost items
        lost_items_ref = db.collection('lost_items')
        items = []
        
        for item_id in selected_ids:
            doc = lost_items_ref.document(item_id).get()
            if doc.exists:
                items.append({'id': doc.id, 'data': doc.to_dict()})
        
        # Sort items if needed
        if sort_by in ['created_at', 'updated_at', 'date_lost']:
            reverse = sort_order.lower() == 'desc'
            items.sort(key=lambda x: x['data'].get(sort_by, datetime.min), reverse=reverse)
        elif sort_by in ['item_name', 'category', 'status', 'place_lost']:
            reverse = sort_order.lower() == 'desc'
            items.sort(key=lambda x: x['data'].get(sort_by, ''), reverse=reverse)
        
        # Create CSV content
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Column headers mapping
        column_headers = {
            'id': 'Lost Item ID',
            'item_name': 'Item Name',
            'category': 'Category',
            'description': 'Description',
            'tags': 'Tags',
            'place_lost': 'Place Lost',
            'reported_by': 'Reported By',
            'date_lost': 'Date Lost',
            'status': 'Status',
            'matched_item_id': 'Matched Item ID',
            'report_duration': 'Report Duration (Days)',
            'admin_notes': 'Admin Notes',
            'created_at': 'Report Date'
        }
        
        # Write headers
        headers = [column_headers.get(col, col.title()) for col in columns]
        writer.writerow(headers)
        
        # Write data rows
        for item in items:
            row = []
            item_data = item['data']
            
            for col in columns:
                if col == 'id':
                    row.append(item['id'])
                elif col == 'item_name':
                    row.append(item_data.get('item_name', ''))
                elif col == 'category':
                    row.append(item_data.get('category', ''))
                elif col == 'description':
                    row.append(item_data.get('description', ''))
                elif col == 'tags':
                    tags = item_data.get('tags', [])
                    if isinstance(tags, list):
                        row.append(', '.join(tags))
                    else:
                        row.append(str(tags) if tags else '')
                elif col == 'place_lost':
                    row.append(item_data.get('place_lost', ''))
                elif col == 'reported_by':
                    row.append(item_data.get('reported_by', ''))
                elif col == 'date_lost':
                    date_lost = item_data.get('date_lost')
                    if date_lost:
                        if hasattr(date_lost, 'strftime'):
                            row.append(date_lost.strftime('%Y-%m-%d'))
                        else:
                            row.append(str(date_lost))
                    else:
                        row.append('')
                elif col == 'status':
                    row.append(item_data.get('status', 'Open'))
                elif col == 'matched_item_id':
                    row.append(item_data.get('matched_item_id', ''))
                elif col == 'report_duration':
                    created_at = item_data.get('created_at')
                    if created_at:
                        if item_data.get('status') in ['Open']:
                            duration = (datetime.now() - created_at).days
                        else:
                            updated_at = item_data.get('updated_at', datetime.now())
                            duration = (updated_at - created_at).days
                        row.append(duration)
                    else:
                        row.append('')
                elif col == 'admin_notes':
                    row.append(item_data.get('admin_notes', ''))
                elif col == 'created_at':
                    created_at = item_data.get('created_at')
                    if created_at:
                        if hasattr(created_at, 'strftime'):
                            row.append(created_at.strftime('%Y-%m-%d %H:%M:%S'))
                        else:
                            row.append(str(created_at))
                    else:
                        row.append('')
                else:
                    row.append('')
            writer.writerow(row)
        
        # Create response
        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Type'] = 'text/csv'
        response.headers['Content-Disposition'] = f'attachment; filename=lost-item-reports-selected-{datetime.now().strftime("%Y%m%d")}.csv'
        
        return response
        
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/status/update-overdue', methods=['POST'])
def update_overdue_status():
    """API endpoint to manually trigger overdue status updates"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        result = update_overdue_items()
        
        if result['success']:
            return jsonify({
                'success': True,
                'message': f'Successfully updated {result["updated_count"]} items to overdue status',
                'updated_count': result['updated_count'],
                'updated_items': result['updated_items']
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 500
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/<item_id>/update-status', methods=['PUT'])
def update_item_status(item_id):
    """API endpoint to update found item status with validation"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        new_status = data.get('status', '').lower()
        
        if not new_status:
            return jsonify({'error': 'Status is required'}), 400
        
        # Get current item
        item_ref = db.collection('found_items').document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        current_data = item_doc.to_dict()
        current_status = current_data.get('status', '').lower()
        
        # Check if current status allows edits
        if is_status_final(current_status):
            return jsonify({
                'error': f'Cannot update item with final status: {current_status}'
            }), 400
        
        # Validate status transition
        is_valid, error_message = validate_status_transition(current_status, new_status)
        if not is_valid:
            return jsonify({'error': error_message}), 400
        
        # Update the status
        update_data = {
            'status': new_status,
            'updated_at': datetime.datetime.now()
        }
        
        # Add status-specific fields
        if new_status in ['donated', 'discarded']:
            update_data['processed_at'] = datetime.datetime.now()
        elif new_status in ['claimed', 'returned']:
            update_data['completed_at'] = datetime.datetime.now()
        
        item_ref.update(update_data)
        
        return jsonify({
            'success': True,
            'message': f'Status updated from {current_status} to {new_status}',
            'new_status': new_status
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@admin_bp.route('/api/found-items/<item_id>', methods=['GET'])
def get_found_item_details_api(item_id):
    """API endpoint to get detailed information for a specific found item"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get the found item document
        found_item_doc = db.collection('found_items').document(item_id).get()
        
        if not found_item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        data = found_item_doc.to_dict()
        
        # Get admin name who uploaded the item
        admin_name = "Unknown Admin"
        admin_email = ""
        admin_mobile = ""
        admin_department = ""
        if data.get('uploaded_by'):
            try:
                admin_doc = db.collection('users').document(data['uploaded_by']).get()
                if admin_doc.exists:
                    admin_data = admin_doc.to_dict()
                    admin_name = admin_data.get('name', 'Unknown Admin')
                    admin_email = admin_data.get('email', '')
                    admin_mobile = admin_data.get('mobile_phone', '')
                    admin_department = admin_data.get('department', '')
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
            'uploaded_by_mobile': admin_mobile,
            'uploaded_by_department': admin_department,
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
        
        return jsonify({
            'success': True,
            'data': item_details
        })
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/generate-description', methods=['POST'])
def generate_description_api():
    """API endpoint to generate AI description from uploaded image"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Check if image file is provided
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        if image_file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif'}
        if not ('.' in image_file.filename and 
                image_file.filename.rsplit('.', 1)[1].lower() in allowed_extensions):
            return jsonify({'error': 'Invalid file type. Only PNG, JPG, JPEG, and GIF are allowed'}), 400
        
        # Save the uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as temp_file:
            image_file.save(temp_file.name)
            temp_path = temp_file.name
        
        try:
            # Import the caption generation function
            from ..ai_image_tagging import generate_caption_for_image
            
            # Generate description using AI
            description = generate_caption_for_image(temp_path)
            
            # Clean up temporary file
            os.unlink(temp_path)
            
            if description:
                return jsonify({
                    'success': True,
                    'description': description,
                    'message': 'Description generated successfully'
                }), 200
            else:
                return jsonify({
                    'success': False,
                    'error': 'Failed to generate description',
                    'description': ''
                }), 500
            
        except Exception as ai_error:
            # Clean up temporary file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            
            return jsonify({
                'success': False,
                'error': f'AI processing failed: {str(ai_error)}',
                'description': ''
            }), 500
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/bulk', methods=['GET'])
def get_found_items_bulk_api():
    """API endpoint to get found items with pagination support (5 records per page by default)"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        from firebase_admin import firestore
        
        # Get pagination and sorting parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 5))  # Default to 5 records per page
        search = request.args.get('search', '').strip().lower()
        category_filter = request.args.get('category', '').strip()
        status_filter = request.args.get('status', '').strip()
        location_filter = request.args.get('location', '').strip()
        sort_by = request.args.get('sort_by', 'created_at')
        sort_direction = request.args.get('sort_direction', 'desc')
        
        # Validate pagination parameters
        if page < 1:
            page = 1
        if per_page < 1 or per_page > 50:  # Limit max per page to 50
            per_page = 5
        
        # Get all found items for filtering and pagination
        found_items_ref = db.collection('found_items')
        query = found_items_ref.order_by('created_at', direction=firestore.Query.DESCENDING)
        
        all_docs = list(query.stream())
        
        # Collect categories and locations for filters
        categories = set()
        locations = set()
        
        # Filter items based on search and filter criteria
        filtered_items = []
        
        for doc in all_docs:
            data = doc.to_dict()
            
            # Collect filter options
            if data.get('category'):
                categories.add(data['category'])
            if data.get('place_found'):
                locations.add(data['place_found'])
            
            # Apply filters
            if category_filter and data.get('category') != category_filter:
                continue
            if status_filter and data.get('status') != status_filter:
                continue
            if location_filter and data.get('place_found') != location_filter:
                continue
            
            # Apply search filter
            if search:
                searchable_text = ' '.join([
                    data.get('found_item_name', '').lower(),
                    data.get('description', '').lower(),
                    data.get('category', '').lower(),
                    data.get('place_found', '').lower()
                ])
                if search not in searchable_text:
                    continue
            
            # Get admin name
            admin_name = "Unknown Admin"
            if data.get('uploaded_by'):
                try:
                    admin_doc = db.collection('users').document(data['uploaded_by']).get()
                    if admin_doc.exists:
                        admin_name = admin_doc.to_dict().get('name', 'Unknown Admin')
                except:
                    pass
            
            # Format the item to match frontend expectations
            item = {
                'found_item_id': data.get('found_item_id', doc.id),
                'found_item_name': data.get('found_item_name', ''),
                'category': data.get('category', ''),
                'description': data.get('description', ''),
                'place_found': data.get('place_found', ''),
                'time_found': data.get('time_found'),
                'image_url': data.get('image_url', ''),
                'status': data.get('status', 'unclaimed'),
                'uploaded_by': admin_name,
                'created_at': data.get('created_at'),
                'locker_id': data.get('locker_id', ''),
                'tags': data.get('tags', []),
                'is_valuable': data.get('is_valuable', False),
                'is_assigned_to_locker': data.get('is_assigned_to_locker', False),
                'remarks': data.get('remarks', '')
            }
            filtered_items.append(item)
        
        # Sort the filtered items
        def get_sort_key(item):
            value = item.get(sort_by, '')
            
            if sort_by in ['time_found', 'created_at']:
                # Handle datetime objects
                if hasattr(value, 'timestamp'):
                    return value.timestamp()
                elif isinstance(value, str):
                    try:
                        from datetime import datetime
                        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
                    except:
                        return 0
                return 0
            elif sort_by == 'storage_duration':
                # Calculate storage duration for sorting
                if item.get('time_found'):
                    try:
                        from datetime import datetime
                        time_found = item['time_found']
                        if hasattr(time_found, 'timestamp'):
                            time_found_dt = datetime.fromtimestamp(time_found.timestamp())
                        else:
                            time_found_dt = datetime.fromisoformat(str(time_found).replace('Z', '+00:00'))
                        duration = (datetime.now() - time_found_dt).days
                        return duration
                    except:
                        return 0
                return 0
            else:
                # Handle string sorting (case-insensitive)
                return str(value).lower() if value else ''
        
        # Sort items
        reverse_sort = sort_direction.lower() == 'desc'
        filtered_items.sort(key=get_sort_key, reverse=reverse_sort)
        
        # Calculate pagination
        total_items = len(filtered_items)
        total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        
        # Get items for current page
        paginated_items = filtered_items[start_index:end_index]
        
        return jsonify({
            'success': True,
            'found_items': paginated_items,
            'pagination': {
                'current_page': page,
                'per_page': per_page,
                'total_items': total_items,
                'total_pages': total_pages,
                'has_next': page < total_pages,
                'has_prev': page > 1
            },
            'filters': {
                'categories': sorted(list(categories)),
                'locations': sorted(list(locations))
            }
        })
    
    except Exception as e:
        print(f"Error in get_found_items_bulk_api: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items', methods=['GET'])
def get_found_items_api():
    """API endpoint to get found items with pagination, search, filter, and sort functionality"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        from firebase_admin import firestore
        
        # Get query parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        search = request.args.get('search', '').strip()
        category_filter = request.args.get('category', '').strip()
        status_filter = request.args.get('status', '').strip()
        location_filter = request.args.get('location', '').strip()
        sort_by = request.args.get('sort_by', 'created_at')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Start with base query
        found_items_ref = db.collection('found_items')
        
        # Apply status filter (default to all items if no filter specified)
        if status_filter:
            query = found_items_ref.where('status', '==', status_filter)
        else:
            query = found_items_ref
        
        # Apply other filters
        if category_filter:
            query = query.where('category', '==', category_filter)
        
        if location_filter:
            query = query.where('place_found', '==', location_filter)
        
        # Apply sorting
        direction = firestore.Query.DESCENDING if sort_order == 'desc' else firestore.Query.ASCENDING
        query = query.order_by(sort_by, direction=direction)
        
        # For search functionality, we need to get all docs for text search
        # This is a limitation of Firestore - text search requires client-side filtering
        if search:
            # Get all matching documents for search
            all_docs = list(query.stream())
            
            # Apply search filter (client-side filtering for text search)
            search_lower = search.lower()
            filtered_docs = []
            for doc in all_docs:
                data = doc.to_dict()
                # Include tags in search
                tags_text = ' '.join(data.get('tags', [])) if data.get('tags') else ''
                searchable_text = f"{data.get('found_item_name', '')} {data.get('description', '')} {data.get('category', '')} {data.get('place_found', '')} {tags_text}".lower()
                if search_lower in searchable_text:
                    filtered_docs.append(doc)
            
            # Calculate pagination for filtered results
            total_items = len(filtered_docs)
            total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
            start_index = (page - 1) * per_page
            end_index = start_index + per_page
            
            # Get items for current page
            page_docs = filtered_docs[start_index:end_index]
        else:
            # Use Firestore native pagination when no search is applied
            # Apply pagination using Firestore's limit and offset
            offset = (page - 1) * per_page
            paginated_query = query.offset(offset).limit(per_page)
            page_docs = list(paginated_query.stream())
            
            # For total count, we'll use a more efficient approach
            # Instead of loading all documents, we'll use a reasonable estimate
            # or implement a counter document in production
            total_items = offset + len(page_docs)
            if len(page_docs) == per_page:
                # There might be more items, add buffer for pagination
                total_items += per_page
            total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
        
        # Format items for response
        found_items = []
        for doc in page_docs:
            data = doc.to_dict()
            
            # Get admin name
            admin_name = "Unknown Admin"
            if data.get('uploaded_by'):
                try:
                    admin_doc = db.collection('users').document(data['uploaded_by']).get()
                    if admin_doc.exists:
                        admin_name = admin_doc.to_dict().get('name', 'Unknown Admin')
                except:
                    pass
            
            # Format timestamps
            created_at = data.get('created_at')
            time_found = data.get('time_found')
            
            # Format the item to match frontend expectations
            item = {
                'found_item_id': data.get('found_item_id', doc.id),
                'found_item_name': data.get('found_item_name', ''),
                'category': data.get('category', ''),
                'description': data.get('description', ''),
                'place_found': data.get('place_found', ''),
                'time_found': time_found,
                'image_url': data.get('image_url', ''),
                'status': data.get('status', 'unclaimed'),
                'uploaded_by': admin_name,
                'created_at': created_at,
                'locker_id': data.get('locker_id', ''),
                'tags': data.get('tags', []),
                'is_valuable': data.get('is_valuable', False),
                'is_assigned_to_locker': data.get('is_assigned_to_locker', False),
                'remarks': data.get('remarks', '')
            }
            found_items.append(item)
        
        # Get unique categories and locations for filter options
        # Use a more efficient approach - cache these values or get from a smaller subset
        try:
            # Get a sample of items for filter options instead of all items
            sample_query = db.collection('found_items').limit(100)
            sample_items = list(sample_query.stream())
            
            categories = set()
            locations = set()
            for doc in sample_items:
                data = doc.to_dict()
                if data.get('category'):
                    categories.add(data['category'])
                if data.get('place_found'):
                    locations.add(data['place_found'])
        except Exception as e:
            # Fallback to empty sets if there's an error
            categories = set()
            locations = set()
        
        return jsonify({
            'success': True,
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
        })
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/<item_id>', methods=['DELETE'])
def delete_found_item_api(item_id):
    """API endpoint to delete a found item"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        from ..services.found_item_service import delete_found_item
        
        success, result, status_code = delete_found_item(item_id)
        
        if success:
            return jsonify({'success': True, 'message': 'Item deleted successfully'}), 200
        else:
            return jsonify({'error': result.get('error', 'Failed to delete item')}), status_code
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/<item_id>/status', methods=['PUT'])
def update_found_item_status_api(item_id):
    """API endpoint to update found item status"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        new_status = data.get('status')
        
        if not new_status:
            return jsonify({'error': 'Status is required'}), 400
        
        # Valid status values
        valid_statuses = ['unclaimed', 'claimed', 'returned']
        if new_status not in valid_statuses:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        # Get the current item to check if it's already claimed
        item_ref = db.collection('found_items').document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        current_data = item_doc.to_dict()
        current_status = current_data.get('status', 'unclaimed')
        
        # Prevent status changes if already claimed (unless changing to returned)
        if current_status == 'claimed' and new_status not in ['returned', 'claimed']:
            return jsonify({'error': 'Cannot change status of claimed items except to returned'}), 400
        
        # Update the status
        item_ref.update({
            'status': new_status,
            'updated_at': datetime.datetime.now()
        })
        
        return jsonify({
            'success': True, 
            'message': f'Item status updated to {new_status}',
            'new_status': new_status
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/review', methods=['GET'])
def get_found_items_for_review_api():
    """API endpoint to get found items that exceed 31 days based on time_found and are not claimed"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        from firebase_admin import firestore
        from datetime import datetime, timedelta
        
        # Get query parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        search = request.args.get('search', '').strip()
        category_filter = request.args.get('category', '').strip()
        location_filter = request.args.get('location', '').strip()
        sort_by = request.args.get('sort_by', 'time_found')
        sort_order = request.args.get('sort_order', 'asc')
        
        # Calculate the cutoff date (31 days ago from time_found)
        cutoff_date = datetime.now() - timedelta(days=31)
        cutoff_timestamp = firestore.SERVER_TIMESTAMP
        
        # Start with base query - items not claimed
        found_items_ref = db.collection('found_items')
        query = found_items_ref.where('status', '!=', 'claimed')
        
        # Get all items first, then filter by date on the client side
        # This is because Firestore timestamp comparison can be tricky
        
        # Apply additional filters
        if category_filter:
            query = query.where('category', '==', category_filter)
        
        if location_filter:
            query = query.where('place_found', '==', location_filter)
        
        # Get all documents first (since we need to do client-side filtering for search and sorting)
        all_docs = list(query.stream())
        
        # Filter items that are older than 31 days based on time_found
        date_filtered_docs = []
        for doc in all_docs:
            data = doc.to_dict()
            time_found = data.get('time_found')
            if time_found:
                try:
                    # Handle different timestamp formats (now consistent with create/update)
                    if hasattr(time_found, 'timestamp'):
                        # Firestore timestamp object
                        found_date = datetime.fromtimestamp(time_found.timestamp())
                    elif isinstance(time_found, dict) and 'seconds' in time_found:
                        # Firestore timestamp as dict
                        found_date = datetime.fromtimestamp(time_found['seconds'])
                    elif isinstance(time_found, datetime):
                        # Already a datetime object (consistent format from create/update)
                        found_date = time_found
                    else:
                        # Skip if we can't parse the timestamp
                        continue
                    
                    # Check if item is older than 31 days
                    days_since_found = (datetime.now() - found_date).days
                    if days_since_found >= 31:
                        date_filtered_docs.append(doc)
                except Exception as e:
                    # Skip items with invalid timestamps
                    print(f"Error parsing timestamp for item {doc.id}: {e}")
                    continue
        
        all_docs = date_filtered_docs
        
        # Apply search filter if provided
        if search:
            search_lower = search.lower()
            filtered_docs = []
            for doc in all_docs:
                data = doc.to_dict()
                # Include tags in search
                tags_text = ' '.join(data.get('tags', [])) if data.get('tags') else ''
                searchable_text = f"{data.get('found_item_name', '')} {data.get('description', '')} {data.get('category', '')} {data.get('place_found', '')} {tags_text}".lower()
                if search_lower in searchable_text:
                    filtered_docs.append(doc)
            all_docs = filtered_docs
        
        # Sort documents
        def get_sort_value(doc):
            data = doc.to_dict()
            if sort_by == 'time_found':
                time_found = data.get('time_found')
                if time_found:
                    if hasattr(time_found, 'timestamp'):
                        return time_found.timestamp()
                    else:
                        return time_found.timestamp() if hasattr(time_found, 'timestamp') else 0
                return 0
            elif sort_by == 'found_item_name':
                return data.get('found_item_name', '').lower()
            elif sort_by == 'category':
                return data.get('category', '').lower()
            elif sort_by == 'days_since_found':
                time_found = data.get('time_found')
                if time_found:
                    if hasattr(time_found, 'timestamp'):
                        found_date = datetime.fromtimestamp(time_found.timestamp())
                    else:
                        found_date = time_found
                    return (datetime.now() - found_date).days
                return 0
            return 0
        
        all_docs.sort(key=get_sort_value, reverse=(sort_order == 'desc'))
        
        # Calculate pagination
        total_items = len(all_docs)
        total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
        start_index = (page - 1) * per_page
        end_index = start_index + per_page
        
        # Get items for current page
        page_docs = all_docs[start_index:end_index]
        
        # Format items for response
        found_items = []
        all_days = []
        
        for doc in page_docs:
            data = doc.to_dict()
            
            # Get admin name
            admin_name = "Unknown Admin"
            if data.get('uploaded_by'):
                try:
                    admin_doc = db.collection('users').document(data['uploaded_by']).get()
                    if admin_doc.exists:
                        admin_name = admin_doc.to_dict().get('name', 'Unknown Admin')
                except:
                    pass
            
            # Calculate days since found
            days_since_found = 0
            time_found = data.get('time_found')
            if time_found:
                try:
                    # Handle different timestamp formats (now consistent with create/update)
                    if hasattr(time_found, 'timestamp'):
                        # Firestore timestamp object
                        found_date = datetime.fromtimestamp(time_found.timestamp())
                    elif isinstance(time_found, dict) and 'seconds' in time_found:
                        # Firestore timestamp as dict
                        found_date = datetime.fromtimestamp(time_found['seconds'])
                    elif isinstance(time_found, datetime):
                        # Already a datetime object (consistent format from create/update)
                        found_date = time_found
                    else:
                        # Default to 0 if we can't parse
                        days_since_found = 0
                        found_date = None
                    
                    if found_date:
                        days_since_found = (datetime.now() - found_date).days
                except Exception as e:
                    print(f"Error calculating days for item {doc.id}: {e}")
                    days_since_found = 0
            
            all_days.append(days_since_found)
            
            # Format timestamps
            created_at = data.get('created_at')
            locker_assigned_at = data.get('locker_assigned_at')
            
            # Format the item to match frontend expectations
            item = {
                'id': doc.id,  # Use document ID as the item ID
                'found_item_id': data.get('found_item_id', doc.id),
                'found_item_name': data.get('found_item_name', ''),
                'category': data.get('category', ''),
                'description': data.get('description', ''),
                'place_found': data.get('place_found', ''),
                'time_found': time_found.isoformat() if hasattr(time_found, 'isoformat') else str(time_found) if time_found else None,
                'image_url': data.get('image_url', ''),
                'status': data.get('status', 'unclaimed'),
                'uploaded_by': admin_name,
                'created_at': created_at.isoformat() if hasattr(created_at, 'isoformat') else str(created_at) if created_at else None,
                'locker_id': data.get('locker_id', ''),
                'locker_assigned_at': locker_assigned_at.isoformat() if hasattr(locker_assigned_at, 'isoformat') else str(locker_assigned_at) if locker_assigned_at else None,
                'days_since_found': days_since_found,
                'tags': data.get('tags', []),
                'is_valuable': data.get('is_valuable', False),
                'is_assigned_to_locker': data.get('is_assigned_to_locker', False),
                'assigned_to_locker': data.get('is_assigned_to_locker', False),  # Add explicit locker assignment status
                'remarks': data.get('remarks', ''),
                'last_updated': data.get('updated_at', data.get('created_at'))
            }
            found_items.append(item)
        
        # Get unique categories and locations for filter options
        try:
            categories = set()
            locations = set()
            for doc in all_docs:  # Use all docs for complete filter options
                data = doc.to_dict()
                if data.get('category'):
                    categories.add(data['category'])
                if data.get('place_found'):
                    locations.add(data['place_found'])
        except Exception as e:
            categories = set()
            locations = set()
        
        # Calculate statistics
        stats = {
            'total_items': total_items,
            'avg_days_since_found': sum(all_days) / len(all_days) if all_days else 0,
            'oldest_item_days': max(all_days) if all_days else 0
        }
        
        return jsonify({
            'success': True,
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
            },
            'statistics': stats
        })
    
    except Exception as e:
        print(f"Error in get_found_items_for_review_api: {str(e)}")  # Debug logging
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/found-items/<item_id>/remove-from-locker', methods=['PUT'])
def remove_item_from_locker_api(item_id):
    """API endpoint to remove an item from locker assignment"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get the current item
        item_ref = db.collection('found_items').document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        current_data = item_doc.to_dict()
        
        # Check if item is currently assigned to a locker
        if not current_data.get('is_assigned_to_locker', False):
            return jsonify({'error': 'Item is not currently assigned to a locker'}), 400
        
        # Update the item to remove locker assignment
        item_ref.update({
            'is_assigned_to_locker': False,
            'locker_id': '',
            'locker_assigned_at': None,
            'updated_at': datetime.datetime.now(),
            'remarks': current_data.get('remarks', '') + f" | Removed from locker on {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        })
        
        return jsonify({
            'success': True, 
            'message': 'Item successfully removed from locker assignment'
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/admin-reviews', methods=['POST'])
def create_admin_review_api():
    """API endpoint to create admin review for overdue items"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        
        # Validate required fields
        found_item_id = data.get('found_item_id')
        review_status = data.get('review_status')
        notes = data.get('notes')
        
        if not all([found_item_id, review_status, notes]):
            return jsonify({'error': 'Missing required fields: found_item_id, review_status, notes'}), 400
        
        # Validate review status
        valid_statuses = ['donate', 'dispose', 'extend_storage', 'claimed', 'returned', 'donated', 'discarded']
        if review_status not in valid_statuses:
            return jsonify({'error': f'Invalid review status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        # Get current admin ID from session
        reviewed_by = session.get('user_id')
        if not reviewed_by:
            return jsonify({'error': 'Admin user ID not found in session'}), 401
        
        # Verify the found item exists
        item_ref = db.collection('found_items').document(found_item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            return jsonify({'error': 'Found item not found'}), 404
        
        item_data = item_doc.to_dict()
        # Allow review for items in any status, not just overdue
        # This enables more flexible admin review workflows
        
        # Create the admin review
        result = create_admin_review(found_item_id, reviewed_by, review_status, notes)
        
        if result['success']:
            return jsonify({
                'success': True,
                'message': result['message'],
                'review_id': result['review_id']
            }), 201
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 500
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/admin-reviews', methods=['GET'])
def get_admin_reviews_api():
    """API endpoint to get admin reviews with pagination, search, filtering, and sorting"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get pagination parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
        
        # Get search and filter parameters
        search = request.args.get('search', '').strip()
        status_filter = request.args.get('status', '').strip()
        
        # Get sorting parameters
        sort_by = request.args.get('sort_by', '').strip()
        sort_order = request.args.get('sort_order', 'asc').strip()
        
        # Calculate offset
        offset = (page - 1) * per_page
        
        # Get admin reviews with search, filter, and sorting
        result = get_admin_reviews(
            limit=per_page, 
            offset=offset, 
            search=search, 
            status_filter=status_filter,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        if result['success']:
            return jsonify({
                'success': True,
                'reviews': result['reviews'],
                'count': result['count'],
                'pagination': {
                    'current_page': page,
                    'per_page': per_page,
                    'total_items': result['count']
                }
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 500
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@admin_bp.route('/api/admin-reviews/<review_id>', methods=['GET'])
def get_admin_review_api(review_id):
    """API endpoint to get a specific admin review"""
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        result = get_admin_review_by_id(review_id)
        
        if result['success']:
            return jsonify({
                'success': True,
                'review': result['review']
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 404 if 'not found' in result['error'].lower() else 500
    
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500
def _notify_locker_event(locker_id: str, locker_data: dict, title: str, message: str, kind: str):
    try:
        assigned_item_id = locker_data.get('assigned_item_id') or locker_data.get('found_item_id')
        user_to_notify = None
        link = None
        item_name = None
        if assigned_item_id:
            fi = db.collection('found_items').document(assigned_item_id).get()
            if fi.exists:
                item = fi.to_dict() or {}
                item_name = item.get('found_item_name') or item.get('name')
                user_to_notify = item.get('uploaded_by') or item.get('claimed_by')
                link = url_for('admin.found_item_details', found_item_id=assigned_item_id)
        if not user_to_notify:
            user_to_notify = session.get('user_id')
        payload = {
            'user_id': user_to_notify,
            'title': title,
            'message': f"{message}{(' — ' + item_name) if item_name else ''}",
            'link': link or url_for('admin.manage_locker'),
            'type': f'locker_{kind}',
            'timestamp': datetime.datetime.utcnow(),
            'related_locker_id': locker_id,
            'related_item_id': assigned_item_id,
        }
        db.collection('notifications').add(payload)
    except Exception:
        pass

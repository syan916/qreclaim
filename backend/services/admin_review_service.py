"""
Admin Review Service
Handles admin review operations for overdue found items
"""

import datetime
from firebase_admin import firestore
from ..database import db

def generate_admin_review_id():
    """Generate a unique admin review ID"""
    try:
        # Get the latest review ID from Firestore
        reviews_ref = db.collection('admin_reviews')
        query = reviews_ref.order_by('review_id', direction=firestore.Query.DESCENDING).limit(1)
        docs = query.stream()
        
        latest_id = "AR0000"
        for doc in docs:
            latest_id = doc.to_dict().get('review_id', 'AR0000')
            break
        
        # Extract the numeric part and increment
        if latest_id.startswith('AR'):
            numeric_part = int(latest_id[2:])
            new_numeric_part = numeric_part + 1
            new_id = f"AR{new_numeric_part:04d}"
        else:
            new_id = "AR0001"
        
        return new_id
    except Exception as e:
        print(f"Error generating admin review ID: {str(e)}")
        return "AR0001"

def create_admin_review(found_item_id, reviewed_by, review_status, notes):
    """
    Create a new admin review for an overdue found item
    
    Args:
        found_item_id (str): ID of the found item being reviewed
        reviewed_by (str): ID of the admin performing the review
        review_status (str): Status of the review (donate, dispose, extend_storage)
        notes (str): Admin notes/remarks for the review
    
    Returns:
        dict: Result with success status, message, and review_id
    """
    try:
        # Generate unique review ID
        review_id = generate_admin_review_id()
        
        # Create the admin review document
        review_data = {
            'review_id': review_id,
            'found_item_id': found_item_id,
            'reviewed_by': reviewed_by,
            'review_status': review_status,
            'review_date': firestore.SERVER_TIMESTAMP,
            'notes': notes,
            'created_at': firestore.SERVER_TIMESTAMP,
            'updated_at': firestore.SERVER_TIMESTAMP
        }
        
        # Add the review to Firestore
        db.collection('admin_reviews').document(review_id).set(review_data)
        
        # Update the found item status based on review outcome
        item_ref = db.collection('found_items').document(found_item_id)
        
        # Map review status to item status
        status_mapping = {
            'donated': 'donated',
            'discarded': 'discarded',
            'returned': 'returned'
        }
        
        new_status = status_mapping.get(review_status, 'overdue')
        
        # Update the found item
        update_data = {
            'status': new_status,
            'updated_at': firestore.SERVER_TIMESTAMP,
            'admin_review_id': review_id
        }
        
        # Add specific fields based on review status
        if review_status == 'returned':
            # Item was returned to owner
            update_data['return_date'] = firestore.SERVER_TIMESTAMP
            update_data['remarks'] = f"Item returned via admin review {review_id}"
        elif review_status in ['donated', 'discarded']:
            update_data['disposal_date'] = firestore.SERVER_TIMESTAMP
            update_data['disposal_method'] = review_status
            update_data['remarks'] = f"Item {review_status} via admin review {review_id}"
        
        item_ref.update(update_data)
        
        return {
            'success': True,
            'message': f'Admin review created successfully. Item status updated to {new_status}.',
            'review_id': review_id
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to create admin review: {str(e)}'
        }

def get_admin_reviews(limit=20, offset=0, found_item_id=None, search=None, status_filter=None, sort_by=None, sort_order='asc'):
    """
    Get admin reviews with pagination and optional filtering
    
    Args:
        limit (int): Number of reviews to return
        offset (int): Number of reviews to skip
        found_item_id (str, optional): Filter by specific found item ID
        search (str, optional): Search term for item name, category, or notes
        status_filter (str, optional): Filter by review status
        sort_by (str, optional): Field to sort by
        sort_order (str, optional): Sort order ('asc' or 'desc')
    
    Returns:
        dict: Result with success status, reviews list, and count
    """
    try:
        reviews_ref = db.collection('admin_reviews')
        
        # Apply filters
        query = reviews_ref
        if found_item_id:
            query = query.where('found_item_id', '==', found_item_id)
        
        if status_filter:
            query = query.where('review_status', '==', status_filter)
        
        # Order by review date (newest first)
        query = query.order_by('review_date', direction=firestore.Query.DESCENDING)
        
        # Get all documents for filtering and counting
        all_docs = list(query.stream())
        
        # Apply search filter on client side (since Firestore doesn't support full-text search)
        filtered_docs = []
        for doc in all_docs:
            review_data = doc.to_dict()
            
            # Get found item details and reviewer name for search
            item_name = 'Unknown Item'
            category = 'Unknown'
            item_status = 'unknown'
            reviewer_name = 'Unknown'
            
            if 'found_item_id' in review_data:
                try:
                    item_ref = db.collection('found_items').document(review_data['found_item_id'])
                    item_doc = item_ref.get()
                    if item_doc.exists:
                        item_data = item_doc.to_dict()
                        item_name = item_data.get('found_item_name', 'Unknown Item')
                        category = item_data.get('category', 'Unknown')
                        item_status = item_data.get('status', 'unknown')
                except Exception as e:
                    print(f"Error fetching item data: {e}")
            
            # Get reviewer name for search
            if 'reviewed_by' in review_data:
                try:
                    admin_ref = db.collection('users').document(review_data['reviewed_by'])
                    admin_doc = admin_ref.get()
                    if admin_doc.exists:
                        admin_data = admin_doc.to_dict()
                        reviewer_name = admin_data.get('name', 'Unknown Admin')
                except Exception as e:
                    print(f"Error fetching admin data: {e}")
            
            # Apply search filter
            if search:
                search_lower = search.lower()
                searchable_text = ' '.join([
                    item_name.lower(),
                    category.lower(),
                    reviewer_name.lower(),
                    review_data.get('notes', '').lower(),
                    review_data.get('review_status', '').lower(),
                    review_data.get('review_id', '').lower()
                ])
                if search_lower not in searchable_text:
                    continue
            
            # Apply status filter (filter by found item status, not review status)
            if status_filter and status_filter != 'all':
                if item_status != status_filter:
                    continue
            
            filtered_docs.append((doc, item_name, category, item_status, reviewer_name))
        
        total_count = len(filtered_docs)
        
        # Apply sorting if specified
        if sort_by and filtered_docs:
            def get_sort_key(item):
                doc, item_name, category, item_status, reviewer_name = item
                review_data = doc.to_dict()
                
                if sort_by == 'review_id':
                    return review_data.get('review_id', '')
                elif sort_by == 'found_item_id':
                    return review_data.get('found_item_id', '')
                elif sort_by == 'item_name':
                    return item_name.lower()
                elif sort_by == 'status':
                    return item_status.lower()
                elif sort_by == 'reviewed_by_name':
                    return reviewer_name.lower()
                elif sort_by == 'review_date':
                    return review_data.get('review_date', datetime.datetime.min)
                elif sort_by == 'notes':
                    return review_data.get('notes', '').lower()
                else:
                    return ''
            
            reverse_order = sort_order.lower() == 'desc'
            filtered_docs.sort(key=get_sort_key, reverse=reverse_order)
        
        # Apply pagination
        paginated_docs = filtered_docs[offset:offset + limit]
        
        reviews = []
        for doc, item_name, category, item_status, reviewer_name in paginated_docs:
            review_data = doc.to_dict()
            
            # Set the item details we already fetched
            review_data['item_name'] = item_name
            review_data['category'] = category
            review_data['status'] = item_status  # Use found item status instead of review status
            review_data['reviewed_by_name'] = reviewer_name  # Use the reviewer name we already fetched
            
            # Get additional admin details (email) if needed
            if 'reviewed_by' in review_data and not review_data.get('reviewed_by_email'):
                try:
                    admin_ref = db.collection('users').document(review_data['reviewed_by'])
                    admin_doc = admin_ref.get()
                    if admin_doc.exists:
                        admin_data = admin_doc.to_dict()
                        review_data['reviewed_by_email'] = admin_data.get('email', '')
                    else:
                        review_data['reviewed_by_email'] = ''
                except Exception as e:
                    print(f"Error fetching admin email: {e}")
                    review_data['reviewed_by_email'] = ''
            
            # Convert Firestore timestamps to readable format
            if 'review_date' in review_data and review_data['review_date']:
                review_data['review_date'] = review_data['review_date'].strftime('%Y-%m-%d %H:%M:%S')
            if 'created_at' in review_data and review_data['created_at']:
                review_data['created_at'] = review_data['created_at'].strftime('%Y-%m-%d %H:%M:%S')
            if 'updated_at' in review_data and review_data['updated_at']:
                review_data['updated_at'] = review_data['updated_at'].strftime('%Y-%m-%d %H:%M:%S')
            
            reviews.append(review_data)
        
        return {
            'success': True,
            'reviews': reviews,
            'count': total_count
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get admin reviews: {str(e)}',
            'reviews': [],
            'count': 0
        }

def get_admin_review_by_id(review_id):
    """
    Get a specific admin review by ID
    
    Args:
        review_id (str): ID of the admin review
    
    Returns:
        dict: Result with success status and review data
    """
    try:
        doc_ref = db.collection('admin_reviews').document(review_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return {
                'success': False,
                'error': f'Admin review with ID {review_id} not found'
            }
        
        review_data = doc.to_dict()
        
        # Convert Firestore timestamps to readable format
        if 'review_date' in review_data and review_data['review_date']:
            review_data['review_date'] = review_data['review_date'].strftime('%Y-%m-%d %H:%M:%S')
        if 'created_at' in review_data and review_data['created_at']:
            review_data['created_at'] = review_data['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        if 'updated_at' in review_data and review_data['updated_at']:
            review_data['updated_at'] = review_data['updated_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        return {
            'success': True,
            'review': review_data
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get admin review: {str(e)}'
        }

def get_reviews_by_admin(admin_id, limit=20, offset=0):
    """
    Get admin reviews by a specific admin
    
    Args:
        admin_id (str): ID of the admin
        limit (int): Number of reviews to return
        offset (int): Number of reviews to skip
    
    Returns:
        dict: Result with success status, reviews list, and count
    """
    try:
        reviews_ref = db.collection('admin_reviews')
        query = reviews_ref.where('reviewed_by', '==', admin_id)
        query = query.order_by('review_date', direction=firestore.Query.DESCENDING)
        
        # Get total count
        all_docs = query.stream()
        total_count = len(list(all_docs))
        
        # Apply pagination
        query = query.offset(offset).limit(limit)
        docs = query.stream()
        
        reviews = []
        for doc in docs:
            review_data = doc.to_dict()
            
            # Convert Firestore timestamps to readable format
            if 'review_date' in review_data and review_data['review_date']:
                review_data['review_date'] = review_data['review_date'].strftime('%Y-%m-%d %H:%M:%S')
            
            reviews.append(review_data)
        
        return {
            'success': True,
            'reviews': reviews,
            'count': total_count
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get admin reviews: {str(e)}',
            'reviews': [],
            'count': 0
        }
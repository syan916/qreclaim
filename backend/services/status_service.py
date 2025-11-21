"""
Status Service for managing found item status updates and transitions.
Handles automatic status updates based on business rules.
"""

from datetime import datetime, timedelta
from firebase_admin import firestore
from ..database import db

def update_overdue_items():
    """
    Auto-update found item status to 'overdue' for items that exceed 31 days
    based on time_found, regardless of locker assignment status.
    
    Returns:
        dict: Summary of updated items
    """
    try:
        # Calculate cutoff date (31 days ago)
        cutoff_date = datetime.now() - timedelta(days=31)
        
        # Query for items that should be marked as overdue
        # Items with status 'unclaimed' and time_found older than 31 days
        query = db.collection('found_items').where('status', '==', 'unclaimed')
        
        items = query.stream()
        updated_count = 0
        updated_items = []
        
        for doc in items:
            data = doc.to_dict()
            time_found = data.get('time_found')
            
            if time_found:
                # Handle different timestamp formats
                if hasattr(time_found, 'timestamp'):
                    # Firestore timestamp
                    found_date = datetime.fromtimestamp(time_found.timestamp())
                elif hasattr(time_found, 'isoformat'):
                    # datetime object
                    found_date = time_found
                else:
                    # Try to parse as string
                    try:
                        found_date = datetime.fromisoformat(str(time_found))
                    except:
                        continue  # Skip if can't parse date
                
                # Check if item is overdue (older than 31 days)
                if found_date <= cutoff_date:
                    # Update status to overdue
                    doc.reference.update({
                        'status': 'overdue',
                        'updated_at': firestore.SERVER_TIMESTAMP
                    })
                    
                    updated_count += 1
                    updated_items.append({
                        'id': doc.id,
                        'name': data.get('found_item_name', 'Unknown'),
                        'time_found': found_date.isoformat(),
                        'days_overdue': (datetime.now() - found_date).days
                    })
        
        return {
            'success': True,
            'updated_count': updated_count,
            'updated_items': updated_items,
            'cutoff_date': cutoff_date.isoformat()
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'updated_count': 0
        }

def validate_status_transition(current_status, new_status):
    """
    Validate if a status transition is allowed based on business rules.
    
    Status workflow:
    - Unclaimed -> Overdue (auto-update only)
    - Overdue -> Donated (admin only)
    - Overdue -> Discarded (admin only)
    - Any -> Claimed (when item is claimed by user)
    - Any -> Returned (admin manual return)
    
    Args:
        current_status (str): Current item status
        new_status (str): Desired new status
        
    Returns:
        tuple: (is_valid, error_message)
    """
    
    # Define valid transitions
    valid_transitions = {
        'unclaimed': ['overdue', 'claimed', 'returned'],
        'overdue': ['donated', 'discarded', 'claimed', 'returned'],
        'donated': [],  # Final status - no transitions allowed
        'discarded': [],  # Final status - no transitions allowed
        'claimed': [],  # Final status - no transitions allowed
        'returned': []  # Final status - no transitions allowed
    }
    
    # Check if transition is valid
    if current_status not in valid_transitions:
        return False, f"Invalid current status: {current_status}"
    
    if new_status not in valid_transitions[current_status]:
        return False, f"Invalid transition from {current_status} to {new_status}"
    
    return True, "Valid transition"

def is_status_final(status):
    """
    Check if a status is final (no further edits allowed).
    
    Args:
        status (str): Item status
        
    Returns:
        bool: True if status is final
    """
    final_statuses = ['claimed', 'returned', 'donated', 'discarded']
    return status.lower() in final_statuses

def get_allowed_status_transitions(current_status):
    """
    Get list of allowed status transitions for the current status.
    
    Args:
        current_status (str): Current item status
        
    Returns:
        list: List of allowed next statuses
    """
    transitions = {
        'unclaimed': ['overdue', 'claimed', 'returned'],
        'overdue': ['donated', 'discarded', 'claimed', 'returned'],
        'donated': [],
        'discarded': [],
        'claimed': [],
        'returned': []
    }
    
    return transitions.get(current_status.lower(), [])
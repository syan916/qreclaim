import hashlib
from flask import session, redirect, url_for
from datetime import timedelta
from backend.database import db

def configure_session(app):
    """Configure session settings"""
    app.permanent_session_lifetime = timedelta(minutes=30)  # Session expires after 30 minutes
    
    @app.before_request
    def before_request():
        session.permanent = True
        session.modified = True

def authenticate_user(user_id, password):
    """Authenticate a user with their ID and password"""
    # Validate inputs
    if not user_id or not password:
        return {"error": "User ID and password are required"}
    
    # Hash the password (SHA-256)
    hashed_password = hashlib.sha256(password.encode()).hexdigest()
    
    # Check user in Firestore
    user_ref = db.collection('users').document(user_id)
    user = user_ref.get()
    
    if not user.exists:
        return {"error": "User ID not found"}
    
    user_data = user.to_dict()
    if user_data['password'] != hashed_password:
        return {"error": "Incorrect password"}
    
    # Check if account is active
    if 'status' in user_data and user_data['status'] != 'active':
        return {"error": "Account is not active"}
        
    return user_data

def login_user(user_data):
    """Store user info in session"""
    session['user_id'] = user_data['user_id']
    session['name'] = user_data['name']
    session['role'] = user_data['role']
    session['email'] = user_data['email']

def is_authenticated():
    """Check if user is authenticated"""
    return 'user_id' in session

def is_admin():
    """Check if authenticated user is an admin"""
    return is_authenticated() and session['role'] == 'admin'

def is_student():
    """Check if authenticated user is a student"""
    return is_authenticated() and session['role'] == 'student'

def logout():
    """Clear user session"""
    session.clear()
    return redirect(url_for('login'))

def admin_required(f):
    """Decorator to require admin authentication for a route"""
    from functools import wraps
    from flask import redirect, url_for
    
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_authenticated() or not is_admin():
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def student_required(f):
    """Decorator to require student authentication for a route"""
    from functools import wraps
    from flask import redirect, url_for, jsonify, request
    
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Debug logging
        auth_status = is_authenticated()
        student_status = is_student()
        user_id = session.get('user_id')
        role = session.get('role')
        
        print(f"DEBUG student_required: auth={auth_status}, student={student_status}, user_id={user_id}, role={role}")
        
        if not auth_status or not student_status:
            # For API endpoints, return JSON error
            if request.path.startswith('/user/api/'):
                return jsonify({
                    'valid': False,
                    'error': 'Unauthorized - Student access required',
                    'code': 'UNAUTHORIZED',
                    'debug': {
                        'authenticated': auth_status,
                        'is_student': student_status,
                        'user_id': user_id,
                        'role': role
                    }
                }), 401
            # For regular pages, redirect to login
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

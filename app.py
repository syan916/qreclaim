from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify, send_file
from flask_cors import CORS
import os
import json
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# Import backend modules
from backend.database import db
from firebase_admin import firestore
from backend.auth import configure_session, authenticate_user, login_user, logout
from backend.routes.user_routes import user_bp
from backend.routes.admin_routes import admin_bp
from backend.routes.validation_routes import validation_bp
from test_routes import test_bp
from backend.services.scheduler_service import start_scheduler, stop_scheduler

# Create app directly
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)

# Enable CORS for all routes
CORS(app)

# Configure session
configure_session(app)

# Register blueprints
app.register_blueprint(user_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(validation_bp)
app.register_blueprint(test_bp)




@app.route('/')
def index():
    if 'user_id' in session:
        if session['role'] == 'admin':
            return redirect(url_for('admin.dashboard'))
        else:
            return redirect(url_for('user.dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = request.form.get('user_id', '')
        password = request.form.get('password', '')
        
        # Authenticate user
        user_data = authenticate_user(user_id, password)
        
        # Check for authentication errors
        if "error" in user_data:
            return render_template('login.html', error=user_data["error"])
        
        # Store user info in session
        login_user(user_data)
        
        # Redirect based on role
        if user_data['role'] == 'admin':
            return redirect(url_for('admin.dashboard'))
        else:
            return redirect(url_for('user.dashboard'))
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# Kiosk Mode route: renders templates/kiosks/kiosk-mode.html
# Note: No auth required by default to allow launching from admin page into a new window.
#       If you need to restrict access, wrap with session checks similar to admin routes.
@app.route('/kiosk-mode')
def kiosk_mode():
    # Load Firebase web configuration from environment or config file
    firebase_web_config = None
    config_path = os.environ.get('FIREBASE_WEB_CONFIG_PATH', os.path.join('config', 'firebase_web_config.json'))
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                firebase_web_config = json.load(f)
        else:
            # Allow env var JSON override if present
            env_json = os.environ.get('FIREBASE_WEB_CONFIG_JSON')
            if env_json:
                firebase_web_config = json.loads(env_json)
    except Exception as e:
        # Log and continue; template will show a helpful message
        print(f"⚠️ Failed to load Firebase web config: {e}")

    # Optional: enable Firestore emulator from env
    use_emulator = os.environ.get('USE_FIRESTORE_EMULATOR', 'false').lower() in ('1', 'true', 'yes')
    emulator_host = os.environ.get('FIRESTORE_EMULATOR_HOST', 'localhost')
    emulator_port = int(os.environ.get('FIRESTORE_EMULATOR_PORT', '8080'))

    return render_template(
        'kiosks/kiosk-mode.html',
        firebase_config=firebase_web_config,
        use_firestore_emulator=use_emulator,
        firestore_emulator_config={
            'host': emulator_host,
            'port': emulator_port
        },
        is_debug=app.debug
    )

# Kiosk Test Interface (Development only)
@app.route('/kiosk-test')
def kiosk_test():
    """Serve the HTML test page from /tests for convenience during development.
    This page references assets under /static and exposes test helpers from kioskApp.js.
    """
    tests_path = os.path.join('tests', 'kiosk_test.html')
    if os.path.exists(tests_path):
        return send_file(tests_path)
    # Fallback: render template version if present
    return render_template('kiosks/test-kiosk-mode.html')

# Debug page for Adaptive Brightness Controller
@app.route('/debug-brightness')
def debug_brightness():
    """Serve the debug page for AdaptiveBrightnessController."""
    debug_path = os.path.join('debug_brightness_controller.html')
    if os.path.exists(debug_path):
        return send_file(debug_path)
    # Fallback: simple message if file missing
    return jsonify({"error": "debug_brightness_controller.html not found"}), 404

# Health check endpoint for network connectivity testing
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for network connectivity testing"""
    from datetime import datetime
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "qreclaim-main"
    })

# Development-only endpoint to set Firebase Web config from the browser
@app.route('/admin/firebase-web-config', methods=['GET', 'POST'])
def set_firebase_web_config():
    """Allow setting the Firebase Web configuration during development.
    GET returns whether config exists. POST saves the provided config to config/firebase_web_config.json.

    Security: This endpoint is only available when app.debug is True.
    """
    if not app.debug:
        return jsonify({"error": "Not available in production"}), 404

    config_path = os.environ.get('FIREBASE_WEB_CONFIG_PATH', os.path.join('config', 'firebase_web_config.json'))

    if request.method == 'GET':
        exists = os.path.exists(config_path)
        existing = None
        if exists:
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = None
        return jsonify({"configured": exists, "config": existing})

    # POST
    try:
        payload = request.get_json(force=True, silent=True) or {}
        # Support direct config body or wrapped under firebaseConfig key
        cfg = payload.get('firebaseConfig') if 'firebaseConfig' in payload else payload
        if not isinstance(cfg, dict):
            return jsonify({"success": False, "error": "Invalid JSON payload"}), 400

        # Minimal validation of required keys
        required_keys = ['apiKey', 'authDomain', 'projectId', 'appId']
        missing = [k for k in required_keys if k not in cfg or not cfg.get(k)]
        if missing:
            return jsonify({"success": False, "error": f"Missing required keys: {', '.join(missing)}"}), 400

        # Ensure config directory exists
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Start the background scheduler for automatic tasks
    try:
        ##start_scheduler()
        print("🚀 Qreclaim Scheduler started - automatic overdue items update enabled")
    except Exception as e:
        print(f"⚠️ Warning: Failed to start scheduler: {e}")
        print("📝 Manual status updates will still work through the admin interface")
    
    try:
        # Allow overriding host/port via environment for testing
        host = os.environ.get('HOST', '0.0.0.0')
        port = int(os.environ.get('PORT', '5000'))
        app.run(debug=True, host=host, port=port)
    finally:
        # Ensure scheduler is stopped when app shuts down
        stop_scheduler()

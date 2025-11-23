import os
import json
import firebase_admin
from firebase_admin import credentials, firestore, storage

def initialize_firebase():
    """Initialize Firebase Admin SDK with the provided credentials"""
    try:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        # Preferred config path under /config/credentials
        config_credentials_path = os.path.join(project_root, 'config', 'credentials', 'firebaseAdminKey.json')
        default_path = os.path.join(project_root, 'firebaseAdminKey.json')
        # Resolve path from environment first
        path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or os.environ.get('FIREBASE_ADMIN_KEY_PATH')
        # Fallbacks: config folder, project root, current working directory
        if not path:
            if os.path.isfile(config_credentials_path):
                path = config_credentials_path
            elif os.path.isfile(default_path):
                path = default_path
            else:
                cwd_path = os.path.join(os.getcwd(), 'firebaseAdminKey.json')
                if os.path.isfile(cwd_path):
                    path = cwd_path
        # Last resort: write JSON from env to config path
        if not path or not os.path.isfile(path):
            env_json = os.environ.get('FIREBASE_ADMIN_KEY_JSON')
            if env_json:
                os.makedirs(os.path.dirname(config_credentials_path), exist_ok=True)
                with open(config_credentials_path, 'w', encoding='utf-8') as f:
                    f.write(env_json)
                path = config_credentials_path
        cred = credentials.Certificate(path)
        firebase_admin.initialize_app(cred, {
            'storageBucket': os.environ.get('FIREBASE_STORAGE_BUCKET') or 'smart-lost-and-found.appspot.com'
        })
    except ValueError:
        # App already initialized
        pass
    
    return firestore.client()

def get_storage_bucket():
    """Get Firebase Storage bucket"""
    return storage.bucket()

# Get Firestore client
db = initialize_firebase()

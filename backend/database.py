import os
import json
import firebase_admin
from firebase_admin import credentials, firestore, storage

def initialize_firebase():
    """Initialize Firebase Admin SDK with the provided credentials"""
    try:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        default_path = os.path.join(project_root, 'firebaseAdminKey.json')
        path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or os.environ.get('FIREBASE_ADMIN_KEY_PATH') or default_path
        if not os.path.isfile(path):
            cwd_path = os.path.join(os.getcwd(), 'firebaseAdminKey.json')
            if os.path.isfile(cwd_path):
                path = cwd_path
            else:
                env_json = os.environ.get('FIREBASE_ADMIN_KEY_JSON')
                if env_json:
                    with open(default_path, 'w', encoding='utf-8') as f:
                        f.write(env_json)
                    path = default_path
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

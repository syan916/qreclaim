import os
import firebase_admin
from firebase_admin import credentials, firestore, storage

def initialize_firebase():
    """Initialize Firebase Admin SDK with the provided credentials"""
    try:
        path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or os.environ.get('FIREBASE_ADMIN_KEY_PATH') or "firebaseAdminKey.json"
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

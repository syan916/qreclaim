import os
import uuid
from datetime import datetime
from ..database import get_storage_bucket

def upload_image_to_storage(image_path, folder_name="found_items"):
    """
    Upload an image file to Firebase Storage and return the public URL.
    If Firebase Storage bucket is not available or upload fails (e.g., 404 bucket not found),
    gracefully fall back to returning a base64 data URL of the image. This keeps the system
    functional on free-tier setups without requiring a Storage bucket.

    Args:
        image_path: The path to the image file to upload
        folder_name: The folder name in storage (default: "found_items")

    Returns:
        tuple: (success: bool, url_or_error: str)
    """
    # Determine file extension and content type early for both primary and fallback paths
    filename = os.path.basename(image_path)
    file_extension = filename.split('.')[-1].lower() if '.' in filename else 'jpg'
    content_type = f"image/{'jpeg' if file_extension in ['jpg', 'jpeg'] else file_extension}"

    # First, attempt to upload to Firebase Storage
    try:
        bucket = get_storage_bucket()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_filename = f"{folder_name}/{timestamp}_{uuid.uuid4().hex[:8]}.{file_extension}"

        blob = bucket.blob(unique_filename)
        blob.upload_from_filename(image_path, content_type=content_type)
        blob.make_public()
        return True, blob.public_url
    except Exception as e:
        # Fallback to base64 data URL if upload to storage fails
        try:
            with open(image_path, 'rb') as f:
                img_bytes = f.read()
            import base64
            b64 = base64.b64encode(img_bytes).decode('utf-8')
            data_url = f"data:{content_type};base64,{b64}"
            # Return success with data URL so callers can still render the image in <img src="...">
            return True, data_url
        except Exception as fallback_err:
            return False, f"Failed to upload image (storage and fallback both failed): {str(e)} | Fallback error: {str(fallback_err)}"

def delete_image_from_storage(image_url):
    """
    Delete an image from Firebase Storage using its URL
    
    Args:
        image_url: The public URL of the image to delete
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # If this is a base64 data URL, there's nothing to delete from storage
        if image_url and image_url.startswith('data:image'):
            return True

        # Extract the blob name from the URL
        # Firebase Storage URLs have format: https://storage.googleapis.com/bucket-name/path/to/file
        if image_url and 'storage.googleapis.com' in image_url:
            # Extract the path after the bucket name
            url_parts = image_url.split('/')
            # url_parts[3] should be the bucket name; we don't need it directly here
            blob_path = '/'.join(url_parts[4:])  # The file path

            # Get the storage bucket
            bucket = get_storage_bucket()

            # Get the blob and delete it
            blob = bucket.blob(blob_path)
            blob.delete()

            return True
        else:
            # Unknown URL format
            return False

    except Exception as e:
        print(f"Error deleting image: {str(e)}")
        return False
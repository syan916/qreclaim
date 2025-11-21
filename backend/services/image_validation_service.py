"""
Image Validation Service for Qreclaim Lost-and-Found System
Provides comprehensive image validation including aspect ratio, file size, and format checks.
"""

import os
import sys
from PIL import Image
import logging
from typing import Optional, Dict

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_NSFW_MODEL = None
_NSFW_MODEL_LOADED = False

def _get_project_root():
    try:
        return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    except Exception:
        return os.getcwd()

def _get_nsfw_model_path_candidates():
    root = _get_project_root()
    env_path = os.getenv('QRECLAIM_NSFW_MODEL_PATH')
    candidates = []
    if env_path:
        candidates.append(env_path)
    candidates.append(os.path.join(root, 'nsfw_model-master', 'nsfw_mobilenet2.224x224.h5'))
    candidates.append(os.path.join(root, 'nsfw_model-master', 'mobilenet_v2_140_224'))
    return candidates

def _load_nsfw_model():
    global _NSFW_MODEL, _NSFW_MODEL_LOADED
    if _NSFW_MODEL_LOADED:
        return _NSFW_MODEL
    try:
        nsfw_pkg_dir = os.path.join(_get_project_root(), 'nsfw_model-master')
        if os.path.isdir(nsfw_pkg_dir) and nsfw_pkg_dir not in sys.path:
            sys.path.append(nsfw_pkg_dir)
        from nsfw_detector import predict as nsfw_predict
    except Exception:
        _NSFW_MODEL = None
        _NSFW_MODEL_LOADED = True
        return None
    model = None
    for p in _get_nsfw_model_path_candidates():
        try:
            if p and os.path.exists(p):
                model = nsfw_predict.load_model(p)
                break
        except Exception:
            continue
    _NSFW_MODEL = model
    _NSFW_MODEL_LOADED = True
    return _NSFW_MODEL

def nsfw_check_image(file_path: str, block_threshold: float = 0.5, borderline_threshold: float = 0.35) -> Dict:
    try:
        if not os.path.exists(file_path):
            return {'status': 'unknown', 'error': 'file_not_found'}
        model = _load_nsfw_model()
        if model is None:
            return {'status': 'unknown', 'error': 'model_unavailable'}
        from nsfw_detector import predict as nsfw_predict
        preds = nsfw_predict.classify(model, file_path)
        scores = preds.get(file_path) or (list(preds.values())[0] if preds else {})
        porn = float(scores.get('porn', 0.0))
        hentai = float(scores.get('hentai', 0.0))
        sexy = float(scores.get('sexy', 0.0))
        nsfw_score = max(porn, hentai, sexy)
        status = 'safe'
        if nsfw_score >= block_threshold:
            status = 'nsfw'
        elif nsfw_score >= borderline_threshold:
            status = 'borderline'
        return {
            'status': status,
            'scores': scores,
            'nsfw_score': nsfw_score
        }
    except Exception as e:
        return {'status': 'unknown', 'error': str(e)}

class ImageValidationService:
    """Service class for validating uploaded images"""
    
    # Configuration constants
    MAX_FILE_SIZE = 15 * 1024 * 1024  # 15MB in bytes
    ALLOWED_FORMATS = ['JPEG', 'PNG', 'JPG']
    ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png']
    MIN_ASPECT_RATIO = 0.5  # more relaxed
    MAX_ASPECT_RATIO = 2.0   # more relaxed
    MIN_RESOLUTION = (200, 200)  # Minimum width x height
    MAX_RESOLUTION = (6000, 6000)  # Maximum width x height
    
    @classmethod
    def validate_image_file(cls, file_path, file_size=None, mime_type=None):
        """
        Comprehensive image validation including aspect ratio, size, format, and resolution.
        
        Args:
            file_path (str): Path to the image file
            file_size (int, optional): File size in bytes
            mime_type (str, optional): MIME type of the file
            
        Returns:
            dict: Validation result with success status and error messages
        """
        validation_result = {
            'success': True,
            'errors': [],
            'warnings': [],
            'image_info': {}
        }
        
        try:
            # Check if file exists
            if not os.path.exists(file_path):
                validation_result['success'] = False
                validation_result['errors'].append('Image file not found')
                return validation_result
            
            # Validate file size if provided
            if file_size is not None:
                if file_size > cls.MAX_FILE_SIZE:
                    validation_result['success'] = False
                    validation_result['errors'].append(
                        f'File size ({file_size / (1024*1024):.1f}MB) exceeds maximum allowed size ({cls.MAX_FILE_SIZE / (1024*1024)}MB)'
                    )
            
            # Validate MIME type if provided
            if mime_type is not None:
                if mime_type not in cls.ALLOWED_MIME_TYPES:
                    validation_result['success'] = False
                    validation_result['errors'].append(
                        f'Invalid file type ({mime_type}). Allowed types: {", ".join(cls.ALLOWED_MIME_TYPES)}'
                    )
            
            # Open and validate image with PIL
            try:
                with Image.open(file_path) as img:
                    # Get image information
                    width, height = img.size
                    format_type = img.format
                    mode = img.mode
                    
                    validation_result['image_info'] = {
                        'width': width,
                        'height': height,
                        'format': format_type,
                        'mode': mode,
                        'aspect_ratio': round(width / height, 2)
                    }
                    
                    # Validate image format
                    if format_type not in cls.ALLOWED_FORMATS:
                        validation_result['success'] = False
                        validation_result['errors'].append(
                            f'Invalid image format ({format_type}). Allowed formats: {", ".join(cls.ALLOWED_FORMATS)}'
                        )
                    
                    # Validate resolution
                    if width < cls.MIN_RESOLUTION[0] or height < cls.MIN_RESOLUTION[1]:
                        validation_result['success'] = False
                        validation_result['errors'].append(
                            f'Image resolution ({width}x{height}) is too small. Minimum resolution: {cls.MIN_RESOLUTION[0]}x{cls.MIN_RESOLUTION[1]}'
                        )
                    
                    if width > cls.MAX_RESOLUTION[0] or height > cls.MAX_RESOLUTION[1]:
                        validation_result['success'] = False
                        validation_result['errors'].append(
                            f'Image resolution ({width}x{height}) is too large. Maximum resolution: {cls.MAX_RESOLUTION[0]}x{cls.MAX_RESOLUTION[1]}'
                        )
                    
                    # Validate aspect ratio
                    aspect_ratio = width / height
                    if aspect_ratio < cls.MIN_ASPECT_RATIO or aspect_ratio > cls.MAX_ASPECT_RATIO:
                        validation_result['success'] = False
                        validation_result['errors'].append(
                            f'Invalid aspect ratio ({aspect_ratio:.2f}). Allowed range: {cls.MIN_ASPECT_RATIO} to {cls.MAX_ASPECT_RATIO} (3:4 to 3:2)'
                        )
                    
                    # Add warnings for edge cases (near-limit ratios)
                    if aspect_ratio < 0.6 or aspect_ratio > 1.8:
                        validation_result['warnings'].append(
                            'Image aspect ratio is outside the recommended range. The system will still accept it, but cropping might improve display.'
                        )
                    
                    # Check if image is corrupted by trying to load it
                    img.verify()

            except Exception as img_error:
                validation_result['success'] = False
                validation_result['errors'].append(f'Invalid or corrupted image file: {str(img_error)}')
                logger.error(f"Image validation error for {file_path}: {str(img_error)}")

            try:
                nsfw = nsfw_check_image(file_path)
                validation_result['image_info']['nsfw'] = nsfw
                block_borderline = str(os.getenv('QRECLAIM_NSFW_BLOCK_BORDERLINE') or 'true').lower() in {'1','true','yes'}
                if nsfw.get('status') == 'nsfw' or (block_borderline and nsfw.get('status') == 'borderline'):
                    validation_result['success'] = False
                    s = nsfw.get('nsfw_score')
                    validation_result['errors'].append(f'Image flagged as NSFW ({s:.2f})')
                elif nsfw.get('status') == 'borderline':
                    validation_result['warnings'].append('Image may be sensitive content')
            except Exception as e:
                validation_result['warnings'].append('NSFW check unavailable')
                logger.warning(f"NSFW check failed for {file_path}: {str(e)}")

        except Exception as e:
            validation_result['success'] = False
            validation_result['errors'].append(f'Validation error: {str(e)}')
            logger.error(f"General validation error for {file_path}: {str(e)}")
        
        return validation_result
    
    @classmethod
    def validate_image_ratio(cls, image_path):
        """
        Simple aspect ratio validation function (backward compatibility).
        
        Args:
            image_path (str): Path to the image file
            
        Returns:
            bool: True if aspect ratio is valid, False otherwise
        """
        try:
            with Image.open(image_path) as img:
                width, height = img.size
                ratio = width / height
                return cls.MIN_ASPECT_RATIO <= ratio <= cls.MAX_ASPECT_RATIO
        except Exception as e:
            logger.error(f"Error validating aspect ratio for {image_path}: {str(e)}")
            return False
    
    @classmethod
    def get_validation_rules(cls):
        """
        Get validation rules for client-side validation.
        
        Returns:
            dict: Validation rules and limits
        """
        return {
            'max_file_size': cls.MAX_FILE_SIZE,
            'max_file_size_mb': cls.MAX_FILE_SIZE / (1024 * 1024),
            'allowed_mime_types': cls.ALLOWED_MIME_TYPES,
            'allowed_formats': cls.ALLOWED_FORMATS,
            'min_aspect_ratio': cls.MIN_ASPECT_RATIO,
            'max_aspect_ratio': cls.MAX_ASPECT_RATIO,
            'min_resolution': cls.MIN_RESOLUTION,
            'max_resolution': cls.MAX_RESOLUTION
        }

# Convenience functions for backward compatibility
def validate_image_ratio(image_path):
    """Validate image aspect ratio (backward compatibility function)"""
    return ImageValidationService.validate_image_ratio(image_path)

def validate_image_file(file_path, file_size=None, mime_type=None):
    """Validate image file comprehensively"""
    return ImageValidationService.validate_image_file(file_path, file_size, mime_type)

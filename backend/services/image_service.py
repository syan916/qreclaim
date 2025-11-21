"""
Image processing service for YOLO and BLIP operations.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ai_image_tagging import get_image_tags

def generate_tags(image_path, extra_candidates=None):
    """
    Generate tags from an image using YOLO and BLIP models.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        Dict containing tags and metadata
    """
    return get_image_tags(image_path, extra_candidates=extra_candidates)

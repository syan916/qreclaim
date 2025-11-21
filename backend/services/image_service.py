"""
Image processing service for AI tagging and caption generation with optional remote proxy.
"""
import os
import json
import uuid
import urllib.request
import urllib.parse
import tempfile

# Remote configuration
_REMOTE_BASE = (
    os.environ.get('QRECLAIM_AI_REMOTE_BASE_URL')
    or os.environ.get('AI_REMOTE_BASE_URL')
    or 'https://lachelle-slinkier-marita.ngrok-free.dev'
)
_USE_REMOTE = (
    bool(os.environ.get('QRECLAIM_AI_REMOTE_BASE_URL'))
    or str(os.environ.get('AI_REMOTE_FORCE', '')).lower() in ('1', 'true', 'yes')
)

def _post_multipart(url, file_path, fields=None, timeout=60):
    boundary = '----WebKitFormBoundary' + uuid.uuid4().hex
    parts = []
    if fields:
        for k, v in fields.items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'
            )
    with open(file_path, 'rb') as f:
        file_content = f.read()
    filename = os.path.basename(file_path)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'
    )
    body = ''.join(parts).encode('utf-8') + file_content + f'\r\n--{boundary}--\r\n'.encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    req.add_header('ngrok-skip-browser-warning', 'true')
    token = os.environ.get('AI_SERVICE_TOKEN')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8')

def generate_tags(image_path, extra_candidates=None):
    """
    Generate tags from an image using local models or remote AI service.
    Returns a dict containing tags and metadata.
    """
    if _USE_REMOTE:
        fields = {}
        if isinstance(extra_candidates, (list, tuple)) and extra_candidates:
            try:
                fields['extra_candidates'] = json.dumps(list(extra_candidates))
            except Exception:
                fields['extra_candidates'] = '[]'
        raw = _post_multipart(f'{_REMOTE_BASE}/ai/generate-tags', image_path, fields)
        try:
            resp = json.loads(raw)
        except Exception:
            resp = {}
        result = resp.get('result')
        if not result:
            tags = resp.get('tags', [])
            result = {'tags': tags}
        return result
    else:
        import sys
        sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from ai_image_tagging import get_image_tags
        return get_image_tags(image_path, extra_candidates=extra_candidates)

def generate_description(image_path):
    """
    Generate caption/description using local BLIP or remote AI service.
    Returns a string description.
    """
    if _USE_REMOTE:
        raw = _post_multipart(f'{_REMOTE_BASE}/ai/generate-description', image_path, {})
        try:
            resp = json.loads(raw)
        except Exception:
            resp = {}
        return resp.get('description', '')
    else:
        import sys
        sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from ai_image_tagging import generate_caption_for_image
        return generate_caption_for_image(image_path)

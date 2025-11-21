import math
from typing import Dict, List, Tuple
from ..database import db

# Text utilities
def _tokenize(text: str) -> List[str]:
    return [w.lower() for w in (text or '').split() if w.strip()]

def _vectorize_text(text: str) -> Dict[str, float]:
    tokens = _tokenize(text)
    if not tokens:
        return {}
    freq: Dict[str, int] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1
    norm = math.sqrt(sum(v*v for v in freq.values())) or 1.0
    return {k: v / norm for k, v in freq.items()}

def _cosine_from_dicts(a: Dict[str, float], b: Dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a.keys()) & set(b.keys())
    dot = sum(a[k] * b[k] for k in keys)
    # a and b already normalized
    return max(0.0, min(1.0, dot))

def _norm(vec: List[float]) -> List[float]:
    if not vec:
        return []
    s = math.sqrt(sum(x*x for x in vec))
    return [x / s for x in vec] if s else vec

def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x*y for x, y in zip(a, b))
    aa = math.sqrt(sum(x*x for x in a)) or 1.0
    bb = math.sqrt(sum(y*y for y in b)) or 1.0
    return max(0.0, min(1.0, dot/(aa*bb)))

def _tags_score(lost_tags: List[str], found_tags: List[str]) -> float:
    A = set([t.lower() for t in (lost_tags or [])])
    B = set([t.lower() for t in (found_tags or [])])
    if not A and not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B) or 1
    return inter / union

def _build_text(l: dict) -> str:
    name = l.get('found_item_name') or l.get('name') or ''
    desc = l.get('description') or ''
    tags = ' '.join(l.get('tags') or [])
    return f"{name} {desc} {tags}".strip()

def ai_match_top3(lost_item_id: str, weights: Tuple[float,float,float,float] = (0.5,0.3,0.1,0.1)) -> List[dict]:
    """Compute top-3 matching found items for a given lost item.
    Uses lightweight text vectorization and optional precomputed embeddings if present.
    """
    w_text, w_image, w_cat, w_tags = weights
    lost_snap = db.collection('lost_items').document(lost_item_id).get()
    if not lost_snap.exists:
        return []
    lost = lost_snap.to_dict() or {}

    # Text vectors
    lost_text_vec = _vectorize_text(_build_text(lost))
    # Optional precomputed embeddings (list of floats)
    lost_image_emb = _norm(lost.get('image_embedding') or [])

    # Category/tags
    lost_cat = (lost.get('category') or '').lower()
    lost_tags = lost.get('tags') or []

    candidates = db.collection('found_items').where('status','==','unclaimed').stream()
    results: List[dict] = []
    for snap in candidates:
        found = snap.to_dict() or {}
        found_text_vec = _vectorize_text(_build_text(found))
        text_sim = _cosine_from_dicts(lost_text_vec, found_text_vec)

        found_image_emb = _norm(found.get('image_embedding') or [])
        image_sim = _cosine(lost_image_emb, found_image_emb) if lost_image_emb and found_image_emb else 0.0

        category_score = 1.0 if (found.get('category') or '').lower() == lost_cat else 0.0
        tags_score = _tags_score(lost_tags, found.get('tags') or [])

        total = (w_text*text_sim + w_image*image_sim + w_cat*category_score + w_tags*tags_score)
        results.append({
            'found_item_id': snap.id,
            'found_item_name': found.get('found_item_name') or found.get('name') or 'Unknown',
            'image_url': found.get('image_url'),
            'locker_id': found.get('locker_id'),
            'location': found.get('location'),
            'total_score': round(total, 4)
        })

    results.sort(key=lambda x: x['total_score'], reverse=True)
    return results[:3]
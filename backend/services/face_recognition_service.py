"""
Face Recognition Service
- Provides utilities to compare face embeddings and decide matches.
- Embeddings are expected to be numeric vectors (lists of floats), such as
  the 256-dim LBP histograms computed in claim_service.

This module focuses on lightweight operations (cosine similarity / L2 distance)
that work without heavy ML dependencies.
"""
from typing import List, Tuple
import math

def _validate_embeddings(a: List[float], b: List[float]) -> Tuple[bool, str]:
    if not isinstance(a, (list, tuple)) or not isinstance(b, (list, tuple)):
        return False, 'Embeddings must be lists or tuples'
    if len(a) == 0 or len(b) == 0:
        return False, 'Empty embeddings'
    if len(a) != len(b):
        return False, f'Embedding dimension mismatch: {len(a)} vs {len(b)}'
    return True, ''

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two embeddings (range [-1,1])."""
    ok, err = _validate_embeddings(a, b)
    if not ok:
        raise ValueError(err)
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += float(x) * float(y)
        norm_a += float(x) * float(x)
        norm_b += float(y) * float(y)
    denom = math.sqrt(norm_a) * math.sqrt(norm_b)
    if denom == 0.0:
        return 0.0
    return dot / denom

def l2_distance(a: List[float], b: List[float]) -> float:
    """Compute L2 (Euclidean) distance between two embeddings."""
    ok, err = _validate_embeddings(a, b)
    if not ok:
        raise ValueError(err)
    s = 0.0
    for x, y in zip(a, b):
        d = float(x) - float(y)
        s += d * d
    return math.sqrt(s)

def is_match(a: List[float], b: List[float], method: str = 'cosine', threshold: float = 0.85) -> Tuple[bool, float]:
    """
    Decide if two embeddings represent the same person.
    - method: 'cosine' (higher is more similar), or 'l2' (lower is more similar)
    - threshold: 0..1 for cosine; typical values 0.80~0.90 for LBP-like vectors

    Returns: (match, score)
    """
    if method == 'cosine':
        score = cosine_similarity(a, b)
        return score >= threshold, score
    elif method == 'l2':
        score = l2_distance(a, b)
        # Example threshold for L2 over normalized histograms; tune as needed.
        return score <= (1.0 - threshold), score
    else:
        raise ValueError(f'Unknown method: {method}')
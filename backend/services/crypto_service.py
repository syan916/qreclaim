"""
Crypto service: Fernet-based symmetric encryption utilities with key versioning.

Security requirements implemented:
- Keys are loaded from environment variables (never hardcoded here)
- Supports multiple key versions for seamless rotation
- Provides helpers to encrypt/decrypt payloads and handle versioned envelopes

Environment variables expected:
- QRECLAIM_FERNET_KEYS: JSON mapping of { "v1": <base64_key>, "vN": <base64_key>, ... }
- QRECLAIM_FERNET_ACTIVE: active version key, e.g., "v1"

Example:
  QRECLAIM_FERNET_KEYS={"v1":"<key1>","v2":"<key2>"}
  QRECLAIM_FERNET_ACTIVE=v2

Rotation guidance:
- Generate a new key with Fernet.generate_key()
- Add as a new version in QRECLAIM_FERNET_KEYS
- Set QRECLAIM_FERNET_ACTIVE to new version
- Keep previous versions until all old QR codes have expired
"""
from __future__ import annotations

import os
import json
from typing import Dict, Tuple

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception as e:  # pragma: no cover - environment may not have cryptography installed yet
    Fernet = None
    InvalidToken = Exception


class CryptoConfigError(Exception):
    """Raised when crypto configuration is invalid or missing."""


def _load_key_map() -> Dict[str, str]:
    raw = os.environ.get('QRECLAIM_FERNET_KEYS', '').strip()
    if not raw:
        raise CryptoConfigError('Missing env var QRECLAIM_FERNET_KEYS')
    try:
        key_map = json.loads(raw)
    except Exception as e:
        raise CryptoConfigError(f'Invalid QRECLAIM_FERNET_KEYS JSON: {e}')
    if not isinstance(key_map, dict) or not key_map:
        raise CryptoConfigError('QRECLAIM_FERNET_KEYS must be a non-empty JSON object')
    return key_map


def _get_active_version(key_map: Dict[str, str]) -> str:
    active = os.environ.get('QRECLAIM_FERNET_ACTIVE', '').strip()
    if not active:
        # Fallback to first key in mapping (deterministic order by sorted keys)
        active = sorted(key_map.keys())[0]
    if active not in key_map:
        raise CryptoConfigError(f'Active key version {active} not found in key map')
    return active


def get_fernet_for_version(version: str) -> Fernet:
    """Return Fernet instance for the given version from env config."""
    if Fernet is None:
        raise CryptoConfigError('cryptography library not available')
    key_map = _load_key_map()
    key = key_map.get(version)
    if not key:
        raise CryptoConfigError(f'Key version {version} not configured')
    try:
        return Fernet(key)
    except Exception as e:
        raise CryptoConfigError(f'Invalid key for version {version}: {e}')


def get_active_fernet() -> Tuple[str, Fernet]:
    """Return (version, Fernet instance) for active key."""
    if Fernet is None:
        raise CryptoConfigError('cryptography library not available')
    key_map = _load_key_map()
    version = _get_active_version(key_map)
    key = key_map[version]
    try:
        return version, Fernet(key)
    except Exception as e:
        raise CryptoConfigError(f'Invalid active key {version}: {e}')


def encrypt_bytes_with_envelope(payload_bytes: bytes) -> str:
    """
    Encrypt payload bytes using the active Fernet key and return an envelope string.
    Envelope format (JSON string): {"v":"<version>","d":"<token>"}
    where d is the base64url token produced by Fernet, decoded to UTF-8.
    """
    version, f = get_active_fernet()
    token_bytes = f.encrypt(payload_bytes)
    token_str = token_bytes.decode('utf-8')  # URL-safe base64 string
    envelope = json.dumps({'v': version, 'd': token_str}, separators=(',', ':'))
    return envelope


def decrypt_envelope_to_bytes(envelope_str: str) -> bytes:
    """
    Decrypt a versioned envelope string and return the original plaintext bytes.
    Supports two input formats:
    1) JSON: {"v":"v1","d":"<token>"}
    2) Compact: "v1:<token>"
    """
    # First try compact format
    if ':' in envelope_str and not envelope_str.strip().startswith('{'):
        ver, token = envelope_str.split(':', 1)
        f = get_fernet_for_version(ver)
        return f.decrypt(token.encode('utf-8'))

    # Fallback to JSON envelope
    try:
        obj = json.loads(envelope_str)
    except Exception:
        raise InvalidToken('Envelope is not valid JSON nor compact format')

    version = obj.get('v')
    token = obj.get('d')
    if not isinstance(version, str) or not isinstance(token, str):
        raise InvalidToken('Envelope missing v/d fields')
    f = get_fernet_for_version(version)
    return f.decrypt(token.encode('utf-8'))
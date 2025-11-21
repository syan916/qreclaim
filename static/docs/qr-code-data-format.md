# QR Code Data Format and Verification Flow

This document describes the QR payload formats supported by QReclaim and the end‑to‑end flow from generation to verification in Kiosk Mode.

Supported payload formats:

- Encrypted envelope (preferred)
  - Compact: `vN:<token>` where `vN` is the Fernet key version (e.g., `v1`) and `<token>` is a Fernet URL‑safe base64 string.
  - JSON envelope: `{ "v":"vN", "d":"<token>" }` with the same semantics.
- Plain JSON (legacy/fallback): `{"claim_id":"C0001","student_id":"1234567","token":"<alphanumeric>"}`
- Pipe‑delimited (legacy admin tools only): `QRC|<claim_id>|<student_id>|<verify_method>` where `verify_method` is one of `face`, `rfid`, `qr_face`, `qr_rfid`.

Generation (backend):

- Function: `backend/services/claim_service.py::generate_claim_qr`
- Creates a secure alphanumeric token (8–32 chars) and an expiration timestamp.
- If encryption is configured (via `QRECLAIM_FERNET_KEYS` and `QRECLAIM_FERNET_ACTIVE`) the payload JSON is encrypted and encoded into an envelope. Otherwise, the payload is emitted as plaintext JSON.
- A QR image is generated and uploaded; the claim document is updated with `qr_token`, `qr_image_url`, and `expires_at`.

Scanning (frontend):

- Module: `static/js/kiosk/qrScanner.js`
- The scanner accepts encrypted envelopes, plaintext JSON, and pipe‑delimited payloads.
- It validates the basic structure client‑side and then posts the raw string to `/api/qr/verify`.
- To prevent camera/canvas issues, the scanner ensures the `#qr-reader` container has non‑zero dimensions before starting the camera.

Verification (backend):

- Route: `backend/routes/validation_routes.py` → `/api/qr/verify`
- Service: `backend/services/claim_service.py::verify_claim_qr_data`
- Decrypts compact/JSON envelopes or parses plaintext JSON.
- Validates required fields (`claim_id`, `student_id`, `token`), schema, claim status (`pending`), and expiration.
- Returns `{ valid: true, claim_id, student_id, verification_method, expires_at }` on success; otherwise a structured `{ error, status }`.

Kiosk identity verification:

- After QR verification, `static/js/kiosk/kioskApp.js` fetches the claim document and runs identity checks based on `verification_method`:
  - `face`/`qr_face`: Uses `face-api.js` via `static/js/kiosk/faceVerifier.js`
  - `rfid`/`qr_rfid`: Uses `RFIDVerifier` to match against stored UID

Front‑end reliability safeguards:

- QR scanner container sizing: `#qr-reader` has CSS `min-width`/`min-height` to avoid zero‑size canvases. `QRScanner.ensureContainerSize()` enforces minimums at runtime.
- Face verification canvas sizing: `#verification-canvas` is programmatically synced to the video’s actual resolution once metadata is loaded (see `templates/kiosks/kiosk-mode.html`). This avoids zero‑width/height drawing buffers during detection.

Notes:

- Always prefer encrypted envelopes in production. Plain JSON remains supported for environments where crypto is not configured.
- The backend enforces claim state and expiration checks; client‑side validation is advisory.
- Tokens must be alphanumeric and 8–32 characters long.
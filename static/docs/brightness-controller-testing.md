# Brightness Controller Testing Guide

This guide explains how to validate the AdaptiveBrightnessController module under varied lighting and measure recognition accuracy before/after enabling brightness adaptation.

## Goals
- Verify luminance estimation is stable and tracks ambient lighting changes.
- Confirm non-destructive CSS filter adjustments improve visual legibility while avoiding washed-out frames.
- Check optional torch and exposure tuning where supported.
- Evaluate downstream detection accuracy (QR and face) with/without the controller.

## Prerequisites
- Running development server (Flask) at http://localhost:5000/.
- A camera-enabled device (desktop/laptop with webcam or mobile).
- Access to these pages:
  - Kiosk Mode: http://localhost:5000/kiosk-mode
  - Face Capture flow: Users ➜ Found Item details ➜ Open Face Capture modal
  - Debug page: http://localhost:5000/debug-brightness (added in this change)

## Quick Procedure
1. Open the Debug page (http://localhost:5000/debug-brightness).
2. Observe “Current Luma” and UI filters applied.
3. Test under different environments:
   - Bright overhead light
   - Dim room lighting
   - Backlit subject (light behind the camera subject)
4. Toggle settings:
   - Target Luma slider (0.45–0.65)
   - Auto Torch (on/off)
   - Exposure Tuning (on/off)
5. Confirm diagnostic events are visible in the console (adaptive-brightness-diagnostic).

## QR Scanner Validation
1. Navigate to http://localhost:5000/kiosk-mode.
2. Present a QR code (printed or on another screen).
3. Compare detection speed and reliability:
   - With controller enabled: Default parameters in `qrScanner.js` instantiate AdaptiveBrightnessController.
   - Without controller: Temporarily comment out controller creation and starting in `static/js/kiosk/qrScanner.js`.
4. Record scanning latency and success rate under dim and bright conditions.

## Face Verifier Validation
1. In Kiosk Mode, switch to face verifier section.
2. Compare face detection/recognition stability:
   - With controller enabled: Default parameters in `faceVerifier.js`.
   - Without controller: Temporarily disable the controller.
3. Record alignment/readiness feedback, FPS, and success rate for captures.

## Face Capture Modal Validation
1. In Users ➜ Found Item details ➜ Trigger “Claim” ➜ Open Face Capture modal.
2. Confirm brightness feedback and captured preview quality:
   - The capture uses raw video frames to avoid overlay contamination.
   - Adaptive sharpening is reduced or skipped when frames are bright to prevent wash-out.
3. Ensure flash overlay feels natural (we reduced from 0.65 to ~0.35 intensity).

## Metrics to Record
- Average luma observed in each scenario.
- Time to QR detection (ms), success rate (%).
- Face readiness score timing and success rate (%).
- Subjective visual quality ratings: good/neutral/washed-out/too dark.

## Troubleshooting
- If CSS filters persist after stopping: Ensure `controller.stop()` is called on modal close or stream teardown.
- If torch/exposure errors occur: Device may not support these constraints; the controller ignores hardware tuning errors to keep UX smooth.
- If luma readings are unstable: Verify ambient lighting and confirm the sampling interval (default 400ms) is appropriate.

## Notes
- All adjustments are gentle and clamped to keep visuals natural, following project code standards.
- The controller avoids deep nesting and uses concurrency control to prevent overlapping analyses.
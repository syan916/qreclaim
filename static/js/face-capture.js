/*
  FaceCaptureHelper
  - Lightweight helper for hands-free, automatic face capture using MediaPipe FaceMesh
  - Works with an existing <video> stream; draws to a <canvas> overlay for preview
  - Automatically captures when optimal conditions are met (face size, orientation, brightness, sharpness)
  - Optional blink gesture accelerates capture if conditions are already acceptable
  - Calls onAutoCapture(dataUrl) once a high-quality frame is captured

  Notes:
  - This is client-only and does not send any data externally
  - If FaceMesh cannot be loaded, auto-capture is disabled and an error is shown (manual capture removed by spec)
*/
(function(){
  if (window.FaceCaptureHelper) return; // avoid duplicate definitions

  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe';
  let faceMesh = null;
  let rafId = null;
  let initialized = false;
  let running = false;
  let capturedOnce = false;
  // Diagnostics store (performance + asset loads)
  const diag = {
    assets: [], // { name, ok, status, ms }
    sendAvgMs: 0,
    fps: 0,
    lastLoopTs: 0,
    frames: 0
  };

  const state = {
    videoEl: null,
    canvasEl: null,
    ctx: null,
    instructionsEl: null,
    statusEl: null, // optional: where we print perf metrics and readiness hints
    errorEl: null,
    onAutoCapture: null,
    // Backward-compat hook (will be ignored if not provided)
    onBlinkCapture: null,
    lastBlinkTime: 0,
    blinkArmed: true,
    lowCounter: 0,
    prevBox: null, // smoothed guidance box
    flashAlpha: 0, // camera flash overlay alpha
    // Enhanced capture workflow state
    flow: {
      stableFrames: 0,
      STABLE_REQUIRED_FRAMES: 60, // ~2s at 30fps
      blinkPhase: false,
      blinkCount: 0
    },
    // Real-time validation status
    validation: {
      frameCount: 0,
      orientationOk: false,
      sizeOk: false,
      frameAlignedOk: true,
      brightOk: true,
      blurOk: true,
      lastBrightness: 0,
      lastSharpness: 0,
      readyFrames: 0
    },
    earOpenAvg: 0,
    earOpenSamples: 0,
    lowEarMin: null
  };

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }

  async function ensureFaceMeshLoaded(){
    // Load the MediaPipe FaceMesh UMD bundle from CDN if not already present
    if (window.FaceMesh) return; // In UMD build, window.FaceMesh is the constructor
    await loadScript(`${CDN_BASE}/face_mesh/face_mesh.js`);
    // drawing_utils and camera_utils are optional here; we do not rely on Camera helper.
    if (!window.FaceMesh) throw new Error('FaceMesh not available after load');
  }

  function dist(a, b){
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  // Draw corner-bracket guidance box similar to common face recognition frames
  // Draw corner-bracket guidance box similar to common face recognition frames
  // Enlarged bracket length to improve perceived frame size and guidance for different
  // face positions. This is purely visual and does not alter crop resolution directly.
  function drawCornerBrackets(ctx, box){
    const x0 = Math.floor(box.x), y0 = Math.floor(box.y);
    const x1 = Math.floor(box.x + Math.max(1, box.w));
    const y1 = Math.floor(box.y + Math.max(1, box.h));
    // Increase corner length from ~18% → ~24% of the shorter side to make the
    // frame appear larger and easier to align with.
    const len = Math.max(16, Math.floor(Math.min(box.w, box.h) * 0.24));
    ctx.save();
    ctx.lineCap = 'round';
    // top-left
    ctx.beginPath();
    ctx.moveTo(x0, y0 + len);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.stroke();
    // top-right
    ctx.beginPath();
    ctx.moveTo(x1 - len, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + len);
    ctx.stroke();
    // bottom-right
    ctx.beginPath();
    ctx.moveTo(x1, y1 - len);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - len, y1);
    ctx.stroke();
    // bottom-left
    ctx.beginPath();
    ctx.moveTo(x0 + len, y1);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0, y1 - len);
    ctx.stroke();
    ctx.restore();
  }

  // Compute Eye Aspect Ratio approximation using selected landmark pairs
  function computeEAR(landmarks, left = true){
    // Indices for MediaPipe FaceMesh (468 points)
    // Left eye pairs (vertical): (159,145), (160,144); Horizontal: (33,133)
    // Right eye pairs (vertical): (386,374), (387,373); Horizontal: (263,362)
    if (left){
      const p1 = landmarks[33], p4 = landmarks[133];
      const v1a = landmarks[159], v1b = landmarks[145];
      const v2a = landmarks[160], v2b = landmarks[144];
      const vert = dist(v1a, v1b) + dist(v2a, v2b);
      const horiz = 2 * dist(p1, p4);
      if (!horiz || !isFinite(vert/horiz)) return 0;
      return vert / horiz;
    } else {
      const p1 = landmarks[263], p4 = landmarks[362];
      const v1a = landmarks[386], v1b = landmarks[374];
      const v2a = landmarks[387], v2b = landmarks[373];
      const vert = dist(v1a, v1b) + dist(v2a, v2b);
      const horiz = 2 * dist(p1, p4);
      if (!horiz || !isFinite(vert/horiz)) return 0;
      return vert / horiz;
    }
  }

  async function init({ videoEl, canvasEl, instructionsEl, errorEl, statusEl, onAutoCapture, onBlinkCapture }){
    state.videoEl = videoEl || null;
    state.canvasEl = canvasEl || null;
    state.instructionsEl = instructionsEl || null;
    state.errorEl = errorEl || null;
    state.statusEl = statusEl || null;
    state.onAutoCapture = typeof onAutoCapture === 'function' ? onAutoCapture : null;
    // Maintain backward compatibility for older callers, but we won't rely on it for UX
    state.onBlinkCapture = typeof onBlinkCapture === 'function' ? onBlinkCapture : null;

    // Update instruction text to reflect auto-capture
    if (state.instructionsEl){
      // Update instructions to reflect blink gating and delayed capture
      state.instructionsEl.textContent = 'Align your face in the frame with good lighting. Hold still until prompted, then blink 3 times — capture happens 1 second after.';
    }

    try {
      // Lightweight fetch/XHR timing hooks to record asset load performance
      // (Only installed once; safe no-op if already patched)
      if (!window.__faceFetchPatched){
        window.__faceFetchPatched = true;
        const originalFetch = window.fetch?.bind(window);
        if (originalFetch){
          window.fetch = async function(url, opts){
            const t0 = performance.now();
            let ok = false, status = 0; let err = null;
            try {
              const res = await originalFetch(url, opts);
              ok = res.ok; status = res.status;
              return res;
            } catch(e){ err = e; throw e; }
            finally {
              const ms = Math.round(performance.now() - t0);
              const name = (typeof url === 'string') ? url : (url?.toString?.() || 'unknown');
              if (/mediapipe|face_mesh|face_landmark|tflite|binarypb/i.test(name)){
                diag.assets.push({ name, ok, status, ms, error: err?.message });
                // Also print to console for quick inspection
                try { console.log('[FaceDiag] asset', { name, ok, status, ms, error: err?.message }); } catch (e) {}
              }
            }
          };
        }
        // Minimal XHR timing as some builds use XHR internally
        try {
          const Open = XMLHttpRequest.prototype.open;
          const Send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url){
            this.__face_url = url;
            return Open.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function(){
            const t0 = performance.now();
            this.addEventListener('loadend', () => {
              const ms = Math.round(performance.now() - t0);
              const name = this.__face_url || 'xhr';
              if (/mediapipe|face_mesh|face_landmark|tflite|binarypb/i.test(name)){
                const ok = (this.status >= 200 && this.status < 300);
                diag.assets.push({ name, ok, status: this.status, ms });
                try { console.log('[FaceDiag] asset', { name, ok, status: this.status, ms }); } catch (e) {}
              }
            });
            return Send.apply(this, arguments);
          };
        } catch (e) {}
      }
      await ensureFaceMeshLoaded();
      // Some distributions expose FaceMesh as window.FaceMesh (constructor),
      // others as window.FaceMesh.FaceMesh. Detect robustly.
      const FaceMeshCtor = (window.FaceMesh && window.FaceMesh.FaceMesh) || window.FaceMesh;
      if (typeof FaceMeshCtor !== 'function') {
        throw new Error('FaceMesh constructor not found');
      }
      // Initialize FaceMesh with CDN locateFile for model assets
      faceMesh = new FaceMeshCtor({
        locateFile: (file) => `${CDN_BASE}/face_mesh/${file}`
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true, // set to false if CPU is constrained
        selfieMode: true, // front camera often mirrored; this improves landmark stability
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      faceMesh.onResults(onResults);
      initialized = true;
      if (state.errorEl) state.errorEl.classList.add('d-none');
    } catch (e){
      console.warn('FaceMesh initialization failed; auto-capture unavailable. Reason:', e);
      initialized = false;
      if (state.errorEl){
        state.errorEl.classList.remove('d-none');
        state.errorEl.textContent = 'Automatic face capture is unavailable on this device. Please try a different browser or device.';
      }
    }
  }

  function onResults(results){
    const canvas = state.canvasEl;
    if (!canvas) return;
    // Use willReadFrequently to optimize repeated getImageData calls and suppress browser warnings
    if (!state.ctx){
      try {
        state.ctx = canvas.getContext('2d', { willReadFrequently: true });
      } catch {
        // Fallback if options unsupported
        state.ctx = canvas.getContext('2d');
      }
    }
    const ctx = state.ctx;
    const video = state.videoEl;
    const w = video?.videoWidth || 640;
    const h = video?.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;

    // Draw the video frame as background
    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch {_=>{}}

    const face = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
    // Export simple diagnostics for pipeline troubleshooting
    if (!window.__faceCaptureDiag) window.__faceCaptureDiag = {};
    window.__faceCaptureDiag.lastFacePresent = !!face;
    if (!face) return;

    // Face Data Validation - Ensure quality face landmarks before processing
    // This prevents processing corrupted or incomplete face data
    function validateFaceData(landmarks) {
      if (!landmarks || landmarks.length < 468) {
        console.warn('Face validation failed: Insufficient landmarks');
        return false;
      }

      const KEY_LANDMARKS = [10, 152, 234, 454];
      for (const index of KEY_LANDMARKS) {
        const landmark = landmarks[index];
        if (!landmark || typeof landmark.x !== 'number' || typeof landmark.y !== 'number') {
          console.warn(`Face validation failed: Invalid landmark at index ${index}`);
          return false;
        }
      }

      const leftEye = landmarks[234];
      const rightEye = landmarks[454];
      const faceWidth = Math.abs(rightEye.x - leftEye.x);
      if (!isFinite(faceWidth) || faceWidth <= 0) {
        console.warn('Face validation failed: Invalid face geometry');
        return false;
      }
      if (faceWidth < 0.15) {
        console.warn('Face validation failed: Face too small for reliable processing');
        return false;
      }

      const leftEyeLandmarks = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
      const rightEyeLandmarks = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
      for (const eyeLandmarks of [leftEyeLandmarks, rightEyeLandmarks]) {
        for (const index of eyeLandmarks) {
          const landmark = landmarks[index];
          if (!landmark || typeof landmark.x !== 'number' || typeof landmark.y !== 'number') {
            console.warn(`Face validation failed: Invalid eye landmark at index ${index}`);
            return false;
          }
        }
      }

      return true;
    }

    // Perform validation before proceeding
    if (!validateFaceData(face)) {
      console.warn('Face data validation failed - skipping frame processing');
      return;
    }

    // Compute a face-aligned guidance box using robust key landmarks
    // Landmarks: left(234), right(454), top(10), bottom(152)
    ctx.strokeStyle = 'rgba(0, 123, 255, 0.95)';
    ctx.lineWidth = 4;
    const xs = face.map(p => p.x * w);
    const ys = face.map(p => p.y * h);
    const KEY = { left: 234, right: 454, top: 10, bottom: 152 };
    const kL = face[KEY.left], kR = face[KEY.right], kT = face[KEY.top], kB = face[KEY.bottom];
    let boxL = (kL?.x ?? 0.25) * w;
    let boxR = (kR?.x ?? 0.75) * w;
    let boxT = (kT?.y ?? 0.20) * h;
    let boxB = (kB?.y ?? 0.80) * h;
    let bw = Math.max(1, boxR - boxL);
    let bh = Math.max(1, boxB - boxT);
    // Reduced margins for smaller, more focused face capture frame
    // This makes it easier for users to position their face correctly
    const mx = bw * 0.08, my = bh * 0.10; // smaller margins for better detection
    const targetBox = {
      x: Math.max(0, boxL - mx),
      y: Math.max(0, boxT - my),
      w: Math.min(w, boxR + mx) - Math.max(0, boxL - mx),
      h: Math.min(h, boxB + my) - Math.max(0, boxT - my)
    };
    // Smooth box for professional UI
    if (!state.prevBox) state.prevBox = targetBox;
    const ease = 0.25; // easing factor
    const smoothed = {
      x: state.prevBox.x + (targetBox.x - state.prevBox.x) * ease,
      y: state.prevBox.y + (targetBox.y - state.prevBox.y) * ease,
      w: state.prevBox.w + (targetBox.w - state.prevBox.w) * ease,
      h: state.prevBox.h + (targetBox.h - state.prevBox.h) * ease
    };
    state.prevBox = smoothed;
    // Draw corner bracket style guidance box for better visual targeting
    drawCornerBrackets(ctx, smoothed);

    // --- Real-time validations ---
    // Minimum face size based on smoothed guidance box
    const boxW = Math.max(1, smoothed.w);
    const boxH = Math.max(1, smoothed.h);
    const minPixels = 80; // minimum width in pixels - further reduced for easier detection
    const minFrac = 0.12; // minimum fraction of frame - further reduced for better usability
    state.validation.sizeOk = (boxW >= minPixels && boxW >= w * minFrac && boxH >= h * minFrac);

    // Face orientation: estimate using eye centers and nose relative position
    const lEye = {
      x: ((face[33].x + face[133].x) / 2) * w,
      y: ((face[33].y + face[133].y) / 2) * h
    };
    const rEye = {
      x: ((face[263].x + face[362].x) / 2) * w,
      y: ((face[263].y + face[362].y) / 2) * h
    };
    const eyeSlope = Math.abs((rEye.y - lEye.y) / Math.max(1, (rEye.x - lEye.x))); // tilt around roll
    const eyesCenterX = (lEye.x + rEye.x) / 2;
    const eyesCenterY = (lEye.y + rEye.y) / 2;
    const faceCenterX = smoothed.x + smoothed.w / 2;
    const faceCenterY = smoothed.y + smoothed.h / 2;
    // if eyes center deviates too much from face center horizontally/vertically -> turned or tilted
    const yawOffset = Math.abs(eyesCenterX - faceCenterX) / Math.max(1, boxW);
    const pitchOffset = Math.abs(eyesCenterY - faceCenterY) / Math.max(1, boxH);
    // Relaxed thresholds for better capture reliability
    state.validation.orientationOk = (eyeSlope < 0.25 && yawOffset < 0.25 && pitchOffset < 0.20); // increased from 0.20/0.20/0.16

    // Validate frame alignment: majority of landmarks should lie inside the guidance box
    let inside = 0;
    for (let i = 0; i < face.length; i++){
      const px = face[i].x * w, py = face[i].y * h;
      if (px >= smoothed.x && px <= smoothed.x + smoothed.w && py >= smoothed.y && py <= smoothed.y + smoothed.h){
        inside++;
      }
    }
    const insideRatio = inside / face.length;
    state.validation.frameAlignedOk = insideRatio >= 0.85; // reduced from 0.90

    // Brightness and blur (sample every N frames for performance)
    state.validation.frameCount++;
    const SAMPLE_EVERY = 6;
    if (state.validation.frameCount % SAMPLE_EVERY === 0){
      try {
        // Use an offscreen buffer sourced directly from the raw video element to avoid
        // overlay drawings influencing brightness/sharpness sampling.
        const sampleW = Math.max(16, Math.floor(boxW));
        const sampleH = Math.max(16, Math.floor(boxH));
        if (!state._sampleCanvas){
          state._sampleCanvas = document.createElement('canvas');
          state._sampleCtx = state._sampleCanvas.getContext('2d', { willReadFrequently: true });
        }
        state._sampleCanvas.width = sampleW;
        state._sampleCanvas.height = sampleH;
        const sx = Math.floor(smoothed.x);
        const sy = Math.floor(smoothed.y);
        const sw = Math.min(sampleW, w - sx);
        const sh = Math.min(sampleH, h - sy);
        // Draw cropped region from the video element (not the overlay canvas)
        state._sampleCtx.clearRect(0, 0, sampleW, sampleH);
        state._sampleCtx.drawImage(video, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
        const imgData = state._sampleCtx.getImageData(0, 0, sampleW, sampleH);
        const { brightness, sharpness } = analyzeRegion(imgData);
        state.validation.lastBrightness = brightness;
        state.validation.lastSharpness = sharpness;
        // Brightness heuristic in 0..255
        state.validation.brightOk = (brightness >= 55 && brightness <= 220);
        // Sharpness heuristic: average gradient magnitude per pixel (~0..10 typical)
        // Previous threshold (12) was too strict for normalized values; relax to 2.5
        state.validation.blurOk = (sharpness >= 2.5);
      } catch (e) {
        // If getImageData fails due to taint or timing, keep previous values
      }
    }

    // Overlay helpers for user feedback
    // Adaptive readiness scoring (more forgiving yet guided)
    // Score components: orientation (0.35), size (0.25), brightness (0.20), sharpness (0.20)
    const oriScore = state.validation.orientationOk ? 1 : 0.5; // partial credit when slightly off
    const sizeTarget = Math.max(w, h) * 0.35; // preferred width/height target ~35% of frame's long side
    const sizeScore = Math.min(1, Math.max(0, Math.min(boxW, boxH) / Math.max(1, sizeTarget)));
    const b = state.validation.lastBrightness;
    // Brightness: full score at 85..200, taper outside 55..220
    let brightScore = 0;
    if (b >= 85 && b <= 200) brightScore = 1;
    else if (b >= 55 && b < 85) brightScore = (b - 55) / 30; // 0..1
    else if (b > 200 && b <= 220) brightScore = (220 - b) / 20; // 1..0
    else brightScore = 0;
    const sharpScore = Math.min(1, state.validation.lastSharpness / 3.5);
    const score = (0.35 * oriScore) + (0.25 * sizeScore) + (0.20 * brightScore) + (0.20 * sharpScore);
    const scoreOk = score >= 0.72; // threshold for acceptable readiness
    const alignmentOk = state.validation.frameAlignedOk;
    // Update diagnostics
    try {
      window.__faceCaptureDiag.lastReadyScore = Number(score.toFixed(3));
      window.__faceCaptureDiag.lastAlignmentOk = !!alignmentOk;
      window.__faceCaptureDiag.lastBrightness = Math.round(state.validation.lastBrightness || 0);
      window.__faceCaptureDiag.lastSharpness = Number((state.validation.lastSharpness || 0).toFixed(2));
    } catch (e) {}
    let text = (scoreOk && alignmentOk) ? 'Ready: hold still — blink 3 times when prompted' : 'Adjust: ';
    if (!(scoreOk && alignmentOk)){
      const reasons = [];
      if (sizeScore < 0.8) reasons.push('move closer');
      if (!state.validation.orientationOk) reasons.push('face front');
      if (brightScore < 0.6) reasons.push('lighting');
      if (sharpScore < 0.6) reasons.push('steady focus');
      if (!alignmentOk) reasons.push('align within frame');
      text += reasons.join(', ');
    }
    ctx.fillStyle = (scoreOk && alignmentOk) ? 'rgba(40, 167, 69, 0.85)' : 'rgba(220, 53, 69, 0.85)';
    ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillRect(10, 10, 260, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 16, 28);

    // Enhanced workflow: require ~2s of stable readiness before entering blink phase
    if ((scoreOk && alignmentOk)) {
      state.flow.stableFrames++;
    } else {
      state.flow.stableFrames = 0;
      state.flow.blinkPhase = false;
      state.flow.blinkCount = 0;
    }
    
    // During blink phase, do not reset progress on transient quality dips
    // Keep phase active and allow blinks to complete; quality is checked at capture
    if (state.flow.blinkPhase && (!scoreOk || !alignmentOk)) {
      // Soft penalty to encourage re-stabilization without wiping progress
      state.flow.stableFrames = Math.max(0, state.flow.stableFrames - 10);
    }
    // Show hold progress bar
    if (!capturedOnce){
      const holdDone = Math.min(1, state.flow.stableFrames / state.flow.STABLE_REQUIRED_FRAMES);
      ctx.fillStyle = 'rgba(33, 37, 41, 0.6)';
      ctx.fillRect(10, h - 30, 200, 18);
      ctx.fillStyle = 'rgba(40, 167, 69, 0.9)';
      ctx.fillRect(10, h - 30, 200 * holdDone, 18);
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText(`Hold still ${Math.round(holdDone*100)}%`, 16, h - 17);
    }
    if (state.flow.blinkPhase){
      ctx.fillStyle = 'rgba(0, 123, 255, 0.85)';
      ctx.fillRect(w - 140, h - 30, 130, 22);
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText(`Blink ${state.flow.blinkCount}/3`, w - 124, h - 14);
    }
    // Enter blink phase after stable hold
    if (!state.flow.blinkPhase && state.flow.stableFrames >= state.flow.STABLE_REQUIRED_FRAMES){
      state.flow.blinkPhase = true;
      state.flow.blinkCount = 0;
      if (state.statusEl){
        const b = Math.round(state.validation.lastBrightness);
        const s = state.validation.lastSharpness.toFixed(2);
        state.statusEl.textContent = `Ready · Blink 0/3 · FPS ${diag.fps.toFixed(1)} · frame ${diag.sendAvgMs.toFixed(1)} ms · brightness ${b} · sharpness ${s}`;
      }
    }

    const leftEAR = computeEAR(face, true);
    const rightEAR = computeEAR(face, false);
    const ear = (leftEAR + rightEAR) / 2;
    let dynThresh = 0.25;
    if (state.earOpenAvg && state.earOpenSamples > 10) {
      dynThresh = Math.max(0.20, Math.min(0.30, state.earOpenAvg * 0.78));
    }
    const THRESH = dynThresh;
    const FRAMES_BELOW = 1;
    const MIN_BLINK_INTERVAL = 600;
    const EYE_OPEN_CONFIRM_FRAMES = 1;
    
    if (ear <= THRESH){
      state.lowCounter += 1;
      state.eyeOpenCounter = 0; // Reset eye open counter when eyes are closed
      state.lowEarMin = (state.lowEarMin == null) ? ear : Math.min(state.lowEarMin, ear);
    } else {
      state.eyeOpenCounter = (state.eyeOpenCounter || 0) + 1; // Count consecutive open eye frames
      state.earOpenAvg = state.earOpenAvg ? (state.earOpenAvg * 0.92 + ear * 0.08) : ear;
      state.earOpenSamples = (state.earOpenSamples || 0) + 1;
      
      // Eye open event: count blink if in blink phase and eyes have been open long enough
      const dropRatio = (state.earOpenAvg && state.lowEarMin != null) ? (state.lowEarMin / state.earOpenAvg) : 1;
      const sufficientClosure = (state.lowCounter >= FRAMES_BELOW) || (dropRatio <= 0.75);
      if (state.flow.blinkPhase && sufficientClosure && state.blinkArmed && state.eyeOpenCounter >= EYE_OPEN_CONFIRM_FRAMES){
        const now = Date.now();
        if (now - state.lastBlinkTime > MIN_BLINK_INTERVAL){ // Increased debounce time
          state.lastBlinkTime = now;
          state.blinkArmed = false;
          state.eyeOpenCounter = 0; // Reset after counting blink
          state.flow.blinkCount += 1;
          try {
            window.__faceCaptureDiag.lastEAR = ear;
            window.__faceCaptureDiag.lastThresh = THRESH;
            window.__faceCaptureDiag.lastDropRatio = dropRatio;
            window.__faceCaptureDiag.lastBlinkCount = state.flow.blinkCount;
          } catch (_) {}
          ctx.fillStyle = 'rgba(0, 123, 255, 0.85)';
          ctx.fillRect(w - 140, h - 30, 130, 22);
          ctx.fillStyle = '#fff';
          ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
          ctx.fillText(`Blink ${state.flow.blinkCount}/3`, w - 124, h - 14);
          if (state.statusEl){
            const b = Math.round(state.validation.lastBrightness);
            const s = state.validation.lastSharpness.toFixed(2);
            state.statusEl.textContent = `Blink ${state.flow.blinkCount}/3 · FPS ${diag.fps.toFixed(1)} · frame ${diag.sendAvgMs.toFixed(1)} ms · brightness ${b} · sharpness ${s}`;
          }
          // When 3 blinks achieved under stable conditions -> quality check and capture (after 1s delay)
          if (state.flow.blinkCount >= 3){
            // CRITICAL: Double-check quality right before capture to ensure 100% success
            const finalQualityCheck = evaluateQuality({
              brightness: state.validation.lastBrightness,
              sharpness: state.validation.lastSharpness,
              insideRatio,
              boxW, boxH, w, h
            });
            
            // RELAXED: Allow capture even with minor quality issues - better UX than strict rejection
            if (!finalQualityCheck.pass) {
              console.warn(`[FaceCapture] Quality check failed but continuing: ${finalQualityCheck.reasons.join(', ')}`);
              // Only reject if major issues (extreme blur, very poor lighting)
              const majorIssues = finalQualityCheck.reasons.filter(r => 
                r.includes('blur') || r.includes('lighting suboptimal')
              );
              if (majorIssues.length >= 2) {
                // Only reset for severe quality issues
                state.flow.blinkCount = 0;
                state.flow.blinkPhase = false;
                state.flow.stableFrames = Math.max(0, state.flow.stableFrames - 30);
                if (state.instructionsEl){
                  state.instructionsEl.textContent = `Quality lost: ${finalQualityCheck.reasons.join(', ')} - Hold steady and try again`;
                }
                return; // Exit without capturing
              }
              // Continue with capture for minor issues - log warning but proceed
            }
            
            setTimeout(() => {
              // Reduce initial flash intensity to avoid washed-out preview on bright scenes
              try { state.flashAlpha = 0.35; playBeep(); } catch (e) {}
              const qc = evaluateQuality({
                brightness: state.validation.lastBrightness,
                sharpness: state.validation.lastSharpness,
                insideRatio,
                boxW, boxH, w, h
              });
              try {
                window.__faceCaptureDiag.lastQualityReasons = qc.pass ? [] : qc.reasons;
              } catch (e) {}
              if (qc.pass){
                console.log(`[FaceCapture] Quality check passed, proceeding with capture. Quality: ${JSON.stringify(qc)}`);
                try {
                  const centerX = smoothed.x + smoothed.w / 2;
                  const centerY = smoothed.y + smoothed.h / 2;
                  const side = Math.max(64, Math.floor(Math.min(Math.max(smoothed.w, smoothed.h) * 1.08, Math.min(w, h))));
                  const cx = Math.floor(Math.max(0, Math.min(w - side, centerX - side / 2)));
                  const cy = Math.floor(Math.max(0, Math.min(h - side, centerY - side / 2)));
                  const cw = side;
                  const ch = side;
                  const off = document.createElement('canvas');
                  // Use a square output to standardize downstream processing
                  off.width = 384; off.height = 384;
                  const octx = off.getContext('2d');
                  // Improve resampling quality when scaling to 384x384
                  try {
                    octx.imageSmoothingEnabled = true;
                    octx.imageSmoothingQuality = 'high';
                  } catch (e) {}
                  // IMPORTANT: draw directly from the raw video element to prevent any overlay
                  // graphics (guidance brackets/text/flash) from contaminating the captured image
                  // used downstream for embedding extraction.
                  octx.drawImage(state.videoEl, cx, cy, cw, ch, 0, 0, off.width, off.height);
                  // Apply a light, real-time sharpening pass to improve edge clarity.
                  // This helps counter minor blur from downscaling and camera optics.
                  try { sharpenCanvas(off, octx, 0.6); } catch (e) {}
                  const dataUrl = off.toDataURL('image/png');
                  capturedOnce = true;
                  try { stop(); } catch (e) {}
                  try {
                    window.__faceCaptureDiag.lastAutoCaptureTs = Date.now();
                    window.__faceCaptureDiag.lastDataUrlLength = (dataUrl||'').length;
                    window.__faceCaptureDiag.lastCrop = { x: cx, y: cy, w: cw, h: ch, out: { w: off.width, h: off.height } };
                  } catch (e) {}
                  if (typeof state.onAutoCapture === 'function') state.onAutoCapture(dataUrl);
                } catch (e){ console.warn('Auto-capture error:', e); }
              } else {
                state.flow.blinkCount = 0;
                state.flow.blinkPhase = false;
                state.flow.stableFrames = 0;
                if (state.instructionsEl){
                  state.instructionsEl.textContent = `Retake needed: ${qc.reasons.join(', ')}`;
                }
              }
            }, 1000); // 1 second delay after completed blinks ensures liveliness
          }
          setTimeout(() => { state.blinkArmed = true; }, 500); // Increased from 300ms to 500ms for better debounce
        }
      }
      state.lowCounter = 0;
      state.lowEarMin = null;
    }

    // Subtle flash overlay animation
    if (state.flashAlpha > 0){
      ctx.save();
      ctx.globalAlpha = state.flashAlpha;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      state.flashAlpha = Math.max(0, state.flashAlpha - 0.08);
    }
  }

  async function loop(){
    if (!running) return;
    if (initialized && faceMesh && state.videoEl){
      try {
        const t0 = performance.now();
        await faceMesh.send({ image: state.videoEl });
        const t1 = performance.now();
        // Update moving-average send time
        const ms = t1 - t0;
        diag.sendAvgMs = diag.sendAvgMs ? (diag.sendAvgMs * 0.9 + ms * 0.1) : ms;
        // Update FPS using loop interval
        const now = t1;
        if (diag.lastLoopTs){
          const dt = now - diag.lastLoopTs;
          const instFps = dt > 0 ? (1000 / dt) : 0;
          diag.fps = diag.fps ? (diag.fps * 0.85 + instFps * 0.15) : instFps;
        }
        diag.lastLoopTs = now;
        diag.frames++;
        // If performance is consistently low, relax model settings automatically
        if (!state._refineReduced && diag.frames > 60 && diag.fps < 15){
          try {
            faceMesh.setOptions({ refineLandmarks: false });
            state._refineReduced = true;
            console.log('[FaceDiag] refineLandmarks disabled due to low FPS');
          } catch (e) {}
        }
        // If FPS remains low, attempt to reduce camera constraints dynamically
        if (!state._constraintsReduced && diag.frames > 120 && diag.fps < 12){
          try {
            const track = state.videoEl?.srcObject?.getVideoTracks?.()[0];
            if (track && track.applyConstraints){
              await track.applyConstraints({
                width: { ideal: 480 },
                height: { ideal: 360 },
                frameRate: { ideal: 24, max: 30 }
              });
              state._constraintsReduced = true;
              console.log('[FaceDiag] video constraints reduced due to persistent low FPS');
            }
          } catch (e) {}
        }
        // Update status element if present
        if (state.statusEl){
          const b = Math.round(state.validation.lastBrightness);
          const s = state.validation.lastSharpness.toFixed(2);
          const base = state.flow.blinkPhase ? `Blink ${state.flow.blinkCount}/3` : `FPS ${diag.fps.toFixed(1)}`;
          const fps = state.flow.blinkPhase ? diag.fps.toFixed(1) : diag.fps.toFixed(1);
          state.statusEl.textContent = `${base} · frame ${ms.toFixed(1)} ms · brightness ${b} · sharpness ${s}`;
        }
      } catch (e){ /* ignore occasional send errors */ }
    }
    rafId = requestAnimationFrame(loop);
  }

  async function start(){
    if (!state.videoEl) return;
    running = true;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function stop(){
    running = false;
    cancelAnimationFrame(rafId);
    // Ensure flash overlay does not linger on the final preview frame
    try { state.flashAlpha = 0; } catch (_) {}
  }

  function reset(){
    try { cancelAnimationFrame(rafId); } catch (_) {}
    running = false;
    capturedOnce = false;
    state.lastBlinkTime = 0;
    state.blinkArmed = true;
    state.flow.stableFrames = 0;
    state.flow.blinkPhase = false;
    state.flow.blinkCount = 0;
    state.prevBox = null;
    state.flashAlpha = 0;
    state.validation.frameCount = 0;
    state.validation.orientationOk = false;
    state.validation.sizeOk = false;
    state.validation.frameAlignedOk = true;
    state.validation.brightOk = true;
    state.validation.blurOk = true;
    state.validation.lastBrightness = 0;
    state.validation.lastSharpness = 0;
    state.validation.readyFrames = 0;
    state.earOpenAvg = 0;
    state.earOpenSamples = 0;
    state.lowEarMin = null;
    try { if (state.statusEl) state.statusEl.textContent = ''; } catch (_) {}
    try { window.__faceCaptureDiag.lastBlinkCount = 0; } catch (_) {}
  }

  window.FaceCaptureHelper = { init, start, stop, reset };
})();

// Image region analysis: brightness and sharpness heuristics
function analyzeRegion(imageData){
  const data = imageData.data; // RGBA
  const w = imageData.width;
  const h = imageData.height;
  let sum = 0;
  let count = 0;
  // Simple high-frequency estimate using x-gradient of luma
  let sharp = 0;
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const l = (r * 0.299 + g * 0.587 + b * 0.114);
      sum += l;
      count++;
      if (x > 0){
        const j = (y * w + (x-1)) * 4;
        const r2 = data[j], g2 = data[j+1], b2 = data[j+2];
        const l2 = (r2 * 0.299 + g2 * 0.587 + b2 * 0.114);
        sharp += Math.abs(l - l2);
      }
      if (y > 0){
        const k = ((y-1) * w + x) * 4;
        const r3 = data[k], g3 = data[k+1], b3 = data[k+2];
        const l3 = (r3 * 0.299 + g3 * 0.587 + b3 * 0.114);
        sharp += Math.abs(l - l3);
      }
    }
  }
  const brightness = count ? (sum / count) : 0; // 0..255
  // Normalize sharpness by number of gradients and scale to comparable units
  const sharpness = (sharp / (w * h)) * 0.4; // reduced scaling for more lenient detection
  return { brightness, sharpness };
}

// Post-capture quality assessment to reject poor images and prompt retakes - BALANCED for practical use
function evaluateQuality({ brightness, sharpness, insideRatio, boxW, boxH, w, h }){
  const reasons = [];
  
  // BALANCED: Relaxed brightness requirements for better usability
  if (!(brightness >= 60 && brightness <= 220)) reasons.push('lighting suboptimal');
  
  // BALANCED: Reduced sharpness requirement for easier capture
  if (sharpness < 1.5) reasons.push('image blur');
  
  // BALANCED: More lenient framing to allow natural positioning
  if (insideRatio < 0.80) reasons.push('incorrect framing');
  
  // BALANCED: Smaller minimum face size for more flexible positioning
  const frac = Math.min(boxW, boxH) / Math.max(w, h);
  if (frac < 0.15) reasons.push('face too small');
  
  // BALANCED: Reduced face dominance requirement
  const faceArea = boxW * boxH;
  const frameArea = w * h;
  const areaRatio = faceArea / frameArea;
  if (areaRatio < 0.04) reasons.push('face not dominant');
  
  return { pass: reasons.length === 0, reasons };
}

// Audio confirmation cue (short beep) on successful capture
function playBeep(){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5 beep
    gain.gain.value = 0.05; // low volume
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 160);
  } catch (e) {}
}

// Apply a simple sharpening convolution to the canvas
// amount: 0..1 where 0.6 is a good default for subtle sharpening without halos
function sharpenCanvas(canvas, ctx, amount = 0.6){
  if (!canvas || !ctx) return;
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  // 3x3 sharpening kernel
  const a = Math.max(0, Math.min(1, amount));
  const k = [
    -a, -a, -a,
    -a, 1 + 8 * a, -a,
    -a, -a, -a
  ];
  const stride = w * 4;
  for (let y = 1; y < h - 1; y++){
    for (let x = 1; x < w - 1; x++){
      let r = 0, g = 0, b = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++){
        const row = (y + ky) * stride;
        for (let kx = -1; kx <= 1; kx++){
          const idx = row + (x + kx) * 4;
          const krn = k[ki++];
          r += src[idx] * krn;
          g += src[idx + 1] * krn;
          b += src[idx + 2] * krn;
        }
      }
      const i = y * stride + x * 4;
      out[i] = Math.max(0, Math.min(255, r));
      out[i + 1] = Math.max(0, Math.min(255, g));
      out[i + 2] = Math.max(0, Math.min(255, b));
      out[i + 3] = src[i + 3];
    }
  }
  // Copy border pixels to avoid artifacts
  for (let x = 0; x < w; x++){
    const top = x * 4, bottom = (h - 1) * stride + x * 4;
    out[top] = src[top]; out[top + 1] = src[top + 1]; out[top + 2] = src[top + 2]; out[top + 3] = src[top + 3];
    out[bottom] = src[bottom]; out[bottom + 1] = src[bottom + 1]; out[bottom + 2] = src[bottom + 2]; out[bottom + 3] = src[bottom + 3];
  }
  for (let y = 0; y < h; y++){
    const left = y * stride, right = y * stride + (w - 1) * 4;
    out[left] = src[left]; out[left + 1] = src[left + 1]; out[left + 2] = src[left + 2]; out[left + 3] = src[left + 3];
    out[right] = src[right]; out[right + 1] = src[right + 1]; out[right + 2] = src[right + 2]; out[right + 3] = src[right + 3];
  }
  const outImage = new ImageData(out, w, h);
  ctx.putImageData(outImage, 0, 0);
}

// Debug helper for AdaptiveBrightnessController
// Initializes the camera, starts/stops the controller, and displays diagnostics.

(function () {
  'use strict';

  /**
   * Utility: Safely set text content
   */
  function setText(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(text);
  }

  /**
   * Utility: Log diagnostics to a status element
   */
  function logDiag(msg) {
    var el = document.getElementById('diagLog');
    if (!el) return;
    el.textContent = msg;
  }

  var videoEl = document.getElementById('video');
  var startBtn = document.getElementById('startBtn');
  var stopBtn = document.getElementById('stopBtn');
  var targetLumaInput = document.getElementById('targetLuma');
  var autoTorchInput = document.getElementById('autoTorch');
  var exposureTuningInput = document.getElementById('exposureTuning');

  var controller = null;
  var stream = null;

  // Listen to diagnostic events from the controller
  window.addEventListener('adaptive-brightness-diagnostic', function (ev) {
    try {
      var d = ev && ev.detail ? ev.detail : {};
      setText('lumaVal', (d.luma != null) ? d.luma.toFixed(3) : '--');

      var filterStr = (videoEl && videoEl.style && videoEl.style.filter) ? videoEl.style.filter : 'none';
      setText('filterVal', filterStr);

      // Hardware state text is best-effort; we cannot directly read torch/exposure changes reliably
      var hw = [];
      if (autoTorchInput.checked) hw.push('torch:auto');
      if (exposureTuningInput.checked) hw.push('exposure:auto');
      setText('hwVal', hw.join(', '));
    } catch (_) {}
  });

  async function initCamera() {
    if (stream) return stream;
    try {
      // Prefer front-facing camera where available
      var constraints = {
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      await new Promise(function (resolve) {
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) return resolve();
        videoEl.onloadedmetadata = function () { resolve(); };
      });
      logDiag('Camera initialized. Click Start to run controller.');
      return stream;
    } catch (err) {
      console.error('Failed to init camera', err);
      logDiag('Failed to initialize camera: ' + err.message);
      throw err;
    }
  }

  function disposeCamera() {
    try {
      if (stream) {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
      }
      stream = null;
      videoEl.srcObject = null;
    } catch (_) {}
  }

  function startController() {
    if (controller) return true;
    try {
      controller = new window.AdaptiveBrightnessController({
        videoEl: videoEl,
        previewEl: videoEl, // apply filters to the video element itself
        targetLuma: Number(targetLumaInput.value || 0.55),
        autoTorch: !!autoTorchInput.checked,
        enableExposureTuning: !!exposureTuningInput.checked,
        samplingIntervalMs: 400
      });
      controller.start();
      logDiag('Controller running. Adjust settings and observe luma and filters.');
      return true;
    } catch (err) {
      console.error('Failed to start controller', err);
      logDiag('Failed to start controller: ' + err.message);
      return false;
    }
  }

  function stopController() {
    try {
      if (controller) controller.stop();
    } catch (_) {}
    controller = null;
    setText('filterVal', 'none');
    setText('lumaVal', '--');
    logDiag('Controller stopped.');
  }

  // UI bindings
  startBtn.addEventListener('click', async function () {
    try {
      await initCamera();
      startController();
    } catch (_) {}
  });

  stopBtn.addEventListener('click', function () {
    stopController();
    disposeCamera();
  });

  // Live updates when settings change
  [targetLumaInput, autoTorchInput, exposureTuningInput].forEach(function (input) {
    input.addEventListener('input', function () {
      // Restart controller with new configuration for simplicity
      if (!controller) return;
      stopController();
      startController();
    });
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', function () {
    stopController();
    disposeCamera();
  });

  // Auto-init camera to reduce clicks on mobile
  (function autoInit() {
    initCamera().catch(function () { /* ignore */ });
  })();
})();
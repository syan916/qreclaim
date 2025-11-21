/**
 * Adaptive Brightness Controller
 * Lightweight module that monitors the average luminance of a camera preview
 * and applies non-destructive CSS filter adjustments (brightness/contrast)
 * to improve QR and face detection accuracy in varied lighting while staying
 * energy efficient. Where supported, it can gently toggle the camera torch
 * and adjust exposure compensation via track.applyConstraints.
 *
 * Usage:
 *   const ctrl = new AdaptiveBrightnessController({
 *     videoEl: document.querySelector('video'),
 *     previewEl: document.querySelector('video'), // or canvas for face capture
 *     targetLuma: 0.55,
 *     autoTorch: true,
 *     samplingIntervalMs: 400,
 *   });
 *   ctrl.start();
 *   // Remember to stop when you dispose the camera
 *   ctrl.stop();
 *
 * Key Implementation Notes:
 * - Avoids deep nesting; returns early whenever assumptions fail.
 * - Computes luma from a reduced offscreen sample for efficiency.
 * - Applies small, clamped CSS filter adjustments to keep visuals natural.
 * - Uses appropriate concurrency control: a single in-flight analysis at a time.
 */

class AdaptiveBrightnessController {
  /**
   * @param {Object} opts
   * @param {HTMLVideoElement} opts.videoEl - Source video element (must have a srcObject stream)
   * @param {HTMLElement} [opts.previewEl] - Element to apply CSS filters to (video or canvas)
   * @param {number} [opts.targetLuma=0.55] - Desired normalized luminance [0..1]
   * @param {number} [opts.lowThreshold=0.35] - Low lighting threshold
   * @param {number} [opts.highThreshold=0.8] - High lighting threshold
   * @param {boolean} [opts.autoTorch=true] - Try to toggle torch where supported
   * @param {number} [opts.samplingIntervalMs=400] - Sampling interval (ms)
   * @param {boolean} [opts.enableExposureTuning=true] - Adjust exposure compensation when available
   */
  constructor(opts = {}) {
    // Validate required video element
    const videoEl = opts.videoEl;
    if (!videoEl) throw new Error('AdaptiveBrightnessController requires videoEl');
    this.videoEl = videoEl;
    // Target to apply filters; default to video itself
    this.previewEl = opts.previewEl || videoEl;
    // Configuration
    this.targetLuma = typeof opts.targetLuma === 'number' ? opts.targetLuma : 0.55;
    this.lowThreshold = typeof opts.lowThreshold === 'number' ? opts.lowThreshold : 0.35;
    this.highThreshold = typeof opts.highThreshold === 'number' ? opts.highThreshold : 0.8;
    this.autoTorch = opts.autoTorch !== false; // default true
    this.enableExposureTuning = opts.enableExposureTuning !== false; // default true
    this.samplingIntervalMs = Math.max(150, Number(opts.samplingIntervalMs || 400));
    // Internal state
    this._timer = null;
    this._running = false;
    this._analyzing = false;
    this._lastLuma = null;
    this._track = null;
    // Create small offscreen canvas for sampling
    this._offscreen = document.createElement('canvas');
    this._offscreen.width = 64; // tiny sample for efficiency
    this._offscreen.height = 48;
    this._ctx = this._offscreen.getContext('2d');

    // Attempt to resolve the video track lazily; may be replaced if stream changes
    try {
      const stream = this.videoEl.srcObject;
      this._track = stream && stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
    } catch (_) {
      this._track = null;
    }
  }

  /** Start adaptive monitoring */
  start() {
    if (this._running) return true;
    // Ensure video metadata is ready before sampling
    const ensureReady = () => {
      const w = this.videoEl.videoWidth || 0;
      const h = this.videoEl.videoHeight || 0;
      return w > 0 && h > 0;
    };

    const begin = () => {
      this._running = true;
      // Keep sampling at a modest interval for energy efficiency
      this._timer = setInterval(() => this._analyzeAndAdjust(), this.samplingIntervalMs);
    };

    if (ensureReady()) {
      begin();
      return true;
    }
    // Wait once for metadata
    this.videoEl.addEventListener('loadedmetadata', () => begin(), { once: true });
    return true;
  }

  /** Stop monitoring and clear CSS filter */
  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    // Reset filters for visual consistency when leaving
    try {
      if (this.previewEl && this.previewEl.style) {
        this.previewEl.style.filter = '';
      }
    } catch (_) {}
  }

  /** Core analysis loop */
  async _analyzeAndAdjust() {
    if (this._analyzing) return; // Concurrency control: avoid overlapping work
    this._analyzing = true;
    try {
      const vw = this.videoEl.videoWidth || 0;
      const vh = this.videoEl.videoHeight || 0;
      if (!vw || !vh) return; // Video not ready yet

      // Draw a reduced-size frame to offscreen canvas
      this._ctx.drawImage(this.videoEl, 0, 0, vw, vh, 0, 0, this._offscreen.width, this._offscreen.height);
      const img = this._ctx.getImageData(0, 0, this._offscreen.width, this._offscreen.height);
      const data = img.data;
      const len = data.length;
      let sum = 0;
      // Compute relative luminance using Rec. 709 coefficients
      for (let i = 0; i < len; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        // luma ~ 0..1
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const pixels = len / 4;
      const luma = pixels ? (sum / pixels) : 0;
      this._lastLuma = luma;

      // Dispatch diagnostic event for UIs that want to display brightness feedback
      try {
        const ev = new CustomEvent('adaptive-brightness-diagnostic', {
          detail: { luma, target: this.targetLuma, low: this.lowThreshold, high: this.highThreshold }
        });
        window.dispatchEvent(ev);
      } catch (_) {}

      // Compute CSS filter adjustments: gentle and clamped to keep visuals natural
      const delta = luma - this.targetLuma; // positive -> too bright; negative -> too dark
      const maxAdjust = 0.18; // clamp for human-friendly visuals
      let brightnessFactor = 1;
      let contrastFactor = 1;
      if (Math.abs(delta) > 0.02) {
        const adj = Math.max(-maxAdjust, Math.min(maxAdjust, -delta));
        brightnessFactor = 1 + adj; // if too dark (delta<0), increase brightness slightly
        // Slight contrast bump to keep QR edges and landmarks prominent
        contrastFactor = 1 + (Math.abs(adj) * 0.5);
      }

      // Apply CSS filter to preview element
      try {
        if (this.previewEl && this.previewEl.style) {
          this.previewEl.style.filter = `brightness(${brightnessFactor}) contrast(${contrastFactor})`;
        }
      } catch (_) {}

      // Optional hardware tuning: torch/exposure
      // Guard with capability checks and apply minimal changes for efficiency
      try {
        // Refresh track reference in case srcObject was updated
        if ((!this._track || this._track.readyState !== 'live') && this.videoEl.srcObject) {
          const tracks = this.videoEl.srcObject.getVideoTracks();
          this._track = tracks && tracks[0] ? tracks[0] : this._track;
        }
        const track = this._track;
        if (!track) return;
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        const settings = track.getSettings ? track.getSettings() : {};

        // Torch: enable when luma below low threshold; disable when above
        if (this.autoTorch && caps.torch) {
          const wantTorch = luma < this.lowThreshold;
          const hasTorch = settings.torch === true;
          if (wantTorch !== hasTorch) {
            await track.applyConstraints({ advanced: [{ torch: wantTorch }] });
          }
        }

        // Exposure compensation: make subtle adjustments toward target
        if (this.enableExposureTuning && caps.exposureCompensation) {
          const min = caps.exposureCompensation.min ?? -2;
          const max = caps.exposureCompensation.max ?? 2;
          const cur = settings.exposureCompensation ?? 0;
          let next = cur;
          if (luma < this.lowThreshold) {
            next = Math.min(max, cur + 0.25);
          } else if (luma > this.highThreshold) {
            next = Math.max(min, cur - 0.25);
          }
          if (Math.abs(next - cur) >= 0.2) {
            await track.applyConstraints({ advanced: [{ exposureCompensation: next }] });
          }
        }
      } catch (_) {
        // Ignore hardware tuning errors to keep experience smooth
      }
    } finally {
      this._analyzing = false;
    }
  }
}

// Expose to global scope for modules loaded via script tags
window.AdaptiveBrightnessController = AdaptiveBrightnessController;
/*
  Browse Claim Flow Override
  - Replaces the simple confirm-based claim flow with the full process:
    1) Confirm intent
    2) Start claim (POST /user/api/claims/start)
    3) Face capture modal (auto-capture on blink via FaceCaptureHelper)
    4) Save face (POST /user/api/claims/capture-face)
    5) Select verification method (default qr_face)
    6) Generate QR (POST /user/api/claims/generate-qr)
    7) Show QR with countdown + download

  This file expects the following modal elements to exist in the page:
    - #claimConfirmModal, #confirmClaimYesBtn
    - #faceCaptureModal, #faceVideo, #faceCanvas, #faceCaptureInstructions, #faceCaptureError, #cameraLoading, #faceSaveLoading
    - #verificationMethodModal, #confirmMethodBtn, #methodSelectLoading, #methodSelectError
    - #qrGeneratedModal, #qrImage, #qrCountdown, #downloadQrBtn, #qrGenerateLoading, #qrGenerateError
*/
(function(){
  if (window.__browseClaimFlowInstalled) return;
  window.__browseClaimFlowInstalled = true;

  const state = {
    currentItemId: null,
    claimId: null,
    faceDataUrl: null,
    cameraStream: null,
    // Adaptive brightness controller instance for face capture modal
    brightnessCtrl: null,
    countdownTimer: null,
    // Stage the selected verification method until final confirmation (Pic2)
    pendingMethod: 'qr_face',
    captureCompleted: false, // preserve successful capture across modal transitions
    // New: store student's remarks for valuable items
    studentRemarks: ''
  };

  // Utilities
  function showToast(msg, type='info'){
    try {
      if (window.userMsgBox){
        if (type === 'success') return window.userMsgBox.showSuccess(msg);
        if (type === 'error') return window.userMsgBox.showError(msg);
        if (type === 'warning') return window.userMsgBox.showWarning(msg);
        return window.userMsgBox.showInfo(msg);
      }
      if (typeof window.showNotification === 'function'){
        return window.showNotification(msg, type === 'error' ? 'error' : type);
      }
    } catch(_){ }
    alert(msg);
  }

  // Override global claimItem from browse-found-items.js
  const originalClaimItem = window.claimItem;
  window.claimItem = function(itemId){
    state.currentItemId = itemId;
    const confirmModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('claimConfirmModal'));
    confirmModal.show();
  };

  // Override requestQRApproval to prompt for student remarks first (valuable items)
  const originalRequestQRApproval = window.requestQRApproval;
  window.requestQRApproval = function(itemId){
    state.currentItemId = itemId;
    // Open remarks modal, then proceed to the usual claim confirmation flow
    try {
      const modalEl = document.getElementById('studentRemarksModal');
      if (modalEl){
        const rm = bootstrap.Modal.getOrCreateInstance(modalEl);
        // Reset textarea for a fresh entry
        const input = document.getElementById('studentRemarksInput');
        if (input){ input.value = ''; updateRemarksCounter(); }
        rm.show();
      } else {
        // Fallback: proceed without remarks
        console.warn('[ClaimFlow] studentRemarksModal not found, continuing without remarks');
        const confirmModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('claimConfirmModal'));
        confirmModal.show();
      }
    } catch(e){
      console.error(e);
      // Gracefully fallback to original behavior if any
      try { originalRequestQRApproval?.(itemId); } catch {}
    }
  };

  document.addEventListener('DOMContentLoaded', function(){
    // Fix aria-hidden accessibility issue for modals
    const studentRemarksModal = document.getElementById('studentRemarksModal');
    if (studentRemarksModal) {
      studentRemarksModal.addEventListener('shown.bs.modal', function() {
        this.removeAttribute('aria-hidden');
      });
      studentRemarksModal.addEventListener('hidden.bs.modal', function() {
        this.setAttribute('aria-hidden', 'true');
      });
    }

    const claimConfirmModal = document.getElementById('claimConfirmModal');
    if (claimConfirmModal) {
      claimConfirmModal.addEventListener('shown.bs.modal', function() {
        this.removeAttribute('aria-hidden');
      });
      claimConfirmModal.addEventListener('hidden.bs.modal', function() {
        this.setAttribute('aria-hidden', 'true');
        // Reset staged data when cancelling at confirmation stage
        resetTempClaimStage();
      });
    }

    const faceCaptureModal = document.getElementById('faceCaptureModal');
    if (faceCaptureModal) {
      faceCaptureModal.addEventListener('shown.bs.modal', function() {
        this.removeAttribute('aria-hidden');
        // Ensure other modals are not visible simultaneously
        hideModalIfOpen('verificationMethodModal');
        hideModalIfOpen('finalConfirmModal');
      });
      faceCaptureModal.addEventListener('hidden.bs.modal', function() {
        this.setAttribute('aria-hidden', 'true');
        fullCameraCleanup();
        // Do NOT reset staged face when auto-capture succeeded
        if (!state.captureCompleted) {
          resetTempClaimStage();
        }
      });
    }

    // Bind remarks modal submit/cancel handlers
    const remarksSubmitBtn = document.getElementById('submitStudentRemarksBtn');
    const remarksInput = document.getElementById('studentRemarksInput');
    if (remarksInput){
      remarksInput.addEventListener('input', updateRemarksCounter);
    }
    if (remarksSubmitBtn){
      remarksSubmitBtn.addEventListener('click', async function(){
        const input = document.getElementById('studentRemarksInput');
        const val = (input?.value || '').trim();
        // Basic validation: optional but enforce max length
        if (val.length > 300){
          showToast('Remarks must be 300 characters or fewer.', 'error');
          return;
        }
        
        // For approval requests, create pending claim and STOP here
        try {
          remarksSubmitBtn.disabled = true;
          remarksSubmitBtn.textContent = 'Submitting...';
          
          // Create approval request (pending claim) with remarks
          const res = await fetch('/user/api/claims/request-approval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              item_id: state.currentItemId, 
              student_remarks: val 
            })
          });
          
          const data = await res.json();
          if (!res.ok || !data?.success){
            throw new Error(data?.error || 'Failed to submit approval request');
          }
          
          // Close remarks modal
          const rm = bootstrap.Modal.getInstance(document.getElementById('studentRemarksModal'));
          rm?.hide();
          
          // Show success message and STOP the process
          showToast('Approval request submitted successfully! You will be notified once an admin reviews your request.', 'success');
          
          // Reset state
          state.currentItemId = null;
          state.studentRemarks = '';
          
        } catch(e) {
          console.error('Approval request failed:', e);
          showToast(e.message || 'Failed to submit approval request', 'error');
        } finally {
          remarksSubmitBtn.disabled = false;
          remarksSubmitBtn.textContent = 'Submit Request';
        }
      });
    }

    // Bind confirmation
    const yesBtn = document.getElementById('confirmClaimYesBtn');
    if (yesBtn){
      yesBtn.addEventListener('click', async function(){
        // Pic1: Only open face capture and stage data locally; do NOT write to Firebase yet.
        try {
          yesBtn.disabled = true;
          bootstrap.Modal.getInstance(document.getElementById('claimConfirmModal'))?.hide();
          await openFaceCaptureModal();
        } catch (e){
          console.error(e);
          showToast(e.message || 'Failed to open face capture', 'error');
        } finally {
          yesBtn.disabled = false;
        }
      });
    }

    // Manual capture removed: auto-capture is handled by FaceCaptureHelper and proceeds automatically

    // Bind method confirm
    const confirmMethodBtn = document.getElementById('confirmMethodBtn');
    if (confirmMethodBtn){
      confirmMethodBtn.addEventListener('click', confirmVerificationMethod);
    }

    // Bind final confirmation
    const finalizeConfirmBtn = document.getElementById('finalizeConfirmBtn');
    if (finalizeConfirmBtn){
      finalizeConfirmBtn.addEventListener('click', finalizeClaimAndProceed);
    }

    // Ensure we stop camera/helper if user closes the face modal manually
    const faceModalEl = document.getElementById('faceCaptureModal');
    if (faceModalEl){
      faceModalEl.addEventListener('hidden.bs.modal', function(){
        console.debug('[FaceFlow] faceCaptureModal hidden (global cleanup)');
        fullCameraCleanup();
        if (!state.captureCompleted) {
          resetTempClaimStage();
        }
      });
    }

    // Verification method modal exclusivity and reset
    const methodModalEl = document.getElementById('verificationMethodModal');
    if (methodModalEl){
      methodModalEl.addEventListener('show.bs.modal', function(){
        hideModalIfOpen('faceCaptureModal');
        hideModalIfOpen('finalConfirmModal');
      });
      methodModalEl.addEventListener('hidden.bs.modal', function(){
        // Reset only if user aborted before successful capture
        fullCameraCleanup();
        if (!state.captureCompleted) {
          resetTempClaimStage();
        }
      });
    }

    // Final confirmation modal exclusivity and reset
    const finalModalEl = document.getElementById('finalConfirmModal');
    if (finalModalEl){
      finalModalEl.addEventListener('show.bs.modal', function(){
        hideModalIfOpen('faceCaptureModal');
        hideModalIfOpen('verificationMethodModal');
      });
      finalModalEl.addEventListener('hidden.bs.modal', function(){
        // If user cancels here via X, clear staged data and camera
        fullCameraCleanup();
        if (!state.captureCompleted) {
          resetTempClaimStage();
        }
      });
    }
  });

  async function createClaimOnServer(){
    if (!state.currentItemId) throw new Error('Missing item id');
    
    // First check if user has any active claims or QR codes
    try {
      const userStatusRes = await fetch('/user/api/claims/user-status');
      const userStatusData = await userStatusRes.json().catch(() => ({}));
      
      if (userStatusRes.ok && userStatusData.has_active_claims) {
        const msg = 'You already have active claims. Please complete or cancel them before making new claims.';
        showToast(msg, 'error');
        throw new Error(msg);
      }
    } catch (e) {
      console.warn('Failed to check user claim status:', e);
    }
    
    const res = await fetch('/user/api/claims/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Include student_remarks when present (valuable items)
      body: JSON.stringify({ item_id: state.currentItemId, student_remarks: (state.studentRemarks || '').trim() })
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.claim_id){
      // Provide friendly messages for duplicate/prevented scenarios
      const msg = data?.error || (res.status === 409 ? 'A similar claim is already in progress.' : 'Failed to start claim');
      // Surface to user immediately
      showToast(msg, 'error');
      throw new Error(msg);
    }
    state.claimId = data.claim_id;
    return data;
  }

  async function openFaceCaptureModal(){
    try { window.FaceCaptureHelper?.reset?.(); } catch {}
    state.faceDataUrl = null;
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('faceCaptureModal'));
    modal.show();
    const loading = document.getElementById('cameraLoading');
    loading?.classList.remove('d-none');
    const secureOk = (window.isSecureContext === true) || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname || '') || (location.protocol === 'https:');
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    if (!(secureOk && hasMedia)){
      const errEl = document.getElementById('faceCaptureError');
      errEl?.classList.remove('d-none');
      if (errEl) errEl.textContent = 'Camera requires a secure context. Use the upload option below.';
      showMobileUploadFallback();
      loading?.classList.add('d-none');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, min: 24 } },
        audio: false
      });
      state.cameraStream = stream;
      const video = document.getElementById('faceVideo');
      if (video){
        try { video.setAttribute('playsinline', ''); video.setAttribute('muted', 'true'); video.setAttribute('autoplay', ''); } catch {}
        video.srcObject = stream;
        await video.play();
        try {
          if (window.AdaptiveBrightnessController){
            const previewCanvas = document.getElementById('faceCanvas');
            try { state.brightnessCtrl?.stop(); } catch {}
            state.brightnessCtrl = new AdaptiveBrightnessController({
              videoEl: video,
              previewEl: previewCanvas,
              targetLuma: 0.58,
              lowThreshold: 0.35,
              highThreshold: 0.85,
              autoTorch: true,
              samplingIntervalMs: 450,
              enableExposureTuning: true
            });
            state.brightnessCtrl.start();
          }
        } catch (e) {}
        try {
          if (window.FaceCaptureHelper){
            await FaceCaptureHelper.init({
              videoEl: document.getElementById('faceVideo'),
              canvasEl: document.getElementById('faceCanvas'),
              instructionsEl: document.getElementById('faceCaptureInstructions'),
              errorEl: document.getElementById('faceCaptureError'),
              statusEl: document.getElementById('autoCaptureStatus'),
              onAutoCapture: (dataUrl) => autoProceedAfterCapture(dataUrl),
            });
            await FaceCaptureHelper.start();
          }
        } catch(e){}
      }
    } catch(e){
      const errEl = document.getElementById('faceCaptureError');
      errEl?.classList.remove('d-none');
      if (errEl) errEl.textContent = 'Unable to access camera. Use the upload option below.';
      showMobileUploadFallback();
    } finally {
      loading?.classList.add('d-none');
    }
  }

  function showMobileUploadFallback(){
    try {
      const box = document.getElementById('mobileUploadFallback');
      const input = document.getElementById('faceFileInput');
      box?.classList.remove('d-none');
      if (input && !input.__bound){
        input.addEventListener('change', async function(){
          const f = this.files && this.files[0];
          if (!f) return;
          const d = await fileToSquareDataUrl(f, 384);
          if (!d) return;
          state.faceDataUrl = d;
          state.captureCompleted = true;
          const faceModal = bootstrap.Modal.getInstance(document.getElementById('faceCaptureModal'));
          faceModal?.hide();
          setTimeout(() => { openVerificationMethodModal(); }, 250);
        });
        input.__bound = true;
      }
    } catch(e){}
  }

  function fileToSquareDataUrl(file, size){
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const ctx = c.getContext('2d');
          const sw = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - sw) / 2);
          const sy = Math.floor((img.height - sw) / 2);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
          try { resolve(c.toDataURL('image/png')); } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = r.result;
      };
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
  }

  async function autoProceedAfterCapture(dataUrl){
    // Automatically proceed to verification method selection after a high-quality auto-capture
    state.faceDataUrl = dataUrl;
    state.captureCompleted = !!dataUrl;
    console.debug('[FaceFlow] auto-capture completed. dataUrl length=', (dataUrl||'').length);
    const saving = document.getElementById('faceSaveLoading');
    saving?.classList.remove('d-none');
    try {
      // Stop camera (we have staged the frame already)
      if (state.cameraStream){ state.cameraStream.getTracks().forEach(t => t.stop()); state.cameraStream = null; }
      try { window.FaceCaptureHelper?.stop(); } catch {}
      try { state.brightnessCtrl?.stop(); } catch {}
      state.brightnessCtrl = null;
      // Close and proceed with smooth transition
      const faceModal = bootstrap.Modal.getInstance(document.getElementById('faceCaptureModal'));
      faceModal?.hide();
      setTimeout(() => {
        openVerificationMethodModal();
      }, 250); // slight delay for smoother modal transition
    } catch(e){
      const errEl = document.getElementById('faceCaptureError');
      errEl?.classList.remove('d-none');
      if (errEl) errEl.textContent = e.message || 'Failed to stage face data';
       console.error('[FaceFlow] autoProceedAfterCapture error:', e);
    } finally {
      saving?.classList.add('d-none');
    }
  }

  function openVerificationMethodModal(){
    const methodModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('verificationMethodModal'));
    methodModal.show();
  }

  async function confirmVerificationMethod(){
    // Stage the verification method locally; persistence will happen at Pic2.
    const methodLoading = document.getElementById('methodSelectLoading');
    const methodError = document.getElementById('methodSelectError');
    methodError?.classList.add('d-none');
    methodLoading?.classList.remove('d-none');
    try {
      const selected = document.querySelector('input[name="verificationMethod"]:checked');
      state.pendingMethod = selected?.value || 'qr_face';
      // Guard: require a captured face before proceeding to final confirmation
      const hasFace = !!state.faceDataUrl && (state.faceDataUrl.length > 50);
      console.debug('[FaceFlow] confirmVerificationMethod: pendingMethod=', state.pendingMethod, 'face len=', (state.faceDataUrl||'').length);
      if (!hasFace){
        methodError?.classList.remove('d-none');
        if (methodError) {
          const hint = (window.__faceCaptureDiag && window.__faceCaptureDiag.lastFacePresent === false)
            ? 'No face detected in frame. Please retake your face image.'
            : 'No face image captured yet. Please capture before finalizing.';
          methodError.textContent = hint;
        }
        // Offer to reopen the face capture modal for user convenience
        try {
          openFaceCaptureModal();
        } catch {}
        return; // do not proceed to final confirmation
      }
      // Proceed to final confirmation modal
      bootstrap.Modal.getInstance(document.getElementById('verificationMethodModal'))?.hide();
      openFinalConfirmationModal();
    } catch(e){
      methodError?.classList.remove('d-none');
      if (methodError) methodError.textContent = e.message || 'Failed to stage method';
    } finally {
      methodLoading?.classList.add('d-none');
    }
  }

  function openFinalConfirmationModal(){
    const finalModalEl = document.getElementById('finalConfirmModal');
    if (finalModalEl){
      const finalModal = bootstrap.Modal.getOrCreateInstance(finalModalEl);
      finalModal.show();
    } else {
      // If the final confirmation modal is not present, finalize immediately (graceful fallback)
      finalizeClaimAndProceed();
    }
  }

  async function finalizeClaimAndProceed(){
    const finalBtn = document.getElementById('finalizeConfirmBtn');
    if (finalBtn){
      finalBtn.disabled = true;
      finalBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Finalizing...';
    }
    // Pic2: Persist staged data to Firebase in one chained flow
    // Steps: start -> capture-face -> select-method -> finalize -> generate-qr
    try {
      if (!state.faceDataUrl){
        const hint = (window.__faceCaptureDiag && window.__faceCaptureDiag.lastFacePresent === false)
          ? 'No face detected in frame'
          : (state.captureCompleted ? 'Face detected but capture failed' : 'No face image captured');
        throw new Error(hint);
      }
      if (!state.currentItemId) throw new Error('Missing item id');

      // First check if user has any active claims or QR codes
      try {
        const userStatusRes = await fetch('/user/api/claims/user-status');
        const userStatusData = await userStatusRes.json().catch(() => ({}));
        
        if (userStatusRes.ok && userStatusData.has_active_claims && !state.claimId) {
          const msg = 'You already have active claims. Please complete or cancel them before making new claims.';
          showToast(msg, 'error');
          throw new Error(msg);
        }
      } catch (e) {
        console.warn('Failed to check user claim status:', e);
      }

      // Create claim if not present
      if (!state.claimId){
        const startResp = await fetch('/user/api/claims/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // Pass along remarks for valuable items
          body: JSON.stringify({ item_id: state.currentItemId, student_remarks: (state.studentRemarks || '').trim() })
        });
        const startData = await startResp.json();
        if (!startResp.ok || !startData?.success || !startData?.claim_id){
          throw new Error(startData?.error || 'Failed to start claim');
        }
        state.claimId = startData.claim_id;
      }

      // Persist face image
      const faceResp = await fetch('/user/api/claims/capture-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, face_data_url: state.faceDataUrl })
      });
      const faceData = await faceResp.json();
      if (!faceResp.ok || !faceData?.success){
        const serverErr = faceData?.error || '';
        let msg = 'Data storage failure after successful capture';
        if (/Invalid face image data/i.test(serverErr)) msg = 'Face detected but capture failed (invalid data)';
        else if (/Claim not found/i.test(serverErr)) msg = 'Claim not found (server)';
        else if (/Failed to compute face embedding/i.test(serverErr)) msg = 'Data storage failure: embedding computation error';
        throw new Error(msg);
      }

      // Persist verification method
      const methodResp = await fetch('/user/api/claims/select-method', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, method: state.pendingMethod || 'qr_face' })
      });
      const methodData = await methodResp.json();
      if (!methodResp.ok || !methodData?.success){
        throw new Error(methodData?.error || 'Failed to set verification method');
      }

      // Finalize claim
      const finalizeResp = await fetch('/user/api/claims/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId })
      });
      const finalizeData = await finalizeResp.json();
      if (!finalizeResp.ok || !finalizeData?.success){
        throw new Error(finalizeData?.error || 'Failed to finalize claim');
      }

      // Close final modal if open
      const finalModal = bootstrap.Modal.getInstance(document.getElementById('finalConfirmModal'));
      finalModal?.hide();

      // Generate QR and show
      await generateQrAndShow();
    } catch(e){
      console.error('[FaceFlow] finalize error:', e);
      const finalErrEl = document.getElementById('finalizeError');
      if (finalErrEl){
        finalErrEl.classList.remove('d-none');
        finalErrEl.textContent = e.message || 'Finalization failed';
      } else {
        showToast(e.message || 'Finalization failed', 'error');
      }
      if (finalBtn){
        finalBtn.disabled = false;
        finalBtn.innerHTML = 'Finalize & Generate QR';
      }
    }
  }

  async function generateQrAndShow(){
    const qrLoading = document.getElementById('qrGenerateLoading');
    const qrError = document.getElementById('qrGenerateError');
    qrError?.classList.add('d-none');
    qrLoading?.classList.remove('d-none');
    try {
      const res = await fetch('/user/api/claims/generate-qr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId })
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !(data?.qr_image_url || data?.qr_code_url)){
        // Special handling: valuable items require admin approval
        if (res.status === 403 && (data?.code === 'ADMIN_APPROVAL_REQUIRED' || /Admin approval required/i.test(data?.error || ''))){
          const msg = 'Awaiting admin approval before QR can be generated. You will be notified once approved.';
          // Prefer toast over in-modal error
          showToast(msg, 'info');
          // Also show inline message if element exists
          qrError?.classList.remove('d-none');
          if (qrError) qrError.textContent = msg;
          return; // Stop here without throwing
        }
        throw new Error(data?.error || 'Failed to generate QR');
      }
      const qrImg = document.getElementById('qrImage');
      const downloadBtn = document.getElementById('downloadQrBtn');
      const qrUrl = data.qr_image_url || data.qr_code_url; // backend uses 'qr_image_url'
      if (qrImg) qrImg.src = qrUrl;
      if (downloadBtn) downloadBtn.href = qrUrl;
      const qrModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('qrGeneratedModal'));
      qrModal.show();
      try { showToast('Claim registered successfully. Your QR code is ready.', 'success'); } catch(_){}
      // Start countdown
      if (state.countdownTimer) clearInterval(state.countdownTimer);
      startExpirationCountdown(data.expires_at_ms || data.expires_at);
      
      // **REAL-TIME UPDATE**: After successful QR generation, update all item cards and buttons
      await updateAllItemButtonStates();
      
    } catch(e){
      qrError?.classList.remove('d-none');
      if (qrError) qrError.textContent = e.message;
    } finally {
      qrLoading?.classList.add('d-none');
    }
  }

  function startExpirationCountdown(expiresAt){
    const countdownEl = document.getElementById('qrCountdown');
    function format(ms){
      const total = Math.max(0, Math.floor(ms/1000));
      const m = String(Math.floor(total/60)).padStart(2,'0');
      const s = String(total%60).padStart(2,'0');
      return `${m}:${s}`;
    }
    function tick(){
      const now = Date.now();
      let targetTs = 0;
      try {
        if (typeof expiresAt === 'number') {
          targetTs = expiresAt; // already ms since epoch
        } else if (typeof expiresAt === 'string') {
          // Robust ISO parsing: trim microseconds to milliseconds and ensure Z suffix
          let iso = expiresAt;
          const dot = iso.indexOf('.');
          if (dot !== -1){
            const zPos = iso.indexOf('Z', dot);
            const plusPos = iso.indexOf('+', dot);
            const endPos = zPos !== -1 ? zPos : (plusPos !== -1 ? plusPos : iso.length);
            const frac = iso.slice(dot+1, endPos).replace(/[^0-9]/g,'');
            const ms = frac.slice(0,3).padEnd(3,'0');
            iso = iso.slice(0, dot) + '.' + ms + (zPos !== -1 ? 'Z' : (plusPos !== -1 ? iso.slice(plusPos) : 'Z'));
          } else if (!/Z|[\+\-]\d{2}:?\d{2}$/.test(iso)) {
            iso += 'Z';
          }
          targetTs = Date.parse(iso);
        }
        else if (expiresAt && typeof expiresAt === 'object' && 'seconds' in expiresAt){
          targetTs = (expiresAt.seconds * 1000) + Math.floor((expiresAt.nanoseconds || 0)/1e6);
        }
      } catch {}
      const remaining = targetTs ? (targetTs - now) : (5*60*1000);
      if (countdownEl) countdownEl.textContent = format(remaining);
      if (remaining <= 0){
        clearInterval(state.countdownTimer);
        showToast('QR code expired. Generate a new one from your claim history if needed.', 'info');
      }
    }
    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  // Helper: update remaining character counter for remarks textarea
  function updateRemarksCounter(){
    const input = document.getElementById('studentRemarksInput');
    const counter = document.getElementById('studentRemarksCounter');
    if (!input || !counter) return;
    const max = 300;
    const len = (input.value || '').length;
    counter.textContent = `${len}/${max}`;
    // Add subtle warning color when close to limit
    counter.classList.toggle('text-danger', len > max);
    counter.classList.toggle('text-muted', len <= max);
  }

  // **REAL-TIME UPDATE**: Function to update all item button states after QR generation
  async function updateAllItemButtonStates(){
    try {
      console.log('[Real-time Update] Updating all item button states after QR generation');
      
      // Update browse-found-items.html page if it exists
      if (typeof window.applyQRStatusToCard === 'function') {
        // Find all item cards on the current page
        const itemCards = document.querySelectorAll('[data-item-id]');
        for (const card of itemCards) {
          const itemId = card.dataset.itemId;
          if (itemId) {
            await window.applyQRStatusToCard(card, itemId);
          }
        }
      }
      
      // Update browse-found-items-details.html page if it exists
      if (typeof window.applyExistingStatusToUI === 'function') {
        await window.applyExistingStatusToUI();
      }
      
      // Also update any other item cards that might be on the current page
      // This handles cases where items might be displayed in different formats
      const allItemElements = document.querySelectorAll('[data-item-id], [data-found-item-id]');
      for (const element of allItemElements) {
        const itemId = element.dataset.itemId || element.dataset.foundItemId;
        if (itemId && typeof window.applyQRStatusToCard === 'function') {
          await window.applyQRStatusToCard(element, itemId);
        }
      }
      
      console.log('[Real-time Update] All item button states updated successfully');
    } catch (error) {
      console.error('[Real-time Update] Error updating button states:', error);
    }
  }
  // Move helpers inside closure to access state
  function hideModalIfOpen(id){
    try {
      const el = document.getElementById(id);
      if (!el) return;
      const instance = bootstrap.Modal.getInstance(el);
      const visible = el.classList.contains('show');
      if (visible) instance?.hide();
    } catch(_){}
  }

  function fullCameraCleanup(){
    try { window.FaceCaptureHelper?.stop?.(); } catch {}
    try { state.brightnessCtrl?.stop?.(); } catch {}
    state.brightnessCtrl = null;
    if (state.cameraStream){
      try { state.cameraStream.getTracks().forEach(t => t.stop()); } catch {}
      state.cameraStream = null;
    }
  }

  function resetTempClaimStage(){
    state.faceDataUrl = null;
    state.captureCompleted = false;
    state.pendingMethod = 'qr_face';
    try { window.FaceCaptureHelper?.reset?.(); } catch {}
    const canvas = document.getElementById('faceCanvas');
    if (canvas){
      try {
        const ctx = canvas.getContext('2d');
        ctx && ctx.clearRect(0,0,canvas.width,canvas.height);
      } catch(_){}
    }
  }
})();

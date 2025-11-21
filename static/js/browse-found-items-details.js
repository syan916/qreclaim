(function(){
  const state = {
    itemId: null,
    item: null,
    claimId: null,
    cameraStream: null,
    // Adaptive brightness controller instance for details page face capture
    brightnessCtrl: null,
    faceDataUrl: null,
    captureCompleted: false, // flag to preserve successful capture across modal transitions
    countdownTimer: null,
    // Stage selected method until final confirmation
    pendingMethod: 'qr_face',
    // Student remarks collected up-front for valuable items
    studentRemarks: '',
    // When true, user is submitting an approval request for a valuable item;
    // we will collect verification info and persist to claim with status 'pending'
    approvalRequestMode: false,
    // User-specific status flags
    latestClaimStatus: null,
    latestClaimId: null,
    hasActiveQr: false
  };
  // Expose state globally for cross-page real-time updates
  window.state = state;
  // Global local state for optimistic UI; details page button renders from this only
  window.userClaimState = window.userClaimState || { hasActive: false, status: 'none', claimItemId: null };
  let detailsValidationCache = null;
  let detailsValidationCacheTs = 0;
  const DETAILS_VALIDATION_TTL_MS = (typeof VALIDATION_TTL_MS === 'number') ? VALIDATION_TTL_MS : 15000;

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('itemDetailsRoot');
    const btnBack = document.getElementById('btnBack');

    if (!root) return;
    state.itemId = root.dataset.itemId;

    // Setup image modal interactions for the details image
    setupImageModalInteractions();

    btnBack?.addEventListener('click', () => {
      window.location.href = '/user/browse-found-items';
    });

    // Claim button: delegate to core functions when available for consistency
    const btnClaim = document.getElementById('btnClaim');
    btnClaim?.addEventListener('click', async () => {
      if (!state.itemId) return;
      const isValuable = !!(state.item && state.item.is_valuable);
      try {
        if (typeof window.claimItem === 'function' && typeof window.requestQRApproval === 'function') {
          if (isValuable) {
            await window.requestQRApproval(state.itemId);
          } else {
            await window.claimItem(state.itemId);
          }
          return;
        }
      } catch (e) {
        console.warn('Delegation to core functions failed, falling back to local flow:', e);
      }
      
      // Fallback: original local validation and flow
      console.log('DEBUG: Claim button clicked with comprehensive validation');
      try {
        showLoadingState();
        const validationResponse = await fetch(`/user/api/claims/validate/${encodeURIComponent(state.itemId)}`);
        const validationData = await validationResponse.json();
        hideLoadingState();
        if (!validationResponse.ok) {
          showError(`Validation failed: ${validationData.error || 'Unknown error'}`);
          return;
        }
        if (!validationData.valid) {
          const errorDetail = validationData.error_detail || validationData.error || 'Claim validation failed';
          const guidance = validationData.guidance || '';
          let message = `Cannot claim item: ${errorDetail}`;
          if (guidance) { message += `\n\nGuidance: ${guidance}`; }
          showError(message);
          if (validationData.button_state === 'disabled') {
            const claimBtn = document.getElementById('btnClaim');
            if (claimBtn) {
              claimBtn.disabled = true;
              claimBtn.innerHTML = `<i class="fas fa-clock me-2"></i>${validationData.button_text || 'Unavailable'}`;
            }
          }
          return;
        }
        const validationSummary = validationData.validation_summary || {};
        const status = String(state.latestClaimStatus || '').toLowerCase();
        if (isValuable){
          if (status === 'approved'){
            const modalEl = document.getElementById('claimConfirmModal');
            if (!modalEl) return;
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
            return;
          }
          if (status === 'pending'){
            const row = document.getElementById('userStatusRow');
            const err = document.getElementById('finalizeError');
            row?.classList.remove('d-none');
            const badge = document.getElementById('userStatusBadge');
            const text = document.getElementById('userStatusText');
            if (badge){ badge.textContent = 'Pending Approval'; badge.classList.remove('bg-info','bg-success'); badge.classList.add('bg-warning'); }
            if (text){ text.textContent = 'Your request is awaiting admin approval. You will be notified when approved.'; }
            if (err){ err.classList.remove('d-none'); err.textContent = 'Awaiting admin approval before proceeding.'; }
            return;
          }
          const modalEl = document.getElementById('studentRemarksModal');
          if (modalEl){
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
            const input = document.getElementById('studentRemarksInput');
            if (input){ input.value = state.studentRemarks || ''; }
            updateRemarksCounter();
            const err = document.getElementById('studentRemarksError');
            err?.classList.add('d-none');
          } else {
            const modalEl2 = document.getElementById('claimConfirmModal');
            if (!modalEl2) return;
            const modal2 = bootstrap.Modal.getOrCreateInstance(modalEl2);
            modal2.show();
          }
        } else {
          const modalEl = document.getElementById('claimConfirmModal');
          if (!modalEl) return;
          const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
          modal.show();
        }
        console.log(`Claim security audit: ${(validationSummary.layers_passed||0)} layers passed for item ${state.itemId}`);
      } catch (error) {
        hideLoadingState();
        console.error('Error during claim validation:', error);
        showError('An error occurred while validating your claim. Please try again.');
      }
    });

    // Confirm claim: open face capture
    document.getElementById('confirmClaimYesBtn')?.addEventListener('click', async () => {
      try {
        const isValuable = !!(state.item && state.item.is_valuable);
        const status = String(state.latestClaimStatus || '').toLowerCase();
        console.log('[DEBUG] confirmClaimYesBtn - isValuable:', isValuable, 'approvalRequestMode:', state.approvalRequestMode, 'status:', status);
        // For valuable items: allow proceeding if we're in approval request mode;
        // otherwise block until admin approval.
        if (isValuable && !state.approvalRequestMode && status !== 'approved'){
          console.log('[DEBUG] Blocking valuable item - no approval mode and not approved');
          const row = document.getElementById('userStatusRow');
          const badge = document.getElementById('userStatusBadge');
          const text = document.getElementById('userStatusText');
          const errEl = document.getElementById('finalizeError');
          row?.classList.remove('d-none');
          if (badge){ badge.textContent = 'Pending Approval'; badge.classList.remove('bg-info','bg-success'); badge.classList.add('bg-warning'); }
          if (text){ text.textContent = 'Admin approval is required before you can proceed. Please wait for approval.'; }
          if (errEl){ errEl.classList.remove('d-none'); errEl.textContent = 'Awaiting admin approval before proceeding.'; }
          return;
        }
        console.log('[DEBUG] Proceeding to face capture');
        const confirmModal = bootstrap.Modal.getInstance(document.getElementById('claimConfirmModal'));
        confirmModal?.hide();
        await openFaceCaptureModal();
      } catch(e){ console.error(e); }
    });

    // Manual capture removed; auto-capture handled by FaceCaptureHelper

    // Method selection confirm
    document.getElementById('confirmMethodBtn')?.addEventListener('click', async () => {
      await confirmVerificationMethod();
    });

    // Final confirmation button
    document.getElementById('finalizeConfirmBtn')?.addEventListener('click', async () => {
      console.log('[DEBUG] finalizeConfirmBtn - approvalRequestMode:', state.approvalRequestMode);
      if (state.approvalRequestMode){
        console.log('[DEBUG] Calling finalizeApprovalRequestFlow');
        await finalizeApprovalRequestFlow();
      } else {
        console.log('[DEBUG] Calling finalizeClaimAndProceed');
        await finalizeClaimAndProceed();
      }
    });

    if (!state.itemId) {
      showError('Missing item id.');
      return;
    }

    // Initial optimistic rendering; backend sync will adjust if needed
    updateButtonsUI();

    fetchItemDetails(state.itemId);

    // Proactively check if the current student already has activity on this item
    // and reflect that in the UI (disable Claim button, show helpful message).
    // Add delay to ensure item details are loaded first
  setTimeout(() => {
    applyExistingStatusToUI();
    updateButtonsUI();
  }, 200);

  try {
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) return;
      applyExistingStatusToUI();
    });
    window.addEventListener('online', function(){
      applyExistingStatusToUI();
      // Keep button consistent with global state on connectivity changes
      updateButtonsUI();
    });
  } catch(_){}

    // Remarks modal interactions
    const remarksInput = document.getElementById('studentRemarksInput');
    remarksInput?.addEventListener('input', updateRemarksCounter);
    // Save & Continue: validate and move to confirmation
    document.getElementById('studentRemarksContinueBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('studentRemarksInput');
      const err = document.getElementById('studentRemarksError');
      const text = (input?.value || '').trim();
      const max = 300;
      const isValuable = !!(state.item && state.item.is_valuable);
      err?.classList.add('d-none');
      if (isValuable && text.length === 0){
        if (err){ err.textContent = 'Please provide a brief remark for valuable items.'; err.classList.remove('d-none'); }
        return;
      }
      if (text.length > max){
        if (err){ err.textContent = `Remarks must be ${max} characters or fewer.`; err.classList.remove('d-none'); }
        return;
      }
      state.studentRemarks = text;
      // For valuable items: enter approvalRequestMode and proceed to verification flow
      if (isValuable){
        state.approvalRequestMode = true;
        console.log('[DEBUG] Set approvalRequestMode to true for valuable item');
      }
      console.log('[DEBUG] approvalRequestMode:', state.approvalRequestMode, 'isValuable:', isValuable);
      // Proceed to claim confirmation (both valuable and non-valuable)
      const rModal = bootstrap.Modal.getInstance(document.getElementById('studentRemarksModal'));
      rModal?.hide();
      const cModalEl = document.getElementById('claimConfirmModal');
      if (cModalEl){
        const cModal = bootstrap.Modal.getOrCreateInstance(cModalEl);
        cModal.show();
      }
    });
  });

  // Optimistic button rendering: instant updates based only on userClaimState
  function updateButtonsUI(){
    const btn = document.getElementById('btnClaim');
    if (!btn) return;
    const isValuable = !!(state.item && state.item.is_valuable);
    const s = (window.userClaimState && window.userClaimState.status) || 'none';
    const cid = (window.userClaimState && window.userClaimState.claimItemId) || null;
    const itemId = state.itemId;
    const set = (text, enabled) => {
      btn.textContent = text;
      btn.disabled = !enabled;
      if (btn.disabled) { btn.classList.add('btn-disabled'); btn.setAttribute('aria-disabled','true'); }
      else { btn.classList.remove('btn-disabled'); btn.removeAttribute('aria-disabled'); }
    };
    if (s === 'none') {
      if (isValuable) set('Request Approval', true); else set('Claim', true); return;
    }
    if (s === 'pending') {
      if (cid && cid === itemId) { set(isValuable ? 'Pending Approval' : 'Pending', false); }
      else { set('Unavailable', false); }
      return;
    }
    if (s === 'approved') {
      if (cid && cid === itemId) { set('Claim Now', true); }
      else { set('Unavailable', false); }
      return;
    }
    if (s === 'active') { set('Unavailable', false); return; }
    if (isValuable) set('Request Approval', true); else set('Claim', true);
  }

  function showLoading(show) {
    const loading = document.getElementById('detailsLoading');
    const root = document.getElementById('itemDetailsRoot');
    const card = document.getElementById('detailsCard');
    if (loading) loading.style.display = show ? 'block' : 'none';
    // Hide content while loading; reveal smoothly when ready
    if (card){
      if (show){
        card.classList.add('d-none');
        card.classList.remove('fade-in');
      } else {
        card.classList.remove('d-none');
        card.classList.add('fade-in');
      }
    }
    if (root) root.setAttribute('aria-busy', show ? 'true' : 'false');
  }

  // Wrapper helpers to align with function names used elsewhere in the codebase
  // Some click handlers call showLoadingState()/hideLoadingState(), which were
  // defined on the browse page. Provide local wrappers so the details page
  // doesn't throw ReferenceError when those handlers are triggered.
  function showLoadingState(){
    // Show the details loading placeholder
    showLoading(true);
  }

  function hideLoadingState(){
    // Hide the details loading placeholder and reveal the card
    showLoading(false);
  }

  function showError(message) {
    const errorEl = document.getElementById('detailsError');
    const textEl = document.getElementById('detailsErrorText');
    if (textEl) textEl.textContent = message || 'Failed to load item details.';
    if (errorEl) errorEl.classList.remove('d-none');
  }

  // We no longer create the claim at pic1. The claim will be created at final confirmation.
  // Keep openFaceCaptureModal to stage the face image locally.

  // Create claim will be invoked later during finalize step

  async function openFaceCaptureModal(){
    const modalEl = document.getElementById('faceCaptureModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    // Initialize camera
    const loading = document.getElementById('cameraLoading');
    loading?.classList.remove('d-none');
    try {
      console.debug('[FaceFlow] requesting camera (facingMode=user)');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      state.cameraStream = stream;
      const video = document.getElementById('faceVideo');
      if (video){
        video.srcObject = stream;
        await video.play();
        console.debug('[FaceFlow] camera started. video size=', video.videoWidth, 'x', video.videoHeight);
        // Adaptive brightness: monitor luminance and gently adjust preview canvas
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
            console.debug('[FaceFlow] AdaptiveBrightnessController started (details)');
          }
        } catch (e) { console.warn('Adaptive brightness unavailable (details)', e); }
        // Start auto-capture if helper is available
        if (window.FaceCaptureHelper){
          console.debug('[FaceFlow] initializing FaceCaptureHelper');
          await FaceCaptureHelper.init({
            videoEl: document.getElementById('faceVideo'),
            canvasEl: document.getElementById('faceCanvas'),
            instructionsEl: document.getElementById('faceCaptureInstructions'),
            errorEl: document.getElementById('faceCaptureError'),
            onAutoCapture: (dataUrl) => autoProceedAfterCapture(dataUrl),
          });
          await FaceCaptureHelper.start();
          console.debug('[FaceFlow] FaceCaptureHelper started');
        }
      }
    } catch(e){
      console.error('Camera init error:', e);
      document.getElementById('faceCaptureError')?.classList.remove('d-none');
      const errEl = document.getElementById('faceCaptureError');
      if (errEl) errEl.textContent = 'Unable to access camera or auto-capture unavailable. Please allow camera permissions and try again.';
    } finally {
      loading?.classList.add('d-none');
    }

    // Ensure we stop camera/helper if user closes the face modal manually
    if (modalEl && !modalEl.__faceModalCleanupBound){
      modalEl.addEventListener('hidden.bs.modal', function(){
        console.debug('[FaceFlow] faceCaptureModal hidden');
        try { window.FaceCaptureHelper?.stop(); } catch {}
        try { state.brightnessCtrl?.stop(); } catch {}
        state.brightnessCtrl = null;
        if (state.cameraStream){
          try { state.cameraStream.getTracks().forEach(t => t.stop()); } catch {}
          state.cameraStream = null;
        }
        // IMPORTANT: Do NOT clear faceDataUrl here. It may have been captured successfully
        // and is needed for later steps. We only reset at the start of openFaceCaptureModal.
        // Preserve state.faceDataUrl unless the user cancelled without capture.
        if (!state.captureCompleted){
          // No capture took place; ensure we don't leak stale values
          state.faceDataUrl = null;
        }
        const canvas = document.getElementById('faceCanvas');
        if (canvas){
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0,0,canvas.width,canvas.height);
        }
      });
      modalEl.__faceModalCleanupBound = true;
    }
  }

  async function autoProceedAfterCapture(dataUrl){
    // Automatically proceed to verification method selection after a high-quality auto-capture
    state.faceDataUrl = dataUrl;
    state.captureCompleted = !!dataUrl;
    console.debug('[FaceFlow] auto-capture completed. dataUrl length=', (dataUrl||'').length);
    const saveLoading = document.getElementById('faceSaveLoading');
    saveLoading?.classList.remove('d-none');
    try {
      if (state.cameraStream){
        state.cameraStream.getTracks().forEach(t => t.stop());
        state.cameraStream = null;
      }
      try { window.FaceCaptureHelper?.stop(); } catch {}
      const faceModal = bootstrap.Modal.getInstance(document.getElementById('faceCaptureModal'));
      faceModal?.hide();
      setTimeout(() => {
        openVerificationMethodModal();
      }, 250);
    } catch(e){
      const errEl = document.getElementById('faceCaptureError');
      errEl?.classList.remove('d-none');
      if (errEl) errEl.textContent = e.message || 'Failed to stage face data';
      console.error('[FaceFlow] autoProceedAfterCapture error:', e);
    } finally {
      saveLoading?.classList.add('d-none');
    }
  }

  function openVerificationMethodModal(){
    const modalEl = document.getElementById('verificationMethodModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

  async function confirmVerificationMethod(){
    // Stage the selected method locally; persistence at final step
    const loading = document.getElementById('methodSelectLoading');
    const errEl = document.getElementById('methodSelectError');
    loading?.classList.remove('d-none');
    errEl?.classList.add('d-none');
    try {
      state.pendingMethod = document.querySelector('input[name="verificationMethod"]:checked')?.value || 'qr_face';
      // Guard: require a captured face before proceeding to final confirmation
      const hasFace = !!state.faceDataUrl && state.faceDataUrl.length > 50;
      console.debug('[FaceFlow] confirmVerificationMethod(details): pendingMethod=', state.pendingMethod, 'face len=', (state.faceDataUrl||'').length);
      if (!hasFace){
        errEl?.classList.remove('d-none');
        if (errEl){
          const hint = (window.__faceCaptureDiag && window.__faceCaptureDiag.lastFacePresent === false)
            ? 'No face detected in frame. Please retake your face image.'
            : 'No face image captured yet. Please capture before finalizing.';
          errEl.textContent = hint;
        }
        // Offer to reopen the face capture modal
        try { await openFaceCaptureModal(); } catch {}
        return; // do not proceed further
      }
      // Close method modal and open final confirmation step
      const methodModal = bootstrap.Modal.getInstance(document.getElementById('verificationMethodModal'));
      methodModal?.hide();
      openFinalConfirmationModal();
    } catch(e){
      errEl?.classList.remove('d-none');
      if (errEl) errEl.textContent = e.message || 'Failed to stage method';
    } finally {
      loading?.classList.add('d-none');
    }
  }

  function openFinalConfirmationModal(){
    const modalEl = document.getElementById('finalConfirmModal');
    if (modalEl){
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    } else {
      // Fallback: directly finalize based on mode
      if (state.approvalRequestMode){
        finalizeApprovalRequestFlow();
      } else {
        finalizeClaimAndProceed();
      }
    }
  }

  // Finalize approval request for valuable items: persist data and set claim to 'pending' without generating QR
  async function finalizeApprovalRequestFlow(){
    const finalBtn = document.getElementById('finalizeConfirmBtn');
    if (finalBtn){
      finalBtn.disabled = true;
      finalBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Submitting...';
    }
    console.log('[DEBUG] finalizeApprovalRequestFlow started');
    const errEl = document.getElementById('finalizeError');
    if (errEl) errEl.classList.add('d-none');
    try {
      const isValuable = !!(state.item && state.item.is_valuable);
      console.log('[DEBUG] finalizeApprovalRequestFlow - isValuable:', isValuable);
      if (!isValuable){
        // If not valuable, fall back to normal flow
        console.log('[DEBUG] Not valuable, falling back to normal flow');
        return await finalizeClaimAndProceed();
      }
      // Validate inputs
      if (!state.itemId) throw new Error('Missing item id');
      const hasFace = !!state.faceDataUrl && state.faceDataUrl.length > 50;
      if (!hasFace){
        const hint = (window.__faceCaptureDiag && window.__faceCaptureDiag.lastFacePresent === false)
          ? 'No face detected in frame'
          : 'No face image captured yet. Please capture before submitting approval request.';
        throw new Error(hint);
      }

      // Start claim if missing (include remarks)
      if (!state.claimId){
        console.log('[DEBUG] Starting new claim for approval request');
        const resStart = await fetch('/user/api/claims/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: state.itemId, student_remarks: state.studentRemarks || undefined })
        });
        const dataStart = await resStart.json().catch(() => ({}));
        console.log('[DEBUG] Start claim response:', dataStart);
        if (!resStart.ok || !dataStart?.success){
          // Duplicate/present states are surfaced nicely
          if (resStart.status === 409){
            const code = String(dataStart?.code || '').toUpperCase();
            let msg = 'You already have a pending claim or an active QR for this item.';
            if (code === 'DUPLICATE_PENDING_CLAIM') msg = 'You already have a pending claim for this item.';
            else if (code === 'ACTIVE_QR_EXISTS') msg = 'An active QR is already registered for this item for your account.';
            if (errEl){ errEl.classList.remove('d-none'); errEl.textContent = msg; } else { alert(msg); }
            return;
          }
          throw new Error(dataStart?.error || `Failed to start claim (${resStart.status})`);
        }
        state.claimId = dataStart.claim_id;
        console.log('[DEBUG] New claim created with ID:', state.claimId);
      }

      // Persist face image
      const resFace = await fetch('/user/api/claims/capture-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, face_data_url: state.faceDataUrl })
      });
      const dataFace = await resFace.json().catch(() => ({}));
      if (!resFace.ok || !dataFace?.success){
        const serverErr = dataFace?.error || '';
        // More granular handling for validation failures
        let msg = 'Data storage failure after successful capture';
        if (/Invalid face image data/i.test(serverErr)) msg = 'Face detected but capture failed (invalid data)';
        else if (/Claim not found/i.test(serverErr)) msg = 'Claim not found (server)';
        else if (/Failed to compute face embedding/i.test(serverErr)) msg = 'Data storage failure: embedding computation error';
        else if (resFace.status === 422){
          if (/Face too small in frame/i.test(serverErr)) msg = 'Face too small in frame; move closer and retry';
          else if (/Face capture quality too low/i.test(serverErr)) msg = 'Capture quality too low; improve lighting and hold steady, then retry';
          else msg = serverErr || msg;
        }
        throw new Error(msg);
      }

      // Persist method
      const resMethod = await fetch('/user/api/claims/select-method', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, method: state.pendingMethod || 'qr_face' })
      });
      const dataMethod = await resMethod.json().catch(() => ({}));
      if (!resMethod.ok || !dataMethod?.success){
        throw new Error(dataMethod?.error || 'Failed to set verification method');
      }

      // Finalize claim (will remain 'pending' for valuable items)
      const resFinalize = await fetch('/user/api/claims/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId })
      });
      const dataFinalize = await resFinalize.json().catch(() => ({}));
      if (!resFinalize.ok || !dataFinalize?.success){
        throw new Error(dataFinalize?.error || 'Failed to finalize claim');
      }

      // Close final modal if open
      const finalModal = bootstrap.Modal.getInstance(document.getElementById('finalConfirmModal'));
      finalModal?.hide();

      // Update UI to pending state and disable claim button
      state.latestClaimStatus = 'pending';
      state.latestClaimId = state.claimId;
      state.approvalRequestMode = false; // reset mode after submission
      const btn = document.getElementById('btnClaim');
      const row = document.getElementById('userStatusRow');
      const badge = document.getElementById('userStatusBadge');
      const textEl = document.getElementById('userStatusText');
      if (btn){ btn.disabled = true; btn.setAttribute('aria-disabled','true'); btn.textContent = 'Awaiting Approval'; }
      row?.classList.remove('d-none');
      if (badge){ badge.textContent = 'Pending Approval'; badge.classList.remove('bg-info','bg-success'); badge.classList.add('bg-warning'); }
      if (textEl){ textEl.textContent = 'Approval requested. You will be notified once an admin approves your claim.'; }

      // Optional: inform user via alert or non-blocking message
      // Do not generate QR here; user must wait for admin approval.
      try { window.updateAllItemButtonStates?.(true); } catch(_){ }
    } catch(e){
      console.error('[ApprovalFlow] finalize error:', e);
      const errEl = document.getElementById('finalizeError');
      if (errEl){ errEl.classList.remove('d-none'); errEl.textContent = e.message || 'Approval request submission failed'; }
      else { alert(e.message || 'Approval request submission failed'); }
      if (finalBtn){
        finalBtn.disabled = false;
        finalBtn.innerHTML = 'Finalize & Generate QR';
      }
    }
  }

  async function finalizeClaimAndProceed(){
    const finalBtn = document.getElementById('finalizeConfirmBtn');
    if (finalBtn){
      finalBtn.disabled = true;
      finalBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Finalizing...';
    }
    const errEl = document.getElementById('finalizeError');
    if (errEl) errEl.classList.add('d-none');
    try {
      const isValuable = !!(state.item && state.item.is_valuable);
      const status = String(state.latestClaimStatus || '').toLowerCase();
      // Guard: Valuable items must be approved by admin before proceeding to finalize & QR generation
      if (isValuable && status !== 'approved'){
        const row = document.getElementById('userStatusRow');
        const badge = document.getElementById('userStatusBadge');
        const text = document.getElementById('userStatusText');
        row?.classList.remove('d-none');
        if (badge){ badge.textContent = 'Pending Approval'; badge.classList.remove('bg-info','bg-success'); badge.classList.add('bg-warning'); }
        if (text){ text.textContent = 'Admin approval is required before you can proceed. Please wait for approval.'; }
        throw new Error('Awaiting admin approval before proceeding');
      }

      // Distinguish failure modes before proceeding
      if (!state.faceDataUrl){
        // If we never completed capture, surface a specific hint
        const hint = (window.__faceCaptureDiag && window.__faceCaptureDiag.lastFacePresent === false)
          ? 'No face detected in frame'
          : (state.captureCompleted ? 'Face detected but capture failed' : 'No face image captured');
        throw new Error(hint);
      }
      if (!state.itemId) throw new Error('Missing item id');

      // Create claim if missing (include optional student remarks)
      if (!state.claimId){
        // If we already have an approved claim from status, reuse its id
        if (state.latestClaimId){
          state.claimId = state.latestClaimId;
          console.log('DEBUG: Reusing existing approved claim ID:', state.claimId);
        } else {
          // Only create a new claim if we don't have an existing approved one
          console.log('DEBUG: Creating new claim with approval request mode:', state.approvalRequestMode);
          console.log('DEBUG: Student remarks:', state.studentRemarks);
          console.log('DEBUG: Item ID:', state.itemId);
          const resStart = await fetch('/user/api/claims/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: state.itemId, student_remarks: state.studentRemarks || undefined })
          });
          console.log('DEBUG: Claim start response status:', resStart.status);
          const dataStart = await resStart.json();
          console.log('DEBUG: Claim start response data:', dataStart);
          if (!resStart.ok || !dataStart?.success){
            // Friendly handling for duplicate attempts
            if (resStart.status === 409){
              const code = String(dataStart?.code || '').toUpperCase();
              let msg = 'You already have a pending claim or an active QR for this item.';
              if (code === 'DUPLICATE_PENDING_CLAIM') msg = 'You already have a pending claim for this item.';
              else if (code === 'ACTIVE_QR_EXISTS') msg = 'An active QR is already registered for this item for your account.';
              if (errEl){
                errEl.classList.remove('d-none');
                errEl.textContent = msg + ' Please check your claim status or wait until the QR expires.';
              } else {
                alert(msg);
              }
              return; // stop flow gracefully
            }
            throw new Error(dataStart?.error || `Failed to start claim (${resStart.status})`);
          }
          state.claimId = dataStart.claim_id;
        }
      }

      // Persist face image
      console.debug('[FaceFlow] saving face image. claimId=', state.claimId, 'dataUrl length=', (state.faceDataUrl||'').length);
      const resFace = await fetch('/user/api/claims/capture-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, face_data_url: state.faceDataUrl })
      });
      const dataFace = await resFace.json();
      console.debug('[FaceFlow] capture-face response status=', resFace.status, 'payload=', dataFace);
      if (!resFace.ok || !dataFace?.success){
        // Classify storage failure with clearer messaging
        const serverErr = dataFace?.error || '';
        let msg = 'Data storage failure after successful capture';
        if (/Invalid face image data/i.test(serverErr)) msg = 'Face detected but capture failed (invalid data)';
        else if (/Claim not found/i.test(serverErr)) msg = 'Claim not found (server)';
        else if (/Failed to compute face embedding/i.test(serverErr)) msg = 'Data storage failure: embedding computation error';
        else if (resFace.status === 422){
          if (/Face too small in frame/i.test(serverErr)) msg = 'Face too small in frame; move closer and retry';
          else if (/Face capture quality too low/i.test(serverErr)) msg = 'Capture quality too low; improve lighting and hold steady, then retry';
          else msg = serverErr || msg;
        }
        throw new Error(msg);
      }

      // Persist method
      const resMethod = await fetch('/user/api/claims/select-method', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId, method: state.pendingMethod || 'qr_face' })
      });
      const dataMethod = await resMethod.json();
      if (!resMethod.ok || !dataMethod?.success){
        throw new Error(dataMethod?.error || 'Failed to set verification method');
      }

      // Finalize claim
      const resFinalize = await fetch('/user/api/claims/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId })
      });
      const dataFinalize = await resFinalize.json();
      if (!resFinalize.ok || !dataFinalize?.success){
        throw new Error(dataFinalize?.error || 'Failed to finalize claim');
      }

      // Close final modal if open
      const finalModal = bootstrap.Modal.getInstance(document.getElementById('finalConfirmModal'));
      finalModal?.hide();

      // Generate QR now
      const res2 = await fetch('/user/api/claims/generate-qr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: state.claimId })
      });
      const data2 = await res2.json();
      if (!res2.ok || !data2?.success){
        // Valuable items: require admin approval before QR generation
        const code = String(data2?.code || '').toUpperCase();
        if (res2.status === 403 && (code === 'ADMIN_APPROVAL_REQUIRED' || /Admin approval required/i.test(data2?.error || ''))){
          const msg = 'Awaiting admin approval before QR can be generated. You will be notified once approved.';
          if (errEl){
            errEl.classList.remove('d-none');
            errEl.textContent = msg;
          } else {
            alert(msg);
          }
          return; // do not treat as an error
        }
        throw new Error(data2?.error || 'Failed to generate QR');
      }

      // Show QR modal
      showQrModal(data2.qr_image_url, data2.expires_at_ms || data2.expires_at);
      try { window.updateAllItemButtonStates?.(true); } catch(_){ }
    } catch(e){
      console.error('[FaceFlow] finalize error:', e);
      if (errEl){
        errEl.classList.remove('d-none');
        errEl.textContent = e.message || 'Finalization failed';
      } else {
        alert(e.message || 'Finalization failed');
      }
      if (finalBtn){
        finalBtn.disabled = false;
        finalBtn.innerHTML = 'Finalize & Generate QR';
      }
    }
  }

  function showQrModal(imageUrl, expiresAt){
    const qrImg = document.getElementById('qrImage');
    const dlBtn = document.getElementById('downloadQrBtn');
    const modalEl = document.getElementById('qrGeneratedModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    qrImg.src = imageUrl || '';
    dlBtn.href = imageUrl || '';
    modal.show();
    startExpirationCountdown(expiresAt);
  }

  function startExpirationCountdown(expiresAt){
    try {
      // Clear any existing timer
      if (state.countdownTimer){ clearInterval(state.countdownTimer); state.countdownTimer = null; }
      const countdownEl = document.getElementById('qrCountdown');
      let expires = 0;
      if (typeof expiresAt === 'number'){
        expires = expiresAt; // ms since epoch
      } else if (typeof expiresAt === 'string'){
        // Trim microseconds to milliseconds and ensure Z suffix for robust parsing
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
        expires = Date.parse(iso);
      }
      const tick = () => {
        const now = Date.now();
        const ms = Math.max(0, expires - now);
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        countdownEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if (ms <= 0){
          clearInterval(state.countdownTimer);
          state.countdownTimer = null;
          // Inform user about expiration
          countdownEl.textContent = '00:00';
          const img = document.getElementById('qrImage');
          img.setAttribute('aria-disabled','true');
          img.style.opacity = '0.5';
        }
      };
      tick();
      state.countdownTimer = setInterval(tick, 1000);
    } catch(e){ console.warn('Countdown error', e); }
  }

  // Helper: update remaining character counter for remarks textarea
  function updateRemarksCounter(){
    const input = document.getElementById('studentRemarksInput');
    const counter = document.getElementById('studentRemarksCounter');
    if (!input || !counter) return;
    const max = 300;
    const len = (input.value || '').length;
    counter.textContent = `${len}/${max}`;
    // Warning color when exceeding limit
    counter.classList.toggle('text-danger', len > max);
    counter.classList.toggle('text-muted', len <= max);
  }

  async function fetchItemDetails(id) {
    try {
      console.log('DEBUG: fetchItemDetails called with id:', id);
      showLoading(true);
      const res = await fetch(`/user/api/found-items/${encodeURIComponent(id)}`);
      console.log('DEBUG: API response status:', res.status, res.ok);
      if (!res.ok) {
        const err = await res.json().catch(() => ({error: res.statusText}));
        throw new Error(err?.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      console.log('DEBUG: API response data:', data);
      // Admin API returns {success, item}; our user route returns data directly (either {item: {...}} or {...})
      const item = data?.item || data;
      console.log('DEBUG: Extracted item:', item);
      console.log('DEBUG: Item is_valuable:', item?.is_valuable);
      state.item = normalizeItem(item);
      console.log('DEBUG: Normalized item:', state.item);
      console.log('DEBUG: State item is_valuable:', state.item?.is_valuable);
      renderDetails(state.item);
    } catch (e) {
      console.error('fetchItemDetails error:', e);
      showError(e.message);
    } finally {
      showLoading(false);
    }
  }

  // Check user-specific QR and claim status to avoid duplicate attempts
  // Make it globally accessible for real-time updates from other scripts
  window.applyExistingStatusToUI = async function applyExistingStatusToUI(){
    try {
      const err = document.getElementById('finalizeError');
      if (err) err.classList.add('d-none');
      if (!state.itemId) return;
      const btn = document.getElementById('btnClaim');
      
      // Use cached validation when recent and skip network when offline
      let validationData;
      const now = Date.now();
      const recent = (now - detailsValidationCacheTs) < DETAILS_VALIDATION_TTL_MS;
      if (!navigator.onLine && detailsValidationCache && recent) {
        validationData = detailsValidationCache;
      } else {
        const validationResp = await fetch(`/user/api/qr/validation/${encodeURIComponent(state.itemId)}/me`);
        validationData = await validationResp.json().catch(() => ({}));
        if (!validationResp.ok) {
          console.debug('Validation endpoint error:', validationData);
          // Show error state if validation fails
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i>Check Failed';
          btn.title = 'Status check failed - please refresh the page';
          btn.classList.add('btn-disabled');
          return;
        }
        detailsValidationCache = validationData;
        detailsValidationCacheTs = now;
      }
      
      // Update state based on validation response
      state.hasActiveQr = validationData.reason === 'active_qr';
      state.latestClaimStatus = getClaimStatusFromReason(validationData.reason);
      state.latestClaimId = validationData.claim_id || null;

      // Fallback mapping: if API does not provide explicit button hints,
      // derive a consistent label/state from reason for UAT consistency.
      const hasExplicitHints = typeof validationData.button_text === 'string' || typeof validationData.button_state === 'string';
      const fallback = getFallbackButtonFromValidation(validationData);
      const nextText = hasExplicitHints ? (validationData.button_text || 'Claim') : fallback.text;
      const nextDisabled = hasExplicitHints ? (validationData.button_state === 'disabled') : fallback.disabled;
      const nextTitle = hasExplicitHints ? (validationData.message || '') : (fallback.title || validationData.message || '');
      
      const row = document.getElementById('userStatusRow');
      const badge = document.getElementById('userStatusBadge');
      const text = document.getElementById('userStatusText');

      if (validationData && validationData.reason) {
        const r = validationData.reason;
        if (r === 'pending_approval' || r === 'approved_can_claim' || r === 'active_qr') {
          window.userClaimState.hasActive = true;
          window.userClaimState.status = (r === 'approved_can_claim') ? 'approved' : (r === 'active_qr' ? 'active' : 'pending');
          window.userClaimState.claimItemId = String(state.itemId);
          updateButtonsUI();
        }
      }
      
      // Show/hide status row and update content based on reason
      if (shouldShowStatusRow(validationData.reason)) {
        row?.classList.remove('d-none');
        updateStatusBadge(badge, validationData.reason);
        if (text) { text.textContent = nextTitle || ''; }
        
        // Add tooltip for disabled buttons
        const btn = document.getElementById('btnClaim');
        if (btn && btn.disabled && (nextTitle || validationData.message)) {
          btn.setAttribute('title', nextTitle || validationData.message);
          btn.setAttribute('data-bs-toggle', 'tooltip');
          btn.setAttribute('data-bs-placement', 'top');
          
          // Initialize tooltip if Bootstrap is available
          if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            new bootstrap.Tooltip(btn);
          }
        } else {
          btn.removeAttribute('title');
          btn.removeAttribute('data-bs-toggle');
          btn.removeAttribute('data-bs-placement');
        }
      } else {
        row?.classList.add('d-none');
        const btn = document.getElementById('btnClaim');
        if (btn) {
          btn.removeAttribute('title');
          btn.removeAttribute('data-bs-toggle');
          btn.removeAttribute('data-bs-placement');
        }
      }
      
    } catch(e){
      // Non-blocking: if status checks fail, do not prevent the user from proceeding
      console.debug('applyExistingStatusToUI: non-blocking error', e);
      // Show error state
      updateButtonsUI();
    }
  }

  // Fallback map for details page button label/state from validation reason
  function getFallbackButtonFromValidation(validation){
    const reason = validation?.reason;
    switch(reason){
      case 'approved_can_claim':
        return { text: 'Claim', disabled: false, title: '' };
      case 'item_approved':
        return { text: 'Approved', disabled: true, title: 'This item has been approved for claiming' };
      case 'can_claim_directly':
        return { text: 'Claim', disabled: false, title: '' };
      case 'can_request_approval':
        return { text: 'Request Approval', disabled: false, title: '' };
      case 'pending_approval':
        return { text: 'Pending', disabled: true, title: 'Waiting for admin approval' };
      case 'active_qr':
        return { text: 'Claim now', disabled: true, title: validation?.message || 'A QR code is already active for this item' };
      case 'has_other_active_claims':
        return { text: validation?.can_request ? 'Request Approval' : 'Claim', disabled: true, title: validation?.message || 'Please complete or cancel your existing claims first' };
      case 'invalid_approving_admin':
        return { text: validation?.can_request ? 'Request Approval' : 'Claim', disabled: true, title: validation?.message || 'Approving admin is no longer valid. Please re-request approval.' };
      case 'item_not_available':
        return { text: validation?.can_request ? 'Request Approval' : 'Claim', disabled: true, title: 'This item is no longer available for claiming' };
      default:
        if (validation?.can_request) return { text: 'Request Approval', disabled: false, title: '' };
        return { text: 'Claim', disabled: true, title: validation?.message || 'Action not available' };
    }
  }
  
  // Helper function to map validation reasons to claim status
  function getClaimStatusFromReason(reason) {
    switch(reason) {
      case 'pending_approval':
        return 'pending_approval';
      case 'approved_can_claim':
        return 'approved';
      case 'item_approved':
        return 'approved';
      case 'rejected':
        return 'rejected';
      case 'active_qr':
        return 'pending'; // QR is active, so claim is in pending state
      default:
        return null;
    }
  }
  
  // Helper function to determine if status row should be shown
  function shouldShowStatusRow(reason) {
    return ['pending_approval', 'approved_can_claim', 'item_approved', 'rejected', 'active_qr', 'item_not_available'].includes(reason);
  }
  
  // Helper function to update status badge styling
  function updateStatusBadge(badge, reason) {
    if (!badge) return;
    
    // Reset all badge classes
    badge.classList.remove('bg-info', 'bg-success', 'bg-warning', 'bg-danger');
    
    switch(reason) {
      case 'pending_approval':
        badge.textContent = 'Requested Approval';
        badge.classList.add('bg-warning');
        break;
      case 'item_approved':
        badge.textContent = 'Approved';
        badge.classList.add('bg-success');
        break;
      case 'approved_can_claim':
        badge.textContent = 'Approved';
        badge.classList.add('bg-success');
        break;
      case 'rejected':
        badge.textContent = 'Request Rejected';
        badge.classList.add('bg-danger');
        break;
      case 'active_qr':
        badge.textContent = 'QR Active';
        badge.classList.add('bg-success');
        break;
      case 'item_not_available':
        badge.textContent = 'Not Available';
        badge.classList.add('bg-danger');
        break;
      default:
        badge.textContent = 'Unclaimed';
        badge.classList.add('bg-info');
    }
  }

  function normalizeItem(item){
    if (!item) return null;
    return {
      id: item.found_item_id || item.id || state.itemId,
      name: item.found_item_name || item.name || 'Unknown Item',
      title: item.title || '',
      description: item.description || '',
      category: item.category || '',
      location: item.place_found || item.location || '',
      image_url: item.image_url || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      status: item.status || 'unclaimed',
      time_found: item.time_found || item.created_at || null,
      // New fields for additional information
      is_valuable: !!item.is_valuable,
      is_assigned_to_locker: !!item.is_assigned_to_locker,
      locker_id: item.locker_id || '',
      uploaded_by: item.uploaded_by || '',
      uploaded_by_email: item.uploaded_by_email || ''
    };
  }

  function renderDetails(item){
    if (!item) return;
    const nameEl = document.getElementById('itemName');
    const titleEl = document.getElementById('itemTitle');
    const descEl = document.getElementById('itemDescription');
    const catEl = document.getElementById('itemCategory');
    const locEl = document.getElementById('itemLocation');
    const dateEl = document.getElementById('itemDate');
    const statusEl = document.getElementById('itemStatus');
    const tagsEl = document.getElementById('itemTags');
    const imgEl = document.getElementById('itemImage');

    // New info elements
    const valuableEl = document.getElementById('itemValuableStatus');
    const lockerAssignedEl = document.getElementById('itemLockerAssigned');
    const lockerIdEl = document.getElementById('itemLockerId');
    const postedByEl = document.getElementById('itemPostedBy');

    nameEl && (nameEl.textContent = item.name);
    titleEl && (titleEl.textContent = item.title || '');
    descEl && (descEl.textContent = item.description || 'No description provided.');
    catEl && (catEl.textContent = friendlyCategory(item.category));
    locEl && (locEl.textContent = friendlyLocation(item.location));
    dateEl && (dateEl.textContent = formatDate(item.time_found));

    if (statusEl){
      statusEl.textContent = statusText(item.status);
      statusEl.setAttribute('data-status', item.status);
    }

    if (tagsEl){
      tagsEl.innerHTML = '';
      (item.tags || []).forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagsEl.appendChild(span);
      });
    }

    if (imgEl){
      if (item.image_url){
        imgEl.src = item.image_url;
        imgEl.alt = `${item.name} image`;
      } else {
        imgEl.removeAttribute('src');
        imgEl.alt = 'No image available';
      }
    }

    // Populate additional info
    if (valuableEl){
      valuableEl.textContent = item.is_valuable ? 'Marked as valuable' : 'Not marked as valuable';
    }
    if (lockerAssignedEl){
      lockerAssignedEl.textContent = item.is_assigned_to_locker ? 'Assigned to locker' : 'No locker assigned';
    }
    if (lockerIdEl){
      lockerIdEl.textContent = item.locker_id ? `Locker ID: ${item.locker_id}` : 'Locker ID: —';
    }
    if (postedByEl){
      const email = item.uploaded_by_email ? ` (${item.uploaded_by_email})` : '';
      postedByEl.textContent = item.uploaded_by ? `${item.uploaded_by}${email}` : 'Unknown Admin';
    }
  }

  function sentenceCase(str){
    if (!str) return '';
    return String(str).replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Friendlier labels for common technical terms
  function friendlyCategory(str){
    const s = String(str || '').toLowerCase();
    if (!s) return 'Uncategorized';
    // Extendable map for future categories
    const map = {
      'electronics': 'Electronics',
      'clothing': 'Clothing',
      'documents': 'Documents',
    };
    return map[s] || sentenceCase(str);
  }

  function friendlyLocation(str){
    const s = String(str || '').toLowerCase().trim();
    if (!s) return 'Unknown';
    const map = {
      'lost and found office': 'Lost & Found Office',
      'cafeteria': 'Cafeteria',
      'library': 'Library',
      'gym': 'Gym',
    };
    return map[s] || sentenceCase(str);
  }

  function statusText(s){
    switch(String(s).toLowerCase()){
      case 'unclaimed': return 'Unclaimed';
      case 'claimed': return 'Claimed';
      case 'pending': return 'Pending Verification';
      default: return sentenceCase(s);
    }
  }

  function formatDate(ts){
    if (!ts) return 'Unknown date';
    try {
      // ts may be a Firestore timestamp or ISO string
      if (typeof ts === 'object' && ts?.seconds){
        const d = new Date(ts.seconds * 1000);
        return d.toLocaleString();
      }
      const d = new Date(ts);
      return isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString();
    } catch { return 'Unknown date'; }
  }
  // Shared image modal functions and event setup for the details page
  function setupImageModalInteractions(){
    const container = document.querySelector('.item-image-container.clickable-image');
    const imgEl = document.getElementById('itemImage');
    if (!container || !imgEl) return;

    const openHandler = () => {
      const src = imgEl.getAttribute('src') || '/static/images/placeholder-item.png';
      const alt = imgEl.getAttribute('alt') || 'Item image';
      window.openImageModal(src, alt);
    };

    container.addEventListener('click', openHandler);
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        openHandler();
      }
    });
  }

  // Open the modal with the given image
  window.openImageModal = function(src, alt){
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    if (!modal || !modalImage) return;
    modalImage.src = src || '/static/images/placeholder-item.png';
    modalImage.alt = alt || 'Enlarged view';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  // Close the modal; only close when clicking backdrop or the close button
  window.closeImageModal = function(event){
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    if (event && event.target !== modal && !event.target.classList.contains('modal-close')){
      return; // ignore clicks inside content
    }
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  // Keyboard support: ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      window.closeImageModal();
    }
  });
})();

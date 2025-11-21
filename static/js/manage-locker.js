/**
 * Manage Lockers Page Script
 * - Renders locker cards based on locker-card.html structure (adapted)
 * - Connects to backend (Firebase via server APIs) to list lockers
 * - Listens to real-time updates using SSE
 * - Implements open/close timed control with countdown and visual feedback
 *
 * Notes:
 * - We maintain the visual integrity of the provided locker-card while
 *   adapting class names to project conventions (locker-card, locker-open-btn, etc).
 * - We avoid deep nesting and use early returns for clearer logic.
 */

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('lockerGrid');
  if (!grid) return;

  // Duration options (seconds). Rendered as segmented buttons per original design.
  // Removed the 90-second option per new UI requirements.
  const DURATIONS = [10, 20, 30, 60];
  const operationLocks = new Set(); // Track lockers currently processing open/close
  const verificationLocks = new Set(); // Prevent repeated verification on same locker

  // Simple in-memory state (id -> doc)
  const state = new Map();

  // Pagination state (3 columns x 2 rows = 6 cards per page)
  const PAGE_SIZE = 6;
  let allLockers = [];
  let currentPage = 1;

  // Pagination controls
  const pager = document.getElementById('lockerPagination');
  const pagerPrev = document.getElementById('lockerPrev');
  const pagerNext = document.getElementById('lockerNext');
  const pagerStatus = document.getElementById('lockerPagerStatus');
  if (pagerPrev) pagerPrev.addEventListener('click', () => changePage(-1));
  if (pagerNext) pagerNext.addEventListener('click', () => changePage(1));

  // Initial load
  loadLockers();
  setupSSE();

  async function loadLockers() {
    try {
      const res = await fetch('/admin/api/lockers', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load lockers');
      renderLockers(data.lockers || []);
    } catch (err) {
      // Remove console.log outputs; surface via message box instead
      if (window.messageBox) messageBox.showError(String(err), 'Failed to load lockers');
    }
  }

  function setupSSE() {
    try {
      const es = new EventSource('/admin/api/lockers/stream');
      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.success && Array.isArray(payload.lockers)) {
            renderLockers(payload.lockers);
          }
        } catch (_) {
          // Ignore keepalive or malformed lines
        }
      };
      es.onerror = () => {
        // Connection issues: we keep the existing UI and rely on periodic refresh if needed.
        // Silencing console output per request.
      };
    } catch (err) {
      // Silencing console output per request.
    }
  }

  function renderLockers(lockers) {
    if (!Array.isArray(lockers)) return;
    // Update global list and map
    allLockers = lockers.slice();
    state.clear();
    allLockers.forEach(l => state.set(l.id, l));
    // Reset to first page if current page exceeds available pages
    const totalPages = Math.max(1, Math.ceil(allLockers.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    renderPage();
  }

  function renderPage() {
    const totalPages = Math.max(1, Math.ceil(allLockers.length / PAGE_SIZE));
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allLockers.slice(startIdx, startIdx + PAGE_SIZE);
    grid.innerHTML = '';
    pageItems.forEach(l => grid.appendChild(createLockerCard(l)));
    // Update pager visibility and status
    if (pager) {
      if (totalPages > 1) {
        pager.hidden = false;
        if (pagerStatus) pagerStatus.textContent = `Page ${currentPage} of ${totalPages}`;
        if (pagerPrev) pagerPrev.disabled = currentPage <= 1;
        if (pagerNext) pagerNext.disabled = currentPage >= totalPages;
      } else {
        pager.hidden = true;
      }
    }
  }

  function changePage(delta) {
    const totalPages = Math.max(1, Math.ceil(allLockers.length / PAGE_SIZE));
    currentPage = Math.min(totalPages, Math.max(1, currentPage + delta));
    renderPage();
  }

  function createLockerCard(locker) {
    const { id, status, location, item_name, image_url, found_item_id } = normalizeLocker(locker);

    // Root card
    const card = document.createElement('div');
    card.className = 'locker-card';
    card.dataset.lockerId = id;

    // Header image; clickable if found_item_id exists
    const header = document.createElement('div');
    header.className = 'locker-card-header';
    if (found_item_id) {
      const link = document.createElement('a');
      link.href = `/admin/found-item-details/${encodeURIComponent(found_item_id)}`;
      link.setAttribute('aria-label', `View details for ${item_name || 'found item'}`);
      link.className = 'locker-card-header-link';
      if (image_url) {
        const img = document.createElement('img');
        img.src = image_url;
        img.alt = item_name ? String(item_name) : 'Found item image';
        img.loading = 'lazy';
        link.appendChild(img);
      } else {
        link.innerHTML = `
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="placeholder-icon" aria-hidden="true">
            <path d="M20 5H4V19L13.2923 9.70649C13.6828 9.31595 14.3159 9.31591 14.7065 9.70641L20 15.0104V5ZM2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11Z"></path>
          </svg>`;
      }
      header.appendChild(link);
      // Overlay label: show found item name when assigned
      const overlay = document.createElement('div');
      overlay.className = 'item-overlay';
      overlay.textContent = item_name ? String(item_name) : '';
      header.appendChild(overlay);
    } else {
      header.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="placeholder-icon" aria-hidden="true">
          <path d="M20 5H4V19L13.2923 9.70649C13.6828 9.31595 14.3159 9.31591 14.7065 9.70641L20 15.0104V5ZM2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11Z"></path>
        </svg>`;
      // Overlay label: show locker label when no item assigned
      const overlay = document.createElement('div');
      overlay.className = 'item-overlay';
      overlay.textContent = `Locker ${id}`;
      header.appendChild(overlay);
    }
    card.appendChild(header);

    // Title: found item assigned name (if any)
    const title = document.createElement('div');
    title.className = 'locker-card-title';
    title.textContent = item_name ? String(item_name) : `Locker ${id}`;
    card.appendChild(title);

    // Meta
    const meta = document.createElement('div');
    meta.className = 'locker-card-meta';
    meta.innerHTML = `
      <div class="meta-line">Locker ID: <strong>${escapeHtml(id)}</strong></div>
      <div class="meta-line">Location: <strong>${escapeHtml(location || 'Unknown')}</strong></div>
      <div class="meta-line">Status: <span class="status-badge ${statusBadgeClass(status)}">${escapeHtml(statusLabel(status))}</span></div>
    `;
    card.appendChild(meta);

    // Action row
    const action = document.createElement('div');
    action.className = 'locker-card-action';

    // Duration selector: segmented button group (original design)
    const durationGroup = document.createElement('div');
    durationGroup.className = 'locker-duration-group';
    durationGroup.setAttribute('role', 'group');
    durationGroup.setAttribute('aria-label', 'Opening duration');
    let selectedDuration = DURATIONS[0];
    DURATIONS.forEach(sec => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'duration-btn';
      b.textContent = `${sec}s`;
      b.dataset.value = String(sec);
      b.setAttribute('aria-pressed', sec === selectedDuration ? 'true' : 'false');
      if (String(status).toLowerCase() !== 'occupied') {
        b.disabled = true;
        b.title = 'Selectable when locker is occupied';
      }
      b.addEventListener('click', () => {
        selectedDuration = sec;
        [...durationGroup.querySelectorAll('.duration-btn')].forEach(x => x.setAttribute('aria-pressed', x.dataset.value === String(sec) ? 'true' : 'false'));
      });
      durationGroup.appendChild(b);
    });
    action.appendChild(durationGroup);

    // Open button
    const btn = document.createElement('button');
    btn.className = 'locker-open-btn';
    // Replace shopping cart icon with a locker icon
    btn.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"></path>
      </svg>
      <span>Open</span>
    `;

    // Disable to prevent opening already-open lockers
    if (String(status).toLowerCase() === 'open') {
      btn.disabled = true;
      btn.title = 'Locker is already open';
    }

    btn.addEventListener('click', () => handleOpen(id, selectedDuration));
    action.appendChild(btn);

    card.appendChild(action);

    // Progress UI
    const progress = document.createElement('div');
    progress.className = 'locker-progress';
    const bar = document.createElement('div');
    bar.className = 'bar';
    progress.appendChild(bar);
    const countdown = document.createElement('div');
    countdown.className = 'locker-countdown';
    card.appendChild(progress);
    card.appendChild(countdown);

    // Link elements to card for updates
    card._elements = { durationGroup, btn, bar, countdown };
    return card;
  }

  function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'occupied') return 'status-occupied';
    if (s === 'open') return 'status-open';
    if (s === 'closed') return 'status-closed';
    return 'status-available';
  }
  function statusLabel(status) {
    const s = String(status || '').toLowerCase();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Available';
  }
  function normalizeLocker(l) {
    // Avoid unnecessary deep copies; map only fields we display
    return {
      id: String(l.id || l.locker_id || ''),
      status: String(l.status || ''),
      location: l.location || 'Unknown',
      item_name: l.item_name || '',
      image_url: l.image_url || '',
      found_item_id: l.found_item_id || ''
    };
  }

  async function handleOpen(lockerId, durationSecFromGroup) {
    console.log(`handleOpen called for Locker ID: ${lockerId}, Duration: ${durationSecFromGroup}s`);
    try {
      const doc = state.get(lockerId);
      const currentStatus = String(doc?.status || '').toLowerCase();
      if (currentStatus === 'open') {
        if (window.messageBox) messageBox.showWarning('Locker is already open');
        return;
      }
      if (currentStatus !== 'occupied') {
        if (window.messageBox) messageBox.showWarning('Only occupied lockers can be opened with a timer');
        return;
      }
  
      const durationSec = parseInt(String(durationSecFromGroup || 10), 10);
      if (!durationSec || durationSec <= 0) {
        if (window.messageBox) messageBox.showWarning('Please select a valid duration');
        return;
      }
  
      // Secure verification modal flow (radio + image tap). Only proceed if verified.
      const verified = await showVerificationModal(lockerId);
      if (!verified) return; // user canceled or failed to verify
      if (operationLocks.has(lockerId)) return; // Prevent concurrent operations
  
      operationLocks.add(lockerId);
      const card = grid.querySelector(`[data-locker-id="${CSS.escape(lockerId)}"]`);
      if (!card) return;
      const { btn, bar, countdown } = card._elements || {};
      if (btn) {
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Opening...';
      }
      if (countdown) countdown.textContent = '';
      if (bar) bar.style.width = '0%';
  
      // Call backend to set status open
      const res = await fetch(`/admin/api/lockers/${encodeURIComponent(lockerId)}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ duration_sec: durationSec })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to open locker');
      if (window.messageBox) messageBox.showSuccess(`Locker ${lockerId} opening for ${durationSec}s`);
  
      // Start countdown locally; upon completion, auto-close via API
      await runCountdown(lockerId, durationSec, bar, countdown);
  
      const closeRes = await fetch(`/admin/api/lockers/${encodeURIComponent(lockerId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      });
      const closeData = await closeRes.json();
      if (!closeData.success) throw new Error(closeData.error || 'Failed to close locker');
      if (window.messageBox) messageBox.showSuccess(`Locker ${lockerId} closed`);
    } catch (err) {
      if (window.messageBox) messageBox.showError(String(err), 'Operation Failed');
    } finally {
      // Reset button regardless of outcome; SSE will refresh the card status
      const card = grid.querySelector(`[data-locker-id="${CSS.escape(lockerId)}"]`);
      const { btn } = (card?._elements) || {};
      if (btn) {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Open';
      }
      operationLocks.delete(lockerId);
    }
  }

  // === Secure Verification Modal (client-side) ===
  function showVerificationModal(lockerId) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('secvOverlay');
      const closeBtn = document.getElementById('secvClose');
      const targetEl = document.getElementById('secvTarget');
      const pinDisplay = document.getElementById('secvPinDisplay');
      const radios = Array.from(document.querySelectorAll('input[name="secvSelect"]'));
      const feedbackEl = document.getElementById('secvFeedback');
      
      if (!overlay || !closeBtn || !pinDisplay || !targetEl || !feedbackEl || !radios.length) {
        // Fallback: if modal elements missing, resolve false
        resolve(false);
        return;
      }

      if (verificationLocks.has(lockerId)) { resolve(false); return; }
      verificationLocks.add(lockerId);

      // Generate six-digit code of digits 1..5 and store in sessionStorage
      const code = generateSixDigitCode();
      sessionStorage.setItem(`secv_code_${lockerId}` , JSON.stringify({ code, ts: Date.now() }));

      let typed = '';
      let isVerifying = false;
      targetEl.textContent = code;
      updatePinDots(pinDisplay, 0);
      feedbackEl.textContent = '';

      overlay.setAttribute('aria-hidden', 'false');

      // Auto-verify function
      const verifyCode = () => {
        if (isVerifying) return;
        isVerifying = true;
        
        // Show loading state
        feedbackEl.textContent = 'Verifying...';
        feedbackEl.style.color = '#fbbf24';
        
        setTimeout(() => {
          try {
            const raw = sessionStorage.getItem(`secv_code_${lockerId}`);
            const stored = raw ? JSON.parse(raw) : null;
            
            if (!stored || !stored.code) {
              feedbackEl.textContent = 'Verification code expired. Generating a new code...';
              feedbackEl.style.color = '#f87171';
              // regenerate immediately for another attempt
              const newCode = generateSixDigitCode();
              targetEl.textContent = newCode;
              sessionStorage.setItem(`secv_code_${lockerId}` , JSON.stringify({ code: newCode, ts: Date.now() }));
              typed = '';
              typedEl.textContent = '—';
              updateDots(dotsEl, 0);
              radios.forEach(r => r.checked = false);
              isVerifying = false;
              return;
            }
            
            if (typed === stored.code) {
              // Success
              feedbackEl.textContent = '✅ Verified! Unlocking...';
              feedbackEl.style.color = '#4ade80';
              setTimeout(() => {
                cleanup();
                overlay.setAttribute('aria-hidden', 'true');
                sessionStorage.removeItem(`secv_code_${lockerId}`);
                verificationLocks.delete(lockerId);
                resolve(true);
              }, 600);
            } else {
              // Failure - clear input and show error
              feedbackEl.textContent = '❌ Incorrect. Try again.';
              feedbackEl.style.color = '#f87171';
              typed = '';
              updatePinDots(pinDisplay, 0);
              isVerifying = false;
            }
          } catch (_) {
            feedbackEl.textContent = 'An error occurred during verification. Please try again.';
            feedbackEl.style.color = '#f87171';
            isVerifying = false;
          }
        }, 800); // Small delay for better UX
      };

      // Allow repeated appends using label clicks; radio change also supported
      const radioChangeHandler = (e) => {
        const value = e.target.value;
        if (value === 'off') { if (typed.length > 0) typed = typed.slice(0, -1); }
        else { if (typed.length >= 6) return; typed += value; }
        updatePinDots(pinDisplay, typed.length);
        if (typed.length === 6) verifyCode();
      };

      const radioLabels = Array.from(document.querySelectorAll('.secv-switch-container .den .switch label'));
      const labelClickHandler = (e) => {
        const forId = e.currentTarget.getAttribute('for');
        const radio = forId ? document.getElementById(forId) : null;
        const value = radio ? radio.value : null;
        if (!value) return;
        if (value === 'off') { if (typed.length > 0) typed = typed.slice(0, -1); }
        else { if (typed.length >= 6) return; typed += value; }
        updatePinDots(pinDisplay, typed.length);
        if (radio && !radio.checked) radio.checked = true;
        if (typed.length === 6) verifyCode();
      };

      const onClose = () => {
        cleanup();
        overlay.setAttribute('aria-hidden', 'true');
        sessionStorage.removeItem(`secv_code_${lockerId}`);
        verificationLocks.delete(lockerId);
        resolve(false);
      };

      radios.forEach(r => r.addEventListener('change', radioChangeHandler));
      radioLabels.forEach(l => l.addEventListener('click', labelClickHandler));
      closeBtn.addEventListener('click', onClose);

      function cleanup() {
        radios.forEach(r => r.removeEventListener('change', radioChangeHandler));
        radioLabels.forEach(l => l.removeEventListener('click', labelClickHandler));
        closeBtn.removeEventListener('click', onClose);
      }
    });
  }

  function generateSixDigitCode() {
    // Digits 1-5 to match dial
    let s = '';
    for (let i = 0; i < 6; i++) s += String(1 + Math.floor(Math.random() * 5));
    return s;
  }

  function updatePinDots(pinContainer, count) {
    const dots = Array.from(pinContainer.querySelectorAll('.pin-dot'));
    dots.forEach((d, i) => {
      if (i < count) d.classList.add('filled'); else d.classList.remove('filled');
    });
  }

  // Image-based verification removed

  function runCountdown(lockerId, durationSec, barEl, countdownEl) {
    // jQuery-based countdown, scoped to the specific locker card
    return new Promise((resolve) => {
      const $bar = window.jQuery ? jQuery(barEl) : null;
      const $count = window.jQuery ? jQuery(countdownEl) : null;
      const totalMs = durationSec * 1000;
      let intervalId = null;

      if ($bar) {
        const $container = jQuery(barEl.parentElement);
        $container.stop(true, true).fadeIn(120);
        $bar.stop(true, true).css({ width: '0%' }).show().animate({ width: '100%' }, totalMs, 'linear');
      } else if (barEl) {
        barEl.style.width = '0%';
      }
      if ($count) {
        $count.stop(true, true).fadeIn(120);
      }

      const start = Date.now();
      intervalId = setInterval(() => {
        const elapsed = Date.now() - start;
        const remainMs = Math.max(0, totalMs - elapsed);
        const remainSec = Math.ceil(remainMs / 1000);
        if (countdownEl) countdownEl.textContent = `Closing in ${remainSec}s`;
        if (remainMs <= 0) {
          clearInterval(intervalId);
          if ($count) $count.fadeOut(200);
          if ($bar) {
            $bar.fadeOut(200);
            jQuery(barEl.parentElement).fadeOut(200);
          }
          resolve();
        }
      }, 200);
    });
  }

  // Helpers
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }
});
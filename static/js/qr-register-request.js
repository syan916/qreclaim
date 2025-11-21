// QR Register Requests page logic (enhanced)
// Key features:
// - Accessible Admin Remarks modal with validation
// - Confirmation modal summarizing actions
// - Client-side sorting with visual indicators
// - Row selection with Select All and batch actions
// - Responsive-friendly updates and loading/error states
// English comments are added for clarity and maintenance.

(function () {
  // DOM references
  const tableBody = document.getElementById('qrRequestsTableBody');
  const itemsCountEl = document.getElementById('itemsCount');
  const paginationInfoEl = document.getElementById('paginationInfo');
  const paginationControlsEl = document.getElementById('paginationControls');
  const statusFilterEl = document.getElementById('statusFilter');
  const searchInputEl = document.getElementById('searchInput');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const resultsMessageBox = document.getElementById('resultsMessageBox');
  const resultsCountEl = document.getElementById('resultsCount');
  const filterSummaryEl = document.getElementById('filterSummary');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const approveSelectedBtn = document.getElementById('approveSelectedBtn');
  const rejectSelectedBtn = document.getElementById('rejectSelectedBtn');
  const selectedCountLabel = document.getElementById('selectedCountLabel');

  // Modals & controls
  const adminRemarksModal = document.getElementById('adminRemarksModal');
  const adminRemarksInput = document.getElementById('adminRemarksInput');
  const cancelRemarksBtn = document.getElementById('cancelRemarksBtn');
  const continueRemarksBtn = document.getElementById('continueRemarksBtn');
  const remarksError = document.getElementById('remarksError');
  const confirmActionModal = document.getElementById('confirmActionModal');
  const confirmActionBody = document.getElementById('confirmActionBody');
  const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
  const proceedConfirmBtn = document.getElementById('proceedConfirmBtn');

  // State
  let currentPage = 1;
  let perPage = 10;
  let currentStatus = statusFilterEl ? statusFilterEl.value : 'pending';
  let currentData = [];
  let sortKey = null; // e.g., 'item_name', 'time_found'
  let sortDir = 'asc';
  const selectedIds = new Set(); // Track selected rows across renders

  // Context for pending action flow (single/batch -> remarks -> confirm)
  let pendingAction = null; // { action: 'approve'|'reject', ids: string[] }

  // Utility: show/hide loading overlay
  function showLoading(show) {
    if (!loadingOverlay) return;
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  // Utility: format date/time consistently
  function fmtDate(dt) {
    try {
      if (!dt) return '-';
      if (typeof dt === 'string') return dt;
      if (dt.toDate) return dt.toDate().toLocaleString();
      if (dt instanceof Date) return dt.toLocaleString();
      const t = new Date(dt);
      return isNaN(t.getTime()) ? '-' : t.toLocaleString();
    } catch { return '-'; }
  }

  // Render status badge
  function renderStatusBadge(status) {
    const s = String(status || '').toLowerCase();
    const cls = `status-badge ${s}`;
    const label = s.charAt(0).toUpperCase() + s.slice(1);
    return `<span class="${cls}">${label}</span>`;
  }

  // Render single table row
  function renderRow(req) {
    const item = req.item_name || 'Unknown Item';
    const student = req.student_name || req.student_id || 'Unknown';
    const remarks = (req.student_remarks || '').slice(0, 80);
    const actions = req.status === 'pending'
      ? `<div class="action-buttons">
           <button class="btn-approve" data-claim="${req.claim_id}">Approve</button>
           <button class="btn-reject" data-claim="${req.claim_id}">Reject</button>
         </div>`
      : '<em>No actions</em>';

    const selected = selectedIds.has(req.claim_id);
    return `<tr class="${selected ? 'selected-row' : ''}">
      <td class="select-col"><input type="checkbox" class="row-select" data-claim="${req.claim_id}" ${selected ? 'checked' : ''} aria-label="Select ${item}"></td>
      <td>${item}</td>
      <td>${req.category || '-'}</td>
      <td>${req.place_found || '-'}</td>
      <td>${fmtDate(req.time_found)}</td>
      <td>${student}</td>
      <td title="${req.student_remarks || ''}">${remarks || '-'}</td>
      <td>${renderStatusBadge(req.status)}</td>
      <td>${actions}</td>
    </tr>`;
  }

  // Sorting helpers
  function getSortValue(obj, key) {
    if (!obj) return '';
    if (key === 'time_found') {
      const v = obj.time_found;
      if (!v) return 0;
      if (v.toDate) return v.toDate().getTime();
      if (v instanceof Date) return v.getTime();
      const t = Date.parse(v);
      return Number.isNaN(t) ? 0 : t;
    }
    return String(obj[key] ?? '').toLowerCase();
  }

  function sortData(data) {
    if (!sortKey) return data;
    const dir = sortDir === 'desc' ? -1 : 1;
    const arr = data.slice(); // avoid mutating original
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }

  // Client-side search
  function applyClientSearch(data) {
    const q = (searchInputEl && searchInputEl.value || '').trim().toLowerCase();
    if (!q) return data;
    return data.filter(d => {
      const fields = [
        String(d.item_name || ''),
        String(d.category || ''),
        String(d.student_name || ''),
        String(d.student_id || ''),
        String(d.student_remarks || ''),
      ].map(s => s.toLowerCase());
      return fields.some(f => f.includes(q));
    });
  }

  // Update batch selected count and button enabled states
  function updateSelectedCountLabel() {
    const count = selectedIds.size;
    if (selectedCountLabel) selectedCountLabel.textContent = `${count} selected`;
    if (approveSelectedBtn) approveSelectedBtn.disabled = count === 0;
    if (rejectSelectedBtn) rejectSelectedBtn.disabled = count === 0;
  }

  // Attach events to rendered rows
  function attachRowEvents() {
    // Single-item actions
    tableBody.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', () => startActionFlow('approve', [btn.dataset.claim]));
    });
    tableBody.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', () => startActionFlow('reject', [btn.dataset.claim]));
    });

    // Row selection
    tableBody.querySelectorAll('.row-select').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.claim;
        if (!id) return;
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        const tr = cb.closest('tr');
        if (tr) tr.classList.toggle('selected-row', cb.checked);
        // Update select-all checkbox state
        if (selectAllCheckbox) {
          const allVisible = Array.from(tableBody.querySelectorAll('.row-select'));
          const allChecked = allVisible.length > 0 && allVisible.every(x => x.checked);
          selectAllCheckbox.checked = allChecked;
          selectAllCheckbox.indeterminate = !allChecked && allVisible.some(x => x.checked);
        }
        updateSelectedCountLabel();
      });
    });
  }

  // Render table with search + sort
  function renderTable(data) {
    const filtered = applyClientSearch(data);
    const sorted = sortData(filtered);
    resultsMessageBox.style.display = 'block';
    resultsCountEl.textContent = `${filtered.length} requests (page ${currentPage})`;
    filterSummaryEl.textContent = `Status: ${currentStatus}${sortKey ? `, Sorted by ${sortKey} (${sortDir})` : ''}`;

    if (!sorted.length) {
      tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">
        <div>
          <i class="fas fa-inbox"></i>
          <h3>No requests</h3>
          <p>Try changing filters or refreshing</p>
        </div>
      </td></tr>`;
    } else {
      tableBody.innerHTML = sorted.map(renderRow).join('');
    }
    attachRowEvents();
    updateSelectedCountLabel();
  }

  // Header sort indicators
  function updateHeaderSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === sortKey) {
        th.classList.add(sortDir === 'desc' ? 'sorted-desc' : 'sorted-asc');
      }
    });
  }

  // Pagination controls
  function updatePagination(pagination) {
    const total = pagination.total_items || 0;
    const page = pagination.current_page || 1;
    const per = pagination.per_page || perPage;
    const totalPages = pagination.total_pages || 1;
    const start = total === 0 ? 0 : (page - 1) * per + 1;
    const end = Math.min(page * per, total);
    if (paginationInfoEl) paginationInfoEl.textContent = `Showing ${start}-${end} of ${total}`;

    let html = '';
    const disabledPrev = page <= 1 ? 'disabled' : '';
    const disabledNext = page >= totalPages ? 'disabled' : '';
    html += `<button class="btn-secondary" id="prevPageBtn" ${disabledPrev}>Prev</button>`;
    html += `<span style="margin: 0 8px;">Page ${page} / ${totalPages}</span>`;
    html += `<button class="btn-secondary" id="nextPageBtn" ${disabledNext}>Next</button>`;
    if (paginationControlsEl) paginationControlsEl.innerHTML = html;

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (currentPage > 1) { currentPage -= 1; loadRequests(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => { currentPage += 1; loadRequests(); });
  }

  // Load requests from server
  async function loadRequests() {
    showLoading(true);
    try {
      const url = `/admin/api/qr-register-requests?status=${encodeURIComponent(currentStatus)}&page=${currentPage}&per_page=${perPage}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');

      currentData = json.requests || [];
      if (itemsCountEl) itemsCountEl.textContent = `${json.pagination.total_items} total`;
      renderTable(currentData);
      updatePagination(json.pagination);
    } catch (err) {
      console.error('Error loading requests:', err);
      tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">
        <div>
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Error loading requests</h3>
          <p>${String(err.message || err)}</p>
        </div>
      </td></tr>`;
    } finally { showLoading(false); }
  }

  // Unified action flow using modals
  function startActionFlow(action, ids) {
    if (!action || !ids || ids.length === 0) return;
    pendingAction = { action, ids };
    openAdminRemarksModal(action);
  }

  function openAdminRemarksModal(action) {
    if (!adminRemarksModal) return;
    adminRemarksModal.style.display = 'flex';
    adminRemarksModal.setAttribute('aria-hidden', 'false');
    adminRemarksInput.value = '';
    remarksError.style.display = 'none';
    adminRemarksInput.focus();
    continueRemarksBtn.textContent = action === 'reject' ? 'Continue to Reject' : 'Continue to Approve';
  }
  function closeAdminRemarksModal() {
    if (!adminRemarksModal) return;
    adminRemarksModal.style.display = 'none';
    adminRemarksModal.setAttribute('aria-hidden', 'true');
  }

  function openConfirmModal(summary, proceedLabel) {
    if (!confirmActionModal) return;
    confirmActionBody.innerHTML = summary;
    proceedConfirmBtn.textContent = proceedLabel || 'Proceed';
    confirmActionModal.style.display = 'flex';
    confirmActionModal.setAttribute('aria-hidden', 'false');
    proceedConfirmBtn.focus();
  }
  function closeConfirmModal() {
    if (!confirmActionModal) return;
    confirmActionModal.style.display = 'none';
    confirmActionModal.setAttribute('aria-hidden', 'true');
  }

  // Perform single/batch action with concurrency control
  async function performAction(action, ids, remarks) {
    if (!action || !ids || ids.length === 0) return;
    showLoading(true);
    const endpointFor = (id) => action === 'approve'
      ? `/admin/api/qr-register-requests/${encodeURIComponent(id)}/approve`
      : `/admin/api/qr-register-requests/${encodeURIComponent(id)}/reject`;

    const limit = 3; // minimal concurrent workers to avoid server overload
    let index = 0;
    const results = { success: 0, failed: 0 };

    async function worker() {
      while (index < ids.length) {
        const i = index++;
        const id = ids[i];
        try {
          const res = await fetch(endpointFor(id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_remarks: remarks || '' })
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error || 'Request failed');
          results.success += 1;
        } catch (err) {
          console.error(`${action} failed for ${id}:`, err);
          results.failed += 1;
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, ids.length) }, () => worker());
    await Promise.all(workers);
    await loadRequests();
    showLoading(false);

    const msg = `${action === 'approve' ? 'Approved' : 'Rejected'} ${results.success} item(s)` + (results.failed ? `, ${results.failed} failed` : '');
    try {
      resultsMessageBox.style.display = 'block';
      resultsCountEl.textContent = msg;
    } catch {}
  }

  // Event bindings
  if (statusFilterEl) {
    statusFilterEl.addEventListener('change', () => {
      currentStatus = statusFilterEl.value;
      currentPage = 1; // Reset pagination
      selectedIds.clear(); // Clear selection on status change
      updateSelectedCountLabel();
      loadRequests();
    });
  }

  if (searchInputEl) {
    searchInputEl.addEventListener('input', () => {
      // Re-render list with search + sort
      renderTable(currentData);
    });
  }

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadRequests());

  // Select all
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      const checked = selectAllCheckbox.checked;
      tableBody.querySelectorAll('.row-select').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.claim;
        if (!id) return;
        if (checked) selectedIds.add(id); else selectedIds.delete(id);
        const tr = cb.closest('tr');
        if (tr) tr.classList.toggle('selected-row', checked);
      });
      updateSelectedCountLabel();
    });
  }

  // Batch action buttons
  if (approveSelectedBtn) approveSelectedBtn.addEventListener('click', () => startActionFlow('approve', Array.from(selectedIds)));
  if (rejectSelectedBtn) rejectSelectedBtn.addEventListener('click', () => startActionFlow('reject', Array.from(selectedIds)));

  // Sortable headers
  document.querySelectorAll('th.sortable').forEach(th => {
    function handleToggleSort() {
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      updateHeaderSortIndicators();
      renderTable(currentData);
    }
    th.addEventListener('click', handleToggleSort);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleSort(); }
    });
  });

  // Modal events
  if (cancelRemarksBtn) cancelRemarksBtn.addEventListener('click', () => { closeAdminRemarksModal(); pendingAction = null; });
  if (continueRemarksBtn) continueRemarksBtn.addEventListener('click', () => {
    if (!pendingAction) return;
    const remarks = adminRemarksInput.value.trim();
    if (pendingAction.action === 'reject' && !remarks) { remarksError.style.display = 'block'; adminRemarksInput.focus(); return; }
    remarksError.style.display = 'none';
    closeAdminRemarksModal();
    const summary = pendingAction.ids.length === 1
      ? `<p>You are about to <strong>${pendingAction.action}</strong> this request.</p>
         <p><strong>Remarks:</strong> ${remarks ? remarks.replace(/[<>]/g, '') : '<em>None</em>'}</p>`
      : `<p>You are about to <strong>${pendingAction.action}</strong> <strong>${pendingAction.ids.length}</strong> requests.</p>
         <p><strong>Remarks:</strong> ${remarks ? remarks.replace(/[<>]/g, '') : '<em>None</em>'}</p>`;
    openConfirmModal(summary, pendingAction.action === 'reject' ? 'Proceed to Reject' : 'Proceed to Approve');

    // Hook proceed
    const action = pendingAction.action;
    const ids = pendingAction.ids.slice();
    proceedConfirmBtn.onclick = function () {
      closeConfirmModal();
      performAction(action, ids, remarks);
      // Clear selection after batch
      selectedIds.clear();
      updateSelectedCountLabel();
    };
  });
  if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', () => closeConfirmModal());

  // Initial load
  loadRequests();
})();
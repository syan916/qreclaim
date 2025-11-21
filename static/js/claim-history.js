/**
 * Claim History (Redesigned)
 * - Mobile-first UI using flex/grid
 * - Simple filtering, pagination, and cancel flow
 * - Follows early-return style and avoids deep nesting
 */

class ClaimHistoryApp {
  constructor() {
    // State
    this.claims = [];
    this.filtered = [];
    this.itemsPerPage = 10;
    this.currentCursor = null;
    this.nextCursor = null;
    this.cursorStack = [];
    this.currentPage = 1;
    this.totalPages = 1;
    this.isCancelling = false;
    this.loadController = null; // AbortController for concurrent loads

    // Elements
    this.$grid = document.getElementById('claimsGrid');
    this.$loading = document.getElementById('loadingState');
    this.$empty = document.getElementById('emptyState');
    this.$status = document.getElementById('statusFilter');
    this.$sort = document.getElementById('sortOrder');
    this.$startDate = document.getElementById('startDate');
    this.$endDate = document.getElementById('endDate');
    this.$applyDate = document.getElementById('applyDateBtn');
    this.$refresh = document.getElementById('refreshBtn');
    this.$prev = document.getElementById('prevPage');
    this.$next = document.getElementById('nextPage');
    this.$pageInfo = document.getElementById('pageInfo');
    this.$pagination = document.getElementById('pagination');

    // Modal
    this.$modal = document.getElementById('cancelModal');
    this.$modalClose = document.getElementById('modalClose');
    this.$modalKeep = document.getElementById('cancelModalBtn');
    this.$modalConfirm = document.getElementById('confirmCancelBtn');
    this.$preview = document.getElementById('claimPreview');
    this.pendingCancelId = null;

    this.init();
  }

  init() {
    // Bind filters
    if (this.$status) this.$status.addEventListener('change', () => this.reloadFirstPage());
    if (this.$sort) this.$sort.addEventListener('change', () => this.reloadFirstPage());
    if (this.$applyDate) this.$applyDate.addEventListener('click', () => this.reloadFirstPage());
    if (this.$refresh) this.$refresh.addEventListener('click', () => this.loadClaims(this.currentCursor));

    // Pagination
    if (this.$prev) this.$prev.addEventListener('click', () => this.previousPage());
    if (this.$next) this.$next.addEventListener('click', () => this.nextPage());

    // Modal controls
    if (this.$modalClose) this.$modalClose.addEventListener('click', () => this.hideModal());
    if (this.$modalKeep) this.$modalKeep.addEventListener('click', () => this.hideModal());
    if (this.$modalConfirm) this.$modalConfirm.addEventListener('click', () => this.confirmCancel());

    // Default date range: last 7 days
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    if (this.$startDate) this.$startDate.value = this.dateInputValue(start);
    if (this.$endDate) this.$endDate.value = this.dateInputValue(today);

    this.reloadFirstPage();
  }

  // Fetch claims from backend API
  async loadClaims(cursor = null) {
    // Abort previous load if any
    if (this.loadController) this.loadController.abort();
    this.loadController = new AbortController();
    const signal = this.loadController.signal;

    this.showLoading();

    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = this.getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const url = new URL('/user/api/claims/user', window.location.origin);
      const status = (this.$status?.value || 'all').toLowerCase();
      const sort = (this.$sort?.value || 'newest').toLowerCase();
      const startIso = this.rangeStartISO();
      const endIso = this.rangeEndISO();
      if (status !== 'all') url.searchParams.set('status', status);
      url.searchParams.set('sort', sort);
      if (startIso) url.searchParams.set('start', startIso);
      if (endIso) url.searchParams.set('end', endIso);
      url.searchParams.set('page_size', String(this.itemsPerPage));
      if (cursor) url.searchParams.set('cursor', cursor);
      
      const res = await this.fetchWithRetry(url.toString(), { method: 'GET', headers, signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data && data.code === 'INDEX_REQUIRED') {
          this.showMessage('Index required for query. Please create it in Firebase Console.', 'error');
        } else {
          this.showMessage(data.error || data.message || `Failed (${res.status})`, 'error');
        }
        this.showEmpty();
        return;
      }
      if (!data.success) {
        this.showMessage(data.error || data.message || 'Failed to load claims.', 'error');
        this.showEmpty();
        return;
      }

      this.currentCursor = cursor || null;
      this.nextCursor = (data.pagination && data.pagination.next_cursor_id) || null;
      this.claims = Array.isArray(data.claims) ? data.claims : [];
      this.updateStats();
      this.render();
    } catch (err) {
      if (err.name === 'AbortError') return; // ignore aborted fetch
      console.error('loadClaims error:', err);
      this.showMessage('Failed to load claims. Please try again.', 'error');
      this.showEmpty();
    } finally {
      this.hideLoading();
    }
  }

  // Apply filters and sort, then re-render
  reloadFirstPage() {
    this.cursorStack = [];
    this.currentCursor = null;
    this.currentPage = 1;
    // Validate date range
    const s = this.$startDate?.value;
    const e = this.$endDate?.value;
    if (s && e) {
      const sd = new Date(`${s}T00:00:00Z`).getTime();
      const ed = new Date(`${e}T23:59:59Z`).getTime();
      if (isNaN(sd) || isNaN(ed) || sd > ed) {
        this.showMessage('Invalid date range', 'error');
        return;
      }
    }
    this.loadClaims(null);
  }

  // Render current page
  render() {
    if (!this.$grid) return;
    this.$grid.innerHTML = '';
    const baseIndex = this.cursorStack.length * this.itemsPerPage;
    this.claims.forEach((claim, idx) => this.$grid.appendChild(this.createCard(claim, baseIndex + idx + 1)));
    this.$grid.style.display = 'grid';
    this.updatePagination();
    this.bindExpandButtons();
    this.bindCancelButtons();
  }

  // Create a claim card element
  createCard(claim, indexNumber) {
    const imageSrc = claim.item_image_url || '/static/images/placeholder-item.png';
    const dateStr = this.formatDateFixed(claim.created_at);
    const statusClass = this.statusClass(claim.status);
    const isValuable = !!claim.is_valuable;

    const el = document.createElement('div');
    el.className = 'claim-card';
    el.innerHTML = `
      <div class="claim-header">
        <div class="claim-index">${indexNumber}.</div>
        <h3 class="claim-title" title="${this.escape(claim.item_name || 'Unknown Item')}">
          <i class="fas fa-box"></i> ${this.escape(this.truncate(claim.item_name || 'Unknown Item', 30))}
        </h3>
        <span class="claim-status ${statusClass}"><i class="fas fa-${this.statusIcon(claim.status)}"></i> ${this.escape(this.titleCase(claim.status))}</span>
      </div>
      <div class="claim-body">
        <img class="claim-image" src="${imageSrc}" alt="${this.escape(claim.item_name || 'Item')}" onerror="this.src='/static/images/placeholder-item.png'" />
        <div>
          <div class="claim-meta">
            <span class="meta-chip" title="Claim ID"><i class="fas fa-hashtag"></i> ${this.escape(this.formatClaimId(claim.id))}</span>
            <span class="meta-chip" title="Claim date"><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
            <span class="meta-chip" title="Valuable indicator"><i class="fas fa-${isValuable ? 'gem' : 'tag'}"></i> ${isValuable ? 'Valuable' : 'Standard'}</span>
            ${claim.locker_id ? `<span class="meta-chip" title="Locker"><i class="fas fa-lock"></i> ${this.escape(this.formatLockerId(String(claim.locker_id)))}</span>` : ''}
          </div>
          <div class="claim-details" id="details-${claim.id}">
            <div class="claim-meta" style="margin-top:.5rem">
              <span class="meta-chip"><i class="fas fa-user-check"></i> Approved by ${this.escape(claim.approved_by || (String(claim.status).toLowerCase() === 'pending' ? 'N/A' : '—'))}</span>
              ${claim.verification_method ? `<span class="meta-chip"><i class="fas fa-shield-halved"></i> ${this.escape(this.titleCase(claim.verification_method))}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="claim-footer">
        <button class="expand-btn" aria-expanded="false" aria-controls="details-${claim.id}"><i class="fas fa-chevron-down"></i></button>
        <div class="claim-actions">
          ${['pending','pending_approval'].includes(String(claim.status).toLowerCase()) ? `<button class="btn btn-danger js-cancel" data-id="${claim.id}"><i class="fas fa-times"></i> Cancel Request</button>` : ''}
        </div>
      </div>
    `;
    return el;
  }

  // Bind expand/collapse
  bindExpandButtons() {
    const btns = document.querySelectorAll('.expand-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.claim-card');
        const details = card?.querySelector('.claim-details');
        if (!details) return;
        const expanded = details.classList.toggle('expanded');
        btn.setAttribute('aria-expanded', String(expanded));
        btn.innerHTML = expanded ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
      });
    });
  }

  // Bind cancel buttons
  bindCancelButtons() {
    const btns = document.querySelectorAll('.js-cancel');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        this.openCancelModal(id);
      });
    });
  }

  // Open cancel modal
  openCancelModal(claimId) {
    this.pendingCancelId = claimId;
    const claim = this.claims.find(c => String(c.id) === String(claimId));
    this.$preview.innerHTML = claim ? `
      <div class="claim-meta">
        <span class="meta-chip"><i class="fas fa-box"></i> ${this.escape(claim.item_name || 'Unknown Item')}</span>
        <span class="meta-chip"><i class="fas fa-calendar-alt"></i> ${this.formatDate(claim.created_at)}</span>
        <span class="meta-chip"><i class="fas fa-circle-info"></i> ${this.escape(this.titleCase(claim.status))}</span>
      </div>
    ` : '';
    this.$modal.style.display = 'grid';
  }

  hideModal() {
    this.$modal.style.display = 'none';
    this.pendingCancelId = null;
  }

  async confirmCancel() {
    const id = this.pendingCancelId;
    if (!id || this.isCancelling) return; // guard against duplicate presses
    this.isCancelling = true;
    if (this.$modalConfirm) {
      this.$modalConfirm.disabled = true;
      this.$modalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = this.getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/user/api/claims/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Cancel failed (${res.status})`);

      this.showMessage('Claim cancelled successfully.', 'success');
      this.hideModal();
      // Refresh list to reflect changes
      await this.loadClaims(this.currentCursor);
    } catch (err) {
      console.error('cancel error:', err);
      this.showMessage(err.message || 'Failed to cancel claim', 'error');
    } finally {
      this.isCancelling = false;
      if (this.$modalConfirm) {
        this.$modalConfirm.disabled = false;
        this.$modalConfirm.innerHTML = '<i class="fas fa-times"></i> Cancel Claim';
      }
    }
  }

  // Stats section
  updateStats() {
    const total = this.claims.length;
    const pending = this.claims.filter(c => String(c.status).toLowerCase() === 'pending').length;
    const completed = this.claims.filter(c => String(c.status).toLowerCase() === 'completed').length;

    const write = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    write('totalClaims', total);
    write('pendingClaims', pending);
    write('completedClaims', completed);
  }

  updatePagination() {
    if (!this.$pagination) return;
    const hasPrev = this.cursorStack.length > 0;
    const hasNext = !!this.nextCursor;
    this.$prev.disabled = !hasPrev;
    this.$next.disabled = !hasNext;
    const pageNum = this.cursorStack.length + 1;
    this.$pageInfo.textContent = `Page ${pageNum}`;
    this.$pagination.style.display = this.claims.length ? 'flex' : 'none';
  }

  previousPage() {
    if (!this.cursorStack.length) return;
    const prevCursor = this.cursorStack.pop() || null;
    this.currentCursor = prevCursor;
    this.loadClaims(prevCursor);
  }

  nextPage() {
    if (!this.nextCursor) return;
    this.cursorStack.push(this.currentCursor);
    this.loadClaims(this.nextCursor);
  }

  // Loading helpers
  showLoading() {
    if (this.$loading) this.$loading.style.display = 'block';
    if (this.$grid) this.$grid.style.display = 'none';
    if (this.$empty) this.$empty.style.display = 'none';
  }
  hideLoading() {
    if (this.$loading) this.$loading.style.display = 'none';
  }
  showEmpty() {
    if (this.$empty) this.$empty.style.display = 'block';
    if (this.$grid) this.$grid.style.display = 'none';
  }

  // Utils
  formatDateFixed(v) {
    try {
      const d = new Date(v);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${day} ${hh}:${mm}`;
    } catch { return '—'; }
  }
  titleCase(v) { return String(v || '').toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()); }
  escape(v) { const d = document.createElement('div'); d.textContent = String(v || ''); return d.innerHTML; }
  statusClass(v) { return String(v || 'pending').toLowerCase(); }
  statusIcon(v) {
    const map = { pending: 'clock', approved: 'check-circle', completed: 'flag-checkered', rejected: 'times-circle', expired: 'hourglass-end', cancelled: 'ban' };
    return map[String(v).toLowerCase()] || 'question-circle';
  }
  getAuthToken() { return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || ''; }
  showMessage(text, type = 'success') {
    const box = document.createElement('div');
    box.className = `message ${type}`;
    box.innerHTML = `<i class="fas fa-${type === 'success' ? 'check' : 'exclamation'}-circle"></i> <span>${this.escape(text)}</span>`;
    const container = document.getElementById('messageContainer');
    if (!container) return; // safety
    container.appendChild(box);
    setTimeout(() => { box.remove(); }, 3500);
  }

  dateInputValue(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  rangeStartISO() {
    try {
      if (!this.$startDate?.value) return null;
      const d = new Date(`${this.$startDate.value}T00:00:00Z`);
      return d.toISOString();
    } catch { return null; }
  }
  rangeEndISO() {
    try {
      if (!this.$endDate?.value) return null;
      const d = new Date(`${this.$endDate.value}T23:59:59Z`);
      return d.toISOString();
    } catch { return null; }
  }

  formatClaimId(id) {
    const digits = String(id || '').replace(/\D/g, '');
    const padded = digits.padStart(6, '0');
    return `CLM-${padded}`;
  }
  formatLockerId(id) {
    const digits = String(id || '').replace(/\D/g, '');
    const padded = digits.padStart(4, '0');
    return `LKR-${padded}`;
  }
  truncate(str, len) {
    const s = String(str || '');
    return s.length > len ? `${s.slice(0, len)}…` : s;
  }

  async fetchWithRetry(url, options, retries = 2) {
    let attempt = 0;
    while (true) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          // Retry only on transient server errors
          if (res.status >= 500 || res.status === 429) {
            throw new Error(`HTTP ${res.status}`);
          }
          return res;
        }
        return res;
      } catch (err) {
        attempt += 1;
        if (attempt > retries) throw err;
        await new Promise(r => setTimeout(r, 400 * attempt));
      }
    }
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => new ClaimHistoryApp());
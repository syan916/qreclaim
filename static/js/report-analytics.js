/**
 * Report Analytics Page
 * Builds 5 charts fed by backend Firestore aggregates.
 * - Mobile-first, responsive via Chart.js
 * - Polling is used to auto-refresh without adding client Firebase SDK
 * - Avoids deep nesting; uses small helpers and early returns when needed
 */

(function() {
  // Chart handles
  let itemHandlingChart, lockerTrendChart, lockerDonutChart, qrTrendChart, verificationPieChart, topCategoriesChart;
  // Map for wiring exports by canvas id
  const chartsById = {};

  // Dev flag: only log performance details in development
  const DEV_MODE = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ||
                   (typeof localStorage !== 'undefined' && localStorage.getItem('devMode') === 'true');

  // Configurable thresholds (can be overridden via global vars)
  const CONFIG = {
    MIN_UPDATE_INTERVAL_MS: Number(window.ANALYTICS_MIN_INTERVAL_MS || 5000),
    NUMERIC_THRESHOLD_PERCENT: Number(window.ANALYTICS_NUMERIC_THRESHOLD_PERCENT || 5),
    MAX_RETRY_ATTEMPTS: Number(window.ANALYTICS_MAX_RETRY_ATTEMPTS || 3),
    BACKOFF_MS_START: Number(window.ANALYTICS_BACKOFF_MS_START || 1000)
  };
  // Refresh mode management (Off | SSE | Polling). Persisted in localStorage.
  // - Off: Single load, no SSE, no polling
  // - SSE: Streams only for available charts (item handling, locker usage), no polling
  // - Polling: Timed refresh for all charts, no SSE
  const VALID_MODES = ['off', 'sse', 'polling'];
  function getRefreshMode() {
    const v = (window.ANALYTICS_REFRESH_MODE || localStorage.getItem('analyticsRefreshMode') || 'off').toLowerCase();
    return VALID_MODES.includes(v) ? v : 'off';
  }
  function setRefreshMode(mode) {
    const m = (mode || '').toLowerCase();
    const final = VALID_MODES.includes(m) ? m : 'off';
    window.ANALYTICS_REFRESH_MODE = final;
    try { localStorage.setItem('analyticsRefreshMode', final); } catch(_) {}
    applyRefreshMode();
  }
  // Keep track of active poll timers so we can clear them when mode changes
  let pollTimers = [];
  function clearPollers() {
    try { pollTimers.forEach(id => clearInterval(id)); } catch(_) {}
    pollTimers = [];
  }
  function schedulePollers() {
    // Remove any existing timers before scheduling
    clearPollers();
    // Timed refreshes for all charts (respect per-chart debouncing)
    pollTimers.push(setInterval(refreshItemHandling, POLL_INTERVAL_DEFAULT));
    pollTimers.push(setInterval(refreshQrTrend, POLL_INTERVAL_DEFAULT));
    pollTimers.push(setInterval(refreshVerificationMethods, POLL_INTERVAL_DEFAULT));
    pollTimers.push(setInterval(refreshTopCategories, POLL_INTERVAL_DEFAULT));
    pollTimers.push(setInterval(refreshLockerUsage, POLL_INTERVAL_LOCKER));
  }
  function applyRefreshMode() {
    const mode = getRefreshMode();
    const sel = document.getElementById('refreshModeSelect');
    if (sel) sel.value = mode;
    // Always clear pollers when switching mode
    clearPollers();
    if (mode === 'off') {
      // Close SSE if present to prevent backend stream reads
      if (sseItemHandling) { try { sseItemHandling.close(); } catch(_) {} sseItemHandling = null; }
      if (sseLockerUsage) { try { sseLockerUsage.close(); } catch(_) {} sseLockerUsage = null; }
      if (DEV_MODE) console.debug('[analytics] Refresh mode: OFF — no SSE, no polling');
      return;
    }
    if (mode === 'sse') {
      // Ensure SSE connections are established for supported charts
      maybeInitSSEItemHandling();
      maybeInitSSELockerUsage();
      if (DEV_MODE) console.debug('[analytics] Refresh mode: SSE — streams for supported charts, no polling');
      return;
    }
    if (mode === 'polling') {
      // Ensure SSE is closed and start polling
      if (sseItemHandling) { try { sseItemHandling.close(); } catch(_) {} sseItemHandling = null; }
      if (sseLockerUsage) { try { sseLockerUsage.close(); } catch(_) {} sseLockerUsage = null; }
      schedulePollers();
      if (DEV_MODE) console.debug('[analytics] Refresh mode: POLLING — timed refresh enabled for all charts');
      return;
    }
  }

  // SSE activity state to gate polling. When SSE is delivering messages,
  // we skip periodic fetches to avoid continuous backend reads.
  // If SSE becomes stale (no messages for a while), polling resumes automatically.
  const SSE_STALE_MS = Number(window.ANALYTICS_SSE_STALE_MS || 120000); // 2 minutes
  const SSE_STATE = {
    itemHandling: { active: false, lastTs: 0 },
    lockerUsage: { active: false, lastTs: 0 }
  };
  function markSSEActive(key) {
    const s = SSE_STATE[key];
    if (!s) return;
    s.active = true;
    s.lastTs = Date.now();
  }
  function isSSEActive(key) {
    const s = SSE_STATE[key];
    if (!s || !s.active) return false;
    const age = Date.now() - (s.lastTs || 0);
    // Consider SSE inactive if no data received recently
    return age < SSE_STALE_MS;
  }

  // Change detection and debouncing state
  const lastSnapshots = {};     // per-chart normalized snapshots
  const lastExecTimes = {};     // per-chart last refresh timestamp
  const MIN_REFRESH_INTERVAL = 5000; // 5s minimum between update checks (debounce)

  // Polling intervals (ms)
  const POLL_INTERVAL_DEFAULT = 15000; // 15s
  const POLL_INTERVAL_LOCKER = 8000;   // 8s for more real-time feel

  // Safe fetch with retry/backoff and basic Firebase-style error handling
  async function safeFetch(url) {
    const attempt = async () => {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      if (DEV_MODE) console.debug('[analytics] fetch ok', url);
      return data;
    };
    try {
      return await retryWithBackoff(attempt, CONFIG.MAX_RETRY_ATTEMPTS, CONFIG.BACKOFF_MS_START);
    } catch (e) {
      console.error('Fetch error:', e);
      return { success: false, error: String(e) };
    }
  }

  // Utility: build last 12 month labels if backend doesn't provide
  function monthLabels() {
    const now = new Date();
    const labels = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(d.toLocaleString('en-US', { month: 'short' }));
    }
    return labels;
  }

  // Colors (consistent palette)
  const COLORS = {
    found: 'rgba(59, 130, 246, 1)',       // blue
    foundBg: 'rgba(59, 130, 246, 0.2)',
    claimed: 'rgba(34, 197, 94, 1)',     // green
    claimedBg: 'rgba(34, 197, 94, 0.2)',
    unclaimed: 'rgba(245, 158, 11, 1)',  // yellow
    unclaimedBg: 'rgba(245, 158, 11, 0.2)',
    occupied: 'rgba(16, 185, 129, 1)',   // teal
    available: 'rgba(99, 102, 241, 1)'   // indigo
  };

  // Chart options: common responsive defaults
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false }
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    scales: { y: { beginAtZero: true } }
  };

  // Filename helpers
  // Format: YYYY-MM
  function formatYearMonth(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // Returns a descriptor based on chart and current UI selections
  function getDescriptorForChart(chartId) {
    try {
      switch (chartId) {
        case 'itemHandlingChart':
          return 'last-12-months';
        case 'lockerUsageTrend': {
          const granSel = document.getElementById('lockerGranularity');
          const gran = (granSel && granSel.value) ? granSel.value : 'day';
          return `gran-${gran}`; // e.g., gran-day or gran-week
        }
        case 'lockerOccupancyDonut':
          return 'snapshot';
        case 'qrTrendChart':
          // Back-end queried with period=month
          return 'current-month';
        case 'verificationMethodChart':
          return 'latest';
        case 'topCategoriesChart': {
          const rangeSel = document.getElementById('categoryRange');
          const range = (rangeSel && rangeSel.value) ? rangeSel.value : 'last30';
          // Map to human-friendly tokens
          const map = { last7: 'last-7-days', last30: 'last-30-days', semester: 'this-semester' };
          return map[range] || range;
        }
        default:
          return 'latest';
      }
    } catch (_) {
      return 'latest';
    }
  }

  // Build final filename base without extension
  function buildExportFilename(chartId, base) {
    const ym = formatYearMonth();
    const descriptor = getDescriptorForChart(chartId);
    // Avoid deep nesting; return early if base missing
    if (!base) return `${chartId}_${ym}_${descriptor}`;
    // Include chartId to satisfy tests and aid traceability
    return `${chartId}_${base}_${ym}_${descriptor}`;
  }

  // Initialize all charts
  async function initCharts() {
    await initItemHandling();
    await initLockerUsage();
    await initQrTrend();
    await initVerificationMethods();
    await initTopCategories();

    // Wire export buttons after charts are ready
    wireExportButtons();
    // Apply current refresh mode (this will setup SSE or polling as needed)
    applyRefreshMode();
    // Hook up the mode selector UI
    const sel = document.getElementById('refreshModeSelect');
    if (sel) {
      // Initialize selector value and listen for changes
      sel.value = getRefreshMode();
      sel.addEventListener('change', (e) => setRefreshMode(e.target.value));
    }
  }

  // Prompt 1 — Item Handling Summary Chart (Stacked Bar)
  async function initItemHandling() {
    const res = await safeFetch('/admin/api/analytics/item-handling-monthly');
    if (!res.success) return console.warn('Item handling data not available:', res.error);

    const labels = res.labels && res.labels.length ? res.labels : monthLabels();
    const ctx = document.getElementById('itemHandlingChart');
    if (!ctx) return;

    itemHandlingChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Found', data: res.datasets.found || [], backgroundColor: COLORS.foundBg, borderColor: COLORS.found, borderWidth: 1, stack: 'items' },
          { label: 'Claimed', data: res.datasets.claimed || [], backgroundColor: COLORS.claimedBg, borderColor: COLORS.claimed, borderWidth: 1, stack: 'items' },
          { label: 'Unclaimed', data: res.datasets.unclaimed || [], backgroundColor: COLORS.unclaimedBg, borderColor: COLORS.unclaimed, borderWidth: 1, stack: 'items' }
        ]
      },
      options: {
        ...commonOptions,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });
    chartsById['itemHandlingChart'] = itemHandlingChart;

    // Summary pill for current month
    renderItemHandlingSummary(res.current_month_summary);

    // Conditionally subscribe to SSE for real-time updates
    maybeInitSSEItemHandling();
  }

  async function refreshItemHandling() {
    if (!itemHandlingChart) return;
    // Disable polling fetch when SSE is active and fresh
    if (isSSEActive('itemHandling')) return;
    if (!shouldRun('itemHandlingChart')) return;
    const res = await safeFetch('/admin/api/analytics/item-handling-monthly');
    if (!res.success) return;
    const nextSnap = {
      labels: res.labels && res.labels.length ? res.labels : monthLabels(),
      found: res.datasets.found || [],
      claimed: res.datasets.claimed || [],
      unclaimed: res.datasets.unclaimed || []
    };
    if (!hasChanged('itemHandlingChart', nextSnap)) {
      if (DEV_MODE) console.debug('[analytics] no change: itemHandlingChart');
      return; // skip update if nothing changed
    }
    itemHandlingChart.data.labels = nextSnap.labels;
    const ds = itemHandlingChart.data.datasets;
    ds[0].data = nextSnap.found;
    ds[1].data = nextSnap.claimed;
    ds[2].data = nextSnap.unclaimed;
    itemHandlingChart.update();
    renderItemHandlingSummary(res.current_month_summary);
    if (DEV_MODE) console.debug('[analytics] updated: itemHandlingChart');
  }

  function renderItemHandlingSummary(summary) {
    const el = document.getElementById('itemHandlingSummary');
    if (!el || !summary) return;
    el.innerHTML = '';
    el.appendChild(makePill('Found', summary.found_total || 0, 'dot-found'));
    el.appendChild(makePill('Claimed', summary.claimed_total || 0, 'dot-claimed'));
  }

  function makePill(label, value, dotClass) {
    const d = document.createElement('div');
    d.className = 'summary-pill';
    const dot = document.createElement('span');
    dot.className = `dot ${dotClass}`;
    const text = document.createElement('span');
    text.textContent = `${label}: ${value}`;
    d.appendChild(dot);
    d.appendChild(text);
    return d;
  }

  // Prompt 2 — Locker Usage Report (Line + Donut)
  async function initLockerUsage() {
    const granularitySelect = document.getElementById('lockerGranularity');
    const granularity = granularitySelect ? granularitySelect.value : 'day';
    const res = await safeFetch(`/admin/api/analytics/locker-usage?granularity=${encodeURIComponent(granularity)}`);
    if (!res.success) return console.warn('Locker usage data not available:', res.error);

    const trendCtx = document.getElementById('lockerUsageTrend');
    const donutCtx = document.getElementById('lockerOccupancyDonut');
    if (!trendCtx || !donutCtx) return;

    lockerTrendChart = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: res.labels || [],
        datasets: [{
          label: 'Occupied Lockers',
          data: res.trend || [],
          borderColor: COLORS.occupied,
          backgroundColor: 'rgba(16, 185, 129, 0.2)',
          borderWidth: 2,
          tension: 0.3
        }]
      },
      options: commonOptions
    });
    chartsById['lockerUsageTrend'] = lockerTrendChart;

    lockerDonutChart = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Occupied', 'Available'],
        datasets: [{
          data: [res.occupancy?.occupied || 0, res.occupancy?.available || 0],
          backgroundColor: [COLORS.occupied, COLORS.available]
        }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
    chartsById['lockerOccupancyDonut'] = lockerDonutChart;

    // Re-fetch/reconnect on granularity change
    if (granularitySelect) {
      granularitySelect.addEventListener('change', () => {
        if (getRefreshMode() === 'sse') {
          // Reconnect SSE with new granularity to avoid stale stream
          maybeInitSSELockerUsage();
        } else {
          // Do a one-time fetch (or let polling pick it up)
          refreshLockerUsage();
        }
      });
    }

    // Conditionally subscribe to SSE for real-time updates
    maybeInitSSELockerUsage();
  }

  async function refreshLockerUsage() {
    const granularitySelect = document.getElementById('lockerGranularity');
    const granularity = granularitySelect ? granularitySelect.value : 'day';
    // Disable polling fetch when SSE is active and fresh
    if (isSSEActive('lockerUsage')) return;
    if (!shouldRun('lockerUsage')) return;
    const res = await safeFetch(`/admin/api/analytics/locker-usage?granularity=${encodeURIComponent(granularity)}`);
    if (!res.success) return;
    const nextTrend = { labels: res.labels || [], trend: res.trend || [] };
    const nextDonut = { occupied: res.occupancy?.occupied || 0, available: res.occupancy?.available || 0 };
    let changed = false;
    if (lockerTrendChart && hasChanged('lockerTrendChart', nextTrend)) {
      lockerTrendChart.data.labels = nextTrend.labels;
      lockerTrendChart.data.datasets[0].data = nextTrend.trend;
      lockerTrendChart.update();
      changed = true;
    }
    if (lockerDonutChart && hasChanged('lockerDonutChart', nextDonut)) {
      lockerDonutChart.data.datasets[0].data = [nextDonut.occupied, nextDonut.available];
      lockerDonutChart.update();
      changed = true;
    }
    if (DEV_MODE) console.debug('[analytics] lockerUsage refresh', { changed });
  }

  // Prompt 3 — QR Registration & Approval Trend (Dual Line)
  async function initQrTrend() {
    const res = await safeFetch('/admin/api/analytics/qr-trend?period=month');
    if (!res.success) return console.warn('QR trend data not available:', res.error);
    const ctx = document.getElementById('qrTrendChart');
    if (!ctx) return;
    qrTrendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: res.labels || monthLabels(),
        datasets: [
          { label: 'QR Requests Submitted', data: res.requests || [], borderColor: COLORS.found, backgroundColor: COLORS.foundBg, borderWidth: 2, tension: 0.3 },
          { label: 'QR Requests Approved', data: res.approvals || [], borderColor: COLORS.claimed, backgroundColor: COLORS.claimedBg, borderWidth: 2, tension: 0.3 }
        ]
      },
      options: commonOptions
    });
    chartsById['qrTrendChart'] = qrTrendChart;
    renderApprovalRate(res.approval_rate);
  }

  async function refreshQrTrend() {
    if (!qrTrendChart) return;
    if (!shouldRun('qrTrendChart')) return;
    const res = await safeFetch('/admin/api/analytics/qr-trend?period=month');
    if (!res.success) return;
    const nextSnap = {
      labels: res.labels || monthLabels(),
      requests: res.requests || [],
      approvals: res.approvals || []
    };
    if (!hasChanged('qrTrendChart', nextSnap)) {
      if (DEV_MODE) console.debug('[analytics] no change: qrTrendChart');
      return;
    }
    qrTrendChart.data.labels = nextSnap.labels;
    qrTrendChart.data.datasets[0].data = nextSnap.requests;
    qrTrendChart.data.datasets[1].data = nextSnap.approvals;
    qrTrendChart.update();
    renderApprovalRate(res.approval_rate);
    if (DEV_MODE) console.debug('[analytics] updated: qrTrendChart');
  }

  function renderApprovalRate(rate) {
    const el = document.getElementById('qrApprovalRate');
    if (!el) return;
    const pct = typeof rate === 'number' ? rate.toFixed(1) : '0.0';
    el.innerHTML = `<div class="summary-pill"><span class="dot dot-claimed"></span><span>Approval Rate: ${pct}%</span></div>`;
  }

  // Prompt 4 — Verification Method Usage Report (Pie)
  async function initVerificationMethods() {
    const res = await safeFetch('/admin/api/analytics/verification-methods');
    if (!res.success) return console.warn('Verification methods data not available:', res.error);
    const ctx = document.getElementById('verificationMethodChart');
    if (!ctx) return;

    const labels = res.methods.map(m => m.label);
    const counts = res.methods.map(m => m.count);
    const colors = [COLORS.found, COLORS.claimed, COLORS.unclaimed];

    verificationPieChart = new Chart(ctx, {
      type: 'pie',
      data: { labels, datasets: [{ data: counts, backgroundColor: colors }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
    chartsById['verificationMethodChart'] = verificationPieChart;
    renderTopVerificationMethod(res.top_method);
  }

  async function refreshVerificationMethods() {
    if (!verificationPieChart) return;
    if (!shouldRun('verificationMethodChart')) return;
    const res = await safeFetch('/admin/api/analytics/verification-methods');
    if (!res.success) return;
    const labels = res.methods.map(m => m.label);
    const counts = res.methods.map(m => m.count);
    const nextSnap = { labels, counts };
    if (!hasChanged('verificationMethodChart', nextSnap)) {
      if (DEV_MODE) console.debug('[analytics] no change: verificationMethodChart');
      return;
    }
    verificationPieChart.data.labels = labels;
    verificationPieChart.data.datasets[0].data = counts;
    verificationPieChart.update();
    renderTopVerificationMethod(res.top_method);
    if (DEV_MODE) console.debug('[analytics] updated: verificationMethodChart');
  }

  function renderTopVerificationMethod(top) {
    const el = document.getElementById('topVerificationMethod');
    if (!el || !top) return;
    const pct = top.percent != null ? top.percent.toFixed(1) : '0.0';
    el.innerHTML = `<div class="summary-pill"><span class="dot dot-found"></span><span>Most Used: ${top.label} (${top.count} | ${pct}%)</span></div>`;
  }

  // Prompt 5 — Top Lost Item Categories (Bar + filter)
  async function initTopCategories() {
    const rangeSelect = document.getElementById('categoryRange');
    const range = rangeSelect ? rangeSelect.value : 'last30';
    const res = await safeFetch(`/admin/api/analytics/top-found-categories?range=${encodeURIComponent(range)}`);
    if (!res.success) return console.warn('Top categories data not available:', res.error);
    const ctx = document.getElementById('topCategoriesChart');
    if (!ctx) return;

    topCategoriesChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: res.labels || [], datasets: [{ label: 'Found Items', data: res.counts || [], backgroundColor: res.labels.map((_, i) => i < 3 ? COLORS.foundBg : 'rgba(107,114,128,0.2)'), borderColor: res.labels.map((_, i) => i < 3 ? COLORS.found : 'rgba(107,114,128,1)'), borderWidth: 1 }] },
      options: { ...commonOptions, scales: { y: { beginAtZero: true } } }
    });
    chartsById['topCategoriesChart'] = topCategoriesChart;

    if (rangeSelect) {
      rangeSelect.addEventListener('change', refreshTopCategories);
    }
  }

  async function refreshTopCategories() {
    if (!topCategoriesChart) return;
    if (!shouldRun('topCategoriesChart')) return;
    const rangeSelect = document.getElementById('categoryRange');
    const range = rangeSelect ? rangeSelect.value : 'last30';
    const res = await safeFetch(`/admin/api/analytics/top-found-categories?range=${encodeURIComponent(range)}`);
    if (!res.success) return;
    const nextSnap = { labels: res.labels || [], counts: res.counts || [] };
    if (!hasChanged('topCategoriesChart', nextSnap)) {
      if (DEV_MODE) console.debug('[analytics] no change: topCategoriesChart');
      return;
    }
    topCategoriesChart.data.labels = nextSnap.labels;
    const dataset = topCategoriesChart.data.datasets[0];
    dataset.data = nextSnap.counts;
    dataset.backgroundColor = nextSnap.labels.map((_, i) => i < 3 ? COLORS.foundBg : 'rgba(107,114,128,0.2)');
    dataset.borderColor = nextSnap.labels.map((_, i) => i < 3 ? COLORS.found : 'rgba(107,114,128,1)');
    topCategoriesChart.update();
    if (DEV_MODE) console.debug('[analytics] updated: topCategoriesChart');
  }

  // Kick off once DOM is ready
  document.addEventListener('DOMContentLoaded', initCharts);

  // =====================
  // Realtime via SSE (with retry/backoff and debounced updates)
  // =====================
  let sseItemHandling = null;
  let sseLockerUsage = null;

  // Only initialize SSE when mode is 'sse'
  function maybeInitSSEItemHandling() {
    if (getRefreshMode() !== 'sse') {
      if (sseItemHandling) { try { sseItemHandling.close(); } catch(_) {} sseItemHandling = null; }
      return;
    }
    initSSEItemHandling();
  }
  function maybeInitSSELockerUsage() {
    if (getRefreshMode() !== 'sse') {
      if (sseLockerUsage) { try { sseLockerUsage.close(); } catch(_) {} sseLockerUsage = null; }
      return;
    }
    initSSELockerUsage();
  }

  function initSSEItemHandling() {
    try {
      if (sseItemHandling) sseItemHandling.close();
      sseItemHandling = connectSSE('/admin/api/analytics/stream/item-handling', (payload) => {
        if (!payload || !payload.success || !itemHandlingChart) return;
        // Mark SSE active so polling is suppressed
        markSSEActive('itemHandling');
        const nextSnap = {
          labels: payload.labels && payload.labels.length ? payload.labels : monthLabels(),
          found: payload.datasets?.found || [],
          claimed: payload.datasets?.claimed || [],
          unclaimed: payload.datasets?.unclaimed || []
        };
        // Debounce and thresholded update
        enqueueUpdate('itemHandlingChart', () => {
          if (!significantChange('itemHandlingChart', nextSnap, CONFIG.NUMERIC_THRESHOLD_PERCENT)) return;
          itemHandlingChart.data.labels = nextSnap.labels;
          const ds = itemHandlingChart.data.datasets;
          ds[0].data = nextSnap.found;
          ds[1].data = nextSnap.claimed;
          ds[2].data = nextSnap.unclaimed;
          itemHandlingChart.update();
          renderItemHandlingSummary(payload.current_month_summary);
          if (DEV_MODE) console.debug('[analytics] SSE updated: itemHandlingChart');
        }, 10);
      });
    } catch (e) {
      console.warn('SSE item handling init failed:', e);
    }
  }

  function initSSELockerUsage() {
    try {
      if (sseLockerUsage) sseLockerUsage.close();
      const granularitySelect = document.getElementById('lockerGranularity');
      const granularity = granularitySelect ? granularitySelect.value : 'day';
      sseLockerUsage = connectSSE(`/admin/api/analytics/stream/locker-usage?granularity=${encodeURIComponent(granularity)}`, (payload) => {
        if (!payload || !payload.success || !lockerTrendChart || !lockerDonutChart) return;
        // Mark SSE active so polling is suppressed
        markSSEActive('lockerUsage');
        const nextTrend = { labels: payload.labels || [], trend: payload.trend || [] };
        const nextDonut = { occupied: payload.occupancy?.occupied || 0, available: payload.occupancy?.available || 0 };
        enqueueUpdate('lockerTrendChart', () => {
          if (significantChange('lockerTrendChart', nextTrend, CONFIG.NUMERIC_THRESHOLD_PERCENT)) {
            lockerTrendChart.data.labels = nextTrend.labels;
            lockerTrendChart.data.datasets[0].data = nextTrend.trend;
            lockerTrendChart.update();
            if (DEV_MODE) console.debug('[analytics] SSE updated: lockerTrendChart');
          }
        }, 8);
        enqueueUpdate('lockerDonutChart', () => {
          if (significantChange('lockerDonutChart', nextDonut, CONFIG.NUMERIC_THRESHOLD_PERCENT)) {
            lockerDonutChart.data.datasets[0].data = [nextDonut.occupied, nextDonut.available];
            lockerDonutChart.update();
            if (DEV_MODE) console.debug('[analytics] SSE updated: lockerDonutChart');
          }
        }, 8);
      });
    } catch (e) {
      console.warn('SSE locker usage init failed:', e);
    }
  }

  // =====================
  // Export utilities
  // =====================
  function wireExportButtons() {
    // Support both data-chart-id and legacy data-chart attributes
    const buttons = document.querySelectorAll('.btn-export[data-export][data-chart-id], .btn-export[data-export][data-chart]');
    buttons.forEach(btn => {
      const chartId = btn.getAttribute('data-chart-id') || btn.getAttribute('data-chart');
      const fmt = btn.getAttribute('data-export');
      const base = btn.getAttribute('data-filename') || chartId;
      btn.addEventListener('click', () => {
        setExportState(btn, 'loading');
        try {
          const chart = chartsById[chartId];
          if (!chart) {
            announceStatus('Chart not ready yet. Please wait and try again.');
            alert('Chart not ready yet. Please wait a moment and try again.');
            return;
          }
          const filenameBase = buildExportFilename(chartId, base);
          // Show full-screen overlay for PDF generation (single chart)
          if (fmt === 'pdf') showExportOverlay('Generating PDF…');
          exportChart(chart, fmt, filenameBase);
          announceStatus(`${fmt.toUpperCase()} export completed for ${filenameBase}.`);
        } catch (e) {
          console.error('Export error:', e);
          announceStatus(`${fmt.toUpperCase()} export failed: ${e?.message || 'unexpected error'}.`);
          alert('Export failed. Please try again.');
        } finally {
          setExportState(btn, 'idle');
          hideExportOverlay();
        }
      });
    });

    // Wire "Export All" (multi-page PDF)
    const exportAllBtn = document.getElementById('exportAllPdfBtn');
    if (exportAllBtn) {
      exportAllBtn.addEventListener('click', async () => {
        setExportState(exportAllBtn, 'loading');
        try {
          showExportOverlay('Bundling all charts into a single PDF…');
          await exportAllChartsToPDF();
          announceStatus('Export All (PDF) completed.');
        } catch (e) {
          console.error('Export All failed:', e);
          announceStatus(`Export All failed: ${e?.message || 'unexpected error'}.`);
          alert('Export All failed. Please try again.');
        } finally {
          setExportState(exportAllBtn, 'idle');
          hideExportOverlay();
        }
      });
    }
  }

  function setExportState(btn, state) {
    if (!btn) return;
    const loading = state === 'loading';
    btn.classList.toggle('loading', loading);
    btn.disabled = loading;
    if (loading) announceStatus(`Starting ${btn.getAttribute('data-export').toUpperCase()} export...`);
  }

  function announceStatus(message) {
    const region = document.getElementById('export-status');
    if (region) region.textContent = message;
  }

  function exportChart(chart, format, filename) {
    if (!chart || !format) return;
    if (format === 'png') return exportChartPNG(chart, `${filename}.png`);
    if (format === 'pdf') return exportChartPDF(chart, `${filename}.pdf`);
    if (format === 'csv') return exportChartCSV(chart, `${filename}.csv`);
  }

  // Export PNG using Chart.js data URL (matches exactly what's shown)
  function exportChartPNG(chart, filename) {
    try {
      // Ensure the canvas is up-to-date before exporting
      chart.update('none');
      const url = chart.toBase64Image();
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error('PNG export failed:', e);
      alert('PNG export failed.');
    }
  }

  // Export PDF via jsPDF using the current canvas image
  function exportChartPDF(chart, filename) {
    try {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) throw new Error('jsPDF not loaded');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      // Update chart and capture image
      chart.update('none');
      // Page metadata from the DOM (title + description)
      const chartId = chart?.canvas?.id;
      const section = chartId ? document.getElementById(chartId)?.closest('.analytics-section') : null;
      const title = section?.querySelector('.section-header h2')?.textContent || chartId || 'Report';
      const desc = section?.querySelector('.section-description p')?.textContent || '';
      const imgData = chart.toBase64Image();
      // Fit image within page with margins
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 24;
      const usableWidth = pageWidth - margin * 2;
      const canvas = chart.canvas;
      const ratio = canvas.height / canvas.width;
      const imgWidth = usableWidth;
      const imgHeight = imgWidth * ratio;
      // Header text
      doc.setFontSize(14);
      doc.setTextColor(33);
      doc.text(title, margin, margin + 6);

      // Wrap description below title
      const topOffset = margin + 20;
      if (desc) {
        doc.setFontSize(10);
        doc.setTextColor(80);
        const lines = wrapText(doc, desc, pageWidth - margin * 2);
        let yText = topOffset;
        lines.forEach(line => {
          doc.text(line, margin, yText);
          yText += 12; // ~line height
        });
        // Increase top offset by text height
        const textBlockHeight = lines.length * 12 + 6;
        // Fit image below description
        let availableHeight = pageHeight - (topOffset + textBlockHeight) - margin;
        let imgW = usableWidth;
        let imgH = imgW * ratio;
        if (imgH > availableHeight) {
          imgH = availableHeight;
          imgW = imgH / ratio;
        }
        const x = (pageWidth - imgW) / 2;
        const y = topOffset + textBlockHeight;
        doc.addImage(imgData, 'PNG', x, y, imgW, imgH);
      } else {
        // No description: center image vertically below title area
        let y = topOffset;
        let imgW = usableWidth;
        let imgH = imgW * ratio;
        if (imgH > pageHeight - topOffset - margin) {
          imgH = pageHeight - topOffset - margin;
          imgW = imgH / ratio;
        }
        const x = (pageWidth - imgW) / 2;
        doc.addImage(imgData, 'PNG', x, y, imgW, imgH);
      }
      doc.save(filename);
    } catch (e) {
      console.error('PDF export failed:', e);
      alert('PDF export failed.');
    }
  }

  // Export CSV from chart's current data
  function exportChartCSV(chart, filename) {
    try {
      const labels = chart.data.labels || [];
      const datasets = chart.data.datasets || [];
      let csv = '';
      // Build header
      if (datasets.length > 1 && chart.config.type !== 'pie' && chart.config.type !== 'doughnut') {
        csv += ['Label', ...datasets.map(d => d.label || 'Series')].join(',') + '\n';
        for (let i = 0; i < labels.length; i++) {
          const row = [escapeCSV(labels[i])];
          datasets.forEach(d => {
            const v = Array.isArray(d.data) ? d.data[i] : '';
            row.push(isFinite(v) ? v : (v ?? ''));
          });
          csv += row.join(',') + '\n';
        }
      } else {
        // Single dataset (pie/donut or single series)
        const d0 = datasets[0] || { data: [] };
        csv += ['Label', d0.label || 'Value'].join(',') + '\n';
        for (let i = 0; i < labels.length; i++) {
          const v = Array.isArray(d0.data) ? d0.data[i] : '';
          csv += [escapeCSV(labels[i]), isFinite(v) ? v : (v ?? '')].join(',') + '\n';
        }
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      console.error('CSV export failed:', e);
      alert('CSV export failed.');
    }
  }

  function escapeCSV(value) {
    const s = String(value ?? '').replace(/\r|\n/g, ' ');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Export All: bundle all charts into a single multi-page PDF
  async function exportAllChartsToPDF() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('jsPDF not loaded');
    // Order charts for a predictable report sequence
    const orderedIds = [
      'itemHandlingChart',
      'lockerUsageTrend',
      'lockerOccupancyDonut',
      'qrTrendChart',
      'verificationMethodChart',
      'topCategoriesChart'
    ];
    const charts = orderedIds
      .map(id => ({ id, chart: chartsById[id] }))
      .filter(x => x.chart);
    if (charts.length === 0) throw new Error('Charts are not ready yet');

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 24;

    // Helper: page title
    function pageTitleFor(id) {
      switch (id) {
        case 'itemHandlingChart': return 'Item Handling Summary';
        case 'lockerUsageTrend': return 'Locker Usage Trend';
        case 'lockerOccupancyDonut': return 'Locker Occupancy Ratio';
        case 'qrTrendChart': return 'QR Registration & Approval Trend';
        case 'verificationMethodChart': return 'Verification Method Usage';
        case 'topCategoriesChart': return 'Top Found Item Categories';
        default: return id;
      }
    }

    charts.forEach((entry, index) => {
      const { id, chart } = entry;
      // Update and snapshot
      chart.update('none');
      const imgData = chart.toBase64Image();
      const section = document.getElementById(id)?.closest('.analytics-section');
      const title = section?.querySelector('.section-header h2')?.textContent || pageTitleFor(id);
      const desc = section?.querySelector('.section-description p')?.textContent || '';
      const canvas = chart.canvas;
      const ratio = canvas.height / canvas.width;
      const usableWidth = pageWidth - margin * 2;
      let imgWidth = usableWidth;
      let imgHeight = imgWidth * ratio;

      // New page except for first
      if (index > 0) doc.addPage();

      // Title
      doc.setFontSize(14);
      doc.setTextColor(33);
      doc.text(title, margin, margin + 6);

      // Reserve space below title
      let topOffset = margin + 20;
      if (desc) {
        doc.setFontSize(10);
        doc.setTextColor(80);
        const lines = wrapText(doc, desc, pageWidth - margin * 2);
        let yText = topOffset;
        lines.forEach(line => {
          doc.text(line, margin, yText);
          yText += 12;
        });
        topOffset = yText + 6; // push image below description
      }

      // Fit image
      if (imgHeight > pageHeight - topOffset - margin) {
        imgHeight = pageHeight - topOffset - margin;
        imgWidth = imgHeight / ratio;
      }
      const x = (pageWidth - imgWidth) / 2;
      const y = topOffset;
      doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);

      // Footer with descriptor token for traceability
      doc.setFontSize(10);
      doc.setTextColor(100);
      const descriptor = getDescriptorForChart(id);
      doc.text(`Range: ${descriptor}`, margin, pageHeight - margin);
    });

    const ym = formatYearMonth();
    doc.save(`analytics-report_${ym}.pdf`);
  }

  // =====================
  // Helpers: change detection, debouncing, text wrapping, overlay
  // =====================
  function shouldRun(key) {
    const now = Date.now();
    const last = lastExecTimes[key] || 0;
    const minInterval = CONFIG.MIN_UPDATE_INTERVAL_MS || MIN_REFRESH_INTERVAL;
    if (now - last < minInterval) return false;
    lastExecTimes[key] = now;
    return true;
  }

  function hasChanged(key, next) {
    const prev = lastSnapshots[key];
    const changed = !deepEqual(prev, next);
    if (changed) lastSnapshots[key] = next;
    return changed;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
      return false;
    }
  }

  // Determine if changes exceed meaningful thresholds (5% default for numeric arrays)
  function significantChange(key, next, pctThreshold) {
    const prev = lastSnapshots[key];
    if (!prev) { lastSnapshots[key] = next; return true; }
    // Fast path: deep equal means no change
    if (deepEqual(prev, next)) return false;
    const threshold = typeof pctThreshold === 'number' ? pctThreshold : CONFIG.NUMERIC_THRESHOLD_PERCENT;
    // Compare arrays by element percentage change
    const compareArray = (a = [], b = []) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return true; // non-array considered significant
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i++) {
        const oldVal = Number(a[i] || 0);
        const newVal = Number(b[i] || 0);
        const base = Math.max(1, Math.abs(oldVal));
        const diffPct = Math.abs(newVal - oldVal) / base * 100;
        if (diffPct >= threshold) return true;
      }
      return false;
    };

    let isSignificant = true;
    // Switch based on shape
    if (next.labels && next.found && next.claimed && next.unclaimed) {
      // Item handling
      isSignificant = compareArray(prev.found, next.found) || compareArray(prev.claimed, next.claimed) || compareArray(prev.unclaimed, next.unclaimed);
    } else if (next.labels && next.trend) {
      isSignificant = compareArray(prev.trend, next.trend);
    } else if (typeof next.occupied === 'number' && typeof next.available === 'number') {
      isSignificant = Math.abs((next.occupied || 0) - (prev.occupied || 0)) >= 1 || Math.abs((next.available || 0) - (prev.available || 0)) >= 1;
    } else if (next.labels && next.counts) {
      isSignificant = compareArray(prev.counts, next.counts);
    } else if (next.labels && next.requests && next.approvals) {
      isSignificant = compareArray(prev.requests, next.requests) || compareArray(prev.approvals, next.approvals);
    }

    if (isSignificant) lastSnapshots[key] = next;
    return isSignificant;
  }

  // Debounce queue to batch frequent SSE updates and honor minimum interval
  const _dq = { q: [], timer: null, lastRun: 0 };
  function enqueueUpdate(key, fn, priority = 0) {
    _dq.q.push({ key, fn, priority, ts: Date.now() });
    _dq.q.sort((a, b) => b.priority - a.priority || a.ts - b.ts);
    scheduleDQ();
  }
  function scheduleDQ() {
    if (_dq.timer) return;
    const now = Date.now();
    const elapsed = now - _dq.lastRun;
    const wait = Math.max(0, CONFIG.MIN_UPDATE_INTERVAL_MS - elapsed);
    _dq.timer = setTimeout(() => {
      _dq.timer = null;
      processDQ();
    }, wait);
  }
  function processDQ() {
    _dq.lastRun = Date.now();
    const batch = _dq.q.splice(0, _dq.q.length);
    batch.forEach(it => { try { it.fn(); } catch (e) { console.error('Update queue task failed', e); } });
    if (_dq.q.length) scheduleDQ();
  }

  // Basic retry with backoff used by fetch and SSE reconnects
  async function retryWithBackoff(fn, maxAttempts, startMs) {
    let attempt = 0;
    let delay = startMs || 1000;
    let lastErr;
    while (attempt < (maxAttempts || 3)) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        attempt++;
        if (attempt >= (maxAttempts || 3)) throw lastErr;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  // SSE connection helper
  function connectSSE(url, onMessage) {
    let closed = false;
    let es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        onMessage(payload);
      } catch (e) {
        if (DEV_MODE) console.warn('SSE parse failed', e);
      }
    };
    es.onerror = () => {
      if (DEV_MODE) console.warn('SSE error, reconnecting…');
      try { es.close(); } catch (_) {}
      if (closed) return;
      // Attempt reconnection with backoff using setTimeout chain
      let attempts = 0; let delay = CONFIG.BACKOFF_MS_START;
      const reconnect = () => {
        if (closed || attempts >= CONFIG.MAX_RETRY_ATTEMPTS) return;
        attempts++;
        try {
          es = new EventSource(url);
          es.onmessage = (ev) => {
            try { onMessage(JSON.parse(ev.data)); } catch (e) { if (DEV_MODE) console.warn('SSE parse failed', e); }
          };
          es.onerror = () => { try { es.close(); } catch (_) {} setTimeout(reconnect, delay); delay *= 2; };
        } catch (_) {
          setTimeout(reconnect, delay); delay *= 2;
        }
      };
      setTimeout(reconnect, delay);
    };
    return { close: () => { closed = true; try { es.close(); } catch (_) {} } };
  }

  function wrapText(doc, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach(w => {
      const test = current ? current + ' ' + w : w;
      if (doc.getTextWidth(test) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = w;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function showExportOverlay(message) {
    const overlay = document.getElementById('exportOverlay');
    if (!overlay) return;
    const textEl = overlay.querySelector('.text');
    if (textEl) textEl.textContent = message || 'Generating…';
    overlay.classList.add('show');
  }

  function hideExportOverlay() {
    const overlay = document.getElementById('exportOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
  }
})();
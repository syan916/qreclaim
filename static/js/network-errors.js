// Global network error monitor: intercept fetch failures and show a friendly UI overlay
(function(){
  const ORIGIN = window.location.origin;
  const LOG_ENDPOINT = '/api/log-network-error';
  const STATE = { logging: false };

  function createOverlay(){
    const ov = document.createElement('div');
    ov.className = 'network-error-overlay';
    ov.innerHTML = `
      <div class="overlay-card" role="dialog" aria-modal="true">
        <div class="overlay-header">
          <i class="fas fa-wifi"></i>
          <span>Network Issue Detected</span>
        </div>
        <div class="overlay-body">
          <p id="overlayMessage">A network error occurred while contacting the server.</p>
          <ul class="overlay-tips">
            <li>Check your Wi‑Fi or mobile data connection</li>
            <li>Try reloading this page</li>
            <li>Disable VPN or proxy temporarily</li>
            <li>If on campus network, ensure DNS is reachable</li>
            <li>Try a different browser if problem persists</li>
          </ul>
        </div>
        <div class="overlay-actions">
          <button class="btn retry" id="overlayRetry">Retry</button>
          <a class="btn support" id="overlaySupport" href="mailto:support@qreclaim.example?subject=Network%20Issue">Contact Support</a>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#overlayRetry').addEventListener('click', function(){ hideOverlay(); tryReload(); });
    return ov;
  }

  function showOverlay(message){
    try{
      window.__networkOverlay = window.__networkOverlay || createOverlay();
      const msgEl = window.__networkOverlay.querySelector('#overlayMessage');
      if (msgEl) msgEl.textContent = message || 'A network error occurred while contacting the server.';
      window.__networkOverlay.classList.add('show');
    }catch(e){ /* swallow */ }
  }
  function hideOverlay(){ try{ window.__networkOverlay?.classList.remove('show'); }catch(e){} }
  function tryReload(){ try{ window.location.reload(); }catch(e){} }

  function isSameOrigin(url){ try{ return String(url).startsWith(ORIGIN) || String(url).startsWith('/') || !String(url).startsWith('http'); }catch(_){ return false; } }
  function isApiPath(url){ const u = String(url); return u.includes('/api/'); }
  function isLoggingEndpoint(url){ return String(url).includes(LOG_ENDPOINT); }

  function logClientFailure(payload){
    try{
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      navigator.sendBeacon(LOG_ENDPOINT, blob);
    }catch(e){ /* avoid loops */ }
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const sameOrigin = isSameOrigin(url);
    const apiCall = isApiPath(url);
    const shouldMonitor = sameOrigin && apiCall && !isLoggingEndpoint(url);
    if (!shouldMonitor) return origFetch(input, init);

    const controller = new AbortController();
    const timeout = setTimeout(()=> controller.abort(), (init && init.timeoutMs) || 15000);
    const signal = init && init.signal ? init.signal : controller.signal;
    const merged = Object.assign({}, init, { signal });

    return origFetch(input, merged).then(function(res){
      clearTimeout(timeout);
      if (res.status >= 500 || res.status === 429 || res.status === 408) {
        const code = res.status;
        const message = code === 500 ? 'Server error' : (code === 408 ? 'Request timeout' : 'Service unavailable');
        showOverlay(`Network error (${code}): ${message}.`);
        logClientFailure({ code, message, path: url, method: (merged && merged.method) || 'GET' });
      } else if (res.status === 401) {
        showOverlay('Your session has expired. Please log in again.');
        logClientFailure({ code: 401, message: 'Session expired', path: url, method: (merged && merged.method) || 'GET' });
        setTimeout(()=>{ window.location.href = '/login'; }, 1500);
      }
      return res;
    }).catch(function(err){
      clearTimeout(timeout);
      const isAbort = err && (err.name === 'AbortError');
      const code = isAbort ? 408 : 0;
      const message = isAbort ? 'Request timeout' : 'Network failure (DNS/connection)';
      showOverlay(`${message}.`);
      logClientFailure({ code, message, path: url, method: (merged && merged.method) || 'GET' });
      throw err;
    });
  };
})();

document.addEventListener('DOMContentLoaded', function() {
  const piHostInput = document.getElementById('piHost');
  const wsPathInput = document.getElementById('wsPath');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const connStatus = document.getElementById('connStatus');
  const studentSelect = document.getElementById('studentSelect');
  const userIdEl = document.getElementById('userId');
  const nameEl = document.getElementById('name');
  const courseEl = document.getElementById('course');
  const emailEl = document.getElementById('email');
  const scanBtn = document.getElementById('scanBtn');
  const readBtn = document.getElementById('readBtn');
  const writeBtn = document.getElementById('writeBtn');
  const cardUidEl = document.getElementById('cardUid');
  const cardPayloadEl = document.getElementById('cardPayload');
  const rfidAlert = document.getElementById('rfidAlert');
  const logEl = document.getElementById('log');

  let ws = null;
  let isConnected = false;

  function saveConfig() {
    localStorage.setItem('rfid.piHost', piHostInput.value || 'http://localhost:5001');
    localStorage.setItem('rfid.wsPath', wsPathInput.value || '/rfid');
  }

  function loadConfig() {
    const host = localStorage.getItem('rfid.piHost') || 'http://localhost:5001';
    const path = localStorage.getItem('rfid.wsPath') || '/rfid';
    piHostInput.value = host;
    wsPathInput.value = path;
  }

  function toWsUrl(httpUrl, path) {
    const u = new URL(httpUrl);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.protocol = proto;
    const p = path.startsWith('/') ? path : '/' + path;
    u.pathname = p;
    return u.toString();
  }

  function setStatus(connected) {
    isConnected = connected;
    connStatus.textContent = connected ? 'Connected' : 'Disconnected';
    connStatus.classList.toggle('connected', connected);
    connStatus.classList.toggle('disconnected', !connected);
  }

  function log(msg) {
    const t = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.textContent = '[' + t + '] ' + msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showAlert(text, type = 'error') {
    if (!text) { rfidAlert.hidden = true; rfidAlert.textContent = ''; return; }
    rfidAlert.hidden = false;
    rfidAlert.textContent = text;
    try {
      if (type === 'success') adminMsgBox.showSuccess(text);
      else if (type === 'info') adminMsgBox.showInfo(text);
      else if (type === 'warning') adminMsgBox.showWarning(text);
      else adminMsgBox.showError(text);
    } catch (_) {}
  }

  async function restScan() {
    const host = piHostInput.value || 'http://localhost:5001';
    try {
      const res = await fetch(host + '/api/rfid/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeout: 1 }) });
      const data = await res.json();
      return data;
    } catch (e) {
      return { success: false, error: 'REST scan failed' };
    }
  }

  async function restRead() {
    const host = piHostInput.value || 'http://localhost:5001';
    try {
      const res = await fetch(host + '/api/rfid/read', { method: 'POST' });
      const data = await res.json();
      return data;
    } catch (e) {
      return { success: false, error: 'REST read failed' };
    }
  }

  async function restWrite(payload) {
    const host = piHostInput.value || 'http://localhost:5001';
    try {
      const res = await fetch(host + '/api/rfid/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      return data;
    } catch (e) {
      return { success: false, error: 'REST write failed' };
    }
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  connectBtn.addEventListener('click', function() {
    saveConfig();
    try {
      const url = toWsUrl(piHostInput.value || 'http://localhost:5001', wsPathInput.value || '/rfid');
      ws = new WebSocket(url);
      ws.onopen = function() { setStatus(true); log('WebSocket connected'); };
      ws.onclose = function() { setStatus(false); log('WebSocket closed'); };
      ws.onerror = function() { setStatus(false); log('WebSocket error'); };
      ws.onmessage = function(ev) {
        try {
          const data = JSON.parse(ev.data);
          if (data.uid) { cardUidEl.value = data.uid; log('UID ' + data.uid); }
          if (data.payload) { cardPayloadEl.value = JSON.stringify(data.payload); }
          if (data.success === false && data.error) { showAlert(data.error); }
        } catch (_) {
          log('Invalid message');
        }
      };
    } catch (e) {
      setStatus(false);
      log('Connection failed');
    }
  });

  disconnectBtn.addEventListener('click', function() {
    if (ws) { try { ws.close(); } catch (_) {} }
    setStatus(false);
  });

  studentSelect.addEventListener('change', function() {
    const opt = studentSelect.selectedOptions[0];
    if (!opt || !opt.value) { userIdEl.value = ''; nameEl.value=''; courseEl.value=''; emailEl.value=''; return; }
    userIdEl.value = opt.value;
    nameEl.value = opt.getAttribute('data-name') || '';
    courseEl.value = opt.getAttribute('data-course') || '';
    emailEl.value = opt.getAttribute('data-email') || '';
  });

  scanBtn.addEventListener('click', async function() {
    showAlert('');
    if (wsSend({ action: 'scan' })) { log('Scan requested'); return; }
    const r = await restScan();
    if (r.success && r.uid) { cardUidEl.value = r.uid; log('UID ' + r.uid); showAlert('Card detected', 'success'); } else { showAlert(r.error || 'Scan failed', 'error'); }
  });

  readBtn.addEventListener('click', async function() {
    showAlert('');
    if (wsSend({ action: 'read' })) { log('Read requested'); return; }
    const r = await restRead();
    if (r.success) {
      if (r.uid) cardUidEl.value = r.uid;
      if (r.payload) cardPayloadEl.value = JSON.stringify(r.payload);
      log('Card read');
      showAlert('Card read successfully', 'success');
    } else {
      showAlert(r.error || 'Read failed', 'error');
    }
  });

  writeBtn.addEventListener('click', async function() {
    showAlert('');
    const payload = { userid: userIdEl.value, name: nameEl.value, course: courseEl.value, email: emailEl.value };
    if (!payload.userid || !payload.name || !payload.email) { showAlert('Select a student'); return; }
    if (wsSend({ action: 'write', payload })) { log('Write requested'); return; }
    const r = await restWrite(payload);
    if (r.success) { log('Card written'); showAlert('Card written successfully', 'success'); } else { showAlert(r.error || 'Write failed', 'error'); }
  });

  loadConfig();
  setStatus(false);
});
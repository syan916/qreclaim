document.addEventListener('DOMContentLoaded', function() {
  const studentSelect = document.getElementById('studentSelect');
  const courseEl = document.getElementById('course');
  const emailEl = document.getElementById('email');
  const currentRfidIdEl = document.getElementById('currentRfidId');
  const contactNumberEl = document.getElementById('contactNumber');
  const writeBtn = document.getElementById('writeBtn');
  const rfidDataListEl = document.getElementById('rfidDataList');
  const rfidAlert = document.getElementById('rfidAlert');
  const logEl = document.getElementById('log');

  function selectedUserId() { return studentSelect && studentSelect.value ? studentSelect.value : ''; }

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

  // No hardware parsing needed; hex values are used directly as rfid_id

  async function loadRfidDataList() {
    try {
      const res = await fetch('/static/data/rfid-cards.json');
      const list = await res.json();
      renderRfidOptions(Array.isArray(list) ? list : []);
      log('RFID data list loaded');
    } catch (_) {
      const fallback = [];
      renderRfidOptions(fallback);
      log('Failed to load RFID data list');
    }
  }

  function renderRfidOptions(list) {
    if (!rfidDataListEl) return;
    rfidDataListEl.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select RFID data...';
    rfidDataListEl.appendChild(ph);
    list.forEach(hex => {
      const opt = document.createElement('option');
      opt.value = hex;
      opt.textContent = hex;
      rfidDataListEl.appendChild(opt);
    });
  }

  studentSelect.addEventListener('change', function() {
    const opt = studentSelect.selectedOptions[0];
    if (!opt || !opt.value) { courseEl.value=''; emailEl.value=''; currentRfidIdEl.value=''; contactNumberEl.value=''; return; }
    courseEl.value = opt.getAttribute('data-course') || '';
    emailEl.value = opt.getAttribute('data-email') || '';
    currentRfidIdEl.value = opt.getAttribute('data-rfid') || '';
    contactNumberEl.value = opt.getAttribute('data-contact') || '';
  });

  writeBtn.addEventListener('click', async function() {
    showAlert('');
    const userId = selectedUserId();
    const hex = rfidDataListEl ? rfidDataListEl.value : '';
    if (!userId) { showAlert('Select a student'); return; }
    if (!hex) { showAlert('Select RFID data'); return; }
    if ((currentRfidIdEl && currentRfidIdEl.value) && currentRfidIdEl.value === hex) { showAlert('This RFID is already set for the selected user', 'warning'); return; }
    const proceedWrite = await confirmDialog({ title:'Write RFID', message:'Confirm to write the selected RFID to this user?', confirmText:'Write', cancelText:'Cancel', type:'info' });
    if (!proceedWrite) { showAlert('Operation cancelled', 'warning'); return; }
    try {
      let res = await fetch('/admin/api/register-rfid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, rfid_id: hex, force: false }) });
      let data = await res.json();
      if (res.ok && data && data.success) {
        showAlert('RFID registered to user', 'success');
        log('RFID assigned to user ' + userId);
        currentRfidIdEl.value = hex;
        return;
      }
      if (res.status === 409) {
        const assignedTo = (data && data.assigned_to) ? String(data.assigned_to) : 'another user';
        const proceed = await confirmDialog({ title:'Reassign RFID', message:'Warning: This RFID is already assigned to '+assignedTo+'. Reassign it to the selected user?', confirmText:'Reassign', cancelText:'Cancel', type:'warning' });
        if (!proceed) { showAlert('Operation cancelled', 'warning'); return; }
        res = await fetch('/admin/api/register-rfid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, rfid_id: hex, force: true }) });
        data = await res.json();
        if (res.ok && data && data.success) {
          showAlert('RFID reassigned', 'success');
          log('RFID reassigned to user ' + userId);
          currentRfidIdEl.value = hex;
        } else {
          showAlert((data && data.error) || 'Reassign failed');
        }
        return;
      }
      showAlert((data && data.error) || 'Register failed');
    } catch (_) {
      showAlert('Register failed');
    }
  });

  loadRfidDataList();
  if (studentSelect && studentSelect.value) {
    studentSelect.dispatchEvent(new Event('change'));
  }
});
  function confirmDialog(opts){
    const { title='Confirm Action', message='', confirmText='Confirm', cancelText='Cancel', type='info' } = opts||{};
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'confirmation-modal';
      const headerStyle = type==='warning' ? 'background: linear-gradient(135deg, #ffc107, #ff8f00);' : (type==='info' ? 'background: linear-gradient(135deg, #3498db, #2980b9);' : 'background: linear-gradient(135deg, #6c757d, #495057);');
      const iconClass = type==='warning' ? 'fas fa-exclamation-triangle' : (type==='info' ? 'fas fa-info-circle' : 'fas fa-question-circle');
      modal.innerHTML = `
        <div class="confirmation-modal-content">
          <div class="confirmation-header" style="${headerStyle}">
            <i class="${iconClass}" aria-hidden="true"></i>
            <span>${title}</span>
          </div>
          <div class="confirmation-body">
            <p>${message}</p>
          </div>
          <div class="confirmation-actions">
            <button type="button" class="btn confirm">${confirmText}</button>
            <button type="button" class="btn cancel">${cancelText}</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      requestAnimationFrame(()=> modal.classList.add('show'));
      const cleanup = (val)=>{ modal.classList.remove('show'); setTimeout(()=>{ modal.remove(); resolve(val); },150); };
      modal.querySelector('.btn.confirm').addEventListener('click', ()=> cleanup(true));
      modal.querySelector('.btn.cancel').addEventListener('click', ()=> cleanup(false));
      modal.addEventListener('click', (e)=>{ if(e.target===modal) cleanup(false); });
    });
  }

document.addEventListener('DOMContentLoaded', async () => {
  const themeSel = document.getElementById('theme');
  const notifEmail = document.getElementById('notifEmail');
  const notifSMS = document.getElementById('notifSMS');
  const twoFactor = document.getElementById('twoFactor');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const msg = document.getElementById('settingsMessage');

  function show(text, type='success') {
    msg.innerHTML = `<div class="alert alert-${type === 'success' ? 'success' : 'danger'}" role="alert">${text}</div>`;
    setTimeout(() => { msg.innerHTML = ''; }, 3000);
  }

  async function load() {
    try {
      const res = await fetch('/user/api/user/settings');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
      const s = data.settings || {};
      themeSel.value = s.theme || 'system';
      const n = s.notifications || {};
      notifEmail.checked = !!n.email;
      notifSMS.checked = !!n.sms;
      const sec = s.security || {};
      twoFactor.checked = !!sec.two_factor_enabled;
    } catch (err) {
      show(err.message || 'Load error', 'error');
    }
  }

  saveBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const payload = {
      preferences: {
        theme: themeSel.value,
        notifications: { email: notifEmail.checked, sms: notifSMS.checked },
        security: { two_factor_enabled: twoFactor.checked }
      }
    };
    try {
      const res = await fetch('/user/api/user/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      show('Settings saved');
    } catch (err) {
      show(err.message || 'Save error', 'error');
    }
  });

  load();
});
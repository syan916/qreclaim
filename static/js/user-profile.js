document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('profileInput');
  const preview = document.getElementById('profilePreview');
  const uploadBtn = document.getElementById('uploadBtn');
  const saveBtn = document.getElementById('saveProfileBtn');
  const msg = document.getElementById('profileMessage');

  function show(text, type='success') {
    msg.innerHTML = `<div class="alert alert-${type === 'success' ? 'success' : 'danger'}" role="alert">${text}</div>`;
    setTimeout(() => { msg.innerHTML = ''; }, 3000);
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  uploadBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const file = input?.files?.[0];
    if (!file) return show('Please choose an image', 'error');
    if (file.size > 2 * 1024 * 1024) return show('Image exceeds 2MB', 'error');
    try {
      const b64 = await toBase64(file);
      preview.src = b64;
      const res = await fetch('/user/api/user/profile/picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64 })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
      show('Profile picture updated');
    } catch (err) {
      show(err.message || 'Upload error', 'error');
    }
  });

  saveBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('name')?.value || '',
      email: document.getElementById('email')?.value || '',
      phone: document.getElementById('phone')?.value || '',
      department: document.getElementById('department')?.value || ''
    };
    try {
      const res = await fetch('/user/api/user/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      show('Profile saved');
    } catch (err) {
      show(err.message || 'Save error', 'error');
    }
  });
});
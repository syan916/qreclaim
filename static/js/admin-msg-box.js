// Admin Message Box Utility - exposes adminMsgBox
class AdminMsgBox {
  constructor() {
    this.container = null;
    this.active = new Set();
    this.init();
  }
  init() {
    if (!document.getElementById('admin-msg-container')) {
      const c = document.createElement('div');
      c.id = 'admin-msg-container';
      c.style.cssText = 'position:fixed;top:0;right:0;z-index:10000;pointer-events:none;';
      document.body.appendChild(c);
      this.container = c;
    } else {
      this.container = document.getElementById('admin-msg-container');
    }
  }
  showSuccess(message, title = 'Success', duration = 5000) { return this.show(message, 'success', title, duration); }
  showError(message, title = 'Error', duration = 7000) { return this.show(message, 'error', title, duration); }
  showWarning(message, title = 'Warning', duration = 6000) { return this.show(message, 'warning', title, duration); }
  showInfo(message, title = 'Info', duration = 5000) { return this.show(message, 'info', title, duration); }
  show(message, type = 'info', title = '', duration = 5000) {
    const id = this._id();
    const el = this._create(id, message, type, title);
    this.container.appendChild(el);
    this.active.add(id);
    setTimeout(() => el.classList.add('show'), 10);
    if (duration > 0) setTimeout(() => this.hide(id), duration);
    return id;
  }
  hide(id) {
    const el = document.getElementById('admin-msg-' + id);
    if (el && this.active.has(id)) {
      el.classList.add('fade-out');
      setTimeout(() => { el.remove(); this.active.delete(id); }, 300);
    }
  }
  hideAll() { Array.from(this.active).forEach(id => this.hide(id)); }
  _create(id, message, type, title) {
    const el = document.createElement('div');
    el.id = 'admin-msg-' + id;
    el.className = 'admin-msg-box ' + type;
    el.style.pointerEvents = 'auto';
    const waveSvg = `
      <svg class="admin-msg-wave" viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,256L11.4,240C22.9,224,46,192,69,192C91.4,192,114,224,137,234.7C160,245,183,235,206,213.3C228.6,192,251,160,274,149.3C297.1,139,320,149,343,181.3C365.7,213,389,267,411,282.7C434.3,299,457,277,480,250.7C502.9,224,526,192,549,181.3C571.4,171,594,181,617,208C640,235,663,277,686,256C708.6,235,731,149,754,122.7C777.1,96,800,128,823,165.3C845.7,203,869,245,891,224C914.3,203,937,117,960,112C982.9,107,1006,181,1029,197.3C1051.4,213,1074,171,1097,144C1120,117,1143,107,1166,133.3C1188.6,160,1211,224,1234,218.7C1257.1,213,1280,139,1303,133.3C1325.7,128,1349,192,1371,192C1394.3,192,1417,128,1429,96L1440,64L1440,320L1428.6,320C1417.1,320,1394,320,1371,320C1348.6,320,1326,320,1303,320C1280,320,1257,320,1234,320C1211.4,320,1189,320,1166,320C1142.9,320,1120,320,1097,320C1074.3,320,1051,320,1029,320C1005.7,320,983,320,960,320C937.1,320,914,320,891,320C868.6,320,846,320,823,320C800,320,777,320,754,320C731.4,320,709,320,686,320C662.9,320,640,320,617,320C594.3,320,571,320,549,320C525.7,320,503,320,480,320C457.1,320,434,320,411,320C388.6,320,366,320,343,320C320,320,297,320,274,320C251.4,320,229,320,206,320C182.9,320,160,320,137,320C114.3,320,91,320,69,320C45.7,320,23,320,11,320L0,320Z" fill-opacity="1"></path>
      </svg>`;
    el.innerHTML = `${waveSvg}
      <div class="admin-msg-box-icon">${this._icon(type)}</div>
      <div class="admin-msg-box-content">
        ${title ? `<div class="admin-msg-box-title">${this._esc(title)}</div>` : ''}
        <div class="admin-msg-box-text">${this._esc(message)}</div>
      </div>
      <button class="admin-msg-box-close" aria-label="Close" onclick="adminMsgBox.hide('${id}')">×</button>
    `;
    return el;
  }
  _icon(type) {
    const m = {
      success: '<i class="fas fa-check-circle"></i>',
      error: '<i class="fas fa-exclamation-circle"></i>',
      warning: '<i class="fas fa-exclamation-triangle"></i>',
      info: '<i class="fas fa-info-circle"></i>'
    };
    return m[type] || m.info;
  }
  _id() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  _esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}
window.adminMsgBox = new AdminMsgBox();
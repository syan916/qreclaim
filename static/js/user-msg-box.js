// User Message Box Utility - exposes userMsgBox
class UserMsgBox {
  constructor(){ this.container=null; this.active=new Set(); this.init(); }
  init(){ if(!document.getElementById('user-msg-container')){ const c=document.createElement('div'); c.id='user-msg-container'; c.style.cssText='position:fixed;top:0;right:0;z-index:10000;pointer-events:none;'; document.body.appendChild(c); this.container=c; } else { this.container=document.getElementById('user-msg-container'); } }
  showSuccess(m,t='Success',d=5000){ return this.show(m,'success',t,d); }
  showError(m,t='Error',d=7000){ return this.show(m,'error',t,d); }
  showWarning(m,t='Warning',d=6000){ return this.show(m,'warning',t,d); }
  showInfo(m,t='Info',d=5000){ return this.show(m,'info',t,d); }
  show(m,type='info',t='',d=5000){ const id=this._id(); const el=this._create(id,m,type,t); this.container.appendChild(el); this.active.add(id); setTimeout(()=>el.classList.add('show'),10); if(d>0) setTimeout(()=>this.hide(id),d); return id; }
  hide(id){ const el=document.getElementById('user-msg-'+id); if(el&&this.active.has(id)){ el.classList.add('fade-out'); setTimeout(()=>{ el.remove(); this.active.delete(id); },300); } }
  hideAll(){ Array.from(this.active).forEach(id=>this.hide(id)); }
  _create(id,m,type,t){ const el=document.createElement('div'); el.id='user-msg-'+id; el.className='user-msg-box '+type; el.style.pointerEvents='auto'; el.innerHTML=`<div class="user-msg-box-icon">${this._icon(type)}</div><div class="user-msg-box-content">${t?`<div class="user-msg-box-title">${this._esc(t)}</div>`:''}<div class="user-msg-box-text">${this._esc(m)}</div></div><button class="user-msg-box-close" aria-label="Close" onclick="userMsgBox.hide('${id}')">×</button>`; return el; }
  _icon(type){ const m={success:'✔️',error:'❌',warning:'⚠️',info:'ℹ️'}; return m[type]||m.info; }
  _id(){ return Date.now().toString(36)+Math.random().toString(36).slice(2); }
  _esc(t){ const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }
}
window.userMsgBox=new UserMsgBox();
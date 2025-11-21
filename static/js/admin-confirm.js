window.adminConfirm=(message,{title='Please Confirm',type='info',okText='OK',cancelText='Cancel'}={})=>{
  return new Promise((resolve)=>{
    let overlay=document.getElementById('admin-confirm-overlay');
    if(!overlay){overlay=document.createElement('div');overlay.id='admin-confirm-overlay';overlay.className='admin-confirm-overlay';document.body.appendChild(overlay);} 
    overlay.innerHTML=`<div class="admin-confirm-modal"><div class="admin-confirm-header"><div class="admin-confirm-icon ${type}">${type==='warning'?'⚠️':type==='error'?'❌':'ℹ️'}</div><div class="admin-confirm-title">${title}</div></div><div class="admin-confirm-body">${message}</div><div class="admin-confirm-actions"><button class="admin-btn cancel" id="adminConfirmCancel">${cancelText}</button><button class="admin-btn primary" id="adminConfirmOk">${okText}</button></div></div>`;
    overlay.classList.add('show');
    const cleanup=(val)=>{overlay.classList.remove('show');overlay.innerHTML='';resolve(val);};
    document.getElementById('adminConfirmOk').onclick=()=>cleanup(true);
    document.getElementById('adminConfirmCancel').onclick=()=>cleanup(false);
    overlay.onclick=(e)=>{if(e.target===overlay) cleanup(false);};
  });
};
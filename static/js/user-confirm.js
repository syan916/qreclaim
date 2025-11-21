window.userConfirm=(message,{title='Confirm',type='info',okText='OK',cancelText='Cancel'}={})=>{
  return new Promise((resolve)=>{
    let overlay=document.getElementById('user-confirm-overlay');
    if(!overlay){overlay=document.createElement('div');overlay.id='user-confirm-overlay';overlay.className='user-confirm-overlay';document.body.appendChild(overlay);} 
    overlay.innerHTML=`<div class="user-confirm-modal"><div class="user-confirm-header"><div class="user-confirm-icon ${type}">${type==='success'?'✔️':type==='error'?'❌':type==='warning'?'⚠️':'ℹ️'}</div><div class="user-confirm-title">${title}</div></div><div class="user-confirm-body">${message}</div><div class="user-confirm-actions"><button class="user-btn cancel" id="userConfirmCancel">${cancelText}</button><button class="user-btn primary" id="userConfirmOk">${okText}</button></div></div>`;
    overlay.classList.add('show');
    const cleanup=(val)=>{overlay.classList.remove('show');overlay.innerHTML='';resolve(val);};
    document.getElementById('userConfirmOk').onclick=()=>cleanup(true);
    document.getElementById('userConfirmCancel').onclick=()=>cleanup(false);
    overlay.onclick=(e)=>{if(e.target===overlay) cleanup(false);};
  });
};
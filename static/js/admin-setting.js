document.addEventListener('DOMContentLoaded',()=>{
  async function callJSON(url, method='GET', body=null){ const res=await fetch(url,{method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined}); const j=await res.json(); if(!j.success) throw new Error(j.error||'Request failed'); return j; }
  async function loadJobs(){ try{ const j=await callJSON('/admin/api/scheduler/jobs'); const tb=document.querySelector('#jobsTable tbody'); tb.innerHTML=(j.jobs||[]).map(x=>`<tr><td>${x.id}</td><td>${x.name}</td><td>${x.next_run||'-'}</td><td>${x.trigger}</td></tr>`).join(''); }catch(e){ const tb=document.querySelector('#jobsTable tbody'); tb.innerHTML=`<tr><td colspan="4">Error: ${e.message}</td></tr>`; } }
  async function loadStatus(){ try{ const j=await callJSON('/admin/api/scheduler/status'); const pill=document.getElementById('schedStatus'); if(!pill) return; pill.textContent=j.running?'Running':'Stopped'; pill.classList.toggle('running', !!j.running); pill.classList.toggle('stopped', !j.running); }catch(e){ /* ignore */ } }
  document.getElementById('schedStart')?.addEventListener('click', async()=>{ try{ await callJSON('/admin/api/scheduler/start','POST'); await loadJobs(); await loadStatus(); }catch(e){ alert(e.message);} });
  document.getElementById('schedStop')?.addEventListener('click', async()=>{ try{ await callJSON('/admin/api/scheduler/stop','POST'); await loadJobs(); await loadStatus(); }catch(e){ alert(e.message);} });
  document.getElementById('runOverdue')?.addEventListener('click', async()=>{ try{ await callJSON('/admin/api/scheduler/run/overdue','POST'); }catch(e){ alert(e.message);} });
  document.getElementById('runExpired')?.addEventListener('click', async()=>{ try{ await callJSON('/admin/api/scheduler/run/expired','POST'); }catch(e){ alert(e.message);} });
  document.getElementById('saveExpiredInterval')?.addEventListener('click', async()=>{ const m=parseInt(document.getElementById('expiredMinutes').value||'1',10); try{ await callJSON('/admin/api/scheduler/expired-interval','POST',{minutes:m}); await loadJobs(); }catch(e){ alert(e.message);} });
  document.getElementById('refreshJobs')?.addEventListener('click', ()=>{ loadJobs(); loadStatus(); });
  loadJobs();
  loadStatus();
});
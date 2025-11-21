document.addEventListener('DOMContentLoaded',()=>{
  const id = window.location.pathname.split('/').pop();
  fetch(`/admin/api/lost-item-reports/${id}`).then(r=>r.json()).then(j=>{
    if(!j.success){ throw new Error(j.error||'Failed'); }
    const d=j.lost_report||{};
    document.getElementById('detailImage').src=d.image_url||'/static/images/no-image.svg';
    document.getElementById('detailName').textContent=d.lost_item_name||'N/A';
    document.getElementById('detailId').textContent=d.lost_report_id||id;
    document.getElementById('detailStatus').textContent=d.status||'N/A';
    document.getElementById('detailCategory').textContent=d.category||'N/A';
    document.getElementById('detailLocation').textContent=d.last_seen_location||'N/A';
    document.getElementById('detailReporter').textContent=d.reporter||'N/A';
    document.getElementById('detailContact').textContent=d.contact_info||'N/A';
    const time=d.report_date?.seconds? new Date(d.report_date.seconds*1000): new Date(d.report_date);
    document.getElementById('detailTime').textContent=isNaN(time)?'N/A':time.toLocaleString();
    document.getElementById('detailDescription').textContent=d.description||'N/A';
    document.getElementById('detailTags').textContent=(d.tags||[]).join(', ')||'-';
  }).catch(e=>{ console.error(e); alert('Failed to load details'); });
});
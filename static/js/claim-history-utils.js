;(function(){
  const DATE = {
    formatFixed(v){
      try{ const d=new Date(v); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); const hh=String(d.getHours()).padStart(2,'0'); const mm=String(d.getMinutes()).padStart(2,'0'); return `${y}-${m}-${day} ${hh}:${mm}` }catch{return '—'}
    }
  }
  const TEXT = {
    truncate(s,len){ s=String(s||''); return s.length>len?`${s.slice(0,len)}…`:s }
  }
  const CLAIM = {
    isValidId(id){ return /^C\d{4}$/.test(String(id||'')) },
    formatId(id){ const digits=String(id||'').replace(/\D/g,''); return `C${digits.padStart(4,'0')}` }
  }
  const CLASSIFY = {
    statusClass(s){ return String(s||'pending').toLowerCase() },
    statusIcon(s){ const map={pending:'clock', approved:'check-circle', completed:'flag-checkered', rejected:'times-circle', expired:'hourglass-end', cancelled:'ban', pending_approval:'hourglass-half'}; return map[String(s).toLowerCase()]||'question-circle' },
    valueIcon(v){ return v? 'gem' : 'tag' },
    valueClass(v){ return v? 'valuable' : 'standard' }
  }
  const QUERY = {
    build(base,{status,sort,start,end,pageSize,cursor}){
      const url=new URL(base, window.location.origin)
      if(status && status!=='all') url.searchParams.set('status', status)
      if(sort) url.searchParams.set('sort', sort)
      if(start) url.searchParams.set('start', start)
      if(end) url.searchParams.set('end', end)
      if(pageSize) url.searchParams.set('page_size', String(pageSize))
      if(cursor) url.searchParams.set('cursor', cursor)
      return url.toString()
    }
  }
  window.ClaimUtils = { DATE, TEXT, CLAIM, CLASSIFY, QUERY }
})();
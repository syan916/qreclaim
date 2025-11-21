;(function(){
  const { useState, useEffect } = React

  function Toast({msg,type}){
    if(!msg) return null
    return React.createElement('div',{className:`message ${type||'success'}`},[
      React.createElement('i',{className:`fas fa-${type==='success'?'check':'exclamation'}-circle`}),
      React.createElement('span',{},msg)
    ])
  }

  function ConfirmModal({open,onCancel,onConfirm,preview}){
    if(!open) return null
    return React.createElement('div',{className:'modal',role:'dialog','aria-modal':'true'},
      React.createElement('div',{className:'modal-content'},[
        React.createElement('div',{className:'modal-header'},[
          React.createElement('h3',{},[React.createElement('i',{className:'fas fa-exclamation-triangle'}),' ', 'Cancel Request']),
          React.createElement('button',{className:'modal-close',onClick:onCancel},React.createElement('i',{className:'fas fa-times'}))
        ]),
        React.createElement('div',{className:'modal-body'},[
          React.createElement('p',{},'Are you sure you want to cancel this request?'),
          React.createElement('div',{className:'claim-meta'},preview||null)
        ]),
        React.createElement('div',{className:'modal-footer'},[
          React.createElement('button',{className:'btn btn-secondary',onClick:onCancel},'Cancel'),
          React.createElement('button',{className:'btn btn-danger',onClick:onConfirm},'Confirm')
        ])
      ])
    )
  }

  function Card({index,claim,onCancelRequest}){
    const u = window.ClaimUtils
    const isValuable = !!claim.is_valuable
    const status = String(claim.status).toLowerCase()
    const showCancel = status==='pending' || status==='pending_approval'
    const idFmt = u.CLAIM.formatId(claim.id)
    const validId = u.CLAIM.isValidId(idFmt)
    const meta = [
      React.createElement('span',{className:'meta-chip',title:'Claim ID',key:'id'},[React.createElement('i',{className:'fas fa-hashtag'}),' ', idFmt]),
      React.createElement('span',{className:'meta-chip',title:'Claim date',key:'dt'},[React.createElement('i',{className:'fas fa-calendar-alt'}),' ', u.DATE.formatFixed(claim.created_at)]),
      React.createElement('span',{className:`meta-chip ${isValuable?'valuable-chip':'standard-chip'}`,title:isValuable?'Valuable':'Standard',key:'val'},[React.createElement('i',{className:`fas fa-${u.CLASSIFY.valueIcon(isValuable)}`}), ' ', (isValuable?'Valuable':'Standard')])
    ]
    return React.createElement('div',{className:'claim-card',role:'group','aria-label':`Claim ${index}`},[
      React.createElement('div',{className:'claim-header'},[
        React.createElement('div',{className:'claim-index'},`${index}.`),
        React.createElement('h3',{className:'claim-title',title:claim.item_name},[React.createElement('i',{className:'fas fa-box'}),' ', u.TEXT.truncate(claim.item_name||'Unknown Item',30)]),
        React.createElement('span',{className:`claim-status ${u.CLASSIFY.statusClass(status)}`},[React.createElement('i',{className:`fas fa-${u.CLASSIFY.statusIcon(status)}`}), ' ', claim.status])
      ]),
      React.createElement('div',{className:'claim-body'},[
        React.createElement('img',{className:'claim-image',src:claim.item_image_url||'/static/images/placeholder-item.png',alt:claim.item_name||'Item',onError:e=>{e.currentTarget.src='/static/images/placeholder-item.png'}}),
        React.createElement('div',{},[
          React.createElement('div',{className:'claim-meta'},meta),
          React.createElement('div',{className:'claim-details'},[
            React.createElement('span',{className:'meta-chip',key:'appr'},[React.createElement('i',{className:'fas fa-user-check'}),' ', 'Approved by ', (claim.approved_by || (status==='pending'?'N/A':'—'))])
          ])
        ])
      ]),
      React.createElement('div',{className:'claim-footer'},[
        React.createElement('div',{className:'claim-actions'},[
          showCancel && validId ? React.createElement(
            'button',
            { className:'btn btn-danger', onClick: ()=>onCancelRequest(idFmt), key:'cancel' },
            [ React.createElement('i',{className:'fas fa-times'}), ' ', 'Cancel Request' ]
          ) : null
        ])
      ])
    ])
  }

  function Pager({hasPrev,hasNext,onPrev,onNext,page}){
    return React.createElement('div',{className:'pagination'},[
      React.createElement('button',{id:'prevPage',className:'pagination-btn',onClick:onPrev,disabled:!hasPrev},[React.createElement('i',{className:'fas fa-chevron-left'}),' Previous']),
      React.createElement('span',{id:'pageInfo',className:'page-info'},`Page ${page}`),
      React.createElement('button',{id:'nextPage',className:'pagination-btn',onClick:onNext,disabled:!hasNext},['Next ',React.createElement('i',{className:'fas fa-chevron-right'})])
    ])
  }

  function App(){
    const u = window.ClaimUtils
    const [claims,setClaims] = useState([])
    const [loading,setLoading] = useState(false)
    const [error,setError] = useState('')
    const [status,setStatus] = useState('all')
    const [sort,setSort] = useState('newest')
    const today = new Date(); const startDefault = new Date(today); startDefault.setDate(today.getDate()-6)
    const [start,setStart] = useState(startDefault.toISOString())
    const [end,setEnd] = useState(today.toISOString())
    const [cursor,setCursor] = useState(null)
    const [stack,setStack] = useState([])
    const pageSize = 10

    async function fetchClaims(cur){
      setLoading(true); setError('')
      try{
        const url = u.QUERY.build('/user/api/claims/user',{status,sort,start,end,pageSize,cursor:cur})
        const res = await fetch(url)
        const data = await res.json()
        if(!res.ok || !data.success){ throw new Error(data.error || 'Failed to load claims') }
        setClaims(Array.isArray(data.claims)?data.claims:[])
        setCursor(cur||null)
        // next cursor comes from payload
        App.nextCursor = data.pagination && data.pagination.next_cursor_id || null
      }catch(e){ setError(e.message) }
      finally{ setLoading(false) }
    }

    useEffect(()=>{ fetchClaims(null) },[])

    function applyRange(){
      try{
        const s = new Date(start).getTime(); const e = new Date(end).getTime();
        if(isNaN(s)||isNaN(e)||s>e){ setError('Invalid date range'); return }
        setStack([]); fetchClaims(null)
      }catch{ setError('Invalid date range') }
    }

    async function prev(){ if(!stack.length) return; const prev = stack.slice(0,-1); setStack(prev); await fetchClaims(prev[prev.length-1]||null) }
    async function next(){ if(!App.nextCursor) return; const ns=[...stack,cursor]; setStack(ns); await fetchClaims(App.nextCursor) }

    async function cancelRequest(id){
      if(!u.CLAIM.isValidId(id)){ setError('Invalid claim id format'); return }
      App.modalOpen = true; App.modalId = id; force()
    }
    function closeModal(){ App.modalOpen=false; App.modalId=null; force() }
    async function confirmCancel(){
      const id = App.modalId; if(!id) return
      try{
        setLoading(true); const res = await fetch(`/user/api/claims/${encodeURIComponent(id)}/cancel`,{method:'POST'})
        const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error||'Cancel failed')
        closeModal(); await fetchClaims(cursor)
      }catch(e){ setError(e.message) } finally{ setLoading(false) }
    }

    function force(){ setTick(x=>x+1) }
    const [tick,setTick] = useState(0)

    const grid = loading? React.createElement('div',{className:'loading-state'},[React.createElement('div',{className:'loading-spinner'}), React.createElement('p',{},'Loading your claims...')])
      : (claims.length? React.createElement('div',{className:'claims-grid'}, claims.map((c,i)=>React.createElement(Card,{key:c.id||i,index:(stack.length*pageSize)+i+1,claim:c,onCancelRequest:cancelRequest})))
        : React.createElement('div',{className:'empty-state'},[React.createElement('div',{className:'empty-icon'},React.createElement('i',{className:'fas fa-inbox'})), React.createElement('h3',{},'No Claims Found'), React.createElement('p',{},"You don't have any claim yet. Start by browsing found items!")]))

    const controls = React.createElement('div',{className:'controls-row d-flex flex-wrap gap-3 align-items-center justify-content-between'},[
      React.createElement('div',{className:'filter-controls d-flex flex-wrap gap-3',"aria-label":"Claim filters"},[
        React.createElement('div',{className:'filter-group'},[
          React.createElement('label',{htmlFor:'statusFilter',className:'form-label mb-0'},'Status'),
          React.createElement('select',{id:'statusFilter',className:'form-select form-select-sm',value:status,onChange:e=>setStatus(e.target.value)},[
            'all','pending','pending_approval','approved','completed','rejected','expired','cancelled'
          ].map(v=>React.createElement('option',{key:v,value:v}, v.charAt(0).toUpperCase()+v.slice(1))) )
        ]),
        React.createElement('div',{className:'filter-group'},[
          React.createElement('label',{htmlFor:'sortOrder',className:'form-label mb-0'},'Sort'),
          React.createElement('select',{id:'sortOrder',className:'form-select form-select-sm',value:sort,onChange:e=>setSort(e.target.value)},[
            React.createElement('option',{value:'newest'},'Newest First'),
            React.createElement('option',{value:'oldest'},'Oldest First')
          ])
        ]),
        React.createElement('div',{className:'filter-group'},[
          React.createElement('label',{className:'form-label mb-0'},'Date Range'),
          React.createElement('div',{className:'d-flex align-items-center gap-2'},[
            React.createElement('input',{type:'date',className:'form-control form-control-sm',value:new Date(start).toISOString().slice(0,10),onChange:e=>setStart(new Date(`${e.target.value}T00:00:00Z`).toISOString())}),
            React.createElement('span',{className:'text-muted'},'to'),
            React.createElement('input',{type:'date',className:'form-control form-control-sm',value:new Date(end).toISOString().slice(0,10),onChange:e=>setEnd(new Date(`${e.target.value}T23:59:59Z`).toISOString())}),
            React.createElement('button',{className:'btn btn-primary btn-sm',onClick:applyRange},[React.createElement('i',{className:'fas fa-filter'}),' Apply'])
          ])
        ])
      ])
    ])

    return React.createElement(React.Fragment,{},[
      controls,
      grid,
      React.createElement(Pager,{hasPrev: stack.length>0, hasNext: !!App.nextCursor, onPrev: prev, onNext: next, page: stack.length+1}),
      React.createElement('div',{id:'messageContainer',className:'message-container'}, React.createElement(Toast,{msg:error,type:'error'})),
      React.createElement(ConfirmModal,{open: !!App.modalOpen, onCancel: closeModal, onConfirm: confirmCancel, preview: App.modalId? React.createElement('div',{},[`ID: ${App.modalId}`]) : null})
    ])
  }

  document.addEventListener('DOMContentLoaded', function(){
    const root = document.getElementById('claimsGrid')
    if(root){ ReactDOM.createRoot(root).render(React.createElement(App)) }
  })
})();
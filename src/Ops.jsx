import { useState } from 'react'
// ── Demo operations module (localStorage only; no real purchasing/payment) ──
export const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}, SET=(k,v)=>localStorage.setItem(k,JSON.stringify(v))
const uid=p=>p+'-'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase()
const now=()=>new Date().toISOString()
export const fmt=t=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})
export function audit(user,action,detail){SET('md_audit',[{id:uid('A'),ts:now(),user:user?.name||'system',role:user?.role||'',action,detail},...LS('md_audit',[])])}
export function csv(name,rows){if(!rows.length)return;const cols=Object.keys(rows[0]);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`
 const blob=new Blob([[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
const SEED_INV=[
 {id:'INV-1',name:'pH-neutral car shampoo',type:'Chemical',qty:3,unit:'gal',min:4,location:'Van stock'},
 {id:'INV-2',name:'Ceramic spray sealant',type:'Chemical',qty:6,unit:'bottle',min:4,location:'Van stock'},
 {id:'INV-3',name:'Iron decon remover',type:'Chemical',qty:1,unit:'gal',min:2,location:'Van stock'},
 {id:'INV-4',name:'Microfiber towels 16"',type:'Supply',qty:40,unit:'each',min:60,location:'Van stock'},
 {id:'INV-5',name:'Clay bars',type:'Supply',qty:12,unit:'each',min:6,location:'Van stock'},
 {id:'INV-6',name:'Interior detailer',type:'Chemical',qty:5,unit:'bottle',min:3,location:'Van stock'},
 {id:'INV-7',name:'Tire dressing',type:'Chemical',qty:2,unit:'gal',min:2,location:'Van stock'},
]
const SEED_SHOP=[
 {id:'SH-1',name:'Dual-action polisher (15mm)',cat:'Tool',par:3,onHand:3,location:'Bay 1 · Cage',condition:'good'},
 {id:'SH-2',name:'Pressure washer 1.8 GPM',cat:'Tool',par:2,onHand:2,location:'Bay 2',condition:'good'},
 {id:'SH-3',name:'Wet/dry vac',cat:'Tool',par:2,onHand:2,location:'Bay 2',condition:'worn'},
 {id:'SH-4',name:'Steam cleaner',cat:'Tool',par:1,onHand:1,location:'Bay 1',condition:'good'},
 {id:'SH-5',name:'Foam cannon',cat:'Tool',par:4,onHand:4,location:'Shelf A2',condition:'good'},
 {id:'SH-6',name:'APC concentrate (gal)',cat:'Chemical',par:4,onHand:4,location:'Chem cabinet C1',condition:'good'},
 {id:'SH-7',name:'Compound, heavy cut (qt)',cat:'Chemical',par:3,onHand:3,location:'Chem cabinet C2',condition:'good'},
 {id:'SH-8',name:'Finishing polish (qt)',cat:'Chemical',par:3,onHand:3,location:'Chem cabinet C2',condition:'good'},
 {id:'SH-9',name:'Wiper blades 22"',cat:'Part',par:10,onHand:10,location:'Bin P1',condition:'good'},
 {id:'SH-10',name:'Wiper blades 26"',cat:'Part',par:10,onHand:10,location:'Bin P1',condition:'good'},
 {id:'SH-11',name:'Foam buffing pads 5" (cut)',cat:'Part',par:24,onHand:24,location:'Shelf B1',condition:'good'},
 {id:'SH-12',name:'Foam buffing pads 5" (finish)',cat:'Part',par:24,onHand:24,location:'Shelf B1',condition:'good'},
 {id:'SH-13',name:'Cabin air filters (assorted)',cat:'Part',par:15,onHand:15,location:'Bin P2',condition:'good'},
 {id:'SH-14',name:'DI water filter cartridges',cat:'Part',par:6,onHand:6,location:'Bin P3',condition:'good'},
 {id:'SH-15',name:'Pressure washer nozzle set',cat:'Part',par:4,onHand:4,location:'Bin P3',condition:'good'},
 {id:'SH-16',name:'Headlight restoration kits',cat:'Part',par:8,onHand:8,location:'Shelf A3',condition:'good'},
]
const ld=(k,seed)=>{let v=LS(k,null);if(!v){v=seed;SET(k,v)}return v}
export const getInv=()=>ld('md_inventory',SEED_INV)
const Table=({cols,rows,cls})=><div className="tbl"><table className={cls}><thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.length?rows:<tr><td colSpan={cols.length} className="muted">Nothing yet.</td></tr>}</tbody></table></div>
export const Badge=({s})=><span className={'badge b-'+String(s).toLowerCase().replace(/\s+/g,'-')}>{s}</span>
const STATUSES=['Requested','Approved','Ordered','Received','Denied'], NEXT={Requested:['Approved','Denied'],Approved:['Ordered','Denied'],Ordered:['Received'],Received:[],Denied:[]}
const LABEL={Approved:'Approve',Denied:'Deny',Ordered:'Mark ordered',Received:'Mark received'}
const TYPES=['Chemical','Supply','Part','Tool','Equipment','Other'], UNITS=['each','bottle','gal','qt','box','pack','case','set'], URG=['Low','Normal','High','Urgent']

export function Inventory({user,onReorder}){const[inv,setInv]=useState(getInv);const save=v=>{setInv(v);SET('md_inventory',v)}
 const adj=(it,d)=>{const n=Math.max(0,it.qty+d);save(inv.map(x=>x.id===it.id?{...x,qty:n}:x));audit(user,'Inventory adjusted',`${it.name}: ${it.qty} → ${n} ${it.unit}`)}
 const low=inv.filter(i=>i.qty<=i.min)
 return <><div className="toolbar"><p className="muted">{inv.length} items · <b>{low.length} low stock</b></p><button className="link" onClick={()=>csv('inventory.csv',inv)}>Export CSV</button></div>
 <Table cols={['Item','Type','On hand','Min','Location','']} rows={inv.map(i=><tr key={i.id} className={i.qty<=i.min?'lowrow':''}><td><b>{i.name}</b>{i.qty<=i.min&&<><br/><small>Low stock</small></>}</td><td>{i.type}</td><td className="nowrap"><button className="qbtn" onClick={()=>adj(i,-1)}>−</button> {i.qty} {i.unit} <button className="qbtn" onClick={()=>adj(i,1)}>+</button></td><td>{i.min}</td><td>{i.location}</td><td>{i.qty<=i.min&&<button className="pill sm" onClick={()=>onReorder(i)}>Reorder</button>}</td></tr>)}/></>}

export function OrderForm({user,prefill,onDone}){const inv=getInv()
 const blank={itemId:'',item:'',type:'Chemical',qty:1,unit:'each',supplier:'',cost:'',urgency:'Normal',note:'',date:new Date().toISOString().slice(0,10)}
 const[f,setF]=useState(()=>prefill?{...blank,itemId:prefill.id,item:prefill.name,type:prefill.type,unit:prefill.unit,qty:Math.max(1,prefill.min*2-prefill.qty),urgency:prefill.qty===0?'Urgent':'High',note:`Reorder — on hand ${prefill.qty}, min ${prefill.min}`}:blank)
 const u=(k,v)=>setF(o=>({...o,[k]:v}))
 const pick=id=>{if(id==='__new'||id==='')return setF(o=>({...o,itemId:id,item:''}));const i=inv.find(x=>x.id===id);setF(o=>({...o,itemId:id,item:i.name,type:i.type,unit:i.unit}))}
 const submit=e=>{e.preventDefault();if(!f.item||f.qty<1)return;const o={id:uid('PO'),...f,qty:Number(f.qty),cost:f.cost===''?'':Number(f.cost),itemId:f.itemId==='__new'?'':f.itemId,requestedBy:user.name,requestedRole:user.role,created:now(),status:'Requested',history:[{status:'Requested',by:user.name,ts:now()}]}
  SET('md_orders',[o,...LS('md_orders',[])]);audit(user,'Order requested',`${o.id}: ${o.qty} ${o.unit} ${o.item} (${o.urgency})`);setF(blank);onDone?.(o)}
 const isNew=f.itemId==='__new'||f.itemId===''
 return <form className="panel opsform" onSubmit={submit}><h3>{prefill?'Reorder low-stock item':'Request supplies'}</h3>
  <div className="two"><label>Item<select value={f.itemId} onChange={e=>pick(e.target.value)}><option value="">Choose from inventory…</option>{inv.map(i=><option key={i.id} value={i.id}>{i.name} ({i.qty} {i.unit})</option>)}<option value="__new">+ New item…</option></select></label>
  {isNew&&<label>New item name<input value={f.item} onChange={e=>u('item',e.target.value)} placeholder="e.g. Leather conditioner"/></label>}
  <label>Type<select value={f.type} onChange={e=>u('type',e.target.value)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Quantity<input type="number" min="1" value={f.qty} onChange={e=>u('qty',e.target.value)}/></label>
  <label>Unit<select value={f.unit} onChange={e=>u('unit',e.target.value)}>{UNITS.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Supplier (optional)<input value={f.supplier} onChange={e=>u('supplier',e.target.value)} placeholder="e.g. Local supply house"/></label>
  <label>Est. cost $ (optional)<input type="number" min="0" step="0.01" value={f.cost} onChange={e=>u('cost',e.target.value)}/></label>
  <label>Urgency<select value={f.urgency} onChange={e=>u('urgency',e.target.value)}>{URG.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Date needed<input type="date" value={f.date} onChange={e=>u('date',e.target.value)}/></label>
  <label>Requested by<input value={user.name} disabled/></label></div>
  <label>Note<textarea value={f.note} onChange={e=>u('note',e.target.value)}/></label>
  <div className="grow"><button className="pill" disabled={!f.item}>Submit request</button>{prefill&&<button type="button" className="link" onClick={()=>onDone?.(null)}>Cancel</button>}</div>
  <small className="muted">Request only — no real purchasing or payment.</small></form>}

export function Orders({user,prefill,clearPrefill}){const[orders,setOrders]=useState(()=>LS('md_orders',[]));const[fl,setFl]=useState({status:'All',urgency:'All',q:''});const[showForm,setShowForm]=useState(false)
 const refresh=()=>setOrders(LS('md_orders',[]))
 const setStatus=(o,s)=>{SET('md_orders',LS('md_orders',[]).map(x=>x.id===o.id?{...x,status:s,history:[...x.history,{status:s,by:user.name,ts:now()}]}:x));audit(user,`Order ${s.toLowerCase()}`,`${o.id}: ${o.qty} ${o.unit} ${o.item}`)
  if(s==='Received'){let inv=getInv();const i=inv.find(x=>x.id===o.itemId)||inv.find(x=>x.name.toLowerCase()===o.item.toLowerCase())
   if(i){inv=inv.map(x=>x.id===i.id?{...x,qty:x.qty+o.qty}:x);audit(user,'Inventory received',`${i.name}: ${i.qty} → ${i.qty+o.qty} ${i.unit} (from ${o.id})`)}
   else{inv=[...inv,{id:uid('INV'),name:o.item,type:o.type,qty:o.qty,unit:o.unit,min:0,location:'Receiving'}];audit(user,'Inventory item created',`${o.item}: ${o.qty} ${o.unit} (from ${o.id})`)}
   SET('md_inventory',inv)}
  refresh()}
 const list=orders.filter(o=>(fl.status==='All'||o.status===fl.status)&&(fl.urgency==='All'||o.urgency===fl.urgency)&&(!fl.q||`${o.item} ${o.requestedBy} ${o.supplier} ${o.id}`.toLowerCase().includes(fl.q.toLowerCase())))
 const open=prefill||showForm
 return <>{open&&<OrderForm key={prefill?.id||'new'} user={user} prefill={prefill} onDone={()=>{clearPrefill?.();setShowForm(false);refresh()}}/>}
 <div className="toolbar"><div className="filters"><select aria-label="Status" value={fl.status} onChange={e=>setFl({...fl,status:e.target.value})}><option value="All">All statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><select aria-label="Urgency" value={fl.urgency} onChange={e=>setFl({...fl,urgency:e.target.value})}><option value="All">All urgency</option>{URG.map(s=><option key={s}>{s}</option>)}</select><input placeholder="Search item, requester, supplier…" value={fl.q} onChange={e=>setFl({...fl,q:e.target.value})}/></div>
  <div className="grow"><button className="link" onClick={()=>csv('orders.csv',list.map(({history,...o})=>({...o,history:history.map(h=>`${h.status} by ${h.by} ${h.ts}`).join(' | ')})))}>Export CSV</button>{!open&&<button className="pill sm" onClick={()=>setShowForm(true)}>+ New request</button>}</div></div>
 <Table cols={['ID','Item','Qty','Urgency','Requested by','Needed','Est. $','Status','Action']} rows={list.map(o=><tr key={o.id}><td className="mono">{o.id}</td><td><b>{o.item}</b><br/><small className="muted">{o.type}{o.supplier?' · '+o.supplier:''}{o.note?' · '+o.note:''}</small></td><td className="nowrap">{o.qty} {o.unit}</td><td><Badge s={o.urgency}/></td><td>{o.requestedBy}<br/><small className="muted">{fmt(o.created)}</small></td><td className="nowrap">{o.date}</td><td>{o.cost===''?'—':'$'+Number(o.cost).toFixed(2)}</td><td><Badge s={o.status}/></td><td><div className="acts">{NEXT[o.status].map(s=><button key={s} className={s==='Denied'?'link':'pill sm'} onClick={()=>setStatus(o,s)}>{LABEL[s]}</button>)}</div></td></tr>)}/></>}

export function RequestSupplies({user}){const[k,setK]=useState(0);const mine=LS('md_orders',[]).filter(o=>o.requestedBy===user.name)
 return <><OrderForm key={k} user={user} onDone={()=>setK(k+1)}/><h2 className="h2l">My requests</h2><Table cols={['ID','Item','Qty','Urgency','Status','Updated']} rows={mine.map(o=><tr key={o.id}><td className="mono">{o.id}</td><td>{o.item}</td><td>{o.qty} {o.unit}</td><td><Badge s={o.urgency}/></td><td><Badge s={o.status}/></td><td>{fmt(o.history.at(-1).ts)}</td></tr>)}/></>}

const COND=['good','worn','damaged','expired']
export function StockCount({user}){const[shop,setShop]=useState(()=>ld('md_shop',SEED_SHOP));const[checks,setChecks]=useState(()=>LS('md_checks',[]));const[sess,setSess]=useState(null);const[view,setView]=useState(null);const blankN={name:'',cat:'Part',counted:1,location:'',condition:'good',note:''};const[nw,setNw]=useState(blankN)
 const start=()=>{setSess({id:uid('SC'),started:now(),by:user.name,lines:shop.map(s=>({itemId:s.id,name:s.name,cat:s.cat,expected:s.par,counted:'',condition:s.condition,location:s.location,note:'',isNew:false}))});audit(user,'Stock check started',`${shop.length} items`)}
 const ul=(i,k,v)=>setSess(s=>({...s,lines:s.lines.map((l,j)=>j===i?{...l,[k]:v}:l)}))
 const addFound=()=>{if(!nw.name)return;setSess(s=>({...s,lines:[...s.lines,{itemId:uid('SH'),name:nw.name,cat:nw.cat,expected:0,counted:Number(nw.counted),condition:nw.condition,location:nw.location,note:nw.note||'Found — not on list',isNew:true}]}));setNw(blankN)}
 const vari=l=>{if(l.counted==='')return'Not counted';const c=Number(l.counted),d=c-l.expected;if(l.isNew)return'Unlisted';if(c===0&&l.expected>0)return'Missing';if(d<0)return'Short';if(d>0)return'Over';return'OK'}
 const finish=()=>{const lines=sess.lines.map(l=>{const c=l.counted===''?0:Number(l.counted);return{...l,counted:c,variance:c-l.expected,status:vari({...l,counted:c})}});const c={...sess,lines,finished:now(),applied:false};const all=[c,...checks];setChecks(all);SET('md_checks',all);audit(user,'Stock check completed',`${c.id}: ${lines.filter(l=>l.variance!==0).length} variances of ${lines.length} items`);setSess(null);setView(c)}
 const apply=c=>{let s=[...shop];c.lines.forEach(l=>{const i=s.findIndex(x=>x.id===l.itemId);if(i>=0){const o=s[i];if(o.onHand!==l.counted||o.condition!==l.condition||o.location!==l.location)audit(user,'Shop count applied',`${l.name}: on hand ${o.onHand} → ${l.counted}; ${l.condition}; ${l.location}`);s[i]={...o,onHand:l.counted,condition:l.condition,location:l.location}}else{s.push({id:l.itemId,name:l.name,cat:l.cat,par:l.counted,onHand:l.counted,location:l.location,condition:l.condition});audit(user,'Shop item added',`${l.name}: ${l.counted} @ ${l.location||'—'}`)}})
  setShop(s);SET('md_shop',s);const all=checks.map(x=>x.id===c.id?{...x,applied:true,appliedBy:user.name,appliedAt:now()}:x);setChecks(all);SET('md_checks',all);setView(all.find(x=>x.id===c.id))}
 const exportCheck=c=>csv(`stock-check-${c.id}.csv`,c.lines.map(l=>({check:c.id,date:c.finished,by:c.by,item:l.name,category:l.cat,expected:l.expected,counted:l.counted,variance:l.variance,status:l.status,condition:l.condition,location:l.location,note:l.note})))
 if(sess)return <><div className="toolbar"><p><b>Stock check in progress</b> · {sess.by} · {fmt(sess.started)}</p><p className="muted">{sess.lines.filter(l=>l.counted!=='').length}/{sess.lines.length} counted</p></div>
  <Table cls="count" cols={['Item','Expected','Counted','Condition','Location','Note','']} rows={sess.lines.map((l,i)=>{const v=vari(l);return <tr key={l.itemId} className={'v-'+v.toLowerCase().replace(' ','-')}><td><b>{l.name}</b><br/><small className="muted">{l.cat}{l.isNew?' · found':''}</small></td><td>{l.expected}</td><td><input className="cnt" type="number" min="0" value={l.counted} onChange={e=>ul(i,'counted',e.target.value)}/></td><td><select value={l.condition} onChange={e=>ul(i,'condition',e.target.value)}>{COND.map(c=><option key={c}>{c}</option>)}</select></td><td><input value={l.location} onChange={e=>ul(i,'location',e.target.value)}/></td><td><input value={l.note} onChange={e=>ul(i,'note',e.target.value)}/></td><td><Badge s={v}/></td></tr>})}/>
  <div className="panel opsform"><h3>Add item found (not on list)</h3><div className="two"><label>Name<input value={nw.name} onChange={e=>setNw({...nw,name:e.target.value})} placeholder="e.g. Trigger sprayers"/></label><label>Category<select value={nw.cat} onChange={e=>setNw({...nw,cat:e.target.value})}>{['Tool','Chemical','Part'].map(c=><option key={c}>{c}</option>)}</select></label><label>Counted<input type="number" min="0" value={nw.counted} onChange={e=>setNw({...nw,counted:e.target.value})}/></label><label>Location<input value={nw.location} onChange={e=>setNw({...nw,location:e.target.value})}/></label><label>Condition<select value={nw.condition} onChange={e=>setNw({...nw,condition:e.target.value})}>{COND.map(c=><option key={c}>{c}</option>)}</select></label></div><button type="button" className="pill sm" onClick={addFound}>Add to count</button></div>
  <div className="grow"><button className="pill" onClick={finish}>Finish stock check</button><button className="link" onClick={()=>setSess(null)}>Discard</button></div></>
 if(view){const n=k=>view.lines.filter(l=>l.status===k).length
  return <><button className="link" onClick={()=>setView(null)}>‹ All stock checks</button><h3 className="h3l">Stock check {view.id}</h3><p className="muted">By {view.by} · {fmt(view.finished)}{view.applied?` · applied by ${view.appliedBy}`:' · not applied'}</p>
  <div className="stats sm"><div><b>{n('OK')}</b><span>Match</span></div><div><b>{n('Short')}</b><span>Short</span></div><div><b>{n('Missing')}</b><span>Missing</span></div><div><b>{n('Over')+n('Unlisted')}</b><span>Over / unlisted</span></div></div>
  <Table cls="count" cols={['Item','Expected','On hand','Variance','Status','Condition','Location','Note']} rows={view.lines.map(l=><tr key={l.itemId} className={'v-'+l.status.toLowerCase()}><td><b>{l.name}</b><br/><small className="muted">{l.cat}</small></td><td>{l.expected}</td><td>{l.counted}</td><td className="mono">{l.variance>0?'+':''}{l.variance}</td><td><Badge s={l.status}/></td><td>{l.condition}</td><td>{l.location}</td><td>{l.note}</td></tr>)}/>
  <div className="grow">{!view.applied&&<button className="pill" onClick={()=>apply(view)}>Apply counts as new on-hand</button>}<button className="link" onClick={()=>exportCheck(view)}>Export CSV</button></div></>}
 return <><div className="toolbar"><p className="muted">{shop.length} shop items · tools, chemicals &amp; parts</p><div className="grow"><button className="link" onClick={()=>csv('shop-items.csv',shop)}>Export items CSV</button><button className="link" onClick={()=>csv('stock-check-history.csv',checks.flatMap(c=>c.lines.map(l=>({check:c.id,date:c.finished,by:c.by,applied:c.applied,item:l.name,expected:l.expected,counted:l.counted,variance:l.variance,status:l.status,condition:l.condition,location:l.location}))))}>Export history CSV</button><button className="pill sm" onClick={start}>Start stock check</button></div></div>
  <Table cols={['Item','Category','Par','On hand','Condition','Location']} rows={shop.map(s=><tr key={s.id} className={s.onHand<s.par?'lowrow':''}><td><b>{s.name}</b></td><td>{s.cat}</td><td>{s.par}</td><td>{s.onHand}</td><td><Badge s={s.condition}/></td><td>{s.location}</td></tr>)}/>
  <h3 className="h3l">Stock check history</h3><Table cols={['Check','Date','By','Variances','Applied','']} rows={checks.map(c=><tr key={c.id}><td className="mono">{c.id}</td><td>{fmt(c.finished)}</td><td>{c.by}</td><td>{c.lines.filter(l=>l.variance!==0).length}</td><td>{c.applied?'Yes':'No'}</td><td><div className="acts"><button className="link" onClick={()=>setView(c)}>View</button><button className="link" onClick={()=>exportCheck(c)}>CSV</button></div></td></tr>)}/></>}

export function AuditLog(){const[q,setQ]=useState('');const log=LS('md_audit',[]).filter(a=>!q||`${a.action} ${a.detail} ${a.user}`.toLowerCase().includes(q.toLowerCase()))
 return <><div className="toolbar"><input className="search" placeholder="Filter log…" value={q} onChange={e=>setQ(e.target.value)}/><button className="link" onClick={()=>csv('audit-log.csv',log)}>Export CSV</button></div>
 <Table cols={['When','User','Action','Detail']} rows={log.map(a=><tr key={a.id}><td className="nowrap">{fmt(a.ts)}</td><td>{a.user}<br/><small className="muted">{a.role}</small></td><td><b>{a.action}</b></td><td>{a.detail}</td></tr>)}/></>}

export function Tabs({tabs,value,onChange}){return <div className="seg tabs" role="tablist">{tabs.map(t=>{const[l,b]=Array.isArray(t)?t:[t];return <button key={l} role="tab" className={value===l?'on':''} onClick={()=>onChange(l)}>{l}{b?<span className="tbadge">{b}</span>:null}</button>})}</div>}

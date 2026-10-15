import { useCallback, useEffect, useState } from 'react'
import { opsAction, opsGet, opsMigrate } from './opsApi.js'
// ── Shared operations module (R2-backed; localStorage is a fallback/cache only) ──
export const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}, SET=(k,v)=>localStorage.setItem(k,JSON.stringify(v))
const uid=p=>p+'-'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase()
const now=()=>new Date().toISOString()
export const fmt=t=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})
export function audit(user,action,detail){SET('md_audit',[{id:uid('A'),ts:now(),user:user?.name||'system',role:user?.role||'',action,detail},...LS('md_audit',[])])}
export function csv(name,rows){if(!rows.length)return;const cols=Object.keys(rows[0]);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`
 const blob=new Blob([[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
const SEED_INV=[
 {id:'INV-1',name:'pH-neutral car shampoo',type:'Chemical',qty:3,unit:'gal',min:4,location:'Van stock',url:''},
 {id:'INV-2',name:'Ceramic spray sealant',type:'Chemical',qty:6,unit:'bottle',min:4,location:'Van stock',url:''},
 {id:'INV-3',name:'Iron decon remover',type:'Chemical',qty:1,unit:'gal',min:2,location:'Van stock',url:''},
 {id:'INV-4',name:'Microfiber towels 16"',type:'Supply',qty:40,unit:'each',min:60,location:'Van stock',url:''},
 {id:'INV-5',name:'Clay bars',type:'Supply',qty:12,unit:'each',min:6,location:'Van stock',url:''},
 {id:'INV-6',name:'Interior detailer',type:'Chemical',qty:5,unit:'bottle',min:3,location:'Van stock',url:''},
 {id:'INV-7',name:'Tire dressing',type:'Chemical',qty:2,unit:'gal',min:2,location:'Van stock',url:''},
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
const cleanUrl=u=>{const s=String(u||'').trim();if(!s)return'';const w=/^https?:\/\//i.test(s)?s:'https://'+s;try{const p=new URL(w);return(p.protocol==='http:'||p.protocol==='https:')&&p.hostname.includes('.')?p.href:''}catch{return''}}
const hostOf=u=>{try{return new URL(u).hostname.replace(/^www\./i,'')}catch{return'Product link'}}
const ld=(k,seed)=>{let v=LS(k,null);if(!v){v=seed;SET(k,v)}return v}
export const getInv=()=>ld('md_inventory',SEED_INV).map(it=>({url:'',...it}))
let migrationDone=false,migrationPromise=null
function useSharedOps(resource, fallback, user) {
 const [items,setItems]=useState(fallback),[sync,setSync]=useState('loading'),[error,setError]=useState('')
 const refresh=useCallback(async()=>{
  try{
   if(user?.role==='admin'&&!migrationDone){migrationPromise ||= opsMigrate({inventory:getInv(),orders:LS('md_orders',[]),shop:ld('md_shop',SEED_SHOP),checks:LS('md_checks',[])});await migrationPromise;migrationDone=true;migrationPromise=null}
   const data=await opsGet(resource),rows=Array.isArray(data[resource])?data[resource]:[]
   const cacheKey={inventory:'md_inventory',orders:'md_orders',shop:'md_shop',checks:'md_checks'}[resource]
   if(cacheKey)SET(cacheKey,rows)
   setItems(rows);setSync('shared');return rows
  }catch(ex){migrationPromise=null;setSync('local');setError(ex.message||'Shared operations request failed.');return null}
 },[resource,user?.id,user?.role])
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),30_000);return()=>clearInterval(timer)},[refresh])
 return [items,setItems,sync,refresh,error]
}
const Table=({cols,rows,cls})=><div className="tbl"><table className={cls}><thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.length?rows:<tr><td colSpan={cols.length} className="muted">Nothing yet.</td></tr>}</tbody></table></div>
export const Badge=({s})=><span className={'badge b-'+String(s).toLowerCase().replace(/\s+/g,'-')}>{s}</span>
const STATUSES=['Requested','Approved','Ordered','Received','Denied'], NEXT={Requested:['Approved','Denied'],Approved:['Ordered','Denied'],Ordered:['Received'],Received:[],Denied:[]}
const LABEL={Approved:'Approve',Denied:'Deny',Ordered:'Mark ordered',Received:'Mark received'}
const TYPES=['Chemical','Supply','Part','Tool','Equipment','Other'], UNITS=['each','bottle','gal','qt','box','pack','case','set'], URG=['Low','Normal','High','Urgent']

export function Inventory({user,onReorder}){const[inv,setInv,sync,,syncError]=useSharedOps('inventory',getInv(),user)
 const blankP={id:'',name:'',type:'Chemical',qty:1,unit:'each',min:2,location:'Van stock',url:''}
 const[showAdd,setShowAdd]=useState(false);const[f,setF]=useState(blankP);const[err,setErr]=useState('')
 const save=async v=>{if(sync!=='shared')throw new Error('Shared inventory is not connected yet. Please retry when the Shared across devices status appears.');const before=new Map(inv.map(x=>[x.id,x])),after=new Map(v.map(x=>[x.id,x])),savedItems=new Map(after);for(const[id,item]of after){if(JSON.stringify(before.get(id))!==JSON.stringify(item)){const result=await opsAction('inventory','upsert',{item});savedItems.set(id,result.item)}}for(const id of before.keys())if(!after.has(id))await opsAction('inventory','delete',{id,version:before.get(id)._version});const refreshed=await opsGet('inventory'),next=refreshed.inventory||[];setInv(next);SET('md_inventory',next)}
 const u=(k,v)=>setF(o=>({...o,[k]:v}))
 const adj=async(it,d)=>{const n=Math.max(0,it.qty+d);try{await save(inv.map(x=>x.id===it.id?{...x,qty:n}:x));audit(user,'Inventory adjusted',`${it.name}: ${it.qty} → ${n} ${it.unit}`)}catch(e){setErr(e.message);if(e.status===409)void opsGet('inventory').then(data=>{setInv(data.inventory||[]);SET('md_inventory',data.inventory||[])})}}
 const startNew=()=>{setErr('');setF(blankP);setShowAdd(true)}
 const startEdit=it=>{setErr('');setF({id:it.id,_version:it._version,name:it.name,type:it.type,qty:it.qty,unit:it.unit,min:it.min,location:it.location||'Van stock',url:it.url||''});setShowAdd(true)}
 const cancel=()=>{setShowAdd(false);setF(blankP);setErr('')}
 const saveProd=async e=>{e.preventDefault();setErr('');const name=f.name.trim();if(!name)return setErr('Enter a product name.')
  const rawUrl=String(f.url||'').trim(),url=rawUrl?cleanUrl(rawUrl):''
  if(rawUrl&&!url)return setErr('Enter a valid product purchase URL (e.g. https://...).')
  const item={id:f.id||uid('INV'),_version:f._version,name,type:f.type,qty:Math.max(0,Number(f.qty)||0),unit:f.unit,min:Math.max(0,Number(f.min)||0),location:f.location.trim()||'Van stock',url}
  try{if(f.id){await save(inv.map(x=>x.id===f.id?item:x));audit(user,'Product updated',`${item.name} (${item.qty} ${item.unit})${url?' · '+url:''}`)}
  else{await save([item,...inv]);audit(user,'Product added',`${item.name} (${item.qty} ${item.unit})${url?' · '+url:''}`)}cancel()}catch(ex){setErr(ex.message);if(ex.status===409)void opsGet('inventory').then(data=>{setInv(data.inventory||[]);SET('md_inventory',data.inventory||[])})}}
 const removeProd=async it=>{try{await save(inv.filter(x=>x.id!==it.id));audit(user,'Product removed',it.name);if(f.id===it.id)cancel()}catch(ex){setErr(ex.message)}}
 const low=inv.filter(i=>i.qty<=i.min)
 return <>{showAdd&&<form className="panel opsform" onSubmit={saveProd}><h3>{f.id?'Edit product':'Add product'}</h3>
  <div className="two">
   <label>Product name<input value={f.name} onChange={e=>u('name',e.target.value)} placeholder="e.g. Griot’s Garage Ceramic 3-in-1 Wax" required/></label>
   <label>Direct purchase link<input type="url" inputMode="url" value={f.url} onChange={e=>u('url',e.target.value)} placeholder="https://www.amazon.com/dp/..."/></label>
   <label>Type<select value={f.type} onChange={e=>u('type',e.target.value)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
   <label>Unit<select value={f.unit} onChange={e=>u('unit',e.target.value)}>{UNITS.map(t=><option key={t}>{t}</option>)}</select></label>
   <label>On hand qty<input type="number" min="0" value={f.qty} onChange={e=>u('qty',e.target.value)}/></label>
   <label>Min stock alert<input type="number" min="0" value={f.min} onChange={e=>u('min',e.target.value)}/></label>
   <label>Location<input value={f.location} onChange={e=>u('location',e.target.value)} placeholder="Van stock"/></label>
  </div>
  {err&&<p className="err">{err}</p>}
  <div className="grow"><button className="pill">{f.id?'Save changes':'Add product'}</button><button type="button" className="link" onClick={cancel}>Cancel</button>{f.id&&<button type="button" className="link danger" onClick={()=>removeProd(f)}>Remove product</button>}</div>
 </form>}
 <div className="toolbar"><p className="muted">{inv.length} items · <b>{low.length} low stock</b>{sync==='shared'?<small className="sync ok"> · Shared across devices</small>:sync==='local'?<small className="sync fail"> · Shared sync unavailable — showing this device’s data{syncError?`: ${syncError}`:''}</small>:<small className="sync"> · Connecting to shared inventory…</small>}</p><div className="grow" style={{marginTop:0}}><button type="button" className="pill sm" onClick={startNew}>+ Add product</button><button className="link" style={{marginRight:0}} onClick={()=>csv('inventory.csv',inv.map(({_version,...item})=>item))}>Export CSV</button></div></div>
 <Table cols={['Item','Type','On hand','Min','Location','Purchase','']} rows={inv.map(i=><tr key={i.id} className={i.qty<=i.min?'lowrow':''}><td><b>{i.name}</b>{i.qty<=i.min&&<><br/><small>Low stock</small></>}<br/>{i.url?<a className="link tiny" href={i.url} target="_blank" rel="noopener noreferrer">Buy on {hostOf(i.url)} ↗</a>:<button type="button" className="link tiny muted" onClick={()=>startEdit(i)}>+ Add link</button>}</td><td>{i.type}</td><td className="nowrap"><button className="qbtn" onClick={()=>adj(i,-1)}>−</button> {i.qty} {i.unit} <button className="qbtn" onClick={()=>adj(i,1)}>+</button></td><td>{i.min}</td><td>{i.location}</td><td className="nowrap">{i.url?<a className="pill sm light-b" href={i.url} target="_blank" rel="noopener noreferrer">Buy ↗</a>:<button type="button" className="link tiny" onClick={()=>startEdit(i)}>+ Add link</button>}</td><td><div className="acts">{i.qty<=i.min&&<button className="pill sm" onClick={()=>onReorder(i)}>Reorder</button>}<button type="button" className="link" onClick={()=>startEdit(i)}>Edit</button></div></td></tr>)}/></>}

export function OrderForm({user,prefill,onDone,inventory=getInv()}){const[sharedInventory]=useSharedOps('inventory',inventory,user);const inv=sharedInventory
 const blank={itemId:'',item:'',type:'Chemical',qty:1,unit:'each',supplier:'',url:'',cost:'',urgency:'Normal',note:'',date:new Date().toISOString().slice(0,10)}
 const[f,setF]=useState(()=>prefill?{...blank,itemId:prefill.id,item:prefill.name,type:prefill.type,unit:prefill.unit,url:prefill.url||'',qty:Math.max(1,prefill.min*2-prefill.qty),urgency:prefill.qty===0?'Urgent':'High',note:`Reorder — on hand ${prefill.qty}, min ${prefill.min}`}:blank)
 const u=(k,v)=>setF(o=>({...o,[k]:v}))
 const pick=id=>{if(id==='__new'||id==='')return setF(o=>({...o,itemId:id,item:'',url:''}));const i=inv.find(x=>x.id===id);setF(o=>({...o,itemId:id,item:i.name,type:i.type,unit:i.unit,url:i.url||''}))}
 const submit=async e=>{e.preventDefault();if(!f.item||f.qty<1)return;const url=cleanUrl(f.url);const o={...f,url,qty:Number(f.qty),cost:f.cost===''?'':Number(f.cost),itemId:f.itemId==='__new'?'':f.itemId}
  try{const result=await opsAction('orders','create',{order:o});audit(user,'Order requested',`${result.order.id}: ${o.qty} ${o.unit} ${o.item} (${o.urgency})`);setF(blank);onDone?.(result.order)}catch(ex){alert(ex.message)}}
 const isNew=f.itemId==='__new'||f.itemId==='', cleanHref=cleanUrl(f.url)
 return <form className="panel opsform" onSubmit={submit}><h3>{prefill?'Reorder low-stock item':'Request supplies'}</h3>
  <div className="two"><label>Item<select value={f.itemId} onChange={e=>pick(e.target.value)}><option value="">Choose from inventory…</option>{inv.map(i=><option key={i.id} value={i.id}>{i.name} ({i.qty} {i.unit})</option>)}<option value="__new">+ New item…</option></select></label>
  {isNew&&<label>New item name<input value={f.item} onChange={e=>u('item',e.target.value)} placeholder="e.g. Leather conditioner"/></label>}
  <label>Type<select value={f.type} onChange={e=>u('type',e.target.value)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Quantity<input type="number" min="1" value={f.qty} onChange={e=>u('qty',e.target.value)}/></label>
  <label>Unit<select value={f.unit} onChange={e=>u('unit',e.target.value)}>{UNITS.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Direct purchase link (optional)<input type="url" inputMode="url" value={f.url} onChange={e=>u('url',e.target.value)} placeholder="https://..."/></label>
  <label>Supplier (optional)<input value={f.supplier} onChange={e=>u('supplier',e.target.value)} placeholder="e.g. Local supply house"/></label>
  <label>Est. cost $ (optional)<input type="number" min="0" step="0.01" value={f.cost} onChange={e=>u('cost',e.target.value)}/></label>
  <label>Urgency<select value={f.urgency} onChange={e=>u('urgency',e.target.value)}>{URG.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Date needed<input type="date" value={f.date} onChange={e=>u('date',e.target.value)}/></label>
  <label>Requested by<input value={user.name} disabled/></label></div>
  <label>Note<textarea value={f.note} onChange={e=>u('note',e.target.value)}/></label>
  <div className="grow"><button className="pill" disabled={!f.item}>Submit request</button>{cleanHref&&<a className="pill sm light-b" href={cleanHref} target="_blank" rel="noopener noreferrer">Open purchase link ↗</a>}{prefill&&<button type="button" className="link" onClick={()=>onDone?.(null)}>Cancel</button>}</div>
  <small className="muted">Request only — no real purchasing or payment.</small></form>}

export function Orders({user,prefill,clearPrefill,inventory=getInv()}){const[orders,,sync,refresh,syncError]=useSharedOps('orders',LS('md_orders',[]),user);const[sharedInventory]=useSharedOps('inventory',inventory,user);const[fl,setFl]=useState({status:'All',urgency:'All',q:''});const[showForm,setShowForm]=useState(false)
 const setStatus=async(o,s)=>{try{await opsAction('orders','status',{id:o.id,status:s,version:o._version});audit(user,`Order ${s.toLowerCase()}`,`${o.id}: ${o.qty} ${o.unit} ${o.item}`);await refresh()}catch(ex){alert(ex.message);if(ex.status===409)await refresh()}}
 const urlFor=o=>o.url||sharedInventory.find(x=>x.id===o.itemId||x.name.toLowerCase()===String(o.item||'').toLowerCase())?.url||''
 const list=orders.filter(o=>(fl.status==='All'||o.status===fl.status)&&(fl.urgency==='All'||o.urgency===fl.urgency)&&(!fl.q||`${o.item} ${o.requestedBy} ${o.supplier} ${o.id}`.toLowerCase().includes(fl.q.toLowerCase())))
 const open=prefill||showForm
 return <>{open&&<OrderForm key={prefill?.id||'new'} user={user} prefill={prefill} inventory={sharedInventory} onDone={()=>{clearPrefill?.();setShowForm(false);refresh()}}/>}
 <div className="toolbar"><p className="muted">{sync==='shared'?'Shared supply requests':sync==='local'?`Shared sync unavailable — showing this device’s requests${syncError?`: ${syncError}`:''}`:'Connecting to shared supply requests…'}</p><div className="filters"><select aria-label="Status" value={fl.status} onChange={e=>setFl({...fl,status:e.target.value})}><option value="All">All statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><select aria-label="Urgency" value={fl.urgency} onChange={e=>setFl({...fl,urgency:e.target.value})}><option value="All">All urgency</option>{URG.map(s=><option key={s}>{s}</option>)}</select><input placeholder="Search item, requester, supplier…" value={fl.q} onChange={e=>setFl({...fl,q:e.target.value})}/></div>
  <div className="grow"><button className="link" onClick={()=>csv('orders.csv',list.map(({history,_version,...o})=>({...o,history:history.map(h=>`${h.status} by ${h.by} ${h.ts}`).join(' | ')})))}>Export CSV</button>{!open&&<button className="pill sm" onClick={()=>setShowForm(true)}>+ New request</button>}</div></div>
 <Table cols={['ID','Item','Qty','Urgency','Requested by','Needed','Est. $','Status','Action']} rows={list.map(({_version,...o})=>{const link=urlFor(o);return <tr key={o.id}><td className="mono">{o.id}</td><td><b>{o.item}</b><br/><small className="muted">{o.type}{o.supplier?' · '+o.supplier:''}{o.note?' · '+o.note:''}</small>{link&&<><br/><a className="link tiny" href={link} target="_blank" rel="noopener noreferrer">Buy on {hostOf(link)} ↗</a></>}</td><td className="nowrap">{o.qty} {o.unit}</td><td><Badge s={o.urgency}/></td><td>{o.requestedBy}<br/><small className="muted">{fmt(o.created)}</small></td><td className="nowrap">{o.date}</td><td>{o.cost===''?'—':'$'+Number(o.cost).toFixed(2)}</td><td><Badge s={o.status}/></td><td><div className="acts">{link&&<a className="pill sm light-b" href={link} target="_blank" rel="noopener noreferrer">Buy ↗</a>}{NEXT[o.status].map(s=><button key={s} className={s==='Denied'?'link':'pill sm'} onClick={()=>setStatus(o,s)}>{LABEL[s]}</button>)}</div></td></tr>})}/></>}

export function RequestSupplies({user}){const[k,setK]=useState(0);const[orders,,sync,refresh,syncError]=useSharedOps('orders',LS('md_orders',[]),user);const[sharedInventory]=useSharedOps('inventory',getInv(),user);const mine=orders.filter(o=>o.requestedById===user.id||(!o.requestedById&&o.requestedBy===user.name))
 return <><OrderForm key={k} user={user} inventory={sharedInventory} onDone={()=>{setK(k+1);refresh()}}/><p className="muted">{sync==='shared'?'Requests sync across devices':sync==='local'?`Shared sync unavailable — requests saved on this device only${syncError?`: ${syncError}`:''}`:'Connecting to shared requests…'}</p><h2 className="h2l">My requests</h2><Table cols={['ID','Item','Qty','Urgency','Status','Updated']} rows={mine.map(o=><tr key={o.id}><td className="mono">{o.id}</td><td>{o.item}{o.url&&<><br/><a className="link tiny" href={o.url} target="_blank" rel="noopener noreferrer">Buy on {hostOf(o.url)} ↗</a></>}</td><td>{o.qty} {o.unit}</td><td><Badge s={o.urgency}/></td><td><Badge s={o.status}/></td><td>{fmt(o.history.at(-1).ts)}</td></tr>)}/></>}

const COND=['good','worn','damaged','expired']
export function StockCount({user}){const[shop,setShop,sync,refreshShop,syncError]=useSharedOps('shop',ld('md_shop',SEED_SHOP),user);const[checks,setChecks,,refreshChecks]=useSharedOps('checks',LS('md_checks',[]),user);const[sess,setSess]=useState(null);const[view,setView]=useState(null);const blankN={name:'',cat:'Part',counted:1,location:'',condition:'good',note:''};const[nw,setNw]=useState(blankN)
 const start=()=>{setSess({id:uid('SC'),started:now(),by:user.name,lines:shop.map(s=>({itemId:s.id,name:s.name,cat:s.cat,expected:s.onHand,counted:'',condition:s.condition,location:s.location,note:'',isNew:false}))});audit(user,'Stock check started',`${shop.length} items`)}
 const ul=(i,k,v)=>setSess(s=>({...s,lines:s.lines.map((l,j)=>j===i?{...l,[k]:v}:l)}))
 const addFound=()=>{if(!nw.name)return;setSess(s=>({...s,lines:[...s.lines,{itemId:uid('SH'),name:nw.name,cat:nw.cat,expected:0,counted:Number(nw.counted),condition:nw.condition,location:nw.location,note:nw.note||'Found — not on list',isNew:true}]}));setNw(blankN)}
 const vari=l=>{if(l.counted==='')return'Not counted';const c=Number(l.counted),d=c-l.expected;if(l.isNew)return'Unlisted';if(c===0&&l.expected>0)return'Missing';if(d<0)return'Short';if(d>0)return'Over';return'OK'}
 const finish=async()=>{const lines=sess.lines.map(l=>{const c=l.counted===''?0:Number(l.counted);return{...l,counted:c,variance:c-l.expected,status:vari({...l,counted:c})}});const c={...sess,lines,finished:now(),applied:false};try{const result=await opsAction('checks','create',{check:c});const all=[result.check,...checks];setChecks(all);SET('md_checks',all);audit(user,'Stock check completed',`${c.id}: ${lines.filter(l=>l.variance!==0).length} variances of ${lines.length} items`);setSess(null);setView(result.check);await refreshChecks()}catch(e){alert(e.message)}}
 const apply=async c=>{try{const result=await opsAction('checks','apply',{id:c.id});setShop(result.shop);SET('md_shop',result.shop);setChecks(checks.map(x=>x.id===c.id?result.check:x));SET('md_checks',checks.map(x=>x.id===c.id?result.check:x));audit(user,'Stock check applied',`${c.id}: ${c.lines.length} items`);setView(result.check);await refreshShop();await refreshChecks()}catch(e){alert(e.message)}}
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
 return <><div className="toolbar"><p className="muted">{shop.length} shop items · tools, chemicals &amp; parts {sync==='shared'?<small className="sync ok"> · Shared across devices</small>:sync==='local'?<small className="sync fail"> · Shared sync unavailable — showing this device’s data{syncError?`: ${syncError}`:''}</small>:<small className="sync"> · Connecting to shared stock…</small>}</p><div className="grow"><button className="link" onClick={()=>csv('shop-items.csv',shop)}>Export items CSV</button><button className="link" onClick={()=>csv('stock-check-history.csv',checks.flatMap(c=>c.lines.map(l=>({check:c.id,date:c.finished,by:c.by,applied:c.applied,item:l.name,expected:l.expected,counted:l.counted,variance:l.variance,status:l.status,condition:l.condition,location:l.location}))))}>Export history CSV</button><button className="pill sm" onClick={start}>Start stock check</button></div></div>
  <Table cols={['Item','Category','Par','On hand','Condition','Location']} rows={shop.map(s=><tr key={s.id} className={s.onHand<s.par?'lowrow':''}><td><b>{s.name}</b></td><td>{s.cat}</td><td>{s.par}</td><td>{s.onHand}</td><td><Badge s={s.condition}/></td><td>{s.location}</td></tr>)}/>
  <h3 className="h3l">Stock check history</h3><Table cols={['Check','Date','By','Variances','Applied','']} rows={checks.map(c=><tr key={c.id}><td className="mono">{c.id}</td><td>{fmt(c.finished)}</td><td>{c.by}</td><td>{c.lines.filter(l=>l.variance!==0).length}</td><td>{c.applied?'Yes':'No'}</td><td><div className="acts"><button className="link" onClick={()=>setView(c)}>View</button><button className="link" onClick={()=>exportCheck(c)}>CSV</button></div></td></tr>)}/></>}

export function AuditLog(){const[q,setQ]=useState('');const log=LS('md_audit',[]).filter(a=>!q||`${a.action} ${a.detail} ${a.user}`.toLowerCase().includes(q.toLowerCase()))
 return <><div className="toolbar"><input className="search" placeholder="Filter log…" value={q} onChange={e=>setQ(e.target.value)}/><button className="link" onClick={()=>csv('audit-log.csv',log)}>Export CSV</button></div>
 <Table cols={['When','User','Action','Detail']} rows={log.map(a=><tr key={a.id}><td className="nowrap">{fmt(a.ts)}</td><td>{a.user}<br/><small className="muted">{a.role}</small></td><td><b>{a.action}</b></td><td>{a.detail}</td></tr>)}/></>}

export function Tabs({tabs,value,onChange}){return <div className="seg tabs" role="tablist">{tabs.map(t=>{const[l,b]=Array.isArray(t)?t:[t];return <button key={l} role="tab" className={value===l?'on':''} onClick={()=>onChange(l)}>{l}{b?<span className="tbadge">{b}</span>:null}</button>})}</div>}

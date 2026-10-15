import { useEffect, useRef, useState } from 'react'
import { services, detailers, vehicles } from './data'
import { JobPanel, BeforeAfter, jobState } from './JobPhotos'
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}, SET=(k,v)=>localStorage.setItem(k,JSON.stringify(v))
const sname=id=>services.find(s=>s.id===id)?.name||id
const ini=n=>(n||'?').split(' ').map(x=>x[0]).join('').slice(0,2)
const today=()=>new Date().toISOString().slice(0,10)
export const statusOf=b=>{if(b.status==='Cancelled')return'Cancelled';const j=jobState(b.id).status;if(j==='Completed')return'Completed';if(j==='In progress')return'In progress';const t=today();if(b.date<t)return'Completed';if(b.date===t)return'In progress';return'Confirmed'}
const STEPS=['Booked','Confirmed','Detailer en route','In progress','Completed']
const vehLabel=b=>b.make?`${b.year||''} ${b.make} ${b.model}`.trim():vehicles.find(v=>v.id===b.vehicle)?.name||'Vehicle on file'
const ADMIN={name:'Millirons Support',role:'admin'}
// ── Messages (per-device localStorage, keyed by booking id) ──
function seedMsgs(){if(LS('md_msgs',null)===null){SET('md_msgs',{})}else{const cur=LS('md_msgs',{});delete cur['MD-SAMPLE3'];delete cur['MD-SAMPLE1'];SET('md_msgs',cur)}}
export const getMsgs=id=>{seedMsgs();return LS('md_msgs',{})[id]||[]}
const putMsg=(id,m)=>{const all=LS('md_msgs',{});all[id]=[...(all[id]||[]),m];SET('md_msgs',all)}
const readKey=u=>`md_read_${u.email||u.name}`
export const unread=(id,u)=>{const seen=LS(readKey(u),{})[id]||'';return getMsgs(id).filter(m=>m.ts>seen&&!isMine(m,u)).length}
const markRead=(id,u)=>{const r=LS(readKey(u),{});r[id]=new Date().toISOString();SET(readKey(u),r)}
const isMine=(m,u)=>m.from.role===u.role&&(u.role!=='employee'||m.from.detailer===u.detailer)&&(u.role!=='customer'||m.from.email===u.email)
export const canSee=(b,u)=>u&&(u.role==='admin'||(u.role==='employee'&&b.detailer===u.detailer)||(u.role==='customer'&&b.email===u.email))

// ── List of bookings (used by all roles) ──
export function BookingList({bookings,user,title='Upcoming & active',emptyText='No upcoming bookings.'}){const[showPast,setShowPast]=useState(false)
 const s=[...bookings].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),up=s.filter(b=>statusOf(b)!=='Completed'),past=s.filter(b=>statusOf(b)==='Completed').reverse()
 const Row=({b})=>{const d=detailers.find(x=>x.id===b.detailer),n=unread(b.id,user),st=statusOf(b)
  return <a className="brow" href={`#/booking/${b.id}`}><div className="bdate"><b>{new Date(b.date+'T12:00').toLocaleDateString('en-US',{month:'short'})}</b><span>{new Date(b.date+'T12:00').getDate()}</span></div>
   <div className="bmain"><div className="bt"><b>{sname(b.service)}</b><span className={'spill s-'+st.toLowerCase().replace(/\s+/g,'-')}>{st}</span></div><small>{b.time} · {vehLabel(b)}</small><small>{user.role==='customer'?`Detailer: ${d?.name||'TBD'}`:`${b.name} · ${d?.name||'Unassigned'}`}</small></div>
   {n>0&&<span className="ubadge" aria-label={`${n} unread`}>{n}</span>}<span className="chev">›</span></a>}
 return <div className="blist"><h3 className="h3l">{title}</h3><div className="bcard">{up.length?up.map(b=><Row key={b.id} b={b}/>):<p className="muted pad">{emptyText}</p>}</div>
  {past.length>0&&<><button className="link pastt" onClick={()=>setShowPast(!showPast)}>{showPast?'Hide':'Show'} past bookings ({past.length}) {showPast?'▴':'▾'}</button>{showPast&&<div className="bcard past">{past.map(b=><Row key={b.id} b={b}/>)}</div>}</>}</div>}

// ── Detail view + thread ──
export function BookingDetail({id,user,all}){const b=all.find(x=>x.id===id)
 if(!user)return <section className="sec light top center"><p>Please <a className="link" href={`#/login`}>sign in</a> to view this booking.</p></section>
 if(!b||!canSee(b,user))return <section className="sec light top center"><h1 className="h1s">Booking not found.</h1><a className="link" href="#/dashboard">Back to dashboard</a></section>
 const d=detailers.find(x=>x.id===b.detailer),st=statusOf(b),idx=st==='Completed'?4:st==='In progress'?3:1
 return <section className="sec light top bdetail"><a className="link back" href="#/dashboard">‹ Dashboard</a>
  <div className="bd-h"><div><p className="eyebrow">Booking {b.id}</p><h1 className="h1s">{sname(b.service)}</h1><p className="muted">{new Date(b.date+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})} · {b.time}</p></div><span className={'spill big s-'+st.toLowerCase().replace(/\s+/g,'-')}>{st}</span></div>
  <div className="bd-grid"><div className="bd-col">
   <div className="card flat"><h3>Status</h3><ol className="timeline">{STEPS.map((s,i)=><li key={s} className={i<=idx?'done':''}><span/>{s}</li>)}</ol></div>
   <div className="card flat"><h3>Details</h3>{[['Vehicle',vehLabel(b)+(b.color?` · ${b.color}`:'')],['VIN',b.vin?`${b.vin.slice(0,3)}••••${b.vin.slice(-4)}`:'—'],['Address',`${b.address}, ${b.city}${b.zip?' '+b.zip:''}`],['Customer',b.name],['Paid',`$${Number(b.total).toFixed(2)}${b.payment?` · ${b.payment.method}`:''}`]].map(([k,v])=><div className="row" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
   {user.role==='employee'&&b.detailer===user.detailer&&<JobPanel b={b} user={user}/>}<BeforeAfter b={b} hideEmpty={user.role==='employee'}/>{d&&<a className="card flat dmini" href={`#/detailer/${d.id}`}><div className="avatar" style={{background:d.grad}}>{ini(d.name)}</div><div><b>{d.name}</b><small>★ {d.rating} · {d.city}</small><small>Your assigned detailer</small></div><span className="chev">›</span></a>}
  </div><Thread b={b} user={user} d={d}/></div></section>}

function Thread({b,user,d}){const[msgs,setMsgs]=useState(()=>getMsgs(b.id));const[t,setT]=useState('');const end=useRef(null)
 useEffect(()=>{markRead(b.id,user)},[msgs.length])
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'})},[msgs.length])
 useEffect(()=>{const f=e=>{if(e.key==='md_msgs')setMsgs(getMsgs(b.id))};addEventListener('storage',f);return()=>removeEventListener('storage',f)},[])
 const send=e=>{e.preventDefault();const text=t.trim();if(!text)return;putMsg(b.id,{id:'m'+Date.now(),ts:new Date().toISOString(),from:{name:user.role==='admin'?ADMIN.name:user.name,role:user.role,email:user.email,detailer:user.detailer},text});setT('');setMsgs(getMsgs(b.id))}
 const others=user.role==='customer'?`${d?.name||'Detailer'} & Millirons Support`:user.role==='employee'?`${b.name} & Millirons Support`:`${b.name} & ${d?.name||'Detailer'}`
 let lastDay=''
 return <div className="imsg"><div className="im-h"><div className="im-av">{ini(user.role==='customer'?d?.name:b.name)}</div><b>{others}</b><small>Booking {b.id}</small></div>
  <div className="im-body">{msgs.map((m,i)=>{const mine=isMine(m,user),day=new Date(m.ts).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),showDay=day!==lastDay;lastDay=day;const prev=msgs[i-1],grouped=prev&&prev.from.name===m.from.name&&!showDay,isLastMine=mine&&!msgs.slice(i+1).some(x=>isMine(x,user))
   return <div key={m.id}>{showDay&&<div className="im-day">{day} {new Date(m.ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>}
    <div className={'im-row '+(mine?'me':'them')}>{!mine&&<div className={'im-av sm'+(grouped?' ghost':'')}>{grouped?'':ini(m.from.name)}</div>}<div className="im-wrap">{!mine&&!grouped&&<small className="im-name">{m.from.name}{m.from.role!=='customer'?` · ${m.from.role==='admin'?'Support':'Detailer'}`:''}</small>}<div className="bubble" title={new Date(m.ts).toLocaleString()}>{m.text}</div>{isLastMine&&<small className="im-del">Delivered</small>}</div></div></div>})}<div ref={end}/></div>
  <form className="im-comp" onSubmit={send}><input value={t} onChange={e=>setT(e.target.value)} placeholder="iMessage" aria-label="Message"/><button className="im-send" disabled={!t.trim()} aria-label="Send">↑</button></form></div>}

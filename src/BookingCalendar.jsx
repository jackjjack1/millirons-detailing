import { useState } from 'react'
import { scheduleBookings } from './testJobs'
import { TestBadge } from './TestBadge'
export const SLOTS=['8:00 AM','9:30 AM','11:00 AM','12:30 PM','2:00 PM','3:30 PM','5:00 PM']
const pad=n=>String(n).padStart(2,'0'), iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
// Sample capacity: one crew-slot per time. Some dates are pre-filled ("full") to demo disabled days.
const sampleTaken=ds=>{const n=Number(ds.replaceAll('-',''));const k=n%7;return k===3?SLOTS:SLOTS.filter((_,i)=>(n+i)%4===0)}
export function slotsFor(ds,all){const d=new Date(ds+'T00:00');const sun=d.getDay()===0;const taken=new Set([...sampleTaken(ds),...scheduleBookings(all).filter(b=>b.date===ds).map(b=>b.time)]);return SLOTS.filter(t=>!(sun&&(t==='8:00 AM'||t==='5:00 PM'||t==='3:30 PM'))).map(t=>({t,open:!taken.has(t)}))}
export default function BookingCalendar({mine,all,sname}){const today=new Date();today.setHours(0,0,0,0)
 const[m,setM]=useState(new Date(today.getFullYear(),today.getMonth(),1));const[sel,setSel]=useState(iso(today))
 const first=m.getDay(),days=new Date(m.getFullYear(),m.getMonth()+1,0).getDate()
 const cells=[...Array(first).fill(null),...Array.from({length:days},(_,i)=>new Date(m.getFullYear(),m.getMonth(),i+1))]
 const state=d=>{const ds=iso(d);if(d<today)return'past';const s=slotsFor(ds,all);return s.some(x=>x.open)?'open':'full'}
 const selD=new Date(sel+'T00:00'),selState=state(selD),dayB=mine.filter(b=>b.date===sel),slots=slotsFor(sel,all)
 const canPrev=m>new Date(today.getFullYear(),today.getMonth(),1)
 return <div className="cal-wrap"><div className="cal card"><div className="cal-h"><button className="calnav" disabled={!canPrev} onClick={()=>setM(new Date(m.getFullYear(),m.getMonth()-1,1))} aria-label="Previous month">‹</button><b>{m.toLocaleString('en-US',{month:'long',year:'numeric'})}</b><button className="calnav" onClick={()=>setM(new Date(m.getFullYear(),m.getMonth()+1,1))} aria-label="Next month">›</button></div>
  <div className="cal-g">{['S','M','T','W','T','F','S'].map((x,i)=><span key={i} className="dow">{x}</span>)}{cells.map((d,i)=>{if(!d)return <span key={i}/>;const ds=iso(d),st=state(d),has=mine.some(b=>b.date===ds);return <button key={i} disabled={st!=='open'&&!has} className={`day ${st} ${ds===sel?'sel':''} ${ds===iso(today)?'today':''}`} onClick={()=>setSel(ds)} title={st==='full'?'Fully booked':st==='past'?'Past':''}>{d.getDate()}{has&&<i className="dot"/>}</button>})}</div>
  <div className="legend"><span><i className="dot"/> Your booking</span><span><i className="sw full"/> Full</span><span><i className="sw past"/> Past</span></div></div>
  <div className="cal-side card"><p className="eyebrow">{selD.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
   <h3>Your bookings</h3>{dayB.length?dayB.map(b=><div className="bk" key={b.id}><b>{b.time} · {sname(b.service)}<TestBadge job={b}/></b><small>{b.id} · {b.address}, {b.city} · ${b.total}</small></div>):<p className="muted">None this day.</p>}
   <h3>Available times</h3>{selState==='past'?<p className="muted">This day has passed.</p>:selState==='full'?<p className="muted">Fully booked — pick another day.</p>:<div className="slots">{slots.map(s=>s.open?<a key={s.t} className="slot" href={`#/book?date=${sel}&time=${encodeURIComponent(s.t)}`}>{s.t}</a>:<span key={s.t} className="slot off">{s.t}</span>)}</div>}
   <small className="muted">Tap an open time to start a booking. Availability is sample data.</small></div></div>}

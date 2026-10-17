import { useEffect, useState } from 'react'
import { audit, csv } from './Ops'
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}, SET=(k,v)=>localStorage.setItem(k,JSON.stringify(v))
const H=36e5, dur=ms=>{const m=Math.max(0,Math.floor(ms/6e4));return `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`}, hrs=ms=>(ms/H).toFixed(2)
const t=ts=>new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}), dstr=ts=>new Date(ts).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}
const sod=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x.getTime()}, sow=d=>{const x=new Date(sod(d));x.setDate(x.getDate()-((x.getDay()+6)%7));return x.getTime()}
const EMPS=[{id:'marcus',name:'Marcus Reed'},{id:'ana',name:'Ana Torres'},{id:'devon',name:'Devon Park'},{id:'lena',name:'Lena Brooks'}]
function seed(){if(LS('md_shifts',null))return;const out=[];const at=(dd,h,m)=>{const x=new Date();x.setDate(x.getDate()-dd);x.setHours(h,m,0,0);return x.getTime()}
 const plan={marcus:[[1,7,55,16,10],[2,8,2,17,30],[3,7,48,15,5],[6,9,0,14,20]],ana:[[1,9,0,17,45],[2,8,30,16,0],[4,8,15,13,30]],devon:[[1,10,5,18,0],[3,9,40,15,55]],lena:[[2,7,30,12,0]]}
 Object.entries(plan).forEach(([id,rows])=>rows.forEach(([dd,h1,m1,h2,m2],i)=>out.push({id:`S-${id}-${dd}-${i}`,emp:id,name:EMPS.find(e=>e.id===id).name,in:at(dd,h1,m1),out:at(dd,h2,m2),noteIn:i===0?'Van loaded, 3 jobs today':'',noteOut:'',edits:[]})))
 out.push({id:'S-ana-open',emp:'ana',name:'Ana Torres',in:Date.now()-2.25*H,out:null,noteIn:'Starting in Midtown',noteOut:'',edits:[]})
 SET('md_shifts',out)}
export const shifts=()=>{seed();return LS('md_shifts',[])}
const total=(list,from,to=Infinity,now=Date.now())=>list.reduce((s,x)=>{const a=Math.max(x.in,from),b=Math.min(x.out??now,to);return s+(b>a?b-a:0)},0)

export function TimeClock({user}){const emp=user.detailer;const[all,setAll]=useState(shifts);const[note,setNote]=useState('');const[now,setNow]=useState(Date.now())
 useEffect(()=>{const i=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(i)},[])
 const mine=all.filter(s=>s.emp===emp).sort((a,b)=>b.in-a.in),open=mine.find(s=>!s.out),preview=!!user?.preview
 const save=v=>{if(preview)return;setAll(v);SET('md_shifts',v)}
 const checkIn=()=>{if(preview||shifts().some(s=>s.emp===emp&&!s.out))return;const s={id:'S-'+Date.now().toString(36),emp,name:user.name,in:Date.now(),out:null,noteIn:note.trim(),noteOut:'',edits:[]};save([...shifts(),s]);audit(user,'Checked in',`${t(s.in)}${s.noteIn?' — '+s.noteIn:''}`);setNote('')}
 const checkOut=()=>{if(preview||!open)return;const o=Date.now();save(shifts().map(s=>s.id===open.id?{...s,out:o,noteOut:note.trim()}:s));audit(user,'Checked out',`${t(open.in)}–${t(o)} (${dur(o-open.in)})${note.trim()?' — '+note.trim():''}`);setNote('')}
 const today=total(mine,sod(now),Infinity,now),week=total(mine,sow(now),Infinity,now)
 return <><div className={'clock card flat'+(open?' on':'')}><div className="ck-top"><div><p className="eyebrow">{new Date(now).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p><div className="ck-now">{new Date(now).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'})}</div></div><span className={'ck-pill'+(open?' on':'')}>{open?'● On shift':'Off shift'}</span></div>
  {open?<div className="ck-elapsed"><small>Checked in at {t(open.in)}{open.noteIn?` · “${open.noteIn}”`:''}</small><b>{(()=>{const s=Math.floor((now-open.in)/1000);return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`})()}</b></div>:<p className="muted ck-hint">Tap Check in when you start your first job.</p>}
  <input className="ck-note" value={note} onChange={e=>setNote(e.target.value)} placeholder={open?'Note for check-out (optional)':'Note for check-in (optional)'}/>
  {preview&&<p className="muted ck-hint">Preview only. Clock punches are not saved in this view.</p>}
  {open?<button className="ck-btn out" onClick={checkOut} disabled={preview}>Check out</button>:<button className="ck-btn" onClick={checkIn} disabled={preview}>Check in</button>}
  <div className="ck-stats"><div><b>{dur(today)}</b><span>Today</span></div><div><b>{dur(week)}</b><span>This week</span></div><div><b>{mine.filter(s=>s.in>=sow(now)).length}</b><span>Shifts this week</span></div></div></div>
  <h3 className="h3l">Recent shifts</h3><div className="tbl"><table><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Notes</th></tr></thead><tbody>{mine.slice(0,10).map(s=><tr key={s.id}><td>{dstr(s.in)}</td><td>{t(s.in)}</td><td>{s.out?t(s.out):<span className="badge b-on">On shift</span>}</td><td>{dur((s.out??now)-s.in)}</td><td><small className="muted">{[s.noteIn,s.noteOut].filter(Boolean).join(' / ')}{s.edits?.length?` · corrected by admin`:''}</small></td></tr>)}</tbody></table></div></>}

export function Attendance({user}){const[all,setAll]=useState(shifts);const td=iso(Date.now());const[f,setF]=useState({emp:'all',from:iso(sow(Date.now())-7*864e5),to:td});const[ed,setEd]=useState(null);const now=Date.now()
 const from=sod(f.from+'T00:00'),to=sod(f.to+'T00:00')+864e5
 const list=all.filter(s=>(f.emp==='all'||s.emp===f.emp)&&s.in<to&&(s.out??now)>=from).sort((a,b)=>b.in-a.in)
 const onNow=EMPS.map(e=>({...e,open:all.find(s=>s.emp===e.id&&!s.out)}))
 const tot=EMPS.map(e=>({...e,ms:total(all.filter(s=>s.emp===e.id),from,to,now)})).filter(e=>f.emp==='all'||e.id===f.emp)
 const toLocal=ts=>ts?new Date(ts-new Date(ts).getTimezoneOffset()*6e4).toISOString().slice(0,16):''
 const saveEdit=()=>{if(user?.preview)return alert('Preview only. Switch back to Admin before editing attendance.');if(!ed.reason.trim())return alert('A reason is required.');const nin=new Date(ed.in).getTime(),nout=ed.out?new Date(ed.out).getTime():null;if(nout&&nout<=nin)return alert('Check-out must be after check-in.')
  const old=all.find(s=>s.id===ed.id);const v=all.map(s=>s.id===ed.id?{...s,in:nin,out:nout,edits:[...(s.edits||[]),{by:user.name,ts:Date.now(),reason:ed.reason.trim(),before:{in:old.in,out:old.out}}]}:s);setAll(v);SET('md_shifts',v)
  audit(user,'Attendance corrected',`${old.name} ${dstr(old.in)}: ${t(old.in)}–${old.out?t(old.out):'open'} → ${t(nin)}–${nout?t(nout):'open'} — ${ed.reason.trim()}`);setEd(null)}
 const exp=()=>csv(`attendance-${f.from}-to-${f.to}.csv`,list.map(s=>({employee:s.name,date:iso(s.in),check_in:new Date(s.in).toISOString(),check_out:s.out?new Date(s.out).toISOString():'',hours:hrs((s.out??now)-s.in),open:!s.out,note_in:s.noteIn,note_out:s.noteOut,corrections:(s.edits||[]).map(e=>`${e.by}: ${e.reason}`).join(' | ')})))
 return <><div className="onshift">{onNow.map(e=><div key={e.id} className={'os '+(e.open?'on':'')}><i/>{e.name}<small>{e.open?`since ${t(e.open.in)}`:'off'}</small></div>)}</div>
  <div className="toolbar"><div className="filters"><select aria-label="Employee" value={f.emp} onChange={e=>setF({...f,emp:e.target.value})}><option value="all">All employees</option>{EMPS.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><input type="date" aria-label="From" value={f.from} onChange={e=>setF({...f,from:e.target.value})}/><input type="date" aria-label="To" value={f.to} onChange={e=>setF({...f,to:e.target.value})}/></div><button className="link" onClick={exp}>Export CSV</button></div>
  <div className="stats sm">{tot.map(e=><div key={e.id}><b>{hrs(e.ms)}</b><span>{e.name} · hrs</span></div>)}</div>
  {ed&&<div className="panel opsform"><h3>Correct entry — {ed.name}</h3><div className="two"><label>Check in<input type="datetime-local" value={ed.in} onChange={x=>setEd({...ed,in:x.target.value})}/></label><label>Check out<input type="datetime-local" value={ed.out} onChange={x=>setEd({...ed,out:x.target.value})}/></label></div><label>Reason (required, logged)<input value={ed.reason} onChange={x=>setEd({...ed,reason:x.target.value})} placeholder="e.g. Forgot to check out after last job"/></label><div className="grow"><button className="pill" onClick={saveEdit}>Save correction</button><button className="link" onClick={()=>setEd(null)}>Cancel</button></div></div>}
  <div className="tbl"><table><thead><tr><th>Employee</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Notes</th><th></th></tr></thead><tbody>{list.length?list.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td className="nowrap">{dstr(s.in)}</td><td>{t(s.in)}</td><td>{s.out?t(s.out):<span className="badge b-on">On shift</span>}</td><td>{dur((s.out??now)-s.in)}</td><td><small className="muted">{[s.noteIn,s.noteOut].filter(Boolean).join(' / ')}{s.edits?.length?<><br/>Corrected: {s.edits.at(-1).reason} ({s.edits.at(-1).by})</>:''}</small></td><td><button className="link" onClick={()=>setEd({id:s.id,name:s.name,in:toLocal(s.in),out:toLocal(s.out),reason:''})}>Correct</button></td></tr>):<tr><td colSpan="7" className="muted">No shifts in range.</td></tr>}</tbody></table></div></>}

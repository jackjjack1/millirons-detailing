import { useEffect, useRef, useState } from 'react'
import { photoStore, apiAvailable, onPhotosChanged, retryPending } from './photoStore'
import { audit } from './Ops'
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}, SET=(k,v)=>localStorage.setItem(k,JSON.stringify(v))
export const jobState=id=>LS('md_jobs',{})[id]||{status:'Not started'}
const setJob=(id,v)=>{const a=LS('md_jobs',{});a[id]={...(a[id]||{}),...v};SET('md_jobs',a)}
const tm=ts=>new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
const canCam=()=>!!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia)

// ── Continuous capture sheet: camera stays open, shutter for rapid shots, strip with delete, Done ──
function CaptureSheet({label,shots,onShot,onDelete,onClose}){const v=useRef(null),stream=useRef(null),file=useRef(null);const[err,setErr]=useState('');const[flash,setFlash]=useState(false);const[busy,setBusy]=useState(0)
 useEffect(()=>{if(!canCam()){setErr('Camera needs HTTPS or localhost — use “Add from photos”.');return}let alive=true
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false}).then(s=>{if(!alive){s.getTracks().forEach(t=>t.stop());return}stream.current=s;v.current.srcObject=s;v.current.play().catch(()=>{})}).catch(e=>setErr('Camera unavailable ('+(e.name||'error')+'). Use “Add from photos”.'))
  return()=>{alive=false;stream.current?.getTracks().forEach(t=>t.stop())}},[])
 const snap=async()=>{const el=v.current;if(!el?.videoWidth)return;const c=document.createElement('canvas');c.width=el.videoWidth;c.height=el.videoHeight;c.getContext('2d').drawImage(el,0,0);setFlash(true);setTimeout(()=>setFlash(false),120);navigator.vibrate?.(20)
  setBusy(b=>b+1);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));await onShot(new File([blob],'shot.jpg',{type:'image/jpeg'}));setBusy(b=>b-1)}
 const pick=async e=>{const fs=[...e.target.files];e.target.value='';setBusy(b=>b+fs.length);for(const f of fs){await onShot(f);setBusy(b=>b-1)}}
 return <div className="cap" role="dialog" aria-label={`${label} photos`}><div className="cap-top"><b>{label} photos</b><span>{shots.length} taken{busy?` · saving ${busy}…`:''}</span><button className="cap-done" onClick={onClose}>Done</button></div>
  <div className="cap-view">{err?<p className="cap-err">{err}</p>:<video ref={v} playsInline muted autoPlay/>}{flash&&<div className="cap-flash"/>}</div>
  <div className="cap-strip">{shots.map(s=><div className="cap-th" key={s.id}><img src={s.url} alt=""/><Dot s={s.state}/><button onClick={()=>onDelete(s)} aria-label="Delete photo">×</button></div>)}</div>
  <div className="cap-bar"><button className="cap-lib" onClick={()=>file.current.click()}>Add from photos</button><input ref={file} type="file" accept="image/*" capture="environment" multiple hidden name={'cap-'+label.toLowerCase()} onChange={pick}/>
   <button className="shutter" onClick={snap} disabled={!!err} aria-label="Take photo"><span/></button><span className="cap-sp"/></div></div>}

export function useJobPhotos(id){const[ph,setPh]=useState([]);const load=()=>photoStore.list(id).then(setPh).catch(()=>setPh([]));useEffect(()=>{load();return onPhotosChanged(b=>b===id&&load())},[id]);return[ph,load]}
function SyncStatus({ph}){const[api,setApi]=useState(null);useEffect(()=>{apiAvailable().then(setApi)},[]);const c=k=>ph.filter(p=>p.state===k).length,up=c('uploading')+c('pending'),fail=c('failed')
 if(api===null)return null;if(!api)return <small className="sync local">● Saved on this device only — cloud storage not available here.</small>
 return <small className={'sync '+(fail?'fail':up?'up':'ok')}>{fail?<>● {fail} upload{fail>1?'s':''} waiting to retry <button className="link tiny" onClick={()=>retryPending()}>Retry now</button></>:up?`● Uploading ${up}…`:(ph.length?`● All ${ph.length} photo${ph.length===1?'':'s'} backed up to cloud`:'● Cloud backup on')}</small>}
const Dot=({s})=><i className={'pdot '+(s||'')} title={s}/>

// ── Employee job workflow ──
export function JobPanel({b,user}){const[job,setJobS]=useState(()=>jobState(b.id));const[ph,load]=useJobPhotos(b.id);const[cap,setCap]=useState(null);const[err,setErr]=useState('')
 const preview=!!user?.preview
 const upd=v=>{if(preview)return;setJob(b.id,v);setJobS(jobState(b.id))}
 const before=ph.filter(p=>p.group==='before'),after=ph.filter(p=>p.group==='after')
 const shot=group=>async f=>{if(preview)return setErr('Preview only. Photos are not saved in this view.');try{await photoStore.put(b.id,group,f,{by:user.name});await load()}catch(e){setErr(e.message)}}
 const del=async p=>{await photoStore.remove(p.id);await load()}
 const step=job.status==='Completed'?4:job.status!=='In progress'?0:!before.length?1:!after.length?(job.working?3:2):3
 const start=()=>{upd({status:'In progress',started:Date.now(),by:user.name});audit(user,'Job started',`${b.id}`)}
 const complete=()=>{if(!before.length||!after.length)return setErr('Add at least one Before and one After photo.');upd({status:'Completed',completed:Date.now()});audit(user,'Job completed',`${b.id} · ${before.length} before / ${after.length} after photos`)}
 const S=['Start job','Before photos','Do the work','After photos','Complete']
 return <div className="card flat jobpanel"><div className="jp-h"><h3>Job</h3><span className={'spill s-'+job.status.toLowerCase().replace(/\s+/g,'-')}>{job.status}</span></div>
  <ol className="jp-steps">{S.map((s,i)=><li key={s} className={i<step||job.status==='Completed'?'done':i===step?'cur':''}><span>{i<step||job.status==='Completed'?'✓':i+1}</span>{s}</li>)}</ol>
  {preview&&<p className="muted">Preview only. Job updates and photos are not saved in this view.</p>}
  {job.status==='Not started'&&<button className="ck-btn" onClick={start} disabled={preview}>Start job</button>}
  {job.status==='In progress'&&<><div className="jp-groups">{[['before','Before',before],['after','After',after]].map(([g,l,list])=><div key={g} className="jp-g"><div className="jp-gh"><b>{l}</b><small>{list.length} photo{list.length===1?'':'s'}</small></div><div className="jp-th">{list.slice(-4).map(p=><span className="jp-ti" key={p.id}><img src={p.url} alt=""/><Dot s={p.state}/></span>)}{!list.length&&<span className="muted">None yet</span>}</div><button className="pill sm" onClick={()=>setCap(g)} disabled={preview}>📷 {list.length?'Add more':`Take ${l.toLowerCase()} photos`}</button></div>)}</div>
   {before.length>0&&!after.length&&<p className="muted">Before photos saved. Do the work, then take After photos.</p>}
   {err&&<p className="err">{err}</p>}<button className="ck-btn out" disabled={preview||!before.length||!after.length} onClick={complete}>Complete job</button></>}
  {job.status==='Completed'&&<p className="muted">Completed {tm(job.completed)} · {before.length} before / {after.length} after photos.</p>}
  <SyncStatus ph={ph}/>
  {cap&&<CaptureSheet label={cap==='before'?'Before':'After'} shots={cap==='before'?before:after} onShot={shot(cap)} onDelete={del} onClose={()=>setCap(null)}/>}</div>}

// ── Before / After gallery (customer + admin + employee) ──
export function BeforeAfter({b,hideEmpty}){const[ph]=useJobPhotos(b.id);const[lb,setLb]=useState(null);const[i,setI]=useState(0)
 const before=ph.filter(p=>p.group==='before'),after=ph.filter(p=>p.group==='after')
 if(!ph.length)return hideEmpty?null:<div className="card flat"><h3>Before &amp; After</h3><p className="muted">Photos appear here once your detailer starts the job.</p></div>
 const pairs=Math.max(before.length,after.length),bi=before[Math.min(i,before.length-1)],ai=after[Math.min(i,after.length-1)]
 return <div className="card flat ba"><h3>Before &amp; After</h3>
  <div className="ba-side"><figure>{bi?<img src={bi.url} alt="Before" onClick={()=>setLb(bi)}/>:<div className="ba-ph">No before</div>}<figcaption>Before{bi?` · ${tm(bi.ts)}`:''}</figcaption></figure><figure>{ai?<img src={ai.url} alt="After" onClick={()=>setLb(ai)}/>:<div className="ba-ph">Coming soon</div>}<figcaption>After{ai?` · ${tm(ai.ts)}`:''}</figcaption></figure></div>
  {pairs>1&&<div className="ba-nav"><button className="calnav" disabled={i===0} onClick={()=>setI(i-1)}>‹</button><small>{i+1} / {pairs}</small><button className="calnav" disabled={i>=pairs-1} onClick={()=>setI(i+1)}>›</button></div>}
  {[['Before',before],['After',after]].map(([l,list])=>list.length>0&&<div key={l}><small className="muted">{l} · {list.length}</small><div className="ba-grid">{list.map(p=><button key={p.id} onClick={()=>setLb(p)}><img src={p.url} alt={l}/></button>)}</div></div>)}
  {lb&&<div className="lightbox" onClick={()=>setLb(null)}><img src={lb.url} alt=""/><p className="lb-cap">{lb.group==='before'?'Before':'After'} · {tm(lb.ts)}{lb.by?` · ${lb.by}`:''}</p><button aria-label="Close">×</button></div>}</div>}

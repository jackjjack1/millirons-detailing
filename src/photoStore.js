// photoStore — put / list / remove for job photos (bookingId + group 'before'|'after').
import {apiFetch} from './apiOrigin.js'
// Strategy: save to IndexedDB first (offline-safe), then upload to Cloudflare R2 via /api/photos.
// If /api isn't there (e.g. local python http.server → 404/501) we run local-only. Failed uploads are retried
// automatically (on reconnect, every 30 s, and on next app load).
export async function compress(file,max=1600,q=.78){let src,w,h;try{src=await createImageBitmap(file);w=src.width;h=src.height}catch{const url=URL.createObjectURL(file);src=await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=url});w=src.width;h=src.height}
 const k=Math.min(1,max/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(src,0,0,c.width,c.height);return await new Promise(r=>c.toBlob(r,'image/jpeg',q))}
// ── API detection ──
let apiP=null
export function apiAvailable(force){if(!apiP||force)apiP=apiFetch('/api/photos?bookingId=__probe',{cache:'no-store'}).then(async r=>r.ok&&(r.headers.get('content-type')||'').includes('json')&&(await r.json()).ok===true).catch(()=>false);return apiP}
// ── IndexedDB ──
const DB='md_photos',ST='photos'
const db=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(ST)){const s=d.createObjectStore(ST,{keyPath:'id'});s.createIndex('booking','bookingId')}};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
const tx=async(mode,fn)=>{const d=await db();return new Promise((res,rej)=>{const t=d.transaction(ST,mode),s=t.objectStore(ST);const req=fn(s);t.oncomplete=()=>res(req?.result);t.onerror=()=>rej(t.error)})}
const getAll=b=>tx('readonly',s=>s.index('booking').getAll(b)), getOne=id=>tx('readonly',s=>s.get(id)), save=rec=>tx('readwrite',s=>s.put(rec)), del=id=>tx('readwrite',s=>s.delete(id))
const urls=new Map(),listeners=new Set()
export const onPhotosChanged=f=>{listeners.add(f);return()=>listeners.delete(f)}
const emit=b=>listeners.forEach(f=>f(b))
const objUrl=r=>{if(!urls.has(r.id))urls.set(r.id,URL.createObjectURL(r.blob));return urls.get(r.id)}
// ── Upload one local record ──
async function upload(rec){const fd=new FormData();fd.append('bookingId',rec.bookingId);fd.append('group',rec.group);fd.append('ts',String(rec.ts));fd.append('by',rec.by||'');fd.append('clientId',rec.id);fd.append('file',rec.blob,'photo.jpg')
 const r=await apiFetch('/api/photos',{method:'POST',body:fd});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
async function trySync(rec){if(!(await apiAvailable())){const n={...rec,state:'local'};await save(n);emit(rec.bookingId);return n}await save({...rec,state:'uploading'});emit(rec.bookingId)
 try{const j=await upload(rec);const n={...rec,state:'synced',remoteKey:j.key,remoteUrl:j.url,error:''};await save(n);emit(rec.bookingId);return n}
 catch(e){const n={...rec,state:'failed',error:e.message,tries:(rec.tries||0)+1};await save(n);emit(rec.bookingId);return n}}
export async function retryPending(){if(!(await apiAvailable(true)))return 0;const all=await tx('readonly',s=>s.getAll());const todo=(all||[]).filter(r=>r.state!=='synced');for(const r of todo)await trySync(r);return todo.length}
if(typeof window!=='undefined'){addEventListener('online',()=>retryPending());setInterval(()=>retryPending(),30000);setTimeout(()=>retryPending(),1500)}
// ── Public API ──
export const photoStore={
 async put(bookingId,group,file,meta={}){const blob=await compress(file);const rec={id:`${bookingId}-${group}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,bookingId,group,ts:Date.now(),by:meta.by||'',size:blob.size,blob,state:'pending'};await save(rec);emit(bookingId);trySync(rec);return rec},
 async list(bookingId){const local=(await getAll(bookingId))||[];let remote=[];if(await apiAvailable()){try{const r=await apiFetch('/api/photos?bookingId='+encodeURIComponent(bookingId),{cache:'no-store'});if(r.ok)remote=(await r.json()).photos||[]}catch{}}
  const seen=new Set(local.filter(l=>l.remoteKey).map(l=>l.remoteKey))
  const out=[...local.map(l=>({id:l.id,bookingId,group:l.group,ts:l.ts,by:l.by,size:l.size,url:objUrl(l),state:l.state,remoteKey:l.remoteKey,error:l.error})),
   ...remote.filter(r=>!seen.has(r.key)).map(r=>({...r,id:r.key,state:'synced',remoteKey:r.key}))]
  return out.sort((a,b)=>a.ts-b.ts)},
 async remove(id){const rec=await getOne(id);const key=rec?.remoteKey||(id.startsWith('bookings/')?id:null);if(key&&(await apiAvailable())){try{await apiFetch('/api/photos/'+key,{method:'DELETE'})}catch{}}
  if(rec){await del(id);if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id)}emit(rec.bookingId)}}}
// ── Application documents (vehicle proof / registration / insurance) ──
export async function uploadDocs(applicationId,van){if(!(await apiAvailable()))return{van,uploaded:0,mode:'local'};let n=0
 const send=async(f,type)=>{if(f.remoteUrl)return f;try{const blob=await (await fetch(f.data)).blob();const fd=new FormData();fd.append('applicationId',applicationId);fd.append('type',type);fd.append('file',blob,f.name||'file');const r=await apiFetch('/api/documents',{method:'POST',body:fd});if(!r.ok)throw 0;const j=await r.json();n++;return{...f,remoteUrl:j.url,remoteKey:j.key}}catch{return{...f,uploadFailed:true}}}
 const photos=[];for(const f of van.photos)photos.push(await send(f,'vehicle'))
 const docs=[];for(const f of van.docs)docs.push(await send(f,/insur/i.test(f.name)?'insurance':/reg/i.test(f.name)?'registration':'other'))
 return{van:{...van,photos,docs},uploaded:n,mode:'r2'}}

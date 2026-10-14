import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { detailers } from './data'
export const linkFor=id=>`${location.origin}/book/${id}`
export const hashLinkFor=id=>`${location.origin}/#/book?detailer=${id}`
// Path link /book/<slug> → booking flow (needs host SPA rewrite, e.g. Cloudflare Pages public/_redirects)
export function pathToHash(){const j=location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)\/?$/);if(j&&!location.hash.startsWith('#/invite')){location.hash='/invite/'+j[1];return}const m=location.pathname.match(/^\/book\/([a-z0-9-]+)\/?$/i);if(m&&!location.hash.startsWith('#/book')){const d=detailers.find(x=>x.id===m[1].toLowerCase());location.hash=d?`/book?detailer=${d.id}`:'/book'}}
function useQR(text){const[src,setSrc]=useState('');useEffect(()=>{QRCode.toDataURL(text,{margin:1,width:360,color:{dark:'#000000',light:'#ffffff'}}).then(setSrc)},[text]);return src}
function LinkCard({d,compact}){const url=linkFor(d.id),qr=useQR(url);const[msg,setMsg]=useState('')
 const copy=async(t=url)=>{try{await navigator.clipboard.writeText(t);setMsg('Copied!')}catch{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();setMsg('Copied!')}setTimeout(()=>setMsg(''),1800)}
 const share=async()=>{if(navigator.share){try{await navigator.share({title:`Book ${d.name} — Millirons Detailing`,text:`Book a mobile detail with ${d.name.split(' ')[0]} in metro Atlanta:`,url})}catch{}}else copy()}
 return <div className={'card flat linkcard'+(compact?' compact':'')}><div className="lc-main"><div className="lc-h"><div className="avatar" style={{background:d.grad}}>{d.name.split(' ').map(x=>x[0]).join('')}</div><div><b>{compact?d.name:'My booking link'}</b><small className="muted">{compact?`★ ${d.rating} · ${d.city}`:'Customers who use it book you directly.'}</small></div></div>
  <div className="lc-url"><code>{url.replace(/^https?:\/\//,'')}</code></div>
  <div className="grow"><button className="pill sm" onClick={()=>copy()}>{msg||'Copy link'}</button><button className="pill sm light-b" onClick={share}>Share…</button>{qr&&<a className="link" href={qr} download={`millirons-${d.id}-qr.png`}>Download QR</a>}</div>
  <small className="muted">Fallback (works on any host): <button className="link tiny" onClick={()=>copy(hashLinkFor(d.id))}>{hashLinkFor(d.id).replace(/^https?:\/\//,'')}</button></small>
  {!compact&&<div className="tips"><b>Put it in your bio</b><ul><li><b>Instagram:</b> Edit profile → Links → Add external link → paste. Add “Book me ↓” to your bio.</li><li><b>TikTok:</b> Edit profile → Website (needs 1K followers / business account) — or pin a video with “link in bio”.</li><li>Print the QR on business cards or a dashboard sign so neighbors can scan while you work.</li></ul></div>}</div>
  {qr&&<img className="lc-qr" src={qr} alt={`QR code for ${url}`}/>}</div>}
export function MyBookingLink({user}){const d=detailers.find(x=>x.id===user.detailer);return d?<LinkCard d={d}/>:null}
export function AllBookingLinks(){return <><p className="muted">Each detailer’s personal booking link. Path links need the host SPA rule (<code>/book/*  /index.html  200</code> in <code>_redirects</code>); the # fallback works everywhere.</p><div className="links-grid">{detailers.map(d=><LinkCard key={d.id} d={d} compact/>)}</div></>}
export function BookingWith({id,onChange}){const d=detailers.find(x=>x.id===id);if(!d)return null
 return <div className="bwith"><div className="avatar" style={{background:d.grad}}>{d.name.split(' ').map(x=>x[0]).join('')}</div><div className="bw-t"><small className="muted">Booking with</small><b>{d.name}</b><small>★ {d.rating} ({d.reviews} reviews) · {d.city}</small></div>
  <label className="bw-sel">Change<select value={id} onChange={e=>onChange(e.target.value)}>{detailers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>}

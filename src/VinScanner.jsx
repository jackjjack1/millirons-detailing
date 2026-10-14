import { useEffect, useRef, useState } from 'react'
// VIN barcodes on door-jamb / windshield stickers are usually Code 39 (sometimes Data Matrix / QR).
const VIN_RE=/[A-HJ-NPR-Z0-9]{17}/
export const extractVin=t=>{const c=(t||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const m=c.match(VIN_RE)||c.replace(/^I/,'').match(VIN_RE);return m?m[0]:null}
const canCamera=()=>!!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia)
const isMobile=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||matchMedia('(pointer:coarse)').matches
async function reader(){const { BrowserMultiFormatReader }=await import('@zxing/browser');const { DecodeHintType, BarcodeFormat }=await import('@zxing/library')
 const h=new Map();h.set(DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.CODE_39,BarcodeFormat.CODE_128,BarcodeFormat.DATA_MATRIX,BarcodeFormat.QR_CODE,BarcodeFormat.PDF_417]);h.set(DecodeHintType.TRY_HARDER,true);return new BrowserMultiFormatReader(h)}
export default function VinScanner({onVin}){const[open,setOpen]=useState(false);const[msg,setMsg]=useState('');const v=useRef(null),ctl=useRef(null),file=useRef(null)
 const cam=canCamera(),mobile=isMobile()
 useEffect(()=>{if(!open)return;let stop=false;(async()=>{try{setMsg('Point the camera at the VIN barcode on the driver door jamb or windshield.');const r=await reader();ctl.current=await r.decodeFromConstraints({video:{facingMode:{ideal:'environment'},width:{ideal:1920}}},v.current,(res)=>{if(stop||!res)return;const vin=extractVin(res.getText());if(vin){stop=true;ctl.current?.stop();onVin(vin);setOpen(false)}else setMsg(`Read "${res.getText()}" — not a valid VIN, keep scanning…`)})}catch(e){setMsg('Camera unavailable ('+(e.name||e.message)+'). Use upload or type the VIN.')}})();return()=>{stop=true;ctl.current?.stop()}},[open])
 const upload=async e=>{const f=e.target.files?.[0];if(!f)return;setMsg('Reading photo…');try{const r=await reader();const url=URL.createObjectURL(f);const res=await r.decodeFromImageUrl(url);URL.revokeObjectURL(url);const vin=extractVin(res.getText());if(vin){onVin(vin);setMsg('VIN found: '+vin)}else setMsg('Barcode found but no valid VIN. Please type it.')}catch{setMsg('No barcode found in photo. Try a closer, sharper shot, or type the VIN.')}e.target.value=''}
 return <div className="vinscan">
  <div className="vinbtns">{cam&&<button type="button" className="pill sm" onClick={()=>setOpen(true)}>📷 Scan VIN{mobile?'':' (webcam)'}</button>}<button type="button" className="link" onClick={()=>file.current.click()}>{mobile?'Use a photo':'Upload VIN photo'}</button><input ref={file} type="file" accept="image/*" capture={mobile?'environment':undefined} hidden onChange={upload}/></div>
  {!cam&&<small className="muted">Live camera scan needs HTTPS or localhost. Upload a photo or type the VIN below.</small>}
  {msg&&!open&&<small className="muted block">{msg}</small>}
  {open&&<div className="scanmodal" role="dialog"><div className="scanbox"><video ref={v} playsInline muted/><div className="reticle"/><p>{msg}</p><button type="button" className="pill sm light" onClick={()=>setOpen(false)}>Cancel — type it instead</button></div></div>}
 </div>}

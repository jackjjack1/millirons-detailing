import { useEffect, useState } from 'react'
import VinScanner, { extractVin } from './VinScanner'
import { COLORS, TIERS, decodeVin, imageUrl, loadGarage, saveGarage, maskVin, titleCase } from './garage'

function Silhouette({type}){const path={
  Truck:'M8 70h120l8-20h36v18h14v12H8z M20 80a10 10 0 1020 0 10 10 0 10-20 0 M100 80a10 10 0 1020 0 10 10 0 10-20 0',
  SUV:'M12 72c8-22 28-34 60-34 26 0 42 8 52 22l10 12H12z M24 82a10 10 0 1020 0 10 10 0 10-20 0 M110 82a10 10 0 1020 0 10 10 0 10-20 0',
  Van:'M10 40h70l40 18v22H10z M26 82a10 10 0 1020 0 10 10 0 10-20 0 M114 82a10 10 0 1020 0 10 10 0 10-20 0',
  Coupe:'M20 70c10-24 40-32 70-24 18 5 28 16 34 24H20z M34 82a9 9 0 1018 0 9 9 0 10-18 0 M110 82a9 9 0 1018 0 9 9 0 10-18 0',
}[type]||'M16 70c12-26 44-34 74-26 20 5 32 16 38 26H16z M32 82a9 9 0 1018 0 9 9 0 10-18 0 M112 82a9 9 0 1018 0 9 9 0 10-18 0'
 return <svg viewBox="0 0 160 100" className="sil"><path d={path} fill="currentColor"/></svg>}

function CarImg({v}){const[ok,setOk]=useState(true),[src,setSrc]=useState(()=>imageUrl(v))
 useEffect(()=>{setOk(true);setSrc(imageUrl(v))},[v.make,v.model,v.year,v.color])
 return <div className="gimg">{ok?<img src={src} alt={`${v.year} ${v.make} ${v.model}`} onError={()=>setOk(false)} loading="lazy"/>:<Silhouette type={v.type}/>}</div>}

function ColorPicker({value,onChange}){return <div className="swatches">{COLORS.map(c=><button type="button" key={c.id} className={'swatchc '+(value===c.id?'on':'')} style={{'--c':c.hex}} title={c.label} onClick={()=>onChange(c.id)} aria-label={c.label}/>)}</div>}

function GarageCard({v,selected,onSelect,onDefault,onRemove,compact}){
 const tier=TIERS.find(t=>t.id===v.tier)
 return <article className={'gcard '+(selected?'sel':'')+(v.isDefault?' def':'')} onClick={()=>onSelect?.(v)}>
  <CarImg v={v}/><div className="gmeta">
   <h3>{v.year} {v.make} {v.model}</h3>
   {v.trim&&<p className="muted">{v.trim}</p>}
   <div className="gtags"><span className="chip">{v.type}</span><span className="chip">{tier?.name||v.tier}</span><span className="chip">{COLORS.find(c=>c.id===v.color)?.label||v.color}</span>{v.isDefault&&<span className="chip on">Default</span>}</div>
   <p className="vinm">VIN {maskVin(v.vin)}</p>
   {!compact&&<div className="grow" onClick={e=>e.stopPropagation()}>
    {!v.isDefault&&<button type="button" className="link" onClick={()=>onDefault(v.id)}>Set default</button>}
    <button type="button" className="link danger" onClick={()=>onRemove(v.id)}>Remove</button>
   </div>}
  </div></article>}

export function useGarage(user){
 const[list,setList]=useState(()=>loadGarage(user))
 useEffect(()=>{setList(loadGarage(user))},[user?.email])
 const write=next=>{setList(next);saveGarage(user,next);return next}
 const upsert=car=>{let next=[...list];const i=next.findIndex(x=>x.vin===car.vin);if(i>=0)next[i]={...next[i],...car};else{if(!next.length)car.isDefault=true;next=[car,...next]};return write(next)}
 const remove=id=>{const next=list.filter(x=>x.id!==id);if(next.length&&!next.some(x=>x.isDefault))next[0]={...next[0],isDefault:true};return write(next)}
 const setDefault=id=>write(list.map(x=>({...x,isDefault:x.id===id})))
 return {list,upsert,remove,setDefault,write}
}

function AddFlow({onDone,onCancel}){
 const[vin,setVin]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[draft,setDraft]=useState(null),[color,setColor]=useState('black')
 const decode=async v=>{const clean=extractVin(v)||v.toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)){setErr('Enter a valid 17-character VIN.');return}
  setBusy(true);setErr('');try{const d=await decodeVin(clean);setDraft({...d,id:'veh_'+Date.now().toString(36),color:'black'});setColor('black')}catch(e){setErr(e.message||'Could not decode VIN')}finally{setBusy(false)}}
 const save=()=>{onDone({...draft,color});setDraft(null);setVin('')}
 if(draft)return <div className="addpanel"><CarImg v={{...draft,color}}/><h3>Confirm color</h3><p className="muted">{draft.year} {draft.make} {draft.model} · {draft.type} · VIN {maskVin(draft.vin)}</p><p>VINs don’t encode paint — pick a color.</p><ColorPicker value={color} onChange={c=>{setColor(c);setDraft({...draft,color:c})}}/><div className="grow"><button type="button" className="pill" onClick={save}>Add to Garage</button><button type="button" className="link" onClick={()=>{setDraft(null);onCancel?.()}}>Cancel</button></div></div>
 return <div className="addpanel"><h3>Add a vehicle</h3><p className="muted">Scan, upload, or type a VIN. We’ll decode year, make, model and size from NHTSA.</p>
  <VinScanner onVin={v=>{setVin(v);decode(v)}}/><label>VIN<input value={vin} onChange={e=>setVin(e.target.value.toUpperCase())} placeholder="17 characters" maxLength={17}/></label>
  {err&&<p className="err">{err}</p>}<div className="grow"><button type="button" className="pill" disabled={busy||vin.length<11} onClick={()=>decode(vin)}>{busy?'Decoding…':'Decode VIN'}</button><button type="button" className="link" onClick={onCancel}>Cancel</button></div></div>}

export function GaragePicker({user,value,onChange}){
 const {list,upsert,remove,setDefault}=useGarage(user);const[adding,setAdding]=useState(!list.length)
 useEffect(()=>{if(!value&&list.length){const d=list.find(x=>x.isDefault)||list[0];onChange(d)}},[list,value,onChange])
 return <div className="garage"><div className="garage-h"><h3>Your Garage</h3><button type="button" className="pill sm" onClick={()=>setAdding(true)}>+ Add vehicle</button></div>
  {adding&&<AddFlow onCancel={()=>setAdding(false)} onDone={car=>{upsert(car);onChange(car);setAdding(false)}}/>}
  <div className="ggrid">{list.map(v=><GarageCard key={v.id} v={v} selected={value?.id===v.id||value?.vin===v.vin} onSelect={onChange} onDefault={setDefault} onRemove={id=>{remove(id);if(value?.id===id)onChange(null)}}/>)}</div>
  {!list.length&&!adding&&<p className="muted">No vehicles yet — add one with Scan VIN.</p>}</div>}

export function GarageDashboard({user}){
 const {list,upsert,remove,setDefault}=useGarage(user);const[adding,setAdding]=useState(false)
 return <div className="garage dash"><div className="garage-h"><h2 className="h2l">My Garage</h2><button type="button" className="pill sm" onClick={()=>setAdding(true)}>+ Add vehicle</button></div>
  {adding&&<AddFlow onCancel={()=>setAdding(false)} onDone={car=>{upsert(car);setAdding(false)}}/>}
  <div className="ggrid">{list.map(v=><GarageCard key={v.id} v={v} onSelect={()=>{}} onDefault={setDefault} onRemove={remove}/>)}</div>
  {!list.length&&!adding&&<p className="muted">Scan a VIN to add your first car. Sample tip: try 1C4RJFAG0FC625797 (2015 Jeep Grand Cherokee).</p>}</div>}

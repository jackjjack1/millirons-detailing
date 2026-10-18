// Garage helpers — NHTSA vPIC decode + imagin.studio images
import { assessVin } from './vin.js'
import { apiFetch } from './apiOrigin.js'
export const COLORS=[
  {id:'black',label:'Black',hex:'#1d1d1f',paint:'black'},
  {id:'white',label:'White',hex:'#f5f5f7',paint:'white'},
  {id:'silver',label:'Silver',hex:'#c7c7cc',paint:'silver'},
  {id:'gray',label:'Gray',hex:'#8e8e93',paint:'gray'},
  {id:'red',label:'Red',hex:'#ff3b30',paint:'red'},
  {id:'blue',label:'Blue',hex:'#007aff',paint:'blue'},
  {id:'green',label:'Green',hex:'#34c759',paint:'green'},
  {id:'beige',label:'Beige',hex:'#c4a882',paint:'beige'},
]
// Body classes for the garage. Prices and size surcharges live in src/data.js.
export const TIERS=[
  {id:'compact',name:'Compact / Coupe'},
  {id:'sedan',name:'Sedan / Hatch'},
  {id:'suv',name:'SUV / Crossover'},
  {id:'truck',name:'Truck / Pickup'},
  {id:'van',name:'Van / 3-Row'},
  {id:'xl',name:'XL / Oversized'},
]
export function mapBody(body='',make='',model=''){
  const t=`${body} ${model}`.toLowerCase()
  if(/pickup|truck|crew cab|chassis/.test(t))return {type:'Truck',tier:'truck'}
  if(/van|minivan|passenger van/.test(t))return {type:'Van',tier:'van'}
  if(/suv|sport utility|crossover|mpv|multipurpose/.test(t))return {type:'SUV',tier:'suv'}
  if(/coupe/.test(t))return {type:'Coupe',tier:'compact'}
  if(/hatch|wagon/.test(t))return {type:'Hatch',tier:'sedan'}
  if(/convertible|roadster/.test(t))return {type:'Convertible',tier:'compact'}
  if(/sedan|saloon/.test(t))return {type:'Sedan',tier:'sedan'}
  if(/bus|motorhome|trailer/.test(t))return {type:'XL',tier:'xl'}
  return {type:'Sedan',tier:'sedan'}
}
export const maskVin=v=>!v||v.length<8?v:`${v.slice(0,3)}••••${v.slice(-4)}`
export function garageKey(user){return `md_garage_${user?.email||'guest'}`}
export function loadGarage(user){try{return JSON.parse(localStorage.getItem(garageKey(user))||'[]')}catch{return[]}}
export function saveGarage(user,list){localStorage.setItem(garageKey(user),JSON.stringify(list))}
const GARAGE_LIMIT = 12
function clip(value, max){return String(value ?? '').trim().slice(0, max)}
export function cleanGarageList(list){
  const rows = Array.isArray(list) ? list : []
  const out = []
  const seen = new Set()
  for (const raw of rows) {
    if (out.length >= GARAGE_LIMIT || !raw || typeof raw !== 'object') continue
    const assessed = assessVin(raw.vin)
    if (!assessed.ok || !assessed.vin || seen.has(assessed.vin)) continue
    seen.add(assessed.vin)
    const tier = TIERS.some(t => t.id === raw.tier) ? raw.tier : 'sedan'
    const color = COLORS.some(c => c.id === raw.color) ? raw.color : 'black'
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(raw.id) ? raw.id : `veh_${assessed.vin.slice(0, 8).toLowerCase()}`
    out.push({
      id, vin: assessed.vin, year: clip(raw.year, 8), make: clip(raw.make, 40), model: clip(raw.model, 40),
      trim: clip(raw.trim, 60), bodyClass: clip(raw.bodyClass, 80), type: clip(raw.type, 24), tier, color,
      isDefault: raw.isDefault === true,
    })
  }
  if (out.length && !out.some(car => car.isDefault)) out[0].isDefault = true
  let used = false
  for (const car of out) {
    if (car.isDefault && !used) used = true
    else car.isDefault = false
  }
  return out
}
async function garageApi(path, {method = 'GET', body} = {}){
  let response
  try {
    response = await apiFetch(path, {
      method,
      cache: 'no-store',
      headers: body ? {'content-type': 'application/json'} : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Could not reach the server.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not save those vehicles.')
  return data
}
export const fetchGarage = () => garageApi('/api/garage')
export const putGarage = vehicles => garageApi('/api/garage', {method: 'PUT', body: {vehicles}})
export function titleCase(s){return(s||'').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}
export async function decodeVin(vin){
  const v=vin.toUpperCase().replace(/[^A-Z0-9]/g,''),r=await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`).then(x=>x.json()).then(x=>x.Results?.[0])
  if(!r)throw new Error('Decode failed')
  const err=String(r.ErrorCode||'')
  if(err.startsWith('1')&&!r.Make)throw new Error(r.ErrorText||'Invalid VIN')
  const {type,tier}=mapBody(r.BodyClass||'',r.Make||'',r.Model||'')
  return {vin:v,year:r.ModelYear||'',make:titleCase(r.Make),model:titleCase(r.Model),trim:r.Trim||'',bodyClass:r.BodyClass||'',type,tier,decodedAt:new Date().toISOString()}
}
export function imageUrl({make,model,year,color}){
  const paint=COLORS.find(c=>c.id===color)?.paint||'silver'
  const family=(model||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/ /g,'%20')
  const m=(make||'').toLowerCase().replace(/[^a-z0-9]+/g,'')
  return `https://cdn.imagin.studio/getImage?customer=img&make=${encodeURIComponent(m)}&modelFamily=${family}&modelYear=${year||''}&paintDescription=${encodeURIComponent(paint)}&zoomType=fullscreen&angle=23&width=800`
}

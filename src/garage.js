// Garage helpers — NHTSA vPIC decode + imagin.studio images
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

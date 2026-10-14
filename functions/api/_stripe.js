// Shared helpers for Stripe (REST via fetch, no SDK). Prices are recomputed server-side from src/data.js.
import {services,addons,vehicles} from '../../src/data.js'
export const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
export function priceFor(b){const s=services.find(x=>x.id===b.service);if(!s)return null;const v=vehicles.find(x=>x.id===b.vehicle);const a=addons.filter(x=>(b.addons||[]).includes(x.id))
  return {usd:s.price+(v?.add||0)+a.reduce((t,x)=>t+x.price,0),name:s.name,extras:[v&&v.name,...a.map(x=>x.name)].filter(Boolean).join(', ')}}
function enc(o,pre='',out=[]){for(const[k,v]of Object.entries(o)){if(v==null)continue;const key=pre?`${pre}[${k}]`:k;if(typeof v==='object')enc(v,key,out);else out.push(encodeURIComponent(key)+'='+encodeURIComponent(v))}return out.join('&')}
export async function stripe(env,method,path,body){const r=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},body:body?enc(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d?.error?.message||'Stripe error'),{status:r.status});return d}
export const AFFIRM_MIN_USD=50

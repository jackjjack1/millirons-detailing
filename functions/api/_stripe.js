// Shared helpers for Stripe (REST via fetch, no SDK).
// Charged amounts come only from quoteBooking() in src/data.js. Client totals are ignored.
import {quoteBooking,AFFIRM_MIN_USD} from '../../src/data.js'
export {AFFIRM_MIN_USD}
export const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
export function priceFor(b){return quoteBooking(b)}
export function paymentMethodsFor(usd){return ['card',...(usd>=AFFIRM_MIN_USD?['affirm']:[])]}
function enc(o,pre='',out=[]){for(const[k,v]of Object.entries(o)){if(v==null)continue;const key=pre?`${pre}[${k}]`:k;if(typeof v==='object')enc(v,key,out);else out.push(encodeURIComponent(key)+'='+encodeURIComponent(v))}return out.join('&')}
export async function stripe(env,method,path,body){const r=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},body:body?enc(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d?.error?.message||'Stripe error'),{status:r.status});return d}

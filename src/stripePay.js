// Stripe Checkout client. Feature-detects /api/checkout; falls back to clearly labeled demo mode.
import {apiFetch} from './apiOrigin.js'

let probe=null
export function stripeMode(){return probe||(probe=apiFetch('/api/checkout',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>d?.ok?(d.live?'live':'nokey'):'demo').catch(()=>'demo'))}
export async function startCheckout(booking){if(booking?.isTest===true)throw new Error('Test jobs are not charged.');const r=await apiFetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({booking})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.url)throw new Error(d.error||'Could not start checkout');return d}
export async function checkStatus(id){const r=await apiFetch('/api/checkout-status?session_id='+encodeURIComponent(id),{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not verify payment');return d}

// POST /api/stripe-webhook — optional. Verifies Stripe-Signature with STRIPE_WEBHOOK_SECRET; on checkout.session.completed /
// async_payment_succeeded (Affirm) writes payments/<bookingId>.json to R2 (PHOTOS bucket) as a server-side record.
import {json} from './_stripe.js'
import {isStoredTestJob} from './test-jobs.js'
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')
async function verify(raw,hdr,secret){const parts=Object.fromEntries((hdr||'').split(',').map(x=>x.split('=')));const t=parts.t,sigs=(hdr||'').split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3))
  if(!t||!sigs.length||Math.abs(Date.now()/1000-Number(t))>300)return false
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const exp=hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(`${t}.${raw}`)));return sigs.some(s=>s.length===exp.length&&[...s].reduce((d,c,i)=>d|(c.charCodeAt(0)^exp.charCodeAt(i)),0)===0)}
export async function onRequestPost({request,env}){if(!env.STRIPE_WEBHOOK_SECRET)return json({error:'STRIPE_WEBHOOK_SECRET not configured'},503)
  const raw=await request.text();if(!(await verify(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET)))return json({error:'bad signature'},400)
  const ev=JSON.parse(raw),s=ev.data?.object
  if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(ev.type)&&s){const id=s.metadata?.bookingId||s.client_reference_id
    if(s.metadata?.isTest==='true'||s.metadata?.isTest===true||await isStoredTestJob(env,id))return json({received:true})
    if(env.PHOTOS&&id&&/^MD-[A-Z0-9]{4,20}$/.test(id))await env.PHOTOS.put(`payments/${id}.json`,JSON.stringify({event:ev.type,session:s.id,paymentStatus:s.payment_status,amount:s.amount_total/100,at:new Date().toISOString(),metadata:s.metadata}),{httpMetadata:{contentType:'application/json'}})}
  return json({received:true})}

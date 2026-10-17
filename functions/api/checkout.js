// GET /api/checkout → feature probe {ok, live}. POST /api/checkout {booking} → Stripe Checkout Session (FULL payment only).
import {json,priceFor,stripe,AFFIRM_MIN_USD} from './_stripe.js'
import {previewMutationBlock} from '../_lib/auth.js'
export const onRequestGet=({env})=>json({ok:true,live:!!env.STRIPE_SECRET_KEY,affirmMinUsd:AFFIRM_MIN_USD})
export async function onRequestPost({request,env}){
  const blocked=await previewMutationBlock(request,env);if(blocked)return blocked
  if(!env.STRIPE_SECRET_KEY)return json({error:'STRIPE_SECRET_KEY not configured'},503)
  let b;try{({booking:b}=await request.json())}catch{return json({error:'bad json'},400)}
  if(!b||!/^MD-[A-Z0-9]{4,20}$/.test(b.id||''))return json({error:'bad booking id'},400)
  const p=priceFor(b);if(!p)return json({error:'unknown service'},400)
  const cents=Math.round(p.usd*100),origin=new URL(request.url).origin
  const methods=['card',...(p.usd>=AFFIRM_MIN_USD?['affirm']:[])]
  const meta={bookingId:b.id,vin:(b.vin||'').slice(0,17),vehicle:`${b.year||''} ${b.make||''} ${b.model||''}`.trim().slice(0,200),slot:`${b.date||''} ${b.time||''}`.trim(),detailer:b.detailer||''}
  try{const s=await stripe(env,'POST','checkout/sessions',{mode:'payment',payment_method_types:methods,
    line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:cents,product_data:{name:`Millirons Detailing — ${p.name}`,description:(p.extras?p.extras+' · ':'')+meta.slot||undefined}}}],
    customer_email:/^\S+@\S+\.\S+$/.test(b.email||'')?b.email:undefined,client_reference_id:b.id,metadata:meta,payment_intent_data:{metadata:meta},
    success_url:`${origin}/#/booking/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/#/book?canceled=${b.id}`})
    return json({url:s.url,id:s.id,amount:p.usd,methods})}catch(e){return json({error:e.message},e.status||502)}}

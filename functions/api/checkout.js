// GET /api/checkout → feature probe {ok, live}. POST /api/checkout {booking} → Stripe Checkout Session (FULL payment only).
// The session amount is priceFor() (catalog + package surcharge + add-ons). b.total, b.amount, and b.price are never read.
// An admin View as preview is refused before any Stripe session is created.
import {json,priceFor,stripe,AFFIRM_MIN_USD,paymentMethodsFor} from './_stripe.js'
import {previewMutationBlock} from '../_lib/auth.js'
export const onRequestGet=({env})=>json({ok:true,live:!!env.STRIPE_SECRET_KEY,affirmMinUsd:AFFIRM_MIN_USD})
export async function onRequestPost({request,env}){
  const blocked=await previewMutationBlock(request,env);if(blocked)return blocked
  if(!env.STRIPE_SECRET_KEY)return json({error:'STRIPE_SECRET_KEY not configured'},503)
  let b;try{({booking:b}=await request.json())}catch{return json({error:'bad json'},400)}
  if(!b||!/^MD-[A-Z0-9]{4,20}$/.test(b.id||''))return json({error:'bad booking id'},400)
  const p=priceFor({service:b.service,vehicle:b.vehicle,addons:b.addons});if(!p.ok)return json({error:p.error},400)
  const cents=p.cents,origin=new URL(request.url).origin,methods=paymentMethodsFor(p.usd)
  const meta={bookingId:b.id,vin:(b.vin||'').slice(0,17),vehicle:`${b.year||''} ${b.make||''} ${b.model||''}`.trim().slice(0,200),vehicleSize:p.vehicleName.slice(0,200),surchargeUsd:String(p.surchargeUsd),slot:`${b.date||''} ${b.time||''}`.trim(),detailer:b.detailer||'',addons:p.addons.map(a=>a.id).join(',').slice(0,500)}
  const surchargeText=p.surchargeUsd?`${p.vehicleName} size surcharge +$${p.surchargeUsd}`:`${p.vehicleName} (no size surcharge)`
  const description=[surchargeText,p.addons.map(a=>`${a.name} +$${a.price}`).join(', '),meta.slot].filter(Boolean).join(' · ')
  try{const s=await stripe(env,'POST','checkout/sessions',{mode:'payment',payment_method_types:methods,
    line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:cents,product_data:{name:`Millirons Detailing — ${p.name}`,description:description||undefined}}}],
    customer_email:/^\S+@\S+\.\S+$/.test(b.email||'')?b.email:undefined,client_reference_id:b.id,metadata:meta,payment_intent_data:{metadata:meta},
    success_url:`${origin}/#/booking/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/#/book?canceled=${b.id}`})
    return json({url:s.url,id:s.id,amount:p.usd,methods})}catch(e){return json({error:e.message},e.status||502)}}

// GET /api/checkout-status?session_id=cs_... → verifies with Stripe whether the session is paid.
import {json,stripe} from './_stripe.js'
export async function onRequestGet({request,env}){if(!env.STRIPE_SECRET_KEY)return json({error:'STRIPE_SECRET_KEY not configured'},503)
  const id=new URL(request.url).searchParams.get('session_id')||'';if(!/^cs_[A-Za-z0-9_]+$/.test(id))return json({error:'bad session id'},400)
  try{const s=await stripe(env,'GET','checkout/sessions/'+id+'?expand[]=payment_intent.payment_method')
    return json({paid:s.payment_status==='paid',status:s.status,paymentStatus:s.payment_status,bookingId:s.metadata?.bookingId||s.client_reference_id,amount:s.amount_total/100,currency:s.currency,
      method:s.payment_intent?.payment_method?.type||null,last4:s.payment_intent?.payment_method?.card?.last4||null,metadata:s.metadata})}catch(e){return json({error:e.message},e.status||502)}}

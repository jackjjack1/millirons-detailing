import {onRequestGet as listGet} from '../photos.js'
// GET /api/photos/<key> → serve image from R2 ; DELETE /api/photos/<key> → remove. Keys limited to bookings/…
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json'}})
const keyOf=p=>{const k=[].concat(p.path||[]).join('/');return /^bookings\/[A-Za-z0-9_-]{1,64}\/(before|after)\/\d+\.jpg$/.test(k)?k:null}
export async function onRequestGet(ctx){const {env,params}=ctx;if(![].concat(params.path||[]).length)return listGet(ctx);if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503);const k=keyOf(params);if(!k)return json({error:'bad key'},400)
  const o=await env.PHOTOS.get(k);if(!o)return json({error:'not found'},404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'image/jpeg','cache-control':'private, max-age=31536000, immutable','etag':o.httpEtag}})}
export async function onRequestDelete({env,params}){if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503);const k=keyOf(params);if(!k)return json({error:'bad key'},400);await env.PHOTOS.delete(k);return json({ok:true})}

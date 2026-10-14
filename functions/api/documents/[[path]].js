import {onRequestGet as listGet} from '../documents.js'
// GET /api/documents/<key> → serve (applications/… only). TODO production: admin-only.
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json'}})
export async function onRequestGet(ctx){const {env,params}=ctx;if(![].concat(params.path||[]).length)return listGet(ctx);if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503);const k=[].concat(params.path||[]).join('/')
  if(!/^applications\/[A-Za-z0-9_-]{1,64}\/(vehicle|registration|insurance|other)\/[a-z0-9.-]+$/.test(k))return json({error:'bad key'},400)
  const o=await env.PHOTOS.get(k);if(!o)return json({error:'not found'},404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, max-age=3600'}})}

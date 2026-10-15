import {onRequestGet as listGet} from '../documents.js'
import {requireAdmin} from '../../_lib/auth.js'
// GET /api/documents/<key> → serve (applications/… only). Admin session required.
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
export async function onRequestGet(ctx){const {request,env,params}=ctx;if(![].concat(params.path||[]).length)return listGet(ctx);if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503)
  const gate=await requireAdmin(request,env);if(gate.error)return gate.error
  const k=[].concat(params.path||[]).join('/')
  if(!/^applications\/[A-Za-z0-9_-]{1,64}\/(vehicle|registration|insurance|other)\/[a-z0-9.-]+$/.test(k))return json({error:'bad key'},400)
  const o=await env.PHOTOS.get(k);if(!o)return json({error:'not found'},404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, no-store'}})}

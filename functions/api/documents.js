// Vehicle proof / registration / insurance uploads for detailer applications (self-apply + invite).
// POST /api/documents (multipart: applicationId, type=vehicle|registration|insurance|other, file) → R2 applications/<id>/<type>/<timestamp>-<name>
// GET  /api/documents?applicationId=… → { documents:[…] }
// Same R2 bucket binding PHOTOS.
// List is admin-only. Upload is allowed for an admin, or for the employee whose appId matches.
// __probe stays public and returns no documents.
import {previewMutationBlock, requireAdmin, requireUser} from '../_lib/auth.js'
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
const safe=s=>/^[A-Za-z0-9_-]{1,64}$/.test(s), TYPES=['vehicle','registration','insurance','other']
const clean=n=>String(n||'file').toLowerCase().replace(/[^a-z0-9.]+/g,'-').replace(/^-+|-+$/g,'').slice(-60)||'file'
export async function onRequestGet({request,env}){if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503)
  const id=new URL(request.url).searchParams.get('applicationId')||'';if(id==='__probe')return json({ok:true,documents:[]})
  const gate=await requireAdmin(request,env);if(gate.error)return gate.error
  if(!safe(id))return json({error:'bad applicationId'},400)
  const documents=[];let cursor;do{const l=await env.PHOTOS.list({prefix:`applications/${id}/`,cursor,include:['customMetadata','httpMetadata']});for(const o of l.objects){const [,,type,file]=o.key.split('/');documents.push({key:o.key,type,name:o.customMetadata?.name||file,contentType:o.httpMetadata?.contentType,size:o.size,ts:Number(o.customMetadata?.ts)||0,url:'/api/documents/'+o.key})}cursor=l.truncated?l.cursor:null}while(cursor)
  return json({documents})}
export async function onRequestPost({request,env}){if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503)
  const blocked=await previewMutationBlock(request,env);if(blocked)return blocked
  const gate=await requireUser(request,env);if(gate.error)return gate.error
  let fd;try{fd=await request.formData()}catch{return json({error:'multipart form required'},400)}
  const id=String(fd.get('applicationId')||''),type=String(fd.get('type')||''),file=fd.get('file')
  if(gate.user.role!=='admin'&&!(gate.user.role==='employee'&&gate.user.appId===id))return json({error:'Forbidden'},403)
  if(!safe(id)||!TYPES.includes(type)||!file||typeof file==='string')return json({error:'applicationId, type and file required'},400)
  const ct=file.type||'application/octet-stream';if(!(ct.startsWith('image/')||ct==='application/pdf'))return json({error:'image or PDF only'},415);if(file.size>10e6)return json({error:'max 10 MB'},413)
  const ts=Date.now(),key=`applications/${id}/${type}/${ts}-${clean(file.name)}`
  await env.PHOTOS.put(key,file.stream(),{httpMetadata:{contentType:ct},customMetadata:{ts:String(ts),name:String(file.name||'').slice(0,120)}})
  return json({key,type,name:file.name,contentType:ct,size:file.size,ts,url:'/api/documents/'+key},201)}

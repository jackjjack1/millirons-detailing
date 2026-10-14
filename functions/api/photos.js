// POST /api/photos  (multipart: bookingId, group=before|after, by?, file) → R2 bookings/<bookingId>/<group>/<timestamp>.jpg
// GET  /api/photos?bookingId=…  → { photos:[{key,id,bookingId,group,ts,by,size,url}] }
// Binding: R2 bucket "millirons-detailing-media" bound as PHOTOS.
// TODO production: authenticate caller + authorize bookingId (currently open for demo).
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
const safe=s=>/^[A-Za-z0-9_-]{1,64}$/.test(s)
export async function onRequestGet({request,env}){if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503)
  const bookingId=new URL(request.url).searchParams.get('bookingId')||'';if(bookingId==='__probe')return json({ok:true,photos:[]})
  if(!safe(bookingId))return json({error:'bad bookingId'},400)
  const photos=[];let cursor;do{const l=await env.PHOTOS.list({prefix:`bookings/${bookingId}/`,cursor,include:['customMetadata']})
    for(const o of l.objects){const [,b,group,file]=o.key.split('/'),m=o.customMetadata||{};photos.push({key:o.key,id:o.key,bookingId:b,group,ts:Number(m.ts)||Number(file.split('.')[0])||0,by:m.by||'',size:o.size,url:'/api/photos/'+o.key})}
    cursor=l.truncated?l.cursor:null}while(cursor)
  return json({photos:photos.sort((a,b)=>a.ts-b.ts)})}
export async function onRequestPost({request,env}){if(!env.PHOTOS)return json({error:'PHOTOS binding missing'},503)
  let fd;try{fd=await request.formData()}catch{return json({error:'multipart form required'},400)}
  const bookingId=String(fd.get('bookingId')||''),group=String(fd.get('group')||''),file=fd.get('file')
  if(!safe(bookingId)||!['before','after'].includes(group)||!file||typeof file==='string')return json({error:'bookingId, group (before|after) and file required'},400)
  if(file.size>10e6)return json({error:'max 10 MB'},413);if(file.type&&!file.type.startsWith('image/'))return json({error:'image required'},415)
  let ts=Number(fd.get('ts'))||Date.now(),key;for(let i=0;i<5;i++){key=`bookings/${bookingId}/${group}/${ts}.jpg`;if(!(await env.PHOTOS.head(key)))break;ts++}
  await env.PHOTOS.put(key,file.stream(),{httpMetadata:{contentType:'image/jpeg'},customMetadata:{ts:String(ts),by:String(fd.get('by')||'').slice(0,80),clientId:String(fd.get('clientId')||'').slice(0,80)}})
  return json({key,id:key,bookingId,group,ts,url:'/api/photos/'+key},201)}

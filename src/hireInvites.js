// Client-only employee invites. Mail and text open the admin's own apps — nothing is sent by the site.
export const HIRE_KEY='md_hire_invites'
export const digits=p=>String(p||'').replace(/\D/g,'')
export const contactLine=i=>[i.email,i.phone].filter(Boolean).join(' · ')
export const methodLine=i=>(i.methods||[]).join(' · ')
const first=n=>String(n||'').trim().split(/\s+/)[0]||'there'

export function hireLink(inv, origin=location.origin, pathname=location.pathname){
 const p=new URLSearchParams()
 p.set('invite',inv.id)
 if(inv.name)p.set('name',inv.name)
 if(inv.email)p.set('email',inv.email)
 if(inv.phone)p.set('phone',inv.phone)
 const path=String(pathname||'/').replace(/index\.html$/,'')
 return `${origin}${path}#/join?${p}`
}

export function inviteMessage(inv, adminName, link){
 const you=first(inv.name), who=first(adminName)
 const filled=inv.email?'your name and email are':'your name is'
 return {
  subject:"You're invited to join Millirons Detailing",
  email:`Hi ${you},\n\n${who} invited you to join the Millirons Detailing team in metro Atlanta.\n\nApply with this personal link — ${filled} already filled in:\n${link}\n\nIt only takes a few minutes. We'll look over your setup and get you on the schedule.\n\n— Millirons Detailing`,
  sms:`Hi ${you} — ${who} invited you to join Millirons Detailing in Atlanta. Apply here (we filled in what we know): ${link}`,
 }
}

export function mailHref(email, subject, body){
 return `mailto:${email?encodeURIComponent(email):''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function smsNumber(phone){
 let n=digits(phone)
 if(!n)return ''
 if(n.length===10)n='1'+n
 return '+'+n
}

// iPhone Messages wants sms:+1XXXXXXXXXX&body=… — Android and most desktop apps want ?body=
export function smsHref(phone, body, ua=typeof navigator==='undefined'?'':navigator.userAgent){
 const ios=/iPhone|iPad|iPod/i.test(ua)
 return `sms:${smsNumber(phone)}${ios?'&':'?'}body=${encodeURIComponent(body)}`
}

export function joined(inv, accs=[]){
 if(!inv)return false
 if(inv.status==='Joined')return true
 const em=(inv.email||'').toLowerCase(), ph=digits(inv.phone)
 return accs.some(a=>{
  if(a.hireId&&a.hireId===inv.id)return true
  if(a.role!=='employee')return false
  if(em&&(a.email||'').toLowerCase()===em)return true
  const ap=digits(a.profile?.phone)
  return ph.length>=10&&ap.length>=10&&ap.slice(-10)===ph.slice(-10)
 })
}

export function markJoined(list, {id='',email='',phone=''}={}){
 const em=(email||'').toLowerCase(), ph=digits(phone)
 return (list||[]).map(i=>{
  if(i.status==='Joined')return i
  const ip=digits(i.phone)
  const hit=(id&&i.id===id)||(em&&i.email===em)||(ph.length>=10&&ip.length>=10&&ip.slice(-10)===ph.slice(-10))
  return hit?{...i,status:'Joined'}:i
 })
}

// Approved catalog. quoteBooking() is the only price calculation.
// Profiles, reviews, and hours below the catalog are sample content.
// Checkout must ignore client totals and charge this quote.
export const AFFIRM_MIN_USD = 50

const size = (touchless, standard, extended) => ({
  touchless,
  interior: standard,
  exterior: standard,
  full: extended,
  premium: extended,
})

export const services = [
  { id:'touchless', name:'Touchless Wash', price:59, time:'45–60 min',
    desc:'Scratch-free maintenance wash, great for ceramic-coated or delicate paint.',
    includes:['Pre-rinse','WashChems Pro 30 touchless foam soak','Wheel & tire spray and rinse','High-pressure rinse, including wheel wells and lower panels','Spot-free final rinse','Touchless air/blower dry','Tire shine and exterior glass'],
    grad:'linear-gradient(160deg,#f5f5f7,#6e6e73 55%,#1d1d1f)' },
  { id:'interior', name:'Interior Detail', price:149, time:'1.5–2 hrs',
    image:'/images/package-interior.jpg',
    desc:'Full cabin refresh: vacuum every crevice, wipe-down of plastics and leather, glass inside, mats shampooed, light stain treatment.',
    includes:['Full vacuum','Dash & console wipe','Interior glass','Mat shampoo','Air freshener'],
    grad:'linear-gradient(135deg,#d2d2d7,#86868b)' },
  { id:'exterior', name:'Exterior Detail', price:139, time:'2–2.5 hrs',
    image:'/images/package-exterior.jpg',
    desc:'Hand wash, clay bar, polish, wax, wheels, tires, and trim dressing for a deep, lasting shine.',
    includes:['Hand wash','Clay bar','Polish & wax','Wheels & tires','Trim dressing'],
    grad:'linear-gradient(135deg,#6e6e73,#1d1d1f)' },
  { id:'full', name:'Full Detail', price:259, time:'3.5–4.5 hrs',
    image:'/images/package-full.jpg',
    desc:'Complete interior + exterior. Our most popular package for a showroom finish.',
    includes:['Everything in Interior','Everything in Exterior','Door jambs','Trunk / cargo'],
    grad:'linear-gradient(135deg,#424245,#000)', popular:true },
  { id:'premium', name:'Premium Detail', price:379, time:'5–6 hrs',
    image:'/images/package-premium.jpg',
    desc:'Full Detail plus paint decontamination and a 6-month spray sealant. Ideal before a sale or event.',
    includes:['Full Detail','Iron remover','Spray sealant','Tire shine','Final inspection'],
    grad:'linear-gradient(135deg,#1d1d1f,#636366)' },
]
export const addons = [
  { id:'pet', name:'Pet hair removal', price:65, desc:'Extra suction & brushes for stubborn pet hair.' },
  { id:'engine', name:'Engine bay clean', price:75, desc:'Degrease and dress under the hood (safe for modern engines).' },
  { id:'ceramic', name:'Ceramic boost spray', price:129, desc:'SiO₂ spray coating for 3–6 months of gloss & beading.' },
  { id:'headlight', name:'Headlight restoration', price:89, desc:'Both headlights. Oxidized lenses sanded, polished, and sealed.' },
  { id:'odor', name:'Odor treatment', price:79, desc:'Ozone / enzyme treatment for smoke, pets, or mildew.' },
  { id:'leather', name:'Leather condition', price:49, desc:'Clean and condition seats and door panels.' },
  { id:'acid-wheel', name:'Acid wheel restoration', price:99, desc:'Deep acid wheel cleaning that removes baked-on brake dust and contamination using Wow Kleaners ICE wheel cleaner.' },
  { id:'touchless-wash', name:'Touchless wash', price:39, desc:'WashChems Pro 30 touchless exterior wash. Same price on every package.' },
]
export const vehicles = [
  { id:'sedan', name:'Sedan / coupe', surcharge:size(0, 0, 0) },
  { id:'suv', name:'SUV or crossover', surcharge:size(20, 30, 40) },
  { id:'truck', name:'3-row SUV, truck or van', surcharge:size(40, 60, 80) },
]

export function vehicleNote(vehicle){
  const groups=[]
  for(const service of services){
    const amt=vehicle.surcharge[service.id]
    const hit=groups.find(g=>g.amt===amt)
    const label=service.id==='touchless'?'Touchless Wash':service.id==='interior'?'Interior':service.id==='exterior'?'Exterior':service.id==='full'?'Full':'Premium'
    if(hit)hit.labels.push(label)
    else groups.push({amt,labels:[label]})
  }
  if(groups.length===1&&groups[0].amt===0)return 'Base price'
  return groups.map(g=>`${g.amt?`+$${g.amt}`:'+$0'} ${g.labels.join(' & ')}`).join(' · ')
}

export function priceSizeForBodyTier(tier){
  if(tier==='suv')return 'suv'
  if(tier==='truck'||tier==='van'||tier==='xl')return 'truck'
  if(tier==='compact'||tier==='sedan')return 'sedan'
  return ''
}

// Reads service, vehicle, and add-on ids only. Ignores total, amount, price, and surcharge.
export function quoteBooking(input){
  const b=input&&typeof input==='object'?input:{}
  const service=services.find(s=>s.id===b.service)
  if(!service||!Number.isInteger(service.price)||service.price<0)return {ok:false,error:'unknown service'}
  const vehicle=vehicles.find(v=>v.id===b.vehicle)
  const surcharge=vehicle?.surcharge?.[service.id]
  if(!vehicle||!Number.isInteger(surcharge)||surcharge<0)return {ok:false,error:'unknown vehicle size'}
  let raw=b.addons
  if(raw==null)raw=[]
  if(!Array.isArray(raw))return {ok:false,error:'unknown add-on'}
  const chosen=[],seen=new Set()
  for(const id of raw){
    if(typeof id!=='string'||seen.has(id)){if(typeof id!=='string')return {ok:false,error:'unknown add-on'};continue}
    seen.add(id)
    const addon=addons.find(a=>a.id===id)
    if(!addon||!Number.isInteger(addon.price)||addon.price<0)return {ok:false,error:'unknown add-on'}
    chosen.push(addon)
  }
  const addonsUsd=chosen.reduce((t,a)=>t+a.price,0)
  const usd=service.price+surcharge+addonsUsd
  return {
    ok:true,usd,cents:usd*100,name:service.name,packageUsd:service.price,surchargeUsd:surcharge,addonsUsd,
    vehicleId:vehicle.id,vehicleName:vehicle.name,
    addons:chosen.map(a=>({id:a.id,name:a.name,price:a.price})),
    extras:[vehicle.name,...chosen.map(a=>a.name)].join(', '),
  }
}

export const hours = [
  { day:'Mon–Fri', open:'8:00 AM – 6:00 PM' },
  { day:'Saturday', open:'8:00 AM – 5:00 PM' },
  { day:'Sunday', open:'9:00 AM – 3:00 PM' },
]
export const detailers = [
  { id:'marcus', name:'Marcus Reed', city:'Buckhead, Atlanta', rating:4.9, reviews:312, years:8,
    grad:'linear-gradient(135deg,#1d1d1f,#434344)',
    bio:'Ceramic and paint-correction specialist. Eight years mobile across Buckhead and Midtown. ASE-adjacent detailing certs; insured and bonded.',
    specialties:['Ceramic','Paint correction','Exotics'],
    sampleReviews:[
      { name:'Priya K.', text:'Car looked brand new. Marcus was early and meticulous.', stars:5 },
      { name:'Tom H.', text:'Best ceramic job I have had in Atlanta.', stars:5 },
    ]},
  { id:'ana', name:'Ana Torres', city:'Midtown, Atlanta', rating:4.8, reviews:207, years:5,
    grad:'linear-gradient(135deg,#86868b,#3a3a3c)',
    bio:'Interior perfectionist. Pet hair, stains, and odors are no match. Serves Midtown, Old Fourth Ward, and Inman Park.',
    specialties:['Interior','Odor removal','Pet hair'],
    sampleReviews:[
      { name:'James R.', text:'Got every dog hair out of my SUV. Amazing.', stars:5 },
      { name:'Elena M.', text:'Friendly, thorough, fair. Booking again.', stars:5 },
    ]},
  { id:'devon', name:'Devon Park', city:'Decatur, GA', rating:4.9, reviews:158, years:6,
    grad:'linear-gradient(135deg,#a1a1a6,#48484a)',
    bio:'Eco-friendly waterless and low-water detailing for apartments and garages. Fleet accounts welcome.',
    specialties:['Waterless','Fleet','Apartments'],
    sampleReviews:[
      { name:'Chris L.', text:'Quiet waterless wash in my garage. Perfect for Decatur.', stars:5 },
      { name:'Sam P.', text:'Handles our small fleet every month.', stars:4 },
    ]},
  { id:'lena', name:'Lena Brooks', city:'Sandy Springs, GA', rating:5.0, reviews:94, years:4,
    grad:'linear-gradient(135deg,#2c2c2e,#636366)',
    bio:'Luxury and exotic vehicle care with white-glove service. North Atlanta and Perimeter focus.',
    specialties:['Exotics','Wax','Premium'],
    sampleReviews:[
      { name:'Alex W.', text:'Treated my Porsche like her own. 10/10.', stars:5 },
      { name:'Nina S.', text:'Punctual and obsessively clean.', stars:5 },
    ]},
]
export const faq = [
  { q:'Do you come to me?', a:'Yes. Millirons Detailing is fully mobile across metro Atlanta. We need a safe parking spot and access to water/power when possible (waterless options available).' },
  { q:'Are these real prices?', a:'Yes. The package price shown is the sedan / coupe rate. An SUV or crossover, and a 3-row SUV, truck, or van, add a surcharge to the package only. Add-ons cost the same on every vehicle and every package.' },
  { q:'How long does a Full Detail take?', a:'Typically 3.5–4.5 hours depending on vehicle size and condition. A Touchless Wash is about 45–60 minutes. Your detailer confirms a window at booking.' },
  { q:'What payment methods?', a:'Pay in full today with a card through Stripe Checkout. Affirm pay-over-time is offered on that screen when the booking is $50 or more. If checkout is unavailable, the form stays in a labeled demo mode and does not charge a card.' },
  { q:'Coverage area?', a:'Metro Atlanta: Buckhead, Midtown, Decatur, Sandy Springs, and surrounding neighborhoods (sample list).' },
  { q:'Can I cancel or reschedule?', a:'In a live product you would manage that from confirmation email. Here, clear localStorage to reset demo bookings.' },
]
export const howSteps = [
  { n:1, t:'Choose a package', d:'Touchless Wash, Interior, Exterior, Full, or Premium Detail — plus optional add-ons.' },
  { n:2, t:'Pick vehicle & time', d:'Sedan, SUV, or truck / van. The size surcharge is on the package only. Then choose a date, time, and detailer.' },
  { n:3, t:'We come to you', d:'Meet in your driveway or garage across metro Atlanta.' },
]

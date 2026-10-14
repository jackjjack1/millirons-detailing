// SAMPLE / EXAMPLE DATA ONLY — not real offerings or rates
export const hours = [
  { day:'Mon–Fri', open:'8:00 AM – 6:00 PM' },
  { day:'Saturday', open:'8:00 AM – 5:00 PM' },
  { day:'Sunday', open:'9:00 AM – 3:00 PM' },
]
export const services = [
  { id:'interior', name:'Interior Detail', price:99, time:'1.5–2 hrs',
    desc:'Full cabin refresh: vacuum every crevice, wipe-down of plastics and leather, glass inside, mats shampooed, light stain treatment.',
    includes:['Full vacuum','Dash & console wipe','Interior glass','Mat shampoo','Air freshener'],
    grad:'linear-gradient(135deg,#d2d2d7,#86868b)' },
  { id:'exterior', name:'Exterior Detail', price:129, time:'2–2.5 hrs',
    desc:'Hand wash, clay bar, polish, wax, wheels, tires, and trim dressing for a deep, lasting shine.',
    includes:['Hand wash','Clay bar','Polish & wax','Wheels & tires','Trim dressing'],
    grad:'linear-gradient(135deg,#6e6e73,#1d1d1f)' },
  { id:'full', name:'Full Detail', price:199, time:'3.5–4.5 hrs',
    desc:'Complete interior + exterior. Our most popular package for a showroom finish.',
    includes:['Everything in Interior','Everything in Exterior','Door jambs','Trunk / cargo'],
    grad:'linear-gradient(135deg,#424245,#000)', popular:true },
  { id:'premium', name:'Premium Full + Sealant', price:299, time:'5–6 hrs',
    desc:'Full Detail plus paint decontamination and a 6-month spray sealant. Ideal before a sale or event.',
    includes:['Full Detail','Iron remover','Spray sealant','Tire shine','Final inspection'],
    grad:'linear-gradient(135deg,#1d1d1f,#636366)' },
]
export const addons = [
  { id:'pet', name:'Pet hair removal', price:45, desc:'Extra suction & brushes for stubborn pet hair.' },
  { id:'engine', name:'Engine bay clean', price:55, desc:'Degrease and dress under the hood (safe for modern engines).' },
  { id:'ceramic', name:'Ceramic boost spray', price:79, desc:'SiO₂ spray coating for 3–6 months of gloss & beading.' },
  { id:'headlight', name:'Headlight restoration', price:69, desc:'Oxidized lenses sanded, polished, and sealed.' },
  { id:'odor', name:'Odor treatment', price:49, desc:'Ozone / enzyme treatment for smoke, pets, or mildew.' },
  { id:'leather', name:'Leather condition', price:39, desc:'Clean and condition seats and door panels.' },
]
export const vehicles = [
  { id:'compact', name:'Compact / Coupe', add:0, note:'Base price' },
  { id:'sedan', name:'Sedan / Hatch', add:15, note:'+$15' },
  { id:'suv', name:'SUV / Crossover', add:35, note:'+$35' },
  { id:'truck', name:'Truck / Pickup', add:45, note:'+$45' },
  { id:'van', name:'Van / 3-Row', add:55, note:'+$55' },
  { id:'xl', name:'XL / Oversized', add:75, note:'+$75' },
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
  { q:'Are these real prices?', a:'No — package prices and add-ons on this demo site are sample / example figures only, for illustration.' },
  { q:'How long does a Full Detail take?', a:'Typically 3.5–4.5 hours depending on vehicle size and condition. Your detailer confirms a window at booking.' },
  { q:'What payment methods?', a:'This demo stores bookings in your browser only. No payment is processed.' },
  { q:'Coverage area?', a:'Metro Atlanta: Buckhead, Midtown, Decatur, Sandy Springs, and surrounding neighborhoods (sample list).' },
  { q:'Can I cancel or reschedule?', a:'In a live product you would manage that from confirmation email. Here, clear localStorage to reset demo bookings.' },
]
export const howSteps = [
  { n:1, t:'Choose a package', d:'Interior, Exterior, Full, or Premium — plus optional add-ons.' },
  { n:2, t:'Pick vehicle & time', d:'Size tier adjusts price. Choose date, time, and a local detailer.' },
  { n:3, t:'We come to you', d:'Meet in your driveway or garage across metro Atlanta.' },
]

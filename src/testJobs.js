// Sample bookings for the admin "Create test job" action.
// quoteBooking() prices every sample. The server saves priceFor(), which must match.
// These records are not charges and are not messages.
import {quoteBooking} from './data.js'

export const TEST_SAMPLES = [
  {
    service: 'touchless', vehicle: 'sedan', addons: [],
    address: '3393 Peachtree Rd NE', city: 'Atlanta', zip: '30326', unit: '',
    parking: 'garage', water: 'yes', time: '8:00 AM', dayOffset: 1,
    year: '2022', make: 'Toyota', model: 'Camry', color: 'White', plate: 'TEST001', vin: '1TEST000000000001',
    notes: 'TEST job. Hotel porte-cochère in Buckhead. Do not charge or message.',
  },
  {
    service: 'interior', vehicle: 'suv', addons: ['pet', 'odor'],
    address: '675 Ponce de Leon Ave NE', city: 'Atlanta', zip: '30308', unit: 'Apt 4',
    parking: 'street', water: 'no', time: '11:00 AM', dayOffset: 2,
    year: '2021', make: 'Honda', model: 'CR-V', color: 'Gray', plate: 'TEST002', vin: '1TEST000000000002',
    notes: 'TEST job. Pet hair in the cabin, Ponce. Do not charge or message.',
  },
  {
    service: 'exterior', vehicle: 'truck', addons: ['acid-wheel', 'touchless-wash'],
    address: '1 West Court Square', city: 'Decatur', zip: '30030', unit: '',
    parking: 'lot', water: 'yes', time: '2:00 PM', dayOffset: 3,
    year: '2020', make: 'Ford', model: 'F-150', color: 'Blue', plate: 'TEST003', vin: '1TEST000000000003',
    notes: 'TEST job. Decatur square, brake dust on the wheels. Do not charge or message.',
  },
  {
    service: 'full', vehicle: 'suv', addons: ['leather', 'headlight'],
    address: '4400 Ashford Dunwoody Rd', city: 'Sandy Springs', zip: '30346', unit: '',
    parking: 'driveway', water: 'yes', time: '9:30 AM', dayOffset: 4,
    year: '2023', make: 'Lexus', model: 'RX', color: 'Black', plate: 'TEST004', vin: '1TEST000000000004',
    notes: 'TEST job. Sandy Springs driveway. Do not charge or message.',
  },
  {
    service: 'premium', vehicle: 'sedan', addons: ['ceramic', 'engine'],
    address: '1080 Peachtree St NE', city: 'Atlanta', zip: '30309', unit: 'Suite 200',
    parking: 'garage', water: 'yes', time: '12:30 PM', dayOffset: 5,
    year: '2019', make: 'Porsche', model: '911', color: 'Silver', plate: 'TEST005', vin: '1TEST000000000005',
    notes: 'TEST job. Midtown office deck. Do not charge or message.',
  },
  {
    service: 'full', vehicle: 'truck', addons: ['pet', 'touchless-wash', 'leather'],
    address: '925 Euclid Ave NE', city: 'Atlanta', zip: '30307', unit: '',
    parking: 'driveway', water: 'no', time: '3:30 PM', dayOffset: 6,
    year: '2018', make: 'Chevrolet', model: 'Suburban', color: 'Green', plate: 'TEST006', vin: '1TEST000000000006',
    notes: 'TEST job. Inman Park, waterless. Do not charge or message.',
  },
]

export const TEST_JOB_LIMIT = TEST_SAMPLES.length
const BOOKING_ID = /^MD-[A-Z0-9]{4,20}$/

export function isTestJob(booking) {
  return !!booking && booking.isTest === true
}

export function futureWeekday(now, offset) {
  const date = new Date(now)
  if (Number.isNaN(date.getTime())) throw new Error('bad date')
  date.setHours(12, 0, 0, 0)
  let left = offset
  while (left > 0) {
    date.setDate(date.getDate() + 1)
    if (date.getDay() !== 0) left -= 1
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function testJobId(now, index, nonce) {
  const raw = `T${Number(now).toString(36)}${index}${nonce}`.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = `MD-${raw}`.slice(0, 23)
  if (!BOOKING_ID.test(id)) throw new Error('bad test id')
  return id
}

export function employeeDetailer(employee) {
  const existing = String(employee?.detailer || '').trim().toLowerCase()
  if (/^[a-z0-9]{1,40}$/.test(existing)) return existing
  const slug = String(employee?.name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  return slug || 'detailer'
}

export function assignedToEmployee(job, user) {
  if (!job || !user) return false
  if (job.employeeId && user.id && job.employeeId === user.id) return true
  return !!(user.detailer && job.detailer === user.detailer)
}

// Real bookings only. Public availability must ignore test jobs.
export function scheduleBookings(bookings) {
  return (Array.isArray(bookings) ? bookings : []).filter(booking => booking && booking.isTest !== true)
}

export function revenueOf(bookings) {
  return scheduleBookings(bookings).reduce((sum, booking) => {
    const total = Number(booking.total)
    return sum + (Number.isFinite(total) ? total : 0)
  }, 0)
}

export function mergeTestJobs(existing, incoming) {
  const real = scheduleBookings(existing)
  const tests = []
  const seen = new Set()
  for (const job of Array.isArray(incoming) ? incoming : []) {
    if (!isTestJob(job) || !job.id || seen.has(job.id)) continue
    seen.add(job.id)
    tests.push(job)
  }
  return [...real, ...tests]
}

export function buildTestJobs({customer, employee, count, now = Date.now(), nonce = 'A'}) {
  const total = Math.min(TEST_SAMPLES.length, count)
  return TEST_SAMPLES.slice(0, total).map((sample, index) => {
    const quote = quoteBooking({service: sample.service, vehicle: sample.vehicle, addons: sample.addons})
    if (!quote.ok) throw new Error(quote.error || 'Could not price that test job.')
    const street = sample.unit ? `${sample.address} ${sample.unit}` : sample.address
    return {
      id: testJobId(now, index, nonce),
      isTest: true,
      service: sample.service,
      addons: sample.addons.slice(),
      vehicle: sample.vehicle,
      address: street,
      unit: sample.unit,
      city: sample.city,
      zip: sample.zip,
      parking: sample.parking,
      water: sample.water,
      notes: sample.notes,
      make: sample.make,
      model: sample.model,
      year: sample.year,
      color: sample.color,
      plate: sample.plate,
      vin: sample.vin,
      date: futureWeekday(now, sample.dayOffset),
      time: sample.time,
      detailer: employeeDetailer(employee),
      detailerName: String(employee?.name || '').trim(),
      employeeId: employee?.id || '',
      customerId: customer?.id || '',
      name: String(customer?.name || '').trim(),
      email: String(customer?.email || '').trim().toLowerCase(),
      phone: String(customer?.phone || customer?.profile?.phone || '(404) 555-0100').trim(),
      contactPref: 'none',
      total: quote.usd,
      surchargeUsd: quote.surchargeUsd,
      status: 'Confirmed',
      payment: {method: 'Test', status: 'Not charged'},
      created: new Date(now).toISOString(),
    }
  })
}

export function loadBookings() {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem('md_bookings') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveBookings(bookings) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem('md_bookings', JSON.stringify(bookings))
}

export function forgetTestJobExtras(previous, next) {
  if (typeof localStorage === 'undefined') return
  const keep = new Set((next || []).filter(isTestJob).map(job => job.id))
  const removed = (previous || []).filter(job => isTestJob(job) && !keep.has(job.id)).map(job => job.id)
  if (!removed.length) return
  for (const key of ['md_jobs', 'md_msgs']) {
    let current = {}
    try { current = JSON.parse(localStorage.getItem(key) || '{}') || {} } catch { current = {} }
    if (!current || typeof current !== 'object') continue
    for (const id of removed) delete current[id]
    localStorage.setItem(key, JSON.stringify(current))
  }
}

export function applyTestJobs(existing, incoming) {
  const next = mergeTestJobs(existing, incoming)
  forgetTestJobExtras(existing, next)
  saveBookings(next)
  return next
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {onRequestGet as garageGet, onRequestPut as garagePut} from '../functions/api/garage.js'
import {onRequestPost as previewBooking} from '../functions/api/preview-booking.js'
import {onRequestGet as listJobs, onRequestPost as createJobs} from '../functions/api/test-jobs.js'
import {onRequestPost as checkout} from '../functions/api/checkout.js'
import {onRequest as middleware} from '../functions/api/_middleware.js'
import {onRequestPost as setupPost} from '../functions/api/auth/setup.js'
import {onRequestPost as register} from '../functions/api/auth/register.js'
import {onRequestPost as apply} from '../functions/api/auth/apply.js'
import {onRequestPost as viewAs} from '../functions/api/auth/view-as.js'
import {onRequestGet as meGet} from '../functions/api/auth/me.js'
import {previewMutationBlock} from '../functions/_lib/auth.js'
import {assignedToEmployee, customerBooking} from '../src/testJobs.js'
import {cleanGarageList} from '../src/garage.js'

const SECRET = 'test-session-secret-must-be-32-characters'
const CODE = 'test-setup-code'
const PASSWORD = 'password1'
const HONDA = '1HGCM82633A004352'

class MemoryR2 {
  constructor() { this.store = new Map() }
  async get(key) {
    const row = this.store.get(key)
    if (!row) return null
    return {text: async () => new TextDecoder().decode(row.bytes), json: async () => JSON.parse(new TextDecoder().decode(row.bytes))}
  }
  async put(key, value, opts = {}) {
    if (opts.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    this.store.set(key, {bytes})
    return {key}
  }
  async head(key) { return this.store.has(key) ? {key} : null }
  async delete(key) { this.store.delete(key) }
  async list({prefix = ''} = {}) {
    const keys = [...this.store.keys()].filter(key => key.startsWith(prefix)).sort()
    return {objects: keys.map(key => ({key})), truncated: false}
  }
}

function envOf(extra = {}) {
  return {PHOTOS: new MemoryR2(), SESSION_SECRET: SECRET, ADMIN_SETUP_CODE: CODE, ...extra}
}
function req(path, {method = 'GET', body, cookie, origin} = {}) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
  if (origin) headers.set('origin', origin)
  return new Request('http://127.0.0.1:8788' + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)})
}
async function data(response) {
  const text = await response.text()
  return {status: response.status, json: text ? JSON.parse(text) : {}, cookie: response.headers.get('set-cookie') || ''}
}
function jar(cookieHeader) {
  const match = String(cookieHeader || '').match(/md_session=([^;]*)/)
  return match && match[1] ? `md_session=${match[1]}` : ''
}
function rows(env, prefix) {
  return [...env.PHOTOS.store.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, row]) => ({key, value: JSON.parse(new TextDecoder().decode(row.bytes))}))
}
const car = (extra = {}) => ({id: 'veh_honda', vin: HONDA, year: '2003', make: 'Honda', model: 'Accord', type: 'Sedan', tier: 'sedan', color: 'black', isDefault: true, ...extra})

async function accounts(env) {
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'jordan@millirons.test', password: PASSWORD, code: CODE}}), env}))
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Jordan Millirons', email: 'jordan@millirons.test', password: PASSWORD}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Alex Rivera', email: 'jordan@millirons.test', password: PASSWORD, phone: '4045550199', city: 'Atlanta'}}), env}))
  const other = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email: 'pat@ex.test', password: PASSWORD}}), env}))
  assert.equal(admin.status, 201)
  assert.equal(customer.status, 201)
  assert.equal(employee.status, 201)
  assert.equal(employee.json.user.status, 'Pending review')
  assert.equal(employee.json.user.detailer, 'alex')
  return {
    env,
    adminCookie: jar(admin.cookie),
    customerCookie: jar(customer.cookie),
    employeeCookie: jar(employee.cookie),
    otherCookie: jar(other.cookie),
    admin: admin.json.user,
    customer: customer.json.user,
    employee: employee.json.user,
    other: other.json.user,
  }
}

test('garage vehicles keep a VIN and one default, and drop junk', () => {
  const cleaned = cleanGarageList([
    {id: 'veh_ok', vin: '1hg cm82633a004352', year: '2003', make: 'Honda', model: 'Accord', tier: 'sedan', color: 'blue', isDefault: false, photo: 'data:image/png;base64,abc'},
    {vin: 'not-a-vin', make: 'Nope'},
    {id: 'veh_ok', vin: HONDA, make: 'Duplicate'},
    {userId: 'someone-else', vin: '1HGCM82633A004352', make: 'Stolen'},
  ])
  assert.equal(cleaned.length, 1)
  assert.equal(cleaned[0].vin, HONDA)
  assert.equal(cleaned[0].isDefault, true)
  assert.equal(cleaned[0].color, 'blue')
  assert.equal('photo' in cleaned[0], false)
  assert.equal('userId' in cleaned[0], false)
})

test('preview garage saves only to the admin’s own customer account', async () => {
  const session = await accounts(envOf())
  const usersBefore = JSON.stringify(rows(session.env, '_auth/users/'))
  const saved = await data(await garagePut({request: req('/api/garage', {method: 'PUT', cookie: session.customerCookie, body: {vehicles: [car()]}}), env: session.env}))
  assert.equal(saved.status, 200)
  assert.equal(saved.json.savingToCustomer, false)
  assert.equal(saved.json.vehicles[0].vin, HONDA)

  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'customer'}}), env: session.env})
  const previewRead = await data(await garageGet({request: req('/api/garage', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(previewRead.status, 200)
  assert.equal(previewRead.json.savingToCustomer, true)
  assert.equal(previewRead.json.vehicles[0].vin, HONDA)

  const sneaky = await data(await garagePut({
    request: req('/api/garage', {method: 'PUT', cookie: session.adminCookie, body: {userId: session.other.id, email: session.other.email, customerId: session.other.id, vehicles: [car({color: 'red'})]}}),
    env: session.env,
  }))
  assert.equal(sneaky.status, 200)
  assert.equal(sneaky.json.savingToCustomer, true)
  assert.equal(sneaky.json.vehicles[0].color, 'red')
  const keys = [...session.env.PHOTOS.store.keys()].filter(key => key.startsWith('_auth/garage/'))
  assert.deepEqual(keys, [`_auth/garage/${session.customer.id}.json`])
  assert.equal(session.env.PHOTOS.store.has(`_auth/garage/${session.admin.id}.json`), false)
  assert.equal(session.env.PHOTOS.store.has(`_auth/garage/${session.other.id}.json`), false)
  assert.equal(session.env.PHOTOS.store.has(`_auth/garage/${session.employee.id}.json`), false)
  assert.equal(JSON.stringify(rows(session.env, '_auth/users/')), usersBefore)

  const otherRead = await data(await garageGet({request: req('/api/garage', {cookie: session.otherCookie}), env: session.env}))
  assert.equal(otherRead.status, 200)
  assert.deepEqual(otherRead.json.vehicles, [])
  const ownRead = await data(await garageGet({request: req('/api/garage', {cookie: session.customerCookie}), env: session.env}))
  assert.equal(ownRead.json.vehicles[0].color, 'red')
  assert.equal(ownRead.json.savingToCustomer, false)

  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'employee'}}), env: session.env})
  const employeeWrite = await data(await garagePut({request: req('/api/garage', {method: 'PUT', cookie: session.adminCookie, body: {vehicles: [car({color: 'green'})]}}), env: session.env}))
  assert.equal(employeeWrite.status, 403)
  assert.match(employeeWrite.json.error, /employee view/)
  assert.equal(JSON.parse(new TextDecoder().decode(session.env.PHOTOS.store.get(`_auth/garage/${session.customer.id}.json`).bytes)).vehicles[0].color, 'red')

  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'admin'}}), env: session.env})
  const adminWrite = await data(await garagePut({request: req('/api/garage', {method: 'PUT', cookie: session.adminCookie, body: {vehicles: [car()]}}), env: session.env}))
  assert.equal(adminWrite.status, 403)
  const anon = await data(await garagePut({request: req('/api/garage', {method: 'PUT', body: {vehicles: [car()]}}), env: session.env}))
  assert.equal(anon.status, 401)
})

test('a preview with no customer account does not invent a garage', async () => {
  const env = envOf()
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'solo@millirons.test', password: PASSWORD, code: CODE}}), env}))
  const cookie = jar(admin.cookie)
  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'customer'}}), env})
  const me = await data(await meGet({request: req('/api/auth/me', {cookie}), env}))
  assert.equal(me.json.user.customerMissing, true)
  assert.equal(me.json.user.customerId, undefined)
  const read = await data(await garageGet({request: req('/api/garage', {cookie}), env}))
  assert.equal(read.json.missing, true)
  assert.deepEqual(read.json.vehicles, [])
  const write = await data(await garagePut({request: req('/api/garage', {method: 'PUT', cookie, body: {vehicles: [car()]}}), env}))
  assert.equal(write.status, 400)
  assert.match(write.json.error, /No customer account/)
  assert.equal([...env.PHOTOS.store.keys()].some(key => key.startsWith('_auth/garage/')), false)
})

test('view as employee uses the same-email employee, including a pending one with a different name', async () => {
  const session = await accounts(envOf())
  assert.equal(assignedToEmployee(
    {employeeId: session.employee.id, detailer: 'alex'},
    {id: session.admin.id, preview: true, employeeMissing: true, detailer: 'jordan'},
  ), false)
  assert.equal(customerBooking({email: 'jordan@millirons.test'}, {email: 'Jordan@Millirons.test'}), true)

  const created = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
  assert.equal(created.status, 201)
  const job = created.json.jobs[0]
  assert.equal(job.employeeId, session.employee.id)
  assert.equal(job.detailer, 'alex')

  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'employee'}}), env: session.env})
  const me = await data(await meGet({request: req('/api/auth/me', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(me.json.user.role, 'employee')
  assert.equal(me.json.user.id, session.admin.id)
  assert.equal(me.json.user.employeeId, session.employee.id)
  assert.equal(me.json.user.detailer, 'alex')
  assert.equal(me.json.user.employeeStatus, 'Pending review')
  const asEmployee = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(asEmployee.json.jobs.length, 1)
  assert.equal(asEmployee.json.jobs[0].id, job.id)

  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'customer'}}), env: session.env})
  const asCustomer = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(asCustomer.json.jobs.length, 1)
  assert.equal(asCustomer.json.jobs[0].email, 'jordan@millirons.test')
  const pending = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.employeeCookie}), env: session.env}))
  assert.equal(pending.json.jobs.length, 1)
})

test('a preview booking becomes a test job and never charges or messages', async () => {
  const session = await accounts(envOf({STRIPE_SECRET_KEY: 'sk_test_placeholder'}))
  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'customer'}}), env: session.env})
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}})
  }
  const booking = {
    service: 'full', vehicle: 'sedan', addons: ['pet'], date: '2026-10-21', time: '9:30 AM',
    address: '3393 Peachtree Rd NE', city: 'Atlanta', zip: '30326', phone: '4045550148',
    email: 'JORDAN@millirons.test', name: 'Someone Else', customerId: session.customer.id,
    card: '4242424242424242', cvc: '123', total: 1, detailer: '',
    vin: HONDA, make: 'Honda', model: 'Accord', year: '2003',
  }
  try {
    const blockedCreate = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
    assert.equal(blockedCreate.status, 403)
    const created = await data(await previewBooking({request: req('/api/preview-booking', {method: 'POST', cookie: session.adminCookie, body: {booking}}), env: session.env}))
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const job = created.json.job
    assert.equal(job.isTest, true)
    assert.equal(job.email, 'jordan@millirons.test')
    assert.equal(job.name, 'Jordan Millirons')
    assert.equal(job.customerId, session.customer.id)
    assert.equal(job.employeeId, session.employee.id)
    assert.equal(job.detailer, 'alex')
    assert.equal(job.contactPref, 'none')
    assert.deepEqual(job.payment, {method: 'Test', status: 'Not charged'})
    assert.equal(job.total > 1, true)
    assert.equal(JSON.stringify(job).includes('4242'), false)
    assert.equal(created.json.jobs.some(item => item.id === job.id), true)
    assert.equal(calls.length, 0)

    const stolen = await data(await previewBooking({request: req('/api/preview-booking', {method: 'POST', cookie: session.adminCookie, body: {booking: {...booking, email: 'pat@ex.test'}}}), env: session.env}))
    assert.equal(stolen.status, 403)
    assert.match(stolen.json.error, /own customer account/)
    const asOther = await data(await previewBooking({request: req('/api/preview-booking', {method: 'POST', cookie: session.customerCookie, body: {booking}}), env: session.env}))
    assert.equal(asOther.status, 403)

    const charged = await data(await checkout({request: req('/api/checkout', {method: 'POST', cookie: session.adminCookie, body: {booking: job}}), env: session.env}))
    assert.equal(charged.status, 403)
    await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'admin'}}), env: session.env})
    const still = await data(await checkout({request: req('/api/checkout', {method: 'POST', body: {booking: {...job, total: 1}}}), env: session.env}))
    assert.equal(still.status, 400)
    assert.equal(still.json.error, 'Test jobs are not charged.')
    assert.equal(calls.length, 0)

    const asEmployee = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.employeeCookie}), env: session.env}))
    assert.equal(asEmployee.json.jobs.some(item => item.id === job.id), true)
    const asAdmin = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.adminCookie}), env: session.env}))
    assert.equal(asAdmin.json.jobs.some(item => item.id === job.id), true)
  } finally {
    globalThis.fetch = original
  }
})

test('preview still blocks every write except the garage and a test booking', async () => {
  const session = await accounts(envOf())
  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'customer'}}), env: session.env})
  const garage = await previewMutationBlock(req('/api/garage', {method: 'PUT', cookie: session.adminCookie, body: {}}), session.env)
  const booking = await previewMutationBlock(req('/api/preview-booking', {method: 'POST', cookie: session.adminCookie, body: {}}), session.env)
  const checkoutBlocked = await previewMutationBlock(req('/api/checkout', {method: 'POST', cookie: session.adminCookie, body: {}}), session.env)
  const jobsBlocked = await previewMutationBlock(req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {}}), session.env)
  assert.equal(garage, null)
  assert.equal(booking, null)
  assert.equal(checkoutBlocked.status, 403)
  assert.equal(jobsBlocked.status, 403)

  let reached = false
  const passed = await middleware({
    request: req('/api/garage', {method: 'PUT', cookie: session.adminCookie, origin: 'http://127.0.0.1:8788', body: {}}),
    env: session.env,
    async next() { reached = true; return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}}) },
  })
  assert.equal(reached, true)
  assert.equal(passed.status, 200)
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /setJobsErr/)
  assert.match(app, /data-testid="test-jobs-load-error"/)
  assert.match(app, /Create test booking/)
  assert.match(app, /pp==='\/book'\)page=!authReady/)
  assert.doesNotMatch(app, /testJobsList\(\)[\s\S]{0,240}\.catch\(\(\)=>\{\}\)/)
})

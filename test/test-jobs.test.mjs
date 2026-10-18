import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {quoteBooking} from '../src/data.js'
import {priceFor} from '../functions/api/_stripe.js'
import {onRequestPost as checkout} from '../functions/api/checkout.js'
import {onRequestPost as webhook} from '../functions/api/stripe-webhook.js'
import {onRequestGet as listJobs, onRequestPost as createJobs, onRequestDelete as deleteJobs} from '../functions/api/test-jobs.js'
import {onRequestGet as accountsGet} from '../functions/api/auth/accounts.js'
import {onRequestPost as setupPost} from '../functions/api/auth/setup.js'
import {onRequestPost as register} from '../functions/api/auth/register.js'
import {onRequestPost as apply} from '../functions/api/auth/apply.js'
import {onRequestPost as viewAs} from '../functions/api/auth/view-as.js'
import {
  TEST_JOB_LIMIT, TEST_SAMPLES, assignedToEmployee, buildTestJobs, futureWeekday, isTestJob,
  mergeTestJobs, revenueOf, scheduleBookings, testJobChoices,
} from '../src/testJobs.js'

const SECRET = 'test-session-secret-must-be-32-characters'
const CODE = 'test-setup-code'
const PASSWORD = 'password1'

class MemoryR2 {
  constructor() { this.store = new Map() }
  async get(key) {
    const row = this.store.get(key)
    if (!row) return null
    return {
      text: async () => new TextDecoder().decode(row.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(row.bytes)),
    }
  }
  async put(key, value, opts = {}) {
    if (opts.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    const row = {bytes, etag: '"' + Math.random().toString(16).slice(2) + '"'}
    this.store.set(key, row)
    return {key, etag: row.etag}
  }
  async head(key) { return this.store.has(key) ? {key} : null }
  async delete(key) { this.store.delete(key) }
  async list({prefix = ''} = {}) {
    const keys = [...this.store.keys()].filter(key => key.startsWith(prefix)).sort()
    return {objects: keys.map(key => ({key})), truncated: false, cursor: null}
  }
}

function envOf(extra = {}) {
  return {PHOTOS: new MemoryR2(), SESSION_SECRET: SECRET, ADMIN_SETUP_CODE: CODE, ...extra}
}
function req(path, {method = 'GET', body, cookie} = {}) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
  return new Request('http://127.0.0.1:8788' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function data(response) {
  const text = await response.text()
  return {status: response.status, json: text ? JSON.parse(text) : {}, cookie: response.headers.get('set-cookie') || ''}
}
function jar(cookieHeader) {
  const match = cookieHeader.match(/md_session=([^;]*)/)
  return match && match[1] ? `md_session=${match[1]}` : ''
}
function rows(env, prefix) {
  return [...env.PHOTOS.store.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, row]) => ({key, value: JSON.parse(new TextDecoder().decode(row.bytes))}))
}

async function accounts(env) {
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'jordan@millirons.test', password: PASSWORD, code: CODE}}), env}))
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Jordan Millirons', email: 'jordan@millirons.test', password: PASSWORD}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Jordan Millirons', email: 'jordan@millirons.test', password: PASSWORD, phone: '4045550199', city: 'Atlanta'}}), env}))
  const other = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email: 'pat@ex.test', password: PASSWORD}}), env}))
  assert.equal(admin.status, 201)
  assert.equal(customer.status, 201)
  assert.equal(employee.status, 201)
  assert.equal(other.status, 201)
  assert.notEqual(customer.json.user.id, admin.json.user.id)
  assert.notEqual(employee.json.user.id, admin.json.user.id)
  assert.equal(customer.json.user.email, admin.json.user.email)
  assert.equal(employee.json.user.email, admin.json.user.email)
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

test('sample jobs use quoteBooking and priceFor, and stay varied', () => {
  const now = Date.parse('2026-10-18T15:00:00Z')
  const jobs = buildTestJobs({
    customer: {id: 'customer-1', name: 'Jordan Millirons', email: 'Jordan@Millirons.test', phone: '(404) 555-0148'},
    employee: {id: 'employee-1', name: 'Jordan Millirons', detailer: 'jordan'},
    count: TEST_JOB_LIMIT,
    now,
    nonce: 'ab',
  })
  assert.equal(jobs.length, TEST_SAMPLES.length)
  assert.equal(new Set(jobs.map(job => job.service)).size, 5)
  assert.equal(new Set(jobs.map(job => job.vehicle)).size, 3)
  assert.ok(jobs.some(job => job.addons.length === 0))
  assert.ok(jobs.some(job => job.addons.length > 1))
  assert.ok(jobs.some(job => job.city === 'Decatur'))
  assert.ok(jobs.some(job => job.city === 'Sandy Springs'))
  assert.ok(jobs.every(job => job.city === 'Atlanta' || job.city === 'Decatur' || job.city === 'Sandy Springs'))
  const ids = new Set()
  for (const job of jobs) {
    assert.equal(job.isTest, true)
    assert.equal(isTestJob(job), true)
    assert.match(job.id, /^MD-[A-Z0-9]{4,20}$/)
    assert.equal(ids.has(job.id), false)
    ids.add(job.id)
    assert.notEqual(new Date(job.date + 'T12:00:00').getDay(), 0)
    const quote = quoteBooking(job)
    const priced = priceFor({...job, total: 1, amount: 1, price: 1})
    assert.equal(quote.ok, true)
    assert.deepEqual(priced, quote)
    assert.equal(job.total, priced.usd)
    assert.equal(job.surchargeUsd, priced.surchargeUsd)
    assert.equal(job.total >= 50, true)
    assert.deepEqual(job.payment, {method: 'Test', status: 'Not charged'})
    assert.equal(job.stripeSession, undefined)
    assert.equal(job.email, 'jordan@millirons.test')
    assert.equal(job.detailer, 'jordan')
    assert.equal(job.employeeId, 'employee-1')
    assert.equal(job.customerId, 'customer-1')
    assert.equal(JSON.stringify(job).includes('password'), false)
  }
  assert.equal(futureWeekday(now, 1) > '2026-10-18', true)
})

test('revenue and public availability ignore test jobs, and merge keeps real bookings', () => {
  const real = {id: 'MD-REAL1', total: 149, date: '2026-10-21', time: '9:30 AM', isTest: false}
  const testJob = {id: 'MD-TTEST01', total: 583, date: '2026-10-21', time: '9:30 AM', isTest: true, email: 'a@b.c'}
  assert.equal(revenueOf([real, testJob, {total: 'nope'}]), 149)
  assert.deepEqual(scheduleBookings([real, testJob]).map(job => job.id), ['MD-REAL1'])
  const merged = mergeTestJobs([real, {id: 'MD-OLD', isTest: true, total: 10}], [testJob, {id: 'MD-FAKE', total: 5}])
  assert.deepEqual(merged.map(job => job.id), ['MD-REAL1', 'MD-TTEST01'])
  assert.equal(assignedToEmployee(testJob, {id: 'employee-1', detailer: 'other'}), false)
  assert.equal(assignedToEmployee({...testJob, employeeId: 'employee-1'}, {id: 'employee-1', detailer: 'other'}), true)
  const calendar = readFileSync(new URL('../src/BookingCalendar.jsx', import.meta.url), 'utf8')
  assert.match(calendar, /scheduleBookings\(all\)/)
  const route = readFileSync(new URL('../functions/api/test-jobs.js', import.meta.url), 'utf8')
  assert.doesNotMatch(route, /stripe\(|mailto:|sms:|hireInvites|notifyAccounts/)
})

test('only an admin can create test jobs, priced on the server, with no Stripe call or message', async () => {
  const session = await accounts(envOf())
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (...args) => { calls.push(String(args[0])); throw new Error('network') }
  try {
    const anon = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
    assert.equal(anon.status, 401)
    const customerDenied = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.customerCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
    assert.equal(customerDenied.status, 403)
    const employeeDenied = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.employeeCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
    assert.equal(employeeDenied.status, 403)
    const wrongRole = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.admin.id, employeeId: session.employee.id, count: 1, total: 1}}), env: session.env}))
    assert.equal(wrongRole.status, 400)
    const several = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: TEST_JOB_LIMIT, total: 1}}), env: session.env}))
    assert.equal(several.status, 201)
    assert.equal(several.json.created, TEST_JOB_LIMIT)
    assert.equal(several.json.jobs.length, TEST_JOB_LIMIT)
    assert.equal(calls.length, 0)
    for (const job of several.json.jobs) {
      const priced = priceFor(job)
      assert.equal(job.isTest, true)
      assert.equal(job.total, priced.usd)
      assert.equal(job.surchargeUsd, priced.surchargeUsd)
      assert.equal(job.email, 'jordan@millirons.test')
      assert.equal(job.customerId, session.customer.id)
      assert.equal(job.employeeId, session.employee.id)
      assert.equal(job.detailer, 'jordan')
      assert.deepEqual(job.payment, {method: 'Test', status: 'Not charged'})
      assert.equal(JSON.stringify(job).toLowerCase().includes('stripe'), false)
      assert.equal(JSON.stringify(job).includes('password'), false)
      assert.equal(JSON.stringify(job).includes('mailto:'), false)
      assert.equal(JSON.stringify(job).includes('sms:'), false)
    }
    const stored = rows(session.env, '_auth/test-jobs/')
    assert.equal(stored.length, TEST_JOB_LIMIT)
    assert.equal(stored.every(row => row.value.isTest === true && row.value.password === undefined), true)
    const asCustomer = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.customerCookie}), env: session.env}))
    assert.equal(asCustomer.status, 200)
    assert.equal(asCustomer.json.jobs.length, TEST_JOB_LIMIT)
    const asEmployee = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.employeeCookie}), env: session.env}))
    assert.equal(asEmployee.json.jobs.length, TEST_JOB_LIMIT)
    const asOther = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.otherCookie}), env: session.env}))
    assert.deepEqual(asOther.json.jobs, [])
    const asAdmin = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.adminCookie}), env: session.env}))
    assert.equal(asAdmin.json.jobs.length, TEST_JOB_LIMIT)
  } finally {
    globalThis.fetch = original
  }
})

test('view as cannot create test jobs, and delete removes only isTest records', async () => {
  const session = await accounts(envOf())
  const created = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 2}}), env: session.env}))
  assert.equal(created.status, 201)
  const preview = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'customer'}}), env: session.env}))
  assert.equal(preview.json.user.role, 'customer')
  assert.equal(preview.json.user.email, 'jordan@millirons.test')
  const blocked = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
  assert.equal(blocked.status, 403)
  assert.match(blocked.json.error, /Preview only/)
  const seen = await data(await listJobs({request: req('/api/test-jobs', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(seen.json.jobs.length, 2)
  await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: session.adminCookie, body: {role: 'admin'}}), env: session.env})

  session.env.PHOTOS.store.set('_auth/test-jobs/MD-KEEP1.json', {bytes: new TextEncoder().encode(JSON.stringify({id: 'MD-KEEP1', isTest: false, total: 10}))})
  session.env.PHOTOS.store.set('payments/MD-REAL1.json', {bytes: new TextEncoder().encode(JSON.stringify({amount: 149}))})
  const usersBefore = rows(session.env, '_auth/users/').length
  const unconfirmed = await data(await deleteJobs({request: req('/api/test-jobs', {method: 'DELETE', cookie: session.adminCookie, body: {}}), env: session.env}))
  assert.equal(unconfirmed.status, 400)
  assert.equal(rows(session.env, '_auth/test-jobs/').filter(row => row.value.isTest === true).length, 2)
  const denied = await data(await deleteJobs({request: req('/api/test-jobs', {method: 'DELETE', cookie: session.customerCookie, body: {confirm: true}}), env: session.env}))
  assert.equal(denied.status, 403)
  const removed = await data(await deleteJobs({request: req('/api/test-jobs', {method: 'DELETE', cookie: session.adminCookie, body: {confirm: true}}), env: session.env}))
  assert.equal(removed.status, 200)
  assert.equal(removed.json.deleted, 2)
  assert.deepEqual(removed.json.jobs, [])
  const left = rows(session.env, '_auth/test-jobs/')
  assert.equal(left.length, 1)
  assert.equal(left[0].value.id, 'MD-KEEP1')
  assert.equal(left[0].value.isTest, false)
  assert.equal(session.env.PHOTOS.store.has('payments/MD-REAL1.json'), true)
  assert.equal(rows(session.env, '_auth/users/').length, usersBefore)
})

test('test jobs never open a Stripe or Affirm session and never record a payment', async () => {
  const session = await accounts(envOf({STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder'}))
  const created = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env}))
  const job = created.json.jobs[0]
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), body: String(init?.body || '')})
    return new Response(JSON.stringify({id: 'cs_should_not_exist', url: 'https://checkout.stripe.test/c/cs_should_not_exist'}), {status: 200, headers: {'content-type': 'application/json'}})
  }
  try {
    const flagged = await data(await checkout({request: req('/api/checkout', {method: 'POST', body: {booking: {...job, total: 1}}}), env: session.env}))
    assert.equal(flagged.status, 400)
    assert.equal(flagged.json.error, 'Test jobs are not charged.')
    const stored = await data(await checkout({request: req('/api/checkout', {method: 'POST', body: {booking: {id: job.id, service: job.service, vehicle: job.vehicle, addons: job.addons, total: 1}}}), env: session.env}))
    assert.equal(stored.status, 400)
    assert.equal(stored.json.error, 'Test jobs are not charged.')
    assert.equal(calls.length, 0)
  } finally {
    globalThis.fetch = original
  }

  const rawTest = JSON.stringify({type: 'checkout.session.completed', data: {object: {id: 'cs_test_job', payment_status: 'paid', amount_total: job.total * 100, metadata: {bookingId: job.id, isTest: 'true'}, client_reference_id: job.id}}})
  const secret = 'whsec_test_placeholder'
  const signature = await stripeSignature(rawTest, secret)
  const skipped = await data(await webhook({request: new Request('http://127.0.0.1:8788/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': signature, 'content-type': 'application/json'}, body: rawTest}), env: session.env}))
  assert.equal(skipped.status, 200)
  assert.equal(session.env.PHOTOS.store.has(`payments/${job.id}.json`), false)

  const rawReal = JSON.stringify({type: 'checkout.session.async_payment_succeeded', data: {object: {id: 'cs_real', payment_status: 'paid', amount_total: 14900, metadata: {bookingId: 'MD-REAL123'}, client_reference_id: 'MD-REAL123'}}})
  const paid = await data(await webhook({request: new Request('http://127.0.0.1:8788/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': await stripeSignature(rawReal, secret), 'content-type': 'application/json'}, body: rawReal}), env: session.env}))
  assert.equal(paid.status, 200)
  assert.equal(session.env.PHOTOS.store.has('payments/MD-REAL123.json'), true)
})

test('a normal checkout still reaches Stripe when the booking is not a test job', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), body: decodeURIComponent(String(init?.body || ''))})
    return new Response(JSON.stringify({id: 'cs_real', url: 'https://checkout.stripe.test/c/cs_real'}), {status: 200, headers: {'content-type': 'application/json'}})
  }
  try {
    const response = await data(await checkout({
      request: req('/api/checkout', {method: 'POST', body: {booking: {id: 'MD-REAL123', service: 'interior', vehicle: 'sedan', addons: [], total: 1}}}),
      env: {STRIPE_SECRET_KEY: 'sk_test_placeholder'},
    }))
    assert.equal(response.status, 200)
    assert.equal(response.json.amount, 149)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /checkout\/sessions$/)
    assert.match(calls[0].body, /\[unit_amount\]=14900/)
    assert.doesNotMatch(calls[0].body, /\[unit_amount\]=100(?:&|$)/)
  } finally {
    globalThis.fetch = original
  }
})

async function stripeSignature(raw, secret) {
  const stamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${stamp}.${raw}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `t=${stamp},v1=${sig}`
}

test('an employee on another account does not receive someone else\'s test jobs', async () => {
  const session = await accounts(envOf())
  const otherEmployee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Chris Lane', email: 'chris@millirons.test', password: PASSWORD, phone: '4045550101', city: 'Decatur'}}), env: session.env}))
  assert.equal(otherEmployee.status, 201)
  await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: session.customer.id, employeeId: session.employee.id, count: 1}}), env: session.env})
  const hidden = await data(await listJobs({request: req('/api/test-jobs', {cookie: jar(otherEmployee.cookie)}), env: session.env}))
  assert.deepEqual(hidden.json.jobs, [])
  const signedOut = await data(await listJobs({request: req('/api/test-jobs'), env: session.env}))
  assert.equal(signedOut.status, 401)
})

test('summary lists the admin email’s customer and pending employee, without application files', async () => {
  const session = await accounts(envOf())
  const employeeRow = rows(session.env, '_auth/users/').find(row => row.value.id === session.employee.id)
  employeeRow.value.van = {photos: [{name: 'van.jpg', data: 'data:image/jpeg;base64,' + 'A'.repeat(8000)}], docs: []}
  await session.env.PHOTOS.put(employeeRow.key, JSON.stringify(employeeRow.value))

  const summary = await data(await accountsGet({request: req('/api/auth/accounts?summary=1', {cookie: session.adminCookie}), env: session.env}))
  assert.equal(summary.status, 200)
  const body = JSON.stringify(summary.json)
  assert.equal(body.includes('data:image'), false)
  assert.equal(body.includes('password'), false)
  assert.equal(body.includes('PBKDF2'), false)
  const customer = summary.json.accounts.find(account => account.role === 'customer' && account.email === session.admin.email)
  const employee = summary.json.accounts.find(account => account.id === session.employee.id)
  const admin = summary.json.accounts.find(account => account.id === session.admin.id)
  assert.ok(customer)
  assert.ok(admin)
  assert.equal(customer.id === admin.id, false)
  assert.equal(employee.role, 'employee')
  assert.equal(employee.status, 'Pending review')
  assert.equal(employee.email, session.admin.email)
  assert.ok(summary.json.pending >= 1)

  const choices = testJobChoices(summary.json.accounts, {email: 'Jordan@Millirons.test', role: 'admin'})
  assert.equal(choices.customer.id, customer.id)
  assert.equal(choices.employee.id, employee.id)
  assert.equal(choices.customers.length >= 2, true)
  assert.equal(choices.employees.some(account => account.status !== 'Approved'), true)

  const created = await data(await createJobs({request: req('/api/test-jobs', {method: 'POST', cookie: session.adminCookie, body: {customerId: customer.id, employeeId: employee.id, count: 1}}), env: session.env}))
  assert.equal(created.status, 201)
  assert.equal(created.json.created, 1)
  assert.equal(created.json.jobs[0].customerId, customer.id)
  assert.equal(created.json.jobs[0].employeeId, employee.id)
  assert.equal(created.json.jobs[0].isTest, true)
  assert.equal(created.json.jobs[0].payment.status, 'Not charged')
})

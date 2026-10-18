// Admin-only test bookings. Records live in the existing PHOTOS bucket under
// the private `_auth/test-jobs/` prefix and are mirrored into md_bookings.
// This route never calls Stripe or Affirm and never sends email, SMS, or a notification.
import {priceFor} from './_stripe.js'
import {guard, json, fail, readJson, requireAdmin, readSession, withPreviewAccounts, getUserById} from '../_lib/auth.js'
import {assignedToEmployee, buildTestJobs, isTestJob, TEST_JOB_LIMIT} from '../../src/testJobs.js'

const BOOKING_ID = /^MD-[A-Z0-9]{4,20}$/
const PREFIX = '_auth/test-jobs/'

function keyFor(id) {
  return `${PREFIX}${id}.json`
}

async function readJob(env, key) {
  const object = await env.PHOTOS.get(key)
  if (!object) return null
  try { return typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text()) }
  catch { return null }
}

async function listStored(env) {
  const jobs = []
  let cursor
  do {
    const page = await env.PHOTOS.list({prefix: PREFIX, cursor})
    for (const object of page.objects || []) {
      const job = await readJob(env, object.key)
      if (job) jobs.push(job)
    }
    cursor = page.truncated ? page.cursor : null
  } while (cursor)
  return jobs
}

function publish(job) {
  if (!isTestJob(job) || !BOOKING_ID.test(job.id || '')) return null
  return {
    id: job.id,
    isTest: true,
    service: job.service,
    addons: Array.isArray(job.addons) ? job.addons.filter(id => typeof id === 'string') : [],
    vehicle: job.vehicle,
    address: job.address || '',
    unit: job.unit || '',
    city: job.city || '',
    zip: job.zip || '',
    parking: job.parking || '',
    water: job.water || '',
    notes: job.notes || '',
    make: job.make || '',
    model: job.model || '',
    year: job.year || '',
    color: job.color || '',
    plate: job.plate || '',
    vin: job.vin || '',
    date: job.date || '',
    time: job.time || '',
    detailer: job.detailer || '',
    detailerName: job.detailerName || '',
    employeeId: job.employeeId || '',
    customerId: job.customerId || '',
    name: job.name || '',
    email: job.email || '',
    phone: job.phone || '',
    contactPref: 'none',
    total: job.total,
    surchargeUsd: job.surchargeUsd,
    status: job.status || 'Confirmed',
    payment: {method: 'Test', status: 'Not charged'},
    created: job.created || '',
  }
}

function canSee(user, job) {
  if (!user || !isTestJob(job)) return false
  if (user.role === 'admin') return true
  if (user.role === 'customer') return String(job.email || '').toLowerCase() === String(user.email || '').toLowerCase()
  if (user.role === 'employee') return assignedToEmployee(job, user)
  return false
}

async function visibleJobs(env, user) {
  const jobs = (await listStored(env)).map(publish).filter(job => job && canSee(user, job))
  jobs.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
  return jobs
}

export async function isStoredTestJob(env, id) {
  if (!env?.PHOTOS || !BOOKING_ID.test(String(id || ''))) return false
  const job = await readJob(env, keyFor(id))
  return job?.isTest === true
}

async function viewer(request, env) {
  const loaded = await readSession(request, env)
  if (!loaded?.user) return {user: null, error: json({error: 'Sign in required.'}, 401)}
  return {user: await withPreviewAccounts(env, loaded.user, loaded.session), error: null}
}

export async function storeTestJob(env, job) {
  const record = publish(job)
  if (!record) throw fail('Could not create that test job.', 400)
  const result = await env.PHOTOS.put(keyFor(record.id), JSON.stringify(record), {
    httpMetadata: {contentType: 'application/json'},
    onlyIf: {etagDoesNotMatch: '*'},
  })
  if (!result) throw fail('Could not create that test job. Try again.', 409)
  return record
}

export async function jobsFor(request, env) {
  const viewed = await viewer(request, env)
  if (viewed.error) return viewed
  return {user: viewed.user, jobs: await visibleJobs(env, viewed.user), error: null}
}

async function list({request, env}) {
  const {user, error} = await viewer(request, env)
  if (error) return error
  return json({jobs: await visibleJobs(env, user)})
}

function phoneOf(customer) {
  return String(customer.profile?.phone || customer.phone || '(404) 555-0100').trim().slice(0, 30)
}

async function create({request, env}) {
  const {user, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const count = Number(body.count)
  if (!Number.isInteger(count) || count < 1 || count > TEST_JOB_LIMIT) throw fail('Choose one or several test jobs.', 400)
  const customer = await getAccount(env, body.customerId)
  const employee = await getAccount(env, body.employeeId)
  if (!customer || customer.role !== 'customer') throw fail('Choose a customer account.', 400)
  if (!employee || employee.role !== 'employee') throw fail('Choose an employee account.', 400)
  const nonce = [...crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(36)).join('').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'A'
  const jobs = buildTestJobs({
    customer: {id: customer.id, name: customer.name, email: customer.email, phone: phoneOf(customer)},
    employee: {id: employee.id, name: employee.name, detailer: employee.detailer},
    count,
    now: Date.now(),
    nonce,
  })
  const ready = []
  for (const job of jobs) {
    const priced = priceFor({service: job.service, vehicle: job.vehicle, addons: job.addons})
    if (!priced.ok || priced.usd !== job.total || priced.surchargeUsd !== job.surchargeUsd) throw fail('Could not price that test job.', 500)
    job.total = priced.usd
    job.surchargeUsd = priced.surchargeUsd
    job.isTest = true
    job.payment = {method: 'Test', status: 'Not charged'}
    ready.push(publish(job))
  }
  for (const record of ready) await storeTestJob(env, record)
  return json({jobs: await visibleJobs(env, user), created: ready.length}, 201)
}

function getAccount(env, id) {
  return getUserById(env, id)
}

async function remove({request, env}) {
  const {user, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  if (body.confirm !== true) throw fail('Confirm deleting test jobs.', 400)
  let deleted = 0
  for (const job of await listStored(env)) {
    if (job?.isTest !== true || !BOOKING_ID.test(job.id || '')) continue
    await env.PHOTOS.delete(keyFor(job.id))
    deleted += 1
  }
  return json({ok: true, deleted, jobs: await visibleJobs(env, user)})
}

export const onRequestGet = guard(list)
export const onRequestPost = guard(create)
export const onRequestDelete = guard(remove)

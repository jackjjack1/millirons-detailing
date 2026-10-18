// A booking made while an admin is previewing. It is stored as a test job on
// the admin's own customer account. This route never calls Stripe or Affirm
// and never sends email, SMS, or a notification.
import {priceFor} from './_stripe.js'
import {
  guard, json, fail, readJson, readSession, activePreview,
  ownCustomerAccount, ownEmployeeAccount, listUsers,
} from '../_lib/auth.js'
import {employeeDetailer, previewTestRecord} from '../../src/testJobs.js'
import {jobsFor, storeTestJob} from './test-jobs.js'

async function resolveEmployee(env, admin, detailerId) {
  const own = await ownEmployeeAccount(env, admin)
  const wanted = String(detailerId || '').trim().toLowerCase()
  if (!wanted || (own && employeeDetailer(own) === wanted)) return own
  const users = await listUsers(env)
  const match = users.find(user => user.role === 'employee' && user.status === 'Approved' && employeeDetailer(user) === wanted)
  return match || own
}

async function create({request, env}) {
  const loaded = await readSession(request, env)
  if (!loaded?.user) return json({error: 'Sign in required.'}, 401)
  if (!activePreview(loaded.user, loaded.session)) throw fail('Preview only. Switch back to Admin before creating a real booking or payment.', 403)
  const customer = await ownCustomerAccount(env, loaded.user)
  const body = await readJson(request)
  const booking = body?.booking && typeof body.booking === 'object' ? body.booking : {}
  const quote = priceFor({service: booking.service, vehicle: booking.vehicle, addons: booking.addons})
  const employee = customer ? await resolveEmployee(env, loaded.user, booking.detailer) : null
  const nonce = [...crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(36)).join('').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'P'
  let record
  try {
    record = previewTestRecord({customer, employee, booking, quote, now: Date.now(), nonce})
  } catch (error) {
    throw fail(error.message || 'Could not create that test booking.', error.status || 400)
  }
  record.isTest = true
  record.contactPref = 'none'
  record.payment = {method: 'Test', status: 'Not charged'}
  const saved = await storeTestJob(env, record)
  const viewed = await jobsFor(request, env)
  if (viewed.error) return viewed.error
  return json({job: saved, jobs: viewed.jobs}, 201)
}

export const onRequestPost = guard(create)

// Customer garage. A preview write is allowed only for the admin's own
// customer account on the same email. The client cannot choose another user.
import {guard, json, fail, readJson, readSession, activePreview, ownCustomerAccount} from '../_lib/auth.js'
import {cleanGarageList} from '../../src/garage.js'

function keyFor(id) {
  return `_auth/garage/${id}.json`
}

async function readGarage(env, userId) {
  const object = await env.PHOTOS.get(keyFor(userId))
  if (!object) return []
  try {
    const parsed = typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text())
    if (parsed?.userId && parsed.userId !== userId) return []
    return cleanGarageList(parsed?.vehicles)
  } catch {
    return []
  }
}

async function resolve(request, env, write) {
  const loaded = await readSession(request, env)
  if (!loaded?.user) return {error: json({error: 'Sign in required.'}, 401)}
  const preview = activePreview(loaded.user, loaded.session)
  if (preview === 'employee') return {error: json({error: 'Preview only. Vehicles are not saved in the employee view.'}, 403)}
  if (preview === 'customer') {
    const customer = await ownCustomerAccount(env, loaded.user)
    if (!customer) {
      if (!write) return {missing: true, savingToCustomer: false, user: null}
      return {error: json({error: 'No customer account on this email. Create a customer account before saving a vehicle.'}, 400)}
    }
    return {user: customer, savingToCustomer: true}
  }
  if (loaded.user.role === 'customer') return {user: loaded.user, savingToCustomer: false}
  return {error: json({error: 'Sign in as a customer to save vehicles.'}, 403)}
}

async function read({request, env}) {
  const target = await resolve(request, env, false)
  if (target.error) return target.error
  if (target.missing) return json({vehicles: [], missing: true, savingToCustomer: false})
  return json({
    vehicles: await readGarage(env, target.user.id),
    missing: false,
    savingToCustomer: !!target.savingToCustomer,
  })
}

async function write({request, env}) {
  const target = await resolve(request, env, true)
  if (target.error) return target.error
  const body = await readJson(request)
  const vehicles = cleanGarageList(body.vehicles)
  if (Array.isArray(body.vehicles) && body.vehicles.length && !vehicles.length) throw fail('Enter a valid 17-character VIN.', 400)
  await env.PHOTOS.put(keyFor(target.user.id), JSON.stringify({userId: target.user.id, vehicles}), {
    httpMetadata: {contentType: 'application/json'},
  })
  return json({vehicles, missing: false, savingToCustomer: !!target.savingToCustomer})
}

export const onRequestGet = guard(read)
export const onRequestPut = guard(write)

// Public list of approved detailers. No ratings, reviews, email, or application files.
import {guard, json, listUsers} from '../_lib/auth.js'
import {publicDetailers} from '../../src/detailers.js'

async function list({env}) {
  if (!env?.PHOTOS) return json({detailers: []})
  const detailers = publicDetailers(await listUsers(env))
  return json({detailers})
}

export const onRequestGet = guard(list)

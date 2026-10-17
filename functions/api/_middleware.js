import {applyCors, isAllowedOrigin, preflightHeaders, requiresOriginCheck, STATE_CHANGING} from '../_lib/cors.js'
import {previewMutationBlock} from '../_lib/auth.js'

function denied(message) {
  return new Response(JSON.stringify({error: message}), {
    status: 403,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  })
}

export async function onRequest(context) {
  const {request} = context
  const origin = request.headers.get('origin')
  const allowed = isAllowedOrigin(origin, request)

  if (request.method === 'OPTIONS') {
    if (!allowed) return new Response(null, {status: 403, headers: {'cache-control': 'no-store'}})
    return new Response(null, {status: 204, headers: preflightHeaders(origin)})
  }

  // SameSite=None cookies are sent on cross-site fetches. State-changing routes
  // (including PATCH) must name an allowlisted Origin. Stripe's webhook is signed
  // and is not cookie-authenticated, and Stripe does not send Origin.
  if (requiresOriginCheck(request) && !allowed) {
    return denied(origin ? 'This origin is not allowed.' : 'Origin is required.')
  }

  if (STATE_CHANGING.has(request.method)) {
    const blocked = await previewMutationBlock(request, context.env)
    if (blocked) return applyCors(blocked, allowed ? origin : '')
  }

  const response = await context.next()
  return applyCors(response, allowed ? origin : '')
}

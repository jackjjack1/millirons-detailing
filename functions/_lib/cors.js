// Credentialed CORS for /api. Browsers reject Access-Control-Allow-Origin: *
// when Access-Control-Allow-Credentials is true, so a matching Origin is reflected
// and a wildcard is never sent.
//
// Allowlist:
//   https://millironsdetailing.com
//   https://www.millironsdetailing.com
//   https://millirons-detailing.pages.dev
//   https://<one-label>.millirons-detailing.pages.dev
//   Exact AI Studio preview hosts observed for this project. Google does not
//     document a stability guarantee or project identifier in preview hostnames;
//     add only a newly verified exact hostname if a preview rotates. Other
//     *.usercontent.goog hosts are not included.
//   Exact Freebuff preview hosts observed for this workspace; other *.style.dev
//     origins are not included.
//   http(s)://localhost, 127.0.0.1, or ::1 — only when this request itself is
//     aimed at a local host, so a page on the developer's machine cannot call
//     the production API.

const PRODUCTION_HOSTS = new Set([
  'millironsdetailing.com',
  'www.millironsdetailing.com',
  'millirons-detailing.pages.dev',
])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PAGES_SUFFIX = '.millirons-detailing.pages.dev'
const AI_STUDIO_PREVIEW_HOSTS = new Set([
  '1jl1na33u4rjuae5liy703wpawa0n7vbg8kwsoearjbano01hv-h830895770.scf.usercontent.goog',
  '18skwhjotk39mh0r3x4tql413g0u3fgnf3r3m8yu05rm30musr-h852644758.scf.usercontent.goog',
])
const FREEBUFF_PREVIEW_HOSTS = new Set([
  'pv-3ed654dcaea0-f048e0d5-f335-4b5b-82b9-83447e59dfbe.style.dev',
  'pv-3ed654dcaea0-b807da82-be41-4b0b-a9c6-bf7de039d997.style.dev',
])
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const WEBHOOK_PATH = '/api/stripe-webhook'

function parseOrigin(origin) {
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return null
  let url
  try { url = new URL(origin) } catch { return null }
  if (url.origin !== origin) return null
  if (url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url
}

function bareHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
}

function requestHost(request) {
  try { return bareHost(new URL(request.url).hostname) } catch { return '' }
}

function isLocalHost(host) {
  return LOCAL_HOSTS.has(bareHost(host))
}

function defaultHttpsPort(url) {
  return url.port === '' || url.port === '443'
}

function projectPagesHost(host) {
  if (!host.endsWith(PAGES_SUFFIX)) return false
  const label = host.slice(0, -PAGES_SUFFIX.length)
  return DNS_LABEL.test(label)
}

export function isAllowedOrigin(origin, request) {
  const url = parseOrigin(origin)
  if (!url) return false
  const host = bareHost(url.hostname)
  if (isLocalHost(host)) {
    return isLocalHost(requestHost(request)) && (url.protocol === 'http:' || url.protocol === 'https:')
  }
  if (url.protocol !== 'https:' || !defaultHttpsPort(url)) return false
  if (PRODUCTION_HOSTS.has(host)) return true
  if (FREEBUFF_PREVIEW_HOSTS.has(host)) return true
  if (projectPagesHost(host)) return true
  if (AI_STUDIO_PREVIEW_HOSTS.has(host)) return true
  return false
}

export function requiresOriginCheck(request) {
  if (!STATE_CHANGING.has(request.method)) return false
  try { return new URL(request.url).pathname !== WEBHOOK_PATH } catch { return true }
}

function cloneHeaders(response) {
  const headers = new Headers()
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue
    headers.append(key, value)
  }
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return headers
}

function appendVary(headers, token) {
  const current = headers.get('vary')
  if (!current) {
    headers.set('vary', token)
    return
  }
  const parts = current.split(',').map(part => part.trim().toLowerCase())
  if (!parts.includes('*') && !parts.includes(token.toLowerCase())) headers.set('vary', current + ', ' + token)
}

export function preflightHeaders(origin) {
  return new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
    'cache-control': 'no-store',
  })
}

// Drop any handler-supplied CORS header (including *) and, for an allowlisted
// origin only, reflect that exact origin with credentials enabled.
export function applyCors(response, origin) {
  const headers = cloneHeaders(response)
  headers.delete('access-control-allow-origin')
  headers.delete('access-control-allow-credentials')
  if (origin && origin !== '*') {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    appendVary(headers, 'Origin')
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}

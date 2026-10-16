// Credentialed CORS for /api. Browsers reject Access-Control-Allow-Origin: *
// when Access-Control-Allow-Credentials is true, so a matching Origin is reflected
// and a wildcard is never sent.
//
// Allowlist:
//   https://millironsdetailing.com
//   https://www.millironsdetailing.com
//   https://millirons-detailing.pages.dev
//   https://<one-label>.millirons-detailing.pages.dev
//   https://<hash>-h<version>.scf.usercontent.goog
//     Google AI Studio's preview iframe. Confirmed from AI Studio build-preview
//     failures and Google's SafeContentFrame writeup: the app runs on
//     https://<hash>-h<version>.scf.usercontent.goog, not on aistudio.google.com.
//     Other *.usercontent.goog and *.googleusercontent.com hosts are not included.
//   The exact Freebuff preview host for this workspace; other *.style.dev origins
//     are not included.
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
const PREVIEW_SUFFIX = '.scf.usercontent.goog'
const FREEBUFF_PREVIEW_HOST = 'pv-3ed654dcaea0-f048e0d5-f335-4b5b-82b9-83447e59dfbe.style.dev'
const PREVIEW_LABEL = /^[a-z0-9]{12,52}-h\d{4,12}$/
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

function aiStudioPreviewHost(host) {
  if (!host.endsWith(PREVIEW_SUFFIX)) return false
  const label = host.slice(0, -PREVIEW_SUFFIX.length)
  return label.length <= 63 && PREVIEW_LABEL.test(label)
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
  if (host === FREEBUFF_PREVIEW_HOST) return true
  if (projectPagesHost(host)) return true
  if (aiStudioPreviewHost(host)) return true
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

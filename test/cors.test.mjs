import assert from 'node:assert/strict'
import test from 'node:test'
import {applyCors, isAllowedOrigin, preflightHeaders, requiresOriginCheck} from '../functions/_lib/cors.js'
import {onRequest} from '../functions/api/_middleware.js'
import {sessionCookie} from '../functions/_lib/auth.js'
import {PRODUCTION_API, normalizeApiBase, resolveApiBase} from '../src/apiOrigin.js'

const PREVIEW = 'https://1jl1na33u4rjuae5liy703wpawa0n7vbg8kwsoearjbano01hv-h830895770.scf.usercontent.goog'
const PRODUCTION = 'https://millironsdetailing.com'

function call(path, {method = 'GET', origin, url} = {}) {
  const headers = new Headers()
  if (origin !== undefined) headers.set('origin', origin)
  return new Request(url || PRODUCTION + path, {method, headers})
}

function noStar(headers) {
  assert.notEqual(headers.get('access-control-allow-origin'), '*')
  const joined = [...headers.entries()].map(([k, v]) => k + ':' + v).join('\n')
  assert.equal(joined.includes('access-control-allow-origin: *'), false)
}

test('allowlist accepts production, this Pages project, and the AI Studio preview host', () => {
  const allowed = [
    'https://millironsdetailing.com',
    'https://www.millironsdetailing.com',
    'https://millirons-detailing.pages.dev',
    'https://main.millirons-detailing.pages.dev',
    'https://cursor-aistudio-preview-cors-354f.millirons-detailing.pages.dev',
    'https://pv-3ed654dcaea0-f048e0d5-f335-4b5b-82b9-83447e59dfbe.style.dev',
    PREVIEW,
    'https://18skwhjotk39mh0r3x4tql413g0u3fgnf3r3m8yu05rm30musr-h852644758.scf.usercontent.goog',
  ]
  for (const origin of allowed) assert.equal(isAllowedOrigin(origin, call('/api/auth/me')), true, origin)
})

test('allowlist rejects wildcards, other Google hosts, and other Pages projects', () => {
  const rejected = [
    '*',
    'null',
    '',
    'https://evil.example',
    'https://pv-unrelated-preview.style.dev',
    'http://pv-3ed654dcaea0-f048e0d5-f335-4b5b-82b9-83447e59dfbe.style.dev',
    'http://millironsdetailing.com',
    'https://millironsdetailing.com.evil.com',
    'https://notmillironsdetailing.com',
    'https://evil.pages.dev',
    'https://millirons-detailing.pages.dev.evil.com',
    'https://a.b.millirons-detailing.pages.dev',
    'https://usercontent.goog',
    'https://scf.usercontent.goog',
    'https://evil.usercontent.goog',
    'https://evil.scf.usercontent.goog',
    'https://preview.googleusercontent.com',
    'https://script.googleusercontent.com',
    'https://aistudio.google.com',
    'https://ai.studio',
    'http://1jl1na33u4rjuae5liy703wpawa0n7vbg8kwsoearjbano01hv-h830895770.scf.usercontent.goog',
    'https://millironsdetailing.com:444',
    'https://user:pass@millironsdetailing.com',
    'https://millironsdetailing.com/api',
  ]
  for (const origin of rejected) assert.equal(isAllowedOrigin(origin, call('/api/auth/me')), false, origin)
})

test('localhost may call a local API and may not call production', () => {
  const local = call('/api/auth/login', {method: 'POST', url: 'http://127.0.0.1:8788/api/auth/login'})
  assert.equal(isAllowedOrigin('http://127.0.0.1:8788', local), true)
  assert.equal(isAllowedOrigin('http://localhost:5173', local), true)
  assert.equal(isAllowedOrigin('http://[::1]:8788', call('/api/auth/login', {url: 'http://[::1]:8788/api/auth/login'})), true)
  assert.equal(isAllowedOrigin('http://localhost:5173', call('/api/auth/login', {method: 'POST'})), false)
  assert.equal(isAllowedOrigin('https://evil.example', local), false)
})

test('state-changing methods require an origin, and the Stripe webhook does not', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(requiresOriginCheck(call('/api/auth/login', {method})), true, method)
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(requiresOriginCheck(call('/api/auth/me', {method})), false, method)
  }
  assert.equal(requiresOriginCheck(call('/api/stripe-webhook', {method: 'POST'})), false)
  assert.equal(requiresOriginCheck(call('/api/hire', {method: 'DELETE'})), true)
})

test('https session cookie is cross-site, and plain HTTP stays Lax', () => {
  const secure = sessionCookie('sid.sig', {secure: true, maxAge: 60})
  assert.match(secure, /md_session=sid\.sig/)
  assert.match(secure, /HttpOnly/)
  assert.match(secure, /SameSite=None/)
  assert.match(secure, /Secure/)
  assert.match(secure, /Partitioned/)
  const local = sessionCookie('sid.sig', {secure: false, maxAge: 60})
  assert.match(local, /SameSite=Lax/)
  assert.match(local, /HttpOnly/)
  assert.doesNotMatch(local, /Secure/)
  assert.doesNotMatch(local, /SameSite=None/)
})

test('the exact Freebuff preview origin can submit credentialed login requests', async () => {
  const origin = 'https://pv-3ed654dcaea0-f048e0d5-f335-4b5b-82b9-83447e59dfbe.style.dev'
  const preflight = await onRequest({
    request: call('/api/auth/login', {method: 'OPTIONS', origin}),
    async next() { throw new Error('preflight should not reach the handler') },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true')

  const post = await onRequest({
    request: new Request(PRODUCTION + '/api/auth/login', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: '{}'}),
    async next() { return new Response('{"error":"Invalid email or password."}', {status: 401, headers: {'content-type': 'application/json'}}) },
  })
  assert.equal(post.status, 401)
  assert.equal(post.headers.get('access-control-allow-origin'), origin)
  assert.equal(post.headers.get('access-control-allow-credentials'), 'true')
})

test('preflight from an allowlisted origin reflects that origin and allows credentials', async () => {
  let called = false
  const response = await onRequest({
    request: call('/api/auth/login', {method: 'OPTIONS', origin: PREVIEW}),
    async next() { called = true; return new Response('nope') },
  })
  assert.equal(called, false)
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW)
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.match(response.headers.get('access-control-allow-methods'), /POST/)
  assert.match(response.headers.get('access-control-allow-headers'), /content-type/)
  noStar(response.headers)
  assert.equal(preflightHeaders(PREVIEW).get('access-control-allow-origin'), PREVIEW)
})

test('preflight from a foreign origin is rejected and does not advertise *', async () => {
  let called = false
  const response = await onRequest({
    request: call('/api/auth/login', {method: 'OPTIONS', origin: 'https://evil.example'}),
    async next() { called = true; return new Response(null, {headers: {'access-control-allow-origin': '*'}}) },
  })
  assert.equal(called, false)
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  noStar(response.headers)
})

test('POST without an allowlisted origin never reaches the handler', async () => {
  for (const origin of [undefined, 'https://evil.googleusercontent.com', 'https://not-ours.pages.dev']) {
    let called = false
    const response = await onRequest({
      request: call('/api/auth/login', {method: 'POST', origin}),
      async next() { called = true; return new Response('{}', {status: 200}) },
    })
    assert.equal(called, false, String(origin))
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.match(body.error, /origin/i)
    noStar(response.headers)
  }
})

test('PATCH and DELETE require an allowlisted origin', async () => {
  for (const method of ['PATCH', 'DELETE', 'PUT']) {
    let called = false
    const response = await onRequest({
      request: call('/api/hire', {method}),
      async next() { called = true; return new Response('{}') },
    })
    assert.equal(called, false, method)
    assert.equal(response.status, 403)
  }
  let called = false
  const response = await onRequest({
    request: call('/api/auth/accounts', {method: 'PATCH', origin: 'https://www.millironsdetailing.com'}),
    async next() { called = true; return new Response('{"ok":true}', {headers: {'content-type': 'application/json'}}) },
  })
  assert.equal(called, true)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://www.millironsdetailing.com')
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
})

test('a wildcard from the handler is replaced with the request origin', async () => {
  const response = await onRequest({
    request: call('/api/auth/me', {origin: PREVIEW}),
    async next() {
      return new Response('{"user":null}', {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'set-cookie': 'md_session=abc.def; HttpOnly; Path=/; SameSite=None; Secure',
        },
      })
    },
  })
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW)
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.match(response.headers.get('set-cookie'), /md_session=abc\.def/)
  noStar(response.headers)
  const text = await response.text()
  assert.equal(text, '{"user":null}')
})

test('a foreign GET still runs but its wildcard CORS header is removed', async () => {
  let called = false
  const response = await onRequest({
    request: call('/api/photos?bookingId=__probe', {origin: 'https://evil.example'}),
    async next() {
      called = true
      return new Response('{"ok":true}', {headers: {'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true'}})
    },
  })
  assert.equal(called, true)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
  noStar(response.headers)
})

test('Stripe webhook POST with no Origin reaches the handler and does not gain *', async () => {
  let called = false
  const response = await onRequest({
    request: call('/api/stripe-webhook', {method: 'POST'}),
    async next() {
      called = true
      return new Response('{"received":true}', {headers: {'content-type': 'application/json', 'access-control-allow-origin': '*'}})
    },
  })
  assert.equal(called, true)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  noStar(response.headers)
})

test('applyCors never writes a wildcard, even if asked to reflect one', () => {
  const response = applyCors(new Response('{}', {headers: {'access-control-allow-origin': '*'}}), '*')
  noStar(response.headers)
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
})

test('API base stays relative on first-party hosts and points previews at production', () => {
  assert.equal(resolveApiBase('millironsdetailing.com', ''), '')
  assert.equal(resolveApiBase('www.millironsdetailing.com', ''), '')
  assert.equal(resolveApiBase('millirons-detailing.pages.dev', ''), '')
  assert.equal(resolveApiBase('feat.millirons-detailing.pages.dev', ''), '')
  assert.equal(resolveApiBase('someone-else.pages.dev', ''), '')
  assert.equal(resolveApiBase('localhost', ''), '')
  assert.equal(resolveApiBase('127.0.0.1', ''), '')
  assert.equal(resolveApiBase('::1', ''), '')
  const previewHost = '1jl1na33u4rjuae5liy703wpawa0n7vbg8kwsoearjbano01hv-h830895770.scf.usercontent.goog'
  assert.equal(resolveApiBase(previewHost, ''), PRODUCTION_API)
  assert.equal(resolveApiBase('evil.example', undefined), PRODUCTION_API)
  assert.equal(resolveApiBase('localhost', 'https://millironsdetailing.com/api'), PRODUCTION_API)
  assert.equal(normalizeApiBase('http://127.0.0.1:8788/'), 'http://127.0.0.1:8788')
  assert.equal(resolveApiBase(previewHost, 'http://127.0.0.1:8788'), 'http://127.0.0.1:8788')
  assert.equal(resolveApiBase('evil.example', 'javascript:alert(1)'), PRODUCTION_API)
  assert.equal(resolveApiBase('evil.example', '*'), PRODUCTION_API)
})

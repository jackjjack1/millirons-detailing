import { assessVin } from '../../src/vin.js'

// Server-side accounts for Pages Functions.
// Records live in the existing PHOTOS R2 bucket under the private `_auth/` prefix
// (no public route serves that prefix). Passwords are PBKDF2-SHA-256. Sessions are
// random ids stored in R2 and carried in an HttpOnly cookie signed with SESSION_SECRET.

export const COOKIE = 'md_session'
export const ITERATIONS = 100_000
export const SESSION_MS = 14 * 24 * 60 * 60 * 1000
export const SESSION_SEC = 14 * 24 * 60 * 60
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000
const LOCK_KEY = '_auth/meta/bootstrap.lock'
const enc = new TextEncoder()

export function json(data, status = 200, extra) {
  const headers = new Headers({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return new Response(JSON.stringify(data), {status, headers})
}

export function fail(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

export async function readJson(request, max = 6_000_000) {
  const text = await request.text()
  if (text.length > max) throw fail('Payload is too large.', 413)
  try { return text ? JSON.parse(text) : {} } catch { throw fail('Bad JSON.', 400) }
}

export function secretValue(env, name) {
  const v = env?.[name]
  return typeof v === 'string' ? v.trim() : ''
}

export function assertConfigured(env) {
  if (!env?.PHOTOS) throw fail('PHOTOS binding missing.', 503)
  const secret = secretValue(env, 'SESSION_SECRET')
  if (secret.length < 32) throw fail('SESSION_SECRET must be set to at least 32 characters.', 503)
  return secret
}

export function requestIsSecure(request) {
  const url = new URL(request.url)
  if (url.protocol === 'https:') return true
  const forwarded = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase()
  return forwarded === 'https'
}

export function sessionCookie(token, {secure, maxAge}) {
  // Cross-site preview fetches need SameSite=None; Secure. Browsers drop
  // SameSite=None without Secure, so plain HTTP local dev stays Lax.
  // Partitioned keeps a production login in its own top-level-site jar.
  const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'Path=/', `Max-Age=${maxAge}`]
  if (secure) parts.push('SameSite=None', 'Secure', 'Partitioned')
  else parts.push('SameSite=Lax')
  return parts.join('; ')
}

export function clearCookie(secure) {
  return sessionCookie('', {secure, maxAge: 0})
}

function bytesToB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function b64ToBytes(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64u(bytes) {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function randomId(bytes = 32) {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(bytes)))
}
function randomHex(n = 8) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSign(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)))
}

export function safeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// Compare two strings without leaking the length or a matching prefix.
export async function secretEqual(a, b) {
  const [da, db] = await Promise.all([hmacSign('millirons-auth-cmp', String(a ?? '')), hmacSign('millirons-auth-cmp', String(b ?? ''))])
  return safeEqualBytes(da, db)
}

async function pbkdf2(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, material, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return {algo: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: bytesToB64(salt), hash: bytesToB64(hash)}
}

export async function verifyPassword(password, record) {
  if (!record || record.algo !== 'PBKDF2-SHA-256' || record.iterations !== ITERATIONS) return false
  let salt, expected
  try { salt = b64ToBytes(record.salt); expected = b64ToBytes(record.hash) } catch { return false }
  const got = await pbkdf2(String(password ?? ''), salt, ITERATIONS)
  return safeEqualBytes(got, expected)
}

let dummyHash
async function dummyPasswordRecord() {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password')
  return dummyHash
}

async function r2get(env, key) {
  const obj = await env.PHOTOS.get(key)
  if (!obj) return null
  return JSON.parse(await obj.text())
}
async function r2put(env, key, value) {
  await env.PHOTOS.put(key, JSON.stringify(value), {httpMetadata: {contentType: 'application/json'}})
}
async function listPrefix(env, prefix) {
  const out = []
  let cursor
  do {
    const page = await env.PHOTOS.list({prefix, cursor})
    for (const obj of page.objects || []) {
      try {
        const row = await r2get(env, obj.key)
        if (row) out.push(row)
      } catch {
        // One unreadable object must not hide every other account.
      }
    }
    cursor = page.truncated ? page.cursor : null
  } while (cursor)
  return out
}

export function normEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}
export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120
}
export function digits(phone) {
  return String(phone ?? '').replace(/\D/g, '')
}
function clip(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

export function publicUser(user) {
  if (!user) return null
  const {password: _password, ...rest} = user
  return rest
}

// Picker payload. The full account record includes application photos, which
// can make the admin list fail on a phone. This card is the id, role, and status only.
export function accountSummaryCard(user) {
  if (!user || typeof user.id !== 'string' || !ROLES.includes(user.role)) return null
  return {
    id: user.id,
    name: String(user.name || ''),
    email: normEmail(user.email),
    role: user.role,
    status: String(user.status || ''),
    detailer: typeof user.detailer === 'string' ? user.detailer : '',
    city: typeof user.profile?.city === 'string' ? user.profile.city : '',
    created: Number(user.created) || 0,
  }
}

const ROLES = ['customer', 'employee', 'admin']
const ROLE_INDEX_MARKER = '_auth/meta/role-index-v1'

function userKey(id) { return `_auth/users/${id}` }
// Original index: one pointer per email. Left in place so existing accounts keep resolving.
function emailKey(hash) { return `_auth/email/${hash}` }
// Authoritative index: one account per (email, role), each with its own password hash.
function roleKey(hash, role) { return `_auth/email/${hash}/${role}` }

export async function getUserById(env, id) {
  if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) return null
  return r2get(env, userKey(id))
}

async function userFromPointer(env, pointer, email, role) {
  if (!pointer?.id) return null
  const user = await getUserById(env, pointer.id)
  if (!user || user.role !== role || normEmail(user.email) !== email) return null
  return user
}

// Claim `_auth/email/<hash>/<role>` only when it is empty or already names this account.
// A different account's pointer is left untouched.
async function ensureRolePointer(env, hash, role, id) {
  const key = roleKey(hash, role)
  const existing = await r2get(env, key)
  if (existing?.id) return existing.id === id
  let pointer
  try {
    pointer = await env.PHOTOS.put(key, JSON.stringify({id, role}), {
      httpMetadata: {contentType: 'application/json'},
      onlyIf: {etagDoesNotMatch: '*'},
    })
  } catch (e) {
    if (!(await env.PHOTOS.head(key))) throw e
    pointer = null
  }
  if (pointer) return true
  const won = await r2get(env, key)
  return won?.id === id
}

// Write the original email pointer only when this email has never had one.
// Never overwrite or delete it: it still names the account that was created first.
async function keepLegacyPointer(env, hash, id) {
  const key = emailKey(hash)
  if (await env.PHOTOS.head(key)) return
  try {
    await env.PHOTOS.put(key, JSON.stringify({id}), {
      httpMetadata: {contentType: 'application/json'},
      onlyIf: {etagDoesNotMatch: '*'},
    })
  } catch (e) {
    if (await env.PHOTOS.head(key)) return
    throw e
  }
}

export async function getUserByEmailRole(env, email, role) {
  const normal = normEmail(email)
  if (!normal || !ROLES.includes(role)) return null
  const hash = await sha256hex(normal)
  const direct = await userFromPointer(env, await r2get(env, roleKey(hash, role)), normal, role)
  if (direct) return direct
  const legacy = await userFromPointer(env, await r2get(env, emailKey(hash)), normal, role)
  if (!legacy) return null
  await ensureRolePointer(env, hash, role, legacy.id)
  return legacy
}

// Original email pointer, for callers that still want the first account on this address.
// Role checks must use getUserByEmailRole so a customer cannot resolve to the admin.
export async function getUserByEmail(env, email) {
  const normal = normEmail(email)
  if (!normal) return null
  const hash = await sha256hex(normal)
  const legacy = await r2get(env, emailKey(hash))
  if (!legacy?.id) return null
  const user = await getUserById(env, legacy.id)
  if (!user || normEmail(user.email) !== normal) return null
  if (ROLES.includes(user.role)) await ensureRolePointer(env, hash, user.role, user.id)
  return user
}

export async function listUsers(env) {
  return listPrefix(env, '_auth/users/')
}
export async function putUser(env, user) {
  await r2put(env, userKey(user.id), user)
}

// Copy existing accounts onto (email, role) keys. Adds pointers only.
// Existing user rows and the original email pointers stay where they are.
export async function migrateRoleIndex(env) {
  if (!env?.PHOTOS) return
  if (await env.PHOTOS.head(ROLE_INDEX_MARKER)) return
  const users = await listUsers(env)
  for (const user of users) {
    const email = normEmail(user?.email)
    if (!user?.id || !ROLES.includes(user?.role) || !validEmail(email)) continue
    await ensureRolePointer(env, await sha256hex(email), user.role, user.id)
  }
  try {
    await env.PHOTOS.put(ROLE_INDEX_MARKER, JSON.stringify({at: Date.now(), version: 1}), {
      httpMetadata: {contentType: 'application/json'},
      onlyIf: {etagDoesNotMatch: '*'},
    })
  } catch (e) {
    if (!(await env.PHOTOS.head(ROLE_INDEX_MARKER))) throw e
  }
}

export async function createUser(env, fields, password) {
  await migrateRoleIndex(env)
  const email = normEmail(fields.email)
  const role = fields.role
  if (!ROLES.includes(role)) throw fail('Unknown role.', 400)
  if (!validEmail(email)) throw fail('Enter a valid email.', 400)
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw fail('Password must be at least 8 characters.', 400)
  if (await getUserByEmailRole(env, email, role)) throw fail(duplicateRoleMessage(role), 409)
  const id = `u${randomId(9)}`
  const user = {
    id,
    name: clip(fields.name, 80),
    email,
    role,
    status: fields.status || 'Approved',
    created: Date.now(),
    password: await hashPassword(password),
    detailer: fields.detailer || undefined,
    profile: fields.profile || undefined,
    van: fields.van || undefined,
    history: fields.history || undefined,
    source: fields.source || undefined,
    appId: fields.appId || undefined,
    docsStorage: fields.docsStorage || undefined,
    hireId: fields.hireId || undefined,
    inviteId: fields.inviteId || undefined,
    applicantNote: fields.applicantNote || undefined,
  }
  if (!user.name) throw fail('Enter your name.', 400)
  const hash = await sha256hex(email)
  await r2put(env, userKey(id), user)
  let claimed = false
  try {
    claimed = await ensureRolePointer(env, hash, role, id)
  } catch (e) {
    // Roll back only the row this attempt just inserted. Existing accounts stay.
    await env.PHOTOS.delete(userKey(id))
    throw e
  }
  if (!claimed) {
    await env.PHOTOS.delete(userKey(id))
    throw fail(duplicateRoleMessage(role), 409)
  }
  await keepLegacyPointer(env, hash, id)
  return user
}

export function cleanProfile(p = {}) {
  return {
    phone: clip(p.phone, 30),
    city: clip(p.city, 60),
    years: clip(p.years, 8),
    services: clip(p.services, 200),
    bio: clip(p.bio, 2000),
  }
}

export function cleanVan(v) {
  if (!v || typeof v !== 'object') return undefined
  const assessed = assessVin(v.vin)
  if (!assessed.ok) throw fail(assessed.formatError, 400)
  let budget = 3_000_000
  const files = (arr, limit) => (Array.isArray(arr) ? arr : []).slice(0, limit).map(f => {
    if (!f || typeof f !== 'object') return null
    let data
    if (typeof f.data === 'string' && f.data.startsWith('data:') && f.data.length <= budget) {
      data = f.data
      budget -= f.data.length
    }
    const remoteUrl = typeof f.remoteUrl === 'string' ? f.remoteUrl.slice(0, 300) : undefined
    const remoteKey = typeof f.remoteKey === 'string' ? f.remoteKey.slice(0, 200) : undefined
    if (!data && !remoteUrl) return null
    return {
      name: clip(f.name, 120) || 'file',
      type: clip(f.type, 80),
      data,
      remoteUrl,
      remoteKey,
      added: Number(f.added) || Date.now(),
    }
  }).filter(Boolean)
  return {
    year: clip(v.year, 8),
    make: clip(v.make, 40),
    model: clip(v.model, 40),
    plate: clip(v.plate, 16),
    vin: assessed.vin,
    checklist: (Array.isArray(v.checklist) ? v.checklist : []).slice(0, 30).map(x => clip(x, 80)).filter(Boolean),
    photos: files(v.photos, 8),
    docs: files(v.docs, 8),
  }
}

export function detailerSlug(name) {
  return clip(name, 80).split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'detailer'
}

export async function bootstrapDone(env) {
  if (await env.PHOTOS.head(LOCK_KEY)) return true
  const users = await listUsers(env)
  return users.some(u => u.role === 'admin')
}

async function claimBootstrap(env) {
  if (await env.PHOTOS.head(LOCK_KEY)) return false
  let result
  try {
    result = await env.PHOTOS.put(LOCK_KEY, JSON.stringify({at: Date.now()}), {
      httpMetadata: {contentType: 'application/json'},
      onlyIf: {etagDoesNotMatch: '*'},
    })
  } catch (e) {
    if (await env.PHOTOS.head(LOCK_KEY)) return false
    throw e
  }
  return !!result
}

async function releaseBootstrap(env) {
  await env.PHOTOS.delete(LOCK_KEY)
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

export async function readSession(request, env) {
  const secret = secretValue(env, 'SESSION_SECRET')
  if (!env?.PHOTOS || secret.length < 32) return null
  const token = readCookie(request, COOKIE)
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const sid = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(sid) || !sig) return null
  const expected = bytesToB64u(await hmacSign(secret, sid))
  if (!(await secretEqual(sig, expected))) return null
  const session = await r2get(env, `_auth/sessions/${sid}`)
  if (!session?.userId || !session.exp) return null
  if (Date.now() > session.exp) {
    await env.PHOTOS.delete(`_auth/sessions/${sid}`)
    return null
  }
  const user = await getUserById(env, session.userId)
  if (!user) return null
  // A session is bound to one account. A mismatched role cannot be used to reach a different one.
  if (session.role && session.role !== user.role) return null
  if (!session.role && ROLES.includes(user.role)) {
    const next = {...session, role: user.role}
    delete next.password
    await r2put(env, `_auth/sessions/${sid}`, next)
    session.role = user.role
  }
  return {sid, session, user}
}

export async function currentUser(request, env) {
  const loaded = await readSession(request, env)
  return loaded?.user || null
}

// View as is stored only on the admin's session. It never changes the account,
// the password, or the cookie. A non-admin session cannot opt into it.
export function activePreview(user, session) {
  if (!user || user.role !== 'admin') return null
  return session?.viewAs === 'customer' || session?.viewAs === 'employee' ? session.viewAs : null
}

export function presentedUser(user, session) {
  const pub = publicUser(user)
  if (!pub) return null
  const view = activePreview(user, session)
  if (!view) return pub
  const next = {...pub, role: view, viewAs: view, actorRole: 'admin', preview: true, status: 'Approved'}
  delete next.van
  delete next.profile
  delete next.history
  delete next.appId
  delete next.docsStorage
  delete next.hireId
  delete next.inviteId
  delete next.applicantNote
  delete next.source
  if (view === 'customer') delete next.detailer
  else next.detailer = detailerSlug(pub.name)
  return next
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PREVIEW_OPEN = new Set(['/api/auth/view-as', '/api/auth/logout', '/api/stripe-webhook'])
// These two routes enforce their own rule: a preview write can touch only the
// admin's own customer account. Every other preview write stays refused.
const PREVIEW_OWN_CUSTOMER = new Set(['/api/garage', '/api/preview-booking'])

// While an admin is previewing another role, refuse writes. Reads still use the
// real admin account. Logout and switching the view stay available.
export async function previewMutationBlock(request, env) {
  if (!request || !MUTATING.has(request.method)) return null
  let path = ''
  try { path = new URL(request.url).pathname } catch { return null }
  if (PREVIEW_OPEN.has(path) || PREVIEW_OWN_CUSTOMER.has(path)) return null
  const loaded = await readSession(request, env)
  if (!activePreview(loaded?.user, loaded?.session)) return null
  return json({error: 'Preview only. Switch back to Admin before changing anything.'}, 403)
}

export async function ownCustomerAccount(env, user) {
  if (!user?.email) return null
  const customer = await getUserByEmailRole(env, user.email, 'customer')
  if (!customer || customer.role !== 'customer') return null
  if (normEmail(customer.email) !== normEmail(user.email)) return null
  return customer
}

export async function ownEmployeeAccount(env, user) {
  if (!user?.email) return null
  const employee = await getUserByEmailRole(env, user.email, 'employee')
  if (!employee || employee.role !== 'employee') return null
  if (normEmail(employee.email) !== normEmail(user.email)) return null
  return employee
}

function employeeDetailerId(employee) {
  const existing = String(employee?.detailer || '').trim().toLowerCase()
  if (/^[a-z0-9]{1,40}$/.test(existing)) return existing
  return detailerSlug(employee?.name)
}

// View as stays on the admin account. Job and garage checks use the same-email
// customer or employee row, and never a synthetic detailer slug.
export async function withPreviewAccounts(env, user, session) {
  const pub = presentedUser(user, session)
  if (!pub?.preview) return pub
  if (pub.role === 'customer') {
    const customer = await ownCustomerAccount(env, user)
    if (customer) pub.customerId = customer.id
    else pub.customerMissing = true
  }
  if (pub.role === 'employee') {
    const employee = await ownEmployeeAccount(env, user)
    if (employee) {
      pub.employeeId = employee.id
      pub.detailer = employeeDetailerId(employee)
      pub.employeeStatus = employee.status || ''
    } else {
      delete pub.detailer
      pub.employeeMissing = true
    }
  }
  return pub
}

export async function startSession(env, request, user) {
  const secret = assertConfigured(env)
  const sid = randomId(32)
  // The session names this account and its role. View-as, when set later, does not replace either.
  await r2put(env, `_auth/sessions/${sid}`, {userId: user.id, role: user.role, created: Date.now(), exp: Date.now() + SESSION_MS})
  const sig = bytesToB64u(await hmacSign(secret, sid))
  return sessionCookie(`${sid}.${sig}`, {secure: requestIsSecure(request), maxAge: SESSION_SEC})
}

export async function destroySession(request, env) {
  const secret = secretValue(env, 'SESSION_SECRET')
  const token = readCookie(request, COOKIE)
  const dot = token.indexOf('.')
  if (dot > 0 && env?.PHOTOS && secret.length >= 32) {
    const sid = token.slice(0, dot)
    if (/^[A-Za-z0-9_-]{20,128}$/.test(sid)) {
      const expected = bytesToB64u(await hmacSign(secret, sid))
      if (await secretEqual(token.slice(dot + 1), expected)) await env.PHOTOS.delete(`_auth/sessions/${sid}`)
    }
  }
  return clearCookie(requestIsSecure(request))
}

export async function requireUser(request, env) {
  try { assertConfigured(env) } catch (e) { return {user: null, error: json({error: e.message}, e.status || 503)} }
  const user = await currentUser(request, env)
  if (!user) return {user: null, error: json({error: 'Sign in required.'}, 401)}
  return {user, error: null}
}
export async function requireAdmin(request, env) {
  const gate = await requireUser(request, env)
  if (gate.error) return gate
  if (gate.user.role !== 'admin') return {user: gate.user, error: json({error: 'Admin only.'}, 403)}
  return gate
}

function sessionResponse(data, status, setCookie) {
  return json(data, status, {'set-cookie': setCookie})
}

async function checkPassword(password, user) {
  const record = user?.password || await dummyPasswordRecord()
  const match = await verifyPassword(password, record)
  return !!(user && match)
}

export async function setupGet({env}) {
  if (!env?.PHOTOS) return json({error: 'PHOTOS binding missing.'}, 503)
  const done = await bootstrapDone(env)
  const code = secretValue(env, 'ADMIN_SETUP_CODE')
  return json({adminExists: done, setupEnabled: !done && code.length >= 8})
}

export async function setupPost({request, env}) {
  assertConfigured(env)
  const code = secretValue(env, 'ADMIN_SETUP_CODE')
  if (code.length < 8) throw fail('Admin setup is not configured. Set ADMIN_SETUP_CODE (at least 8 characters) on the Pages project.', 503)
  const body = await readJson(request)
  const name = clip(body.name, 80)
  const email = normEmail(body.email)
  const password = body.password
  if (!name) throw fail('Please enter your name to initialize the admin account.', 400)
  if (!validEmail(email)) throw fail('Enter a valid email.', 400)
  if (typeof password !== 'string' || password.length < 8) throw fail('Password must be at least 8 characters.', 400)
  if (!(await secretEqual(String(body.code ?? ''), code))) throw fail('That setup code is not valid.', 401)
  if (await bootstrapDone(env)) throw fail('An admin account already exists. Sign in instead.', 403)
  if (!(await claimBootstrap(env))) throw fail('An admin account already exists. Sign in instead.', 403)
  try {
    const user = await createUser(env, {name, email, role: 'admin', status: 'Approved'}, password)
    const setCookie = await startSession(env, request, user)
    return sessionResponse({user: publicUser(user)}, 201, setCookie)
  } catch (e) {
    await releaseBootstrap(env)
    throw e
  }
}

export async function loginPost({request, env}) {
  assertConfigured(env)
  await migrateRoleIndex(env)
  const body = await readJson(request)
  const email = normEmail(body.email)
  const requested = typeof body.role === 'string' ? body.role : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || password.length > 200) throw fail('Incorrect email or password for this role.', 401)
  if (requested && !ROLES.includes(requested)) throw fail('Incorrect email or password for this role.', 401)
  const emailOk = validEmail(email)
  // A chosen role is checked against that account only. Customer or employee
  // never falls through to the admin who happens to use the same email.
  if (requested) {
    const user = emailOk ? await getUserByEmailRole(env, email, requested) : null
    const match = await checkPassword(password, user && user.role === requested ? user : null)
    if (!match || !user || user.role !== requested) throw fail('Incorrect email or password for this role.', 401)
    const setCookie = await startSession(env, request, user)
    return sessionResponse({user: publicUser(user)}, 200, setCookie)
  }
  const matches = []
  for (const role of ROLES) {
    const user = emailOk ? await getUserByEmailRole(env, email, role) : null
    const match = await checkPassword(password, user && user.role === role ? user : null)
    if (match && user && user.role === role) matches.push(user)
  }
  if (matches.length === 1) {
    const setCookie = await startSession(env, request, matches[0])
    return sessionResponse({user: publicUser(matches[0])}, 200, setCookie)
  }
  if (matches.length > 1) {
    return json({
      chooseRole: true,
      roles: matches.map(user => user.role),
      error: 'That password matches more than one account. Choose which one to use.',
    }, 409)
  }
  throw fail('Incorrect email or password for this role.', 401)
}

export async function logoutPost({request, env}) {
  const setCookie = await destroySession(request, env)
  return json({ok: true}, 200, {'set-cookie': setCookie})
}

export async function meGet({request, env}) {
  assertConfigured(env)
  const loaded = await readSession(request, env)
  if (!loaded) return json({user: null}, 401)
  return json({user: await withPreviewAccounts(env, loaded.user, loaded.session)})
}

export async function viewAsPost({request, env}) {
  const {user, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const role = body.role
  if (!['admin', 'customer', 'employee'].includes(role)) throw fail('Choose Admin, Customer, or Employee.', 400)
  const loaded = await readSession(request, env)
  if (!loaded || loaded.user.id !== user.id || loaded.user.role !== 'admin') throw fail('Sign in required.', 401)
  const session = {...loaded.session}
  if (role === 'admin') delete session.viewAs
  else session.viewAs = role
  delete session.password
  await r2put(env, `_auth/sessions/${loaded.sid}`, session)
  return json({user: await withPreviewAccounts(env, loaded.user, session)})
}

export async function mePatch({request, env}) {
  const {user, error} = await requireUser(request, env)
  if (error) return error
  if (user.role !== 'employee') throw fail('Forbidden.', 403)
  const body = await readJson(request)
  if (body.van) user.van = cleanVan(body.van)
  if (typeof body.applicantNote === 'string') user.applicantNote = clip(body.applicantNote, 2000)
  if (body.docsStorage === 'r2' || body.docsStorage === 'local') user.docsStorage = body.docsStorage
  if (body.status === 'Pending review' && (user.status === 'More info needed' || user.status === 'Pending review')) {
    user.status = 'Pending review'
    const note = clip(body.note || body.applicantNote || 'Resubmitted with more info', 500)
    user.history = [...(user.history || []), {status: 'Pending review', by: user.name, ts: Date.now(), note}]
  }
  await putUser(env, user)
  return json({user: publicUser(user)})
}

export async function registerPost({request, env}) {
  assertConfigured(env)
  const body = await readJson(request)
  const name = clip(body.name, 80)
  if (!name) throw fail('Please enter your full name.', 400)
  // Role is forced. A client cannot create an admin or employee here.
  const user = await createUser(env, {name, email: body.email, role: 'customer', status: 'Approved'}, body.password)
  const setCookie = await startSession(env, request, user)
  return sessionResponse({user: publicUser(user)}, 201, setCookie)
}

function duplicateRoleMessage(role) {
  const label = role === 'customer' ? 'customer' : role === 'employee' ? 'employee' : 'admin'
  const article = label === 'customer' ? 'A' : 'An'
  return `${article} ${label} account with this email already exists. Please sign in.`
}

export async function emailPost({request, env}) {
  assertConfigured(env)
  await migrateRoleIndex(env)
  const body = await readJson(request)
  const email = normEmail(body.email)
  if (!validEmail(email)) throw fail('Enter a valid email.', 400)
  // Customer and employee checks stay on that role. An omitted role is the
  // detailer application (older clients posted {email} only). A customer or
  // admin on the same address is not an employee account. Admin existence
  // stays off this public check.
  const role = body.role === 'customer' || body.role === 'employee' ? body.role : ''
  if (body.role && !role) throw fail('Enter a valid email.', 400)
  const check = role || 'employee'
  return json({exists: !!(await getUserByEmailRole(env, email, check))})
}

export async function applyPost({request, env}) {
  assertConfigured(env)
  const body = await readJson(request)
  const name = clip(body.name, 80)
  const profile = cleanProfile({phone: body.phone, city: body.city, years: body.years, services: body.services, bio: body.bio})
  if (!name || !profile.phone || !profile.city) throw fail('Fill in name, a valid email, phone and city.', 400)
  const hireId = typeof body.hireId === 'string' && /^HIRE-[A-Za-z0-9_-]{4,40}$/.test(body.hireId) ? body.hireId : ''
  const hire = hireId ? await getHire(env, hireId) : null
  const appId = `APP-${Date.now().toString(36).toUpperCase()}`
  const van = cleanVan(body.van)
  const user = await createUser(env, {
    name,
    email: body.email,
    role: 'employee',
    status: 'Pending review',
    source: hire ? 'Employee invite' : (hireId ? 'Employee invite' : 'Self-applied'),
    detailer: detailerSlug(name),
    profile,
    van,
    appId,
    docsStorage: body.docsStorage === 'r2' ? 'r2' : 'local',
    hireId: hireId || undefined,
    history: [{status: 'Pending review', by: name, ts: Date.now()}],
  }, body.password)
  if (hire || profile.phone) await markHiresJoined(env, {id: hireId, email: user.email, phone: profile.phone})
  const setCookie = await startSession(env, request, user)
  return sessionResponse({user: publicUser(user)}, 201, setCookie)
}

async function accountSummary(env, {summary = false} = {}) {
  const users = await listUsers(env)
  const accounts = (summary ? users.map(accountSummaryCard).filter(Boolean) : users.map(publicUser))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
  const pending = accounts.filter(a => a.role === 'employee' && a.status === 'Pending review').length
  return {accounts, pending}
}

export async function accountsGet({request, env}) {
  const {error} = await requireAdmin(request, env)
  if (error) return error
  let summary = false
  try { summary = new URL(request.url).searchParams.get('summary') === '1' } catch { summary = false }
  return json(await accountSummary(env, {summary}))
}

export async function accountsPatch({request, env}) {
  const {user: admin, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const status = body.status
  const reason = clip(body.reason, 500)
  if (!['Approved', 'Rejected', 'More info needed', 'Pending review'].includes(status)) throw fail('Unknown status.', 400)
  if (status !== 'Approved' && !reason) throw fail('Add a reason first.', 400)
  const target = await getUserByEmailRole(env, body.email, 'employee')
  if (!target || target.role !== 'employee') throw fail('Applicant not found.', 404)
  target.status = status
  target.history = [...(target.history || []), {status, by: admin.name, ts: Date.now(), reason: reason || undefined}]
  await putUser(env, target)
  const summary = await accountSummary(env)
  return json({user: publicUser(target), ...summary})
}

function inviteKey(id) { return `_auth/invites/${id}` }
async function tokenKey(token) { return `_auth/invite-token/${await sha256hex(token)}` }

async function saveInvite(env, inv) {
  await r2put(env, inviteKey(inv.id), inv)
  await r2put(env, await tokenKey(inv.token), {id: inv.id})
}
async function deleteToken(env, token) {
  if (token) await env.PHOTOS.delete(await tokenKey(token))
}
export async function listInvites(env) {
  return (await listPrefix(env, '_auth/invites/')).sort((a, b) => (b.iat || 0) - (a.iat || 0))
}
export async function getInviteByToken(env, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null
  const pointer = await r2get(env, await tokenKey(token))
  if (!pointer?.id || !/^[A-Za-z0-9_-]{4,40}$/.test(pointer.id)) return null
  const inv = await r2get(env, inviteKey(pointer.id))
  if (!inv || !(await secretEqual(inv.token || '', token))) return null
  return inv
}
export async function describeInvite(env, inv) {
  if (!inv?.id || !inv.email || !inv.role || !inv.exp) return 'invalid'
  if (inv.status === 'Revoked') return 'revoked'
  if (inv.status === 'Accepted') return 'used'
  if (Date.now() > inv.exp) return 'expired'
  if (await getUserByEmailRole(env, inv.email, inv.role)) return 'used'
  return 'ok'
}
function publicInvite(inv) {
  if (!inv) return null
  return {id: inv.id, name: inv.name, email: inv.email, role: inv.role, invitedBy: inv.invitedBy, iat: inv.iat, exp: inv.exp, status: inv.status}
}

export async function invitesGet({request, env}) {
  const {error} = await requireAdmin(request, env)
  if (error) return error
  return json({invites: await listInvites(env)})
}

export async function invitesPost({request, env}) {
  const {user, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const action = body.action || 'create'
  if (action === 'revoke' || action === 'resend') {
    const id = clip(body.id, 40)
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) throw fail('Unknown invite.', 404)
    const inv = await r2get(env, inviteKey(id))
    if (!inv) throw fail('Unknown invite.', 404)
    if (action === 'revoke') {
      await deleteToken(env, inv.token)
      inv.status = 'Revoked'
      inv.token = ''
      await r2put(env, inviteKey(inv.id), inv)
    } else {
      await deleteToken(env, inv.token)
      inv.token = randomId(32)
      inv.iat = Date.now()
      inv.exp = Date.now() + INVITE_MS
      inv.status = 'Pending'
      await saveInvite(env, inv)
    }
    return json({invite: inv, invites: await listInvites(env)})
  }
  const name = clip(body.name, 80)
  const email = normEmail(body.email)
  const role = body.role === 'admin' ? 'admin' : 'employee'
  if (!name) throw fail('Enter a name.', 400)
  if (!validEmail(email)) throw fail('Enter a valid email.', 400)
  if (await getUserByEmailRole(env, email, role)) throw fail(duplicateRoleMessage(role), 409)
  const pending = await listInvites(env)
  if (pending.some(i => i.email === email && i.role === role && i.status === 'Pending' && Date.now() <= i.exp)) throw fail('There is already a pending invite for that email.', 409)
  const inv = {
    id: `INV-${randomHex(4).toUpperCase()}`,
    name,
    email,
    role,
    invitedBy: user.name,
    iat: Date.now(),
    exp: Date.now() + INVITE_MS,
    status: 'Pending',
    token: randomId(32),
  }
  await saveInvite(env, inv)
  return json({invite: inv}, 201)
}

export async function invitePreviewGet({request, env}) {
  assertConfigured(env)
  const token = new URL(request.url).searchParams.get('token') || ''
  const inv = await getInviteByToken(env, token)
  const state = await describeInvite(env, inv)
  return json({state, invite: state === 'invalid' ? null : publicInvite(inv)})
}

export async function inviteAcceptPost({request, env}) {
  assertConfigured(env)
  const body = await readJson(request)
  const inv = await getInviteByToken(env, body.token)
  const state = await describeInvite(env, inv)
  const MSG = {
    invalid: 'This invite link is invalid.',
    expired: 'This invite has expired. Ask your admin to resend it.',
    revoked: 'This invite was revoked.',
    used: 'This invite has already been used. Sign in instead.',
  }
  if (state !== 'ok') throw fail(MSG[state] || MSG.invalid, 400)
  if (normEmail(body.confirm) !== inv.email) throw fail('That email doesn’t match the invite.', 400)
  const name = clip(body.name, 80)
  if (!name) throw fail('Enter your name.', 400)
  const employee = inv.role === 'employee'
  const van = employee ? cleanVan(body.van) : undefined
  if (employee && (!van?.year || !van.make || !van.model || !van.plate)) throw fail('Add the year, make, model and plate.', 400)
  const appId = employee ? inv.id : undefined
  const user = await createUser(env, {
    name,
    email: inv.email,
    role: employee ? 'employee' : 'admin',
    status: employee ? 'Pending review' : 'Approved',
    source: `Invited by ${inv.invitedBy}`,
    detailer: employee ? detailerSlug(name) : undefined,
    van,
    appId,
    inviteId: inv.id,
    docsStorage: employee ? 'local' : undefined,
    history: employee ? [{status: 'Pending review', by: name, ts: Date.now()}] : undefined,
  }, body.password)
  inv.status = 'Accepted'
  await r2put(env, inviteKey(inv.id), inv)
  await markHiresJoined(env, {email: user.email})
  const setCookie = await startSession(env, request, user)
  return sessionResponse({user: publicUser(user)}, 201, setCookie)
}

function hireKey(id) { return `_auth/hire/${id}` }
export async function getHire(env, id) {
  if (!/^HIRE-[A-Za-z0-9_-]{4,40}$/.test(id || '')) return null
  return r2get(env, hireKey(id))
}
export async function listHires(env) {
  return (await listPrefix(env, '_auth/hire/')).sort((a, b) => (b.created || 0) - (a.created || 0))
}
function phonesMatch(a, b) {
  const da = digits(a), db = digits(b)
  return da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10)
}
export async function markHiresJoined(env, {id = '', email = '', phone = ''} = {}) {
  const em = normEmail(email)
  const list = await listHires(env)
  for (const inv of list) {
    if (inv.status === 'Joined') continue
    const hit = (id && inv.id === id) || (em && inv.email === em) || phonesMatch(inv.phone, phone)
    if (!hit) continue
    inv.status = 'Joined'
    await r2put(env, hireKey(inv.id), inv)
  }
}

export async function hireGet({request, env}) {
  const {error} = await requireAdmin(request, env)
  if (error) return error
  const users = await listUsers(env)
  const invites = await listHires(env)
  for (const inv of invites) {
    if (inv.status === 'Joined') continue
    const joined = users.some(a => a.role === 'employee' && ((inv.id && a.hireId === inv.id) || (inv.email && a.email === inv.email) || phonesMatch(a.profile?.phone, inv.phone)))
    if (!joined) continue
    inv.status = 'Joined'
    await r2put(env, hireKey(inv.id), inv)
  }
  return json({invites})
}
export async function hirePost({request, env}) {
  const {user, error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const name = clip(body.name, 80)
  const email = normEmail(body.email)
  const phone = clip(body.phone, 30)
  if (!name) throw fail('Enter their name.', 400)
  if (!email && !phone) throw fail('Add an email, a phone number, or both.', 400)
  if (email && !validEmail(email)) throw fail('Enter a valid email, or leave it blank.', 400)
  if (phone && digits(phone).length < 10) throw fail('Enter a phone number with an area code, or leave it blank.', 400)
  const cur = await listHires(env)
  const users = await listUsers(env)
  const stillOpen = inv => inv.status !== 'Joined' && !users.some(a => a.role === 'employee' && (a.hireId === inv.id || (email && a.email === inv.email) || phonesMatch(a.profile?.phone, inv.phone)))
  if (email && cur.some(i => i.email === email && stillOpen(i))) throw fail('There is already a pending invite for that email.', 409)
  if (phone && cur.some(i => phonesMatch(i.phone, phone) && stillOpen(i))) throw fail('There is already a pending invite for that phone number.', 409)
  const inv = {id: `HIRE-${randomHex(4).toUpperCase()}`, name, email, phone, created: Date.now(), methods: [], status: 'Pending', invitedBy: user.name}
  await r2put(env, hireKey(inv.id), inv)
  return json({invite: inv}, 201)
}
export async function hirePatch({request, env}) {
  const {error} = await requireAdmin(request, env)
  if (error) return error
  const body = await readJson(request)
  const inv = await getHire(env, body.id)
  if (!inv) throw fail('Unknown invite.', 404)
  const method = clip(body.method, 20)
  if (method && ['Email', 'Text', 'Copied'].includes(method)) inv.methods = [...new Set([...(inv.methods || []), method])]
  await r2put(env, hireKey(inv.id), inv)
  return json({invite: inv, invites: await listHires(env)})
}
export async function hireDelete({request, env}) {
  const {error} = await requireAdmin(request, env)
  if (error) return error
  const id = new URL(request.url).searchParams.get('id') || ''
  const inv = await getHire(env, id)
  if (!inv) throw fail('Unknown invite.', 404)
  await env.PHOTOS.delete(hireKey(inv.id))
  return json({ok: true, invites: await listHires(env)})
}

export function guard(handler) {
  return async ctx => {
    try {
      const blocked = await previewMutationBlock(ctx?.request, ctx?.env)
      if (blocked) return blocked
      return await handler(ctx)
    }
    catch (e) {
      if (e?.status) return json({error: e.message}, e.status)
      console.error(e)
      return json({error: 'Something went wrong.'}, 500)
    }
  }
}

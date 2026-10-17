import assert from 'node:assert/strict'
import test from 'node:test'
import {onRequestPost as login} from '../functions/api/auth/login.js'
import {onRequestPost as logout} from '../functions/api/auth/logout.js'
import {onRequestGet as meGet, onRequestPatch as mePatch} from '../functions/api/auth/me.js'
import {onRequestGet as setupGet, onRequestPost as setupPost} from '../functions/api/auth/setup.js'
import {onRequestPost as register} from '../functions/api/auth/register.js'
import {onRequestPost as apply} from '../functions/api/auth/apply.js'
import {onRequestGet as accountsGet, onRequestPatch as accountsPatch} from '../functions/api/auth/accounts.js'
import {onRequestPost as invitesPost} from '../functions/api/auth/invites.js'
import {onRequestGet as invitePreview} from '../functions/api/auth/invites/preview.js'
import {onRequestPost as inviteAccept} from '../functions/api/auth/invites/accept.js'
import {onRequestPost as hirePost, onRequestGet as hireGet} from '../functions/api/hire.js'
import {onRequestGet as photosGet, onRequestPost as photosPost} from '../functions/api/photos.js'
import {onRequestGet as photoFileGet, onRequestDelete as photoDelete} from '../functions/api/photos/[[path]].js'
import {onRequestGet as docsGet, onRequestPost as docsPost} from '../functions/api/documents.js'
import {onRequestGet as docFileGet} from '../functions/api/documents/[[path]].js'
import {onRequestPost as viewAs} from '../functions/api/auth/view-as.js'
import {onRequestPost as emailCheck} from '../functions/api/auth/email.js'
import {onRequestPost as checkout} from '../functions/api/checkout.js'
import {onRequestPost as opsPost} from '../functions/api/ops.js'
import {onRequest as middleware} from '../functions/api/_middleware.js'

const SECRET = 'test-session-secret-must-be-32-characters'
const CODE = 'test-setup-code'

class MemoryR2 {
  constructor() { this.store = new Map() }
  async get(key) {
    const row = this.store.get(key)
    if (!row) return null
    return {
      key,
      size: row.bytes.byteLength,
      customMetadata: row.customMetadata || {},
      httpMetadata: row.httpMetadata || {},
      httpEtag: row.etag,
      body: new Blob([row.bytes]).stream(),
      text: async () => new TextDecoder().decode(row.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(row.bytes)),
    }
  }
  async put(key, value, opts = {}) {
    // Reserve the key before the first await so onlyIf: etagDoesNotMatch '*'
    // behaves like R2 across interleaved requests.
    if (opts.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) return null
    if (opts.onlyIf?.etagDoesNotMatch === '*') this.store.set(key, {bytes: new Uint8Array(), customMetadata: {}, httpMetadata: {}, etag: '"pending"'})
    const bytes = await toBytes(value)
    const row = {bytes, customMetadata: opts.customMetadata || {}, httpMetadata: opts.httpMetadata || {}, etag: '"' + Math.random().toString(16).slice(2) + '"'}
    this.store.set(key, row)
    return {key, etag: row.etag}
  }
  async head(key) {
    const row = this.store.get(key)
    return row ? {key, size: row.bytes.byteLength, customMetadata: row.customMetadata, httpEtag: row.etag} : null
  }
  async delete(key) { this.store.delete(key) }
  async list({prefix = '', cursor} = {}) {
    const keys = [...this.store.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = cursor ? Math.max(0, keys.indexOf(cursor) + 1) : 0
    const slice = keys.slice(start)
    return {
      objects: slice.map(k => ({key: k, size: this.store.get(k).bytes.byteLength, customMetadata: this.store.get(k).customMetadata, httpMetadata: this.store.get(k).httpMetadata})),
      truncated: false,
      cursor: null,
    }
  }
}

async function toBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  if (value && typeof value.arrayBuffer === 'function' && typeof value.getReader !== 'function') return new Uint8Array(await value.arrayBuffer())
  if (value && typeof value.getReader === 'function') {
    const chunks = []
    const reader = value.getReader()
    while (true) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
    }
    const len = chunks.reduce((n, c) => n + c.byteLength, 0)
    const out = new Uint8Array(len)
    let offset = 0
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
    return out
  }
  throw new Error('bad r2 body')
}

function envOf(r2 = new MemoryR2(), extra = {}) {
  return {PHOTOS: r2, SESSION_SECRET: SECRET, ADMIN_SETUP_CODE: CODE, ...extra}
}
function req(path, {method = 'GET', body, cookie, https = false, origin} = {}) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
  if (origin) headers.set('origin', origin)
  return new Request((https ? 'https://millironsdetailing.com' : 'http://127.0.0.1:8788') + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function data(response) {
  const text = await response.text()
  return {status: response.status, json: text ? JSON.parse(text) : {}, cookie: response.headers.get('set-cookie') || '', text}
}
function jar(cookieHeader) {
  const match = cookieHeader.match(/md_session=([^;]*)/)
  return match && match[1] ? `md_session=${match[1]}` : ''
}

test('setup code is required and a second admin cannot be created', async () => {
  const env = envOf()
  const open = await data(await setupGet({request: req('/api/auth/setup'), env}))
  assert.equal(open.json.adminExists, false)
  assert.equal(open.json.setupEnabled, true)
  assert.equal(JSON.stringify(open.json).includes(CODE), false)

  const missing = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'A', email: 'a@ex.test', password: 'password1'}}), env}))
  assert.equal(missing.status, 401)
  const wrong = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'A', email: 'a@ex.test', password: 'password1', code: 'nope'}}), env}))
  assert.equal(wrong.status, 401)

  const created = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', https: true, body: {name: 'Jordan Millirons', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  assert.equal(created.status, 201)
  assert.equal(created.json.user.role, 'admin')
  assert.equal(created.json.user.password, undefined)
  assert.match(created.cookie, /HttpOnly/)
  assert.match(created.cookie, /SameSite=None/)
  assert.match(created.cookie, /Secure/)
  assert.match(created.cookie, /Partitioned/)
  assert.equal(created.cookie.includes('password1'), false)

  const again = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Other', email: 'other@millirons.test', password: 'password1', code: CODE}}), env}))
  assert.equal(again.status, 403)
  const closed = await data(await setupGet({request: req('/api/auth/setup'), env}))
  assert.equal(closed.json.adminExists, true)
  assert.equal(closed.json.setupEnabled, false)

  const stored = [...env.PHOTOS.store.values()].map(row => new TextDecoder().decode(row.bytes)).join('\n')
  assert.equal(stored.includes('password1'), false)
  assert.match(stored, /PBKDF2-SHA-256/)
})

test('the same admin can sign in from two sessions, and logout only ends one', async () => {
  const env = envOf()
  await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env})
  const a = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'admin@millirons.test', password: 'password1', role: 'admin'}}), env}))
  const b = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'Admin@Millirons.test', password: 'password1', role: 'admin'}}), env}))
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.notEqual(jar(a.cookie), jar(b.cookie))
  const meA = await data(await meGet({request: req('/api/auth/me', {cookie: jar(a.cookie)}), env}))
  const meB = await data(await meGet({request: req('/api/auth/me', {cookie: jar(b.cookie)}), env}))
  assert.equal(meA.json.user.email, 'admin@millirons.test')
  assert.equal(meB.json.user.email, 'admin@millirons.test')
  await logout({request: req('/api/auth/logout', {method: 'POST', cookie: jar(a.cookie)}), env})
  const dead = await data(await meGet({request: req('/api/auth/me', {cookie: jar(a.cookie)}), env}))
  const live = await data(await meGet({request: req('/api/auth/me', {cookie: jar(b.cookie)}), env}))
  assert.equal(dead.status, 401)
  assert.equal(live.json.user.role, 'admin')
})

test('register cannot create an admin, and a bad cookie is ignored', async () => {
  const env = envOf()
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email: 'pat@ex.test', password: 'password1', role: 'admin'}}), env}))
  assert.equal(customer.status, 201)
  assert.equal(customer.json.user.role, 'customer')
  assert.match(customer.cookie, /HttpOnly/)
  assert.match(customer.cookie, /SameSite=Lax/)
  assert.doesNotMatch(customer.cookie, /Secure/)
  assert.doesNotMatch(customer.cookie, /Partitioned/)
  const forged = await data(await meGet({request: req('/api/auth/me', {cookie: 'md_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}), env}))
  assert.equal(forged.status, 401)
  const accounts = await data(await accountsGet({request: req('/api/auth/accounts', {cookie: jar(customer.cookie)}), env}))
  assert.equal(accounts.status, 403)
  const wrongRole = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'pat@ex.test', password: 'password1', role: 'admin'}}), env}))
  assert.equal(wrongRole.status, 401)
})

test('employee invite link creates a server account and marks the invite joined', async () => {
  const env = envOf()
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  const cookie = jar(admin.cookie)
  const hire = await data(await hirePost({request: req('/api/hire', {method: 'POST', cookie, body: {name: 'Chris Lane', email: 'chris@millirons.test', phone: '4045550123'}}), env}))
  assert.equal(hire.status, 201)
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {
    name: 'Chris Lane', email: 'chris@millirons.test', password: 'password1', phone: '4045550123', city: 'Decatur', hireId: hire.json.invite.id,
    van: {year: '2021', make: 'Ford', model: 'Transit', plate: 'GA123', photos: [{name: 'van.png', type: 'image/png', data: tiny}], docs: [], checklist: []},
  }}), env}))
  assert.equal(employee.status, 201)
  assert.equal(employee.json.user.role, 'employee')
  assert.equal(employee.json.user.status, 'Pending review')
  assert.equal(employee.json.user.password, undefined)
  const list = await data(await hireGet({request: req('/api/hire', {cookie}), env}))
  assert.equal(list.json.invites[0].status, 'Joined')
  const signedIn = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'chris@millirons.test', password: 'password1', role: 'employee'}}), env}))
  assert.equal(signedIn.status, 200)
  const doc = await docsPost({request: form('/api/documents', {cookie: jar(employee.cookie), fields: {applicationId: employee.json.user.appId, type: 'vehicle'}, fileName: 'van.png'}), env})
  assert.equal(doc.status, 201)
  const other = await docsPost({request: form('/api/documents', {cookie: jar(employee.cookie), fields: {applicationId: 'APP-OTHER', type: 'vehicle'}, fileName: 'van.png'}), env})
  assert.equal(other.status, 403)
  const hidden = await data(await docsGet({request: req('/api/documents?applicationId=' + employee.json.user.appId), env}))
  assert.equal(hidden.status, 401)
  const adminList = await data(await docsGet({request: req('/api/documents?applicationId=' + employee.json.user.appId, {cookie}), env}))
  assert.equal(adminList.status, 200)
  const key = (await doc.json()).key
  const fileDenied = await docFileGet({request: req('/api/documents/' + key, {cookie: jar(employee.cookie)}), env, params: {path: key.split('/')}})
  assert.equal(fileDenied.status, 403)
  const fileOk = await docFileGet({request: req('/api/documents/' + key, {cookie}), env, params: {path: key.split('/')}})
  assert.equal(fileOk.status, 200)
})

test('job photo upload still works for a signed-in employee or customer and stays closed to anonymous visitors', async () => {
  const env = envOf()
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat', email: 'pat@ex.test', password: 'password1'}}), env}))
  const probe = await data(await photosGet({request: req('/api/photos?bookingId=__probe'), env}))
  assert.equal(probe.json.ok, true)
  const anon = await photosPost({request: form('/api/photos', {fields: {bookingId: 'MD-1', group: 'before'}}), env})
  assert.equal(anon.status, 401)
  const uploaded = await photosPost({request: form('/api/photos', {cookie: jar(customer.cookie), fields: {bookingId: 'MD-1', group: 'before'}}), env})
  assert.equal(uploaded.status, 201)
  const body = await uploaded.json()
  const anonList = await data(await photosGet({request: req('/api/photos?bookingId=MD-1'), env}))
  assert.equal(anonList.status, 401)
  const seen = await data(await photosGet({request: req('/api/photos?bookingId=MD-1', {cookie: jar(admin.cookie)}), env}))
  assert.equal(seen.json.photos.length, 1)
  const file = await photoFileGet({request: req('/api/photos/' + body.key, {cookie: jar(customer.cookie)}), env, params: {path: body.key.split('/')}})
  assert.equal(file.status, 200)
  const removed = await photoDelete({request: req('/api/photos/' + body.key, {method: 'DELETE', cookie: jar(admin.cookie)}), env, params: {path: body.key.split('/')}})
  assert.equal(removed.status, 200)
})

test('team invite acceptance is single use and can create only the invited role', async () => {
  const env = envOf()
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  const created = await data(await invitesPost({request: req('/api/auth/invites', {method: 'POST', cookie: jar(admin.cookie), body: {name: 'Riley Admin', email: 'riley@millirons.test', role: 'admin'}}), env}))
  assert.equal(created.status, 201)
  const token = created.json.invite.token
  const preview = await data(await invitePreview({request: req('/api/auth/invites/preview?token=' + token), env}))
  assert.equal(preview.json.state, 'ok')
  assert.equal(preview.json.invite.token, undefined)
  const accepted = await data(await inviteAccept({request: req('/api/auth/invites/accept', {method: 'POST', body: {token, name: 'Riley Admin', confirm: 'riley@millirons.test', password: 'password1'}}), env}))
  assert.equal(accepted.status, 201)
  assert.equal(accepted.json.user.role, 'admin')
  const second = await data(await inviteAccept({request: req('/api/auth/invites/accept', {method: 'POST', body: {token, name: 'Riley Admin', confirm: 'riley@millirons.test', password: 'password1'}}), env}))
  assert.equal(second.status, 400)
})

test('parallel setup claims create one admin', async () => {
  const env = envOf()
  const body = {name: 'Jordan', email: 'admin@millirons.test', password: 'password1', code: CODE}
  const [a, b] = await Promise.all([
    setupPost({request: req('/api/auth/setup', {method: 'POST', body}), env}).then(data),
    setupPost({request: req('/api/auth/setup', {method: 'POST', body}), env}).then(data),
  ])
  const ok = [a, b].filter(x => x.status === 201)
  assert.equal(ok.length, 1)
  const third = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {...body, email: 'second@millirons.test'}}), env}))
  assert.equal(third.status, 403)
})

test('admin can approve an employee and the employee cannot approve themselves', async () => {
  const env = envOf()
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Chris', email: 'chris@millirons.test', password: 'password1', phone: '4045550199', city: 'Decatur'}}), env}))
  const self = await data(await mePatch({request: req('/api/auth/me', {method: 'PATCH', cookie: jar(employee.cookie), body: {status: 'Approved'}}), env}))
  assert.equal(self.json.user.status, 'Pending review')
  const decided = await data(await accountsPatch({request: req('/api/auth/accounts', {method: 'PATCH', cookie: jar(admin.cookie), body: {email: 'chris@millirons.test', status: 'Approved', reason: ''}}), env}))
  assert.equal(decided.status, 200)
  assert.equal(decided.json.user.status, 'Approved')
})

function storedRows(env, prefix) {
  return [...env.PHOTOS.store.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, row]) => ({key, value: JSON.parse(new TextDecoder().decode(row.bytes))}))
}

test('admin can preview as customer or employee, and switching back restores admin', async () => {
  const env = envOf()
  const created = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', https: true, body: {name: 'Jordan Millirons', email: 'admin@millirons.test', password: 'password1', code: CODE}}), env}))
  const other = await data(await login({request: req('/api/auth/login', {method: 'POST', https: true, body: {email: 'admin@millirons.test', password: 'password1', role: 'admin'}}), env}))
  const cookie = jar(created.cookie)
  const otherCookie = jar(other.cookie)
  const before = storedRows(env, '_auth/users/')
  assert.equal(before.length, 1)
  assert.equal(before[0].value.role, 'admin')
  const password = before[0].value.password

  const customerView = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'customer'}}), env}))
  assert.equal(customerView.status, 200)
  assert.equal(customerView.cookie, '')
  assert.equal(customerView.json.user.role, 'customer')
  assert.equal(customerView.json.user.viewAs, 'customer')
  assert.equal(customerView.json.user.actorRole, 'admin')
  assert.equal(customerView.json.user.preview, true)
  assert.equal(customerView.json.user.email, 'admin@millirons.test')
  assert.equal(customerView.json.user.id, created.json.user.id)
  assert.equal(customerView.json.user.password, undefined)
  const meCustomer = await data(await meGet({request: req('/api/auth/me', {cookie}), env}))
  assert.equal(meCustomer.json.user.role, 'customer')
  assert.equal(meCustomer.json.user.preview, true)
  const untouched = await data(await meGet({request: req('/api/auth/me', {cookie: otherCookie}), env}))
  assert.equal(untouched.json.user.role, 'admin')
  assert.equal(untouched.json.user.preview, undefined)

  const employeeView = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'employee'}}), env}))
  assert.equal(employeeView.status, 200)
  assert.equal(employeeView.json.user.role, 'employee')
  assert.equal(employeeView.json.user.status, 'Approved')
  assert.equal(employeeView.json.user.viewAs, 'employee')
  assert.equal(employeeView.json.user.actorRole, 'admin')
  assert.equal(employeeView.cookie, '')

  const userAfter = storedRows(env, '_auth/users/')
  assert.equal(userAfter.length, 1)
  assert.equal(userAfter[0].value.role, 'admin')
  assert.equal(userAfter[0].value.viewAs, undefined)
  assert.deepEqual(userAfter[0].value.password, password)
  const sessions = storedRows(env, '_auth/sessions/')
  assert.equal(sessions.length, 2)
  assert.equal(sessions.filter(row => row.value.viewAs === 'employee').length, 1)
  assert.equal(sessions.every(row => row.value.password === undefined), true)
  assert.match(created.cookie, /HttpOnly/)
  assert.match(created.cookie, /SameSite=None/)
  assert.match(created.cookie, /Secure/)
  assert.match(created.cookie, /Partitioned/)

  const checkoutBlocked = await data(await checkout({request: req('/api/checkout', {method: 'POST', cookie, body: {booking: {id: 'MD-TEST1'}}}), env}))
  assert.equal(checkoutBlocked.status, 403)
  assert.match(checkoutBlocked.json.error, /Preview only/)
  const orderBlocked = await data(await opsPost({request: req('/api/ops', {method: 'POST', cookie, body: {resource: 'orders', action: 'create', order: {item: 'Soap', qty: 1}}}), env}))
  assert.equal(orderBlocked.status, 403)
  const approveBlocked = await data(await accountsPatch({request: req('/api/auth/accounts', {method: 'PATCH', cookie, body: {email: 'nobody@millirons.test', status: 'Approved'}}), env}))
  assert.equal(approveBlocked.status, 403)
  const photoBlocked = await photosPost({request: form('/api/photos', {cookie, fields: {bookingId: 'MD-1', group: 'before'}}), env})
  assert.equal(photoBlocked.status, 403)
  const loginBlocked = await data(await login({request: req('/api/auth/login', {method: 'POST', cookie, body: {email: 'admin@millirons.test', password: 'password1', role: 'admin'}}), env}))
  assert.equal(loginBlocked.status, 403)
  assert.equal(loginBlocked.cookie, '')

  let reached = false
  const middlewareBlocked = await data(await middleware({
    request: req('/api/checkout', {method: 'POST', cookie, origin: 'http://127.0.0.1:5173', body: {booking: {id: 'MD-TEST1'}}}),
    env,
    async next() { reached = true; return new Response('{}', {status: 201, headers: {'content-type': 'application/json'}}) },
  }))
  assert.equal(reached, false)
  assert.equal(middlewareBlocked.status, 403)
  assert.equal(middlewareBlocked.json.error.includes('*'), false)

  const restored = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'admin'}}), env}))
  assert.equal(restored.status, 200)
  assert.equal(restored.cookie, '')
  assert.equal(restored.json.user.role, 'admin')
  assert.equal(restored.json.user.viewAs, undefined)
  assert.equal(restored.json.user.preview, undefined)
  assert.equal(restored.json.user.actorRole, undefined)
  assert.equal(restored.json.user.email, 'admin@millirons.test')
  const meAdmin = await data(await meGet({request: req('/api/auth/me', {cookie}), env}))
  assert.equal(meAdmin.json.user.role, 'admin')
  assert.equal(meAdmin.json.user.preview, undefined)
  assert.equal(storedRows(env, '_auth/sessions/').some(row => row.value.viewAs), false)
  const checkoutOpen = await data(await checkout({request: req('/api/checkout', {method: 'POST', cookie, body: {booking: {id: 'MD-TEST1'}}}), env}))
  assert.equal(checkoutOpen.status, 503)
  const order = await data(await opsPost({request: req('/api/ops', {method: 'POST', cookie, body: {resource: 'orders', action: 'create', order: {item: 'Soap', qty: 1}}}), env}))
  assert.equal(order.status, 201)
  let reachedAfter = false
  const middlewareOpen = await middleware({
    request: req('/api/checkout', {method: 'POST', cookie, origin: 'http://127.0.0.1:5173', body: {}}),
    env,
    async next() { reachedAfter = true; return new Response('{}', {status: 201}) },
  })
  assert.equal(reachedAfter, true)
  assert.equal(middlewareOpen.status, 201)
  assert.equal(storedRows(env, '_auth/users/').length, 1)
  assert.deepEqual(storedRows(env, '_auth/users/')[0].value.password, password)
})

test('a customer or employee cannot use view as, and a forged flag does not escalate', async () => {
  const env = envOf()
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email: 'pat@ex.test', password: 'password1', role: 'admin'}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Chris Lane', email: 'chris@millirons.test', password: 'password1', phone: '4045550199', city: 'Decatur'}}), env}))
  const anon = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', body: {role: 'admin'}}), env}))
  assert.equal(anon.status, 401)
  for (const [cookie, role] of [[jar(customer.cookie), 'customer'], [jar(employee.cookie), 'employee']]) {
    const asAdmin = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'admin'}}), env}))
    const asStaff = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie, body: {role: 'employee'}}), env}))
    assert.equal(asAdmin.status, 403)
    assert.equal(asStaff.status, 403)
    assert.equal(asAdmin.cookie, '')
    const me = await data(await meGet({request: req('/api/auth/me', {cookie}), env}))
    assert.equal(me.json.user.role, role)
    assert.equal(me.json.user.preview, undefined)
    assert.equal(me.json.user.actorRole, undefined)
    const accounts = await data(await accountsGet({request: req('/api/auth/accounts', {cookie}), env}))
    assert.equal(accounts.status, 403)
  }
  const session = storedRows(env, '_auth/sessions/').find(row => row.value.userId === customer.json.user.id)
  session.value.viewAs = 'admin'
  env.PHOTOS.store.get(session.key).bytes = new TextEncoder().encode(JSON.stringify(session.value))
  const forged = await data(await meGet({request: req('/api/auth/me', {cookie: jar(customer.cookie)}), env}))
  assert.equal(forged.json.user.role, 'customer')
  assert.equal(forged.json.user.preview, undefined)
  const stillDenied = await data(await accountsGet({request: req('/api/auth/accounts', {cookie: jar(customer.cookie)}), env}))
  assert.equal(stillDenied.status, 403)
  let customerCheckout = false
  const allowed = await middleware({
    request: req('/api/checkout', {method: 'POST', cookie: jar(customer.cookie), origin: 'http://127.0.0.1:5173', body: {}}),
    env,
    async next() { customerCheckout = true; return new Response('{}', {status: 503}) },
  })
  assert.equal(customerCheckout, true)
  assert.equal(allowed.status, 503)
  const bad = await data(await viewAs({request: req('/api/auth/view-as', {method: 'POST', cookie: jar(customer.cookie), body: {role: 'owner'}}), env}))
  assert.equal(bad.status, 403)
})

function legacyEmailRows(env) {
  return storedRows(env, '_auth/email/').filter(row => !row.key.slice('_auth/email/'.length).includes('/'))
}
function rolePointers(env) {
  return Object.fromEntries(storedRows(env, '_auth/email/')
    .filter(row => row.key.slice('_auth/email/'.length).includes('/'))
    .map(row => [row.key.split('/').pop(), row.value.id]))
}
function wipeRoleIndex(env) {
  for (const row of storedRows(env, '_auth/email/')) {
    if (row.key.slice('_auth/email/'.length).includes('/')) env.PHOTOS.store.delete(row.key)
  }
  env.PHOTOS.store.delete('_auth/meta/role-index-v1')
}
function passwordById(env) {
  return Object.fromEntries(storedRows(env, '_auth/users/').map(row => [row.value.id, row.value.password]))
}

test('the same email can have a customer and an employee, and customer login cannot become admin', async () => {
  const env = envOf()
  const email = 'shared@millirons.test'
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email, password: 'admin-pass-1', code: CODE}}), env}))
  assert.equal(admin.status, 201)
  assert.equal(admin.json.user.role, 'admin')
  const legacy = legacyEmailRows(env)
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].value.id, admin.json.user.id)
  const legacyBytes = JSON.stringify(legacy[0].value)

  const employeeFree = await data(await emailCheck({request: req('/api/auth/email', {method: 'POST', body: {email, role: 'employee'}}), env}))
  assert.equal(employeeFree.status, 200)
  assert.equal(employeeFree.json.exists, false)
  const hiddenAdmin = await data(await emailCheck({request: req('/api/auth/email', {method: 'POST', body: {email, role: 'admin'}}), env}))
  assert.equal(hiddenAdmin.status, 400)

  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email, password: 'customer-pass-1', role: 'admin'}}), env}))
  assert.equal(customer.status, 201)
  assert.equal(customer.json.user.role, 'customer')
  assert.notEqual(customer.json.user.id, admin.json.user.id)
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Pat Detailer', email: 'Shared@Millirons.test', password: 'employee-pass-1', phone: '4045550199', city: 'Decatur'}}), env}))
  assert.equal(employee.status, 201)
  assert.equal(employee.json.user.role, 'employee')
  assert.equal(storedRows(env, '_auth/users/').length, 3)
  assert.equal(JSON.stringify(legacyEmailRows(env)[0].value), legacyBytes)
  assert.deepEqual(rolePointers(env), {
    admin: admin.json.user.id,
    customer: customer.json.user.id,
    employee: employee.json.user.id,
  })
  const hashes = passwordById(env)
  assert.equal(hashes[admin.json.user.id].algo, 'PBKDF2-SHA-256')
  assert.notDeepEqual(hashes[customer.json.user.id], hashes[admin.json.user.id])
  assert.notDeepEqual(hashes[employee.json.user.id], hashes[customer.json.user.id])

  const employeeTaken = await data(await emailCheck({request: req('/api/auth/email', {method: 'POST', body: {email, role: 'employee'}}), env}))
  assert.equal(employeeTaken.json.exists, true)
  const dupCustomer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Other', email, password: 'customer-pass-9'}}), env}))
  assert.equal(dupCustomer.status, 409)
  const dupEmployee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Other', email, password: 'employee-pass-9', phone: '4045550100', city: 'Decatur'}}), env}))
  assert.equal(dupEmployee.status, 409)
  assert.equal(storedRows(env, '_auth/users/').length, 3)

  const asCustomer = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'customer-pass-1', role: 'customer'}}), env}))
  assert.equal(asCustomer.status, 200)
  assert.equal(asCustomer.json.user.role, 'customer')
  assert.equal(asCustomer.json.user.id, customer.json.user.id)
  assert.equal(asCustomer.json.user.password, undefined)
  const meCustomer = await data(await meGet({request: req('/api/auth/me', {cookie: jar(asCustomer.cookie)}), env}))
  assert.equal(meCustomer.json.user.role, 'customer')
  assert.equal(meCustomer.json.user.actorRole, undefined)
  assert.equal(meCustomer.json.user.preview, undefined)
  const customerDenied = await data(await accountsGet({request: req('/api/auth/accounts', {cookie: jar(asCustomer.cookie)}), env}))
  assert.equal(customerDenied.status, 403)

  const sneak = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'admin-pass-1', role: 'customer'}}), env}))
  assert.equal(sneak.status, 401)
  assert.equal(sneak.cookie, '')
  const sneakAdmin = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'customer-pass-1', role: 'admin'}}), env}))
  assert.equal(sneakAdmin.status, 401)
  assert.equal(sneakAdmin.cookie, '')

  const asAdmin = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'admin-pass-1', role: 'admin'}}), env}))
  assert.equal(asAdmin.status, 200)
  assert.equal(asAdmin.json.user.role, 'admin')
  assert.equal(asAdmin.json.user.id, admin.json.user.id)
  const asEmployee = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'employee-pass-1', role: 'employee'}}), env}))
  assert.equal(asEmployee.status, 200)
  assert.equal(asEmployee.json.user.role, 'employee')
  assert.equal(asEmployee.json.user.id, employee.json.user.id)

  for (const [id, role] of [[customer.json.user.id, 'customer'], [employee.json.user.id, 'employee'], [admin.json.user.id, 'admin']]) {
    const session = storedRows(env, '_auth/sessions/').find(row => row.value.userId === id && row.value.role === role)
    assert.ok(session)
    assert.equal(session.value.password, undefined)
  }
  assert.deepEqual(passwordById(env), hashes)
})

test('the detailer application checks and creates only an employee account', async () => {
  const env = envOf()
  const email = 'pat.detailer@millirons.test'
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email: 'owner@millirons.test', password: 'admin-pass-1', code: CODE}}), env}))
  assert.equal(admin.status, 201)
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email, password: 'customer-pass-1'}}), env}))
  assert.equal(customer.status, 201)
  assert.equal(customer.json.user.role, 'customer')

  const probe = async body => data(await emailCheck({request: req('/api/auth/email', {method: 'POST', body}), env}))
  const asEmployee = await probe({email, role: 'employee'})
  const omitted = await probe({email})
  const asCustomer = await probe({email, role: 'customer'})
  const asAdmin = await probe({email, role: 'admin'})
  assert.equal(asEmployee.status, 200)
  assert.equal(asEmployee.json.exists, false)
  assert.equal(omitted.status, 200)
  assert.equal(omitted.json.exists, false)
  assert.equal(asCustomer.json.exists, true)
  assert.equal(asAdmin.status, 400)
  assert.equal(rolePointers(env).employee, undefined)

  const ownerProbe = await probe({email: 'owner@millirons.test'})
  const ownerEmployee = await probe({email: 'owner@millirons.test', role: 'employee'})
  assert.equal(ownerProbe.json.exists, false)
  assert.equal(ownerEmployee.json.exists, false)

  const invited = await data(await invitesPost({request: req('/api/auth/invites', {method: 'POST', cookie: jar(admin.cookie), body: {name: 'Pat Detailer', email, role: 'employee'}}), env}))
  assert.equal(invited.status, 201)
  assert.equal(invited.json.invite.role, 'employee')
  assert.equal(invited.json.invite.email, email)

  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Pat Detailer', email, password: 'employee-pass-1', phone: '4045550199', city: 'Decatur', years: '4'}}), env}))
  assert.equal(employee.status, 201)
  assert.equal(employee.json.user.role, 'employee')
  assert.notEqual(employee.json.user.id, customer.json.user.id)
  assert.equal(rolePointers(env).customer, customer.json.user.id)
  assert.equal(rolePointers(env).employee, employee.json.user.id)
  assert.equal(legacyEmailRows(env).find(row => row.value.id === customer.json.user.id).value.id, customer.json.user.id)

  const taken = await probe({email})
  const takenRole = await probe({email, role: 'employee'})
  assert.equal(taken.json.exists, true)
  assert.equal(takenRole.json.exists, true)
  const dup = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Other Detailer', email, password: 'employee-pass-9', phone: '4045550100', city: 'Decatur'}}), env}))
  assert.equal(dup.status, 409)
  assert.match(dup.json.error, /employee account/i)
  assert.equal(storedRows(env, '_auth/users/').filter(row => row.value.email === email && row.value.role === 'employee').length, 1)
  const dupInvite = await data(await invitesPost({request: req('/api/auth/invites', {method: 'POST', cookie: jar(admin.cookie), body: {name: 'Other Detailer', email, role: 'employee'}}), env}))
  assert.equal(dupInvite.status, 409)

  const stillCustomer = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'customer-pass-1', role: 'customer'}}), env}))
  assert.equal(stillCustomer.status, 200)
  assert.equal(stillCustomer.json.user.role, 'customer')
  assert.equal(stillCustomer.json.user.id, customer.json.user.id)
  const staff = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'employee-pass-1', role: 'employee'}}), env}))
  assert.equal(staff.status, 200)
  assert.equal(staff.json.user.id, employee.json.user.id)
  assert.equal(staff.json.user.role, 'employee')
})

test('a shared password asks which role to open and does not grant admin by default', async () => {
  const env = envOf()
  const email = 'both@millirons.test'
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'Jordan Millirons', email, password: 'shared-pass-1', code: CODE}}), env}))
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email, password: 'shared-pass-1'}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Pat Detailer', email, password: 'shared-pass-1', phone: '4045550199', city: 'Decatur'}}), env}))
  const before = storedRows(env, '_auth/sessions/').length
  const ambiguous = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'shared-pass-1'}}), env}))
  assert.equal(ambiguous.status, 409)
  assert.equal(ambiguous.cookie, '')
  assert.equal(ambiguous.json.chooseRole, true)
  assert.deepEqual(ambiguous.json.roles, ['customer', 'employee', 'admin'])
  assert.equal(ambiguous.json.user, undefined)
  assert.equal(JSON.stringify(ambiguous.json).includes('PBKDF2'), false)
  assert.equal(storedRows(env, '_auth/sessions/').length, before)
  const picked = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'shared-pass-1', role: 'customer'}}), env}))
  assert.equal(picked.status, 200)
  assert.equal(picked.json.user.role, 'customer')
  assert.equal(picked.json.user.id, customer.json.user.id)
  assert.notEqual(picked.json.user.id, admin.json.user.id)
  const me = await data(await meGet({request: req('/api/auth/me', {cookie: jar(picked.cookie)}), env}))
  assert.equal(me.json.user.role, 'customer')
  assert.equal(me.json.user.id, customer.json.user.id)
  const staff = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'shared-pass-1', role: 'employee'}}), env}))
  assert.equal(staff.json.user.id, employee.json.user.id)
  assert.equal(staff.json.user.role, 'employee')
})

test('existing accounts keep their passwords after the role index is rebuilt', async () => {
  const env = envOf()
  const email = 'legacy@millirons.test'
  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', https: true, body: {name: 'Jordan Millirons', email, password: 'admin-pass-1', code: CODE}}), env}))
  const customer = await data(await register({request: req('/api/auth/register', {method: 'POST', body: {name: 'Pat Customer', email: 'pat@ex.test', password: 'customer-pass-1'}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'Chris Lane', email: 'chris@millirons.test', password: 'employee-pass-1', phone: '4045550199', city: 'Decatur'}}), env}))
  const hashes = passwordById(env)
  const legacyBefore = legacyEmailRows(env).map(row => ({key: row.key, value: {...row.value}}))
  assert.equal(legacyBefore.length, 3)
  const userKeys = storedRows(env, '_auth/users/').map(row => row.key).sort()

  wipeRoleIndex(env)
  assert.deepEqual(rolePointers(env), {})
  for (const row of storedRows(env, '_auth/sessions/')) {
    delete row.value.role
    env.PHOTOS.store.get(row.key).bytes = new TextEncoder().encode(JSON.stringify(row.value))
  }
  const stillAdmin = await data(await meGet({request: req('/api/auth/me', {cookie: jar(admin.cookie)}), env}))
  assert.equal(stillAdmin.status, 200)
  assert.equal(stillAdmin.json.user.role, 'admin')
  assert.equal(stillAdmin.json.user.id, admin.json.user.id)
  const rebound = storedRows(env, '_auth/sessions/').find(row => row.value.userId === admin.json.user.id)
  assert.equal(rebound.value.role, 'admin')

  wipeRoleIndex(env)
  const adminAgain = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email, password: 'admin-pass-1', role: 'admin'}}), env}))
  const customerAgain = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'pat@ex.test', password: 'customer-pass-1', role: 'customer'}}), env}))
  const employeeAgain = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'chris@millirons.test', password: 'employee-pass-1', role: 'employee'}}), env}))
  assert.equal(adminAgain.status, 200)
  assert.equal(customerAgain.status, 200)
  assert.equal(employeeAgain.status, 200)
  assert.equal(adminAgain.json.user.id, admin.json.user.id)
  assert.equal(customerAgain.json.user.id, customer.json.user.id)
  assert.equal(employeeAgain.json.user.id, employee.json.user.id)
  assert.equal(adminAgain.json.user.role, 'admin')
  assert.equal(customerAgain.json.user.role, 'customer')
  assert.equal(employeeAgain.json.user.role, 'employee')
  assert.deepEqual(passwordById(env), hashes)
  assert.deepEqual(legacyEmailRows(env).map(row => ({key: row.key, value: row.value})), legacyBefore)
  assert.deepEqual(storedRows(env, '_auth/users/').map(row => row.key).sort(), userKeys)
  assert.equal(rolePointers(env).admin, admin.json.user.id)
  assert.equal(rolePointers(env).customer, customer.json.user.id)
  assert.equal(rolePointers(env).employee, employee.json.user.id)
  assert.match(admin.cookie, /HttpOnly/)
  assert.match(admin.cookie, /SameSite=None/)
  assert.match(admin.cookie, /Secure/)
  assert.match(admin.cookie, /Partitioned/)
})

test('auth refuses to run without a long SESSION_SECRET', async () => {
  const env = envOf(new MemoryR2(), {SESSION_SECRET: 'short'})
  const response = await data(await login({request: req('/api/auth/login', {method: 'POST', body: {email: 'a@b.co', password: 'password1', role: 'admin'}}), env}))
  assert.equal(response.status, 503)
})

function form(path, {cookie, fields = {}, fileName = 'shot.jpg'} = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  fd.set('file', new File([Uint8Array.from([1, 2, 3, 4])], fileName, {type: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg'}))
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  return new Request('http://127.0.0.1:8788' + path, {method: 'POST', body: fd, headers})
}

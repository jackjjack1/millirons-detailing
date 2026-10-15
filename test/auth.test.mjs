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
function req(path, {method = 'GET', body, cookie, https = false} = {}) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
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

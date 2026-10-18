import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {onRequestGet as detailersGet} from '../functions/api/detailers.js'
import {onRequestPost as setupPost} from '../functions/api/auth/setup.js'
import {onRequestPost as apply} from '../functions/api/auth/apply.js'
import {onRequestPatch as accountsPatch} from '../functions/api/auth/accounts.js'
import {publicDetailer, publicDetailers} from '../src/detailers.js'

const SECRET = 'test-session-secret-must-be-32-characters'
const CODE = 'test-setup-code'
const PASSWORD = 'password1'

class MemoryR2 {
  constructor() { this.store = new Map() }
  async get(key) {
    const row = this.store.get(key)
    if (!row) return null
    return {text: async () => new TextDecoder().decode(row.bytes), json: async () => JSON.parse(new TextDecoder().decode(row.bytes))}
  }
  async put(key, value, opts = {}) {
    if (opts.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    this.store.set(key, {bytes})
    return {key}
  }
  async head(key) { return this.store.has(key) ? {key} : null }
  async delete(key) { this.store.delete(key) }
  async list({prefix = ''} = {}) {
    const keys = [...this.store.keys()].filter(key => key.startsWith(prefix)).sort()
    return {objects: keys.map(key => ({key})), truncated: false}
  }
}

function envOf() {
  return {PHOTOS: new MemoryR2(), SESSION_SECRET: SECRET, ADMIN_SETUP_CODE: CODE}
}
function req(path, {method = 'GET', body, cookie} = {}) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
  return new Request('http://127.0.0.1:8788' + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)})
}
async function data(response) {
  const text = await response.text()
  return {status: response.status, json: text ? JSON.parse(text) : {}, cookie: response.headers.get('set-cookie') || ''}
}
function jar(cookieHeader) {
  const match = String(cookieHeader || '').match(/md_session=([^;]*)/)
  return match && match[1] ? `md_session=${match[1]}` : ''
}

test('a public detailer card keeps only what the employee wrote', () => {
  const pending = publicDetailer({id: 'u1', role: 'employee', status: 'Pending review', name: 'William Millirons', detailer: 'william', profile: {city: 'Atlanta', bio: 'Pending bio'}, rating: 4.9, reviews: 12})
  assert.equal(pending, null)
  const card = publicDetailer({id: 'u2', role: 'employee', status: 'Approved', name: 'William Millirons', detailer: 'william', email: 'william@millirons.test', profile: {city: 'Atlanta', bio: 'Mobile in town.', years: '6', services: 'Interior, ceramic'}, password: {hash: 'nope'}})
  assert.deepEqual(card, {id: 'william', name: 'William Millirons', city: 'Atlanta', bio: 'Mobile in town.', services: 'Interior, ceramic', years: '6'})
  assert.equal('rating' in card, false)
  assert.equal('reviews' in card, false)
  assert.equal('email' in card, false)
  const cards = publicDetailers([
    {role: 'employee', status: 'Approved', name: 'Ada', detailer: 'ada'},
    {role: 'employee', status: 'Approved', name: 'Bea', detailer: 'ada'},
    {role: 'customer', status: 'Approved', name: 'Customer', detailer: 'ada'},
    {role: 'employee', status: 'Rejected', name: 'Rejected', detailer: 'rejected'},
  ])
  assert.deepEqual(cards.map(item => item.id), ['ada', 'ada-2'])
})

test('the public detailer list is approved employees only', async () => {
  const env = envOf()
  const empty = await data(await detailersGet({request: req('/api/detailers'), env}))
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.detailers, [])

  const admin = await data(await setupPost({request: req('/api/auth/setup', {method: 'POST', body: {name: 'William Millirons', email: 'william@millirons.test', password: PASSWORD, code: CODE}}), env}))
  const employee = await data(await apply({request: req('/api/auth/apply', {method: 'POST', body: {name: 'William Millirons', email: 'william@millirons.test', password: PASSWORD, phone: '4045550199', city: 'Atlanta', bio: 'Real bio'}}), env}))
  assert.equal(admin.status, 201)
  assert.equal(employee.status, 201)
  assert.equal(employee.json.user.status, 'Pending review')

  const hidden = await data(await detailersGet({request: req('/api/detailers'), env}))
  assert.deepEqual(hidden.json.detailers, [])
  const hiddenText = JSON.stringify(hidden.json)
  assert.equal(hiddenText.includes('william@millirons.test'), false)
  assert.equal(hiddenText.includes('rating'), false)

  const approved = await data(await accountsPatch({request: req('/api/auth/accounts', {method: 'PATCH', cookie: jar(admin.cookie), body: {email: 'william@millirons.test', status: 'Approved', reason: ''}}), env}))
  assert.equal(approved.status, 200)
  const listed = await data(await detailersGet({request: req('/api/detailers'), env}))
  assert.equal(listed.json.detailers.length, 1)
  assert.equal(listed.json.detailers[0].name, 'William Millirons')
  assert.equal(listed.json.detailers[0].city, 'Atlanta')
  assert.equal(listed.json.detailers[0].id, 'william')
  assert.equal('rating' in listed.json.detailers[0], false)
  assert.equal('reviews' in listed.json.detailers[0], false)
  assert.equal(JSON.stringify(listed.json).includes('william@millirons.test'), false)
  assert.equal(JSON.stringify(listed.json).includes('password'), false)
})

test('sample detailer names and ratings are gone from the site source', () => {
  const files = ['src/data.js', 'src/App.jsx', 'src/BookLink.jsx', 'src/Bookings.jsx', 'src/detailers.js']
  const banned = ['Marcus Reed', 'Ana Torres', 'Devon Park', 'Lena Brooks', 'sampleReviews', 'reviews:312']
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const name of banned) assert.equal(text.includes(name), false, `${file} still has ${name}`)
  }
  const clock = readFileSync('src/TimeClock.jsx', 'utf8')
  assert.equal(clock.includes('FAKE_NAMES'), true)
  assert.equal(clock.includes('Van loaded'), false)
  assert.equal(clock.includes('★'), false)
})

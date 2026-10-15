import assert from 'node:assert/strict'
import test from 'node:test'
import {opsAction, opsGet, opsMigrate} from '../src/opsApi.js'

const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({url: String(url), init})
  return new Response(JSON.stringify({ok: true}), {status: 200, headers: {'content-type': 'application/json'}})
}

test('ops client uses the shared API with credentialed GET and POST requests', async () => {
  calls.length = 0
  await opsGet('inventory')
  await opsAction('orders', 'create', {order: {item: 'Soap'}})
  await opsMigrate({inventory: []})
  assert.equal(calls[0].url, 'https://millironsdetailing.com/api/ops?resource=inventory')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.credentials, 'include')
  assert.equal(JSON.parse(calls[1].init.body).action, 'create')
  assert.equal(JSON.parse(calls[2].init.body).action, 'migrate')
})

// Shared operations data. Records live in the existing PHOTOS R2 bucket and are
// private: every read and mutation requires a signed-in account.
import {guard, json, listUsers as listAccounts, readJson, requireAdmin, requireUser} from '../_lib/auth.js'

const PREFIX = 'ops/'
const TYPES = ['Chemical', 'Supply', 'Part', 'Tool', 'Equipment', 'Other']
const UNITS = ['each', 'bottle', 'gal', 'qt', 'box', 'pack', 'case', 'set']
const STATUSES = ['Requested', 'Approved', 'Ordered', 'Received', 'Denied']
const NEXT = {Requested: ['Approved', 'Denied'], Approved: ['Ordered', 'Denied'], Ordered: ['Received'], Received: [], Denied: []}
const SHOP_SEED = [
  {id:'SH-1',name:'Dual-action polisher (15mm)',cat:'Tool',par:3,onHand:3,location:'Bay 1 · Cage',condition:'good'},
  {id:'SH-2',name:'Pressure washer 1.8 GPM',cat:'Tool',par:2,onHand:2,location:'Bay 2',condition:'good'},
  {id:'SH-3',name:'Wet/dry vac',cat:'Tool',par:2,onHand:2,location:'Bay 2',condition:'worn'},
  {id:'SH-4',name:'Steam cleaner',cat:'Tool',par:1,onHand:1,location:'Bay 1',condition:'good'},
  {id:'SH-5',name:'Foam cannon',cat:'Tool',par:4,onHand:4,location:'Shelf A2',condition:'good'},
  {id:'SH-6',name:'APC concentrate (gal)',cat:'Chemical',par:4,onHand:4,location:'Chem cabinet C1',condition:'good'},
  {id:'SH-7',name:'Compound, heavy cut (qt)',cat:'Chemical',par:3,onHand:3,location:'Chem cabinet C2',condition:'good'},
  {id:'SH-8',name:'Finishing polish (qt)',cat:'Chemical',par:3,onHand:3,location:'Chem cabinet C2',condition:'good'},
  {id:'SH-9',name:'Wiper blades 22"',cat:'Part',par:10,onHand:10,location:'Bin P1',condition:'good'},
  {id:'SH-10',name:'Wiper blades 26"',cat:'Part',par:10,onHand:10,location:'Bin P1',condition:'good'},
  {id:'SH-11',name:'Foam buffing pads 5" (cut)',cat:'Part',par:24,onHand:24,location:'Shelf B1',condition:'good'},
  {id:'SH-12',name:'Foam buffing pads 5" (finish)',cat:'Part',par:24,onHand:24,location:'Shelf B1',condition:'good'},
  {id:'SH-13',name:'Cabin air filters (assorted)',cat:'Part',par:15,onHand:15,location:'Bin P2',condition:'good'},
  {id:'SH-14',name:'DI water filter cartridges',cat:'Part',par:6,onHand:6,location:'Bin P3',condition:'good'},
  {id:'SH-15',name:'Pressure washer nozzle set',cat:'Part',par:4,onHand:4,location:'Bin P3',condition:'good'},
  {id:'SH-16',name:'Headlight restoration kits',cat:'Part',par:8,onHand:8,location:'Shelf A3',condition:'good'},
]
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max)
const jsonResponse = (data, status = 200) => json(data, status)
const fail = (message, status = 400) => jsonResponse({error: message}, status)
const keyFor = (resource, id) => `${PREFIX}${resource}/${id}.json`
const asNum = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback
const cleanUrl = value => {
  const raw = text(value, 2000)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.href : ''
  } catch { return '' }
}
const uid = prefix => `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`

async function readRecordVersion(env, key) {
  const object = await env.PHOTOS.get(key)
  if (!object) return null
  try { return {record: await object.json(), etag: object.etag} } catch { return null }
}
async function readRecord(env, key) {
  return (await readRecordVersion(env, key))?.record || null
}
async function listRecords(env, resource) {
  const records = []
  let cursor
  do {
    const page = await env.PHOTOS.list({prefix: `${PREFIX}${resource}/`, cursor})
    for (const object of page.objects || []) {
      const record = await readRecord(env, object.key)
      if (record) records.push({...record, _version: object.etag})
    }
    cursor = page.truncated ? page.cursor : null
  } while (cursor)
  return records
}
async function putRecord(env, resource, record, {createOnly = false, etag} = {}) {
  const safeRecord = {...record}
  delete safeRecord._version
  const result = await env.PHOTOS.put(keyFor(resource, record.id), JSON.stringify(safeRecord), {
    httpMetadata: {contentType: 'application/json'},
    ...(createOnly ? {onlyIf: {etagDoesNotMatch: '*'}} : etag ? {onlyIf: {etagMatches: etag}} : {}),
  })
  return result || null
}
async function mutateRecord(env, resource, id, mutate, {createOnly = false} = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await readRecordVersion(env, keyFor(resource, id))
    if (!current && !createOnly) return {missing: true}
    const next = mutate(current?.record || null)
    const saved = await putRecord(env, resource, {...next, id}, {createOnly: !current, etag: current?.etag})
    if (saved) return {record: next}
    if (createOnly && !current) return {conflict: true}
  }
  return {conflict: true}
}
function cleanInventory(item) {
  if (!item || typeof item !== 'object') return null
  const name = text(item.name, 120), id = text(item.id, 80)
  if (!name || !safeId(id)) return null
  const qty = Math.max(0, Math.floor(asNum(item.qty, NaN))), min = Math.max(0, Math.floor(asNum(item.min, NaN)))
  if (!Number.isFinite(qty) || !Number.isFinite(min)) return null
  const url = cleanUrl(item.url)
  if (item.url && !url) return null
  return {id, name, type: TYPES.includes(item.type) ? item.type : 'Other', qty, unit: UNITS.includes(item.unit) ? item.unit : 'each', min, location: text(item.location, 120) || 'Van stock', url, receivedOrderIds: Array.isArray(item.receivedOrderIds) ? [...new Set(item.receivedOrderIds.filter(safeId))].slice(-1000) : []}
}
function cleanOrder(order, user, {legacy = false} = {}) {
  if (!order || typeof order !== 'object') return null
  const item = text(order.item, 120), id = text(order.id, 80)
  const qty = Math.floor(asNum(order.qty, NaN))
  const status = STATUSES.includes(order.status) ? order.status : 'Requested'
  if (!item || !safeId(id) || !Number.isFinite(qty) || qty < 1 || qty > 100000) return null
  const url = cleanUrl(order.url)
  if (order.url && !url) return null
  const history = (Array.isArray(order.history) ? order.history : []).slice(-40).map(h => ({status: STATUSES.includes(h.status) ? h.status : 'Requested', by: text(h.by, 80), ts: text(h.ts, 40)}))
  return {
    id, itemId: safeId(order.itemId) ? order.itemId : '', item,
    type: TYPES.includes(order.type) ? order.type : 'Other', qty,
    unit: UNITS.includes(order.unit) ? order.unit : 'each', supplier: text(order.supplier, 120), url,
    cost: order.cost === '' || order.cost == null ? '' : Math.max(0, asNum(order.cost)),
    urgency: ['Low', 'Normal', 'High', 'Urgent'].includes(order.urgency) ? order.urgency : 'Normal',
    note: text(order.note, 500), date: text(order.date, 20),
    requestedBy: legacy ? text(order.requestedBy, 80) : user.name,
    requestedRole: legacy ? text(order.requestedRole, 20) : user.role,
    requestedById: legacy ? text(order.requestedById, 80) : user.id,
    created: legacy ? text(order.created, 40) || new Date().toISOString() : new Date().toISOString(),
    status, history: history.length ? history : [{status, by: legacy ? text(order.requestedBy, 80) : user.name, ts: new Date().toISOString()}],
  }
}
function cleanShop(item) {
  if (!item || typeof item !== 'object') return null
  const id = text(item.id, 80), name = text(item.name, 120)
  if (!safeId(id) || !name) return null
  return {id, name, cat: ['Chemical', 'Tool', 'Part'].includes(item.cat) ? item.cat : 'Part', par: Math.max(0, Math.floor(asNum(item.par))), onHand: Math.max(0, Math.floor(asNum(item.onHand))), location: text(item.location, 120), condition: ['good', 'worn', 'damaged', 'expired'].includes(item.condition) ? item.condition : 'good'}
}
function cleanCheck(check) {
  if (!check || typeof check !== 'object' || !safeId(check.id) || !Array.isArray(check.lines) || check.lines.length > 250) return null
  const lines = check.lines.map(line => {
    const name = text(line?.name, 120), itemId = text(line?.itemId, 80)
    if (!name || !safeId(itemId)) return null
    const counted = Math.max(0, Math.floor(asNum(line.counted)))
    return {itemId, name, cat: ['Tool', 'Chemical', 'Part'].includes(line.cat) ? line.cat : 'Part', expected: Math.max(0, Math.floor(asNum(line.expected))), counted, variance: counted - Math.max(0, Math.floor(asNum(line.expected))), status: text(line.status, 30), condition: ['good', 'worn', 'damaged', 'expired'].includes(line.condition) ? line.condition : 'good', location: text(line.location, 120), note: text(line.note, 300), isNew: !!line.isNew}
  })
  if (lines.some(line => !line)) return null
  return {id: text(check.id, 80), started: text(check.started, 40), by: text(check.by, 80), lines, finished: text(check.finished, 40) || new Date().toISOString(), applied: !!check.applied, appliedBy: text(check.appliedBy, 80), appliedAt: text(check.appliedAt, 40)}
}

async function onRequestGetHandler({request, env}) {
  if (!env.PHOTOS) return fail('PHOTOS binding missing.', 503)
  const gate = await requireUser(request, env)
  if (gate.error) return gate.error
  if (!['admin', 'employee'].includes(gate.user.role) || (gate.user.role === 'employee' && gate.user.status !== 'Approved')) return fail('Forbidden.', 403)
  const resource = new URL(request.url).searchParams.get('resource') || ''
  if (!['inventory', 'orders', 'shop', 'checks'].includes(resource)) return fail('Unknown operations resource.')
  if (['checks', 'shop'].includes(resource) && gate.user.role !== 'admin') return fail('Admin only.', 403)
  let records = (await listRecords(env, resource)).filter(record => !record.deleted)
  if (resource === 'shop') {
    if (!records.length) records = SHOP_SEED
    else {
      const known = new Set(records.map(record => record.id))
      records = [...records, ...SHOP_SEED.filter(seed => !known.has(seed.id))]
    }
  }
  if (resource === 'orders' && gate.user.role !== 'admin') records = records.filter(order => order.requestedById ? order.requestedById === gate.user.id : order.requestedRole === gate.user.role && order.requestedBy?.trim().toLowerCase() === gate.user.name.trim().toLowerCase())
  if (resource === 'orders') records.sort((a, b) => String(b.created).localeCompare(String(a.created)))
  return jsonResponse({[resource]: records})
}

async function onRequestPostHandler({request, env}) {
  if (!env.PHOTOS) return fail('PHOTOS binding missing.', 503)
  const gate = await requireUser(request, env)
  if (gate.error) return gate.error
  if (!['admin', 'employee'].includes(gate.user.role) || (gate.user.role === 'employee' && gate.user.status !== 'Approved')) return fail('Forbidden.', 403)
  const body = await readJson(request, 1_000_000)
  const resource = text(body.resource, 20), action = text(body.action, 20)

  if (action === 'migrate') {
    if (gate.user.role !== 'admin') return fail('Admin only.', 403)
    const snapshot = body.snapshot || {}
    const accounts = await listAccounts(env)
    for (const name of ['inventory', 'orders', 'shop', 'checks']) {
      if (!Array.isArray(snapshot[name]) || snapshot[name].length > 1000) continue
      const rows = snapshot[name].map(row => {
        if (name === 'inventory') return cleanInventory(row)
        if (name === 'orders') {
          const order = cleanOrder(row, gate.user, {legacy: true})
          if (order && !order.requestedById) {
            const owner = accounts.find(account => account.role === order.requestedRole && account.name?.trim().toLowerCase() === order.requestedBy.toLowerCase())
            if (owner) order.requestedById = owner.id
          }
          return order
        }
        return name === 'shop' ? cleanShop(row) : cleanCheck(row)
      }).filter(Boolean)
      for (const row of rows) {
        const current = await readRecordVersion(env, keyFor(name, row.id))
        if (current) continue
        if (!(await putRecord(env, name, row, {createOnly: true}) && await readRecordVersion(env, keyFor(name, row.id)))) return fail('Could not migrate shared operations data safely. Retry the migration.', 503)
      }
    }
    return jsonResponse({migrated: true})
  }

  if (resource === 'inventory') {
    const admin = await requireAdmin(request, env)
    if (admin.error) return admin.error
    if (action === 'upsert') {
      const item = cleanInventory(body.item)
      if (!item) return fail('Invalid inventory product.')
      const current = await readRecordVersion(env, keyFor(resource, item.id))
      if ((current && body.item._version !== current.etag) || (!current && body.item._version)) return fail('The product changed in another session. Refresh and try again.', 409)
      const saved = await putRecord(env, resource, item, {createOnly: !current, etag: current?.etag})
      if (!saved) return fail('The product changed in another session. Refresh and try again.', 409)
      return jsonResponse({item: {...item, _version: saved.etag}})
    }
    if (action === 'delete') {
      if (!safeId(body.id)) return fail('Invalid product id.')
      const current = await readRecordVersion(env, keyFor(resource, body.id))
      if (!current || current.record.deleted) return fail('Product not found.', 404)
      if (!body.version || body.version !== current.etag) return fail('The product changed in another session. Refresh and try again.', 409)
      const deleted = {...current.record, deleted: true}
      if (!(await putRecord(env, resource, deleted, {etag: current.etag}))) return fail('The product changed in another session. Refresh and try again.', 409)
      return jsonResponse({ok: true})
    }
    return fail('Unknown inventory action.')
  }

  if (resource === 'orders') {
    if (action === 'create') {
      const input = {...body.order, id: uid('PO')}
      const order = cleanOrder(input, gate.user)
      if (!order) return fail('Invalid supply request.')
      order.status = 'Requested'
      order.history = [{status: 'Requested', by: gate.user.name, ts: order.created}]
      if (!(await putRecord(env, resource, order, {createOnly: true}))) return fail('Could not reserve a unique order id. Please retry.', 409)
      return jsonResponse({order: {...order, _version: (await readRecordVersion(env, keyFor(resource, order.id)))?.etag}}, 201)
    }
    if (action === 'status') {
      const admin = await requireAdmin(request, env)
      if (admin.error) return admin.error
      if (!safeId(body.id) || !STATUSES.includes(body.status)) return fail('Invalid order status.')
      const orderVersion = await readRecordVersion(env, keyFor(resource, body.id))
      const order = orderVersion?.record
      if (!order) return fail('Order not found.', 404)
      if (!body.version || body.version !== orderVersion.etag) return fail('The order changed in another session. Refresh and retry.', 409)
      if (order.status === 'Received') return fail('This order has already been received.', 409)
      if (!(NEXT[order.status] || []).includes(body.status)) return fail('That status change is not allowed.', 409)
      const updated = {...order, status: body.status, history: [...(order.history || []), {status: body.status, by: gate.user.name, ts: new Date().toISOString()}].slice(-40)}
      if (body.status === 'Received') {
        if (!(await applyReceipt(env, order))) return fail('Inventory changed concurrently. Refresh and retry receiving this order.', 409)
        updated.receivedAt = new Date().toISOString()
      }
      const savedOrder = await putRecord(env, resource, updated, {etag: orderVersion.etag})
      if (!savedOrder) return fail('The order changed in another session. Refresh and retry.', 409)
      return jsonResponse({order: {...updated, _version: savedOrder.etag}})
    }
    return fail('Unknown order action.')
  }

  if (resource === 'shop') {
    const admin = await requireAdmin(request, env)
    if (admin.error) return admin.error
    if (action !== 'upsert') return fail('Unknown stock action.')
    const item = cleanShop(body.item)
    if (!item) return fail('Invalid shop item.')
    if (!(await putRecord(env, resource, item, {createOnly: !await env.PHOTOS.head(keyFor(resource, item.id))}))) return fail('The stock item changed in another session. Refresh and try again.', 409)
    return jsonResponse({item})
  }

  if (resource === 'checks') {
    const admin = await requireAdmin(request, env)
    if (admin.error) return admin.error
    if (action === 'create') {
      const check = cleanCheck({...body.check, id: body.check?.id || uid('SC'), by: gate.user.name, finished: new Date().toISOString(), applied: false})
      if (!check) return fail('Invalid stock check.')
      if (!(await putRecord(env, resource, check, {createOnly: true}))) return fail('Could not reserve a unique stock-check id. Please retry.', 409)
      return jsonResponse({check}, 201)
    }
    if (action === 'apply') {
      if (!safeId(body.id)) return fail('Invalid stock check id.')
      const checkVersion = await readRecordVersion(env, keyFor(resource, body.id))
      const check = checkVersion?.record
      if (!check) return fail('Stock check not found.', 404)
      if (check.applied) return jsonResponse({check, shop: await listRecords(env, 'shop')})
      for (const line of check.lines) {
        const updated = await mutateRecord(env, 'shop', line.itemId, previous => cleanShop({id: line.itemId, name: line.name, cat: line.cat, par: previous?.par ?? line.counted, onHand: line.counted, condition: line.condition, location: line.location}), {createOnly: true})
        if (updated.conflict || updated.missing) return fail('Stock changed concurrently. Refresh and retry applying this count.', 409)
      }
      const applied = {...check, applied: true, appliedBy: gate.user.name, appliedAt: new Date().toISOString()}
      if (!(await putRecord(env, resource, applied, {etag: checkVersion.etag}))) return fail('Stock check changed concurrently. Refresh and retry.', 409)
      return jsonResponse({check: applied, shop: await listRecords(env, 'shop')})
    }
    return fail('Unknown stock-check action.')
  }
  return fail('Unknown operations resource.')
}

async function applyReceipt(env, order) {
  let id = order.itemId
  let current = id ? await readRecordVersion(env, keyFor('inventory', id)) : null
  if (!current) {
    const match = (await listRecords(env, 'inventory')).find(item => item.name.toLowerCase() === order.item.toLowerCase())
    if (match) {id = match.id; current = await readRecordVersion(env, keyFor('inventory', id))}
  }
  if (!current) {
    id = `INV-RCV-${order.id}`
    const item = cleanInventory({id, name: order.item, type: order.type, qty: order.qty, unit: order.unit, min: 0, location: 'Receiving', url: order.url, receivedOrderIds: [order.id]})
    if (await putRecord(env, 'inventory', item, {createOnly: true})) return true
    current = await readRecordVersion(env, keyFor('inventory', id))
    if (!current) return false
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const item = current.record
    if ((item.receivedOrderIds || []).includes(order.id)) return true
    const updated = {...item, qty: item.qty + order.qty, url: item.url || order.url || '', receivedOrderIds: [...(item.receivedOrderIds || []), order.id].slice(-1000)}
    if (await putRecord(env, 'inventory', updated, {etag: current.etag})) return true
    current = await readRecordVersion(env, keyFor('inventory', id))
    if (!current) return false
  }
  return false
}

export const onRequestGet = guard(onRequestGetHandler)
export const onRequestPost = guard(onRequestPostHandler)

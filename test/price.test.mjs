import assert from 'node:assert/strict'
import test from 'node:test'
import {addons, services, vehicles, quoteBooking, vehicleNote, priceSizeForBodyTier, AFFIRM_MIN_USD} from '../src/data.js'
import {paymentMethodsFor, priceFor} from '../functions/api/_stripe.js'
import {onRequestGet, onRequestPost} from '../functions/api/checkout.js'

const SEDAN = {
  touchless: 59,
  exterior: 139,
  interior: 149,
  full: 259,
  premium: 379,
}
const SURCHARGE = {
  sedan: {touchless: 0, interior: 0, exterior: 0, full: 0, premium: 0},
  suv: {touchless: 20, interior: 30, exterior: 30, full: 40, premium: 40},
  truck: {touchless: 40, interior: 60, exterior: 60, full: 80, premium: 80},
}

test('catalog lists Touchless Wash first and renames Premium Detail without changing its id', () => {
  assert.equal(services[0].id, 'touchless')
  assert.equal(services[0].name, 'Touchless Wash')
  assert.equal(services[0].price, 59)
  assert.match(services[0].time, /45/)
  assert.match(services[0].desc, /ceramic-coated/)
  assert.ok(services[0].includes.includes('WashChems Pro 30 touchless foam soak'))
  assert.equal(services.find(s => s.name === 'Premium Full + Sealant'), undefined)
  const premium = services.find(s => s.id === 'premium')
  assert.equal(premium.name, 'Premium Detail')
  assert.equal(premium.price, 379)
  assert.deepEqual(services.map(s => s.price), [59, 149, 139, 259, 379])
})

test('add-ons use the approved flat prices, including acid wheel and touchless wash', () => {
  const price = Object.fromEntries(addons.map(a => [a.id, a.price]))
  assert.deepEqual(price, {
    pet: 65,
    engine: 75,
    ceramic: 129,
    headlight: 89,
    odor: 79,
    leather: 49,
    'acid-wheel': 99,
    'touchless-wash': 39,
  })
  assert.match(addons.find(a => a.id === 'headlight').desc, /Both headlights/)
  assert.match(addons.find(a => a.id === 'acid-wheel').desc, /Wow Kleaners ICE/)
  assert.equal(addons.find(a => a.id === 'touchless-wash').onlyWith, undefined)
  assert.equal(addons.some(a => a.surcharge), false)
})

test('package surcharges match the sedan, SUV, and truck schedules', () => {
  for (const vehicle of vehicles) {
    for (const service of services) {
      const quote = quoteBooking({service: service.id, vehicle: vehicle.id, addons: []})
      assert.equal(quote.ok, true, `${service.id} ${vehicle.id}`)
      assert.equal(quote.surchargeUsd, SURCHARGE[vehicle.id][service.id])
      assert.equal(quote.usd, SEDAN[service.id] + SURCHARGE[vehicle.id][service.id])
      assert.equal(quote.cents, quote.usd * 100)
      assert.equal(Number.isInteger(quote.cents), true)
    }
  }
  assert.equal(vehicleNote(vehicles.find(v => v.id === 'sedan')), 'Base price')
  assert.match(vehicleNote(vehicles.find(v => v.id === 'suv')), /\+\$20 Touchless Wash/)
  assert.match(vehicleNote(vehicles.find(v => v.id === 'suv')), /\+\$30 Interior & Exterior/)
  assert.match(vehicleNote(vehicles.find(v => v.id === 'suv')), /\+\$40 Full & Premium/)
  assert.match(vehicleNote(vehicles.find(v => v.id === 'truck')), /\+\$40 Touchless Wash/)
  assert.match(vehicleNote(vehicles.find(v => v.id === 'truck')), /\+\$60 Interior & Exterior/)
  assert.match(vehicleNote(vehicles.find(v => v.id === 'truck')), /\+\$80 Full & Premium/)
})

test('add-ons do not take a vehicle surcharge and Touchless wash is allowed on every package', () => {
  const ids = addons.map(a => a.id)
  const addonSum = addons.reduce((t, a) => t + a.price, 0)
  assert.equal(addonSum, 624)
  for (const service of services.map(s => s.id)) {
    const sedan = quoteBooking({service, vehicle: 'sedan', addons: ids})
    const truck = quoteBooking({service, vehicle: 'truck', addons: ids})
    assert.equal(sedan.ok, true)
    assert.equal(truck.ok, true)
    assert.equal(sedan.addonsUsd, 624)
    assert.equal(truck.addonsUsd, 624)
    assert.equal(truck.usd - sedan.usd, SURCHARGE.truck[service])
    assert.equal(sedan.addons.some(a => a.id === 'touchless-wash'), true)
    assert.equal(sedan.addons.some(a => a.id === 'acid-wheel'), true)
  }
  const interior = quoteBooking({service: 'interior', vehicle: 'suv', addons: ['touchless-wash', 'acid-wheel']})
  assert.equal(interior.usd, 149 + 30 + 39 + 99)
  const wash = quoteBooking({service: 'touchless', vehicle: 'truck', addons: ['touchless-wash']})
  assert.equal(wash.usd, 59 + 40 + 39)
})

test('quote ignores client money fields, rejects unknown selections, and charges duplicate add-ons once', () => {
  const forged = quoteBooking({
    service: 'premium', vehicle: 'truck', addons: ['acid-wheel', 'acid-wheel'],
    total: 1, amount: 1, price: 1, surcharge: 0, surchargeUsd: 0,
  })
  assert.equal(forged.ok, true)
  assert.equal(forged.usd, 379 + 80 + 99)
  assert.equal(forged.addons.length, 1)
  assert.deepEqual(priceFor({service: 'full', vehicle: 'suv', addons: ['pet'], total: 5}), quoteBooking({service: 'full', vehicle: 'suv', addons: ['pet']}))
  assert.equal(quoteBooking({service: 'nope', vehicle: 'sedan'}).error, 'unknown service')
  assert.equal(quoteBooking({service: 'interior'}).error, 'unknown vehicle size')
  for (const vehicle of ['compact', 'van', 'xl', 'coupe']) {
    assert.equal(quoteBooking({service: 'exterior', vehicle}).error, 'unknown vehicle size')
  }
  assert.equal(quoteBooking({service: 'interior', vehicle: 'sedan', addons: ['touchless']}).error, 'unknown add-on')
  assert.equal(quoteBooking({service: 'interior', vehicle: 'sedan', addons: [{id: 'pet', price: 0}]}).error, 'unknown add-on')
  assert.equal(quoteBooking({service: 'interior', vehicle: 'sedan', addons: 'pet'}).error, 'unknown add-on')
})

test('garage body classes suggest a pricing size and are not themselves prices', () => {
  assert.equal(priceSizeForBodyTier('compact'), 'sedan')
  assert.equal(priceSizeForBodyTier('sedan'), 'sedan')
  assert.equal(priceSizeForBodyTier('suv'), 'suv')
  assert.equal(priceSizeForBodyTier('truck'), 'truck')
  assert.equal(priceSizeForBodyTier('van'), 'truck')
  assert.equal(priceSizeForBodyTier('xl'), 'truck')
  assert.equal(vehicles.some(v => 'add' in v), false)
})

test('Affirm is offered from the server total at $50 and above', () => {
  assert.equal(AFFIRM_MIN_USD, 50)
  assert.deepEqual(paymentMethodsFor(49), ['card'])
  assert.deepEqual(paymentMethodsFor(50), ['card', 'affirm'])
  assert.deepEqual(paymentMethodsFor(59), ['card', 'affirm'])
})

test('checkout charges the server quote and ignores a client total', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), method: init?.method, body: String(init?.body || '')})
    return new Response(JSON.stringify({id: 'cs_test_price', url: 'https://checkout.stripe.test/c/cs_test_price'}), {status: 200, headers: {'content-type': 'application/json'}})
  }
  try {
    const booking = {
      id: 'MD-PRICE1',
      service: 'premium',
      vehicle: 'truck',
      addons: ['acid-wheel', 'touchless-wash', 'acid-wheel'],
      total: 1,
      amount: 1,
      price: 1,
      surchargeUsd: 0,
      email: 'buyer@example.com',
      date: '2026-10-21',
      time: '9:30 AM',
    }
    const response = await onRequestPost({
      request: new Request('https://millironsdetailing.com/api/checkout', {method: 'POST', body: JSON.stringify({booking})}),
      env: {STRIPE_SECRET_KEY: 'sk_test_placeholder'},
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.amount, 597)
    assert.deepEqual(body.methods, ['card', 'affirm'])
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /checkout\/sessions$/)
    const form = decodeURIComponent(calls[0].body)
    assert.match(form, /\[unit_amount\]=59700/)
    assert.doesNotMatch(form, /\[unit_amount\]=100(?:&|$)/)
    assert.match(form, /Premium Detail/)
    assert.match(form, /Acid wheel restoration \+\$99/)
    assert.match(form, /Touchless wash \+\$39/)
    assert.match(form, /size surcharge \+\$80/)
    assert.match(form, /\[surchargeUsd\]=80/)
    assert.equal((form.match(/\[addons\]=acid-wheel,touchless-wash/g) || []).length, 2)
  } finally {
    globalThis.fetch = original
  }
})

test('checkout refuses an unknown size before calling Stripe', async () => {
  let called = false
  const original = globalThis.fetch
  globalThis.fetch = async () => { called = true; throw new Error('stripe should not be called') }
  try {
    const response = await onRequestPost({
      request: new Request('https://millironsdetailing.com/api/checkout', {
        method: 'POST',
        body: JSON.stringify({booking: {id: 'MD-BADSIZE', service: 'touchless', vehicle: 'compact', addons: ['touchless-wash'], total: 59}}),
      }),
      env: {STRIPE_SECRET_KEY: 'sk_test_placeholder'},
    })
    const body = await response.json()
    assert.equal(response.status, 400)
    assert.equal(body.error, 'unknown vehicle size')
    assert.equal(called, false)
  } finally {
    globalThis.fetch = original
  }
})

test('checkout probe reports the shared Affirm minimum', async () => {
  const response = await onRequestGet({env: {}})
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.live, false)
  assert.equal(body.affirmMinUsd, 50)
})

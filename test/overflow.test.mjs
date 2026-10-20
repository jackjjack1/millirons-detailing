import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {chromium} from 'playwright'

const PORT = 4199
const BASE = `http://127.0.0.1:${PORT}`
const WIDTHS = [320, 375, 390, 430, 480]
const customer = {
  id: 'cust_jordan', name: 'Christopher Montgomery', email: 'jordan@millirons.test', role: 'customer', status: 'Active',
}
const vehicle = {
  id: 'veh_camry', year: '2015', make: 'Jeep', model: 'Grand Cherokee', type: 'SUV', tier: 'suv',
  color: 'white', vin: '1C4RJFAG0FC625797', isDefault: true,
}

function startVite() {
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const stop = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* already stopped */ } }
  }
  return {child, stop}
}

async function waitReady(child) {
  const deadline = Date.now() + 20000
  let last = ''
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('vite exited early')
    try {
      const response = await fetch(BASE + '/')
      if (response.ok) return
      last = String(response.status)
    } catch (error) { last = error.message }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('vite did not start: ' + last)
}

async function fits(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const vw = root.clientWidth
    const art = document.querySelector('.showcase-art')
    const cal = document.querySelector('.cal')
    const nav = document.querySelector('.nav')
    window.scrollTo(0, 900)
    const sticky = nav ? nav.getBoundingClientRect().top : 0
    window.scrollTo(0, 0)
    return {
      delta: root.scrollWidth - vw,
      artRight: art ? art.getBoundingClientRect().right : null,
      calRight: cal ? cal.getBoundingClientRect().right : null,
      sticky,
      vw,
    }
  })
}

test('phone widths do not scroll sideways', {timeout: 120000}, async () => {
  const {child, stop} = startVite()
  let browser
  try {
    await waitReady(child)
    browser = await chromium.launch({channel: 'chrome', headless: true})
    const page = await (await browser.newContext({viewport: {width: 390, height: 844}})).newPage()
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') return route.fulfill({contentType: 'application/json', body: JSON.stringify({user: customer})})
      if (path === '/api/test-jobs') return route.fulfill({contentType: 'application/json', body: JSON.stringify({jobs: []})})
      if (path === '/api/garage') return route.fulfill({contentType: 'application/json', body: JSON.stringify({vehicles: [vehicle]})})
      if (path === '/api/detailers') return route.fulfill({contentType: 'application/json', body: JSON.stringify({detailers: []})})
      if (path === '/api/checkout') return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, live: false})})
      return route.fulfill({contentType: 'application/json', body: '{}'})
    })
    const routes = ['#/', '#/book', '#/login', '#/join', '#/detailers', '#/dashboard']
    for (const width of WIDTHS) {
      await page.setViewportSize({width, height: 844})
      for (const hash of routes) {
        await page.goto(`${BASE}/?w=${width}${hash}`, {waitUntil: 'domcontentloaded'})
        if (hash === '#/dashboard') await page.locator('.cal').waitFor()
        if (hash === '#/') await page.locator('.showcase-art').waitFor()
        const box = await fits(page)
        assert.ok(box.delta <= 0, `${hash} at ${width}px scrolls by ${box.delta}px`)
        assert.ok(box.sticky <= 1, `${hash} at ${width}px header is not sticky (${box.sticky})`)
        if (box.artRight != null) assert.ok(box.artRight <= box.vw + 1, `showcase art extends to ${box.artRight} in ${box.vw}`)
        if (box.calRight != null) assert.ok(box.calRight <= box.vw + 1, `calendar extends to ${box.calRight} in ${box.vw}`)
      }
    }
  } finally {
    await browser?.close()
    stop()
  }
})

// Drives wrangler pages dev and two isolated browsers.
// Run after `npm run build`. Uses a throwaway local R2 directory.
import {spawn} from 'node:child_process'
import {mkdir, rm} from 'node:fs/promises'
import {chromium} from 'playwright'

const PORT = 8788
const BASE = `http://127.0.0.1:${PORT}`
const SECRET = 'live-session-secret-at-least-32-characters'
const CODE = 'live-setup-code'
const OUT = '/opt/cursor/artifacts'
const persist = '/tmp/md-auth-live'

await rm(persist, {recursive: true, force: true})
const child = spawn('npx', [
  'wrangler', 'pages', 'dev', 'dist',
  '--port', String(PORT),
  '--ip', '127.0.0.1',
  '--inspector-port', '9239',
  '--persist-to', persist,
  '--show-interactive-dev-session', 'false',
  '--binding', `SESSION_SECRET=${SECRET}`,
  '--binding', `ADMIN_SETUP_CODE=${CODE}`,
], {stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1'}})

let logs = ''
child.stdout.on('data', d => {logs += d; process.stdout.write(d)})
child.stderr.on('data', d => {logs += d; process.stderr.write(d)})

const stop = () => {try {process.kill(-child.pid, 'SIGTERM')} catch {try {child.kill('SIGTERM')} catch { /* already stopped */ }}}
process.on('exit', stop)

async function waitReady() {
  const deadline = Date.now() + 45000
  let last = ''
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('wrangler exited early\n' + logs.slice(-2000))
    try {
      const response = await fetch(BASE + '/api/auth/setup')
      const body = await response.json()
      if (response.ok && body.setupEnabled === true && body.adminExists === false) return
      last = JSON.stringify(body)
    } catch (e) { last = e.message }
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error('wrangler did not become ready: ' + last + '\n' + logs.slice(-2000))
}

function shot(page, name) {
  return page.screenshot({path: `${OUT}/${name}.png`, fullPage: true, timeout: 10000})
}

const pages = {}
try {
  await mkdir(OUT, {recursive: true})
  await waitReady()
  const browser = await chromium.launch({headless: true})
  const contextA = await browser.newContext({viewport: {width: 1280, height: 900}})
  const contextB = await browser.newContext({viewport: {width: 1280, height: 900}})
  const pageA = pages.a = await contextA.newPage()
  const pageB = pages.b = await contextB.newPage()

  await pageA.goto(BASE + '/#/login?role=admin')
  await pageA.getByText('No admin account found').waitFor()
  await pageA.locator('input[name=name]').fill('Jordan Millirons')
  await pageA.locator('input[name=email]').fill('admin@millirons.test')
  await pageA.locator('input[name=password]').fill('password1')
  await pageA.locator('input[name=setupCode]').fill('wrong-code')
  await pageA.getByRole('button', {name: 'Create admin account'}).click()
  await pageA.getByText('That setup code is not valid.').waitFor({timeout: 20000})
  if (!pageA.url().includes('/login')) throw new Error('wrong setup code left the login page')
  await shot(pageA, 'admin-setup-rejected')

  await pageA.locator('input[name=setupCode]').fill(CODE)
  await pageA.getByRole('button', {name: 'Create admin account'}).click()
  await pageA.getByRole('heading', {name: 'Hi, Jordan.'}).waitFor()
  const cookieA = (await contextA.cookies()).find(c => c.name === 'md_session')
  if (!cookieA) throw new Error('session cookie was not set')
  if (!cookieA.httpOnly) throw new Error('session cookie is not HttpOnly')
  if (cookieA.sameSite !== 'Lax') throw new Error('session cookie SameSite is ' + cookieA.sameSite)
  const leaked = await pageA.evaluate(() => ({
    cookie: document.cookie,
    accounts: localStorage.getItem('md_accounts'),
    session: localStorage.getItem('md_session'),
  }))
  if (leaked.cookie.includes('md_session')) throw new Error('HttpOnly cookie is visible to JavaScript')
  if (leaked.accounts || leaked.session) throw new Error('account or session was written to localStorage')
  await shot(pageA, 'admin-signed-in-browser-a')

  const setupSeen = pageB.waitForResponse(r => r.url().includes('/api/auth/setup') && r.ok())
  await pageB.goto(BASE + '/#/login?role=admin')
  await setupSeen
  await pageB.getByRole('button', {name: 'Sign in', exact: true}).waitFor()
  if (await pageB.getByRole('button', {name: 'Create admin account'}).count()) throw new Error('fresh browser can still create an admin')
  if (await pageB.getByText('No admin account found').count()) throw new Error('setup form still visible after bootstrap')
  const blocked = await pageB.evaluate(async (code) => {
    const response = await fetch('/api/auth/setup', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'Stranger', email: 'stranger@millirons.test', password: 'password1', code})})
    return response.status
  }, CODE)
  if (blocked !== 403) throw new Error('fresh browser setup status ' + blocked)
  await shot(pageB, 'fresh-browser-no-admin-create')
  await pageB.locator('input[name=email]').fill('admin@millirons.test')
  await pageB.locator('input[name=password]').fill('password1')
  await pageB.getByRole('button', {name: 'Sign in', exact: true}).click()
  await pageB.getByRole('heading', {name: 'Hi, Jordan.'}).waitFor()
  const cookieB = (await contextB.cookies()).find(c => c.name === 'md_session')
  if (!cookieB?.httpOnly || cookieB.value === cookieA.value) throw new Error('second browser did not get its own HttpOnly session')
  await shot(pageB, 'admin-signed-in-browser-b')

  await pageA.getByRole('tab', {name: 'People'}).click()
  await pageA.getByRole('tab', {name: 'Invite employees'}).click()
  await pageA.getByPlaceholder('e.g. Chris Lane').fill('Chris Lane')
  await pageA.getByPlaceholder('name@example.com').fill('chris@millirons.test')
  await pageA.getByPlaceholder('(404) 555-0123').fill('4045550199')
  await pageA.getByRole('button', {name: 'Create invite link'}).click()
  await pageA.locator('#hire-link code').waitFor()
  const link = await pageA.locator('#hire-link code').innerText()
  if (!link.includes('#/join?invite=HIRE-')) throw new Error('invite link missing: ' + link)
  await shot(pageA, 'invite-employees-link')

  const contextC = await browser.newContext({viewport: {width: 1280, height: 900}})
  const pageC = pages.c = await contextC.newPage()
  await pageC.goto(link.trim())
  await pageC.getByText('You’re invited').waitFor()
  await pageC.locator('input[name=city]').fill('Decatur')
  await pageC.locator('input[name=pw]').fill('password1')
  await pageC.locator('input[name=pw2]').fill('password1')
  await pageC.getByRole('button', {name: 'Continue to vehicle proof'}).click()
  await pageC.locator('input[name=vyear]').fill('2021')
  await pageC.locator('input[name=vmake]').fill('Ford')
  await pageC.locator('input[name=vmodel]').fill('Transit')
  await pageC.locator('input[name=vplate]').fill('GA123')
  await pageC.locator('input[name=vphotos]').setInputFiles({name: 'van.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')})
  await pageC.getByRole('button', {name: 'Submit application'}).click()
  await pageC.getByRole('heading', {name: 'Application submitted.'}).waitFor()
  await shot(pageC, 'employee-application-submitted')

  const contextD = await browser.newContext({viewport: {width: 1280, height: 900}})
  const pageD = pages.d = await contextD.newPage()
  await pageD.goto(BASE + '/#/login?role=employee')
  await pageD.locator('input[name=email]').fill('chris@millirons.test')
  await pageD.locator('input[name=password]').fill('password1')
  await pageD.getByRole('button', {name: 'Sign in', exact: true}).click()
  await pageD.locator('.badge.b-pending-review').waitFor()
  await shot(pageD, 'employee-signed-in-other-browser')

  await pageA.reload()
  await pageA.getByRole('tab', {name: 'People'}).click()
  await pageA.getByRole('tab', {name: 'Invite employees'}).click()
  await pageA.getByText('Joined').waitFor()
  await shot(pageA, 'invite-marked-joined')

  await browser.close()
  console.log('LIVE_OK')
} catch (error) {
  console.error(error)
  for (const [name, page] of Object.entries(pages)) {
    try {
      console.log('PAGE', name, await page.locator('body').innerText())
      await page.screenshot({path: `/tmp/md-fail-${name}.png`, fullPage: true, timeout: 8000})
    } catch { /* page may be closed */ }
  }
  process.exitCode = 1
} finally {
  stop()
  await Promise.race([
    new Promise(r => { if (child.exitCode != null) r(); else child.once('exit', r) }),
    new Promise(r => setTimeout(r, 4000)),
  ])
}

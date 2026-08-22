/**
 * Proves the service worker can ship a new build to a returning player (§12).
 *
 * This is here because the failure is silent and permanent. A worker that
 * answers navigations from cache pins every player to the first build they
 * ever loaded: index.html never changes, so the build id never changes, so the
 * worker's own URL never changes, so the browser never sees an update. The
 * game keeps working, and no deployment ever reaches anyone. Nothing in a unit
 * test or a smoke run catches that, so it is checked here against a real
 * browser and two real builds.
 *
 * Three things have to hold at once:
 *   1. a returning player gets the newly deployed build,
 *   2. a player already pinned by a cache-first worker is healed by the fix,
 *   3. the game still cold-starts offline, well inside §12's three seconds.
 *
 * Usage: node tools/sw-update.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { contextOptions, launchChromium } from './browser.mjs'

const PORT = Number(process.env.SW_TEST_PORT ?? 4321)
const BASE = '/fishing-game/'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-update-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
}

function build(name, buildId) {
  execFileSync(npm, ['run', 'build'], { stdio: 'ignore', env: { ...process.env, BUILD_ID: buildId } })
  fs.cpSync('dist', path.join(root, name), { recursive: true })
}

// Two builds that differ, so "which bundle is the page running" is answerable.
build('a', 'testa')
fs.appendFileSync('src/main.ts', '\n// sw-update.mjs build marker\n')
try {
  build('b', 'testb')
} finally {
  const src = fs.readFileSync('src/main.ts', 'utf8')
  fs.writeFileSync('src/main.ts', src.replace('\n// sw-update.mjs build marker\n', ''))
}

/**
 * The shape of worker that caused the bug: cache-first for everything, so a
 * navigation never reaches the network and the page is pinned to whatever
 * index.html was cached first. Written out here rather than pulled from git so
 * the check keeps testing the property — that a worker of this shape can be
 * replaced — long after the commit that had it scrolls out of reach.
 */
const LEGACY_SW = `
const CACHE = 'slack-water-' + (new URL(self.location.href).searchParams.get('v') || 'dev')
const BASE = new URL('./', self.location.href).pathname
self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.add(new Request(BASE + 'index.html', { cache: 'reload' })))
    .then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (req.mode === 'navigate') {
      const shell = await cache.match(BASE + 'index.html')
      if (shell) return shell
    }
    const hit = await cache.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {})
    return res
  })())
})
`
const shippedSw = path.join(root, 'shipped-sw.js')
fs.writeFileSync(shippedSw, LEGACY_SW)

let serving = 'a'
let swSource = path.join(root, 'a', 'sw.js')
/**
 * Whether the host rewrites index.html away, as plenty of them do.
 *
 * `serve`, Netlify and a good few CDNs answer a request for `index.html` with
 * a 301 to the clean URL. The worker asks for the shell by name, so on those
 * hosts every navigation after the first got a redirected response — which a
 * worker may not hand to a navigation, so the browser failed the whole
 * navigation and the game stopped existing. Off by default because GitHub
 * Pages does not do it, and switched on below because the next host might.
 */
let cleanUrls = false
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!p.startsWith(BASE)) return void res.writeHead(404).end()
  if (cleanUrls && p.endsWith('/index.html')) {
    return void res.writeHead(301, { location: p.slice(0, -'.html'.length) }).end()
  }
  p = p.slice(BASE.length)
  if (p === '' || p.endsWith('/')) p += 'index.html'
  // The other half of a clean-URL host: it serves what it redirected to.
  if (cleanUrls && p === 'index') p = 'index.html'
  const file = p === 'sw.js' ? swSource : path.join(root, serving, p)
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return void res.writeHead(404).end()
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(PORT, r))

const bundleOf = (dir) =>
  /assets\/index-[\w-]+\.js/.exec(fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8'))[0].split('/').pop()
const A = bundleOf('a')
const B = bundleOf('b')

const browser = await launchChromium()
const ctx = await browser.newContext(contextOptions({ viewport: { width: 900, height: 500 } }))
const page = await ctx.newPage()
const running = () =>
  page.evaluate(() => (document.querySelector('script[type=module]')?.src || '').split('/').pop())

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

async function settle(times = 1) {
  for (let i = 0; i < times; i++) {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
  }
}

// 1. A first visit installs the worker and runs build A.
await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const first = await running()
const registered = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))
check('first visit installs the worker', registered)
check('first visit runs build A', first === A, first)

// 2. Deploy build B. A returning player must land on it.
serving = 'b'
swSource = path.join(root, 'b', 'sw.js')
await settle()
const returning = await running()
check('a returning player gets the new build', returning === B, returning)

// 3. And stay on it, rather than flapping between caches.
await settle()
const again = await running()
check('and stays on it', again === B, again)

// 4. Offline still works, and still starts fast.
await ctx.setOffline(true)
const t0 = Date.now()
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
const started = await page
  .waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 8000 })
  .then(() => true)
  .catch(() => false)
const cold = Date.now() - t0
check('cold start offline', started, `${cold}ms`)
check('offline start is under §12’s three seconds', started && cold < 3000, `${cold}ms`)
await ctx.setOffline(false)

// 5. A host that redirects index.html to a clean URL still works.
await settle()
cleanUrls = true
// Tolerated, because the failure this is here to catch IS the navigation
// failing: without the fix the reload rejects outright, and a harness that
// dies on it reports a stack trace where it should report a red check.
const navigated = await settle().then(() => true).catch(() => false)
const onCleanUrls = navigated ? await running() : ''
check('a host with clean URLs still serves the game', onCleanUrls === B, onCleanUrls || 'the navigation failed')
await ctx.setOffline(true)
const coldOnCleanUrls = await page
  .reload({ waitUntil: 'domcontentloaded' })
  .then(() => page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 8000 }))
  .then(() => true)
  .catch(() => false)
check('and still comes up offline', coldOnCleanUrls)
await ctx.setOffline(false)
cleanUrls = false

// 6. A player pinned by the worker that is deployed today is healed by the fix,
//    without them having to clear anything by hand.
const pinnedCtx = await browser.newContext(contextOptions({ viewport: { width: 900, height: 500 } }))
const pinned = await pinnedCtx.newPage()
serving = 'a'
swSource = shippedSw
await pinned.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' })
await pinned.waitForTimeout(2500)

serving = 'b'
swSource = path.join(root, 'b', 'sw.js')
let healedOn = 0
for (let visit = 1; visit <= 4 && !healedOn; visit++) {
  await pinned.reload({ waitUntil: 'networkidle' })
  await pinned.waitForTimeout(2500)
  const bundle = await pinned.evaluate(() =>
    (document.querySelector('script[type=module]')?.src || '').split('/').pop())
  if (bundle === B) healedOn = visit
}
check('a pinned player is healed by opening the game again', healedOn > 0,
  healedOn ? `on visit ${healedOn}` : 'never')

await browser.close()
server.close()
fs.rmSync(root, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)

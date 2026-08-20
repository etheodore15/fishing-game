/**
 * Verify the two claims §13.10 makes: the game saves, and it runs offline.
 *
 * Both are the kind of thing that looks fine until someone takes a boat out of
 * range, so they are checked against a real browser with the network actually
 * switched off rather than mocked.
 *
 * Usage: node tools/offline.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/fishing-game/'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const state = () =>
  page.evaluate(() => {
    const s = window.__slackwater?.store?.getState?.()
    return s ? { pages: s.pagesRestored, seen: s.hasSeenRestoration, catches: s.catchLog.length } : null
  })

function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

// ---- first load ----
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
check('boots', (await state()) !== null)
check('service worker registered', await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration()
  return Boolean(r)
}))

// ---- save ----
await page.evaluate(() => {
  const s = window.__slackwater.store.getState()
  s.restorePage('p003')
  s.finishRestoration()
  s.logCatch({
    speciesId: 'dusky-flathead', displayName: 'Dusky Flathead',
    lengthCm: 52, weightKg: 1.2, tideState: 'run-out', timeLabel: '07:12', at: 1,
  })
})
await page.waitForTimeout(900)

const before = await state()
check('page restored in memory', before.pages.includes('p003'), JSON.stringify(before))

// ---- reload: the save has to come back ----
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const after = await state()
check('restored page survives a reload', after.pages.includes('p003'), JSON.stringify(after))
check('catch log survives a reload', after.catches === 1, `${after.catches} catches`)
check('restoration flag survives a reload', after.seen === true)

// ---- offline cold start ----
await context.setOffline(true)
const t0 = Date.now()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__slackwater?.ready === true, null, { timeout: 20000 })
const coldMs = Date.now() - t0
const offline = await state()
check('cold starts with the network off', offline !== null)
check('journal survives offline', offline.pages.includes('p003'), JSON.stringify(offline))
console.log(`     offline cold start: ${coldMs}ms (software rendering; §13 targets <3000ms on device)`)

await page.screenshot({ path: 'scratch/offline.png' })
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()

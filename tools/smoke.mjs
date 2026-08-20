/**
 * Headless smoke test.
 *
 * A WebGL shader that fails to compile does so at runtime, not at build time,
 * so a green `tsc` and a green `vite build` prove almost nothing about the
 * water. This boots the built game in Chromium, watches for console errors and
 * WebGL warnings, and screenshots the result.
 *
 * Usage: node tools/smoke.mjs [url] [outfile] [waitMs]
 */
import { writeFileSync } from 'node:fs'
import { contextOptions, launchChromium } from './browser.mjs'

const url = process.argv[2] ?? 'http://localhost:4173/fishing-game/'
const out = process.argv[3] ?? 'scratch/smoke.png'
const waitMs = Number(process.argv[4] ?? 4000)

const browser = await launchChromium()
const page = await browser.newPage(contextOptions({ viewport: { width: 1280, height: 720 } }))

const errors = []
const logs = []
page.on('console', (m) => {
  const text = `${m.type()}: ${m.text()}`
  logs.push(text)
  if (m.type() === 'error' || /shader|GL_INVALID|WebGL/i.test(m.text())) errors.push(text)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
// Click past the title card: its scrim dims the whole scene, so a screenshot
// taken on the title tells you nothing about how the water actually looks.
const start = page.locator('.title button')
if (await start.count()) {
  await start.click()
  await page.waitForTimeout(300)
}
// SEEK=<seconds> jumps the authoritative clock, so a screenshot can be taken
// at any point in the tide cycle without waiting six real minutes for it.
if (process.env.SEEK) {
  await page.evaluate((t) => { window.__slackwater.clock.simTime = Number(t) }, process.env.SEEK)
  await page.waitForTimeout(700)
}
await page.waitForTimeout(waitMs)

const probe = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  return {
    canvas: c ? { w: c.width, h: c.height } : null,
    ready: window.__slackwater?.ready ?? null,
    fps: window.__slackwater?.fps ?? null,
    phase: window.__slackwater?.phase ?? null,
  }
})

await page.screenshot({ path: out })
writeFileSync(out.replace(/\.png$/, '.log'), logs.join('\n'))
await browser.close()

console.log('probe:', JSON.stringify(probe))
if (errors.length) {
  console.log('\nERRORS:')
  for (const e of errors.slice(0, 30)) console.log(' ', e)
  process.exit(1)
}
console.log('smoke: clean')

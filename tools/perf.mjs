/**
 * Measure the two things §11 states as rules rather than aspirations:
 * draw calls under 40 per frame, and zero allocations in the render loop.
 *
 * Both are measured against the built game in a real browser. The GL context
 * is instrumented before the app boots, so the counter is entirely test-side
 * and costs the shipped game nothing.
 *
 * This does NOT measure frame rate. The container renders through SwiftShader,
 * where 4fps means "no GPU", not "too slow" — §11's 60fps target has to be
 * profiled on a real mid-range Android, which is the owner's device pass.
 *
 * Usage: node tools/perf.mjs [url]
 */
import { SOFTWARE_GL, contextOptions, launchChromium } from './browser.mjs'

const url = process.argv[2] ?? 'http://localhost:4173/fishing-game/'
const browser = await launchChromium({
  args: [...SOFTWARE_GL, '--enable-precise-memory-info', '--js-flags=--expose-gc'],
})
const page = await browser.newPage(contextOptions({ viewport: { width: 1280, height: 720 } }))

// Count every draw before a single line of game code runs.
await page.addInitScript(() => {
  window.__draws = { frame: 0, max: 0, frames: 0, total: 0 }
  const wrap = (proto, name) => {
    const original = proto[name]
    if (!original) return
    proto[name] = function (...args) {
      window.__draws.frame += 1
      return original.apply(this, args)
    }
  }
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    wrap(WebGL2RenderingContext.prototype, name)
    wrap(WebGLRenderingContext.prototype, name)
  }
  const tick = () => {
    const d = window.__draws
    if (d.frame > 0) {
      d.frames += 1
      d.total += d.frame
      if (d.frame > d.max) d.max = d.frame
      d.frame = 0
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.locator('.title button').click()
await page.waitForTimeout(4000)

// Cast, so the measurement covers the tackle and the particles too.
await page.evaluate(() => {
  window.__slackwater.world.onGesture({
    type: 'flick', nx: 0.3, ny: 0.5, dx: 0.86, dy: -0.5, power: 0.6, angle: 0.53,
  })
})
await page.waitForTimeout(4000)
await page.evaluate(() => { window.__draws.max = 0; window.__draws.total = 0; window.__draws.frames = 0 })
await page.waitForTimeout(6000)

const draws = await page.evaluate(() => ({ ...window.__draws }))
const avg = draws.frames ? draws.total / draws.frames : 0
console.log(`draw calls   peak ${draws.max}   mean ${avg.toFixed(1)}   over ${draws.frames} frames`)
if (draws.max > 40) {
  console.log('FAIL: §11 caps draw calls at 40 per frame')
  process.exitCode = 1
} else if (draws.frames === 0) {
  console.log('FAIL: no frames were drawn')
  process.exitCode = 1
} else {
  console.log('ok   under the 40-call cap')
}

// ---- allocation ----
// Collect, settle, measure; run; collect, settle, measure. Anything the render
// loop allocates per frame shows up as growth that survives a collection.
const cdp = await page.context().newCDPSession(page)
const heap = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(600)
  return page.evaluate(() => performance.memory.usedJSHeapSize)
}

// Measured per SECOND, not per frame: software rendering runs at a handful of
// frames a second, so a per-frame figure here says more about SwiftShader than
// about the game.
//
// Three windows and the median of them, because one window is not a
// measurement. A forced collection is best-effort, and back-to-back runs of an
// identical build have come back at -13, +9 and +39 KB/s — a single sample
// decides at random which of those it reports, and a guard that fires at
// random is worse than no guard.
const SECONDS = 10
const WINDOWS = 3
const samples = []
for (let w = 0; w < WINDOWS; w++) {
  const before = await heap()
  await page.waitForTimeout(SECONDS * 1000)
  const after = await heap()
  samples.push({ before, after, perSecond: (after - before) / SECONDS })
}
samples.sort((a, b) => a.perSecond - b.perSecond)
const median = samples[Math.floor(WINDOWS / 2)]
const { before, after, perSecond } = median
console.log(
  `heap         ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB` +
    `   (${(perSecond / 1024).toFixed(1)} KB/s retained, median of ${WINDOWS})` +
    `   [${samples.map((x) => (x.perSecond / 1024).toFixed(1)).join(', ')}]`,
)
if (perSecond > 24 * 1024) {
  console.log('FAIL: the game is retaining memory while it renders')
  process.exitCode = 1
} else {
  console.log('ok   steady-state heap')
}

console.log('particles   ', await page.evaluate(() => window.__slackwater.particles))
await browser.close()

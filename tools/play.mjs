/**
 * Drive the game headlessly through a whole trip.
 *
 * The five phases only exist as a sequence when someone actually plays them,
 * and no unit test can tell you that a flick reaches the water or that a fish
 * can be brought to hand. This performs real pointer gestures against the
 * built game, reports every phase transition, and screenshots each one.
 *
 * Usage: node tools/play.mjs [url]
 */
import { mkdirSync } from 'node:fs'
import { contextOptions, launchChromium } from './browser.mjs'

const url = process.argv[2] ?? 'http://localhost:4173/fishing-game/'
const OUT = 'scratch/play'
mkdirSync(OUT, { recursive: true })

const browser = await launchChromium()
const page = await browser.newPage(contextOptions({ viewport: { width: 1280, height: 720 } }))

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(e.message))

const probe = () => page.evaluate(() => ({
  phase: window.__slackwater.phase,
  tension: +(window.__slackwater.tension ?? 0).toFixed(2),
  loss: window.__slackwater.loss,
  lure: window.__slackwater.lure,
  fish: window.__slackwater.fish,
  pages: window.__slackwater.pages,
  catches: window.__slackwater.catches,
  particles: window.__slackwater.particles,
  bust: +(window.__slackwater.bust ?? 0).toFixed(2),
  tide: window.__slackwater.tide,
  willingness: +(window.__slackwater.willingness ?? 0).toFixed(2),
}))

const seen = []
async function watch(ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const s = await probe()
    if (seen[seen.length - 1] !== s.phase) {
      seen.push(s.phase)
      console.log(
        `  → ${s.phase.padEnd(6)} tension=${s.tension}` +
          (s.loss ? ` LOSS=${s.loss}` : '') +
          (s.catches ? ` catches=${s.catches}` : '') +
          ` lure=${JSON.stringify(s.lure)}`,
      )
      await page.screenshot({ path: `${OUT}/${seen.length}-${s.phase}.png` })
    }
    await page.waitForTimeout(120)
  }
  if (label) await page.screenshot({ path: `${OUT}/${label}.png` })
  return probe()
}

/**
 * Gestures are dispatched inside the page rather than through page.mouse.
 *
 * Every CDP input round-trip waits on a frame, and under software rendering
 * that is a couple of hundred milliseconds — long enough that a flick arrives
 * as a hold and a tap arrives as a press. Dispatching PointerEvents directly
 * tests the recogniser at the speeds a real thumb produces.
 */
async function gesture(kind, args) {
  await page.evaluate(
    ([kind, a]) => {
      const el = document.getElementById('world')
      const send = (type, x, y) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1, pointerType: 'touch', isPrimary: true,
            clientX: x, clientY: y, bubbles: true, cancelable: true,
          }),
        )
      if (kind === 'flick') {
        send('pointerdown', a.fromX, a.fromY)
        for (let i = 1; i <= 6; i++) {
          send('pointermove', a.fromX + ((a.toX - a.fromX) * i) / 6, a.fromY + ((a.toY - a.fromY) * i) / 6)
        }
        send('pointerup', a.toX, a.toY)
      } else if (kind === 'tap') {
        send('pointerdown', a.x, a.y)
        send('pointerup', a.x, a.y)
      } else if (kind === 'holddown') {
        send('pointerdown', a.x, a.y)
      } else if (kind === 'holdup') {
        send('pointerup', a.x, a.y)
      }
    },
    [kind, args],
  )
}

const flick = (fromX, fromY, toX, toY) => gesture('flick', { fromX, fromY, toX, toY })
const tap = (x, y) => gesture('tap', { x, y })

async function hold(x, y, ms) {
  await gesture('holddown', { x, y })
  await page.waitForTimeout(ms)
  await gesture('holdup', { x, y })
}

await page.goto(url, { waitUntil: 'networkidle' })
const start = page.locator('.title button')
if (await start.count()) await start.click()
await page.waitForTimeout(600)

console.log('conditions:', JSON.stringify(await probe()).slice(0, 200))

console.log('\ncast:')
await flick(320, 420, 690, 190)
await watch(2500)

console.log('\nwork — hopping the lure back:')
for (let round = 0; round < 90; round++) {
  const s = await probe()
  if (s.phase === 'fight' || s.phase === 'log') break
  if (s.phase === 'read') {
    await flick(320, 420, 700, 200)
    await watch(1200)
    continue
  }
  // hold → release → hold reads as a hop (§6.3), which is what a dusky wants.
  await hold(640, 400, 240)
  await page.waitForTimeout(80)
  await tap(640, 400)
  await watch(260)
  if (round % 6 === 0) {
    const c = await probe()
    const best = c.fish.reduce((a, f) => (f.interest > a.interest ? f : a), c.fish[0])
    console.log(
      `  r${String(round).padStart(2)} cadence=${c.lure.cadence}/${c.lure.quality}` +
        ` lure=(${c.lure.x},${c.lure.y}) best fish ${best.state} interest=${best.interest}` +
        ` willingness=${c.willingness}`,
    )
  }
}

const afterWork = await probe()
console.log('\nafter work:', afterWork.phase, 'fish:', JSON.stringify(afterWork.fish.slice(0, 4)))

if (afterWork.phase === 'fight') {
  console.log('\nfight — pumping the drag:')
  for (let i = 0; i < 160; i++) {
    const s = await probe()
    if (s.phase !== 'fight') break
    if (i === 3) await page.screenshot({ path: `${OUT}/fight-loaded.png` })
    // Hold when the rod is not already loaded up, ease off when it is.
    if (s.tension < 0.62) await hold(640, 400, 700)
    else await page.waitForTimeout(240)
    await watch(80)
    if (i % 10 === 0) {
      const f = await probe()
      const on = f.fish.find((x) => ['hooked', 'surge', 'headshake', 'tire'].includes(x.state))
      console.log(
        `  i${String(i).padStart(3)} tension=${f.tension} ` +
          (on ? `fish ${on.state} stamina=${on.stamina} x=${on.x} y=${on.y}` : 'no hooked fish'),
      )
    }
  }
}

const final = await watch(1500, 'final')
console.log('\nphases seen:', seen.join(' → '))
console.log('final:', JSON.stringify({
  phase: final.phase, loss: final.loss, catches: final.catches, pages: final.pages,
}))
if (errors.length) {
  console.log('\nERRORS:', errors.slice(0, 8))
  process.exit(1)
}
await browser.close()

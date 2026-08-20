import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FishingLine, SEGMENTS } from '../src/sim/line.ts'
import { Rod, ROD_SAMPLES, ROD_LENGTH } from '../src/sim/rod.ts'

const flat = () => -0.5
/** A surface far below everything, so the whole line counts as aerial. */
const deep = () => 5
interface StepOpts {
  seconds?: number
  anchorX?: number
  anchorY?: number
  tipX?: number
  tipY?: number
  pinTip?: boolean
  windKt?: number
  windDirX?: number
  surface?: (x: number) => number
}

/** Run a line for a while. Every end point is explicit — see the wind test. */
const step = (line: FishingLine, o: StepOpts = {}) => {
  const {
    seconds = 2, anchorX = 1.5, anchorY = -1.3, tipX = 6, tipY = 0.4,
    pinTip = true, windKt = 12, windDirX = 1, surface = flat,
  } = o
  for (let i = 0; i < seconds * 60; i++) {
    line.step(1 / 60, anchorX, anchorY, tipX, tipY, pinTip, surface, windKt, windDirX)
  }
}

test('the line has the 36 segments §8.3 specifies', () => {
  assert.equal(SEGMENTS, 36)
})

test('a line under no load sags between its ends', () => {
  const line = new FishingLine()
  line.reset(1.5, -1.3, 6, 0.4)
  line.lineOut = 8 // far more line than the gap needs
  step(line)
  const mid = line.y[Math.floor(SEGMENTS / 2)]!
  const chord = (-1.3 + 0.4) / 2
  assert.ok(mid > chord, `slack line did not belly: mid ${mid} vs chord ${chord}`)
  assert.ok(line.straightness() < 0.95)
})

test('a tight line is far straighter than a slack one', () => {
  const gap = Math.hypot(6 - 1.5, 0.4 + 1.3)

  const taut = new FishingLine()
  taut.reset(1.5, -1.3, 6, 0.4)
  taut.lineOut = gap * 1.001
  step(taut, { windKt: 0, windDirX: 0 })

  const slack = new FishingLine()
  slack.reset(1.5, -1.3, 6, 0.4)
  slack.lineOut = gap * 1.5
  step(slack, { windKt: 0, windDirX: 0 })

  // Never quite 1: three constraint iterations against gravity leave a real
  // line with a real sag in it, which is the point of solving it rather than
  // drawing a straight line between two points.
  assert.ok(taut.straightness() > 0.95, `taut line was only ${taut.straightness()} straight`)
  assert.ok(
    taut.straightness() > slack.straightness() + 0.15,
    `taut ${taut.straightness()} vs slack ${slack.straightness()}`,
  )
})

/**
 * §8.3: wind acts on the aerial portion, and only on the aerial portion.
 *
 * Measured on a line that is entirely out of the water — the state it is in
 * during a cast, which is the moment the wind actually matters.
 */
test('wind bows the part of the line that is out of the water', () => {
  const aerial = (kt: number) => {
    const line = new FishingLine()
    line.reset(1.5, -1.3, 6, -1)
    line.lineOut = 6
    step(line, { tipY: -1, windKt: kt, surface: deep })
    return line
  }
  const still = aerial(0)
  const blown = aerial(22)

  let shift = 0
  let n = 0
  for (let i = 1; i < SEGMENTS; i++) {
    shift += blown.x[i]! - still.x[i]!
    n += 1
  }
  assert.ok(shift / n > 0.05, `a 22 knot cross-wind moved the line only ${(shift / n).toFixed(3)}m`)

  // And the submerged half of the same line must not care about the wind.
  // Everything below the surface: the same wind must do nothing at all.
  const wet = (kt: number) => {
    const line = new FishingLine()
    line.reset(1.5, 1.2, 6, 1.6)
    line.lineOut = 6
    // Both ends genuinely under water — including the anchor, or the top of
    // the line is aerial and the wind is allowed at it after all.
    step(line, { anchorY: 1.2, tipY: 1.6, windKt: kt })
    return line
  }
  const calmWet = wet(0)
  const blownWet = wet(22)
  let wetShift = 0
  for (let i = 1; i < SEGMENTS; i++) wetShift += Math.abs(blownWet.x[i]! - calmWet.x[i]!)
  assert.ok(wetShift / SEGMENTS < 0.01, `wind moved a submerged line by ${wetShift / SEGMENTS}m`)
})

test('both ends stay pinned where they are put', () => {
  const line = new FishingLine()
  line.reset(1.5, -1.3, 6, 0.4)
  step(line, { seconds: 1 })
  assert.ok(Math.abs(line.x[0]! - 1.5) < 1e-6)
  assert.ok(Math.abs(line.y[0]! + 1.3) < 1e-6)
  assert.ok(Math.abs(line.x[SEGMENTS]! - 6) < 1e-6)
})

/**
 * §6.4 asks the three losses to be distinguishable. Half of that is where the
 * line parts: shell cuts you down at the fish, and a break lets go anywhere.
 */
test('a bust-off cuts the line down at the fish, a break parts anywhere', () => {
  const cut = new FishingLine()
  cut.reset(1.5, -1.3, 6, 0.4)
  cut.breakLine(0.93, 0.55)
  assert.ok(cut.isBroken)
  assert.ok(cut.brokenAt > SEGMENTS * 0.8, `a shell cut parted at segment ${cut.brokenAt}`)

  for (let i = 0; i < 40; i++) {
    const snap = new FishingLine()
    snap.reset(1.5, -1.3, 6, 0.4)
    snap.breakLine()
    assert.ok(snap.brokenAt >= 1 && snap.brokenAt < SEGMENTS, `parted at ${snap.brokenAt}`)
  }
})

test('a broken line stops holding its far end', () => {
  const line = new FishingLine()
  line.reset(1.5, -1.3, 6, 0.4)
  step(line, { seconds: 1 })
  line.breakLine(0.5)
  // With the tip released, the far half falls away from where it was pinned.
  const before = line.y[SEGMENTS]!
  step(line, { seconds: 1.5, pinTip: false })
  assert.ok(line.y[SEGMENTS]! > before, 'the loose end did not fall')
})

test('breaking twice does not move the break', () => {
  const line = new FishingLine()
  line.reset(1.5, -1.3, 6, 0.4)
  line.breakLine(0.2)
  const at = line.brokenAt
  line.breakLine(0.9)
  assert.equal(line.brokenAt, at)
})

/** §8.4 — the bend IS the tension display, so it has to actually track it. */
test('the rod bends with tension and springs back without it', () => {
  const rod = new Rod()
  for (let i = 0; i < 200; i++) rod.update(1 / 60, 0, 8, 1, false)
  const rest = rod.load
  const restTipY = rod.tipY
  assert.ok(rest < 0.02, `an unloaded rod was bent ${rest}`)

  for (let i = 0; i < 200; i++) rod.update(1 / 60, 0.9, 8, 1, true)
  assert.ok(rod.load > 0.8, `a loaded rod only bent ${rod.load}`)
  assert.ok(rod.tipY > restTipY, 'loading the rod did not pull the tip down')

  for (let i = 0; i < 200; i++) rod.update(1 / 60, 0, 8, 1, false)
  assert.ok(rod.load < 0.02, 'the rod did not spring back')
})

test('the rod loads faster than it unloads, so a surge has weight', () => {
  const load = new Rod()
  for (let i = 0; i < 12; i++) load.update(1 / 60, 1, 8, 1, true)
  const loaded = load.load

  const unload = new Rod()
  for (let i = 0; i < 400; i++) unload.update(1 / 60, 1, 8, 1, true)
  const from = unload.load
  for (let i = 0; i < 12; i++) unload.update(1 / 60, 0, 8, 1, false)
  const shed = from - unload.load

  assert.ok(loaded > shed, `rod loaded ${loaded} but shed ${shed} in the same time`)
})

test('a head-shake rings the tip and then settles', () => {
  const rod = new Rod()
  for (let i = 0; i < 200; i++) rod.update(1 / 60, 0.5, 8, 1, true)
  const settled = rod.tipY
  rod.strike(0.09, -0.07)
  rod.update(1 / 60, 0.5, 8, 1, true)
  assert.notEqual(rod.tipY, settled)
  for (let i = 0; i < 120; i++) rod.update(1 / 60, 0.5, 8, 1, true)
  assert.ok(Math.abs(rod.tipY - settled) < 0.01, 'the tip never stopped ringing')
})

test('the rod is sampled along its whole length', () => {
  const rod = new Rod()
  for (let i = 0; i < 100; i++) rod.update(1 / 60, 0, 8, 1, false)
  let run = 0
  for (let i = 1; i < ROD_SAMPLES; i++) {
    run += Math.hypot(rod.x[i]! - rod.x[i - 1]!, rod.y[i]! - rod.y[i - 1]!)
  }
  assert.ok(Math.abs(run - ROD_LENGTH) < 0.02, `the blank measured ${run}m, not ${ROD_LENGTH}m`)
})

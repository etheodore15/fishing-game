import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Viewport } from '../src/render/layers.ts'
import { castPower } from '../src/engine/input.ts'
import { CAST, TIDE } from '../src/engine/tuning.ts'
import { WaterField } from '../src/sim/water.ts'

/**
 * The vertical origin.
 *
 * These exist because the simulation measured depth from mean water and the
 * renderer measured it from the live waterline, so the tide got counted twice.
 * The bed rose and fell with the surface, which made the flat exactly as deep
 * on screen at dead low as at the top of the tide — in a game whose entire
 * subject is reading the water — and anything floating rendered a tide's worth
 * away from the water it was floating on.
 */
function viewport(tideOffsetM: number): Viewport {
  const vp = new Viewport()
  vp.resize(1280, 720)
  vp.tideOffsetM = tideOffsetM
  vp.update()
  return vp
}

const RANGE = TIDE.rangeM / 2

test('something floating on the surface renders on the surface, at any tide', () => {
  const water = new WaterField(1187)
  water.setWorldWidth(12)
  for (const off of [RANGE, 0.3, 0, -0.3, -RANGE]) {
    const vp = viewport(off)
    water.tideOffsetM = off
    // World y of the surface, as every sub-simulation computes it.
    const surfaceWorldY = water.surfaceY(4, 0)
    const rendered = vp.toScreenY(surfaceWorldY)
    // Where the water shader actually draws the surface.
    const drawn = vp.waterlineFrac * vp.heightPx
    assert.ok(
      Math.abs(rendered - drawn) < 1.5,
      `tide ${off}m: a floating object renders ${(rendered - drawn).toFixed(0)}px off the water`,
    )
  }
})

test('the bed does not move with the tide', () => {
  // An estuary bottom is not tidal. Only the water is.
  const positions = [RANGE, 0, -RANGE].map((off) => viewport(off).toScreenY(2.9))
  for (const p of positions) {
    assert.ok(Math.abs(p - positions[0]!) < 0.01, `the bed moved: ${positions.join(', ')}`)
  }
})

test('there is visibly more water at high tide than at low', () => {
  const band = (off: number) => {
    const vp = viewport(off)
    return vp.toScreenY(2.9) - vp.waterlineFrac * vp.heightPx
  }
  const high = band(RANGE)
  const low = band(-RANGE)
  assert.ok(high > low, `high tide band ${high}px is not deeper than low tide ${low}px`)
  // The whole tidal range has to actually show up on screen.
  const vp = viewport(0)
  assert.ok(
    Math.abs(high - low - TIDE.rangeM * vp.pxPerM) < 1,
    `only ${((high - low) / vp.pxPerM).toFixed(2)}m of a ${TIDE.rangeM}m range is visible`,
  )
})

test('the rod tip stays in frame and above the water at the top of the tide', () => {
  const vp = viewport(RANGE)
  // Rod tip sits near -1.5m; see sim/rod.ts.
  const tip = vp.toScreenY(-1.5)
  assert.ok(tip > 0, `the rod tip is ${tip}px — off the top of the screen`)
  assert.ok(tip < vp.waterlineFrac * vp.heightPx, 'the rod tip is under water at high tide')
})

test('a full-power cast lands in the water, not in the far bank', () => {
  // Reach is a fraction of the water in front of the angler. If full power
  // reaches the far side, every cast from there upward lands in the same place
  // and the top of the power range stops meaning anything.
  assert.ok(CAST.fullPowerReach < 1, 'full power casts past the visible water')
  assert.ok(CAST.fullPowerReach > CAST.minPowerReach, 'more power must cast further')
  assert.ok(CAST.minPowerReach > 0.1, 'the gentlest cast still has to clear the rod')
})

/**
 * Cast power.
 *
 * This used to measure displacement over the last eighty milliseconds of the
 * gesture and score it against a fixed pixel span — a velocity dressed as a
 * distance. A full-blooded swipe came out at a tenth of full power, so every
 * cast landed a couple of metres from the rod tip.
 */
const DIAG = Math.hypot(1280, 720)

test('a big swipe is a big cast, however fast it was made', () => {
  const slow = castPower(DIAG * 0.38, 0.5, DIAG)
  const fast = castPower(DIAG * 0.38, 2.0, DIAG)
  assert.ok(slow > 0.8, `a swipe across most of the screen only gave ${slow.toFixed(2)}`)
  assert.ok(fast >= slow, 'making the same swipe faster should never cast shorter')
})

test('a short sharp snap still casts a long way', () => {
  // The whole point of a flick: speed can stand in for distance.
  assert.ok(castPower(DIAG * 0.12, 2.4, DIAG) > 0.95)
})

test('a small slow drag is a short cast, and power spans the range', () => {
  assert.ok(castPower(60, 0.2, DIAG) < 0.15)
  const ladder = [0.08, 0.18, 0.28, 0.4].map((f) => castPower(DIAG * f, 0.3, DIAG))
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i]! > ladder[i - 1]!, `power did not increase: ${ladder.join(', ')}`)
  }
  assert.ok(ladder[3]! > 0.95, 'a full-screen swipe must reach full power')
})

test('power is screen-relative, so a phone and a tablet feel the same', () => {
  const phone = Math.hypot(844, 390)
  const tablet = Math.hypot(1366, 1024)
  const a = castPower(phone * 0.3, 1.0, phone)
  const b = castPower(tablet * 0.3, 1.0, tablet)
  assert.ok(Math.abs(a - b) < 0.02, `phone ${a.toFixed(2)} vs tablet ${b.toFixed(2)}`)
})

test('power is always a sane number', () => {
  for (const [d, s, diag] of [[0, 0, DIAG], [1e6, 1e6, DIAG], [100, 1, 0], [-5, -5, DIAG]]) {
    const p = castPower(d!, s!, diag!)
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 1, `castPower(${d},${s},${diag}) = ${p}`)
  }
})

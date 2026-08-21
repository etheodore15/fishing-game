import { strict as assert } from 'node:assert'
import test from 'node:test'
import { TIDE } from '../src/engine/tuning.ts'
import { Rod } from '../src/sim/rod.ts'
import { runBite } from '../tools/bite-sim.ts'

/**
 * The rod, between fights.
 *
 * It used to hold one angle in every phase — a diagonal across the corner of
 * the frame, unchanged whether the player was standing there looking at the
 * water, casting, working a lure home or hooked up — and the lure left the tip
 * the instant a flick was recognised. Nobody fishes like that, and it made the
 * one thing the player is holding the least alive thing on the screen.
 *
 * Two claims here, and both are measurements rather than opinions. The rod has
 * postures that are actually different from one another. And a cast is a
 * stroke on a clock: wind-up, forward swing, release, follow-through, with the
 * lure leaving at the top of the whip.
 *
 * The third is the frame. There are two metres of sky above mean water and the
 * top of the tide is 0.7m of it, so the tip has a narrow lane to work in and
 * every posture and every moment of the stroke has to stay inside it. This is
 * where that gets checked, because it is exactly the kind of thing that a
 * tempting constant will quietly break.
 */

const DT = 1 / 60
/** World y of the top of the frame — see render/layers.ts. */
const FRAME_TOP = -2.0
/** World y of the water at the top of the tide. */
const HIGH_WATER = -TIDE.rangeM / 2

/** Hold a posture until it has settled, and report the tip. */
function settle(pose: 'rest' | 'work' | 'fight', tension = 0): Rod {
  const rod = new Rod()
  for (let i = 0; i < 240; i++) rod.update(DT, tension, 6, 1.2, pose)
  return rod
}

test('the rod holds three different postures, and they read as three things', () => {
  const rest = settle('rest')
  const work = settle('work', 0.1)
  const fight = settle('fight', 0.85)

  // Waiting: tip up, out of the way, nothing on it.
  assert.ok(rest.tipY < work.tipY - 0.4, `rest ${rest.tipY.toFixed(2)} is not clearly above work ${work.tipY.toFixed(2)}`)
  assert.ok(rest.load < 0.02, `a rod with nothing on it was bent ${rest.load.toFixed(2)}`)

  // Working a lure: tip dropped toward the water, and a little weight in it —
  // a lure swimming, which is a tenth of what a fish does and could not be
  // read as one (§5.5: the bend is the tension display and stays that).
  assert.ok(work.load > 0.03 && work.load < 0.2, `a retrieve loaded the rod ${work.load.toFixed(2)}`)

  // A fish on: bent, and the bend is the fish.
  assert.ok(fight.load > 0.8, `a fight only bent the rod ${fight.load.toFixed(2)}`)
  assert.ok(fight.tipY > work.tipY, 'a loaded rod should have its tip lower than a working one')
})

test('a cast is a stroke, not an event', () => {
  const rod = settle('rest')
  const wait = rod.beginCast(0.8, 0.6)
  assert.ok(wait > 0.15 && wait < 0.45, `the rod threw the lure after ${wait.toFixed(2)}s`)

  let released = -1
  let releases = 0
  let backwards = 0
  let forwards = 0
  let t = 0
  for (let i = 0; i < 60; i++) {
    rod.update(DT, 0, 6, 1.2, 'work')
    t += DT
    if (rod.released) {
      released = t
      releases += 1
    }
    // Sign of the bend, from the geometry: a wind-up curves the tip up and
    // back, a loaded forward stroke pulls it down.
    if (released < 0 && rod.load > 0.1) backwards += 1
    if (released > 0 && rod.load > 0.1 && rod.tipY > -1.6) forwards += 1
  }
  assert.equal(releases, 1, 'the lure left the tip more than once')
  assert.ok(Math.abs(released - wait) < 0.03, `released at ${released.toFixed(3)}s, promised ${wait.toFixed(3)}s`)
  assert.ok(backwards > 4, 'the rod never loaded up before the stroke')
  assert.ok(forwards > 0, 'the rod never came through the stroke loaded')
})

test('the lure leaves at the fastest part of the whip', () => {
  // Which is the whole reason to hold onto it: a lure that leaves during the
  // wind-up is a lure being dropped, not cast.
  const rod = settle('rest')
  rod.beginCast(1, 0.4)
  let px = rod.tipX
  let py = rod.tipY
  let peak = 0
  let peakAt = 0
  let releasedAt = -1
  let t = 0
  for (let i = 0; i < 60; i++) {
    rod.update(DT, 0, 6, 1.2, 'work')
    t += DT
    const speed = Math.hypot(rod.tipX - px, rod.tipY - py) / DT
    px = rod.tipX
    py = rod.tipY
    if (speed > peak) {
      peak = speed
      peakAt = t
    }
    if (rod.released) releasedAt = t
  }
  assert.ok(peak > 6, `the tip only reached ${peak.toFixed(1)} m/s — that is not a cast`)
  assert.ok(Math.abs(peakAt - releasedAt) < 0.08, `peak at ${peakAt.toFixed(3)}s, released at ${releasedAt.toFixed(3)}s`)
})

test('the rod straightens itself out again', () => {
  const rod = settle('rest')
  rod.beginCast(1, 0.5)
  for (let i = 0; i < 90; i++) rod.update(DT, 0, 6, 1.2, 'work')
  assert.ok(!rod.casting, 'the stroke never finished')
  assert.ok(rod.load < 0.05, `the rod was still bent ${rod.load.toFixed(2)} a second and a half later`)
  const work = settle('work')
  assert.ok(Math.abs(rod.tipY - work.tipY) < 0.06, 'the rod did not come back to the working posture')
})

test('the tip stays in the frame and out of the water, through any cast', () => {
  // The lane is narrow and every constant in the stroke pushes on one wall of
  // it or the other. A tip off the top of the screen is a rod that vanished; a
  // tip in the water is not a rod at all.
  let highest = 0
  let lowest = -9
  for (const power of [0.15, 0.4, 0.7, 1]) {
    for (const up of [0, 0.3, 0.6, 1]) {
      const rod = settle('rest')
      rod.beginCast(power, up)
      for (let i = 0; i < 90; i++) {
        rod.update(DT, 0, 6, 1.2, 'work')
        highest = Math.min(highest, rod.tipY)
        lowest = Math.max(lowest, rod.tipY)
      }
    }
  }
  assert.ok(highest > FRAME_TOP + 0.05, `the tip reached ${highest.toFixed(2)}m — off the top of the frame`)
  assert.ok(lowest < HIGH_WATER - 0.15, `the tip reached ${lowest.toFixed(2)}m — in the water at the top of the tide`)
})

test('a fight still bends the rod down and nothing else does', () => {
  // §5.5, restated as a measurement: the stroke may bend the blank all it
  // likes, but a rod at rest with a lure hanging off it is a straight rod, and
  // the only thing that puts a fish's worth of curve in it is a fish.
  const rest = settle('rest')
  assert.ok(rest.load < 0.02)
  for (const tension of [0.2, 0.5, 0.9]) {
    const rod = settle('fight', tension)
    assert.ok(Math.abs(rod.load - tension) < 0.05, `tension ${tension} drew ${rod.load.toFixed(2)} of bend`)
  }
})

test('the rod holds the lure, then throws it out over the water', () => {
  // The whole path, through the trip: a flick starts a stroke, the lure rides
  // the tip while the rod loads, and it still lands where casts used to land.
  const r = runBite({ hopIntervalSec: 1.2, script: 'hop' })
  assert.ok(r.castHoldSec !== null, 'nothing was ever cast')
  assert.ok(r.castHoldSec! > 0.15, `the lure left the tip after ${r.castHoldSec!.toFixed(3)}s — that is no stroke at all`)
  assert.ok(r.castHoldSec! < 0.45, `the rod sat on the lure for ${r.castHoldSec!.toFixed(3)}s`)
  assert.ok(r.castReachM! > 3, `a three-quarter-power cast reached ${r.castReachM!.toFixed(1)}m`)
})

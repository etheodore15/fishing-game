import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  LURE_LENGTH_M,
  LURE_STATIONS,
  lureHeading,
  lureHalf,
  lureShade,
  lureX,
  lureY,
  solveLure,
} from '../src/art/lureRig.ts'

/**
 * The lure.
 *
 * There was nothing on the end of the line at all — the line simply stopped in
 * the water — so a retrieve looked identical whether the player was working it
 * or had put the phone down. What the rig has to say, and what these check, is
 * exactly that difference.
 */

const pose = (drive: number, t = 0.5) => {
  solveLure({ x: 4, y: 1.5, heading: 0, lengthM: LURE_LENGTH_M, t, drive })
}

/** Distance of each station from the straight line the lure would be at rest. */
function swings(): number[] {
  const out: number[] = []
  for (let i = 0; i < LURE_STATIONS; i++) {
    // heading 0 lays the body along -x from the nose, so any y is a swing.
    out.push(Math.abs(lureY[i]! - 1.5))
  }
  return out
}

test('a lure on the bottom is dead still', () => {
  // The whole retrieve is a conversation about whether the thing is working,
  // so a lure nobody is working must not wave at anyone.
  pose(0)
  const still = swings()
  const worst = Math.max(...still)
  assert.ok(worst < LURE_LENGTH_M * 0.06, `a dead lure swung ${(worst * 100).toFixed(1)}cm`)
})

test('a worked lure swings, and swings from the tail', () => {
  let best = 0
  // Across a beat, so the test does not depend on catching the wave at its peak.
  for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
    pose(1, t)
    const s = swings()
    best = Math.max(best, s[LURE_STATIONS - 1]!)
    // The head is where the line is tied. It goes where it is pulled, not where
    // the tail wants it.
    assert.ok(s[0]! < 1e-9, 'the nose moved')
    assert.ok(s[LURE_STATIONS - 1]! >= s[4]!, 'the middle swung wider than the tail')
  }
  assert.ok(best > LURE_LENGTH_M * 0.25, `the paddle only reached ${(best * 100).toFixed(1)}cm`)
})

test('the harder it is worked the wider it kicks', () => {
  const peak = (drive: number) => {
    let m = 0
    for (let k = 0; k < 24; k++) {
      pose(drive, k * 0.02)
      m = Math.max(m, swings()[LURE_STATIONS - 1]!)
    }
    return m
  }
  const slow = peak(0.25)
  const hard = peak(1)
  assert.ok(hard > slow * 1.8, `slow ${slow.toFixed(3)}m vs hard ${hard.toFixed(3)}m`)
})

test('the silhouette is a paddle-tail, not a worm', () => {
  pose(0)
  const wrist = lureHalf[7]!
  const paddle = lureHalf[8]!
  const shoulder = lureHalf[1]!
  assert.ok(paddle > wrist * 2, 'the paddle is no wider than the wrist it hangs off')
  assert.ok(shoulder > paddle, 'the head should be the fattest part of a jighead')
  assert.ok(lureHalf[9]! < paddle, 'the paddle never closes at its trailing edge')
})

test('the head is dark lead and the body is pale plastic', () => {
  // It reads at ten pixels because it is drawn the way the bait school is:
  // pale against dark water, which the eye is already hunting for.
  pose(0.5)
  assert.ok(lureShade[0]! < 0.3, `the lead head came out at ${lureShade[0]!.toFixed(2)}`)
  assert.ok(lureShade[8]! > 0.7, `the paddle came out at ${lureShade[8]!.toFixed(2)}`)
})

test('a lure that has stopped stands on its head', () => {
  // A jighead sinks lead first. Being able to see that is what "let it sink"
  // looks like from the boat.
  let h = 0
  for (let i = 0; i < 120; i++) h = lureHeading(0.01, 0.02, h, 1 / 60)
  assert.ok(Math.abs(h - Math.PI / 2) < 0.05, `settled at ${h.toFixed(2)} rad, not nose-down`)
})

test('a swimming lure points where it is going', () => {
  let h = Math.PI / 2
  for (let i = 0; i < 120; i++) h = lureHeading(-1.2, -0.1, h, 1 / 60)
  const want = Math.atan2(-0.1, -1.2)
  // Compared the long way round, because a heading that has walked past π is
  // the same heading, and the rig is free to get there whichever way is shorter.
  const off = Math.abs(Math.atan2(Math.sin(h - want), Math.cos(h - want)))
  assert.ok(off < 0.05, `pointed ${h.toFixed(2)} rad, wanted ${want.toFixed(2)}`)
})

test('the body stays behind the nose, whichever way it points', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -2.1]) {
    solveLure({ x: 4, y: 1.5, heading, lengthM: LURE_LENGTH_M, t: 0.3, drive: 0.8 })
    const along = (i: number) =>
      (lureX[i]! - 4) * Math.cos(heading) + (lureY[i]! - 1.5) * Math.sin(heading)
    assert.ok(along(LURE_STATIONS - 1) < -LURE_LENGTH_M * 0.8, `tail led the nose at ${heading}`)
  }
})

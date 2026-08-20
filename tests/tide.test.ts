import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TIDE, readTide, readLight, readWind, compass } from '../src/sim/tide.ts'
import { TIDE, TIME_COMPRESSION } from '../src/engine/tuning.ts'

test('the tide cycle is six real minutes, as §13.7 requires', () => {
  assert.equal(TIDE.cycleRealSeconds, 360)
  // The chapter declares 360 in-game minutes; the compression factor has to
  // turn that into the same 6 real minutes or the two figures have drifted.
  assert.equal((360 * 60) / TIME_COMPRESSION, TIDE.cycleRealSeconds)
})

test('a full cycle passes through every tide state in order', () => {
  const seen: string[] = []
  for (let t = 0; t < DEFAULT_TIDE.cycleRealSeconds; t += 2) {
    const s = readTide(t).state
    if (seen[seen.length - 1] !== s) seen.push(s)
  }
  // Starting mid-ebb, one cycle is: run-out, low-slack, run-in, high-slack, run-out.
  assert.deepEqual(seen, ['run-out', 'low-slack', 'run-in', 'high-slack', 'run-out'])
})

test('height and flow agree: the water is falling on a run-out', () => {
  for (let t = 0; t < DEFAULT_TIDE.cycleRealSeconds; t += 3) {
    const a = readTide(t)
    const b = readTide(t + 3)
    if (a.state !== 'run-out') continue
    assert.ok(b.heightM < a.heightM, `run-out at t=${t} but the water rose`)
    assert.ok(a.flow < 0)
  }
})

test('the standalone module and the game agree on the water', () => {
  // §15.1 keeps sim/tide.ts dependency-free so it can be lifted into a shared
  // package, which means it carries its own defaults — and two sources of
  // truth for the same number will drift. They drifted once already.
  assert.equal(DEFAULT_TIDE.rangeM, TIDE.rangeM)
  assert.equal(DEFAULT_TIDE.meanM, TIDE.meanM)
  assert.equal(DEFAULT_TIDE.cycleRealSeconds, TIDE.cycleRealSeconds)
})

test('the tide covers its full declared range', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let t = 0; t < DEFAULT_TIDE.cycleRealSeconds; t += 1) {
    const h = readTide(t).heightM
    lo = Math.min(lo, h)
    hi = Math.max(hi, h)
  }
  assert.ok(Math.abs(hi - lo - TIDE.rangeM) < 0.02, `range was ${hi - lo}`)
  assert.ok(Math.abs((hi + lo) / 2 - TIDE.meanM) < 0.02)
})

test('a session starts on the run-out the flathead unlock needs', () => {
  // §10.2 requires run-out for page p003. A player who opens the game and
  // immediately catches a fish should be on the right tide to earn it.
  assert.equal(readTide(0).state, 'run-out')
})

test('light is dark at night, bright at midday, and continuous', () => {
  assert.ok(readLight(2).night)
  assert.ok(readLight(2).level < 0.15)
  assert.ok(readLight(12).level > 0.95)
  assert.ok(!readLight(12).night)
  let prev = readLight(0).level
  for (let h = 0.05; h <= 24; h += 0.05) {
    const l = readLight(h).level
    assert.ok(Math.abs(l - prev) < 0.05, `light jumped at ${h}: ${prev} -> ${l}`)
    prev = l
  }
})

test('wind gusts around its base without reversing', () => {
  for (let t = 0; t < 400; t += 1) {
    const w = readWind(t, 12, 45)
    assert.ok(w.speedKt >= 0 && w.speedKt < 22, `wind was ${w.speedKt}kt`)
  }
  assert.equal(compass(45), 'NE')
  assert.equal(compass(0), 'N')
  assert.equal(compass(181), 'S')
})

test('readings can be written into a pooled object', () => {
  const a = readTide(90)
  const out = readTide(90, DEFAULT_TIDE, { ...a })
  assert.deepEqual({ ...out }, { ...a })
})

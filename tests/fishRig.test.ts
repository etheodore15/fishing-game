import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FLOATS_PER_VERTEX,
  STATIONS,
  VERTEX_COUNT,
  buildIndices,
  poseFish,
  type FishPose,
} from '../src/art/fishRig.ts'
import type { Species } from '../src/content/schema.ts'

const SPECIES = JSON.parse(
  readFileSync(new URL('../src/content/species/dusky-flathead.json', import.meta.url), 'utf8'),
) as Species

function pose(over: Partial<FishPose> = {}): Float32Array {
  const out = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX)
  poseFish(
    SPECIES,
    {
      x: 3, y: 1.2, heading: Math.PI, lengthM: 0.6, t: 0.8,
      omega: 4, ampScale: 1, turnBias: 0, phase: 0.3, finPhase: 1.1,
      ...over,
    },
    out,
  )
  return out
}

test('the species curves match the rig station count', () => {
  assert.equal(SPECIES.profileCurve.length, STATIONS)
  assert.equal(SPECIES.amplitudeProfile.length, STATIONS)
})

test('every index addresses a real vertex', () => {
  const idx = buildIndices()
  assert.equal(idx.length % 3, 0)
  for (const i of idx) assert.ok(i < VERTEX_COUNT, `index ${i} is out of range`)
})

test('a posed fish produces only finite coordinates', () => {
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
    const v = pose({ heading: h })
    for (let i = 0; i < v.length; i++) assert.ok(Number.isFinite(v[i]!), `NaN at ${i}, heading ${h}`)
  }
})

test('the fish is roughly its stated length', () => {
  const v = pose()
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < VERTEX_COUNT; i++) {
    const x = v[i * FLOATS_PER_VERTEX]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  const span = maxX - minX
  // Body plus tail fan, so a little over the nominal length.
  assert.ok(span > 0.6 && span < 0.78, `a 60cm fish spanned ${span.toFixed(3)}m`)
})

/**
 * The rig is a side view, so it mirrors when the fish turns around. This test
 * exists because it did not, and every fish swimming right rendered belly-up.
 */
test('the dorsal surface is up whichever way the fish swims', () => {
  for (const heading of [0, Math.PI]) {
    const v = pose({ heading, omega: 0, ampScale: 0 })
    // Body vertices alternate top rim (v=-1) and bottom rim (v=+1).
    for (let station = 2; station < STATIONS - 2; station++) {
      const a = station * 2 * FLOATS_PER_VERTEX
      const b = a + FLOATS_PER_VERTEX
      const dorsalY = v[a + 1]!
      const ventralY = v[b + 1]!
      assert.equal(v[a + 3], -1)
      assert.equal(v[b + 3], 1)
      // Screen y runs down, so the dorsal vertex must have the smaller y.
      assert.ok(
        dorsalY < ventralY,
        `heading ${heading}: station ${station} is inverted (${dorsalY} vs ${ventralY})`,
      )
    }
  }
})

test('the swim wave actually moves the tail, and the head barely at all', () => {
  const tailIndex = (STATIONS - 1) * 2 * FLOATS_PER_VERTEX
  const headIndex = 0
  const a = pose({ t: 0 })
  const b = pose({ t: 0.35 })
  const tailMove = Math.hypot(a[tailIndex]! - b[tailIndex]!, a[tailIndex + 1]! - b[tailIndex + 1]!)
  const headMove = Math.hypot(a[headIndex]! - b[headIndex]!, a[headIndex + 1]! - b[headIndex + 1]!)
  assert.ok(tailMove > 0.02, `tail moved only ${tailMove}m`)
  assert.ok(headMove < tailMove * 0.2, `head moved ${headMove}m, tail ${tailMove}m`)
})

test('posing is allocation-free into a caller-owned buffer', () => {
  const buf = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX * 2)
  poseFish(SPECIES, {
    x: 1, y: 1, heading: 0, lengthM: 0.5, t: 0,
    omega: 3, ampScale: 1, turnBias: 0, phase: 0, finPhase: 0,
  }, buf, VERTEX_COUNT)
  // The second fish's slot is written and the first is untouched.
  assert.equal(buf[0], 0)
  assert.notEqual(buf[VERTEX_COUNT * FLOATS_PER_VERTEX], 0)
})

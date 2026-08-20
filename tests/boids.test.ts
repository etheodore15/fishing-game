import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BaitSchool } from '../src/sim/boids.ts'
import { Fish } from '../src/sim/fish.ts'
import { WaterField } from '../src/sim/water.ts'
import type { Species } from '../src/content/schema.ts'
import type { Conditions } from '../src/sim/types.ts'

const SPECIES = JSON.parse(
  readFileSync(new URL('../src/content/species/dusky-flathead.json', import.meta.url), 'utf8'),
) as Species

function harness() {
  const water = new WaterField(1187)
  water.setWorldWidth(14)
  const cond: Conditions = {
    willingness: 1,
    flow: 0,
    lightLevel: 0.5,
    depthAt: (x) => water.depthAt(x),
    bedDepth: (x) => water.bedDepth(x),
    surfaceY: (x, t) => water.surfaceY(x, t),
    surfaceTop: (x) => water.surfaceY(x, 0),
    baitAt: () => 0,
    baitDepthAt: () => 0.6,
  }
  const school = new BaitSchool(300, 5501)
  school.seed(water, cond)
  return { water, cond, school }
}

function settle(school: BaitSchool, water: WaterField, cond: Conditions, predators: Fish[], seconds: number) {
  for (let i = 0; i < seconds * 60; i++) school.update(1 / 60, water, cond, predators)
}

test('a school with no predators does not shower', () => {
  const { water, cond, school } = harness()
  settle(school, water, cond, [], 6)
  assert.ok(school.bustUp < 0.02, `expected calm water, got bustUp=${school.bustUp}`)
  assert.ok(school.surfaceActivity() < 0.01)
})

test('a fish lying still in the school does not scare it', () => {
  // §8.5: an ambush predator on the sand is furniture. If merely existing
  // scattered bait, a bust-up would stop meaning "a fish is feeding here".
  const { water, cond, school } = harness()
  const fish = new Fish(SPECIES, 11, 55)
  fish.x = school.centreX
  fish.y = 0.8
  fish.speed = 0
  settle(school, water, cond, [fish], 5)
  assert.ok(school.bustUp < 0.05, `a stationary fish caused bustUp=${school.bustUp}`)
})

test('a fish driving through the school makes it shower, and it settles again', () => {
  const { water, cond, school } = harness()
  const fish = new Fish(SPECIES, 12, 55)
  settle(school, water, cond, [], 3)
  const calm = school.bustUp

  // Drive a predator up through the school at genuine attack speed.
  fish.x = school.centreX
  fish.y = 1.6
  fish.speed = 2.4
  for (let i = 0; i < 45; i++) {
    fish.y -= 2.4 / 60
    school.update(1 / 60, water, cond, [fish])
  }
  const peak = school.bustUp
  assert.ok(peak > calm + 0.25, `expected a shower, calm=${calm} peak=${peak}`)

  // And with the predator gone it has to settle, or the signal never resets.
  fish.speed = 0
  settle(school, water, cond, [], 6)
  assert.ok(school.bustUp < 0.05, `school never settled: ${school.bustUp}`)
})

test('the bust-up is reported where the predator actually is', () => {
  const { water, cond, school } = harness()
  settle(school, water, cond, [], 3)
  const fish = new Fish(SPECIES, 13, 55)
  fish.x = school.centreX + 0.4
  fish.y = 1.2
  fish.speed = 2.2
  for (let i = 0; i < 40; i++) school.update(1 / 60, water, cond, [fish])
  assert.ok(
    Math.abs(school.bustX - fish.x) < 1.2,
    `bustX=${school.bustX} but the predator is at ${fish.x}`,
  )
})

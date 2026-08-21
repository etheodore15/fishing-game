import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Species } from '../src/content/schema.ts'
import { WORK } from '../src/engine/tuning.ts'
import { Fish } from '../src/sim/fish.ts'
import { Schools } from '../src/sim/school.ts'
import type { Conditions, LureState } from '../src/sim/types.ts'
import { WaterField } from '../src/sim/water.ts'

/**
 * How a species holds together, and how it hunts.
 *
 * Tailor and Australian salmon school, and they hunt by running things down —
 * a lure moving fast is the reason they eat it. A dusky flathead does neither:
 * it lies on the sand on its own and waits for something to come past. None of
 * that was in the water. Every fish picked its own lie and swam to it alone,
 * and the only thing that read the lure's speed was the spook test, so speed
 * could only ever frighten a fish.
 *
 * All three facts are numbers in the species file (§10.1) and nothing here
 * names a species: the flathead is the control, and it is the control because
 * its numbers say so.
 */

const read = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`../src/content/species/${id}.json`, import.meta.url), 'utf8'),
  ) as Species
const FLATHEAD = read('dusky-flathead')
const TAILOR = read('tailor')
const SALMON = read('australian-salmon')

const DT = 1 / 60

function harness() {
  const water = new WaterField(1187)
  water.setWorldWidth(12)
  const cond: Conditions = {
    willingness: 1,
    willingnessFor: () => 1,
    flow: 0,
    lightLevel: 1,
    depthAt: (x) => water.depthAt(x),
    bedDepth: (x) => water.bedDepth(x),
    surfaceY: (x, t) => water.surfaceY(x, t),
    surfaceTop: (x) => water.surfaceY(x, 0),
    baitAt: () => 0,
    baitDepthAt: () => 1.2,
  }
  const lure: LureState = {
    x: 0, y: 0, speed: 0, vx: 0, vy: 0, inWater: false, airborne: false,
    cadence: null, cadenceQuality: 0, cadenceHz: 0, kick: 0,
  }
  return { water, cond, lure, schools: new Schools() }
}

/** A species' worth of fish, scattered — so any school here was formed, not placed. */
function spawn(sp: Species, n = 4): Fish[] {
  const out: Fish[] = []
  for (let i = 0; i < n; i++) {
    const f = new Fish(sp, 7000 + i * 131, 42)
    f.x = 2 + i * 1.9
    f.y = sp.habitat.depthM[0] + (i % 2) * 0.5
    f.heading = i % 2 ? 0 : Math.PI
    out.push(f)
  }
  return out
}

function run(fish: Fish[], seconds: number) {
  const { water, cond, lure, schools } = harness()
  for (let i = 0; i < seconds * 60; i++) {
    schools.observe(fish)
    for (const f of fish) f.update(DT, water, cond, lure, schools)
  }
  return shape(fish)
}

/** Spread from the centre, and how much of one body they swim as. */
function shape(fish: Fish[]) {
  const cx = fish.reduce((a, f) => a + f.x, 0) / fish.length
  const cy = fish.reduce((a, f) => a + f.y, 0) / fish.length
  const spread = Math.sqrt(
    fish.reduce((a, f) => a + (f.x - cx) ** 2 + (f.y - cy) ** 2, 0) / fish.length,
  )
  const hx = fish.reduce((a, f) => a + Math.cos(f.heading), 0) / fish.length
  const hy = fish.reduce((a, f) => a + Math.sin(f.heading), 0) / fish.length
  let closest = Infinity
  for (const a of fish) for (const b of fish) {
    if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y))
  }
  return { spread, alignment: Math.hypot(hx, hy), closest }
}

test('a schooling species gathers, and a solitary one does not', () => {
  const school = run(spawn(TAILOR), 60)
  const alone = run(spawn(FLATHEAD), 60)
  assert.ok(school.spread < 1.0, `the school sat ${school.spread.toFixed(2)}m apart`)
  assert.ok(
    alone.spread > school.spread * 1.8,
    `solitary fish gathered too: ${alone.spread.toFixed(2)}m against a school's ${school.spread.toFixed(2)}m`,
  )
})

test('a school swims as one body', () => {
  const school = run(spawn(SALMON), 60)
  const alone = run(spawn(FLATHEAD), 60)
  assert.ok(school.alignment > 0.75, `the school pointed ${school.alignment.toFixed(2)} of one way`)
  assert.ok(alone.alignment < school.alignment, 'solitary fish should not swim in formation')
})

test('a school keeps its personal space', () => {
  // Otherwise four fish stack into one silhouette and the flat looks emptier
  // than it is.
  const fish = spawn(TAILOR)
  const s = run(fish, 60)
  assert.ok(s.closest > fish[0]!.lengthM, `two fish were ${s.closest.toFixed(2)}m apart`)
})

test('one fish turning on brings the school over, and no further', () => {
  // The rally is how a school is found and why it is hard to leave alone. It
  // must not be how a fish is caught: the lure still has to do that, or the
  // retrieve stops mattering the moment one fish switches on.
  const { water, cond, lure, schools } = harness()
  const fish = spawn(TAILOR)
  for (const f of fish) {
    f.x = 4 + (f.id % 3) * 0.6
    f.y = 1
  }
  // One of them is on something. The rest are not, and cannot see a lure.
  const keen = fish[0]!
  for (let i = 0; i < 60 * 20; i++) {
    keen.interest = 0.9
    schools.observe(fish)
    for (const f of fish) f.update(DT, water, cond, lure, schools)
  }
  const others = fish.slice(1)
  assert.ok(
    others.every((f) => f.interest > WORK.noticeAt),
    `the school ignored one of its own on a fish: ${others.map((f) => f.interest.toFixed(2)).join(', ')}`,
  )
  assert.ok(
    others.every((f) => f.interest <= WORK.schoolCeiling + 1e-6),
    'the school talked itself into a commit with no lure in the water',
  )
  assert.ok(others.every((f) => f.state !== 'commit'))
})

test('a solitary species does not care what the others are doing', () => {
  const { water, cond, lure, schools } = harness()
  const fish = spawn(FLATHEAD)
  for (const f of fish) f.y = 2.5
  const keen = fish[0]!
  for (let i = 0; i < 60 * 20; i++) {
    keen.interest = 0.9
    schools.observe(fish)
    for (const f of fish) f.update(DT, water, cond, lure, schools)
  }
  assert.ok(fish.slice(1).every((f) => f.interest < 0.01), 'a flathead followed the crowd')
})

/**
 * Seconds of its own preferred retrieve, at a given speed, before it commits.
 *
 * Seconds rather than interest, because interest saturates at one: both a
 * crawl and a sprint get a keen fish there eventually, and the whole question
 * is how long it takes. The lure is held on the fish's nose throughout, so
 * this measures the decision and not a footrace.
 */
function secondsToEat(sp: Species, speed: number): number {
  const { water, cond, schools } = harness()
  const fish = [new Fish(sp, 4409, 42)]
  fish[0]!.x = 5
  fish[0]!.y = 1.2
  const lure: LureState = {
    x: 5.3, y: 1.2, speed, vx: -speed, vy: 0, inWater: true, airborne: false,
    cadence: sp.cadence.preferred, cadenceQuality: 1, cadenceHz: 1, kick: 0,
  }
  for (let i = 0; i < 60 * 60; i++) {
    schools.observe(fish)
    fish[0]!.update(DT, water, cond, lure, schools)
    if (fish[0]!.state === 'commit') return i * DT
    lure.x = fish[0]!.x + 0.3
    lure.y = fish[0]!.y
  }
  return Infinity
}

test('speed is what switches a chaser on', () => {
  const crawl = secondsToEat(TAILOR, 0.05)
  const flee = secondsToEat(TAILOR, 1.2)
  assert.ok(flee < crawl / 1.6, `crawled it in ${crawl.toFixed(1)}s, fled it in ${flee.toFixed(1)}s`)
})

test('and means nothing to a fish lying on the sand', () => {
  // Same retrieve, same two speeds, the fish that waits on the bottom for
  // something to come past. It is not a chaser and its file says so.
  const crawl = secondsToEat(FLATHEAD, 0.05)
  const flee = secondsToEat(FLATHEAD, 1.2)
  assert.ok(Math.abs(flee - crawl) < crawl * 0.3, `an ambusher cared: ${crawl.toFixed(1)}s vs ${flee.toFixed(1)}s`)
})

test('a lure that outruns an ambusher is still worth chasing', () => {
  // The same speed, and the same fish's-nose distance, for both. One is being
  // hunted; the other is hunting.
  const spooked = (sp: Species) => {
    const { water, cond, schools } = harness()
    const fish = [new Fish(sp, 55, 42)]
    fish[0]!.x = 5
    fish[0]!.y = 1.2
    const lure: LureState = {
      x: 5.1, y: 1.2, speed: WORK.spookSpeed * 1.6, vx: -1, vy: 0, inWater: true, airborne: false,
      cadence: sp.cadence.preferred, cadenceQuality: 1, cadenceHz: 1, kick: 0,
    }
    for (let i = 0; i < 30; i++) {
      schools.observe(fish)
      fish[0]!.update(DT, water, cond, lure, schools)
      lure.x = fish[0]!.x + 0.1
      lure.y = fish[0]!.y
    }
    return fish[0]!.state === 'spook'
  }
  assert.equal(spooked(FLATHEAD), true, 'an ambusher should be spooked by a lure ripped past its nose')
  assert.equal(spooked(TAILOR), false, 'a chaser should follow it')
})

test('a chaser closes harder than an ambusher', () => {
  const closes = (sp: Species) => {
    const { water, cond, schools } = harness()
    const fish = [new Fish(sp, 77, 42)]
    fish[0]!.x = 5
    fish[0]!.y = 1.2
    fish[0]!.interest = 1
    fish[0]!.setState('commit')
    const lure: LureState = {
      x: 7, y: 1.2, speed: 1, vx: -1, vy: 0, inWater: true, airborne: false,
      cadence: sp.cadence.preferred, cadenceQuality: 1, cadenceHz: 1, kick: 0,
    }
    let top = 0
    for (let i = 0; i < 45; i++) {
      schools.observe(fish)
      fish[0]!.update(DT, water, cond, lure, schools)
      top = Math.max(top, fish[0]!.speed)
    }
    return top
  }
  const chaser = closes(TAILOR)
  const ambusher = closes(FLATHEAD)
  assert.ok(chaser > ambusher * 1.3, `a chaser reached ${chaser.toFixed(2)}m/s, an ambusher ${ambusher.toFixed(2)}`)
})

test('§10.1 — all of it is content, and nothing in the code knows a species', () => {
  for (const sp of [FLATHEAD, TAILOR, SALMON]) {
    assert.ok(sp.swim.schooling >= 0 && sp.swim.schooling <= 1, `${sp.id} schooling`)
    assert.ok(sp.swim.chase >= 0 && sp.swim.chase <= 1, `${sp.id} chase`)
  }
  const src = readFileSync(new URL('../src/sim/fish.ts', import.meta.url), 'utf8')
  const school = readFileSync(new URL('../src/sim/school.ts', import.meta.url), 'utf8')
  for (const id of ['dusky-flathead', 'tailor', 'australian-salmon']) {
    assert.doesNotMatch(src, new RegExp(`['"\`]${id}['"\`]`), `fish.ts names ${id}`)
    assert.doesNotMatch(school, new RegExp(`['"\`]${id}['"\`]`), `school.ts names ${id}`)
  }
})

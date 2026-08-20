import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Fight, type FightOutcome } from '../src/sim/hookup.ts'
import { Fish } from '../src/sim/fish.ts'
import { WaterField } from '../src/sim/water.ts'
import { FIGHT } from '../src/engine/tuning.ts'
import type { Species } from '../src/content/schema.ts'
import type { Conditions } from '../src/sim/types.ts'

const SPECIES = JSON.parse(
  readFileSync(new URL('../src/content/species/dusky-flathead.json', import.meta.url), 'utf8'),
) as Species

const ROD_X = 1.5
const ROD_Y = -1.3

function harness() {
  const water = new WaterField(1187)
  water.setWorldWidth(12.4)
  const cond: Conditions = {
    willingness: 1,
    flow: 0,
    lightLevel: 0.5,
    depthAt: (x) => water.depthAt(x),
    bedDepth: (x) => water.bedDepth(x),
    surfaceY: () => -0.5,
    surfaceTop: () => -0.5,
    baitAt: () => 0,
    baitDepthAt: () => 0.6,
  }
  const events = {
    outcome: null as FightOutcome | null,
    headshakes: 0,
    surges: 0,
    onHeadshake() { this.headshakes += 1 },
    onSurge() { this.surges += 1 },
    onOutcome(o: FightOutcome) { this.outcome = o },
  }
  return { water, cond, events }
}

/** Fight a fish with a fixed drag policy until it resolves or time runs out. */
function play(
  dragPolicy: (f: Fight, elapsed: number) => boolean,
  seconds = 60,
  seed = 12,
): { outcome: FightOutcome | null; fight: Fight; events: ReturnType<typeof harness>['events']; elapsed: number } {
  const { water, cond, events } = harness()
  const fish = new Fish(SPECIES, seed, 52)
  fish.x = 6.5
  fish.y = 2.4
  const fight = new Fight()
  fight.begin(fish, 5.5)

  let elapsed = 0
  for (let i = 0; i < seconds * 60 && !events.outcome; i++) {
    elapsed += 1 / 60
    fight.step(1 / 60, dragPolicy(fight, elapsed), ROD_X, ROD_Y, water, cond, events)
  }
  return { outcome: events.outcome, fight, events, elapsed }
}

test('holding the drag flat out parts the line', () => {
  // §6.4: tension above 0.95 for more than 0.4s. A player who never lets go
  // should lose the line, and lose it for a reason they can see on the rod.
  const { outcome, elapsed } = play(() => true)
  assert.equal(outcome, 'line-break')
  assert.ok(elapsed > 0.4, 'the line parted before it could possibly have loaded up')
})

test('never touching the drag pulls the hook', () => {
  // §6.4: tension below 0.15 for more than 1.2s.
  const { outcome } = play(() => false)
  assert.equal(outcome, 'hook-pull')
})

test('a fish that reaches structure busts off', () => {
  // A dusky's structureSeek is 0.3, so it only occasionally runs for the racks
  // and light drag usually beats it. This is the fish that always does — the
  // behaviour is schema-driven, so the test changes the data, not the code.
  const reefy: Species = { ...SPECIES, fight: { ...SPECIES.fight, structureSeek: 1 } }
  const { water, cond, events } = harness()
  const fish = new Fish(reefy, 31, 58)
  // Hooked right on the edge of the oyster racks, which is where the good fish
  // sit and exactly why casting there is a decision.
  fish.x = 6.6
  fish.y = 1.4
  const fight = new Fight()
  fight.begin(fish, 5.5)
  for (let i = 0; i < 90 * 60 && !events.outcome; i++) {
    // Enough drag to keep the hook in, nowhere near enough to stop the fish.
    fight.step(1 / 60, fight.tension < 0.28, ROD_X, ROD_Y, water, cond, events)
  }
  assert.equal(events.outcome, 'bust-off')
  assert.ok(fight.structureProximity <= FIGHT.bustOffRadius)
})

test('a sand drop-off cannot bust a fish off', () => {
  // Only structure with real severity can cut you off (§6.4 "fish reaches
  // structure"). A depth change is not a snag, and if it were, every fight
  // would end the same arbitrary way.
  const water = new WaterField(1187)
  water.setWorldWidth(12.4)
  const nearest = water.nearestStructure(9, 3, WaterField.BUST_SEVERITY)
  assert.equal(nearest?.s.kind, 'oyster-racks')
})

test('working the drag against the fish lands it', () => {
  // The whole bargain of §6.4: hold when the rod is not loaded, ease when it
  // is. A player who reads the bend and works it should get the fish.
  const { outcome, fight, events } = play((f) => f.tension < 0.66, 120)
  assert.equal(outcome, 'landed')
  assert.ok(events.headshakes > 0, 'a whole fight with no head-shake is not a fight')
  assert.ok(fight.hookHold > 0)
})

test('every loss is preceded by a readable warning, not a dice roll', () => {
  // The acceptance criterion is that a loss feels like the player's fault.
  // Mechanically that means: the line only parts after sustained high tension,
  // and the hook only pulls after sustained slack — both visible on the rod
  // for longer than a reaction takes.
  const held = play(() => true)
  assert.ok(held.fight.tension === 0, 'tension should be released on a break')

  // Same fish, same seed, opposite policy: the outcome differs because the
  // player differed, not because the simulation rolled differently.
  const worked = play((f) => f.tension < 0.66, 120)
  assert.notEqual(held.outcome, worked.outcome)
})

test('the same inputs always give the same fight', () => {
  const a = play((f) => f.tension < 0.66, 120, 77)
  const b = play((f) => f.tension < 0.66, 120, 77)
  assert.equal(a.outcome, b.outcome)
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 1e-9)
})

test('stamina falls under pressure and the fish tires', () => {
  const { water, cond, events } = harness()
  const fish = new Fish(SPECIES, 5, 60)
  fish.x = 6.5
  fish.y = 2.4
  const fight = new Fight()
  fight.begin(fish, 5.5)
  const startStamina = fish.stamina
  for (let i = 0; i < 60 * 12 && !events.outcome; i++) {
    fight.step(1 / 60, fight.tension < 0.7, ROD_X, ROD_Y, water, cond, events)
  }
  assert.ok(fish.stamina < startStamina, 'twelve seconds of drag did not tire the fish')
})

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Chapter, Species } from '../src/content/schema.ts'
import { runBite } from '../tools/bite-sim.ts'

/**
 * The roster.
 *
 * Three fish share the flat and work the same bait, and the only thing that
 * decides which one you catch is how you work the lure. That claim is the
 * whole feature, so it is measured rather than asserted: trips are run headless
 * with the real water, the real fish and the real cadence reader, and the
 * tallies below are what actually happened.
 *
 * The chapter's own species is the flathead. The other two are what turns up
 * beside it, which means neither of them may quietly become the easier way to
 * finish the chapter — the unlock rule names a species, and these check it.
 */

const read = <T,>(p: string): T =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as T
const CHAPTER = read<Chapter>('../src/content/chapters/ch1-estuary.json')
const ALL = CHAPTER.species.map((id) => read<Species>(`../src/content/species/${id}.json`))

/** Eight trips is enough for a tally to mean something and still run fast. */
const SEEDS = [4409, 15, 77, 903, 5150, 61, 2024, 8]

const takesIt = (script: 'hop' | 'twitch' | 'steady', over: Record<string, unknown> = {}) =>
  SEEDS.map(
    (seed) => runBite({ hopIntervalSec: 1.2, script, seed, maxCasts: 12, ...over }).species,
  )

const most = (xs: (string | null)[]): string => {
  const tally = new Map<string, number>()
  for (const x of xs) tally.set(x ?? 'nothing', (tally.get(x ?? 'nothing') ?? 0) + 1)
  return [...tally].sort((a, b) => b[1] - a[1])[0]![0]
}

test('every species the chapter names actually exists, and once', () => {
  assert.equal(new Set(ALL.map((s) => s.id)).size, ALL.length)
  for (const s of ALL) assert.equal(CHAPTER.species.includes(s.id), true)
  assert.equal(ALL[0]!.id, 'dusky-flathead', 'the chapter is about the flathead')
})

test('the schema holds for all of them', () => {
  for (const s of ALL) {
    assert.equal(s.profileCurve.length, 14, `${s.id} profile`)
    assert.equal(s.amplitudeProfile.length, 14, `${s.id} amplitude`)
    assert.ok(s.stock >= 1, `${s.id} has no stock`)
    assert.ok(s.size.minCm < s.size.maxCm, `${s.id} size`)
    assert.ok(s.habitat.depthM[0] < s.habitat.depthM[1], `${s.id} depth band`)
    assert.ok(s.conditions.tideStates.length > 0, `${s.id} is never on`)
  }
})

test('the target species outnumbers what turns up beside it', () => {
  const [target, ...bycatch] = ALL
  for (const b of bycatch) assert.ok(target!.stock > b.stock, `${b.id} is not bycatch`)
})

test('each of the three wants a different retrieve', () => {
  assert.equal(new Set(ALL.map((s) => s.cadence.preferred)).size, 3)
})

test('they hold at different depths, so the flat has layers', () => {
  const mid = (s: Species) => (s.habitat.depthM[0] + s.habitat.depthM[1]) / 2
  const flathead = ALL.find((s) => s.id === 'dusky-flathead')!
  for (const s of ALL) {
    if (s.id === flathead.id) continue
    assert.ok(mid(s) < mid(flathead), `${s.id} sits as deep as the flathead`)
    assert.ok(s.swim.ambushBias < flathead.swim.ambushBias, `${s.id} ambushes like a flathead`)
  }
})

test('the retrieve decides which fish you catch', () => {
  // On the tide the chapter opens on. This is the feature, stated as a table.
  assert.equal(most(takesIt('hop')), 'dusky-flathead')
  assert.equal(most(takesIt('twitch')), 'tailor')
})

test('a steady retrieve gets you a salmon when the salmon are on', () => {
  // Which is the run-in, and not the run-out the chapter opens on. When they
  // are switched off the same retrieve gets you a tailor instead, which is a
  // lesson about the tide rather than a failure of the retrieve.
  assert.equal(most(takesIt('steady', { tideShiftSec: 240 })), 'australian-salmon')
})

test('alone, each takes its own retrieve every time', () => {
  for (const s of ALL) {
    const script = s.cadence.preferred
    const hits = takesIt(script, { onlySpecies: s.id, tideShiftSec: 240 }).filter(Boolean).length
    assert.ok(hits >= SEEDS.length - 1, `${s.id} took its own ${script} only ${hits}/${SEEDS.length}`)
  }
})

test('a wrong retrieve is worse, not futile', () => {
  // §13's lesson is that the water rewards being read, not that it locks the
  // door. A tailor is the opportunist of the three and has to prove it.
  const hits = takesIt('hop', { onlySpecies: 'tailor' }).filter(Boolean).length
  assert.ok(hits > 0, 'a tailor would not touch a hopped lure at all')
})

test('the bycatch cannot finish the chapter for you', () => {
  // Every unlock names a species, and it is the chapter's own.
  for (const u of CHAPTER.unlocks) {
    assert.equal(u.require.species, 'dusky-flathead', `${u.pageId} can be unlocked by bycatch`)
  }
})

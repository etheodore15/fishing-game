import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lureOutline } from '../src/art/lureRig.ts'
import type { CadenceKind, Lure } from '../src/content/schema.ts'
import type { CatchRecord, Settings } from '../src/engine/store.ts'
import { firstCatch, tackleFor, unlockLine, unlockedLures } from '../src/sim/tackle.ts'
import { runBite } from '../tools/bite-sim.ts'

/**
 * The tackle box.
 *
 * Choosing a lure and choosing a retrieve are meant to be the same choice made
 * twice: every lure is good at one of the three and poor at another, so the
 * pair is what targets a fish. That is a claim about numbers, so it is
 * measured — the table at the bottom is trips actually run.
 */

const read = <T,>(p: string): T =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as T
const IDS = ['soft-plastic', 'hard-body', 'metal-slug']
const LURES = IDS.map((id) => read<Lure>(`../src/content/lures/${id}.json`))

const caught = (speciesId: string): CatchRecord => ({
  speciesId,
  displayName: speciesId,
  lengthCm: 40,
  weightKg: 1,
  tideState: 'run-out',
  timeLabel: '07:14',
  at: 1,
})

const settings = (lureId: string): Settings => ({
  audio: true,
  tierOverride: null,
  reducedMotion: false,
  guide: 'auto',
  lureId,
})

test('the box starts with one thing in it', () => {
  const box = unlockedLures(LURES, [])
  assert.equal(box.length, 1)
  assert.equal(box[0]!.id, 'soft-plastic')
})

test('the fish you did not mean to catch is the tackle you did not have', () => {
  assert.deepEqual(
    unlockedLures(LURES, [caught('tailor')]).map((l) => l.id),
    ['soft-plastic', 'hard-body'],
  )
  assert.deepEqual(
    unlockedLures(LURES, [caught('tailor'), caught('australian-salmon')]).map((l) => l.id),
    IDS,
  )
})

test('a lure that has not been earned never reaches the water', () => {
  // An old save, a hand-edited one, a lure that moved chapters. The setting is
  // a preference, not permission.
  const tied = tackleFor(LURES, { catchLog: [], settings: settings('metal-slug') })
  assert.equal(tied.id, 'soft-plastic')
  const earned = tackleFor(LURES, { catchLog: [caught('australian-salmon')], settings: settings('metal-slug') })
  assert.equal(earned.id, 'metal-slug')
})

test('every lure is best at one retrieve, and every retrieve has a lure', () => {
  const kinds: CadenceKind[] = ['hop', 'twitch', 'steady']
  const bests = LURES.map((l) => kinds.reduce((a, b) => (l.action[b] > l.action[a] ? b : a)))
  assert.equal(new Set(bests).size, 3, `the box does not cover the three retrieves: ${bests}`)
  for (const l of LURES) {
    const worst = Math.min(...kinds.map((k) => l.action[k]))
    const best = Math.max(...kinds.map((k) => l.action[k]))
    assert.ok(best >= 1, `${l.id} is not actually good at anything`)
    assert.ok(worst <= 0.6, `${l.id} has no weakness, so it is not a choice`)
  }
})

test('they cast, sink and look like three different things', () => {
  assert.equal(new Set(LURES.map((l) => l.form)).size, 3)
  assert.ok(new Set(LURES.map((l) => l.sink)).size === 3, 'two of them sink the same')
  const reaches = LURES.map((l) => l.reach)
  assert.ok(Math.max(...reaches) - Math.min(...reaches) > 0.3, 'they all cast the same distance')
})

test('the silhouettes are drawn, and they differ', () => {
  const paths = LURES.map((l) => lureOutline(l.form))
  for (const d of paths) assert.match(d, /^M[\d.,\s L-]+Z$/)
  assert.equal(new Set(paths).size, 3)
})

test('the right lure for the retrieve is markedly faster', () => {
  // The whole feature, as a measurement. Each cell is sixteen trips on a
  // run-in with the roster on the water; the number is seconds of retrieve to
  // a bite.
  //
  // Sixteen and not eight. Eight was enough to show the shape of the table and
  // not enough to be stable: the closest pair of cells sat about 1.3x apart on
  // that sample and drifted either side of it whenever anything upstream moved
  // the seeds along — the rod's cast stroke, which delays each cast by a fifth
  // of a second, was enough to fail it. The same pair is 1.4x apart here and
  // every other pair is further, which is the claim actually being made.
  const SEEDS = [4409, 15, 77, 903, 5150, 61, 2024, 8, 331, 1207, 99, 45, 7788, 512, 6, 1984]
  const seconds = (lureId: string, script: 'hop' | 'twitch' | 'steady') => {
    const runs = SEEDS.map((seed) =>
      runBite({ hopIntervalSec: 1.2, script, seed, maxCasts: 14, tideShiftSec: 240, lureId }),
    ).filter((r) => r.species)
    assert.ok(runs.length >= SEEDS.length - 1, `${lureId}/${script} raised almost nothing`)
    return runs.reduce((a, r) => a + (r.timeToCommit ?? 0), 0) / runs.length
  }

  const kinds: CadenceKind[] = ['hop', 'twitch', 'steady']
  const table = new Map<string, number>()
  for (const l of LURES) for (const k of kinds) table.set(`${l.id}/${k}`, seconds(l.id, k))
  const at = (id: string, k: CadenceKind) => table.get(`${id}/${k}`)!

  for (const l of LURES) {
    const best = kinds.reduce((a, b) => (l.action[b] > l.action[a] ? b : a))

    // Down the row: with this on, work it the way it wants.
    for (const k of kinds) {
      if (k === best) continue
      assert.ok(
        at(l.id, k) > at(l.id, best) * 1.3,
        `${l.id}: ${best} took ${at(l.id, best).toFixed(1)}s, ${k} took ${at(l.id, k).toFixed(1)}s`,
      )
    }

    // Across the column: for this retrieve, this is the one to tie on.
    for (const other of LURES) {
      if (other.id === l.id) continue
      assert.ok(
        at(other.id, best) > at(l.id, best) * 1.3,
        `${best}: ${l.id} took ${at(l.id, best).toFixed(1)}s, ${other.id} took ${at(other.id, best).toFixed(1)}s`,
      )
    }
  }
})

/**
 * What a first catch is worth, and saying so.
 *
 * Landing a species you have never landed does two things — it opens that
 * fish's page and, for two of the three, drops the lure it is caught on into
 * the box. Both used to happen in silence, so a tailor read as a small
 * flathead rather than as the way the game hands out everything it has.
 */

test('the first of a species is a first; the second is a fish', () => {
  const one = caught('tailor')
  assert.notEqual(firstCatch(LURES, [one], one), null)
  const two = caught('tailor')
  assert.equal(firstCatch(LURES, [one, two], two), null)
})

test('a first names the lure it just put in the box', () => {
  const c = caught('tailor')
  const f = firstCatch(LURES, [c], c)!
  assert.equal(f.lure?.id, 'hard-body')
  assert.match(unlockLine(f), /Hard-Body/)
  assert.match(unlockLine(f), /journal/i)
})

test('a first with no lure behind it still says where the page went', () => {
  const c = caught('dusky-flathead')
  const f = firstCatch(LURES, [c], c)!
  assert.equal(f.lure, null)
  assert.match(unlockLine(f), /journal/i)
  // And does not promise tackle that is not there.
  assert.doesNotMatch(unlockLine(f), /box/i)
})

test('what the card says matches what the box actually does', () => {
  // The line is written from the same rule the box is filled from, so a card
  // cannot name a lure the player has not earned.
  for (const id of ['tailor', 'australian-salmon']) {
    const c = caught(id)
    const f = firstCatch(LURES, [c], c)!
    const box = unlockedLures(LURES, [c]).map((l) => l.id)
    assert.ok(box.includes(f.lure!.id), `${id} named a lure that is not in the box`)
  }
})

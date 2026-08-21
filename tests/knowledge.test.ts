import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { speciesLeaves } from '../src/art/speciesPage.ts'
import type { Chapter, Species } from '../src/content/schema.ts'
import type { CatchRecord } from '../src/engine/store.ts'
import { hintFor, type CoachInput } from '../src/sim/coach.ts'
import { bestOf, knownSpecies, speciesNotes } from '../src/sim/knowledge.ts'

/**
 * What the player knows.
 *
 * A species is known once one has been landed, or once the player has been
 * handed a page about it. Everything downstream reads off that one answer: the
 * journal fills a page in, and the guide will name the fish and what it wants.
 * Before it, the guide is a manual for the player's thumb and nothing more.
 */

const read = <T,>(p: string): T =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as T
const CHAPTER = read<Chapter>('../src/content/chapters/ch1-estuary.json')
const ALL = CHAPTER.species.map((id) => read<Species>(`../src/content/species/${id}.json`))
const FLATHEAD = ALL[0]!
const TAILOR = ALL.find((s) => s.id === 'tailor')!

const caught = (speciesId: string, lengthCm = 40): CatchRecord => ({
  speciesId,
  displayName: speciesId,
  lengthCm,
  weightKg: 1,
  tideState: 'run-out',
  timeLabel: '07:14',
  at: lengthCm,
})

test('nothing is known before anything is caught or given', () => {
  assert.equal(knownSpecies([]).size, 0)
})

test('landing one is knowing one', () => {
  const known = knownSpecies([caught('tailor')])
  assert.equal(known.has('tailor'), true)
  assert.equal(known.has('dusky-flathead'), false)
})

test('a page about a fish is knowledge about that fish', () => {
  // Page one ships restored and is a page about flathead — it says to hop it
  // back slow in as many words — so the chapter's own fish cannot be locked
  // behind catching the chapter's own fish.
  const known = knownSpecies([], ['dusky-flathead', 'none'])
  assert.equal(known.has('dusky-flathead'), true)
  assert.equal(known.has('none'), false)
})

test('the notes say what it wants, where it lives and when it is on', () => {
  const notes = speciesNotes(TAILOR, []).join(' ')
  assert.match(notes, /twitched/i)
  assert.match(notes, /roams/i)
  assert.match(notes, /run-in/i)
  assert.match(notes, /first and last light/i)
})

test('the notes come off the same file the water reads', () => {
  // Otherwise a page can say one thing while the fish does another, which is
  // the exact failure the guide had when it named the wrong species' retrieve.
  for (const sp of ALL) {
    const notes = speciesNotes(sp, []).join(' ')
    const [minD, maxD] = sp.habitat.depthM
    assert.ok(notes.includes(`${minD}-${maxD}m`), `${sp.id} depth`)
    for (const t of sp.conditions.tideStates) {
      assert.ok(notes.includes(t === 'high-slack' ? 'top of the tide' : t === 'low-slack' ? 'bottom of the tide' : t), `${sp.id} ${t}`)
    }
  }
})

test('the notes count what you have caught, and the best of them', () => {
  const one = speciesNotes(FLATHEAD, [caught('dusky-flathead', 44)]).join(' ')
  assert.match(one, /One so far\. 44cm/)
  const many = speciesNotes(FLATHEAD, [caught('dusky-flathead', 44), caught('dusky-flathead', 51)]).join(' ')
  assert.match(many, /2 so far\. Best 51cm/)
  assert.equal(bestOf([caught('dusky-flathead', 44), caught('tailor', 60)], 'dusky-flathead')?.lengthCm, 44)
})

test('a species page is under water until one is landed', () => {
  const [flathead, tailor] = speciesLeaves(ALL, [], new Set(['dusky-flathead']))
  assert.equal(flathead!.locked, false)
  assert.equal(flathead!.damage, 0)
  assert.equal(flathead!.sketch, 'dusky-flathead')
  assert.match(flathead!.body, /hopped/)

  assert.equal(tailor!.locked, true)
  assert.ok(tailor!.damage > 0.5, 'an unknown fish should read as a ruined page')
  assert.equal(tailor!.sketch, 'none')
  assert.equal(tailor!.body, '')
})

test('landing one fills its page in', () => {
  const known = new Set(['dusky-flathead', 'tailor'])
  const tailor = speciesLeaves(ALL, [caught('tailor', 36)], known).find((l) => l.id === 'species-tailor')!
  assert.equal(tailor.locked, false)
  assert.equal(tailor.sketch, 'tailor')
  assert.match(tailor.date, /TAILOR/)
  assert.match(tailor.body, /twitched/)
  assert.match(tailor.body, /36cm/)
})

const base: CoachInput = {
  phase: 'work',
  everCast: true,
  cadence: 'steady',
  preferred: null,
  holding: false,
  sinceGesture: 0,
  attention: 'none',
  attentionSpecies: null,
  tension: 0.5,
  running: false,
}

test('the guide will not tell you what a fish you have never caught wants', () => {
  const h = hintFor(base)
  assert.equal(h?.key, 'unknown-cadence')
  assert.doesNotMatch(h!.text, /hop|twitch|steady/i)
})

test('and does tell you once you have caught one', () => {
  const h = hintFor({ ...base, preferred: 'hop' })
  assert.equal(h?.key, 'to-hop')
  const wrong = hintFor({ ...base, cadence: 'twitch', preferred: 'hop' })
  assert.equal(wrong?.key, 'wrong-cadence')
  assert.match(wrong!.text, /hopping/)
})

test('an unrecognised fish following is a shape in the water', () => {
  const unknown = hintFor({ ...base, attention: 'inspect' })
  assert.match(unknown!.text, /something's following/i)
  const named = hintFor({ ...base, attention: 'inspect', attentionSpecies: 'Tailor' })
  assert.match(named!.text, /a tailor on it/i)
})

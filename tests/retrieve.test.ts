import { strict as assert } from 'node:assert'
import test from 'node:test'
import { hintFor, type CoachInput, type Gesture } from '../src/sim/coach.ts'
import { runBite, type DragPolicy } from '../tools/bite-sim.ts'

/**
 * The retrieve — the one thing a player cannot find on their own.
 *
 * Two halves. The guide has to say the right thing for what the player is
 * actually doing, and the sim underneath has to actually reward doing it.
 */

const base: CoachInput = {
  phase: 'work',
  everCast: true,
  cadence: null,
  preferred: 'hop',
  holding: false,
  sinceGesture: 0,
  attention: 'none',
  attentionSpecies: null,
  tension: 0.5,
  running: false,
}

test('the guide names the cast before anything has been cast', () => {
  const h = hintFor({ ...base, phase: 'read', everCast: false })
  assert.equal(h?.key, 'first-cast')
  assert.match(h!.text, /flick/i)
})

test('a landed lure is told how to be worked', () => {
  assert.equal(hintFor(base)?.key, 'start-retrieve')
})

test('a lure left sitting is called out as sitting', () => {
  const h = hintFor({ ...base, sinceGesture: 4 })
  assert.equal(h?.key, 'dead-lure')
  assert.match(h!.text, /bottom/i)
  // And names the way out of a retrieve, which is the gesture nothing else
  // teaches: a flick during `work` used to be silently dropped.
  assert.match(h!.text, /flick/i)
})

test('a steady retrieve is walked the last step to a hop', () => {
  const h = hintFor({ ...base, cadence: 'steady', holding: true })
  assert.equal(h?.key, 'to-hop')
  assert.match(h!.text, /let go and tap/i)
})

test('the right cadence is confirmed, not corrected', () => {
  const h = hintFor({ ...base, cadence: 'hop' })
  assert.equal(h?.key, 'right-cadence')
  assert.match(h!.text, /hopping/)
})

test('a wrong cadence names the one the species wants', () => {
  const h = hintFor({ ...base, cadence: 'twitch' })
  assert.equal(h?.key, 'wrong-cadence')
  assert.match(h!.text, /hopping/)
})

test('a following fish outranks any advice about cadence', () => {
  // Otherwise the guide invites the player to change what is working.
  const h = hintFor({ ...base, cadence: 'twitch', attention: 'inspect' })
  assert.equal(h?.key, 'following')
})

test('a following fish is named, because three species want three things', () => {
  const h = hintFor({ ...base, attention: 'inspect', attentionSpecies: 'Tailor' })
  assert.match(h!.text, /a tailor on it/i)
  // And still says the one thing worth saying: leave it alone.
  assert.match(h!.text, /change nothing/i)
})

test('the guide shuts up while a fish is committing', () => {
  assert.equal(hintFor({ ...base, cadence: 'hop', attention: 'commit' }), null)
})

test('the guide says nothing while the lure is in the air', () => {
  assert.equal(hintFor({ ...base, phase: 'cast' }), null)
})

test('§6.1 — the guide never advises about the water', () => {
  // Every line the guide can produce, checked against the words it is not
  // allowed to use. Reading the water is the game; naming a gesture is not.
  const forbidden = /\b(tide|run-out|run-in|slack|weed|rack|drop-?off|deep|shallow|dawn|dusk|bait|cast (further|shorter)|aim)\b/i
  const cadences = [null, 'hop', 'twitch', 'steady'] as const
  const attentions = ['none', 'notice', 'inspect', 'commit'] as const
  const phases = ['read', 'cast', 'work', 'fight', 'log'] as const
  for (const phase of phases) {
    for (const cadence of cadences) {
      for (const attention of attentions) {
        for (const sinceGesture of [0, 5]) {
          for (const everCast of [false, true]) {
            const h = hintFor({ ...base, phase, cadence, attention, sinceGesture, everCast })
            if (h) assert.doesNotMatch(h.text, forbidden, `${phase}/${cadence}/${attention}: ${h.text}`)
          }
        }
      }
    }
  }
})

test('the fight asks for a thumb off the glass when the rod is loaded', () => {
  const h = hintFor({ ...base, phase: 'fight', tension: 0.9 })
  assert.equal(h?.key, 'ease-off')
  assert.equal(h?.gesture, 'release')
  // Too much pressure parts the line; it is slack that pulls a hook, and
  // telling the player the wrong one teaches them the wrong reflex.
  assert.match(h!.text, /line/i)
})

test('a running fish is given line, whatever the rod is doing', () => {
  const h = hintFor({ ...base, phase: 'fight', tension: 0.5, running: true })
  assert.equal(h?.key, 'running')
  assert.equal(h?.gesture, 'release')
})

test('slack line asks for the thumb back down', () => {
  const h = hintFor({ ...base, phase: 'fight', tension: 0.1 })
  assert.equal(h?.key, 'tighten')
  assert.equal(h?.gesture, 'press')
})

test('a fight with room in it asks the player to gain line', () => {
  const h = hintFor({ ...base, phase: 'fight', tension: 0.5 })
  assert.equal(h?.key, 'gain')
  assert.equal(h?.gesture, 'press')
})

test('every hint that asks for something names a gesture to draw', () => {
  // The glyph is how the rhythm is taught, so a hint that tells the player to
  // do something without one is a hint that has lost half its meaning.
  const silent = new Set(['noticed', 'following'])
  const drawable: Gesture[] = ['flick', 'press', 'release', 'tap', 'hop']
  const seen = new Set<string>()
  for (const phase of ['read', 'cast', 'work', 'fight'] as const) {
    for (const cadence of [null, 'hop', 'twitch', 'steady'] as const) {
      for (const attention of ['none', 'notice', 'inspect'] as const) {
        for (const tension of [0.1, 0.5, 0.9]) {
          for (const sinceGesture of [0, 5]) {
            const h = hintFor({ ...base, phase, cadence, attention, tension, sinceGesture })
            if (!h || seen.has(h.key)) continue
            seen.add(h.key)
            if (silent.has(h.key)) assert.equal(h.gesture, null, `${h.key} should be silent`)
            else assert.ok(h.gesture && drawable.includes(h.gesture), `${h.key} has no glyph`)
          }
        }
      }
    }
  }
  assert.ok(seen.size >= 9, `only reached ${seen.size} hints`)
})

test('a player watching the rod lands fish; a player mashing it does not', () => {
  // §6.4 asks for losses that are the player's fault. The old numbers made
  // every fight a line-break inside a second, whatever anyone did: a fifty-fish
  // losing streak was the tuning, not the player.
  const rate = (drag: DragPolicy) => {
    const runs = SEEDS.map((seed) => runBite({ hopIntervalSec: 1.2, script: 'hop', drag, seed }).fight)
    const fights = runs.filter((f) => f !== null)
    assert.equal(fights.length, SEEDS.length, 'a fight failed to start')
    return fights.filter((f) => f.outcome === 'landed').length / fights.length
  }
  const watching = rate('read-rod')
  assert.ok(watching > 0.6, `a player watching the rod landed ${(watching * 100).toFixed(0)}%`)
  assert.ok(watching < 1, 'a fight nobody can lose is not a fight')
  assert.equal(rate('mash'), 0, 'mashing the screen blind should not land fish')
  assert.equal(rate('always'), 0, 'a locked drag should part the line')
  assert.equal(rate('never'), 0, 'no pressure at all should pull the hook')
})

test('a locked drag gives the player long enough to see the rod bend', () => {
  // Under half a second of warning is not a decision, it is a coin toss.
  const held = SEEDS.map((seed) => runBite({ hopIntervalSec: 1.2, script: 'hop', drag: 'always', seed }).fight!)
  const mean = held.reduce((a, f) => a + f.seconds, 0) / held.length
  assert.ok(mean > 1.5, `the line parted after ${mean.toFixed(2)}s`)
  assert.ok(held.every((f) => f.outcome === 'line-break'))
})

/** Enough fights that a landing rate is a rate and not an anecdote. */
const SEEDS = [4409, 15, 77, 903, 5150, 61, 2024, 8, 331, 1207, 99, 45, 7788, 512, 6, 1984]

test('the line never contradicts the rod', () => {
  // §8.3 gives the Verlet solve the line's shape and §6.4 gives the fight the
  // tension. They have to describe the same fish: a rod bent double over a
  // bight of line lying on the bottom is two opposite stories at once, and it
  // was what the endgame of every fight looked like — five metres of line
  // strung across a two-metre gap, because nothing bounded the line's length
  // against where the fish had actually got to.
  const frames = SEEDS.slice(0, 8).flatMap(
    (seed) => runBite({ hopIntervalSec: 1.2, script: 'hop', drag: 'read-rod', traceLine: true, seed }).fight?.line ?? [],
  )
  assert.ok(frames.length > 2000, `only ${frames.length} frames of fight`)

  const loaded = frames.filter((f) => f.tension > 0.6)
  const worst = Math.max(...loaded.map((f) => f.sagFrac))
  assert.ok(worst < 0.1, `a rod at over 60% load hung ${(worst * 100).toFixed(0)}% sag in the line`)

  // And the other way: slack has to look slack, or the player cannot see the
  // hook about to drop out.
  const slack = frames.filter((f) => f.tension < 0.3)
  if (slack.length > 30) {
    const mean = slack.reduce((a, f) => a + f.sagFrac, 0) / slack.length
    assert.ok(mean > 0.04, `a slack line hung only ${(mean * 100).toFixed(1)}% sag`)
  }

  // Monotone: every step up in load has to take belly out, never put it in.
  const bands = [0.2, 0.4, 0.6, 0.8].map((lo) => {
    const inBand = frames.filter((f) => f.tension >= lo && f.tension < lo + 0.2)
    return inBand.length ? inBand.reduce((a, f) => a + f.sagFrac, 0) / inBand.length : null
  })
  const measured = bands.filter((b) => b !== null)
  for (let i = 1; i < measured.length; i++) {
    assert.ok(measured[i]! <= measured[i - 1]!, `sag rose with load: ${measured.map((m) => m!.toFixed(3)).join(' → ')}`)
  }
})

test('a hop retrieve gets a bite inside a couple of casts', () => {
  const r = runBite({ hopIntervalSec: 1.2, script: 'hop' })
  assert.notEqual(r.timeToCommit, null, 'no fish committed to a correctly worked lure')
  assert.ok(r.timeToCommit! < 30, `took ${r.timeToCommit}s of retrieve`)
  assert.ok(r.casts <= 4, `took ${r.casts} casts`)
})

test('the wrong cadence still works, just slower', () => {
  // The flat's own fish is the flathead and it wants a hop. A steady retrieve
  // still raises something — three species share this water — but it takes
  // longer to get there. Which of them takes it is tests/species.test.ts.
  const hop = runBite({ hopIntervalSec: 1.2, script: 'hop' })
  const steady = runBite({ hopIntervalSec: 1.2, script: 'steady' })
  assert.notEqual(steady.timeToCommit, null, 'a steady retrieve never raised a fish')
  assert.ok(
    steady.timeToCommit! > hop.timeToCommit!,
    `steady ${steady.timeToCommit}s should be slower than hop ${hop.timeToCommit}s`,
  )
})

test('a flick during the retrieve casts again instead of being swallowed', () => {
  // The soft-lock this fixes: the only way out of `work` was to work the lure
  // home, so a player who had not found the retrieve could cast a hundred
  // times and have none of them happen.
  const r = runBite({ hopIntervalSec: 1.2, script: 'flick-spam', maxCasts: 6 })
  assert.ok(r.casts >= 5, `only ${r.casts} of the flicks became casts`)
})

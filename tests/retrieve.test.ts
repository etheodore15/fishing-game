import { strict as assert } from 'node:assert'
import test from 'node:test'
import { hintFor, type CoachInput } from '../src/sim/coach.ts'
import { runBite } from '../tools/bite-sim.ts'

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

test('a hop retrieve gets a bite inside a couple of casts', () => {
  const r = runBite({ hopIntervalSec: 1.2, script: 'hop' })
  assert.notEqual(r.timeToCommit, null, 'no fish committed to a correctly worked lure')
  assert.ok(r.timeToCommit! < 30, `took ${r.timeToCommit}s of retrieve`)
  assert.ok(r.casts <= 4, `took ${r.casts} casts`)
})

test('the wrong cadence still works, just slower', () => {
  // The species wants a hop; a steady retrieve is meant to be worse, not futile.
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

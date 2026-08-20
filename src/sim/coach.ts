import type { CadenceKind } from '../content/schema.ts'
import type { Phase } from '../engine/store.ts'

/**
 * The guide (§6.1 carve-out).
 *
 * §6.1 forbids a bite indicator and forbids advice about the water — where the
 * fish are, when they are on, which tide to fish. None of that is here and none
 * of it may be added: reading the water is the game.
 *
 * What is here is the gesture vocabulary. The retrieve is a hold, a release and
 * a tap, in that order, within a third of a second — nothing on screen says so,
 * and a player who has not been told simply cannot find it. That is not
 * difficulty, it is a missing manual. A hundred casts without a follow is the
 * shape it takes, because a lure the player cannot work is a lure no fish will
 * ever look at.
 *
 * So the guide names the gesture, confirms when the player has found it, and
 * says when a fish is interested — which the player can already see, and which
 * matters here only as confirmation that what they just did was right. It never
 * says where to cast or when to fish.
 *
 * Pure, and separated from the UI, because the interesting question — does the
 * advice match what the player is actually doing — is a table of inputs and
 * expected strings.
 */

/** What the nearest fish is doing about the lure. */
export type Attention = 'none' | 'notice' | 'inspect' | 'commit'

export interface CoachInput {
  phase: Phase
  /** Has the player cast at all this session? */
  everCast: boolean
  /** The retrieve the cadence reader is currently seeing. */
  cadence: CadenceKind | null
  /** What the species actually wants. */
  preferred: CadenceKind
  /** True while the player's thumb is down. */
  holding: boolean
  /** Seconds since the player last did anything during the retrieve. */
  sinceGesture: number
  attention: Attention
}

export interface Hint {
  /** Stable across re-renders of the same advice, so it does not re-animate. */
  key: string
  text: string
}

const CADENCE_NAME: Record<CadenceKind, string> = {
  hop: 'hopping',
  twitch: 'twitching',
  steady: 'a steady swim',
}

/**
 * The one line worth saying right now, or nothing.
 *
 * Ordered by what the player most needs, not by what changed most recently: a
 * fish following the lure outranks a note about cadence, because the note would
 * invite them to change what is already working.
 */
export function hintFor(i: CoachInput): Hint | null {
  switch (i.phase) {
    case 'read':
      return i.everCast
        ? { key: 'recast', text: 'Flick out again.' }
        : { key: 'first-cast', text: 'Flick across the water. The longer the flick, the further it goes.' }

    // In the air. Nothing to do but watch it.
    case 'cast':
      return null

    case 'work':
      return workHint(i)

    case 'fight':
      return { key: 'fight', text: 'Hold to lean on it. Let go when it runs.' }

    // The catch card is already saying everything there is to say.
    case 'log':
      return null

    default:
      return null
  }
}

function workHint(i: CoachInput): Hint | null {
  // It has decided. Anything said now is said over the top of the take.
  if (i.attention === 'commit') return null
  if (i.attention === 'inspect') return { key: 'following', text: "It's following. Change nothing." }
  if (i.attention === 'notice') return { key: 'noticed', text: "Something's had a look." }

  if (i.cadence === i.preferred) {
    return { key: 'right-cadence', text: `That's the one. Keep it ${CADENCE_NAME[i.preferred]}.` }
  }

  if (i.cadence === 'steady') {
    // A held retrieve is one half of a hop. The other half is letting go.
    return { key: 'to-hop', text: 'Now let go and tap. Hold, release, tap — that hops it.' }
  }

  if (i.cadence !== null) {
    return {
      key: 'wrong-cadence',
      text: `Working, but they want ${CADENCE_NAME[i.preferred]}. Hold, release, tap.`,
    }
  }

  // No cadence at all. Either they have just landed it, or it is sitting on the
  // bottom while they wait for something to happen.
  if (i.sinceGesture > 3) {
    return {
      key: 'dead-lure',
      text: "It's on the bottom. Hold to swim it home, or flick to cast again.",
    }
  }
  return { key: 'start-retrieve', text: 'Press and hold anywhere to swim it home.' }
}

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
  /** 0-1 line load during a fight. The same number the rod's bend is drawn from. */
  tension: number
  /** True while a hooked fish is visibly running. */
  running: boolean
}

/**
 * The gesture a hint is asking for, drawn rather than described.
 *
 * "Hold, release, tap" is four words for a rhythm, and a rhythm is the one
 * thing prose is bad at. The glyph shows a thumb doing it, at the speed it
 * wants doing — which is also what makes the fight readable, where the whole
 * skill is knowing which of press and release you are being asked for right
 * now.
 */
export type Gesture = 'flick' | 'press' | 'release' | 'tap' | 'hop'

export interface Hint {
  /** Stable across re-renders of the same advice, so it does not re-animate. */
  key: string
  text: string
  /** null when there is nothing to do with your thumb, only something to see. */
  gesture: Gesture | null
  /**
   * A prompt for right now rather than a note in the margin.
   *
   * The fight changes what it wants of you every second or two, and a line
   * that cross-fades on its way in is a line that is blank at the moment it is
   * needed. Live hints cut straight over.
   */
  live?: true
}

const CADENCE_NAME: Record<CadenceKind, string> = {
  hop: 'hopping',
  twitch: 'twitching',
  steady: 'a steady swim',
}

const GESTURE_FOR: Record<CadenceKind, Gesture> = {
  hop: 'hop',
  twitch: 'tap',
  steady: 'press',
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
        ? { key: 'recast', text: 'Flick out again.', gesture: 'flick' }
        : {
            key: 'first-cast',
            text: 'Flick across the water. The longer the flick, the further it goes.',
            gesture: 'flick',
          }

    // In the air. Nothing to do but watch it.
    case 'cast':
      return null

    case 'work':
      return workHint(i)

    case 'fight':
      return fightHint(i)

    // The catch card is already saying everything there is to say.
    case 'log':
      return null

    default:
      return null
  }
}

/**
 * The fight, moment by moment.
 *
 * Tension is not a new display — it is the number the rod's bend is already
 * drawn from, and §5.5 keeps that bend as the only display of it. What this
 * adds is a reading of the bend in words, for a player who has not yet learned
 * to read it, which is the same favour the guide does everywhere else.
 */
function fightHint(i: CoachInput): Hint | null {
  if (i.tension > 0.78) {
    return { key: 'ease-off', text: "Ease off — you'll part the line.", gesture: 'release', live: true }
  }
  if (i.running) {
    return { key: 'running', text: "It's running. Give it line.", gesture: 'release', live: true }
  }
  if (i.tension < 0.25) {
    return { key: 'tighten', text: 'Slack line. Hold, or it drops the hook.', gesture: 'press', live: true }
  }
  return { key: 'gain', text: 'Hold and gain line on it.', gesture: 'press', live: true }
}

function workHint(i: CoachInput): Hint | null {
  // It has decided. Anything said now is said over the top of the take.
  if (i.attention === 'commit') return null
  if (i.attention === 'inspect') {
    return { key: 'following', text: "It's following. Change nothing.", gesture: null }
  }
  if (i.attention === 'notice') {
    return { key: 'noticed', text: "Something's had a look.", gesture: null }
  }

  if (i.cadence === i.preferred) {
    return {
      key: 'right-cadence',
      text: `That's the one. Keep it ${CADENCE_NAME[i.preferred]}.`,
      gesture: GESTURE_FOR[i.preferred],
    }
  }

  if (i.cadence === 'steady') {
    // A held retrieve is one half of a hop. The other half is letting go.
    return { key: 'to-hop', text: 'Now let go and tap — like this.', gesture: 'hop' }
  }

  if (i.cadence !== null) {
    return {
      key: 'wrong-cadence',
      text: `Working, but they want ${CADENCE_NAME[i.preferred]}.`,
      gesture: GESTURE_FOR[i.preferred],
    }
  }

  // No cadence at all. Either they have just landed it, or it is sitting on the
  // bottom while they wait for something to happen.
  if (i.sinceGesture > 3) {
    return {
      key: 'dead-lure',
      text: "It's on the bottom. Hold to swim it home, or flick to cast again.",
      gesture: 'press',
    }
  }
  return { key: 'start-retrieve', text: 'Press and hold anywhere to swim it home.', gesture: 'press' }
}

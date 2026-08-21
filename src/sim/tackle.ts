import type { Lure } from '../content/schema.ts'
import type { CatchRecord, GameState } from '../engine/store.ts'
import { knownSpecies } from './knowledge.ts'

/**
 * The tackle box.
 *
 * What is in it is earned the same way everything else in this game is earned:
 * by catching the fish it is for. The plastic ships, because the chapter's own
 * page is about hopping a plastic. A tailor puts a hard-body in the box and a
 * salmon puts a metal in it, which is what stops bycatch being a consolation
 * prize — the fish you did not mean to catch is the tackle you did not have.
 *
 * Derived from the catch log rather than stored, for the same reason the
 * species knowledge is: the log is already the record of what the player has
 * done, and a second list would be a second source of truth for one fact.
 */

/**
 * Every lure the player has earned, in the box's own order.
 *
 * The box is passed in rather than imported: content/index.ts pulls in JSON
 * the way the bundler does, which Node will not, and a rule about what a
 * player has earned is exactly the kind of thing that should be checkable
 * without a browser.
 */
export function unlockedLures(all: readonly Lure[], log: GameState['catchLog']): Lure[] {
  const known = knownSpecies(log)
  return all.filter((l) => l.unlockedBy === null || known.has(l.unlockedBy))
}

/**
 * What is actually tied on.
 *
 * Falls back to the plastic rather than trusting the setting: a save that names
 * a lure the player has not earned — an old save, a hand-edited one, a lure
 * that moved chapters — must not put it on the end of the line.
 */
export function tackleFor(
  all: readonly Lure[],
  state: Pick<GameState, 'catchLog' | 'settings'>,
): Lure {
  const box = unlockedLures(all, state.catchLog)
  return box.find((l) => l.id === state.settings.lureId) ?? box[0]!
}

/**
 * What landing this fish has just opened up — or null, if it was not a first.
 *
 * Both consequences of a first catch used to happen in silence: a lure
 * appeared in a box the player had no reason to open, and a page filled itself
 * in at the back of a journal they were not looking at. A player who never
 * opened either simply never learned that catching an unfamiliar fish is how
 * this game gives you anything.
 *
 * Derived from the log rather than remembered at the moment it happens, for
 * the same reason everything else here is: the log already knows whether this
 * is the first of its kind, and a flag saying so is a second thing to keep
 * true.
 */
export interface FirstCatch {
  speciesId: string
  displayName: string
  /** The lure this fish has just put in the box, if it carries one. */
  lure: Lure | null
}

export function firstCatch(
  all: readonly Lure[],
  log: readonly CatchRecord[],
  c: CatchRecord,
): FirstCatch | null {
  let seen = 0
  for (const r of log) if (r.speciesId === c.speciesId) seen += 1
  if (seen !== 1) return null
  return {
    speciesId: c.speciesId,
    displayName: c.displayName,
    lure: all.find((l) => l.unlockedBy === c.speciesId) ?? null,
  }
}

/** The one line the catch card says about it. Written here so it is testable. */
export function unlockLine(f: FirstCatch): string {
  return f.lure
    ? `First one. Its page is in the journal, and a ${f.lure.displayName} is in the box.`
    : 'First one. Its page is in the journal now.'
}

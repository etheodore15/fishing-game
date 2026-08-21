import type { Lure } from '../content/schema.ts'
import type { GameState } from '../engine/store.ts'
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

import type { Chapter, UnlockRule } from '../content/schema.ts'
import type { TideState } from './tide.ts'

/**
 * What finishing a chapter means, and how to say it.
 *
 * The chapter already had a win condition — a dusky over forty-five on the
 * run-out brings the last page back — and no way at all for a player to learn
 * that, notice it happening, or see that they were done. The rules were in a
 * JSON file and the only feedback was a page quietly appearing in a book
 * nobody had been given a reason to open.
 *
 * §6.1 forbids the game advising a player about the water: where the fish are,
 * when they are on, which tide to fish. That is the game. It does not forbid
 * the journal from saying what it is missing — a torn page you are trying to
 * recover is the premise, not a hint — so the goal is stated where the goal
 * lives, in the player's own handwriting, and nowhere else.
 *
 * Pure, so the wording can be checked without a browser.
 */

const TIDE_WORDS: Record<TideState, string> = {
  'run-in': 'the run-in',
  'high-slack': 'the top of the tide',
  'run-out': 'the run-out',
  'low-slack': 'the bottom of the tide',
}

/** The rules for pages this chapter can still bring back. */
export function remainingUnlocks(chapter: Chapter, restored: readonly string[]): UnlockRule[] {
  return chapter.unlocks.filter((u) => !restored.includes(u.pageId))
}

/**
 * Done when every page this chapter knows how to restore has been restored.
 *
 * Not every page: p002 carries no rule at all, because it belongs to a fish
 * that has not been caught yet in any chapter. A page with nothing that brings
 * it back cannot be something the player has failed to do.
 */
export function isChapterComplete(chapter: Chapter, restored: readonly string[]): boolean {
  return remainingUnlocks(chapter, restored).length === 0
}

/**
 * What brings this page back, in the journal's own voice.
 *
 * Deliberately a fragment rather than a sentence with an imperative in it. The
 * page is remembering what it was about; it is not a quest marker telling
 * anybody to go and do something.
 */
export function describeUnlock(rule: UnlockRule, speciesName: string): string {
  const r = rule.require
  const parts: string[] = []

  if (r.minCm !== undefined) parts.push(`a ${speciesName.toLowerCase()} over ${r.minCm}cm`)
  else parts.push(`a ${speciesName.toLowerCase()}`)

  if (r.tideState) parts.push(`on ${TIDE_WORDS[r.tideState]}`)

  if (r.hourWindow) {
    const [lo, hi] = r.hourWindow
    parts.push(`between ${clock(lo)} and ${clock(hi)}`)
  }

  return `${parts.join(', ')}.`
}

function clock(hour: number): string {
  const h = Math.floor(hour) % 24
  const m = Math.round((hour - Math.floor(hour)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

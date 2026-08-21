import type { CatchRecord } from '../engine/store.ts'
import type { PageSource } from './journalPage.ts'

/**
 * The catch record (§5.5, §6.5).
 *
 * Every fish was already being written down — species, length, weight, tide and
 * time, straight into the save — and there was nowhere at all to read it back.
 * A journal you are repairing that does not contain your own fishing is a
 * strange sort of journal.
 *
 * So it goes in the back of the book, on the same paper, in the same hand, made
 * out of the same PageSource the written pages are: the record is not a table
 * bolted onto the journal, it is a page of it. Which also means it is written
 * by the restoration animation's own machinery and needs no new drawing code.
 *
 * Pure, so what the page says can be checked without a browser.
 */

/** Entries per leaf. The ruled lines run out at fifteen, and one is the head. */
const PER_LEAF = 11

/**
 * Short forms, because a line that wraps costs two of the eleven and the
 * record stops being scannable. The written pages have room to say "the top of
 * the tide"; a log does not.
 */
const TIDE_WORDS: Record<string, string> = {
  'run-in': 'run-in',
  'high-slack': 'high slack',
  'run-out': 'run-out',
  'low-slack': 'low slack',
}

/**
 * One line per fish, newest first — which is the order you would flick to.
 *
 * Sentences rather than columns: the hand is proportional, so a column would
 * not line up, and a fishing diary is written anyway.
 */
export function recordLine(c: CatchRecord): string {
  const tide = TIDE_WORDS[c.tideState] ?? c.tideState
  return `${Math.round(c.lengthCm)}cm ${c.displayName.toLowerCase()} — ${tide}, ${c.timeLabel}`
}

/** The two lines at the top of the first leaf: how many, and the best of them. */
export function recordSummary(log: readonly CatchRecord[]): string {
  if (log.length === 0) return 'Nothing in it yet.'
  const best = log.reduce((a, c) => (c.lengthCm > a.lengthCm ? c : a))
  const kinds = new Set(log.map((c) => c.speciesId)).size
  const fish = log.length === 1 ? 'One fish' : `${log.length} fish`
  const species = kinds > 1 ? `, ${kinds} kinds` : ''
  return `${fish}${species}. Best ${Math.round(best.lengthCm)}cm, a ${best.displayName.toLowerCase()}.`
}

/**
 * The record, as journal pages.
 *
 * Always at least one leaf: an empty record is still a page in the book, and a
 * player who has caught nothing should be able to see that the book expects
 * them to.
 */
export function recordLeaves(log: readonly CatchRecord[]): PageSource[] {
  const newest = [...log].sort((a, b) => b.at - a.at)
  const leaves: PageSource[] = []

  for (let i = 0; i < Math.max(1, Math.ceil(newest.length / PER_LEAF)); i++) {
    const slice = newest.slice(i * PER_LEAF, (i + 1) * PER_LEAF)
    const lines = slice.map(recordLine)
    const body = i === 0 ? [recordSummary(log), '', ...lines].join('\n') : lines.join('\n')
    leaves.push({
      id: `record-${i}`,
      // The heading slot, which the page draws larger and above the rules.
      date: i === 0 ? 'CATCH RECORD' : 'CONTINUED',
      title: 'Catch Record',
      // Stable per leaf, so a page does not re-wobble every time it is opened.
      seed: 8100 + i * 31,
      // The back of the book was kept dry. That is the joke and also the point:
      // this is the part the player wrote, so it is the part that is not ruined.
      damage: 0,
      locked: false,
      sketch: 'none',
      body,
    })
  }

  return leaves
}

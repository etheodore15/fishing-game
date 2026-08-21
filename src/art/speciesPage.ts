import type { Species } from '../content/schema.ts'
import type { CatchRecord } from '../engine/store.ts'
import { speciesNotes } from '../sim/knowledge.ts'
import type { PageSource } from './journalPage.ts'

/**
 * The species pages, in the middle of the book.
 *
 * A leaf per fish the chapter holds, and it fills itself in the first time one
 * is landed: the plate, and what it turned out to want. Until then it is a page
 * with the water through it, which is the same thing the chapter's story pages
 * do and means the same thing — there is something here you have not got yet.
 *
 * Built out of PageSource like everything else in the journal, so the plate is
 * the species' own rig and the writing is the same hand. The damage is what
 * carries "not yet": a stained page is already the book's word for it.
 */

/**
 * A leaf per species, in the chapter's own order.
 *
 * `known` is passed in rather than derived here: what a player knows depends
 * on the pages they have back as well as the fish they have landed, and the
 * journal is the thing that holds both. Deriving it twice, from two different
 * halves of the answer, is how the flathead's own page came out blank on a
 * chapter whose first page is about flathead.
 */
export function speciesLeaves(
  all: readonly Species[],
  log: readonly CatchRecord[],
  known: ReadonlySet<string>,
): PageSource[] {
  return all.map((sp, i) => {
    const caught = known.has(sp.id)
    return {
      id: `species-${sp.id}`,
      date: caught ? sp.displayName.toUpperCase() : '',
      title: sp.displayName,
      // Stable per species, so a page does not re-wobble every time it opens.
      seed: 4200 + i * 97,
      // Under water until one is landed. The book already says it this way.
      damage: caught ? 0 : 0.75,
      locked: !caught,
      sketch: caught ? sp.id : 'none',
      body: caught ? speciesNotes(sp, log).join('\n') : '',
    }
  })
}

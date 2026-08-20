import type { Chapter, Species } from './schema.ts'
import { parsePage, type PageSource } from '../art/journalPage.ts'
import flathead from './species/dusky-flathead.json'
import ch1 from './chapters/ch1-estuary.json'
import p001 from './journal/p001.md?raw'
import p002 from './journal/p002.md?raw'
import p003 from './journal/p003.md?raw'

/**
 * Content is bundled, not fetched: the game must cold-start offline in under
 * three seconds (§13 acceptance) and a round trip to the cache for four small
 * JSON files is three round trips too many.
 *
 * The slice ships one species (§13.3). Chapter 2+ species are out of scope.
 */
export const SPECIES: Record<string, Species> = {
  [flathead.id]: flathead as Species,
}

export const CHAPTERS: Record<string, Chapter> = {
  [ch1.id]: ch1 as Chapter,
}

export function species(id: string): Species {
  const s = SPECIES[id]
  if (!s) throw new Error(`unknown species: ${id}`)
  return s
}

export function chapter(id: string): Chapter {
  const c = CHAPTERS[id]
  if (!c) throw new Error(`unknown chapter: ${id}`)
  return c
}

/**
 * Journal pages, prose and all.
 *
 * The markdown is the source of truth for both the writing and the page's
 * physical condition — how stained it is, and the seed that fixes its
 * handwriting and its foxing for good.
 */
export const JOURNAL: Record<string, PageSource> = Object.fromEntries(
  ([['p001', p001], ['p002', p002], ['p003', p003]] as const).map(([id, raw]) => [
    id,
    parsePage(id, raw),
  ]),
)

export function journalPage(id: string): PageSource {
  const p = JOURNAL[id]
  if (!p) throw new Error(`unknown journal page: ${id}`)
  return p
}

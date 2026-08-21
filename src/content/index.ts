import type { Chapter, Lure, Species } from './schema.ts'
import { parsePage, type PageSource } from '../art/journalPage.ts'
import flathead from './species/dusky-flathead.json'
import tailor from './species/tailor.json'
import salmon from './species/australian-salmon.json'
import ch1 from './chapters/ch1-estuary.json'
import softPlastic from './lures/soft-plastic.json'
import hardBody from './lures/hard-body.json'
import metalSlug from './lures/metal-slug.json'
import p001 from './journal/p001.md?raw'
import p002 from './journal/p002.md?raw'
import p003 from './journal/p003.md?raw'

/**
 * Content is bundled, not fetched: the game must cold-start offline in under
 * three seconds (§13 acceptance) and a round trip to the cache for four small
 * JSON files is three round trips too many.
 *
 * The flathead is what the chapter is about. The other two are what turns up
 * beside it: same flat, same bait, different fish. They are content and
 * nothing else — three JSON files and a line in the chapter — because §10.1
 * puts every species through one schema and there is no per-species code
 * anywhere for a new one to need.
 */
export const SPECIES: Record<string, Species> = {
  [flathead.id]: flathead as Species,
  [tailor.id]: tailor as Species,
  [salmon.id]: salmon as Species,
}

export const CHAPTERS: Record<string, Chapter> = {
  [ch1.id]: ch1 as Chapter,
}

/**
 * The tackle box, in the order it fills up.
 *
 * The plastic ships. The other two are earned by landing the fish they are
 * for, which is what makes bycatch worth having: a tailor is not a
 * consolation prize, it is the hard-body.
 */
export const LURES: readonly Lure[] = [softPlastic as Lure, hardBody as Lure, metalSlug as Lure]

export function lure(id: string): Lure {
  const l = LURES.find((x) => x.id === id)
  if (!l) throw new Error(`unknown lure: ${id}`)
  return l
}

/** The one every trip starts with. */
export const DEFAULT_LURE = LURES[0]!.id

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

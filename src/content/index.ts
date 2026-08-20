import type { Chapter, Species } from './schema.ts'
import flathead from './species/dusky-flathead.json'
import ch1 from './chapters/ch1-estuary.json'

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

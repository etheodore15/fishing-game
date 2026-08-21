import type { CadenceKind, Species } from '../content/schema.ts'
import type { CatchRecord } from '../engine/store.ts'
import type { TideState } from './tide.ts'

/**
 * What the player has worked out, and how it is written down.
 *
 * A species is *known* once one has been landed. Nothing else counts: seeing a
 * fish follow the lure tells you there is something out there, and that is a
 * different thing from knowing what it was or what it wanted.
 *
 * This is why it is derived from the catch log rather than stored beside it.
 * The log is already the record of what the player has actually done, it is
 * already saved, and a second list of "things you know" would be a second
 * source of truth for the same fact — the kind that drifts.
 *
 * The consequence runs both ways. The journal fills a page in when you land
 * one. And the guide, which was reciting what every species wanted from the
 * first cast, now only names a fish and its retrieve once you have caught one:
 * the flathead's is in the journal from the start, because page one is about
 * flathead, and the other two have to be met.
 */

const TIDE_WORDS: Record<TideState, string> = {
  'run-in': 'the run-in',
  'high-slack': 'the top of the tide',
  'run-out': 'the run-out',
  'low-slack': 'the bottom of the tide',
}

const CADENCE_WORDS: Record<CadenceKind, string> = {
  hop: 'hopped off the bottom',
  twitch: 'twitched, sharp and erratic',
  steady: 'swum straight, and quick',
}

/**
 * Species the player knows: landed at least one, or handed a page about it.
 *
 * The second half matters. Page one ships restored and is a page about
 * flathead — it says to hop it back slow, in as many words — so a player who
 * has caught nothing at all still knows what a flathead wants, because they
 * have been given the page that says so. Gating that on a catch would have
 * locked the chapter's own fish behind catching the chapter's own fish.
 *
 * @param plates the species plate on each restored page, 'none' where there is none
 */
export function knownSpecies(
  log: readonly CatchRecord[],
  plates: readonly string[] = [],
): Set<string> {
  const out = new Set<string>()
  for (const c of log) out.add(c.speciesId)
  for (const p of plates) if (p && p !== 'none') out.add(p)
  return out
}

/** The biggest one landed, or null. */
export function bestOf(log: readonly CatchRecord[], speciesId: string): CatchRecord | null {
  let best: CatchRecord | null = null
  for (const c of log) {
    if (c.speciesId !== speciesId) continue
    if (!best || c.lengthCm > best.lengthCm) best = c
  }
  return best
}

/**
 * The notes a player would write after catching one, from the species itself.
 *
 * Read off the same JSON the simulation reads, so a page cannot say one thing
 * while the water does another — the whole failure the guide had when it named
 * the chapter's own fish while a tailor was on the lure.
 */
export function speciesNotes(sp: Species, log: readonly CatchRecord[]): string[] {
  const lines: string[] = []

  lines.push(`Wants it ${CADENCE_WORDS[sp.cadence.preferred]}.`)

  const [minD, maxD] = sp.habitat.depthM
  lines.push(
    sp.swim.ambushBias > 0.5
      ? `Sits on the bottom and lets it come. ${minD}-${maxD}m.`
      : `Roams, up off the bottom. ${minD}-${maxD}m.`,
  )

  const tides = sp.conditions.tideStates.map((t) => TIDE_WORDS[t])
  lines.push(`On ${joinWords(tides)}.`)

  const [lo, hi] = sp.conditions.lightPref
  lines.push(lightWords(lo, hi))

  const best = bestOf(log, sp.id)
  const count = log.filter((c) => c.speciesId === sp.id).length
  if (best) {
    lines.push('')
    lines.push(
      count === 1
        ? `One so far. ${Math.round(best.lengthCm)}cm, on ${TIDE_WORDS[best.tideState]}.`
        : `${count} so far. Best ${Math.round(best.lengthCm)}cm, on ${TIDE_WORDS[best.tideState]}.`,
    )
  }

  return lines
}

function joinWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** The light band as a time of day, because nobody reads light as a number. */
function lightWords(lo: number, hi: number): string {
  if (hi <= 0.45) return 'First and last light, and not much in between.'
  if (lo >= 0.35) return 'Wants some sun on the water.'
  return 'Early, and on into the morning.'
}

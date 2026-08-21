import type { TideState } from '../sim/tide.ts'

/** §10.1 — one schema, every species. There is no per-species code anywhere. */
export interface Species {
  id: string
  displayName: string
  /** 14 half-widths along the spine, as a fraction of body length. */
  profileCurve: number[]
  /** 14 swim-wave amplitude multipliers, head to tail. */
  amplitudeProfile: number[]
  swim: { cruiseHz: number; burstHz: number; turnRate: number; ambushBias: number }
  palette: { dorsalIdx: number; ventralIdx: number; iridescence: number }
  markings: { type: 'ocelli' | 'stripes' | 'spots' | 'none'; count: number; seed: number }
  caudal: { fork: number; span: number }
  cadence: { preferred: CadenceKind; tolerance: number }
  fight: { stamina: number; surgePower: number; headshakeFreq: number; structureSeek: number }
  size: { minCm: number; maxCm: number; curve: 'lognormal' | 'uniform' }
  /**
   * How many of this species are on the water at once.
   *
   * Content, not code: the target species should outnumber what turns up
   * beside it, and which is which is a fact about the chapter, not about the
   * simulation.
   */
  stock: number
  habitat: { depthM: [number, number]; substrate: string[] }
  conditions: { tideStates: TideState[]; lightPref: [number, number] }
}

/** §6.3 — the three retrieve gestures a cadence signature can prefer. */
export type CadenceKind = 'twitch' | 'steady' | 'hop'

/** The silhouette families the lure rig knows how to solve. */
export type LureForm = 'paddle' | 'minnow' | 'slug'

/**
 * What is tied on (§10.1's rule, applied to tackle).
 *
 * A lure is content for the same reason a species is: it is a set of numbers
 * about how a thing behaves, and there is no code anywhere that knows the name
 * of one. What makes lure choice a decision rather than a menu is `action` —
 * every lure is good at one retrieve and poor at another, so choosing tackle
 * and choosing a retrieve are the same choice made twice, and neither is worth
 * anything without the other.
 */
export interface Lure {
  id: string
  displayName: string
  /** One line about what it is for, in the journal's voice. */
  note: string
  form: LureForm
  /** Nose to tail, metres. */
  lengthM: number
  /** How well it performs each retrieve. Multiplies the cadence quality. */
  action: Record<CadenceKind, number>
  /** Sink rate, as a multiple of the plastic's. */
  sink: number
  /** Cast distance, as a multiple of the plastic's. */
  reach: number
  /** Species that has to be landed before this is in the box. null ships. */
  unlockedBy: string | null
}

export type StructureKind = 'weed-edge' | 'sand-drop' | 'oyster-racks'

export interface UnlockRule {
  pageId: string
  require: {
    species?: string
    tideState?: TideState
    minCm?: number
    /** In-game hours, inclusive. */
    hourWindow?: [number, number]
  }
}

/** §10.2 — chapters are content, not code. */
export interface Chapter {
  id: string
  title: string
  water: string
  /** "seeded-procedural:<seed>" — the bed is generated, never authored. */
  bathymetry: string
  structures: StructureKind[]
  species: string[]
  tideCycleMinutes: number
  pages: string[]
  startHour: number
  wind: { baseKt: number; baseDirDeg: number }
  unlocks: UnlockRule[]
}

export function bathymetrySeed(spec: string): number {
  const m = /^seeded-procedural:(\d+)$/.exec(spec)
  if (!m) throw new Error(`unsupported bathymetry spec: ${spec}`)
  return Number(m[1])
}

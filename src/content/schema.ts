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
  habitat: { depthM: [number, number]; substrate: string[] }
  conditions: { tideStates: TideState[]; lightPref: [number, number] }
}

/** §6.3 — the three retrieve gestures a cadence signature can prefer. */
export type CadenceKind = 'twitch' | 'steady' | 'hop'

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

import type { CadenceKind } from '../content/schema.ts'

/** What the fish and the bait are allowed to know about the lure. */
export interface LureState {
  x: number
  y: number
  /** Metres per second, magnitude. */
  speed: number
  vx: number
  vy: number
  /** True once the lure is in the water and fishable. */
  inWater: boolean
  /** True while airborne. */
  airborne: boolean
  /** The cadence the player is currently working, measured over a window. */
  cadence: CadenceKind | null
  /** 0-1, how cleanly that cadence is being held. */
  cadenceQuality: number
  /** Beats per second of the current retrieve, for the spook test. */
  cadenceHz: number
}

/** Live conditions, read by every sub-simulation. */
export interface Conditions {
  /** 0-1, how well the water suits this species right now. */
  willingness: number
  /** -1 full ebb to +1 full flood. */
  flow: number
  /** 0-1. */
  lightLevel: number
  /** Depth of water over the bed, live, at a given x. */
  depthAt(x: number): number
  bedDepth(x: number): number
  surfaceY(x: number, t: number): number
  /** 0-1 bait density at a world x. Predators hunt on this. */
  baitAt(x: number): number
  /** Depth of the densest bait near a world x, metres. */
  baitDepthAt(x: number): number
}

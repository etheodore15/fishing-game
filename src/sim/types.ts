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
  /**
   * 0-1, decaying. A twitch or a hop kicks the tail over; this is what the rig
   * reads so the plastic answers the player's thumb instead of the other way
   * round.
   */
  kick: number
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
  /**
   * The live water surface at a world x, without needing the clock.
   *
   * Sub-simulations that do not carry sim time still have to know where the
   * top of the water is — a fish clamped to a fixed depth cannot reach a lure
   * floating at the top of the tide, which is exactly the bug this fixes.
   */
  surfaceTop(x: number): number
  /** 0-1 bait density at a world x. Predators hunt on this. */
  baitAt(x: number): number
  /** Depth of the densest bait near a world x, metres. */
  baitDepthAt(x: number): number
}

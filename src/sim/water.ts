import { fbm1, smoothstep } from '../art/noise.ts'
import type { StructureKind } from '../content/schema.ts'

/**
 * The CPU half of the water.
 *
 * The GPU owns how the water *looks*; this owns where it *is* — the surface a
 * lure floats on, the bed a flathead lies on, the oyster racks that take a fish
 * off you. The wave constants below are mirrored in render/shaders/surface.frag
 * and must be changed together.
 */

const BASE_WAVELENGTH = 3.1
const WAVE_LACUNARITY = 1.87
const WAVE_GAIN = 0.04
const TAU = Math.PI * 2

export interface Structure {
  kind: StructureKind
  /** World x, metres. */
  x: number
  /** Depth of the top of the structure, metres below mean water. */
  y: number
  /** Effective radius, metres. */
  radius: number
  /** How hard a hooked fish is trying to reach it — racks are worse than weed. */
  severity: number
  /** True if the structure breaks the surface and can snag an airborne lure. */
  overhangs: boolean
}

export class WaterField {
  /** Live wind, set each step by the world. */
  windKt = 10
  windDir = 1
  /** Live current, -1 full ebb to +1 full flood. */
  flow = 0
  /** Tide offset from mean water level, metres. */
  tideOffsetM = 0

  octaves = 3
  readonly structures: Structure[] = []

  private bedSeed = 0
  private worldWidth = 14

  constructor(bedSeed: number) {
    this.bedSeed = bedSeed
  }

  setWorldWidth(m: number): void {
    if (Math.abs(m - this.worldWidth) < 0.01) return
    this.worldWidth = m
    this.layoutStructures()
  }

  get width(): number {
    return this.worldWidth
  }

  private get windScale(): number {
    return Math.min(1, Math.max(0.06, this.windKt / 22))
  }

  /**
   * Surface displacement at world x, metres above mean water level.
   * Same Gerstner solve as the shader, including the three Newton steps.
   */
  surfaceHeight(x: number, t: number): number {
    const ws = this.windScale
    const steep = Math.min(1, ws * 0.85)

    let u = x
    for (let iter = 0; iter < 3; iter++) {
      let dx = 0
      let ddx = 0
      for (let i = 0; i < this.octaves; i++) {
        const wl = BASE_WAVELENGTH / Math.pow(WAVE_LACUNARITY, i)
        const k = TAU / wl
        const amp = ws * WAVE_GAIN * Math.pow(0.56, i) * wl
        const speed = Math.sqrt(9.81 / k)
        const ph = k * u - speed * t * this.windDir + i * 2.399
        const q = steep * amp
        dx += -q * Math.sin(ph)
        ddx += -q * k * Math.cos(ph)
      }
      u -= (u + dx - x) / Math.max(0.25, 1 + ddx)
    }

    let h = 0
    for (let i = 0; i < this.octaves; i++) {
      const wl = BASE_WAVELENGTH / Math.pow(WAVE_LACUNARITY, i)
      const k = TAU / wl
      const amp = ws * WAVE_GAIN * Math.pow(0.56, i) * wl
      const speed = Math.sqrt(9.81 / k)
      h += amp * Math.cos(k * u - speed * t * this.windDir + i * 2.399)
    }
    return h
  }

  /** Water level at x: mean level plus tide plus wave, in world y (down = +). */
  surfaceY(x: number, t: number): number {
    return -this.tideOffsetM - this.surfaceHeight(x, t)
  }

  /**
   * Bed depth at world x, metres below mean water level.
   *
   * "seeded-procedural:1187" (§10.2) — a shallow sand flat that drops away to a
   * channel edge on the right. The drop-off is where the flathead sit, so it is
   * shaped deliberately rather than left to noise alone.
   */
  bedDepth(x: number): number {
    const f = x / Math.max(0.001, this.worldWidth)
    // The flat, then the sand drop into the channel. Depths are chosen so the
    // bed sits low in the frame and the drop-off runs out of the bottom of it —
    // the flat is the stage, the channel is the wing the fish come from.
    const drop = smoothstep(0.58, 0.88, f) * 1.55
    const flat = 2.45 + drop
    // Ripples and a weed hummock or two.
    const ripple = (fbm1(x * 0.62, 4, this.bedSeed) - 0.5) * 0.34
    const hummock = (fbm1(x * 0.17 + 11.3, 2, this.bedSeed + 3) - 0.5) * 0.5
    return Math.max(0.18, flat + ripple + hummock)
  }

  /** Live depth of water over the bed at x, accounting for the tide. */
  depthAt(x: number): number {
    return Math.max(0, this.bedDepth(x) + this.tideOffsetM)
  }

  private layoutStructures(): void {
    const w = this.worldWidth
    this.structures.length = 0

    // The weed edge runs along the inside of the flat.
    this.structures.push({
      kind: 'weed-edge',
      x: w * 0.24,
      y: this.bedDepth(w * 0.24) - 0.18,
      radius: w * 0.10,
      severity: 0.35,
      overhangs: false,
    })
    // The sand drop: the edge of the channel, the whole point of the spot.
    const dropX = w * 0.72
    this.structures.push({
      kind: 'sand-drop',
      x: dropX,
      y: this.bedDepth(dropX) - 0.4,
      radius: w * 0.09,
      severity: 0.15,
      overhangs: false,
    })
    // Oyster racks. These break the surface, snag a bad cast, and cut you off.
    this.structures.push({
      kind: 'oyster-racks',
      x: w * 0.46,
      y: -0.25,
      radius: 0.85,
      severity: 1,
      overhangs: true,
    })
  }

  /** Nearest structure to a point, weighted by how badly a fish wants it. */
  nearestStructure(x: number, y: number): { s: Structure; dist: number } | null {
    let best: Structure | null = null
    let bestD = Infinity
    for (const s of this.structures) {
      const d = Math.hypot(s.x - x, s.y - y) - s.radius
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best ? { s: best, dist: Math.max(0, bestD) } : null
  }

  /** Current velocity at a depth, m/s. Slower near the bed, as it really is. */
  currentAt(depth: number): number {
    const bedDrag = smoothstep(0, 0.6, depth)
    return this.flow * 0.55 * (0.35 + 0.65 * bedDrag)
  }
}

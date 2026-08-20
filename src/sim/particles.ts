import { rng } from '../art/noise.ts'

/**
 * Pooled particles (§8.6).
 *
 * One structure, one shader, every effect: splash, spray, bubble trails, rain,
 * wind-blown drift and headlamp dust are parameters, not classes. The pool is
 * fixed at construction and the oldest particle is recycled when it is full,
 * so emitting never allocates and never fails.
 */

export const KIND = {
  splash: 0,
  spray: 1,
  bubble: 2,
  drift: 3,
  rain: 4,
  dust: 5,
} as const

export type ParticleKind = (typeof KIND)[keyof typeof KIND]

interface KindProfile {
  gravity: number
  drag: number
  /** Multiplier on the wind vector. */
  wind: number
  /** Palette slot to draw in. */
  slot: number
  /** Size in metres. */
  size: number
}

const PROFILES: Record<number, KindProfile> = {
  [KIND.splash]: { gravity: 9.2, drag: 0.7, wind: 0.25, slot: 5, size: 0.035 },
  [KIND.spray]: { gravity: 8.4, drag: 1.5, wind: 0.6, slot: 5, size: 0.022 },
  // Bubbles rise, and slowly.
  [KIND.bubble]: { gravity: -1.4, drag: 3.2, wind: 0, slot: 3, size: 0.018 },
  [KIND.drift]: { gravity: 0.4, drag: 0.9, wind: 1.4, slot: 4, size: 0.014 },
  [KIND.rain]: { gravity: 22, drag: 0.2, wind: 0.8, slot: 3, size: 0.02 },
  [KIND.dust]: { gravity: -0.15, drag: 1.8, wind: 0.5, slot: 5, size: 0.01 },
}

export class ParticleField {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly life: Float32Array
  readonly maxLife: Float32Array
  readonly kind: Uint8Array
  readonly size: Float32Array

  /** Ring cursor. When the pool is full this overwrites the oldest (§8.6). */
  private cursor = 0
  private liveCount = 0
  private readonly rand = rng(1213)

  readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.vx = new Float32Array(capacity)
    this.vy = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.kind = new Uint8Array(capacity)
    this.size = new Float32Array(capacity)
  }

  get live(): number {
    return this.liveCount
  }

  emit(
    kind: ParticleKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    sizeScale = 1,
  ): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.kind[i] = kind
    this.size[i] = PROFILES[kind]!.size * sizeScale
  }

  /** A burst with a spread, which is what most emitters actually want. */
  burst(
    kind: ParticleKind,
    n: number,
    x: number,
    y: number,
    speed: number,
    spread: number,
    direction: number,
    life: number,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = direction + (this.rand() - 0.5) * spread
      const s = speed * (0.35 + this.rand() * 0.9)
      this.emit(
        kind,
        x + (this.rand() - 0.5) * 0.04,
        y + (this.rand() - 0.5) * 0.02,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * (0.6 + this.rand() * 0.8),
        0.6 + this.rand() * 0.9,
      )
    }
  }

  update(dt: number, windX: number, windKt: number, surfaceAt: (x: number) => number): void {
    let live = 0
    const wind = windX * windKt * 0.02
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= dt
      if (this.life[i]! <= 0) continue
      live += 1

      const p = PROFILES[this.kind[i]!]!
      this.vy[i]! += p.gravity * dt
      this.vx[i]! += wind * p.wind * dt
      const damp = 1 - p.drag * dt
      this.vx[i]! *= damp
      this.vy[i]! *= damp
      this.x[i]! += this.vx[i]! * dt
      this.y[i]! += this.vy[i]! * dt

      // Bubbles pop at the surface; spray dies when it falls back into it.
      const surf = surfaceAt(this.x[i]!)
      if (this.kind[i] === KIND.bubble && this.y[i]! <= surf) this.life[i] = 0
      if ((this.kind[i] === KIND.spray || this.kind[i] === KIND.splash) && this.y[i]! > surf + 0.02) {
        this.life[i] = 0
      }
    }
    this.liveCount = live
  }

  slotFor(i: number): number {
    return PROFILES[this.kind[i]!]!.slot
  }

  clear(): void {
    this.life.fill(0)
    this.liveCount = 0
  }
}

import { clamp, rng } from '../art/noise.ts'
import type { Fish } from './fish.ts'
import type { Conditions } from './types.ts'
import type { WaterField } from './water.ts'

/**
 * Bait school (§8.5).
 *
 * Separation, alignment, cohesion, predator avoidance and surface pressure, on
 * a spatial hash, simulated at 30Hz and rendered interpolated.
 *
 * The one rule this file exists to enforce: **bust-ups are never scripted**.
 * There is no "play a shower" call anywhere. If the bait is showering, a
 * predator is genuinely inside the school, because showering is the only thing
 * that can happen when one is. This is the player's primary read signal and it
 * has to be honest or the whole §6.1 design falls over.
 */

const STEP = 1 / 30

const SEPARATION_R = 0.11
const NEIGHBOUR_R = 0.36
const CELL = NEIGHBOUR_R

const MAX_SPEED = 0.85
const PANIC_SPEED = 2.4
const MAX_FORCE = 6.5

/** Distance at which a predator starts to worry the school. */
const PREDATOR_R = 1.5

/** Panic above which an agent is visibly scattering rather than just uneasy. */
const SHOWER_PANIC = 0.25

export class BaitSchool {
  readonly count: number
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  /** Previous step's position, so the renderer can interpolate to 60fps. */
  readonly px: Float32Array
  readonly py: Float32Array
  /** 0-1 panic, per agent. Drives the flash and the render dash length. */
  readonly panic: Float32Array

  /** Coarse density histogram along x, so predators can find the school. */
  private readonly density = new Float32Array(48)
  /** Mean depth per bin, so a predator can aim at the school, not just at x. */
  private readonly depth = new Float32Array(48)

  /** 0-1, how hard the school is showering right now. Emergent, not set. */
  bustUp = 0
  /** Where the disturbance is, world x. Only meaningful while bustUp > 0. */
  bustX = 0

  private accumulator = 0
  /** Singly-linked bucket lists — the spatial hash allocates nothing per step. */
  private readonly next: Int32Array
  private readonly rand: () => number
  private worldW = 14
  private worldH = 5

  constructor(count: number, seed: number) {
    this.count = count
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.vx = new Float32Array(count)
    this.vy = new Float32Array(count)
    this.px = new Float32Array(count)
    this.py = new Float32Array(count)
    this.panic = new Float32Array(count)
    this.rand = rng(seed)
    this.next = new Int32Array(count)
  }

  /** Grid sizing depends on the world, which is not known at construction. */
  private grid: { head: Int32Array; cx: number; cy: number } | null = null

  seed(water: WaterField, cond: Conditions): void {
    this.worldW = water.width
    this.worldH = 5
    const cx = Math.max(1, Math.ceil(this.worldW / CELL))
    const cy = Math.max(1, Math.ceil(this.worldH / CELL))
    this.grid = { head: new Int32Array(cx * cy), cx, cy }

    // Start the school as one loose ball over the flat, as it would be.
    const originX = this.worldW * 0.38
    const originY = Math.max(0.4, cond.bedDepth(originX) * 0.45)
    for (let i = 0; i < this.count; i++) {
      const a = this.rand() * Math.PI * 2
      const r = Math.sqrt(this.rand()) * 1.1
      this.x[i] = clamp(originX + Math.cos(a) * r * 1.6, 0.3, this.worldW - 0.3)
      this.y[i] = clamp(originY + Math.sin(a) * r * 0.6, 0.18, this.worldH - 0.2)
      this.px[i] = this.x[i]!
      this.py[i] = this.y[i]!
      const va = this.rand() * Math.PI * 2
      this.vx[i] = Math.cos(va) * 0.3
      this.vy[i] = Math.sin(va) * 0.12
    }
  }

  /** Fixed 60Hz caller; the school itself only steps at 30Hz (§8.5). */
  update(dt: number, water: WaterField, cond: Conditions, predators: readonly Fish[]): void {
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= STEP && steps < 3) {
      this.step(water, cond, predators)
      this.accumulator -= STEP
      steps += 1
    }
  }

  /** 0-1 blend between the previous and current step, for the renderer. */
  get alpha(): number {
    return clamp(this.accumulator / STEP, 0, 1)
  }

  private rebuildGrid(): void {
    const g = this.grid!
    g.head.fill(-1)
    for (let i = 0; i < this.count; i++) {
      const cx = clamp(Math.floor(this.x[i]! / CELL), 0, g.cx - 1)
      const cy = clamp(Math.floor(this.y[i]! / CELL), 0, g.cy - 1)
      const c = cy * g.cx + cx
      this.next[i] = g.head[c]!
      g.head[c] = i
    }
  }

  private step(water: WaterField, cond: Conditions, predators: readonly Fish[]): void {
    if (!this.grid || this.worldW !== water.width) this.seed(water, cond)
    const g = this.grid!
    this.px.set(this.x)
    this.py.set(this.y)
    this.rebuildGrid()

    const sep2 = SEPARATION_R * SEPARATION_R
    const nei2 = NEIGHBOUR_R * NEIGHBOUR_R
    let totalPanic = 0
    let panicWeightedX = 0
    let showering = 0

    for (let i = 0; i < this.count; i++) {
      const xi = this.x[i]!
      const yi = this.y[i]!

      let sepX = 0
      let sepY = 0
      let aliX = 0
      let aliY = 0
      let cohX = 0
      let cohY = 0
      let neighbours = 0

      const cx = clamp(Math.floor(xi / CELL), 0, g.cx - 1)
      const cy = clamp(Math.floor(yi / CELL), 0, g.cy - 1)
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy
        if (ny < 0 || ny >= g.cy) continue
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox
          if (nx < 0 || nx >= g.cx) continue
          for (let j = g.head[ny * g.cx + nx]!; j !== -1; j = this.next[j]!) {
            if (j === i) continue
            const dx = this.x[j]! - xi
            const dy = this.y[j]! - yi
            const d2 = dx * dx + dy * dy
            if (d2 > nei2 || d2 === 0) continue
            if (d2 < sep2) {
              // Push apart, harder the closer they are.
              const inv = 1 / Math.max(0.02, Math.sqrt(d2))
              sepX -= dx * inv * inv
              sepY -= dy * inv * inv
            }
            aliX += this.vx[j]!
            aliY += this.vy[j]!
            cohX += dx
            cohY += dy
            neighbours += 1
          }
        }
      }

      let ax = sepX * 1.9
      let ay = sepY * 1.9
      if (neighbours > 0) {
        ax += (aliX / neighbours - this.vx[i]!) * 1.3
        ay += (aliY / neighbours - this.vy[i]!) * 1.3
        // Cohesion outweighs separation at range, or the school smears out into
        // a haze instead of holding as a ball you can actually read.
        ax += (cohX / neighbours) * 2.4
        ay += (cohY / neighbours) * 2.4
      }

      // ---- predator avoidance ----
      // This is the only source of panic in the school. Nothing else writes it.
      let panic = 0
      for (const p of predators) {
        if (p.state === 'landed') continue
        const dx = xi - p.x
        const dy = yi - p.y
        const d = Math.hypot(dx, dy)
        if (d > PREDATOR_R || d === 0) continue
        // A fish moving with intent is frightening; one lying on the sand is
        // furniture. Without this an ambush predator scatters the school just
        // by existing, and the bust-up stops meaning anything.
        const menace = clamp(p.speed * 1.5 - 0.12, 0, 3.2)
        if (menace <= 0) continue
        const near = 1 - d / PREDATOR_R
        const force = near * near * menace * 20
        ax += (dx / d) * force
        ay += (dy / d) * force
        panic = Math.max(panic, near * clamp(menace / 1.5, 0, 1))
      }
      this.panic[i] = Math.max(panic, this.panic[i]! - STEP * 1.5)
      totalPanic += this.panic[i]!
      panicWeightedX += this.panic[i]! * xi
      if (this.panic[i]! > SHOWER_PANIC) showering += 1

      // ---- surface pressure ----
      // Bait holds off the surface; a predator underneath can overwhelm that
      // and push it through, which is what a shower actually is.
      const bed = cond.bedDepth(xi)
      const surface = 0.12
      if (yi < surface) ay += (surface - yi) * 26
      if (yi > bed - 0.15) ay -= (yi - (bed - 0.15)) * 26

      // Drift with the tide, and keep off the walls.
      ax += cond.flow * 0.5
      if (xi < 0.6) ax += (0.6 - xi) * 8
      if (xi > this.worldW - 0.6) ax -= (xi - (this.worldW - 0.6)) * 8

      const af = Math.hypot(ax, ay)
      if (af > MAX_FORCE) {
        ax = (ax / af) * MAX_FORCE
        ay = (ay / af) * MAX_FORCE
      }

      let vx = this.vx[i]! + ax * STEP
      let vy = this.vy[i]! + ay * STEP
      const limit = MAX_SPEED + (PANIC_SPEED - MAX_SPEED) * this.panic[i]!
      const sp = Math.hypot(vx, vy)
      if (sp > limit) {
        vx = (vx / sp) * limit
        vy = (vy / sp) * limit
      }
      this.vx[i] = vx
      this.vy[i] = vy
      this.x[i] = clamp(xi + vx * STEP, 0.2, this.worldW - 0.2)
      this.y[i] = clamp(yi + vy * STEP, 0.04, bed - 0.05)
    }

    this.density.fill(0)
    this.depth.fill(0)
    const bins = this.density.length
    for (let i = 0; i < this.count; i++) {
      const b = clamp(Math.floor((this.x[i]! / this.worldW) * bins), 0, bins - 1)
      this.density[b]! += 1
      this.depth[b]! += this.y[i]!
    }
    for (let b = 0; b < bins; b++) {
      if (this.density[b]! > 0) this.depth[b]! /= this.density[b]!
      this.density[b]! /= this.count
    }

    // The bust-up reading is a measurement of the school, not a state of it.
    //
    // It counts the agents actually scattering rather than averaging panic
    // across the whole school: a predator only ever reaches a corner of a big
    // school, and a mean would report a genuine shower as almost nothing. The
    // square root is because a shower reads as "happening" long before most of
    // the school is involved.
    const fraction = showering / this.count
    this.bustUp = clamp(Math.sqrt(fraction) * 1.8, 0, 1)
    this.bustX = totalPanic > 0.001 ? panicWeightedX / totalPanic : this.bustX
  }

  /** 0-1 share of the school within one bin of world x. */
  densityAt(x: number): number {
    const bins = this.density.length
    const b = clamp(Math.floor((x / this.worldW) * bins), 0, bins - 1)
    return this.density[b]! * bins * 0.5
  }

  /** Mean depth of the bait near a world x, metres. */
  depthAt(x: number): number {
    const bins = this.density.length
    const b = clamp(Math.floor((x / this.worldW) * bins), 0, bins - 1)
    return this.density[b]! > 0 ? this.depth[b]! : 0.6
  }

  /** Centre of mass of the school, world x. */
  get centreX(): number {
    let sum = 0
    for (let i = 0; i < this.count; i++) sum += this.x[i]!
    return sum / this.count
  }

  /** How many agents are breaking the surface. Drives spray and foam. */
  surfaceActivity(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) {
      if (this.y[i]! < 0.09 && this.panic[i]! > 0.25) n += 1
    }
    return n / this.count
  }
}

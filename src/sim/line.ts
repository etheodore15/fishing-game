import { clamp, rng } from '../art/noise.ts'

/**
 * The line (§8.3).
 *
 * Verlet integration, 36 segments, 3 constraint iterations per fixed step,
 * with gravity, water drag on the submerged portion and wind on the aerial
 * portion. On a break the constraint at one segment is released and both ends
 * recoil under heavy damping.
 *
 * The Verlet solve owns the line's *shape* — sag, bow, the way a slack line
 * bellies downtide. It does not own tension: that is the fight simulation's
 * (sim/hookup.ts), because tension is a game state the player is reading off
 * the rod, not an emergent property of a rope.
 */

export const SEGMENTS = 36
const POINTS = SEGMENTS + 1
const ITERATIONS = 3

const GRAVITY = 9.81
/** Drag coefficients. Water is far stickier than air, and that is legible. */
const AIR_DRAG = 0.04
const WATER_DRAG = 0.62
/** Wind push per knot, on the aerial portion only. */
const WIND_PER_KT = 0.055

export class FishingLine {
  readonly x = new Float32Array(POINTS)
  readonly y = new Float32Array(POINTS)
  private readonly px = new Float32Array(POINTS)
  private readonly py = new Float32Array(POINTS)

  /** Metres of line between rod tip and lure. */
  lineOut = 4

  /** Segment index whose constraint has been released, or -1. */
  brokenAt = -1
  /** Counts down after a break; while it runs, damping is very high. */
  private recoil = 0

  private readonly rand = rng(3301)

  /** Lay the line out straight between two points. */
  reset(ax: number, ay: number, bx: number, by: number): void {
    this.brokenAt = -1
    this.recoil = 0
    this.lineOut = Math.max(0.4, Math.hypot(bx - ax, by - ay))
    for (let i = 0; i < POINTS; i++) {
      const t = i / SEGMENTS
      this.x[i] = ax + (bx - ax) * t
      this.y[i] = ay + (by - ay) * t
      this.px[i] = this.x[i]!
      this.py[i] = this.y[i]!
    }
  }

  /**
   * Release the line.
   *
   * `where` is roughly how far along the line it parts, 0 at the rod tip and 1
   * at the lure. The default is random, because line parts at its weakest
   * point and where that is is exactly what you do not know until it happens.
   *
   * A cut is different from a break: line dragged across oyster shell goes
   * near the fish, so the angler keeps most of it and the recoil is a slack
   * flop rather than a whip. §6.4 asks the three losses to look different from
   * each other, and this is half of how they do.
   */
  breakLine(where = -1, recoil = 1.4): void {
    if (this.brokenAt >= 0) return
    const t = where < 0 ? this.rand() : clamp(where, 0, 1)
    this.brokenAt = clamp(Math.round(3 + t * (SEGMENTS - 6)), 1, SEGMENTS - 1)
    this.recoil = recoil
  }

  get isBroken(): boolean {
    return this.brokenAt >= 0
  }

  /**
   * One fixed step.
   *
   * `anchor` is the rod tip and `tip` the lure; either may be released, which
   * is what a break and a lost lure look like respectively.
   */
  step(
    dt: number,
    anchorX: number,
    anchorY: number,
    tipX: number,
    tipY: number,
    pinTip: boolean,
    surfaceAt: (x: number) => number,
    windKt: number,
    windDirX: number,
    /** How briskly the line is eased onto the curve its own length implies. */
    settle = 0,
  ): void {
    if (this.recoil > 0) this.recoil -= dt

    const damping = this.recoil > 0 ? 0.62 : 0.994
    const dt2 = dt * dt
    const wind = windKt * WIND_PER_KT * windDirX

    for (let i = 0; i < POINTS; i++) {
      const submerged = this.y[i]! > surfaceAt(this.x[i]!)
      const drag = submerged ? WATER_DRAG : AIR_DRAG
      const ax = submerged ? 0 : wind
      // A wet line is close to neutrally buoyant; a dry one is not.
      const ay = submerged ? GRAVITY * 0.12 : GRAVITY

      const vx = (this.x[i]! - this.px[i]!) * damping * (1 - drag * dt)
      const vy = (this.y[i]! - this.py[i]!) * damping * (1 - drag * dt)
      this.px[i] = this.x[i]!
      this.py[i] = this.y[i]!
      this.x[i]! += vx + ax * dt2
      this.y[i]! += vy + ay * dt2
    }

    const rest = this.lineOut / SEGMENTS
    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Pin the ends first so the constraint pass relaxes toward them.
      this.x[0] = anchorX
      this.y[0] = anchorY
      if (pinTip) {
        this.x[SEGMENTS] = tipX
        this.y[SEGMENTS] = tipY
      }

      for (let s = 0; s < SEGMENTS; s++) {
        if (s === this.brokenAt) continue
        const a = s
        const b = s + 1
        let dx = this.x[b]! - this.x[a]!
        let dy = this.y[b]! - this.y[a]!
        const d = Math.hypot(dx, dy)
        if (d < 1e-6) continue
        // Monofilament stretches a little under load but does not compress —
        // a slack line bellies, it does not push its own segments apart.
        const diff = (d - rest) / d
        if (diff < 0) continue
        const wA = a === 0 ? 0 : 0.5
        const wB = b === SEGMENTS && pinTip ? 0 : 0.5
        const total = wA + wB
        if (total === 0) continue
        dx *= diff
        dy *= diff
        this.x[a]! += dx * (wA / total)
        this.y[a]! += dy * (wA / total)
        this.x[b]! -= dx * (wB / total)
        this.y[b]! -= dy * (wB / total)
      }
    }

    this.x[0] = anchorX
    this.y[0] = anchorY
    if (pinTip) {
      this.x[SEGMENTS] = tipX
      this.y[SEGMENTS] = tipY
    }

    if (settle > 0 && pinTip && this.brokenAt < 0) this.hang(settle, anchorX, anchorY, tipX, tipY)
  }

  /**
   * Hang the slack where the slack should hang.
   *
   * The constraint pass only ever shortens segments that have been stretched;
   * a segment that has gone slack is left exactly where it is. So a line that
   * bellied out and then had the slack taken up keeps its wander — every
   * segment is short enough to satisfy its own constraint while the path as a
   * whole still meanders — and extra iterations do not help, because there is
   * nothing left to violate. Three metres of line strung across a one-metre
   * gap ends up as a bight lying on the bottom while the rod is bent double.
   *
   * So the line is eased toward the curve its own length implies: the chord,
   * plus the sag a uniformly loaded cable of exactly this much excess makes
   * over exactly this span. Nothing here decides how much slack there is —
   * lineOut does, and the fight decides that — this only decides where the
   * slack goes. Eased rather than imposed, so wind, drag and gravity still
   * move the line around on top of it.
   */
  private hang(k: number, ax: number, ay: number, bx: number, by: number): void {
    const span = Math.hypot(bx - ax, by - ay)
    const excess = Math.max(0, this.lineOut - span)
    // Arc length of a parabola of sag h over span L is L(1 + 8h²/3L²); solved
    // for h, that is the depth this much extra line has to hang in.
    const sag = Math.sqrt((3 * excess * Math.max(span, 0.25)) / 8)
    for (let i = 1; i < SEGMENTS; i++) {
      const t = i / SEGMENTS
      // A parabola: nothing at the ends, all of it at mid-span.
      const bow = 4 * t * (1 - t)
      this.x[i]! += (ax + (bx - ax) * t - this.x[i]!) * k
      this.y[i]! += (ay + (by - ay) * t + sag * bow - this.y[i]!) * k
    }
  }

  /**
   * How straight the line is, 0 (bellied right out) to 1 (bar tight).
   *
   * The fight owns the tension number, but the line's own geometry has to agree
   * with it or the rod and the line tell the player two different stories.
   */
  straightness(): number {
    let run = 0
    for (let s = 0; s < SEGMENTS; s++) {
      run += Math.hypot(this.x[s + 1]! - this.x[s]!, this.y[s + 1]! - this.y[s]!)
    }
    const direct = Math.hypot(this.x[SEGMENTS]! - this.x[0]!, this.y[SEGMENTS]! - this.y[0]!)
    return run < 1e-5 ? 0 : clamp(direct / run, 0, 1)
  }
}

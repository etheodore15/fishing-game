import { clamp, lerp } from '../art/noise.ts'

/**
 * The rod (§8.4).
 *
 * **The rod bend is the tension display.** There is no meter, no bar and no
 * number anywhere in this game, and none may be added — a player reads load off
 * a rod exactly as they do on the water, and that reading is the central UI
 * decision of the design. It works in greyscale and it works for a colourblind
 * player, because it is shape, not colour.
 *
 * Two bones drive an IK bend curve; the tip carries a small independent spring
 * so it rings on a head-shake.
 */

export const ROD_SAMPLES = 18

/** Rod length in metres. A 7ft estuary stick. */
export const ROD_LENGTH = 2.1

/**
 * Where the butt sits, in world metres.
 *
 * Off the left edge of the frame and above it: §5.5 draws the rod as a
 * diagonal entering the top-left corner and running down across the waterline,
 * which is the view from beside the angler. The butt is in their hands, out of
 * shot; what the player watches is the top two thirds of the blank.
 */
export const BUTT_X = -0.45

/** Maximum bend at the tip, radians. Any more reads as a broken rod. */
const MAX_BEND = 1.12

/** Fraction of the rod's length at which the two bones meet. */
const JOINT_AT = 0.42

export class Rod {
  /** Sampled rod curve, world metres. Index 0 is the butt. */
  readonly x = new Float32Array(ROD_SAMPLES)
  readonly y = new Float32Array(ROD_SAMPLES)

  /**
   * Where the butt is held, world metres above mean water.
   *
   * Set so the tip rests about 1.3m clear of mean water — comfortably above
   * the top of the tide, which is 0.8m. A rod tip in the water is not a rod.
   */
  buttY = -2.12

  /** Smoothed bend, so the rod loads and unloads rather than snapping. */
  private bend = 0
  /**
   * Base angle, radians from horizontal, positive up. The rod points down and
   * out over the water, so this is negative; bend makes it more so, dropping
   * the tip toward the surface exactly as a loaded rod does.
   */
  private baseAngle = -0.4

  /** Independent tip spring (§8.4), in metres of offset. */
  private springX = 0
  private springY = 0
  private springVX = 0
  private springVY = 0

  get tipX(): number {
    return this.x[ROD_SAMPLES - 1]!
  }

  get tipY(): number {
    return this.y[ROD_SAMPLES - 1]!
  }

  /** Kick the tip. Head-shakes and a line parting both do this. */
  strike(ix: number, iy: number): void {
    this.springVX += ix
    this.springVY += iy
  }

  /**
   * @param tension  0-1 from the fight. Drives the bend, and nothing else does.
   * @param towardX  World x the line is running to, so the rod points at it.
   */
  update(dt: number, tension: number, towardX: number, towardY: number, loaded: boolean): void {
    // The rod itself has inertia: it loads up and springs back rather than
    // tracking tension instantly, which is what makes a surge feel like weight.
    const target = loaded ? clamp(tension, 0, 1) : 0
    const rate = target > this.bend ? 9 : 5.5
    this.bend = lerp(this.bend, target, 1 - Math.exp(-dt * rate))

    // Point the rod where the line goes, but keep it high — you fight a fish
    // with the rod up.
    const dx = towardX - BUTT_X
    const dy = towardY - this.buttY
    const aim = Math.atan2(-dy, dx)
    const want = clamp(lerp(-0.34, aim, 0.42), -1.0, 0.05)
    this.baseAngle = lerp(this.baseAngle, want, 1 - Math.exp(-dt * 3.2))

    // Tip spring: critically-ish damped, tuned to ring for about a third of a
    // second so a head-shake is a distinct event and not a wobble.
    const k = 260
    const c = 13
    this.springVX += (-k * this.springX - c * this.springVX) * dt
    this.springVY += (-k * this.springY - c * this.springVY) * dt
    this.springX += this.springVX * dt
    this.springY += this.springVY * dt

    this.solve()
  }

  /**
   * Two-bone IK, sampled into a bend curve.
   *
   * The butt section is stiff and the tip section does most of the work, which
   * is what gives a loaded rod its characteristic progressive curve rather than
   * the arc of a bent stick.
   */
  private solve(): void {
    const total = MAX_BEND * this.bend
    // Bone 1 takes a fifth of the bend, bone 2 the rest.
    const bone1 = total * 0.2
    const bone2 = total * 0.8

    let px = BUTT_X
    let py = this.buttY
    let angle = this.baseAngle
    this.x[0] = px
    this.y[0] = py

    const step = ROD_LENGTH / (ROD_SAMPLES - 1)
    for (let i = 1; i < ROD_SAMPLES; i++) {
      const s = i / (ROD_SAMPLES - 1)
      // Bend accumulates along each bone, weighted toward the tip within it.
      const inBone1 = Math.min(s, JOINT_AT) / JOINT_AT
      const inBone2 = clamp((s - JOINT_AT) / (1 - JOINT_AT), 0, 1)
      const bendHere = bone1 * inBone1 * inBone1 + bone2 * inBone2 * inBone2
      angle = this.baseAngle - bendHere
      px += Math.cos(angle) * step
      py -= Math.sin(angle) * step
      // The spring only reaches the last third of the blank.
      const springWeight = clamp((s - 0.66) / 0.34, 0, 1)
      this.x[i] = px + this.springX * springWeight
      this.y[i] = py + this.springY * springWeight
    }
  }

  /** 0-1 bend, for the renderer's line-taper and for tests. */
  get load(): number {
    return this.bend
  }
}

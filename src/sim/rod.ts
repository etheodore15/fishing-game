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
 *
 * What the rod does *between* fights matters as much, and for a long time it
 * did nothing: one angle, held in every phase, with the lure leaving the tip
 * the instant the player flicked. Nobody fishes like that. A lure angler holds
 * the rod up and the lure short while they look at the water, loads the blank
 * behind them, unloads it through the cast — the lure leaves *because* the rod
 * straightens — and drops the tip to work the retrieve, lifting it on every
 * hop. So there are three postures and one stroke here, and the stroke is on a
 * clock: the wind-up is real time, and the lure sits on the tip until the rod
 * has finished throwing it.
 *
 * Everything is bounded by the frame. There are two metres of sky above mean
 * water (see render/layers.ts) and the butt is held above and left of the
 * frame, so the rod can only work in a narrow band of angles: high enough that
 * the tip is not in the water at the top of the tide, low enough that it is not
 * off the top of the screen. The wind-up buys its height by dropping the hands
 * rather than by raising the tip, which is both what an angler does and the
 * only thing that fits.
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

/** Where the hands are when the rod is simply being held. */
const BUTT_Y = -2.12

/** Maximum bend at the tip, radians. Any more reads as a broken rod. */
const MAX_BEND = 1.12

/** Fraction of the rod's length at which the two bones meet. */
const JOINT_AT = 0.42

/** What the rod is being asked to do, which is not the same as the trip phase. */
export type RodPose = 'rest' | 'work' | 'fight'

/**
 * The band the tip is allowed to live in, as base angles from horizontal.
 *
 * Set by the frame, not by taste. Above the top of it the tip leaves the
 * screen; below the bottom of it the tip is in the water at the top of the
 * tide. `tests/rod.test.ts` measures both, through a whole cast.
 */
const ANGLE_MAX = -0.05
const ANGLE_MIN = -0.74

/**
 * Held, waiting: tip up, nothing on it but the drop.
 *
 * Not as high as the rod can physically be held. The tip is the thing the
 * player watches and there is only a metre of sky above it; parked at the
 * ceiling it sat in the corner of the frame as a stub, and had nowhere to go
 * on a wind-up. Held here it is clearly a rod held up, and the wind-up has
 * forty centimetres to lift it.
 */
const REST_ANGLE = -0.3
/** Working a lure home: tip down toward the water, watching the line. */
const WORK_ANGLE = -0.5
/** A fish on: rod up, and the bend does the talking. */
const FIGHT_ANGLE = -0.2

/** The stroke, in seconds. Short — a cast is a flick of the wrist. */
const WINDUP_SEC = 0.19
const FORWARD_SEC = 0.12
const FOLLOW_SEC = 0.55

/** Back over the shoulder: the hands drop and the blank comes up behind. */
const WINDUP_ANGLE = -0.1
const WINDUP_BUTT = -1.95
/**
 * Reverse load: the tip is behind the hands and the blank is bent backwards.
 *
 * Fixed, and not scaled by the flick, so the top of the wind-up sits in the
 * same place whatever the player is about to throw. There is a metre of sky
 * above the tip at rest and that is the whole budget; a wind-up that got
 * higher the harder you cast would spend it and put the rod off the top of the
 * screen. Power comes out in the forward stroke, where there is room for it.
 */
const WINDUP_BEND = -0.22
/** Peak forward load, at the moment the lure goes. */
const FORWARD_BEND = 0.72
/** Where the hands finish: up and forward, pointing after the cast. */
const FORWARD_BUTT = -2.12

export class Rod {
  /** Sampled rod curve, world metres. Index 0 is the butt. */
  readonly x = new Float32Array(ROD_SAMPLES)
  readonly y = new Float32Array(ROD_SAMPLES)

  /**
   * Where the butt is held, world metres above mean water.
   *
   * Set so the tip rests about 1.3m clear of mean water — comfortably above
   * the top of the tide, which is 0.8m. A rod tip in the water is not a rod.
   * The cast moves it: the hands drop on the wind-up and come back up through
   * the stroke, which is where the tip's travel comes from.
   */
  buttY = BUTT_Y

  /**
   * Smoothed bend, signed, in units of MAX_BEND.
   *
   * Positive is a rod loaded the way a fish loads one — tip pulled down and
   * out. Negative is the wind-up, which is the same curve mirrored, and the
   * only thing that ever asks for it is a cast.
   */
  private bend = 0
  /**
   * Base angle, radians from horizontal, positive up. The rod points down and
   * out over the water, so this is negative; bend makes it more so, dropping
   * the tip toward the surface exactly as a loaded rod does.
   */
  private baseAngle = REST_ANGLE

  /** Independent tip spring (§8.4), in metres of offset. */
  private springX = 0
  private springY = 0
  private springVX = 0
  private springVY = 0

  /** Seconds into the cast stroke, or -1 when there is no cast happening. */
  private strokeT = -1
  private strokePower = 0
  /** Where the stroke finishes, from how high the player flicked. */
  private strokeAngle = WORK_ANGLE
  /** Set for exactly one update: the frame the lure leaves the tip. */
  private releasedNow = false

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
   * Start a cast.
   *
   * @param power 0-1, the length of the player's flick.
   * @param upness 0-1, how much of it was up the screen rather than across.
   * @returns seconds until the lure leaves the tip, for the trip to hold it.
   */
  beginCast(power: number, upness: number): number {
    this.strokeT = 0
    this.strokePower = clamp(power, 0.15, 1)
    // A flat, hard flick finishes with the tip low and pointing after the
    // lure; a lob finishes higher. Either way inside the band.
    // A hard cast finishes with the blank pointed higher, because a hard cast
    // has more bend in it and the bend is what takes the tip down. Without
    // that, a flat full-power stroke put the tip in the water.
    this.strokeAngle = clamp(
      lerp(-0.5, -0.24, clamp(upness, 0, 1)) + 0.13 * this.strokePower,
      ANGLE_MIN,
      ANGLE_MAX,
    )
    return WINDUP_SEC + FORWARD_SEC
  }

  /** True while the rod still has the lure — the stroke has not let go yet. */
  get holdingCast(): boolean {
    return this.strokeT >= 0 && this.strokeT < WINDUP_SEC + FORWARD_SEC
  }

  /** True for the single update in which the lure leaves the tip. */
  get released(): boolean {
    return this.releasedNow
  }

  /** True while any part of the stroke, follow-through included, is running. */
  get casting(): boolean {
    return this.strokeT >= 0
  }

  /**
   * @param tension 0-1 from the fight. Drives the bend, and nothing else does.
   * @param towardX World x the line is running to, so the rod points at it.
   */
  update(dt: number, tension: number, towardX: number, towardY: number, pose: RodPose): void {
    this.releasedNow = false

    // Where the rod would be if nobody were casting: a posture, and a partial
    // lean toward wherever the line has gone.
    const anchor = pose === 'fight' ? FIGHT_ANGLE : pose === 'work' ? WORK_ANGLE : REST_ANGLE
    // At rest the rod does not chase anything. There is nothing on the end of
    // it but a foot of line, and an angler standing there holds it still.
    const follow = pose === 'fight' ? 0.45 : pose === 'work' ? 0.3 : 0
    const dx = towardX - BUTT_X
    const dy = towardY - this.buttY
    const aim = Math.atan2(-dy, dx)
    const wantAngle = clamp(lerp(anchor, aim, follow), ANGLE_MIN, ANGLE_MAX)

    // The rod itself has inertia: it loads up and springs back rather than
    // tracking tension instantly, which is what makes a surge feel like weight.
    const wantBend = pose === 'rest' ? 0 : clamp(tension, 0, 1)
    const rate = wantBend > this.bend ? 9 : 5.5

    if (this.strokeT >= 0) {
      this.stepStroke(dt, wantAngle, wantBend)
    } else {
      this.bend = lerp(this.bend, wantBend, 1 - Math.exp(-dt * rate))
      this.baseAngle = lerp(this.baseAngle, wantAngle, 1 - Math.exp(-dt * 3.2))
      this.buttY = lerp(this.buttY, BUTT_Y, 1 - Math.exp(-dt * 4))
    }

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
   * The cast, on its own clock.
   *
   * Wind-up, forward stroke, follow-through. The lure leaves at the end of the
   * forward stroke — the moment the blank is at its most loaded and the tip is
   * travelling fastest — and everything after that is the rod recovering,
   * blended back into whatever posture the trip has moved on to.
   */
  private stepStroke(dt: number, wantAngle: number, wantBend: number): void {
    const was = this.strokeT
    this.strokeT += dt
    const t = this.strokeT
    const p = this.strokePower
    const release = WINDUP_SEC + FORWARD_SEC

    if (t < WINDUP_SEC) {
      const u = ease(t / WINDUP_SEC)
      this.baseAngle = lerp(REST_ANGLE, WINDUP_ANGLE, u)
      this.buttY = lerp(BUTT_Y, WINDUP_BUTT, u)
      this.bend = WINDUP_BEND * u
      return
    }

    if (t < release) {
      const u = ease((t - WINDUP_SEC) / FORWARD_SEC)
      this.baseAngle = lerp(WINDUP_ANGLE, this.strokeAngle, u)
      this.buttY = lerp(WINDUP_BUTT, FORWARD_BUTT, u)
      this.bend = lerp(WINDUP_BEND, FORWARD_BEND * p, u)
      return
    }

    if (was < release) {
      // The instant of release. The blank is fully loaded and about to throw
      // itself straight; the tip rings for it.
      this.releasedNow = true
      this.strike(0.05 * p, -0.05 * p)
    }

    // Follow-through: the load falls out of the rod and rings through zero,
    // and the posture underneath takes over as it goes.
    const tau = t - release
    const w = clamp(1 - tau / FOLLOW_SEC, 0, 1)
    const ring = FORWARD_BEND * p * Math.exp(-tau * 8.5) * Math.cos(tau * 19)
    this.bend = lerp(wantBend, ring, w)
    this.baseAngle = lerp(wantAngle, this.strokeAngle, w * w)
    this.buttY = lerp(BUTT_Y, FORWARD_BUTT, w)
    if (tau >= FOLLOW_SEC) this.strokeT = -1
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

  /**
   * 0-1 bend, for the renderer's line-taper and for tests.
   *
   * Magnitude, because the renderer only wants to know how hard the blank is
   * working and a wind-up works it just as hard as a fish does.
   */
  get load(): number {
    return Math.abs(this.bend)
  }
}

/** Smoothstep. A wrist does not start or stop instantly. */
function ease(u: number): number {
  const c = clamp(u, 0, 1)
  return c * c * (3 - 2 * c)
}

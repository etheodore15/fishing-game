import type { LureForm } from '../content/schema.ts'
import { clamp, lerp } from './noise.ts'

/**
 * The lure (§8.2's rig, at a twelfth of the size).
 *
 * A five-inch paddle-tail on a jighead, which is what you throw at a dusky and
 * what the journal's first page is describing. Same idea as the fish rig: a
 * spine, a width profile and a travelling wave, solved every frame rather than
 * played back — so the tail follows what the player's thumb is doing instead
 * of looping an animation next to it.
 *
 * It is drawn small because it is small: about nine screen pixels of body
 * against a fish of thirty. What makes it readable at that size is not detail
 * but motion — the paddle sweeps three or four pixels either side, and it only
 * does that when the lure is actually moving. A lure on the bottom is still,
 * and being able to see that is the point: the whole retrieve is a
 * conversation about whether the thing is working or dead.
 */

/** Nose to the trailing edge of the paddle. */
export const LURE_STATIONS = 10

/**
 * The three silhouettes, and how each of them moves.
 *
 * A soft plastic is a rope with a blade on the end: it flexes down its length
 * and the paddle does the work. A hard-body is a rigid thing on a tow point,
 * so it does not bend at all — it yaws as one piece, which is why the swing
 * runs almost straight from nose to tail. A metal is stiffer again and barely
 * moves; what it does instead is flash, which is the whole reason anyone ties
 * one on.
 *
 * `profile` is half-width per station as a fraction of length; `swing` is how
 * far each station may move sideways; `light` is the base lightness the tackle
 * shader ramps. `sweep` and `beat` are how far and how fast the whole thing
 * works, at rest and flat out.
 */
interface Form {
  profile: number[]
  swing: number[]
  light: number[]
  /** Lateral reach as a fraction of length, from dead to worked. */
  sweep: [number, number]
  /** Beat rate, radians per second, from dead to worked. */
  beat: [number, number]
  /** How much the body brightens as it turns over. Chrome flashes; rubber does not. */
  flash: number
  /** Widest half-width in the profile, for the renderer's pixel floor. */
  maxHalf: number
}

const FORMS: Record<LureForm, Form> = {
  // Nose, the shoulders of the jighead, a taper down the body, a thin wrist,
  // and then the paddle: a blade wider than the wrist it hangs off, which is
  // the whole reason the thing swims.
  paddle: {
    profile: [0.05, 0.09, 0.086, 0.072, 0.058, 0.042, 0.026, 0.016, 0.078, 0.014],
    swing: [0, 0.02, 0.05, 0.1, 0.17, 0.26, 0.38, 0.55, 0.85, 1],
    light: [0.16, 0.2, 0.5, 0.72, 0.86, 0.92, 0.95, 0.95, 1, 1],
    sweep: [0.05, 0.42],
    beat: [5.5, 20],
    flash: 0.18,
    maxHalf: 0.09,
  },
  // A fat fusiform body with a bib under the nose and a small forked tail.
  // Rigid: the swing is near-linear because the whole lure pivots on the tow
  // point rather than bending anywhere along it.
  minnow: {
    profile: [0.03, 0.07, 0.095, 0.1, 0.095, 0.082, 0.062, 0.03, 0.055, 0.012],
    swing: [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.66, 0.72],
    light: [0.3, 0.85, 0.95, 1, 1, 0.95, 0.9, 0.8, 0.75, 0.7],
    sweep: [0.02, 0.26],
    beat: [4, 26],
    flash: 0.3,
    maxHalf: 0.1,
  },
  // A blade. It hardly moves and it is nearly all flash.
  slug: {
    profile: [0.02, 0.05, 0.07, 0.078, 0.078, 0.07, 0.058, 0.042, 0.03, 0.01],
    swing: [0, 0.03, 0.06, 0.09, 0.13, 0.17, 0.22, 0.28, 0.34, 0.4],
    light: [0.7, 0.9, 1, 1, 1, 1, 0.98, 0.95, 0.92, 0.9],
    sweep: [0.01, 0.12],
    beat: [3, 30],
    flash: 0.55,
    maxHalf: 0.078,
  },
}

/** The widest half-width this form carries, for the renderer's pixel floor. */
export function lureMaxHalf(form: LureForm): number {
  return FORMS[form].maxHalf
}

/** Wavelengths held along the body. Less than one: a plastic is not a snake. */
const WAVES = 0.55

export interface LurePose {
  /** Where the line is tied, in world metres. */
  x: number
  y: number
  /** Radians. The direction the nose points. */
  heading: number
  /** Which silhouette to solve. */
  form: LureForm
  lengthM: number
  /** Seconds, for the travelling wave. */
  t: number
  /** 0-1, how hard the tail is working. */
  drive: number
}

/** Solved spine, in world metres. Module-level so a frame allocates nothing. */
export const lureX = new Float32Array(LURE_STATIONS)
export const lureY = new Float32Array(LURE_STATIONS)
/** Half-width at each station, in world metres. */
export const lureHalf = new Float32Array(LURE_STATIONS)
/** 0-1 lightness per station, straight into the tackle shader's ramp. */
export const lureShade = new Float32Array(LURE_STATIONS)

/**
 * Solve the lure for this pose.
 *
 * The body runs backwards from the nose, so station 0 is where the line is
 * tied and the paddle trails behind whichever way it is pointing.
 */
export function solveLure(pose: LurePose): void {
  const f = FORMS[pose.form]
  const L = pose.lengthM
  const drive = clamp(pose.drive, 0, 1)
  const cos = Math.cos(pose.heading)
  const sin = Math.sin(pose.heading)
  // Anything worked harder beats faster as well as wider, the way a real one
  // does when you speed the retrieve up.
  const omega = lerp(f.beat[0], f.beat[1], drive)
  const reach = lerp(f.sweep[0], f.sweep[1], drive)
  const phase = pose.t * omega

  for (let i = 0; i < LURE_STATIONS; i++) {
    const u = i / (LURE_STATIONS - 1)
    const along = -u * L
    const swing = f.swing[i]! * L * reach
    const lateral = swing * Math.sin(phase - u * Math.PI * 2 * WAVES)

    lureX[i] = pose.x + along * cos - lateral * sin
    lureY[i] = pose.y + along * sin + lateral * cos
    lureHalf[i] = f.profile[i]! * L
    // It catches the light as it turns over, which is the one thing about a
    // lure you can actually see from the boat — and most of what a metal is
    // for.
    const turn = Math.abs(Math.cos(phase - u * Math.PI * 2 * WAVES))
    lureShade[i] = Math.min(
      1,
      f.light[i]! * (1 - f.flash + f.flash * (0.4 + 1.6 * f.swing[i]! * drive * turn)),
    )
  }
}

/**
 * Which way the lure is pointing, from how it is moving.
 *
 * Swimming, it points where it is going. Sinking, a jighead goes down nose
 * first and the tail flutters above it, so a lure the player has stopped
 * working stands on its head — which is exactly the picture the journal means
 * by letting it sink to the bottom.
 */
export function lureHeading(vx: number, vy: number, previous: number, dt: number): number {
  const speed = Math.hypot(vx, vy)
  // Below a slow crawl there is no direction of travel worth reading; fall
  // back to nose-down, which is where the lead is.
  const want = speed > 0.18 ? Math.atan2(vy, vx) : Math.PI / 2
  let delta = want - previous
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return previous + delta * (1 - Math.exp(-dt * 9))
}

/**
 * The outline of a lure, as an SVG path in a 100 x 28 box.
 *
 * For the tackle box, which shows the player what they are tying on by drawing
 * the actual thing rather than a picture of one — the same solve the water
 * uses, so what is in the sheet is what goes on the end of the line.
 *
 * Nose at the right, tail to the left, which is the way it swims on the screen.
 */
export function lureOutline(form: LureForm, drive = 0, t = 0.42): string {
  const L = 1
  solveLure({ x: 0, y: 0, heading: Math.PI, form, lengthM: L, t, drive })

  const S = 88
  const px = (i: number) => 6 + lureX[i]! * S
  const py = (i: number) => 14 + lureY[i]! * S

  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i < LURE_STATIONS; i++) {
    const a = i === 0 ? 0 : i - 1
    const b = i === LURE_STATIONS - 1 ? i : i + 1
    const dx = lureX[b]! - lureX[a]!
    const dy = lureY[b]! - lureY[a]!
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * lureHalf[i]! * S
    const ny = (dx / len) * lureHalf[i]! * S
    top.push(`${(px(i) + nx).toFixed(2)},${(py(i) + ny).toFixed(2)}`)
    bottom.push(`${(px(i) - nx).toFixed(2)},${(py(i) - ny).toFixed(2)}`)
  }
  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`
}

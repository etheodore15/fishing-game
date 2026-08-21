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
 * Half-width at each station, as a fraction of the lure's length.
 *
 * Nose, the shoulders of the jighead, a taper down the body, a thin wrist, and
 * then the paddle: a blade wider than the wrist it hangs off, which is the
 * whole reason the thing swims.
 */
const PROFILE = [0.05, 0.09, 0.086, 0.072, 0.058, 0.042, 0.026, 0.016, 0.078, 0.014]

/** How far each station may swing. Nothing at the head, everything at the tail. */
const SWING = [0, 0.02, 0.05, 0.10, 0.17, 0.26, 0.38, 0.55, 0.85, 1]

/**
 * Base lightness at each station.
 *
 * A dark lead head and a pale plastic behind it, which is both what a jighead
 * looks like and what makes the thing visible: the bait school is drawn as
 * pale marks against dark water and the eye is already hunting for them, so a
 * lure drawn the same way is found without being looked for. Drawn dark it
 * vanished into the flat at the size it actually is.
 */
const LIGHT = [0.16, 0.2, 0.5, 0.72, 0.86, 0.92, 0.95, 0.95, 1, 1]

/** Wavelengths held along the body. Less than one: a plastic is not a snake. */
const WAVES = 0.55

/**
 * A six-inch plastic — the big end of what you throw at a dusky, chosen for
 * the same reason you would on the water: it is the one you can see.
 */
export const LURE_LENGTH_M = 0.16

/** The widest half-width in the profile, for the pixel floor below. */
export const LURE_MAX_HALF = 0.09

export interface LurePose {
  /** Where the line is tied, in world metres. */
  x: number
  y: number
  /** Radians. The direction the nose points. */
  heading: number
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
  const L = pose.lengthM
  const drive = clamp(pose.drive, 0, 1)
  const cos = Math.cos(pose.heading)
  const sin = Math.sin(pose.heading)
  // A worked plastic beats faster as well as harder, the way a real one does
  // when you speed the retrieve up.
  const omega = lerp(5.5, 20, drive)
  const phase = pose.t * omega

  for (let i = 0; i < LURE_STATIONS; i++) {
    const u = i / (LURE_STATIONS - 1)
    const along = -u * L
    const swing = SWING[i]! * L * lerp(0.05, 0.42, drive)
    const lateral = swing * Math.sin(phase - u * Math.PI * 2 * WAVES)

    lureX[i] = pose.x + along * cos - lateral * sin
    lureY[i] = pose.y + along * sin + lateral * cos
    lureHalf[i] = PROFILE[i]! * L
    // The paddle catches the light as it turns over, which is the one thing
    // about a plastic you can actually see from the boat.
    const turn = Math.abs(Math.cos(phase - u * Math.PI * 2 * WAVES))
    lureShade[i] = Math.min(1, LIGHT[i]! * (0.82 + 0.18 * SWING[i]! * drive * turn * 2))
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

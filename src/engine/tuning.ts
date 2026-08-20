/**
 * Every hand-feel constant in the game lives here.
 *
 * §12 requires all gesture thresholds in one config file because they will need
 * tuning on real hardware. The fight and cadence constants live here too for the
 * same reason — acceptance criterion "losing a fish feels like the player's
 * fault" is a tuning outcome, not a code outcome.
 */

export const GESTURE = {
  /** Pointer travel (px) before a press stops being a tap. */
  tapSlopPx: 12,
  /** Max duration (ms) for a press to register as a tap/twitch. */
  tapMaxMs: 180,
  /** Press duration (ms) after which a hold begins emitting. */
  holdMinMs: 180,
  /** Minimum flick travel (px) to count as a cast. */
  flickMinPx: 48,
  /** Flick travel (px) that maps to full cast power. */
  flickMaxPx: 420,
  /** A flick must complete within this window (ms) to read as a flick. */
  flickMaxMs: 500,
  /** Velocity samples kept for flick vector estimation. */
  flickSamples: 5,
  /** Sample age (ms) beyond which a sample is dropped from the flick vector. */
  flickSampleMaxAgeMs: 120,
  /** hold → release → hold within this window (ms) reads as a hop. */
  hopGapMaxMs: 320,
} as const

export const CAST = {
  /** Lure launch speed (world units/s) at power 1. */
  maxLaunchSpeed: 15.5,
  minLaunchSpeed: 3.0,
  /** Gravity on the airborne lure (world units/s²). */
  gravity: 9.8,
  /** Wind displacement per unit of wind speed (kt) per second, airborne only. */
  windDriftPerKt: 0.021,
  /** Aerodynamic drag on the lure in flight. */
  airDrag: 0.16,
  /** Radius (world units) around structure within which a landing snags. */
  snagRadius: 0.55,
  /** Probability a cast passing through overhang snags. */
  overhangSnagChance: 0.34,
} as const

export const WORK = {
  /** Interest gained per second when the retrieve cadence matches the species. */
  interestGainPerSec: 0.62,
  /** Interest lost per second on a mismatched cadence. */
  interestDecayPerSec: 0.30,
  /** Interest lost per second when the lure is simply static. */
  interestIdleDecayPerSec: 0.16,
  /** Distance (world units) beyond which a fish cannot perceive the lure. */
  perceptionRadius: 4.2,
  /** Interest threshold to leave cruise for notice. */
  noticeAt: 0.18,
  /** Interest threshold to move from notice to inspect. */
  inspectAt: 0.45,
  /** Interest threshold at which a fish commits to the lure. */
  commitAt: 0.86,
  /** Cadence changes faster than this (Hz) spook a fish at close range. */
  spookCadenceHz: 7.5,
  /** Retrieve speed above which the lure outruns an ambush predator. */
  spookSpeed: 6.0,
  /** Seconds of window over which retrieve cadence is measured. */
  cadenceWindowSec: 2.4,
} as const

export const FIGHT = {
  /** Tension above this for breakSustainSec breaks the line. */
  breakTension: 0.95,
  breakSustainSec: 0.4,
  /** Tension below this for slackSustainSec pulls the hook. */
  slackTension: 0.15,
  slackSustainSec: 1.2,
  /** Distance (world units) at which a fish reaching structure busts off. */
  bustOffRadius: 0.42,
  /** Tension added per second while the drag gesture is held. */
  dragGainPerSec: 1.35,
  /** Tension bled per second with no drag applied. */
  tensionBleedPerSec: 0.85,
  /** Extra tension per unit of fish surge velocity. */
  surgeTensionScale: 0.30,
  /** hookHold lost per second, scaled by tension above hookSafeTension. */
  hookWearPerSec: 0.10,
  hookSafeTension: 0.55,
  /** Extra hookHold lost per head-shake event. */
  headshakeWear: 0.028,
  /** Stamina drained per second at full drag. */
  staminaDrainPerSec: 0.145,
  /** Stamina recovered per second when the player gives slack. */
  staminaRecoverPerSec: 0.045,
  /** Line retrieved (world units/s) when drag is held and the fish is tiring. */
  gainPerSec: 0.95,
  /** Line given (world units/s) during a surge that outmuscles the drag. */
  surgeGivePerSec: 1.6,
  /** Distance to the rod at which the fish is landed. */
  landRadius: 0.9,
} as const

export const TIDE = {
  /** Real seconds per full tide cycle (§13.7 — 6-minute compressed cycle). */
  cycleRealSeconds: 360,
  /** In-game minutes the cycle represents (chapter JSON tideCycleMinutes). */
  cycleGameMinutes: 360,
  /** Tidal range in metres, low to high. */
  rangeM: 1.6,
  /** Mean water height in metres. */
  meanM: 0.9,
} as const

/** Real seconds → in-game seconds. Derived so both tide figures agree. */
export const TIME_COMPRESSION = (TIDE.cycleGameMinutes * 60) / TIDE.cycleRealSeconds

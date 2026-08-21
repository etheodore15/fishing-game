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
  /** Minimum travel (px) for a press to be a cast at all. */
  flickMinPx: 40,
  /**
   * Cast power comes from how far the thumb travelled OR how fast it was
   * moving, whichever is more generous — a long deliberate sweep and a short
   * sharp snap both read as a big cast, which is what people expect a flick to
   * do. Both are in screen-relative units so a phone and a tablet feel alike.
   */
  /** Travel that reaches full power, as a fraction of the viewport diagonal. */
  flickFullTravel: 0.40,
  /** Speed that reaches full power, in viewport diagonals per second. */
  flickFullSpeed: 2.4,
  /** Speed below which a sweep carries no power of its own. */
  flickIdleSpeed: 0.35,
  /**
   * A flick must complete within this window (ms).
   *
   * Generous on purpose: a device busy compiling shaders can stretch a 200ms
   * thumb flick well past a tight deadline, and a cast that is silently
   * swallowed is the worst possible failure for the one gesture that starts
   * the game.
   */
  flickMaxMs: 900,
  /** Samples kept for the speed estimate. About 130ms at 60Hz. */
  flickSamples: 8,
  /** hold → release → hold within this window (ms) reads as a hop. */
  hopGapMaxMs: 320,
} as const

export const CAST = {
  /**
   * How far a cast reaches, as a fraction of the water in front of the angler.
   *
   * Relative rather than absolute because the visible world is as wide as the
   * screen is: a fixed launch speed that lands beautifully on a 16:9 laptop
   * puts the lure into the far bank on a 4:3 tablet and half way across on a
   * long phone. Full power stops just short of the far side — a cast that
   * flies off the edge of the frame is not a better cast, it is one the player
   * cannot read, and it makes the top of the power range feel identical.
   */
  fullPowerReach: 0.95,
  minPowerReach: 0.22,
  /**
   * Ratio of achieved range to the flat-ground ballistic ideal, used to solve
   * for the launch speed that reaches the target above.
   *
   * Slightly OVER one, which looks wrong until you remember the lure leaves a
   * rod tip a metre and a half above the water and lands at water level. That
   * head start more than pays for the air drag. Measured, not assumed — the
   * first guess of 0.8 sent every cast into the far bank.
   */
  dragEfficiency: 1.05,
  /** Gravity on the airborne lure (world units/s²). */
  gravity: 9.8,
  /** Wind displacement per unit of wind speed (kt) per second, airborne only. */
  windDriftPerKt: 0.021,
  /** Aerodynamic drag on the lure in flight. */
  airDrag: 0.16,
  /**
   * Clearance (world units) a lure needs around structure that breaks the
   * surface. A cast that clears the oyster racks by this much is safe.
   */
  snagMargin: 0.16,
} as const

export const WORK = {
  /** Interest gained per second when the retrieve cadence matches the species. */
  interestGainPerSec: 0.85,
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
  /**
   * How sharply a species' preferred retrieve beats the others.
   *
   * The cadence match runs 0-1 and used to feed the interest gain straight;
   * with one species on the water that was fine, because there was nothing to
   * discriminate against. With three it meant every fish ate everything —
   * measured over sixteen trips a piece, a tailor took a steady retrieve as
   * readily as a salmon did, and a flathead took a twitch nearly as often as a
   * tailor. Raising the match to a power widens the gap without changing what
   * a correct retrieve is worth: a perfect wrong cadence goes from about a
   * third of the right one to about a fifth.
   */
  cadenceSharpness: 1.75,
} as const

export const FIGHT = {
  /**
   * Tension above this for breakSustainSec breaks the line.
   *
   * The sustain is a second-and-a-bit rather than the four tenths it was,
   * because four tenths is not a decision. Holding from the moment of hook-up
   * put the rod in the red in under half a second and parted the line before
   * the player had finished registering that a fish was on: every fight ended
   * the same way, and none of them taught anything. §6.4 asks for a parted
   * line to be a decision to hold too hard for too long, and too long has to
   * be long enough to see. tools/bite-sim.ts measures the difference — a
   * player watching the rod lands 13 of 16, a player mashing the screen blind
   * lands none.
   */
  breakTension: 0.95,
  breakSustainSec: 1.1,
  /** Tension below this for slackSustainSec pulls the hook. */
  slackTension: 0.15,
  slackSustainSec: 2.0,
  /** Distance (world units) at which a fish reaching structure busts off. */
  bustOffRadius: 0.42,
  /**
   * Tension added per second while the drag gesture is held.
   *
   * Halved from where it started. The bargain of §6.4 is that leaning on a
   * fish both slows it and loads the line, and the player chooses how much —
   * but at the old rate there was no choosing: full drag went from a fresh
   * hook-up to a parted line in nine tenths of a second, so the only winning
   * move was never to hold, which pulls the hook instead.
   */
  dragGainPerSec: 0.70,
  /** Tension bled per second with no drag applied. */
  tensionBleedPerSec: 0.85,
  /** Extra tension per unit of fish surge velocity. */
  surgeTensionScale: 0.22,
  /** hookHold lost per second, scaled by tension above hookSafeTension. */
  hookWearPerSec: 0.055,
  hookSafeTension: 0.55,
  /** Extra hookHold lost per head-shake event. */
  headshakeWear: 0.019,
  /**
   * Stamina drained per second at full drag, before the species' own capacity.
   * A fish starts every fight at 1 and its `fight.stamina` stat scales how
   * long that lasts, so the schema value reads as staying power rather than as
   * a starting handicap.
   */
  staminaDrainPerSec: 0.085,
  /** Stamina recovered per second when the player gives slack. */
  staminaRecoverPerSec: 0.02,
  /**
   * Metres per second the fish is drawn toward the rod under full drag.
   * This is the pump: holding drag physically gains line on a tiring fish,
   * which is what makes the fight a tug of war rather than a waiting game.
   */
  gainPerSec: 1.25,
  /**
   * How fast the line takes up slack, and how fast it dumps it, as a rate
   * constant on the ease toward the belly the rod is showing.
   *
   * Line goes out faster than it comes back: a run puts it in the water all at
   * once and gathering it is work.
   */
  slackGivePerSec: 9,
  slackGatherPerSec: 5,
  /** Distance to the rod at which the fish is landed. */
  landRadius: 0.9,
  /**
   * How deep the line hangs below the straight gap to the fish, as a fraction
   * of that gap, on a completely slack line and on a fully loaded one.
   *
   * The line's rest length is what the Verlet solve bellies against, and
   * nothing was bounding it against where the fish had got to. A hooked fish
   * coming in — under the pump, or any moment the player let go — closed the
   * gap far faster than the reel took line back, so the endgame was routinely
   * five metres of line strung across a two-metre gap: the rod bent double and
   * the line hanging in a bight on the bottom, telling the player two opposite
   * stories at once. §8.3 gives the Verlet solve the line's shape and §6.4
   * gives the fight the tension; these two numbers keep them describing the
   * same fish.
   *
   * A fraction rather than a length because a given slackness looks the same
   * whether the fish is two metres out or twelve, and it is how it looks that
   * is being tuned.
   */
  slackSagFrac: 0.22,
  tautSagFrac: 0.012,
} as const

export const TIDE = {
  /** Real seconds per full tide cycle (§13.7 — 6-minute compressed cycle). */
  cycleRealSeconds: 360,
  /** In-game minutes the cycle represents (chapter JSON tideCycleMinutes). */
  cycleGameMinutes: 360,
  /**
   * Tidal range in metres, low to high.
   *
   * A real range for this coast is 1.2-1.8m. At the shallow end of that the
   * flat still visibly drains without dead low turning half the frame into sky.
   */
  rangeM: 1.4,
  /** Mean water height in metres. */
  meanM: 0.9,
} as const

/** Real seconds → in-game seconds. Derived so both tide figures agree. */
export const TIME_COMPRESSION = (TIDE.cycleGameMinutes * 60) / TIDE.cycleRealSeconds

/**
 * How long does it take to get a bite, if you do everything right?
 *
 * The full free-swimming sim, headless: real WaterField, real Fish, real Trip,
 * real cadence reader. Only the renderer and the bait boids are stubbed. It
 * drives a scripted retrieve — a cast, then hops at a fixed interval — and
 * reports what the fish actually did.
 *
 * This exists because "I have cast a hundred times and nothing has looked at
 * it" is not a question you can answer by reading the code. Either a player
 * doing the right thing gets a fish in a reasonable time or they do not, and
 * that is a number.
 *
 * Usage: node --experimental-strip-types tools/bite-sim.ts [hopIntervalSec]
 */
import { readFileSync } from 'node:fs'
import { bathymetrySeed, type Chapter, type Species } from '../src/content/schema.ts'
import { TIDE, TIME_COMPRESSION } from '../src/engine/tuning.ts'
import { rng } from '../src/art/noise.ts'
import { Fish } from '../src/sim/fish.ts'
import { Trip } from '../src/sim/trip.ts'
import { WaterField } from '../src/sim/water.ts'
import { DEFAULT_TIDE, emptyLightReading, emptyTideReading, readLight, readTide } from '../src/sim/tide.ts'
import type { Conditions, LureState } from '../src/sim/types.ts'

const DT = 1 / 60

// The content is imported as JSON modules by Vite, which Node will not do
// without an import attribute the TypeScript here cannot carry. Read it.
const json = <T,>(p: string): T => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as T
const SPECIES = json<Species>('../src/content/species/dusky-flathead.json')
const CHAPTER = json<Chapter>('../src/content/chapters/ch1-estuary.json')

export interface BiteRun {
  /** The fight, if one was played out. */
  fight: FightRun | null
  /** Seconds of retrieve before a fish committed, or null if none did. */
  timeToCommit: number | null
  /** Highest interest any fish reached. */
  peakInterest: number
  /** Closest any fish came to the lure, metres. */
  closestM: number
  /** How many casts it took. */
  casts: number
  /** Seconds simulated. */
  elapsed: number
  /** Fraction of retrieve time with a fish inside perception range. */
  inRangeFraction: number
  willingness: number
  tideState: string
  finalPhase: string
  lastCadence: string | null
}

/** What the player is doing with their thumb. */
export type PlayerScript = 'hop' | 'steady' | 'twitch' | 'idle' | 'flick-spam'

/**
 * How the player works the drag once a fish is on.
 *
 * The first three are what a person actually does before they understand the
 * fight. `read-rod` is what the game asks for and a person can see — lean on
 * it, ease off when the rod is loaded hard or the fish runs. `perfect` cheats
 * by reading the tension number directly, and exists only as an upper bound:
 * if perfect cannot land fish either, the fight is not winnable.
 */
export type DragPolicy = 'always' | 'never' | 'mash' | 'read-rod' | 'perfect'

/** One frame of fight geometry, for the line diagnostic. */
export interface LineSample {
  t: number
  tension: number
  /** 0 bellied right out, 1 bar tight. */
  straightness: number
  /** Rest length the Verlet solve is using, in metres. */
  lineOut: number
  /** Straight-line metres from rod tip to fish. */
  span: number
  /** How much longer the line is than the gap it has to cross. */
  slack: number
  /** How deep the belly hangs, as a fraction of the gap. What the eye reads. */
  sagFrac: number
  fishState: string
}

export interface FightRun {
  outcome: string | null
  /** Seconds the fight lasted. */
  seconds: number
  /** Stamina left in the fish when it ended. 0 means beaten. */
  stamina: number
  /** How close it got to being landed: 1 is landed. */
  peakTension: number
  lineOut: number
  /** Per-frame geometry, only when the caller asked for it. */
  line: LineSample[]
}

export function runBite(opts: {
  hopIntervalSec: number
  script?: PlayerScript
  /** Play the fight out too, with this policy. */
  drag?: DragPolicy
  /** Record the line's geometry every frame. Off by default; it allocates. */
  traceLine?: boolean
  castPower?: number
  maxCasts?: number
  startHour?: number
  seed?: number
} ): BiteRun {
  const ch = CHAPTER
  const sp = SPECIES
  const water = new WaterField(bathymetrySeed(ch.bathymetry))
  const worldWidth = 13.3 // a phone in landscape
  water.setWorldWidth(worldWidth)

  const tide = emptyTideReading()
  const light = emptyLightReading()
  const tideConfig = {
    ...DEFAULT_TIDE,
    cycleRealSeconds: (ch.tideCycleMinutes * 60) / TIME_COMPRESSION,
    rangeM: TIDE.rangeM,
    meanM: TIDE.meanM,
  }

  let simTime = 0
  const cond: Conditions = {
    willingness: 1,
    flow: 0,
    lightLevel: 1,
    depthAt: (x) => water.depthAt(x),
    bedDepth: (x) => water.bedDepth(x),
    surfaceY: (x, t) => water.surfaceY(x, t),
    surfaceTop: (x) => water.surfaceY(x, simTime),
    // A modest school sitting mid-column over the middle of the flat.
    baitAt: (x) => Math.max(0, 1 - Math.abs(x - worldWidth * 0.55) / 2.5) * 0.6,
    baitDepthAt: () => 1.2,
  }

  const lure: LureState = {
    x: 0, y: 0, speed: 0, vx: 0, vy: 0,
    inWater: false, airborne: false,
    cadence: null, cadenceQuality: 0, cadenceHz: 0,
  }

  const rand = rng(opts.seed ?? 4409)
  const fish: Fish[] = []
  for (let i = 0; i < 4; i++) {
    const f = new Fish(sp, 7000 + i * 131, Fish.drawLength(sp, rand))
    f.x = 1.5 + rand() * 8
    f.y = 1.4 + rand() * 1.4
    f.heading = rand() < 0.5 ? 0 : Math.PI
    fish.push(f)
  }

  let committed = false
  let outcome: string | null = null
  const noop = () => {}
  let casts = 0
  const trip = new Trip(lure, water, cond, fish, {
    onPhase: (p) => { if (p === 'fight') committed = true },
    onCast: () => { casts += 1 }, onSplash: noop, onSnag: noop,
    onHeadshake: noop, onSurge: noop, onOutcome: (o) => { outcome = o },
  })

  const startHour = opts.startHour ?? ch.startHour
  const maxCasts = opts.maxCasts ?? 40
  const power = opts.castPower ?? 0.75

  let workTime = 0
  let inRange = 0
  let peak = 0
  let closest = Infinity
  let nextHop = 0
  let castStartedAt = 0
  let holding = false
  const script = opts.script ?? 'hop'
  const HOLD_START = { type: 'holdstart', x: 0, y: 0, nx: 0.5, ny: 0.5 } as const
  const TAP = { type: 'tap', x: 0, y: 0, nx: 0.5, ny: 0.5 } as const
  const FLICK = { type: 'flick', nx: 0.2, ny: 0.6, dx: 0.7, dy: -0.7, power: 0.8, angle: 0.78 } as const

  while (!committed) {
    // Read phase: fire a cast up and out, 45 degrees.
    if (trip.phase === 'read') {
      const a = Math.PI / 4
      trip.onGesture(
        { type: 'flick', nx: 0.2, ny: 0.6, dx: Math.cos(a), dy: -Math.sin(a), power, angle: a },
        water.width, simTime,
      )
      nextHop = simTime + 0.6
      castStartedAt = simTime
    }

    // One frame.
    simTime += DT
    readTide(simTime, tideConfig, tide)
    readLight(startHour + (simTime * TIME_COMPRESSION) / 3600, 0.5, light)
    water.flow = tide.flow
    water.tideOffsetM = tide.heightM - TIDE.meanM
    cond.flow = tide.flow
    cond.lightLevel = light.level
    cond.willingness = willingnessFor(sp, tide.state, light.level)

    if (trip.phase === 'work') {
      switch (script) {
        case 'hop':
          if (simTime >= nextHop) {
            trip.onGesture({ type: 'hop' }, water.width, simTime)
            nextHop = simTime + opts.hopIntervalSec
          }
          break
        case 'steady':
          if (!holding) { trip.onGesture(HOLD_START, water.width, simTime); holding = true }
          break
        case 'twitch':
          if (simTime >= nextHop) {
            trip.onGesture(TAP, water.width, simTime)
            nextHop = simTime + opts.hopIntervalSec
          }
          break
        case 'flick-spam':
          // The player who has only found one gesture: cast, wait, cast again.
          if (simTime >= nextHop) {
            trip.onGesture(FLICK, water.width, simTime)
            nextHop = simTime + 5
          }
          break
        case 'idle':
          break
      }
    }

    trip.step(DT, simTime, 12, 1)
    for (const f of fish) f.update(DT, water, cond, lure)

    if (trip.phase === 'work') {
      workTime += DT
      let near = Infinity
      for (const f of fish) {
        peak = Math.max(peak, f.interest)
        near = Math.min(near, Math.hypot(f.x - lure.x, f.y - lure.y))
      }
      closest = Math.min(closest, near)
      if (near < 4.2) inRange += DT
    }

    if (simTime - castStartedAt > 180) break // stuck: report it rather than loop
    if (casts >= maxCasts && trip.phase !== 'work') break
    if (simTime > 60 * 20) break
  }

  // ---- the fight ----
  let fightRun: FightRun | null = null
  if (committed && opts.drag) {
    const f = trip.fight
    let seconds = 0
    let peak = 0
    const line: LineSample[] = []
    const brain: DragBrain = { held: false, nextLookAt: 0, rand: rng(opts.seed ?? 4409) }
    let clock = 0
    while (!outcome && seconds < 180) {
      const held = decideDrag(opts.drag, f, brain, (clock += DT))
      simTime += DT
      seconds += DT
      readTide(simTime, tideConfig, tide)
      cond.flow = tide.flow
      trip.onGesture(
        held ? { type: 'holdstart', x: 0, y: 0, nx: 0.5, ny: 0.5 } : { type: 'holdend', x: 0, y: 0, durationMs: 0 },
        water.width, simTime,
      )
      trip.step(DT, simTime, 12, 1)
      for (const fh of fish) fh.update(DT, water, cond, lure)
      peak = Math.max(peak, f.tension)
      if (opts.traceLine) {
        const span = Math.hypot(lure.x - trip.rod.tipX, lure.y - trip.rod.tipY)
        line.push({
          t: seconds,
          tension: f.tension,
          straightness: trip.line.straightness(),
          lineOut: trip.line.lineOut,
          span,
          slack: trip.line.lineOut / Math.max(0.01, span),
          sagFrac:
            Math.sqrt(Math.max(0, (3 * (trip.line.lineOut - span) * Math.max(span, 0.25)) / 8)) /
            Math.max(span, 0.25),
          fishState: f.fish?.state ?? 'gone',
        })
      }
    }
    fightRun = {
      outcome,
      seconds,
      stamina: fish0Stamina(f) ?? 0,
      peakTension: peak,
      lineOut: f.lineOut,
      line,
    }
  }

  return {
    fight: fightRun,
    timeToCommit: committed ? workTime : null,
    peakInterest: peak,
    closestM: closest,
    casts,
    elapsed: simTime,
    inRangeFraction: workTime > 0 ? inRange / workTime : 0,
    willingness: cond.willingness,
    tideState: tide.state,
    finalPhase: trip.phase,
    lastCadence: lure.cadence,
  }
}

/** Stamina of whatever fish is (or was) on. */
function fish0Stamina(f: { fish: { stamina: number } | null }): number | null {
  return f.fish?.stamina ?? null
}

/**
 * Whether the thumb is down this frame.
 *
 * `read-rod` is the point of the exercise, so it is modelled as a person and
 * not as a controller: it looks at the rod every REACTION_MS, decides from what
 * it can actually see — how hard the rod is bent, and whether the fish is
 * visibly running — and then holds that decision until the next look. A policy
 * that re-evaluates every frame at an exact threshold is a robot, and tuning a
 * fight against a robot produces a fight only a robot can win.
 *
 * `perfect` is the same loop with no lag, as an upper bound: if perfect cannot
 * land fish, the fight is not winnable at all.
 */
const REACTION_MS = 260

interface DragBrain {
  held: boolean
  nextLookAt: number
  rand: () => number
}

function decideDrag(
  policy: DragPolicy,
  f: { tension: number; fish: { state: string } | null },
  brain: DragBrain,
  t: number,
): boolean {
  switch (policy) {
    case 'always':
      return true
    case 'never':
      return false
    // Not looking at anything: a second on, a second off.
    case 'mash':
      return Math.floor(t) % 2 === 0
    case 'perfect':
      return f.fish?.state === 'surge' ? f.tension < 0.62 : f.tension < 0.9
    case 'read-rod': {
      if (t < brain.nextLookAt) return brain.held
      brain.nextLookAt = t + (REACTION_MS / 1000) * (0.7 + brain.rand() * 0.6)
      // What a person reads off the blank, to about a fifth of its range.
      const bend = f.tension + (brain.rand() - 0.5) * 0.12
      const running = f.fish?.state === 'surge'
      brain.held = running ? bend < 0.55 : bend < 0.82
      return brain.held
    }
    default:
      return false
  }
}

function willingnessFor(sp: Species, state: string, level: number): number {
  const tideMatch = (sp.conditions.tideStates as readonly string[]).includes(state) ? 1 : 0.26
  const [lo, hi] = sp.conditions.lightPref
  let lightMatch = 1
  if (level < lo!) lightMatch = Math.exp(-Math.pow((lo! - level) / 0.22, 2))
  else if (level > hi!) lightMatch = Math.exp(-Math.pow((level - hi!) / 0.22, 2))
  return Math.min(1, Math.max(0.05, tideMatch * lightMatch))
}

/** Enough fights that a landing rate means something. */
const SEEDS = [4409, 15, 77, 903, 5150, 61, 2024, 8, 331, 1207, 99, 45, 7788, 512, 6, 1984]

const POLICY_LABEL: Record<DragPolicy, string> = {
  always: 'hold the whole time',
  never: 'never hold',
  mash: 'a second on, a second off',
  'read-rod': 'ease off on a run or a hard bend',
  perfect: 'perfect (reads the tension)',
}

if (process.argv[1]?.endsWith('bite-sim.ts')) {
  const scripts: PlayerScript[] = ['hop', 'steady', 'twitch', 'idle', 'flick-spam']
  for (const script of scripts) {
    const hop = 1.2
    const r = runBite({ hopIntervalSec: hop, script })
    console.log(`${script.padEnd(11)}`,
      r.timeToCommit === null
        ? `NO BITE — ${r.casts} cast(s), ${(r.elapsed / 60).toFixed(1)} min, phase stuck at ${r.finalPhase}`
        : `bite after ${r.timeToCommit.toFixed(1)}s of retrieve, ${r.casts} cast(s)`,
      `| peak interest ${r.peakInterest.toFixed(2)}`,
      `| cadence read as ${r.lastCadence ?? 'nothing'}`,
    )
  }
  console.log('')
  const policies: DragPolicy[] = ['always', 'never', 'mash', 'read-rod', 'perfect']
  for (const drag of policies) {
    // Several seeds, because one fight is an anecdote.
    const runs = SEEDS.map((seed) =>
      runBite({ hopIntervalSec: 1.2, script: 'hop', drag, seed }))
    const fights = runs.map((r) => r.fight).filter((f) => f !== null)
    const tally: Record<string, number> = {}
    for (const f of fights) tally[f.outcome ?? 'never ended'] = (tally[f.outcome ?? 'never ended'] ?? 0) + 1
    const landed = tally['landed'] ?? 0
    const mean = fights.reduce((a, f) => a + f.seconds, 0) / Math.max(1, fights.length)
    console.log(
      `${POLICY_LABEL[drag].padEnd(30)} landed ${landed}/${fights.length}`,
      `| ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `| mean ${mean.toFixed(1)}s`,
    )
  }
  console.log('')
  const intervals = process.argv[2] ? [Number(process.argv[2])] : [0.8, 1.2, 1.6, 2.0, 3.0]
  for (const hop of intervals) {
    const r = runBite({ hopIntervalSec: hop })
    console.log(
      `hop every ${hop.toFixed(1)}s →`,
      r.timeToCommit === null
        ? `NO BITE in ${r.casts} casts (${(r.elapsed / 60).toFixed(1)} min)`
        : `bite after ${r.timeToCommit.toFixed(1)}s of retrieve, ${r.casts} casts`,
      `| peak interest ${r.peakInterest.toFixed(2)}`,
      `| closest ${r.closestM.toFixed(2)}m`,
      `| in range ${(r.inRangeFraction * 100).toFixed(0)}% of the retrieve`,
      `| willingness ${r.willingness.toFixed(2)} (${r.tideState})`,
    )
  }
}

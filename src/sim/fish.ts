import type { Species } from '../content/schema.ts'
import { WORK } from '../engine/tuning.ts'
import { clamp, lerp, rng } from '../art/noise.ts'
import type { FishPose } from '../art/fishRig.ts'
import type { Conditions, LureState } from './types.ts'
import type { WaterField } from './water.ts'

/** §8.1 — the nine behaviour states, plus spook from the first four. */
export type FishState =
  | 'cruise'
  | 'notice'
  | 'inspect'
  | 'commit'
  | 'hooked'
  | 'surge'
  | 'headshake'
  | 'tire'
  | 'landed'
  | 'spook'

interface StateProfile {
  /** Multiplier on the species' cruise tail-beat. */
  beat: number
  /** Multiplier on the swim wave amplitude. */
  amp: number
  /** Radians per second the fish can turn. */
  turn: number
  /** Metres per second it wants to travel. */
  speed: number
  /** Preferred distance from the lure, metres. Negative means "ignore". */
  standoff: number
}

/**
 * Each state sets targets, not keyframes (§9). Nothing here plays back a
 * timeline; the fish is always solving for where it wants to be.
 */
const PROFILES: Record<FishState, StateProfile> = {
  cruise: { beat: 0.6, amp: 0.5, turn: 0.5, speed: 0.22, standoff: -1 },
  notice: { beat: 1.0, amp: 0.8, turn: 1.1, speed: 0.55, standoff: -1 },
  // An inspecting fish has to be able to hold station on a lure being worked
  // home. Slower than the retrieve and it simply falls behind and gives up,
  // which reads as the fish losing interest when really it lost a footrace.
  inspect: { beat: 1.5, amp: 1.05, turn: 1.4, speed: 1.2, standoff: 0.42 },
  commit: { beat: 5.2, amp: 2.2, turn: 2.0, speed: 2.4, standoff: 0 },
  hooked: { beat: 3.4, amp: 1.7, turn: 1.6, speed: 0.9, standoff: -1 },
  surge: { beat: 6.0, amp: 2.5, turn: 1.2, speed: 2.9, standoff: -1 },
  headshake: { beat: 7.5, amp: 0.7, turn: 0.4, speed: 0.15, standoff: -1 },
  tire: { beat: 1.1, amp: 0.8, turn: 0.9, speed: 0.4, standoff: -1 },
  landed: { beat: 0.35, amp: 0.35, turn: 0.5, speed: 0.05, standoff: -1 },
  spook: { beat: 6.4, amp: 2.6, turn: 2.6, speed: 3.2, standoff: -1 },
}

let nextId = 1

export class Fish {
  readonly id = nextId++
  readonly species: Species
  readonly lengthCm: number
  readonly lengthM: number

  x = 0
  y = 0
  heading = Math.PI
  speed = 0
  state: FishState = 'cruise'
  /** Seconds in the current state. Used for hysteresis, never for animation. */
  stateTime = 0

  /** §6.3 — hidden. The player never sees this number, only its consequences. */
  interest = 0
  /** Fight variables (§6.4). Only meaningful once hooked. */
  stamina = 1
  /** Counts down while spooked; the fish is unfishable until it clears. */
  spookTimer = 0

  /** Per-fish so a school does not beat in unison. */
  readonly phase: number
  private finPhase = 0
  private omega = 1
  private ampScale = 1
  private turnBias = 0
  private wanderPhase: number
  private rand: () => number
  /** Where an ambush predator has decided to sit. */
  private lieX = 0
  private lieY = 0
  private lieTimer = 0
  /**
   * A feeding lunge at the bait school.
   *
   * Deliberately NOT a tenth behaviour state — §8.1 fixes the state list at
   * nine plus spook. A lunge is a cruising fish briefly deciding to eat, and it
   * is the only thing in the game that produces a bust-up: the boids simply
   * react to a predator that has genuinely accelerated into them (§8.5).
   */
  private lungeTimer = 0
  private lungeCooldown = 0

  constructor(species: Species, seed: number, lengthCm: number) {
    this.species = species
    this.lengthCm = lengthCm
    this.lengthM = lengthCm / 100
    this.rand = rng(seed)
    this.phase = this.rand() * Math.PI * 2
    this.wanderPhase = this.rand() * 100
  }

  /**
   * Draw a length from the species' size curve.
   *
   * Lognormal, as the schema asks: most fish are small, the good ones are rare,
   * and the 45cm the journal wants is a fish you have to work for.
   */
  static drawLength(species: Species, rand: () => number): number {
    const { minCm, maxCm, curve } = species.size
    if (curve === 'uniform') return minCm + rand() * (maxCm - minCm)
    // Box-Muller, shaped so the mode sits about a third up the range.
    const u1 = Math.max(1e-6, rand())
    const u2 = rand()
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2)
    const v = Math.exp(g * 0.42 - 0.42)
    return clamp(minCm + (maxCm - minCm) * (v * 0.38), minCm, maxCm)
  }

  get profile(): StateProfile {
    return PROFILES[this.state]
  }

  get isHooked(): boolean {
    return (
      this.state === 'hooked' ||
      this.state === 'surge' ||
      this.state === 'headshake' ||
      this.state === 'tire'
    )
  }

  setState(s: FishState): void {
    if (this.state === s) return
    this.state = s
    this.stateTime = 0
  }

  /**
   * One fixed step of free-swimming behaviour.
   *
   * The fight states are driven by sim/hookup.ts instead — once a fish is on,
   * it is no longer deciding anything for itself.
   */
  update(dt: number, water: WaterField, cond: Conditions, lure: LureState): void {
    this.stateTime += dt
    this.finPhase += dt * (4 + this.profile.beat * 2)

    if (this.spookTimer > 0) this.spookTimer -= dt
    if (!this.isHooked && this.state !== 'landed') {
      this.think(dt, cond, lure)
      this.considerLunge(dt, cond)
    }

    const p = this.profile
    const sp = this.species.swim
    // Beat rate is a target the fish eases toward, so a state change reads as
    // the fish winding up rather than as a cut.
    const targetOmega = Math.PI * 2 * lerp(sp.cruiseHz, sp.burstHz, clamp((p.beat - 0.6) / 5.4, 0, 1))
    this.omega = lerp(this.omega, targetOmega, 1 - Math.exp(-dt * 6))
    this.ampScale = lerp(this.ampScale, p.amp, 1 - Math.exp(-dt * 5))

    if (!this.isHooked && this.state !== 'landed') {
      this.steer(dt, water, cond, lure)
    }
  }

  /** Interest, and the transitions it drives. Nothing here is scripted. */
  private think(dt: number, cond: Conditions, lure: LureState): void {
    if (this.state === 'spook') {
      this.interest = 0
      if (this.spookTimer <= 0) this.setState('cruise')
      return
    }

    const dx = lure.x - this.x
    const dy = lure.y - this.y
    const dist = Math.hypot(dx, dy)
    const inRange = lure.inWater && dist < WORK.perceptionRadius

    if (!inRange) {
      this.interest = Math.max(0, this.interest - WORK.interestIdleDecayPerSec * dt * 1.4)
    } else {
      // Cadence matching (§6.3). A fish that wants a hop and is being given a
      // steady retrieve loses interest — the tolerance is how fussy it is.
      const wants = this.species.cadence.preferred
      const tol = this.species.cadence.tolerance
      let match = 0
      if (lure.cadence === wants) match = lure.cadenceQuality
      else if (lure.cadence !== null) match = Math.max(0, lure.cadenceQuality - 1 + tol)

      // Willingness folds in the tide and the light: the same retrieve simply
      // works less well on the wrong tide, which is the whole lesson of §13.
      const near = 1 - clamp(dist / WORK.perceptionRadius, 0, 1)
      if (match > 0.12) {
        this.interest += WORK.interestGainPerSec * match * near * cond.willingness * dt
      } else {
        this.interest -= WORK.interestDecayPerSec * dt
      }
      this.interest = clamp(this.interest, 0, 1)

      // Spooking: a lure ripped past an ambush predator's nose, or a retrieve
      // hammering far faster than anything alive.
      const closeUp = dist < this.lengthM * 2.5
      if (closeUp && (lure.cadenceHz > WORK.spookCadenceHz || lure.speed > WORK.spookSpeed)) {
        this.spook()
        return
      }
    }

    switch (this.state) {
      case 'cruise':
        if (this.interest > WORK.noticeAt) this.setState('notice')
        break
      case 'notice':
        if (this.interest > WORK.inspectAt) this.setState('inspect')
        else if (this.interest < WORK.noticeAt * 0.7) this.setState('cruise')
        break
      case 'inspect':
        if (this.interest > WORK.commitAt) this.setState('commit')
        else if (this.interest < WORK.inspectAt * 0.75) this.setState('notice')
        break
      case 'commit':
        // A commit that does not connect within its own window falls away —
        // the fish had a look and thought better of it.
        if (this.stateTime > 1.4) {
          this.interest *= 0.35
          this.setState('inspect')
        }
        break
      default:
        break
    }
  }

  /**
   * Decide whether to eat.
   *
   * Only a cruising fish with nothing better to do, in water that suits it,
   * with bait actually above it. The willingness term is why the same school
   * gets hammered on the run-out and ignored on the top of the tide — which is
   * the pattern §13 asks a player to be able to articulate after three trips.
   */
  private considerLunge(dt: number, cond: Conditions): void {
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt
      if (this.lungeTimer <= 0) this.lungeCooldown = 3.5 + this.rand() * 6
      return
    }
    if (this.lungeCooldown > 0) {
      this.lungeCooldown -= dt
      return
    }
    if (this.state !== 'cruise' || this.interest > WORK.noticeAt) return

    const density = cond.baitAt(this.x)
    if (density < 0.35) return
    const chance = density * cond.willingness * 0.55 * dt
    if (this.rand() > chance) return

    this.lungeX = clamp(this.x + (this.rand() - 0.5) * 0.7, 0.5, 40)
    this.lungeY = Math.max(cond.surfaceTop(this.x) + 0.06, cond.baitDepthAt(this.x))
    this.lungeTimer = 0.55 + this.rand() * 0.5
  }

  private lungeX = 0
  private lungeY = 0

  spook(): void {
    this.interest = 0
    this.spookTimer = 4 + this.rand() * 5
    this.setState('spook')
  }

  /** Movement: a target point, a turn rate, and a speed. No paths. */
  private steer(dt: number, water: WaterField, cond: Conditions, lure: LureState): void {
    const p = this.profile
    let tx: number
    let ty: number
    const lunging = this.lungeTimer > 0

    if (this.state === 'spook') {
      // Bolt for deep water, away from whatever frightened it.
      tx = this.x + (this.x > lure.x ? 1 : -1) * 6
      ty = cond.bedDepth(this.x) - 0.25
    } else if (p.standoff >= 0 && lure.inWater) {
      // Hold station off the lure, or drive straight at it on a commit.
      const dx = lure.x - this.x
      const dy = lure.y - this.y
      const d = Math.hypot(dx, dy) || 1
      tx = lure.x - (dx / d) * p.standoff
      ty = lure.y - (dy / d) * p.standoff
    } else if (this.state === 'notice') {
      // Lift off the bottom and face the lure without closing on it yet.
      tx = this.x + (lure.x - this.x) * 0.25
      ty = lerp(this.y, lure.y, 0.3)
    } else if (lunging) {
      // Straight at the thickest bait, and fast enough for the school to know.
      tx = this.lungeX
      ty = this.lungeY
    } else {
      tx = this.lieX
      ty = this.lieY
      this.lieTimer -= dt
      if (this.lieTimer <= 0) this.chooseLie(water, cond, lure)
    }

    // Never swim into the bed or out through the surface — but "the surface"
    // is where the tide has actually put it, not a fixed depth.
    const bed = cond.bedDepth(tx)
    const top = cond.surfaceTop(tx) + this.lengthM * 0.12
    ty = clamp(ty, top, bed - this.lengthM * 0.12)

    let toward = Math.atan2(ty - this.y, tx - this.x)
    // A little wander so nothing tracks a straight line to its target.
    this.wanderPhase += dt * 0.7
    toward += Math.sin(this.wanderPhase) * 0.25

    let delta = toward - this.heading
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const maxTurn = p.turn * this.species.swim.turnRate * dt
    const applied = clamp(delta, -maxTurn, maxTurn)
    this.heading += applied
    // The body leans into a turn, and that lean feeds the rig's spine bias.
    this.turnBias = lerp(this.turnBias, clamp(delta * 0.55, -1, 1), 1 - Math.exp(-dt * 7))

    const dist = Math.hypot(tx - this.x, ty - this.y)
    const want = dist < 0.1 ? 0 : lunging ? this.species.swim.burstHz * 0.55 : p.speed
    this.speed = lerp(this.speed, want, 1 - Math.exp(-dt * 4))

    this.x += Math.cos(this.heading) * this.speed * dt
    this.y += Math.sin(this.heading) * this.speed * dt

    // The tide pushes the fish about, more so higher in the water column.
    this.x += cond.flow * 0.12 * dt * (1 - clamp(this.y / Math.max(0.3, cond.bedDepth(this.x)), 0, 1))

    this.x = clamp(this.x, 0.4, water.width - 0.4)
    this.y = clamp(this.y, cond.surfaceTop(this.x) + 0.04, cond.bedDepth(this.x))
  }

  /**
   * Pick a lie.
   *
   * A high ambushBias means the fish mostly sits still on the sand and waits,
   * which is exactly what a dusky does — so the lie changes rarely, and when it
   * does it favours the drop-off, the weed edge and whatever depth the species
   * actually wants at this stage of the tide.
   */
  private chooseLie(water: WaterField, cond: Conditions, lure: LureState): void {
    const bias = this.species.swim.ambushBias
    this.lieTimer = lerp(4, 26, bias) * (0.6 + this.rand() * 0.9)

    const [minD, maxD] = this.species.habitat.depthM
    let bestX = this.x
    let bestScore = -Infinity
    // Sample a handful of candidate lies and take the best. Cheaper and more
    // legible than a gradient walk, and it keeps the fish on real features.
    for (let i = 0; i < 7; i++) {
      const cx = clamp(this.x + (this.rand() - 0.5) * lerp(9, 3, bias), 0.6, water.width - 0.6)
      const depth = cond.depthAt(cx)
      // Depth preference, structure, and a pull toward wherever the lure went in.
      const depthFit = depth >= minD && depth <= maxD ? 1 : 1 / (1 + Math.abs(depth - (minD + maxD) / 2))
      const near = water.nearestStructure(cx, cond.bedDepth(cx))
      const structureFit = near ? 1 / (1 + near.dist * 1.4) : 0
      const lureFit = lure.inWater ? 1 / (1 + Math.abs(cx - lure.x)) : 0
      const baitFit = cond.baitAt(cx)
      const score =
        depthFit * 1.5 +
        structureFit * 1.1 +
        baitFit * 1.3 * cond.willingness +
        lureFit * 0.6 * cond.willingness +
        this.rand() * 0.35
      if (score > bestScore) {
        bestScore = score
        bestX = cx
      }
    }
    this.lieX = bestX
    // An ambush fish lies hard on the bottom; a cruiser sits up off it.
    this.lieY = cond.bedDepth(bestX) - lerp(0.55, 0.05, bias) - this.lengthM * 0.08
  }

  /** Fill a rig pose from the current state. Allocation-free. */
  writePose(out: FishPose, t: number): void {
    out.x = this.x
    out.y = this.y
    out.heading = this.heading
    out.lengthM = this.lengthM
    out.t = t
    out.omega = this.omega
    out.ampScale = this.ampScale
    out.turnBias = this.turnBias
    out.phase = this.phase
    out.finPhase = this.finPhase
  }
}

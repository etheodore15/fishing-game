import type { Species } from '../content/schema.ts'
import { WORK } from '../engine/tuning.ts'
import { clamp, lerp, rng } from '../art/noise.ts'
import type { FishPose } from '../art/fishRig.ts'
import type { Schools } from './school.ts'
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
  /**
   * Where this fish has decided to be.
   *
   * Public because a school shares one: the body of them go where the lead
   * fish is going, and a school of four picking four destinations is four
   * fish that happen to be the same species (measured: spread 1.85m against a
   * solitary flathead's 2.12m — no school at all).
   */
  lieX = 0
  lieY = 0
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

  /** True while it is actually into the bait. Read by the school. */
  get lunging(): boolean {
    return this.lungeTimer > 0
  }

  /** Where it is feeding, for the rest of the school to join in on. */
  get lungeAtX(): number {
    return this.lungeX
  }

  get lungeAtY(): number {
    return this.lungeY
  }

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

  /**
   * How hard it closes, once it has decided to.
   *
   * A chaser runs a lure down; an ambusher eases up on it and has a look. Only
   * the approach states are scaled — a hooked fish's speed belongs to the
   * fight, and a cruising one is not going anywhere in particular.
   */
  private get approachGain(): number {
    if (this.state !== 'notice' && this.state !== 'inspect' && this.state !== 'commit') return 1
    return this.chaseGain
  }

  private get chaseGain(): number {
    return lerp(0.9, 1.75, this.species.swim.chase)
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
  update(dt: number, water: WaterField, cond: Conditions, lure: LureState, schools: Schools): void {
    this.stateTime += dt
    this.finPhase += dt * (4 + this.profile.beat * 2)

    if (this.spookTimer > 0) this.spookTimer -= dt
    if (!this.isHooked && this.state !== 'landed') {
      this.think(dt, cond, lure, schools)
      this.considerLunge(dt, cond, schools)
    }

    const p = this.profile
    const sp = this.species.swim
    // Beat rate is a target the fish eases toward, so a state change reads as
    // the fish winding up rather than as a cut.
    const targetOmega = Math.PI * 2 * lerp(sp.cruiseHz, sp.burstHz, clamp((p.beat - 0.6) / 5.4, 0, 1))
    this.omega = lerp(this.omega, targetOmega, 1 - Math.exp(-dt * 6))
    this.ampScale = lerp(this.ampScale, p.amp, 1 - Math.exp(-dt * 5))

    if (!this.isHooked && this.state !== 'landed') {
      this.steer(dt, water, cond, lure, schools)
    }
  }

  /** Interest, and the transitions it drives. Nothing here is scripted. */
  private think(dt: number, cond: Conditions, lure: LureState, schools: Schools): void {
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
      const willing = cond.willingnessFor(this.species.id)
      if (match > 0.12) {
        // Shaped, not linear: see WORK.cadenceSharpness. This is the whole
        // difference between three species and one species wearing three hats.
        const drive = Math.pow(match, WORK.cadenceSharpness)
        // And speed, for the ones that hunt by running things down. A tailor
        // eats a lure *because* it is fleeing, and will not look twice at one
        // crawling; a fish lying on the sand waiting for something to come
        // past does not care either way. That is what `chase` says, and the
        // term is a penalty on the crawl rather than a bonus on the sprint —
        // a bonus made every chaser easier to catch at everything.
        const fleeing = clamp(lure.speed / WORK.chaseSpeedRef, 0, 1)
        const hunt = lerp(
          1,
          WORK.chaseFloor + (1 + WORK.chaseGain - WORK.chaseFloor) * fleeing,
          this.species.swim.chase,
        )
        this.interest += WORK.interestGainPerSec * drive * hunt * near * willing * dt
      } else {
        this.interest -= WORK.interestDecayPerSec * dt
      }
      this.interest = clamp(this.interest, 0, 1)

      // Spooking: a lure ripped past an ambush predator's nose, or a retrieve
      // hammering far faster than anything alive. A chaser will follow a lure
      // going a great deal faster than that before it decides it is being
      // hunted rather than doing the hunting.
      const closeUp = dist < this.lengthM * 2.5
      const tooFast = WORK.spookSpeed * lerp(1, WORK.chaseSpookTolerance, this.species.swim.chase)
      if (closeUp && (lure.cadenceHz > WORK.spookCadenceHz || lure.speed > tooFast)) {
        this.spook()
        return
      }
    }

    // What the rest of them are doing.
    //
    // A fish turning hard on something is the most visible event on a flat,
    // and a schooling fish that sees one of its own do it comes to look. It
    // cannot make it eat — the pull stops below the commit threshold — so the
    // school brings the fish and the retrieve still has to catch it.
    const schooling = this.species.swim.schooling
    if (schooling > 0 && this.state !== 'commit') {
      const row = schools.row(this.species.id)
      if (row && row.rallyId >= 0 && row.rallyId !== this.id) {
        const away = Math.hypot(row.rallyX - this.x, row.rallyY - this.y)
        const seen = 1 - clamp(away / WORK.schoolReach, 0, 1)
        if (seen > 0) {
          const pull = WORK.schoolPullPerSec * schooling * row.rallyInterest * seen * dt
          this.interest = Math.min(this.interest + pull, Math.max(this.interest, WORK.schoolCeiling))
        }
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
  private considerLunge(dt: number, cond: Conditions, schools: Schools): void {
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

    // A school eats as a school. One of your own going through the bait is the
    // reason you go through it too, and that is what a bust-up is: several
    // fish at once, in one place, for a few seconds. One fish helping itself
    // over and over is not a bust-up, it is lunch.
    const school = this.species.swim.schooling
    const row = school > 0 ? schools.row(this.species.id) : null
    const joining = row && row.lungeN > 0 ? school : 0
    const atX = joining > 0.4 ? row!.lungeX : this.x

    const density = Math.max(cond.baitAt(this.x), joining > 0.4 ? cond.baitAt(atX) : 0)
    if (density < 0.35) return
    // A fish that hunts by running things down goes at a school harder than
    // one that lies on the sand waiting for the school to come to it. Same
    // rule, read off the same number that decides everything else about how
    // the species moves.
    const appetite = 0.85 + (1 - this.species.swim.ambushBias) * 0.9
    const chance =
      density * cond.willingnessFor(this.species.id) * 0.55 * appetite * (1 + joining * 5) * dt
    if (this.rand() > chance) return

    this.lungeX = clamp(atX + (this.rand() - 0.5) * 0.7, 0.5, 40)
    this.lungeY = Math.max(cond.surfaceTop(atX) + 0.06, cond.baitDepthAt(atX))
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
  private steer(dt: number, water: WaterField, cond: Conditions, lure: LureState, schools: Schools): void {
    const p = this.profile
    let tx: number
    let ty: number
    const lunging = this.lungeTimer > 0
    const school = this.species.swim.schooling
    const row = school > 0 ? schools.row(this.species.id) : null
    const rally =
      row && row.rallyId >= 0 && row.rallyId !== this.id && this.state !== 'spook' ? row : null

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
    } else if (rally) {
      // Coming to see what one of your own has found. This is what the player
      // watches when a school switches on: not one fish on the lure, but the
      // rest of them arriving behind it.
      tx = rally.rallyX
      ty = rally.rallyY
    } else if (lunging) {
      // Straight at the thickest bait, and fast enough for the school to know.
      tx = this.lungeX
      ty = this.lungeY
    } else {
      tx = this.lieX
      ty = this.lieY
      this.lieTimer -= dt
      if (this.lieTimer <= 0) this.chooseLie(water, cond, lure)

      // Travel with your own kind: the school has one destination, and it is
      // the lead fish's. A schooling fish keeps a little of its own lie so
      // the body of them arrives as a body and not as a stack.
      if (row && row.n > 1) {
        tx = lerp(tx, row.lieX, school)
        ty = lerp(ty, row.lieY, school)
      }
    }

    // Never swim into the bed or out through the surface — but "the surface"
    // is where the tide has actually put it, not a fixed depth.
    const bed = cond.bedDepth(tx)
    const top = cond.surfaceTop(tx) + this.lengthM * 0.12
    ty = clamp(ty, top, bed - this.lengthM * 0.12)

    let toward = Math.atan2(ty - this.y, tx - this.x)

    /**
     * Swim with the school.
     *
     * The target point is where this fish wants to go; this is the school
     * having a say in how it gets there, which is what a school actually is.
     * Two terms, and which one applies depends only on how far out it is: too
     * far from the body of them and it turns back toward it, close enough and
     * it falls in with the way they are all pointing.
     *
     * Applied to the heading rather than to the target, because a heading is
     * what the turn rate acts on — blending targets and then turning slowly
     * toward the result washes the school out to nothing, which is exactly
     * what the first attempt at this did (spread 1.70m against a solitary
     * flathead's 2.12m, alignment 0.61 against 0.55 — no school at all).
     */
    if (row && row.n > 1) {
      const gap = this.lengthM * WORK.schoolSpacingBody
      const mate = schools.nearestMate(this)
      const mateD = mate ? Math.hypot(mate.x - this.x, mate.y - this.y) : Infinity
      const cx = row.cx - this.x
      const cy = row.cy - this.y
      const out = Math.hypot(cx, cy)
      // Separation, then cohesion, then alignment — in that order, because a
      // school that is happy to overlap is not four fish, it is one smudge.
      const withThem =
        mate && mateD < gap
          ? Math.atan2(this.y - mate.y, this.x - mate.x)
          : out > gap * 1.6
            ? Math.atan2(cy, cx)
            : Math.atan2(row.hy, row.hx)
      // A committed fish is eating. It can rejoin afterwards.
      const w = school * (this.state === 'commit' ? 0.08 : mate && mateD < gap ? 0.8 : 0.45)
      toward = Math.atan2(
        Math.sin(toward) * (1 - w) + Math.sin(withThem) * w,
        Math.cos(toward) * (1 - w) + Math.cos(withThem) * w,
      )
    }

    // A little wander so nothing tracks a straight line to its target.
    this.wanderPhase += dt * 0.7
    toward += Math.sin(this.wanderPhase) * lerp(0.25, 0.1, school)

    let delta = toward - this.heading
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const maxTurn = p.turn * this.species.swim.turnRate * dt
    const applied = clamp(delta, -maxTurn, maxTurn)
    this.heading += applied
    // The body leans into a turn, and that lean feeds the rig's spine bias.
    this.turnBias = lerp(this.turnBias, clamp(delta * 0.55, -1, 1), 1 - Math.exp(-dt * 7))

    const dist = Math.hypot(tx - this.x, ty - this.y)
    const want =
      dist < 0.1
        ? 0
        : lunging
          ? this.species.swim.burstHz * 0.55
          : rally && this.state === 'cruise'
            ? PROFILES.notice.speed * this.chaseGain
            : p.speed * this.approachGain
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
    const willing = cond.willingnessFor(this.species.id)
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
        baitFit * 1.3 * willing +
        lureFit * 0.6 * willing +
        this.rand() * 0.35
      if (score > bestScore) {
        bestScore = score
        bestX = cx
      }
    }
    this.lieX = bestX
    // An ambush fish lies hard on the bottom; a cruiser holds at whatever
    // depth the species actually lives at, which for the fish that chase bait
    // is up in the water where the bait is. Reading the habitat band rather
    // than measuring off the bed is the difference between a tailor working
    // mid-water and a tailor pretending to be a flathead.
    const bed = cond.bedDepth(bestX)
    const onBottom = bed - lerp(0.55, 0.05, bias) - this.lengthM * 0.08
    const inBand = clamp(lerp(minD, maxD, this.rand()), 0.12, Math.max(0.15, bed - 0.15))
    this.lieY = lerp(inBand, onBottom, bias)
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

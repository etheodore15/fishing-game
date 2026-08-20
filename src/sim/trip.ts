import { CAST, WORK } from '../engine/tuning.ts'
import type { GestureEvent } from '../engine/input.ts'
import { clamp, lerp, rng } from '../art/noise.ts'
import type { CadenceKind } from '../content/schema.ts'
import type { Phase } from '../engine/store.ts'
import { Fight, type FightOutcome } from './hookup.ts'
import type { Fish } from './fish.ts'
import { FishingLine } from './line.ts'
import { Rod, BUTT_X } from './rod.ts'
import type { Conditions, LureState } from './types.ts'
import type { WaterField } from './water.ts'

export interface TripEvents {
  onPhase(phase: Phase): void
  onCast(power: number): void
  onSplash(x: number, y: number, power: number): void
  onSnag(x: number, y: number): void
  onHeadshake(power: number): void
  onSurge(power: number): void
  onOutcome(outcome: FightOutcome, fish: Fish): void
}

interface CadenceMark {
  t: number
  kind: CadenceKind
}

/**
 * The trip (§6): read → cast → work → fight → log, strictly ordered.
 *
 * One session is one trip. The phases do not overlap and there is no way to
 * skip one — a fight can only start from a worked lure, and a page can only be
 * logged from a landed fish.
 */
export class Trip {
  phase: Phase = 'read'
  readonly line = new FishingLine()
  readonly rod = new Rod()
  readonly fight = new Fight()

  /** Set while a loss banner is worth showing. */
  lastOutcome: FightOutcome | null = null

  private lureVX = 0
  private lureVY = 0
  private castPower = 0
  private holding = false
  private marks: CadenceMark[] = []
  private lastHopAt = -Infinity
  private sinceLanded = 0
  private readonly rand = rng(6607)

  constructor(
    private readonly lure: LureState,
    private readonly water: WaterField,
    private readonly cond: Conditions,
    private readonly fishes: readonly Fish[],
    private readonly events: TripEvents,
  ) {
    this.line.reset(BUTT_X, -1, BUTT_X + 0.2, -1)
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return
    this.phase = p
    this.events.onPhase(p)
  }

  /** §6.2/§6.3 — the whole gesture vocabulary, and nothing else. */
  onGesture(e: GestureEvent, worldWidth: number, t: number): void {
    switch (e.type) {
      case 'flick':
        if (this.phase === 'read') this.launch(e.nx, e.ny, e.dx, e.dy, e.power, worldWidth)
        break
      case 'tap':
        if (this.phase === 'work') this.mark('twitch', t, 1.35)
        break
      case 'hop':
        if (this.phase === 'work') {
          this.mark('hop', t, 0)
          this.lastHopAt = t
          // A hop lifts the lure and draws it home; it does not fire it left.
          // The direction has to come from where the rod is, or a retrieve
          // walks the lure off the far side of the screen.
          this.lureVY -= 0.9
          this.lureVX += Math.sign(this.rod.tipX - this.lure.x) * 0.85
        }
        break
      case 'holdstart':
        this.holding = true
        if (this.phase === 'work') this.mark('steady', t, 0)
        break
      case 'holdend':
        this.holding = false
        break
      default:
        break
    }
  }

  private mark(kind: CadenceKind, t: number, impulse: number): void {
    this.marks.push({ t, kind })
    if (impulse > 0) {
      // A twitch is a short sharp pull back toward the rod.
      this.lureVX += Math.sign(this.rod.tipX - this.lure.x) * impulse
      this.lureVY -= impulse * 0.35
    }
  }

  /** §6.2 — vector length is power, angle is direction. */
  private launch(nx: number, ny: number, dx: number, dy: number, power: number, worldWidth: number): void {
    this.lastOutcome = null
    const speed = lerp(CAST.minLaunchSpeed, CAST.maxLaunchSpeed, power)
    // A flick up-screen throws the lure out; screen y is inverted from world y.
    this.lureVX = dx * speed
    this.lureVY = dy * speed
    this.castPower = power

    this.lure.x = clamp(this.rod.tipX, 0.3, worldWidth - 0.3)
    this.lure.y = this.rod.tipY
    this.lure.airborne = true
    this.lure.inWater = false
    this.lure.cadence = null
    this.lure.cadenceQuality = 0
    this.marks.length = 0
    this.line.reset(this.rod.tipX, this.rod.tipY, this.lure.x, this.lure.y)
    this.setPhase('cast')
    this.events.onCast(power)
    void nx
    void ny
  }

  step(dt: number, t: number, windKt: number, windDirX: number): void {
    const surfaceAt = (x: number) => this.cond.surfaceY(x, t)

    switch (this.phase) {
      case 'cast':
        this.stepCast(dt, windKt, windDirX, surfaceAt)
        break
      case 'work':
        this.stepWork(dt, t, surfaceAt)
        break
      case 'fight':
        this.stepFight(dt)
        break
      default:
        this.lure.speed = 0
        break
    }

    this.stepTackle(dt, surfaceAt, windKt, windDirX)
  }

  /** §6.2 — ballistic, wind-affected, and snaggable. */
  private stepCast(dt: number, windKt: number, windDirX: number, surfaceAt: (x: number) => number): void {
    this.lureVY += CAST.gravity * dt
    this.lureVX += windKt * CAST.windDriftPerKt * windDirX * dt
    const drag = 1 - CAST.airDrag * dt
    this.lureVX *= drag
    this.lureVY *= drag

    const nx = this.lure.x + this.lureVX * dt
    const ny = this.lure.y + this.lureVY * dt

    // Overhang: anything that breaks the surface can take a bad cast.
    //
    // The test is the structure's actual footprint, and it is deterministic. A
    // radius around the top of the racks caught lures flying a metre clear of
    // them, and a dice roll would make a snag feel like bad luck — §13 asks for
    // losses that feel like the player's fault, and this is one of them: cast
    // over the racks to the drop-off, or wear it.
    for (const s of this.water.structures) {
      if (!s.overhangs) continue
      const withinX = Math.abs(nx - s.x) < s.radius + CAST.snagMargin
      const belowTop = ny > s.y - CAST.snagMargin
      if (withinX && belowTop) {
        this.snag(nx, ny)
        return
      }
    }

    this.lure.x = clamp(nx, 0.2, this.water.width - 0.2)
    this.lure.y = ny
    this.lure.vx = this.lureVX
    this.lure.vy = this.lureVY
    this.lure.speed = Math.hypot(this.lureVX, this.lureVY)
    this.line.lineOut = Math.hypot(this.lure.x - this.rod.tipX, this.lure.y - this.rod.tipY) * 1.06

    if (ny >= surfaceAt(this.lure.x)) {
      this.lure.airborne = false
      this.lure.inWater = true
      this.lureVY *= 0.18
      this.lureVX *= 0.25
      this.sinceLanded = 0
      this.events.onSplash(this.lure.x, surfaceAt(this.lure.x), clamp(this.castPower + 0.25, 0, 1))
      this.setPhase('work')
    }

    // A cast that flies off the end of the water is just a bad cast.
    if (this.lure.x <= 0.25 || this.lure.x >= this.water.width - 0.25) {
      this.lure.airborne = false
      this.lure.inWater = true
      this.setPhase('work')
    }
  }

  private snag(x: number, y: number): void {
    this.lure.airborne = false
    this.lure.inWater = false
    this.lure.speed = 0
    this.lastOutcome = null
    this.events.onSnag(x, y)
    this.setPhase('read')
  }

  /** §6.3 — the lure sinks, drifts and answers the retrieve. */
  private stepWork(dt: number, t: number, surfaceAt: (x: number) => number): void {
    this.sinceLanded += dt

    // A held retrieve is a steady swim back toward the rod.
    if (this.holding) {
      const toRodX = this.rod.tipX - this.lure.x
      const toRodY = this.rod.tipY - this.lure.y
      const d = Math.hypot(toRodX, toRodY) || 1
      this.lureVX = lerp(this.lureVX, (toRodX / d) * 0.95, 1 - Math.exp(-dt * 6))
      this.lureVY = lerp(this.lureVY, (toRodY / d) * 0.95, 1 - Math.exp(-dt * 6))
      this.mark('steady', t, 0)
    } else {
      // Otherwise it sinks and goes with the tide, which is most of the game.
      // Terminal velocity lands near 0.8 m/s: a few seconds to the bottom of
      // the flat, so letting it sink is a real choice with a real cost.
      this.lureVY += 1.6 * dt
      this.lureVX += this.cond.flow * 0.32 * dt
      const damp = 1 - 1.9 * dt
      this.lureVX *= damp
      this.lureVY *= damp
    }

    this.lure.x = clamp(this.lure.x + this.lureVX * dt, 0.2, this.water.width - 0.2)
    this.lure.y = this.lure.y + this.lureVY * dt

    const bed = this.cond.bedDepth(this.lure.x)
    if (this.lure.y > bed - 0.03) {
      this.lure.y = bed - 0.03
      this.lureVY = Math.min(0, this.lureVY)
    }
    const surf = surfaceAt(this.lure.x)
    if (this.lure.y < surf + 0.02) {
      this.lure.y = surf + 0.02
      this.lureVY = Math.max(0, this.lureVY)
    }

    this.lure.vx = this.lureVX
    this.lure.vy = this.lureVY
    this.lure.speed = Math.hypot(this.lureVX, this.lureVY)
    this.line.lineOut = Math.max(0.4, Math.hypot(this.lure.x - this.rod.tipX, this.lure.y - this.rod.tipY) * 1.04)

    this.readCadence(t)

    // The retrieve is finished when the lure is back under the rod. Horizontal
    // distance only: the tip is a metre and a half of air above the water, so
    // a straight-line test can never be satisfied by a lure in it.
    if (Math.abs(this.lure.x - this.rod.tipX) < 0.5 && this.sinceLanded > 0.6) {
      this.lure.inWater = false
      this.lure.cadence = null
      this.setPhase('read')
      return
    }

    // §6.4 — the fight begins on commit. There is no strike to time; a fish
    // that has decided is a fish that is on.
    for (const f of this.fishes) {
      if (f.state !== 'commit') continue
      // A committed fish engulfs the lure; the reach is most of its own length.
      if (Math.hypot(f.x - this.lure.x, f.y - this.lure.y) > f.lengthM * 0.9 + 0.1) continue
      this.beginFight(f)
      return
    }
  }

  /**
   * Classify the retrieve.
   *
   * Species carry a preferred cadence and a tolerance (§10.1), so what matters
   * is both which pattern is being worked and how cleanly it is held. A ragged
   * hop is still a hop, just a less convincing one.
   */
  private readCadence(t: number): void {
    const window = WORK.cadenceWindowSec
    while (this.marks.length && t - this.marks[0]!.t > window) this.marks.shift()

    let taps = 0
    let steady = 0
    let hops = 0
    let lastTap = -Infinity
    let intervalSum = 0
    let intervalCount = 0
    let intervalSq = 0

    for (const m of this.marks) {
      if (m.kind === 'twitch') {
        taps += 1
        if (lastTap > -Infinity) {
          const gap = m.t - lastTap
          intervalSum += gap
          intervalSq += gap * gap
          intervalCount += 1
        }
        lastTap = m.t
      } else if (m.kind === 'steady') steady += 1
      else hops += 1
    }

    const steadyFraction = clamp((steady / 60) * (1 / window), 0, 1)

    if (hops > 0 && t - this.lastHopAt < window) {
      this.lure.cadence = 'hop'
      // Two hops in the window is a rhythm; one is an accident.
      this.lure.cadenceQuality = clamp(0.45 + hops * 0.3, 0, 1)
      this.lure.cadenceHz = hops / window
    } else if (steadyFraction > 0.45) {
      this.lure.cadence = 'steady'
      this.lure.cadenceQuality = clamp(steadyFraction, 0, 1)
      this.lure.cadenceHz = 0.4
    } else if (taps >= 2) {
      const mean = intervalSum / Math.max(1, intervalCount)
      const variance = intervalSq / Math.max(1, intervalCount) - mean * mean
      const jitter = Math.sqrt(Math.max(0, variance)) / Math.max(0.08, mean)
      this.lure.cadence = 'twitch'
      this.lure.cadenceQuality = clamp(1 - jitter, 0.15, 1)
      this.lure.cadenceHz = 1 / Math.max(0.1, mean)
    } else {
      this.lure.cadence = null
      this.lure.cadenceQuality = 0
      this.lure.cadenceHz = 0
    }
  }

  private beginFight(f: Fish): void {
    this.fight.begin(f, this.line.lineOut)
    this.setPhase('fight')
  }

  private stepFight(dt: number): void {
    const fish = this.fight.fish
    if (!fish) {
      this.setPhase('read')
      return
    }

    this.fight.step(dt, this.holding, this.rod.tipX, this.rod.tipY, this.water, this.cond, {
      onHeadshake: (p) => {
        // The rod tip rings — the head-shake is felt through the blank (§8.4).
        this.rod.strike((this.rand() - 0.5) * 0.09 * p, -0.07 * p)
        this.events.onHeadshake(p)
      },
      onSurge: (p) => this.events.onSurge(p),
      onOutcome: (outcome, landedFish) => this.resolve(outcome, landedFish),
    })

    this.lure.x = fish.x
    this.lure.y = fish.y
    this.lure.inWater = true
    this.lure.speed = fish.speed
    this.line.lineOut = this.fight.lineOut
  }

  private resolve(outcome: FightOutcome, fish: Fish): void {
    this.lastOutcome = outcome
    this.lure.inWater = false
    this.lure.cadence = null
    this.holding = false

    if (outcome === 'line-break') {
      this.line.breakLine()
      // A parted line unloads the rod violently. That kick is the whole tell.
      this.rod.strike(0.16, -0.2)
    } else if (outcome === 'bust-off') {
      this.line.breakLine()
      this.rod.strike(-0.1, -0.13)
    } else if (outcome === 'hook-pull') {
      this.rod.strike(0.05, -0.17)
    }

    this.setPhase(outcome === 'landed' ? 'log' : 'read')
    // Tell the world. This is what plays the sound, shows the loss, writes the
    // catch into the journal and tests the unlock rules — the fight's own
    // callback only reaches the trip.
    this.events.onOutcome(outcome, fish)
  }

  /** Called once the log phase has been dealt with by the world. */
  finishLog(): void {
    this.fight.end()
    this.setPhase('read')
  }

  private stepTackle(dt: number, surfaceAt: (x: number) => number, windKt: number, windDirX: number): void {
    const showLine = this.phase !== 'read' || this.line.isBroken
    const targetX = showLine ? this.lure.x : this.rod.tipX + 0.3
    const targetY = showLine ? this.lure.y : this.rod.tipY + 0.2

    // §8.4: the rod bend IS the tension. In every phase but the fight there is
    // no load on it, so it stands up straight — which is itself information.
    const tension = this.phase === 'fight' ? this.fight.tension : 0
    this.rod.update(dt, tension, targetX, targetY, this.phase === 'fight')

    this.line.step(
      dt,
      this.rod.tipX,
      this.rod.tipY,
      targetX,
      targetY,
      showLine && !this.line.isBroken,
      surfaceAt,
      windKt,
      windDirX,
    )
  }

  /** 0-1 for the line renderer's colour shift (§8.3). */
  get tension(): number {
    return this.phase === 'fight' ? clamp(this.fight.tension, 0, 1) : 0
  }

  get lineVisible(): boolean {
    return this.phase !== 'read' || this.line.isBroken
  }
}

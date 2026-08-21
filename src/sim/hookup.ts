import { FIGHT } from '../engine/tuning.ts'
import { clamp, lerp, rng } from '../art/noise.ts'
import type { Fish } from './fish.ts'
import { WaterField, type Structure } from './water.ts'
import type { Conditions } from './types.ts'

export type FightOutcome = 'landed' | 'line-break' | 'hook-pull' | 'bust-off'

export interface FightEvents {
  onHeadshake(power: number): void
  onSurge(power: number): void
  onOutcome(outcome: FightOutcome, fish: Fish): void
}

/**
 * The fight (§6.4).
 *
 * Four simultaneous variables and three ways to lose. The acceptance criterion
 * is that losing a fish to the oyster racks feels like the *player's* fault, so
 * every loss here has to be preceded by something the player could have read
 * and acted on:
 *
 * - a surge winds up visibly before it pulls, and the rod loads as it does;
 * - the fish's line toward structure is plain on screen, and drag genuinely
 *   slows it, so a bust-off is always a decision not to hold hard enough;
 * - tension is legible off the rod at every moment, so a parted line is always
 *   a decision to hold too hard for too long.
 *
 * Nothing in this file rolls dice against the player.
 */
export class Fight {
  fish: Fish | null = null

  /** 0-1. The rod bend is this, and it is the only display of it. */
  tension = 0
  /** 1 → 0. Degrades faster at high tension and on head-shakes. */
  hookHold = 1
  /** Metres from the rod tip to the fish. */
  lineOut = 6
  /** How close the fish is to the structure it is running for, metres. */
  structureProximity = Infinity
  /** Smoothed 0-1 drag input, so a tap is not a full lock-up. */
  drag = 0

  private overTension = 0
  private underTension = 0
  /**
   * How long the fish has been in its current fight state.
   *
   * Tracked here rather than read off Fish.stateTime: that counter is advanced
   * by the world's own per-fish update, and a fight that silently depends on
   * somebody else ticking the fish is a fight that stalls the moment it is
   * driven from anywhere but the main loop.
   */
  private stateElapsed = 0
  private shakeTimer = 0
  private surgeTimer = 0
  private restTimer = 0
  private target: Structure | null = null
  private readonly rand = rng(8821)
  private finished = false
  /** Live water surface at the fish, cached for the outcome checks. */
  private surfaceY = 0

  begin(fish: Fish, lineOut: number): void {
    this.fish = fish
    this.tension = 0.42
    this.hookHold = 1
    this.lineOut = lineOut
    this.drag = 0
    this.overTension = 0
    this.underTension = 0
    this.surgeTimer = 0
    this.restTimer = 0.35
    this.shakeTimer = 1.2 + this.rand()
    this.structureProximity = Infinity
    this.target = null
    this.finished = false
    // Every fish starts fresh; the species stat scales how long fresh lasts.
    fish.stamina = 1
    this.stateElapsed = 0
    fish.setState('hooked')
  }

  get active(): boolean {
    return this.fish !== null && !this.finished
  }

  end(): void {
    this.fish = null
    this.finished = true
  }

  step(
    dt: number,
    dragHeld: boolean,
    rodTipX: number,
    rodTipY: number,
    water: WaterField,
    cond: Conditions,
    events: FightEvents,
  ): void {
    const fish = this.fish
    if (!fish || this.finished) return

    // Pressure is binary but its duration is analogue (§6.4): the gesture is
    // held or it is not, and everything expressive comes from how long.
    this.drag = lerp(this.drag, dragHeld ? 1 : 0, 1 - Math.exp(-dt * 11))

    const spec = fish.species.fight
    this.surfaceY = cond.surfaceTop(fish.x)
    this.chooseState(dt, fish, spec, water, events)
    const alongLine = this.moveFish(dt, fish, spec, rodTipX, rodTipY, water, cond)
    this.integrateTension(dt, alongLine, spec)
    this.wearHook(dt)
    this.workLine(dt, fish, rodTipX, rodTipY)
    this.checkOutcome(fish, rodTipX, events)
  }

  /**
   * Which of the four fight states the fish is in.
   *
   * Stamina is the spine of it: a fresh fish surges and shakes, a beaten one
   * comes in. Nothing is on a timeline — the fish is spending what it has.
   */
  private chooseState(
    dt: number,
    fish: Fish,
    spec: Fish['species']['fight'],
    water: WaterField,
    events: FightEvents,
  ): void {
    // A fish works harder the harder it is being pulled on, and a fish with a
    // higher stamina stat spends what it has more slowly.
    const effort = 0.35 + this.drag * 0.85 + this.tension * 0.5
    const capacity = 0.4 + spec.stamina
    fish.stamina = clamp(
      fish.stamina -
        (FIGHT.staminaDrainPerSec * effort * dt) / capacity +
        (this.drag < 0.15 ? FIGHT.staminaRecoverPerSec * dt : 0),
      0,
      1,
    )

    this.surgeTimer -= dt
    this.restTimer -= dt
    this.shakeTimer -= dt
    this.stateElapsed += dt

    if (fish.state === 'surge' && this.surgeTimer <= 0) {
      this.setFishState(fish, fish.stamina < 0.3 ? 'tire' : 'hooked')
      this.restTimer = lerp(0.5, 2.2, 1 - fish.stamina) * (0.7 + this.rand() * 0.8)
    }

    if (fish.state === 'headshake' && this.stateElapsed > 0.55) {
      this.setFishState(fish, 'hooked')
    }

    const canAct = fish.state === 'hooked' || fish.state === 'tire'
    if (!canAct) return

    if (this.shakeTimer <= 0 && fish.stamina > 0.12) {
      // Head-shakes are the fish trying to throw the hook, and they cost hold.
      this.shakeTimer = (1 / Math.max(0.2, spec.headshakeFreq)) * (1.4 + this.rand() * 2.2)
      this.setFishState(fish, 'headshake')
      this.hookHold = clamp(this.hookHold - FIGHT.headshakeWear * (0.6 + fish.stamina), 0, 1)
      events.onHeadshake(0.5 + fish.stamina * 0.5)
      return
    }

    if (this.restTimer <= 0 && fish.stamina > 0.22) {
      // Pick something to run for. A dusky's structureSeek is low, but the
      // racks are right there, and it will still find them if you let it.
      const near = water.nearestStructure(fish.x, fish.y, WaterField.BUST_SEVERITY)
      const wantsStructure = near !== null && this.rand() < spec.structureSeek
      this.target = wantsStructure ? near.s : null
      this.surgeTimer = lerp(0.45, 1.5, fish.stamina) * (0.8 + this.rand() * 0.5)
      this.setFishState(fish, 'surge')
      events.onSurge(spec.surgePower * (0.4 + fish.stamina * 0.6))
      return
    }

    if (fish.stamina < 0.28 && fish.state !== 'tire') this.setFishState(fish, 'tire')
    else if (fish.stamina >= 0.28 && fish.state === 'tire') this.setFishState(fish, 'hooked')
  }

  private setFishState(fish: Fish, state: Parameters<Fish['setState']>[0]): void {
    if (fish.state === state) return
    fish.setState(state)
    this.stateElapsed = 0
  }

  /**
   * Move the hooked fish, and report how much of its velocity is pulling
   * directly against the rod — which is the only component that loads it.
   */
  private moveFish(
    dt: number,
    fish: Fish,
    spec: Fish['species']['fight'],
    rodTipX: number,
    rodTipY: number,
    water: WaterField,
    cond: Conditions,
  ): number {
    let goalX: number
    let goalY: number

    if (fish.state === 'surge' && this.target) {
      goalX = this.target.x
      goalY = this.target.y
    } else if (fish.state === 'surge') {
      // No structure in mind: straight away from the angler and down.
      goalX = fish.x + (fish.x - rodTipX) * 2
      goalY = cond.bedDepth(fish.x) * 0.85
    } else if (fish.state === 'tire') {
      // A beaten fish gives ground, but only if you are asking for it — and it
      // comes in through the water, not up toward a rod tip held in the air.
      goalX = lerp(fish.x, rodTipX, 0.4)
      goalY = lerp(fish.y, cond.surfaceTop(fish.x) + 0.2, 0.3)
    } else {
      // Holding: the fish works against the line without making ground. It
      // used to swim away from the angler indefinitely, which meant a fight
      // could never end — it simply left.
      goalX = fish.x + (fish.x - rodTipX) * 0.06
      goalY = fish.y + 0.12
    }

    const dx = goalX - fish.x
    const dy = goalY - fish.y
    const d = Math.hypot(dx, dy) || 1

    // Drag is the brake. This is the whole bargain of the fight: it slows the
    // fish and it loads the line, and the player has to choose how much. It has
    // to bite hard enough that leaning on a running fish visibly stops it,
    // otherwise holding on is only ever a way to break the line.
    const brake = 1 - this.drag * 0.78
    const power =
      fish.state === 'surge'
        // Fast enough to take line, slow enough that a player who sees the fish
        // turn for the racks has time to lean on it. A surge that covers the
        // gap before the player can react is not a decision, it is a coin toss.
        ? lerp(0.8, 2.2, spec.surgePower) * (0.45 + fish.stamina * 0.55)
        : fish.state === 'tire'
          ? 0.55
          : 0.85
    const speed = power * brake * (fish.state === 'headshake' ? 0.12 : 1)

    fish.speed = speed
    fish.heading = Math.atan2(dy, dx)
    fish.x = clamp(fish.x + (dx / d) * speed * dt, 0.35, water.width - 0.35)
    fish.y = clamp(fish.y + (dy / d) * speed * dt, cond.surfaceTop(fish.x) + 0.02, cond.bedDepth(fish.x))

    // Head-shakes barely move the fish; they shake the rod instead.
    if (fish.state === 'headshake') {
      const shake = Math.sin(this.stateElapsed * spec.headshakeFreq * 22) * 0.035
      fish.y += shake * dt * 30
    }

    // The pump. Drag on a fish that is not actively running gains line, and
    // gains it faster the more beaten the fish is. Without this, holding the
    // rod up did nothing but load it, and the only way a fight could end was
    // for something to break.
    //
    // It aims at the water in front of the angler, not at the rod tip: the tip
    // is over a metre up in the air, so aiming there drags a fresh fish
    // straight to the surface and then stalls, because once it is clamped at
    // the top of the water the pull is almost entirely vertical and it stops
    // making ground. A fish comes in horizontally and only lifts as it tires.
    if (fish.state !== 'surge') {
      const pump = this.drag * FIGHT.gainPerSec * (0.25 + (1 - fish.stamina) * 0.75) * dt
      const aimY = lerp(fish.y, cond.surfaceTop(fish.x) + 0.15, 1 - fish.stamina)
      const lx = rodTipX - fish.x
      const ly = aimY - fish.y
      const ld = Math.hypot(lx, ly) || 1
      fish.x += (lx / ld) * pump
      fish.y = clamp(fish.y + (ly / ld) * pump, cond.surfaceTop(fish.x) + 0.02, cond.bedDepth(fish.x))
    }

    // Only motion along the line loads it. A fish running across the current
    // is nothing like a fish running straight away from you.
    const lx = fish.x - rodTipX
    const ly = fish.y - rodTipY
    const ld = Math.hypot(lx, ly) || 1
    const along = ((dx / d) * lx + (dy / d) * ly) / ld
    return clamp(along * speed, 0, 4)
  }

  private integrateTension(dt: number, alongLine: number, spec: Fish['species']['fight']): void {
    const rise = this.drag * FIGHT.dragGainPerSec + alongLine * FIGHT.surgeTensionScale * (0.6 + spec.surgePower)
    const fall = (1 - this.drag) * FIGHT.tensionBleedPerSec
    this.tension = clamp(this.tension + (rise - fall) * dt, 0, 1.2)
  }

  private wearHook(dt: number): void {
    const over = Math.max(0, this.tension - FIGHT.hookSafeTension) / (1 - FIGHT.hookSafeTension)
    this.hookHold = clamp(this.hookHold - FIGHT.hookWearPerSec * over * dt, 0, 1)
  }

  /**
   * How much line is out — which is to say how much belly the player sees.
   *
   * This is a display quantity and nothing else: it sets the rest length the
   * Verlet solve bellies against (§8.3) and no outcome depends on it. So it is
   * derived from the thing the player is already reading, the rod's load, and
   * cannot contradict it. Bar-tight under a bent rod; a proper bight when it
   * goes slack; and the belly visibly coming out of it as the player leans on
   * the fish.
   *
   * It used to be integrated instead — line added during a surge and taken
   * back by the pump — with a floor at the straight gap and no ceiling. A
   * hooked fish coming in closed that gap far faster than the reel took line
   * back, so the endgame was routinely five metres of line strung across a two
   * metre gap: the rod bent double over a bight lying on the bottom, two
   * opposite stories at once. Measured across sixteen fights, forty-four per
   * cent of all fight frames had a loaded rod over a bellied line.
   */
  private workLine(dt: number, fish: Fish, rodTipX: number, rodTipY: number): void {
    const span = Math.hypot(fish.x - rodTipX, fish.y - rodTipY)
    // How deep the belly should hang, then how much line it takes to hang it:
    // arc length of a parabola of sag h over span L is L(1 + 8h²/3L²), so the
    // excess is 8h²/3L. sim/line.ts inverts exactly this to place the curve.
    const sag = lerp(FIGHT.slackSagFrac, FIGHT.tautSagFrac, clamp(this.tension, 0, 1)) * span
    const target = span + (8 * sag * sag) / (3 * Math.max(span, 0.25))
    const rate = target > this.lineOut ? FIGHT.slackGivePerSec : FIGHT.slackGatherPerSec
    this.lineOut = lerp(this.lineOut, target, 1 - Math.exp(-dt * rate))
    // The ease is feel; this is the guarantee. However fast the fish moves,
    // the line on screen never says something the rod is not saying.
    this.lineOut = clamp(this.lineOut, Math.max(0.3, span * 0.92), Math.min(target, 26))
  }

  private checkOutcome(fish: Fish, rodTipX: number, events: FightEvents): void {
    const dt = 1 / 60

    // ---- structure ----
    const target = this.target
    this.structureProximity = target
      ? Math.max(0, Math.hypot(target.x - fish.x, target.y - fish.y) - target.radius)
      : Infinity
    if (target && this.structureProximity <= FIGHT.bustOffRadius) {
      this.finish('bust-off', fish, events)
      return
    }

    // ---- line ----
    if (this.tension > FIGHT.breakTension) {
      this.overTension += dt
      if (this.overTension > FIGHT.breakSustainSec) {
        this.finish('line-break', fish, events)
        return
      }
    } else {
      this.overTension = 0
    }

    // ---- hook ----
    if (this.tension < FIGHT.slackTension) {
      this.underTension += dt
      if (this.underTension > FIGHT.slackSustainSec) {
        this.finish('hook-pull', fish, events)
        return
      }
    } else {
      this.underTension = 0
    }
    // A hook worn out by head-shakes and heavy drag pulls for the same reason,
    // just by the other road.
    if (this.hookHold <= 0) {
      this.finish('hook-pull', fish, events)
      return
    }

    // ---- landed ----
    // Beaten, on the surface, and alongside. Distance to the rod TIP would
    // include the metre and a half of air the rod is held up in, which no fish
    // can ever close.
    const beaten = fish.stamina < 0.16
    const alongside = Math.abs(fish.x - rodTipX) < FIGHT.landRadius
    const onTop = fish.y - this.surfaceY < 0.35
    if (beaten && alongside && onTop) {
      this.finish('landed', fish, events)
    }
  }

  private finish(outcome: FightOutcome, fish: Fish, events: FightEvents): void {
    this.finished = true
    if (outcome === 'landed') {
      fish.setState('landed')
    } else {
      // Everything that goes wrong ends with a fish that is gone, and knows it.
      fish.spook()
    }
    this.tension = 0
    events.onOutcome(outcome, fish)
  }
}

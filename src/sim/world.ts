import { Container } from 'pixi.js'
import type { Clock } from '../engine/clock.ts'
import type { GestureEvent } from '../engine/input.ts'
import type { Quality } from '../engine/quality.ts'
import { TIDE, TIME_COMPRESSION } from '../engine/tuning.ts'
import { gameStore, type LossKind } from '../engine/store.ts'
import { Bed } from '../render/bed.ts'
import { BaitRenderer } from '../render/bait.ts'
import { FishRenderer } from '../render/fish.ts'
import { ParticleRenderer } from '../render/particles.ts'
import { TackleRenderer } from '../render/tackle.ts'
import type { SceneUniforms, Stage } from '../render/stage.ts'
import { bathymetrySeed, type Chapter, type UnlockRule } from '../content/schema.ts'
import { species as speciesById } from '../content/index.ts'
import { clamp, rng } from '../art/noise.ts'
import { Audio } from '../audio.ts'
import { BaitSchool } from './boids.ts'
import { Fish } from './fish.ts'
import { KIND, ParticleField } from './particles.ts'
import {
  DEFAULT_TIDE,
  compass,
  emptyLightReading,
  emptyTideReading,
  emptyWindReading,
  readLight,
  readTide,
  readWind,
  tideGlyph,
  type LightReading,
  type TideConfig,
  type TideReading,
  type WindReading,
} from './tide.ts'
import { Trip } from './trip.ts'
import type { Conditions, LureState } from './types.ts'
import { WaterField } from './water.ts'

/** Length-weight relation for a flathead-shaped fish. Journal reads in kg. */
function weightKg(lengthCm: number): number {
  return Math.round(0.0000062 * Math.pow(lengthCm, 3.08) * 100) / 100
}

/**
 * The conductor.
 *
 * Owns the live conditions and every sub-simulation, steps them at a fixed
 * rate, and hands the renderer a resolved set of scene uniforms. The store is
 * written at 4Hz, not 60Hz: React must never be in the animation path (§3).
 */
export class World {
  readonly water: WaterField
  readonly bed = new Bed()
  readonly fish: Fish[] = []
  readonly bait: BaitSchool
  readonly trip: Trip
  readonly audio = new Audio()

  readonly tide: TideReading = emptyTideReading()
  readonly light: LightReading = emptyLightReading()
  readonly wind: WindReading = emptyWindReading()

  /** Above-water spray and drift; below-water bubbles. Two fields, one class. */
  private readonly surfaceFx: ParticleField
  private readonly subFx: ParticleField
  private readonly surfaceFxView: ParticleRenderer
  private readonly subFxView: ParticleRenderer

  private readonly worldLayer = new Container()
  private readonly aboveWorldLayer = new Container()
  private readonly fishView = new FishRenderer()
  private readonly baitView: BaitRenderer
  private readonly tackleView = new TackleRenderer()

  readonly lure: LureState = {
    x: 0, y: 0, speed: 0, vx: 0, vy: 0,
    inWater: false, airborne: false,
    cadence: null, cadenceQuality: 0, cadenceHz: 0,
  }

  readonly conditions: Conditions
  private readonly tideConfig: TideConfig
  private hudAccumulator = 0
  private driftAccumulator = 0
  private bubbleAccumulator = 0
  private readonly rand = rng(2027)

  private readonly scene: SceneUniforms = {
    timeSec: 0, windKt: 10, windDir: 1, hourOfDay: 6,
    lightAngle: 0, lightElev: 0.5, lightLevel: 1, glare: 0,
  }

  constructor(
    readonly chapter: Chapter,
    private readonly stage: Stage,
    private readonly quality: Quality,
  ) {
    this.water = new WaterField(bathymetrySeed(chapter.bathymetry))
    this.water.octaves = quality.settings.waterOctaves

    const cap = quality.settings.particleCap
    this.surfaceFx = new ParticleField(Math.round(cap * 0.7))
    this.subFx = new ParticleField(Math.round(cap * 0.3))
    this.surfaceFxView = new ParticleRenderer(this.surfaceFx.capacity, true)
    this.subFxView = new ParticleRenderer(this.subFx.capacity, false)

    this.bait = new BaitSchool(quality.settings.baitAgents, 5501)
    this.baitView = new BaitRenderer(quality.settings.baitAgents)

    // Below the waterline, into the refraction target.
    this.worldLayer.addChild(this.baitView.view, this.fishView.view, this.subFxView.view)
    // Above it, straight over the finished water.
    this.aboveWorldLayer.addChild(this.tackleView.view, this.surfaceFxView.view)
    for (const c of [this.worldLayer, this.aboveWorldLayer]) {
      c.eventMode = 'none'
      c.interactiveChildren = false
    }

    stage.layers.bed.addChild(this.bed.view)
    stage.layers.fish.addChild(this.worldLayer)
    stage.layers.surfaceFx.addChild(this.bed.aboveView)
    stage.layers.rod.addChild(this.aboveWorldLayer)

    this.conditions = {
      willingness: 1,
      flow: 0,
      lightLevel: 1,
      depthAt: (x) => this.water.depthAt(x),
      bedDepth: (x) => this.water.bedDepth(x),
      surfaceY: (x, t) => this.water.surfaceY(x, t),
      surfaceTop: (x) => this.water.surfaceY(x, this.lastSimTime),
      baitAt: (x) => this.bait.densityAt(x),
      baitDepthAt: (x) => this.bait.depthAt(x),
    }

    // The chapter declares its cycle in in-game minutes; the compression factor
    // turns that into the 6 real minutes §13.7 asks for. Deriving it rather
    // than hard-coding 360s means the two figures cannot drift apart.
    this.tideConfig = {
      ...DEFAULT_TIDE,
      cycleRealSeconds: (chapter.tideCycleMinutes * 60) / TIME_COMPRESSION,
      rangeM: TIDE.rangeM,
      meanM: TIDE.meanM,
    }

    this.trip = new Trip(this.lure, this.water, this.conditions, this.fish, {
      onPhase: (p) => gameStore.getState().setPhase(p),
      onCast: (power) => this.audio.play('cast', 0.9 + power * 0.35),
      onSplash: (x, y, power) => this.splash(x, y, power),
      onSnag: (x, y) => this.onSnag(x, y),
      onHeadshake: (p) => this.audio.play('headshake', 0.85 + p * 0.4),
      onSurge: (p) => this.audio.play('surge', 0.85 + p * 0.3),
      onOutcome: (outcome, fish) => this.onOutcome(outcome, fish),
    })

    this.spawnFish()
  }

  /**
   * Populate the water.
   *
   * A fixed number of fish: §13 asks the *behaviour* to change with the tide,
   * not the stock. A flat that empties of fish on the wrong tide teaches the
   * player nothing, because there is nothing left to watch.
   */
  private spawnFish(): void {
    const rand = rng(4409)
    for (const id of this.chapter.species) {
      const sp = speciesById(id)
      for (let i = 0; i < 4; i++) {
        const f = new Fish(sp, 7000 + i * 131, Fish.drawLength(sp, rand))
        f.x = 1.5 + rand() * 8
        f.y = 1.4 + rand() * 1.4
        f.heading = rand() < 0.5 ? 0 : Math.PI
        this.fish.push(f)
      }
    }
  }

  /** Called once the stage knows its size. */
  layout(): void {
    const vp = this.stage.viewport
    this.water.setWorldWidth(vp.worldWidth)
    this.bed.bake(this.stage.app.renderer, this.water, vp)
    this.bait.seed(this.water, this.conditions)
    for (const f of this.fish) f.x = Math.min(f.x, vp.worldWidth - 1)
  }

  onGesture(e: GestureEvent): void {
    this.trip.onGesture(e, this.water.width, this.lastSimTime)
  }

  private lastSimTime = 0

  update(dt: number, clock: Clock): void {
    const t = clock.simTime
    this.lastSimTime = t

    readTide(t, this.tideConfig, this.tide)
    readLight(clock.hourOfDay, 0.5, this.light)
    readWind(t, this.chapter.wind.baseKt, this.chapter.wind.baseDirDeg, this.wind)

    this.water.windKt = this.wind.speedKt
    this.water.windDir = this.wind.x >= 0 ? 1 : -1
    this.water.flow = this.tide.flow
    this.water.tideOffsetM = this.tide.heightM - TIDE.meanM

    const vp = this.stage.viewport
    vp.tideOffsetM = this.water.tideOffsetM
    vp.update()

    this.conditions.flow = this.tide.flow
    this.conditions.lightLevel = this.light.level
    this.conditions.willingness = this.willingnessFor(this.chapter.species[0]!)

    this.trip.step(dt, t, this.wind.speedKt, this.water.windDir)
    this.bait.update(dt, this.water, this.conditions, this.fish)
    for (const f of this.fish) f.update(dt, this.water, this.conditions, this.lure)

    this.emitAmbient(dt, t)
    const surfaceAt = (x: number) => this.water.surfaceY(x, t)
    this.surfaceFx.update(dt, this.wind.x, this.wind.speedKt, surfaceAt)
    this.subFx.update(dt, 0, 0, surfaceAt)

    this.hudAccumulator += dt
    if (this.hudAccumulator >= 0.25) {
      this.hudAccumulator = 0
      this.publishHud(clock)
    }
  }

  /**
   * How much this species wants to feed right now (§10.1 `conditions`).
   *
   * This is the mechanism behind the acceptance criterion that a player can
   * articulate the tide pattern after three sessions: nothing tells them the
   * bite is on, but the fish behave differently and the bait gets hammered.
   */
  willingnessFor(speciesId: string): number {
    const sp = speciesById(speciesId)
    const tideMatch = sp.conditions.tideStates.includes(this.tide.state) ? 1 : 0.26
    const [lo, hi] = sp.conditions.lightPref
    const level = this.light.level
    let lightMatch = 1
    if (level < lo) lightMatch = Math.exp(-Math.pow((lo - level) / 0.22, 2))
    else if (level > hi) lightMatch = Math.exp(-Math.pow((level - hi) / 0.22, 2))
    return clamp(tideMatch * lightMatch, 0.05, 1)
  }

  // ---------------------------------------------------------------- effects

  private splash(x: number, y: number, power: number): void {
    this.audio.play('splash', 0.85 + power * 0.4)
    this.surfaceFx.burst(KIND.splash, Math.round(6 + power * 14), x, y, 1.4 + power * 2.2, 2.1, -Math.PI / 2, 0.5)
  }

  private onSnag(x: number, y: number): void {
    this.audio.play('snag')
    this.surfaceFx.burst(KIND.spray, 6, x, y, 0.9, 2.6, -Math.PI / 2, 0.35)
    gameStore.getState().setLoss('snag')
  }

  private emitAmbient(dt: number, t: number): void {
    // Wind-blown drift across the surface, at a rate set by the wind itself.
    this.driftAccumulator += dt * Math.max(0, this.wind.speedKt - 6) * 0.5
    while (this.driftAccumulator >= 1) {
      this.driftAccumulator -= 1
      const x = this.rand() * this.water.width
      const y = this.water.surfaceY(x, t) - this.rand() * 0.5
      this.surfaceFx.emit(KIND.drift, x, y, this.wind.x * 1.4, -0.15, 1.6 + this.rand())
    }

    // A hooked fish trails bubbles and beats the surface when it comes up.
    const fish = this.trip.fight.fish
    if (fish && this.trip.phase === 'fight') {
      this.bubbleAccumulator += dt * (4 + fish.speed * 8)
      while (this.bubbleAccumulator >= 1) {
        this.bubbleAccumulator -= 1
        this.subFx.emit(KIND.bubble, fish.x, fish.y, (this.rand() - 0.5) * 0.15, -0.25, 1.2)
      }
      const surf = this.water.surfaceY(fish.x, t)
      if (fish.y - surf < 0.25 && fish.speed > 0.6) {
        this.surfaceFx.burst(KIND.spray, 2, fish.x, surf, 1.5, 2.4, -Math.PI / 2, 0.32)
      }
    }

    // Bait breaking the surface throws spray of its own — the visual half of
    // the bust-up signal (§8.5). It is emitted from the measurement, not from
    // any decision to "play a bust-up".
    const shower = this.bait.surfaceActivity()
    if (shower > 0.004 && this.rand() < shower * 22 * dt * 60) {
      const surf = this.water.surfaceY(this.bait.bustX, t)
      this.surfaceFx.burst(KIND.spray, 3, this.bait.bustX + (this.rand() - 0.5) * 0.8, surf, 1.2, 2.2, -Math.PI / 2, 0.3)
    }
  }

  // ------------------------------------------------------------------- log

  private onOutcome(outcome: string, fish: Fish): void {
    if (outcome === 'landed') {
      this.audio.play('landed')
      this.logCatch(fish)
      return
    }
    this.audio.play(outcome as 'line-break' | 'hook-pull' | 'bust-off')
    gameStore.getState().setLoss(outcome as LossKind)
    this.trip.finishLog()
  }

  /** True while a fish is being written up. */
  get inLog(): boolean {
    return this.trip.phase === 'log'
  }

  /**
   * Close the log phase and get back on the water.
   *
   * Called by the overlay when the player dismisses the catch card: §6.5 is a
   * phase the player reads, not a frame that flashes past.
   */
  dismissLog(): void {
    this.trip.finishLog()
  }

  /** §6.5 — measure it, write it up, and see whether it restores a page. */
  private logCatch(fish: Fish): void {
    const store = gameStore.getState()
    const lengthCm = Math.round(fish.lengthCm)
    store.logCatch({
      speciesId: fish.species.id,
      displayName: fish.species.displayName,
      lengthCm,
      weightKg: weightKg(lengthCm),
      tideState: this.tide.state,
      timeLabel: this.hudTime,
      at: Date.now(),
    })

    for (const rule of this.chapter.unlocks) {
      if (!this.satisfies(rule, fish, lengthCm)) continue
      if (store.pagesRestored.includes(rule.pageId)) continue
      // §5.4 — the restoration takes over from here.
      store.restorePage(rule.pageId)
      break
    }
    // The phase stays on 'log' until the player closes the card.
  }

  private satisfies(rule: UnlockRule, fish: Fish, lengthCm: number): boolean {
    const r = rule.require
    if (r.species && r.species !== fish.species.id) return false
    if (r.tideState && r.tideState !== this.tide.state) return false
    if (r.minCm !== undefined && lengthCm < r.minCm) return false
    if (r.hourWindow) {
      const h = this.lastHour
      const [lo, hi] = r.hourWindow
      const inside = lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi
      if (!inside) return false
    }
    return true
  }

  // ---------------------------------------------------------------- output

  private hudTime = '--:--'
  private lastHour = 0

  private publishHud(clock: Clock): void {
    this.hudTime = clock.format()
    this.lastHour = clock.hourOfDay
    gameStore.getState().setHud({
      time: this.hudTime,
      tideHeightM: Math.round(this.tide.heightM * 10) / 10,
      tideState: this.tide.state,
      tideGlyph: tideGlyph(this.tide),
      windKt: Math.round(this.wind.speedKt),
      windLabel: compass(this.wind.dirDeg),
    })
  }

  render(clock: Clock): void {
    const vp = this.stage.viewport
    const s = this.scene
    s.timeSec = clock.renderTime
    s.windKt = this.wind.speedKt
    s.windDir = this.water.windDir
    s.hourOfDay = clock.hourOfDay
    s.lightAngle = this.light.azimuth * 1.15
    s.lightElev = clamp(this.light.elevation / 1.12, 0, 1)
    s.lightLevel = this.light.level
    // Glare is a mechanic (§8.2): it peaks with a high sun on a slick surface,
    // and chop breaks it up.
    const flatness = 1 - Math.min(1, this.wind.speedKt / 20)
    s.glare = Math.max(0, this.light.level - 0.55) * 2.2 * (0.45 + 0.55 * flatness)

    const palette = this.stage.livePalette
    this.bed.tint(palette)
    this.bed.follow(vp, this.stage.app.renderer.resolution)

    // World-space children draw in metres; one container carries the mapping.
    for (const c of [this.worldLayer, this.aboveWorldLayer]) {
      c.scale.set(vp.pxPerM)
      c.y = vp.waterlinePx
    }

    const lightX = Math.sin(s.lightAngle)
    const lightY = Math.cos(s.lightAngle)
    this.baitView.render(this.bait, palette)
    this.fishView.render(this.fish, clock.renderTime, palette, lightX, lightY, this.light.level)
    this.tackleView.render(this.trip.line, this.trip.rod, this.trip.tension, this.trip.lineVisible, vp.pxPerM, palette)
    this.surfaceFxView.render(this.surfaceFx, palette)
    this.subFxView.render(this.subFx, palette)

    // Foam sources (§8.2): structure edges always, a bust-up wherever the
    // school is actually being hammered, and a hooked fish's surface thrash.
    this.stage.beginFoam()
    for (const st of this.water.structures) {
      if (st.overhangs) this.stage.addFoamSource(st.x, 0.3, st.radius * 1.3)
    }
    const shower = this.bait.surfaceActivity()
    if (shower > 0.004) this.stage.addFoamSource(this.bait.bustX, Math.min(1, shower * 9), 1.1)
    const hooked = this.trip.fight.fish
    if (hooked && this.trip.phase === 'fight') {
      const surf = this.water.surfaceY(hooked.x, clock.renderTime)
      const depth = hooked.y - surf
      if (depth < 0.4) this.stage.addFoamSource(hooked.x, clamp(1 - depth / 0.4, 0, 1) * 0.9, 0.7)
    }

    this.stage.render(clock.step, s)
  }

  setQuality(): void {
    this.water.octaves = this.quality.settings.waterOctaves
  }

  /** Live particle count, for the perf overlay. */
  get particleCount(): number {
    return this.surfaceFx.live + this.subFx.live
  }

  destroy(): void {
    this.bed.destroy()
    this.fishView.destroy()
    this.baitView.destroy()
    this.tackleView.destroy()
    this.surfaceFxView.destroy()
    this.subFxView.destroy()
    this.audio.destroy()
  }
}

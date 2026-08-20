import type { Clock } from '../engine/clock.ts'
import type { Quality } from '../engine/quality.ts'
import { TIDE, TIME_COMPRESSION } from '../engine/tuning.ts'
import { gameStore } from '../engine/store.ts'
import { Container } from 'pixi.js'
import { Bed } from '../render/bed.ts'
import { BaitRenderer } from '../render/bait.ts'
import { FishRenderer } from '../render/fish.ts'
import { BaitSchool } from './boids.ts'
import { Fish } from './fish.ts'
import { species as speciesById } from '../content/index.ts'
import { clamp, rng } from '../art/noise.ts'
import type { Conditions, LureState } from './types.ts'
import type { Stage } from '../render/stage.ts'
import type { SceneUniforms } from '../render/stage.ts'
import { bathymetrySeed, type Chapter } from '../content/schema.ts'
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
import { WaterField } from './water.ts'

/**
 * The conductor.
 *
 * Owns the live conditions and the sub-simulations, steps them at a fixed rate,
 * and hands the renderer a resolved set of scene uniforms. The store is written
 * at 4Hz, not 60Hz: React must never be in the animation path (§3).
 */
export class World {
  readonly water: WaterField
  readonly bed = new Bed()
  readonly fish: Fish[] = []
  readonly bait: BaitSchool
  /** Metre-space container: children position themselves in world units. */
  private readonly worldLayer = new Container()
  private readonly fishView = new FishRenderer()
  private readonly baitView: BaitRenderer

  /**
   * The lure, before the cast exists. Fish and bait both read it, and both
   * cope with it never entering the water.
   */
  readonly lure: LureState = {
    x: 0, y: 0, speed: 0, vx: 0, vy: 0,
    inWater: false, airborne: false,
    cadence: null, cadenceQuality: 0, cadenceHz: 0,
  }

  /** Live conditions handed to every sub-simulation. */
  readonly conditions: Conditions

  readonly tide: TideReading = emptyTideReading()
  readonly light: LightReading = emptyLightReading()
  readonly wind: WindReading = emptyWindReading()

  private readonly tideConfig: TideConfig
  private hudAccumulator = 0
  private readonly scene: SceneUniforms = {
    timeSec: 0,
    windKt: 10,
    windDir: 1,
    hourOfDay: 6,
    lightAngle: 0,
    lightElev: 0.5,
    lightLevel: 1,
    glare: 0,
  }

  constructor(
    readonly chapter: Chapter,
    private readonly stage: Stage,
    private readonly quality: Quality,
  ) {
    this.water = new WaterField(bathymetrySeed(chapter.bathymetry))
    this.water.octaves = quality.settings.waterOctaves
    this.stage.layers.bed.addChild(this.bed.view)
    this.stage.layers.surfaceFx.addChild(this.bed.aboveView)

    this.bait = new BaitSchool(quality.settings.baitAgents, 5501)
    this.baitView = new BaitRenderer(quality.settings.baitAgents)
    this.worldLayer.addChild(this.baitView.view, this.fishView.view)
    this.worldLayer.eventMode = 'none'
    this.worldLayer.interactiveChildren = false
    this.stage.layers.fish.addChild(this.worldLayer)

    this.conditions = {
      willingness: 1,
      flow: 0,
      lightLevel: 1,
      depthAt: (x) => this.water.depthAt(x),
      bedDepth: (x) => this.water.bedDepth(x),
      surfaceY: (x, t) => this.water.surfaceY(x, t),
      baitAt: (x) => this.bait.densityAt(x),
      baitDepthAt: (x) => this.bait.depthAt(x),
    }

    this.spawnFish()
    // The chapter declares its cycle in in-game minutes; the compression factor
    // turns that into the 6 real minutes §13.7 asks for. Deriving it rather than
    // hard-coding 360s means the two figures can never drift apart.
    this.tideConfig = {
      ...DEFAULT_TIDE,
      cycleRealSeconds: (chapter.tideCycleMinutes * 60) / TIME_COMPRESSION,
      rangeM: TIDE.rangeM,
      meanM: TIDE.meanM,
    }
  }

  /**
   * Populate the water.
   *
   * A fixed number of fish: §13 asks the *behaviour* to change with the tide,
   * not the stock. A flat that empties of fish on the wrong tide teaches the
   * player nothing, because there is nothing to watch.
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

  update(dt: number, clock: Clock): void {
    const t = clock.simTime

    // Conditions. All three readings are written into pooled objects.
    readTide(t, this.tideConfig, this.tide)
    readLight(clock.hourOfDay, 0.5, this.light)
    readWind(t, this.chapter.wind.baseKt, this.chapter.wind.baseDirDeg, this.wind)

    this.water.windKt = this.wind.speedKt
    // Chop runs with the wind; the sign is all the shader needs.
    this.water.windDir = this.wind.x >= 0 ? 1 : -1
    this.water.flow = this.tide.flow
    this.water.tideOffsetM = this.tide.heightM - TIDE.meanM

    const vp = this.stage.viewport
    vp.tideOffsetM = this.water.tideOffsetM
    vp.update()

    // Willingness folds the tide and the light into one number the fish read.
    this.conditions.flow = this.tide.flow
    this.conditions.lightLevel = this.light.level
    this.conditions.willingness = this.willingnessFor(this.chapter.species[0]!)

    this.bait.update(dt, this.water, this.conditions, this.fish)
    for (const f of this.fish) f.update(dt, this.water, this.conditions, this.lure)

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

  private publishHud(clock: Clock): void {
    gameStore.getState().setHud({
      time: clock.format(),
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
    // Light angle: straight up at noon, laid over toward the horizon at the
    // ends of the day. The shader receives this and never sees the clock.
    s.lightAngle = this.light.azimuth * 1.15
    // Elevation runs 0-1.12 in readLight; normalise into the sky band.
    s.lightElev = Math.max(0, Math.min(1, this.light.elevation / 1.12))
    s.lightLevel = this.light.level
    // Glare is a mechanic (§8.2): it peaks with a high sun on a slick surface,
    // and chop breaks it up.
    const flatness = 1 - Math.min(1, this.wind.speedKt / 20)
    s.glare = Math.max(0, this.light.level - 0.55) * 2.2 * (0.45 + 0.55 * flatness)

    this.bed.tint(this.stage.livePalette)
    this.bed.follow(vp, this.stage.app.renderer.resolution)

    // World-space children draw in metres; one container carries the mapping.
    this.worldLayer.scale.set(vp.pxPerM)
    this.worldLayer.y = vp.waterlinePx

    const lightX = Math.sin(s.lightAngle)
    const lightY = Math.cos(s.lightAngle)
    const palette = this.stage.livePalette
    this.baitView.render(this.bait, palette)
    this.fishView.render(this.fish, clock.renderTime, palette, lightX, lightY, this.light.level)

    // Foam sources (§8.2): structure edges always, and the surface disturbance
    // of a bust-up wherever the school is actually being hammered.
    this.stage.beginFoam()
    for (const st of this.water.structures) {
      if (!st.overhangs) continue
      this.stage.addFoamSource(st.x, 0.30, st.radius * 1.3)
    }
    const shower = this.bait.surfaceActivity()
    if (shower > 0.004) this.stage.addFoamSource(this.bait.bustX, Math.min(1, shower * 9), 1.1)

    this.stage.render(clock.step, s)
  }

  setQuality(): void {
    this.water.octaves = this.quality.settings.waterOctaves
  }

  destroy(): void {
    this.bed.destroy()
    this.fishView.destroy()
    this.baitView.destroy()
  }
}

import type { Clock } from '../engine/clock.ts'
import type { Quality } from '../engine/quality.ts'
import { TIDE, TIME_COMPRESSION } from '../engine/tuning.ts'
import { gameStore } from '../engine/store.ts'
import { Bed } from '../render/bed.ts'
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

  /** Called once the stage knows its size. */
  layout(): void {
    const vp = this.stage.viewport
    this.water.setWorldWidth(vp.worldWidth)
    this.bed.bake(this.stage.app.renderer, this.water, vp)
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

    this.hudAccumulator += dt
    if (this.hudAccumulator >= 0.25) {
      this.hudAccumulator = 0
      this.publishHud(clock)
    }
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
    this.bed.follow(this.stage.viewport, this.stage.app.renderer.resolution)
    this.stage.render(clock.step, s)
  }

  setQuality(): void {
    this.water.octaves = this.quality.settings.waterOctaves
  }

  destroy(): void {
    this.bed.destroy()
  }
}

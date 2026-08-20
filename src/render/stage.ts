import { Application, Container, RenderTexture, Sprite, Texture, Ticker } from 'pixi.js'
import type { QualitySettings } from '../engine/quality.ts'
import { paletteAt } from '../art/palettes.ts'
import { PrintFilter, SubsurfaceFilter, SurfaceFilter, MAX_FOAM_SOURCES } from './filters.ts'
import { Layers, Viewport } from './layers.ts'

export interface SceneUniforms {
  timeSec: number
  windKt: number
  /** -1..1, chop direction along x. */
  windDir: number
  hourOfDay: number
  lightAngle: number
  /** 0 at the horizon, 1 at the top of the sky band. */
  lightElev: number
  lightLevel: number
  glare: number
}

/**
 * Owns the PixiJS canvas and drives the render passes by hand.
 *
 * Rendering is explicit rather than ticker-driven: §9 puts one authoritative
 * clock in charge, and Pixi's own ticker would be a second one.
 *
 * Pass order each frame:
 *   1. underwater layers  → underwaterRT   (offscreen, refraction source)
 *   2. surface row        → foam[next]     (W x 1, ping-pong for foam decay)
 *   3. composite + above  → screen         (subsurface filter, then print pass)
 */
export class Stage {
  readonly app = new Application()
  readonly layers = new Layers()
  readonly viewport = new Viewport()

  private underwaterRT!: RenderTexture
  private foam: [RenderTexture, RenderTexture] = [null!, null!]
  private foamIndex = 0
  private foamSprite!: Sprite
  private compositeSprite!: Sprite
  private surfaceFilter!: SurfaceFilter
  private subsurfaceFilter!: SubsurfaceFilter
  private printFilter: PrintFilter | null = null
  private root = new Container()

  private readonly palette = new Float32Array(18)
  /** Reused across frames — three object literals a frame is three too many. */
  private readonly renderOpts = { container: null as unknown as Container, target: null as unknown as RenderTexture, clear: true }
  private readonly foamData = new Float32Array(MAX_FOAM_SOURCES * 3)
  private foamCount = 0
  private quality!: QualitySettings
  private reducedMotion = false

  async init(canvas: HTMLCanvasElement, quality: QualitySettings, reducedMotion: boolean): Promise<void> {
    this.quality = quality
    this.reducedMotion = reducedMotion

    await this.app.init({
      canvas,
      // One shader language for the slice. Tier detection still reads WebGPU
      // support as a proxy for device class (§11).
      preference: 'webgl',
      antialias: false,
      backgroundAlpha: 1,
      background: 0x03070c,
      powerPreference: 'high-performance',
      autoStart: false,
      autoDensity: true,
      // A mid-range phone at 3x DPR is drawing 3x the fragments for detail no
      // one can see through a halftone screen. Cap it.
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      resizeTo: canvas.parentElement ?? undefined,
    })
    // §9 puts one authoritative clock in charge, and PixiJS's own tickers are
    // a second one. They are also the single largest allocator in the frame,
    // which matters when §11 asks for a render loop that allocates nothing.
    Ticker.shared.autoStart = false
    Ticker.shared.stop()
    Ticker.system.autoStart = false
    Ticker.system.stop()

    this.app.stage.addChild(this.root)
    this.buildTargets()
    this.app.renderer.on('resize', this.onResize)
    this.onResize()
  }

  private buildTargets(): void {
    const { width, height } = this.app.renderer
    this.underwaterRT = RenderTexture.create({ width, height, antialias: false })

    // The surface pass is a single row: the scene is side-on, so one sample per
    // screen column is the entire surface. This is why the water is cheap.
    const rowOpts = { width: Math.max(2, Math.round(width)), height: 1, antialias: false }
    this.foam = [RenderTexture.create(rowOpts), RenderTexture.create(rowOpts)]

    this.surfaceFilter = new SurfaceFilter(this.quality.waterOctaves)
    this.foamSprite = new Sprite(this.foam[0])
    this.foamSprite.filters = [this.surfaceFilter]

    this.subsurfaceFilter = new SubsurfaceFilter(this.quality.caustics, this.foam[1])
    this.compositeSprite = new Sprite(this.underwaterRT)
    this.compositeSprite.filters = [this.subsurfaceFilter]

    this.root.removeChildren()
    this.root.addChild(this.compositeSprite, this.layers.above)
    this.applyPrintPass()
  }

  private applyPrintPass(): void {
    const mode = this.quality.printPass
    if (mode === 'off') {
      this.printFilter = null
      this.app.stage.filters = []
      return
    }
    // §9: reduced motion disables misregistration, never the simulation.
    const misreg = mode === 'full' && !this.reducedMotion
    this.printFilter = new PrintFilter(misreg)
    this.printFilter.uniforms.uMisreg = misreg ? 1 : 0
    this.app.stage.filters = [this.printFilter]
  }

  setQuality(q: QualitySettings): void {
    this.quality = q
    this.buildTargets()
    this.onResize()
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v
    this.applyPrintPass()
  }

  private readonly onResize = (): void => {
    const { width, height } = this.app.renderer
    this.viewport.resize(width, height)

    this.underwaterRT.resize(width, height)
    this.foam[0].resize(Math.max(2, Math.round(width)), 1)
    this.foam[1].resize(Math.max(2, Math.round(width)), 1)
    this.foamSprite.width = width
    this.foamSprite.height = 1
    this.compositeSprite.width = width
    this.compositeSprite.height = height

    const u = this.subsurfaceFilter.uniforms
    u.uPixelHeight = 1 / height
    u.uAspect = width / height
    if (this.printFilter) {
      this.printFilter.uniforms.uResolution[0] = width
      this.printFilter.uniforms.uResolution[1] = height
      // Misregistration stays 1px at 1080p and does not scale with DPR — it is
      // a print tell, not a resolution artefact (§5.3).
      this.printFilter.uniforms.uMisreg = height >= 1000 ? 1 : 0.7
    }
  }

  /** Clear the foam source list. Call once per frame before adding sources. */
  beginFoam(): void {
    this.foamCount = 0
  }

  /** Structure edges and a hooked fish's thrash both deposit here (§8.2). */
  addFoamSource(worldX: number, strength: number, radiusM: number): void {
    if (this.foamCount >= MAX_FOAM_SOURCES) return
    const i = this.foamCount * 3
    this.foamData[i] = worldX
    this.foamData[i + 1] = strength
    this.foamData[i + 2] = radiusM
    this.foamCount += 1
  }

  render(dt: number, scene: SceneUniforms): void {
    const renderer = this.app.renderer
    const vp = this.viewport

    // 1. underwater scene, offscreen
    const opts = this.renderOpts
    opts.container = this.layers.underwater
    opts.target = this.underwaterRT
    renderer.render(opts)

    // 2. surface row, ping-ponged so foam can accumulate and decay
    const su = this.surfaceFilter.uniforms
    su.uTime = scene.timeSec
    su.uWindKt = scene.windKt
    su.uWindDir = scene.windDir
    su.uWorldWidth = vp.worldWidth
    su.uDt = dt
    su.uFoamCount = this.foamCount
    su.uFoam.set(this.foamData)

    const src = this.foamIndex
    const dst = src ^ 1
    this.foamSprite.texture = this.foam[src] as unknown as Texture
    opts.container = this.foamSprite as unknown as Container
    opts.target = this.foam[dst]
    renderer.render(opts)
    this.foamIndex = dst
    this.subsurfaceFilter.setSurfaceTexture(this.foam[dst] as unknown as Texture)

    // 3. composite + above-water layers, through the print pass
    const wu = this.subsurfaceFilter.uniforms
    paletteAt(scene.hourOfDay, this.palette)
    wu.uPalette.set(this.palette)
    wu.uTime = scene.timeSec
    wu.uWaterlineY = vp.waterlineFrac
    wu.uWorldHeight = vp.worldHeight
    wu.uLightAngle = scene.lightAngle
    wu.uLightElev = scene.lightElev
    wu.uLightLevel = scene.lightLevel
    wu.uGlare = scene.glare

    renderer.render(this.app.stage)
  }

  /** Live palette, linear RGB, for code-generated art that must match (§5.1). */
  get livePalette(): Float32Array {
    return this.palette
  }

  destroy(): void {
    this.app.renderer?.off('resize', this.onResize)
    this.app.destroy(true, { children: true })
  }
}

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
  private resizeObserver: ResizeObserver | null = null
  private stopWatching: (() => void) | null = null

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
    this.watchSize(canvas.parentElement ?? canvas)
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

  /**
   * Keep the canvas the size of its container, and keep checking.
   *
   * A ResizeObserver on the element rather than PixiJS's own `resizeTo`, which
   * listens for the window's resize event. On Android that event can arrive
   * before layout has caught up with a rotation, so the measurement is of the
   * shape the page used to be, and nothing fires again to correct it — the
   * canvas is left at its portrait width on a landscape screen, rendering into
   * a slice of the display with the rest left black. A ResizeObserver reports
   * the element's box after layout, every time it changes, which is the
   * question being asked.
   *
   * The watchdog is here because that is one cause of a mis-sized canvas and
   * not necessarily the only one — this game is landscape-only, so every
   * player rotates their phone, and a rotation is exactly when a mobile
   * browser is least sure of its own viewport. Whatever leaves the renderer
   * disagreeing with its container, a second is the longest it can last. It
   * costs two integer reads.
   */
  private watchSize(container: HTMLElement): void {
    const apply = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      // A zero measurement happens while the element is off-layout. Resizing to
      // it would divide the world by nothing; wait for a real one.
      if (width < 1 || height < 1) return
      if (this.app.renderer.width === width && this.app.renderer.height === height) return
      this.app.renderer.resize(width, height)
    }

    // A rotation on Android settles over several frames, and the box can change
    // more than once on the way. Re-ask across the next second rather than
    // trusting the first answer.
    const settle = () => {
      apply()
      for (const ms of [50, 150, 400, 900]) setTimeout(apply, ms)
    }

    this.resizeObserver = new ResizeObserver(apply)
    this.resizeObserver.observe(container)
    globalThis.addEventListener('orientationchange', settle)
    globalThis.addEventListener('resize', settle)
    globalThis.visualViewport?.addEventListener('resize', settle)
    const watchdog = setInterval(apply, 1000)

    this.stopWatching = () => {
      clearInterval(watchdog)
      this.resizeObserver?.disconnect()
      globalThis.removeEventListener('orientationchange', settle)
      globalThis.removeEventListener('resize', settle)
      globalThis.visualViewport?.removeEventListener('resize', settle)
    }
    apply()
    this.onResize()
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
    this.stopWatching?.()
    this.app.renderer?.off('resize', this.onResize)
    this.app.destroy(true, { children: true })
  }
}

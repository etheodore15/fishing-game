import { Container } from 'pixi.js'

/**
 * World space is metres. x runs right from the angler's gunwale, y runs down
 * from mean water level, so y is literally depth and the species JSON's
 * habitat.depthM needs no conversion.
 *
 * The scale is uniform in both axes — a 60cm flathead has to be 60cm long
 * whichever way it is pointing.
 */
export class Viewport {
  widthPx = 1
  heightPx = 1
  pxPerM = 1
  /** Screen y (px) of mean water level. Tide moves this. */
  waterlinePx = 0
  /** Screen y fraction of mean water level, for the water shader. */
  waterlineFrac = 0.29
  /** Metres of world visible across the viewport. */
  worldWidth = 14
  /** Metres of world visible top to bottom. */
  worldHeight = 7.0

  /** Screen y (px) of MEAN water level, ignoring the tide. Baked art uses this
   *  so a tide change is a translation rather than a re-rasterisation. */
  meanWaterlinePx = 0

  /** Metres of sky shown above mean water level at the default framing. */
  private readonly airM = 1.8
  /** Metres of water shown below mean water level. */
  private readonly waterM = 5.2

  /** Tide offset in metres, added to the waterline. */
  tideOffsetM = 0

  resize(widthPx: number, heightPx: number): void {
    this.widthPx = widthPx
    this.heightPx = heightPx
    this.worldHeight = this.airM + this.waterM
    this.pxPerM = heightPx / this.worldHeight
    this.worldWidth = widthPx / this.pxPerM
    this.update()
  }

  /** Recompute the waterline after a tide change. */
  update(): void {
    this.meanWaterlinePx = this.airM * this.pxPerM
    const airPx = (this.airM - this.tideOffsetM) * this.pxPerM
    this.waterlinePx = airPx
    this.waterlineFrac = airPx / this.heightPx
  }

  toScreenX(wx: number): number {
    return wx * this.pxPerM
  }

  toScreenY(wy: number): number {
    return this.waterlinePx + wy * this.pxPerM
  }

  toWorldX(sx: number): number {
    return sx / this.pxPerM
  }

  toWorldY(sy: number): number {
    return (sy - this.waterlinePx) / this.pxPerM
  }
}

/**
 * Layer stack. Everything below the waterline goes into `underwater`, which is
 * rendered offscreen so the subsurface pass can refract it; everything above
 * draws straight over the composited water.
 */
export class Layers {
  /** Bathymetry and structure, baked to a texture and redrawn only on change. */
  readonly bed = new Container()
  readonly bait = new Container()
  readonly fish = new Container()
  readonly submerged = new Container()
  /** Rendered offscreen into the refraction source. */
  readonly underwater = new Container()

  readonly rod = new Container()
  readonly line = new Container()
  readonly surfaceFx = new Container()
  /** Composited over the finished water. */
  readonly above = new Container()

  constructor() {
    this.underwater.addChild(this.bed, this.bait, this.fish, this.submerged)
    this.above.addChild(this.rod, this.line, this.surfaceFx)
    // Nothing in the world is interactive: input is gestural, routed through
    // engine/input.ts. Skipping hit-testing keeps the pointer path cheap.
    this.underwater.eventMode = 'none'
    this.above.eventMode = 'none'
    this.underwater.interactiveChildren = false
    this.above.interactiveChildren = false
  }
}

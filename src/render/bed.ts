import { Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { rng } from '../art/noise.ts'
import { SLOT, slotInt, slotIntSRGB } from '../art/palettes.ts'
import { TIDE } from '../engine/tuning.ts'
import type { WaterField } from '../sim/water.ts'
import type { Viewport } from './layers.ts'

/**
 * Bathymetry and structure, baked once and tinted live (§11).
 *
 * Two things make the bake hold for a whole trip:
 *
 * 1. The bed is a flat separation in a screen print, so it needs exactly one
 *    colour — it is baked white and tinted from the live palette every frame,
 *    instead of being re-rasterised whenever the light changes.
 * 2. It is baked against MEAN water level, not the live waterline. A tide
 *    change is then a vertical translation of two sprites rather than a
 *    rebuild, which matters when the tide moves every single frame.
 *
 * The texture carries a tide-range margin top and bottom so the translation
 * never exposes an empty edge.
 */
export class Bed {
  readonly view = new Container()
  /** The part of the structure standing out of the water. */
  readonly aboveView = new Container()

  private bedSprite = new Sprite()
  private structureSprite = new Sprite()
  private aboveSprite = new Sprite()
  private bedRT: RenderTexture | null = null
  private structureRT: RenderTexture | null = null
  private lastKey = ''
  /** Vertical padding baked into the texture, in CSS pixels. */
  private marginPx = 0
  private baseY = 0

  constructor() {
    this.view.addChild(this.bedSprite, this.structureSprite)
    this.aboveView.addChild(this.aboveSprite)
  }

  /** Rebake only when the framing actually changed. */
  bake(renderer: import('pixi.js').Renderer, water: WaterField, vp: Viewport): void {
    const key = `${Math.round(vp.widthPx)}x${Math.round(vp.heightPx)}:${water.structures.length}`
    if (key === this.lastKey) return
    this.lastKey = key

    // Enough margin for the full tidal range in either direction.
    this.marginPx = Math.ceil((TIDE.rangeM / 2 + 0.1) * vp.pxPerM)
    const w = Math.max(2, Math.round(vp.widthPx))
    const h = Math.max(2, Math.round(vp.heightPx + this.marginPx * 2))

    this.bedRT?.destroy(true)
    this.structureRT?.destroy(true)
    this.bedRT = RenderTexture.create({ width: w, height: h, antialias: true })
    this.structureRT = RenderTexture.create({ width: w, height: h, antialias: true })

    const g = new Graphics()
    this.drawBed(g, water, vp)
    renderer.render({ container: g, target: this.bedRT, clear: true })
    g.clear()
    this.drawBedEdge(g, water, vp)
    this.drawStructures(g, water, vp)
    renderer.render({ container: g, target: this.structureRT, clear: true })
    g.destroy()

    this.bedSprite.texture = this.bedRT
    this.structureSprite.texture = this.structureRT
    this.aboveSprite.texture = new Texture({ source: this.structureRT.source })
    this.baseY = -this.marginPx
  }

  /** World y (metres below mean water) → y within the baked texture. */
  private bakeY(vp: Viewport, wy: number): number {
    return this.marginPx + vp.meanWaterlinePx + wy * vp.pxPerM
  }

  private drawBed(g: Graphics, water: WaterField, vp: Viewport): void {
    // Sample the bed once per few pixels — any finer is invisible under the
    // halftone, any coarser shows as facets on the drop-off.
    const stepPx = 4
    const bottom = vp.heightPx + this.marginPx * 2
    g.moveTo(0, bottom)
    for (let px = 0; px <= vp.widthPx; px += stepPx) {
      g.lineTo(px, this.bakeY(vp, water.bedDepth(vp.toWorldX(px))))
    }
    g.lineTo(vp.widthPx, bottom)
    g.closePath()
    g.fill({ color: 0xffffff })
  }

  /** The hand-drawn line along the top of the bed. */
  private drawBedEdge(g: Graphics, water: WaterField, vp: Viewport): void {
    const stepPx = 4
    g.moveTo(0, this.bakeY(vp, water.bedDepth(0)))
    for (let px = stepPx; px <= vp.widthPx; px += stepPx) {
      g.lineTo(px, this.bakeY(vp, water.bedDepth(vp.toWorldX(px))))
    }
    g.stroke({ color: 0xffffff, width: 2.2, alpha: 0.85 })
  }

  private drawStructures(g: Graphics, water: WaterField, vp: Viewport): void {
    for (const s of water.structures) {
      const cx = vp.toScreenX(s.x)
      const rPx = vp.toScreenX(s.radius)

      if (s.kind === 'weed-edge') {
        // Ribbon weed: strands of varying height off the bed, hand-drawn weight.
        const rand = rng(9101)
        const strands = Math.max(8, Math.round((rPx * 2) / 7))
        for (let i = 0; i < strands; i++) {
          const px = cx - rPx + (i / (strands - 1)) * rPx * 2
          const base = this.bakeY(vp, water.bedDepth(vp.toWorldX(px)))
          const len = (0.22 + rand() * 0.46) * vp.pxPerM
          const lean = (rand() - 0.5) * 0.5 * len
          g.moveTo(px, base)
          g.quadraticCurveTo(px + lean * 0.4, base - len * 0.6, px + lean, base - len)
          g.stroke({ color: 0xffffff, width: 1.6 + rand(), alpha: 0.9, cap: 'round' })
        }
      } else if (s.kind === 'sand-drop') {
        // The drop is already in the bed silhouette; this is the scour line
        // along its lip, which is the actual thing you cast to.
        const from = cx - rPx
        const to = cx + rPx
        g.moveTo(from, this.bakeY(vp, water.bedDepth(vp.toWorldX(from))) - 2)
        for (let px = from; px <= to; px += 5) {
          g.lineTo(px, this.bakeY(vp, water.bedDepth(vp.toWorldX(px))) - 2)
        }
        g.stroke({ color: 0xffffff, width: 2, alpha: 0.55 })
      } else {
        // Oyster racks: posts and rails. They stand above mean water, so the
        // tide takes them from awash to fully exposed within a single cycle.
        const topY = this.bakeY(vp, s.y)
        const bedY = this.bakeY(vp, water.bedDepth(s.x))
        const posts = 5
        for (let i = 0; i < posts; i++) {
          const px = cx - rPx + (i / (posts - 1)) * rPx * 2
          g.moveTo(px, bedY)
          g.lineTo(px + (i - 2) * 1.5, topY)
          g.stroke({ color: 0xffffff, width: 3.4, cap: 'square' })
        }
        for (const railT of [0.02, 0.16]) {
          const y = topY + (bedY - topY) * railT
          g.moveTo(cx - rPx, y)
          g.lineTo(cx + rPx, y + 2)
          g.stroke({ color: 0xffffff, width: 2.6, cap: 'square' })
        }
      }
    }
  }

  /**
   * Track the waterline.
   *
   * The bed itself does NOT move: it is the bottom of an estuary, and the whole
   * point of a tide is that the water moves and the ground does not. What moves
   * is the cut between the submerged sprite and the one drawn over the water —
   * which is how the oyster racks go from awash to standing clear.
   */
  follow(vp: Viewport, resolution: number): void {
    const y = this.baseY
    this.view.y = y
    this.aboveView.y = y

    const tex = this.aboveSprite.texture
    if (!tex.source.width) return
    // Show only the rows of the bake that are above the live waterline.
    const cut = Math.round((vp.waterlinePx - y) * resolution)
    const clamped = Math.max(0, Math.min(tex.source.height, cut))
    this.aboveSprite.visible = clamped > 1
    if (!this.aboveSprite.visible || clamped === tex.frame.height) return
    tex.frame.x = 0
    tex.frame.y = 0
    tex.frame.width = tex.source.width
    tex.frame.height = clamped
    tex.updateUvs()
    this.aboveSprite.width = tex.frame.width / resolution
    this.aboveSprite.height = tex.frame.height / resolution
  }

  /** Tint from the live palette. Called every frame; costs nothing. */
  tint(palette: Float32Array): void {
    // Sand takes the shallow tone and structure takes the darkest, so the racks
    // and the weed read as silhouettes against the bottom rather than melting
    // into the depth fog.
    this.bedSprite.tint = slotInt(palette, SLOT.shallow)
    this.structureSprite.tint = slotInt(palette, SLOT.deep)
    // This one composites straight over the finished water, so it is encoded.
    this.aboveSprite.tint = slotIntSRGB(palette, SLOT.deep)
  }

  destroy(): void {
    this.bedRT?.destroy(true)
    this.structureRT?.destroy(true)
    this.view.destroy({ children: true })
    this.aboveView.destroy({ children: true })
  }
}

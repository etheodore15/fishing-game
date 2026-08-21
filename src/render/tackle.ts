import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js'
import {
  LURE_LENGTH_M,
  LURE_MAX_HALF,
  LURE_STATIONS,
  lureShade,
  lureHalf,
  lureHeading,
  lureX,
  lureY,
  solveLure,
  type LurePose,
} from '../art/lureRig.ts'
import { SEGMENTS } from '../sim/line.ts'
import { ROD_SAMPLES } from '../sim/rod.ts'
import type { FishingLine } from '../sim/line.ts'
import type { Rod } from '../sim/rod.ts'
import type { LureState } from '../sim/types.ts'
import tackleVert from './shaders/tackle.vert?raw'
import tackleFrag from './shaders/tackle.frag?raw'

const PROGRAM = GlProgram.from({ vertex: tackleVert, fragment: tackleFrag, name: 'tackle' })

const FLOATS_PER_VERTEX = 3
/** Line points, rod samples and lure stations, each a pair of ribbon vertices. */
const LINE_POINTS = SEGMENTS + 1
const ROD_BASE = LINE_POINTS
const LURE_BASE = LINE_POINTS + ROD_SAMPLES
const TOTAL_POINTS = LURE_BASE + LURE_STATIONS

/**
 * Rod, line and lure, drawn as tapered ribbons in one mesh (§8.3, §8.4).
 *
 * Widths are in metres and converted by the world container's scale, so the
 * line is genuinely 2px at the rod tip narrowing to 1px at any screen density
 * that matters — a hairline that survives the halftone pass.
 */
export class TackleRenderer {
  readonly view = new Container()
  private readonly vertices = new Float32Array(TOTAL_POINTS * 2 * FLOATS_PER_VERTEX)
  private readonly buffer: Buffer
  private readonly mesh: Mesh<Geometry, Shader>
  private readonly uniforms: { uPalette: Float32Array; uAlpha: number }

  constructor() {
    this.buffer = new Buffer({ data: this.vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST })

    // Three independent strips: the line, the rod blank, the lure. They never
    // join, so each is indexed separately rather than as one run.
    const idx: number[] = []
    const strip = (base: number, points: number) => {
      for (let i = 0; i < points - 1; i++) {
        const a = base + i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    strip(0, LINE_POINTS)
    strip(ROD_BASE * 2, ROD_SAMPLES)
    strip(LURE_BASE * 2, LURE_STATIONS)

    const stride = FLOATS_PER_VERTEX * 4
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.buffer, format: 'float32x2', stride, offset: 0 },
        aShade: { buffer: this.buffer, format: 'float32', stride, offset: 8 },
      },
      indexBuffer: new Uint32Array(idx),
    })

    const group = new UniformGroup({
      uPalette: { value: new Float32Array(18), type: 'vec3<f32>', size: 6 },
      uAlpha: { value: 1, type: 'f32' },
    })
    this.uniforms = group.uniforms as typeof this.uniforms

    this.mesh = new Mesh({
      geometry,
      shader: new Shader({ glProgram: PROGRAM, resources: { tackleUniforms: group } }),
    })
    this.mesh.eventMode = 'none'
    this.view.addChild(this.mesh)
    this.view.eventMode = 'none'
    this.view.interactiveChildren = false
  }

  /** Smoothed, so the plastic swings round rather than snapping to a new angle. */
  private lureAngle = Math.PI / 2
  /**
   * Reused. §11 asks the render loop to allocate nothing, and a fresh pose
   * literal sixty times a second is exactly the kind of thing that does not
   * show up until a phone starts dropping frames to collect it.
   */
  private readonly lurePose: LurePose = {
    x: 0, y: 0, heading: 0, lengthM: LURE_LENGTH_M, t: 0, drive: 0,
  }

  /**
   * @param tension 0-1. The line pales toward palette[5] as it loads (§8.3).
   * @param pxPerM  so ribbon widths can be specified in pixels and held there.
   */
  render(
    line: FishingLine,
    rod: Rod,
    lure: LureState,
    tension: number,
    lineVisible: boolean,
    lureVisible: boolean,
    dt: number,
    t: number,
    pxPerM: number,
    palette: Float32Array,
  ): void {
    const v = this.vertices
    const px = 1 / Math.max(1, pxPerM)

    // ---- line: 2px at the rod tip, 1px at the lure ----
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / SEGMENTS
      const halfWidth = lineVisible ? (px * (2 - t)) / 2 : 0
      const [nx, ny] = normalAt(line.x, line.y, i, LINE_POINTS)
      writePair(v, i, line.x[i]!, line.y[i]!, nx * halfWidth, ny * halfWidth, tension)
    }

    // ---- rod blank: thick at the butt, a whip at the tip ----
    for (let i = 0; i < ROD_SAMPLES; i++) {
      const u = i / (ROD_SAMPLES - 1)
      const halfWidth = (px * (7 - 5.6 * u)) / 2
      const [nx, ny] = normalAt(rod.x, rod.y, i, ROD_SAMPLES)
      writePair(v, ROD_BASE + i, rod.x[i]!, rod.y[i]!, nx * halfWidth, ny * halfWidth, 0)
    }

    // ---- lure: a paddle-tail plastic, working or hanging ----
    //
    // How hard the tail is beating is the retrieve, told back to the player:
    // the speed it is being drawn at, plus whatever the last twitch or hop put
    // into it. A lure sitting on the bottom does not move, and that stillness
    // is information — it is the difference between fishing and waiting.
    this.lureAngle = lureHeading(lure.vx, lure.vy, this.lureAngle, dt)
    const drive = lureVisible ? Math.min(1, lure.speed * 0.85 + lure.kick * 0.75) : 0
    const pose = this.lurePose
    pose.x = lure.x
    pose.y = lure.y
    pose.heading = this.lureAngle
    pose.t = t
    pose.drive = drive
    solveLure(pose)
    // The whole profile is scaled together rather than each station being
    // floored on its own: a minimum width applied per-station turns a tapered
    // body into a sausage, and the taper is the only reason it reads as a lure.
    const widen = Math.max(1, (px * 1.8) / (LURE_MAX_HALF * LURE_LENGTH_M))
    for (let i = 0; i < LURE_STATIONS; i++) {
      const [nx, ny] = normalAt(lureX, lureY, i, LURE_STATIONS)
      const halfWidth = lureVisible ? lureHalf[i]! * widen : 0
      writePair(v, LURE_BASE + i, lureX[i]!, lureY[i]!, nx * halfWidth, ny * halfWidth, lureShade[i]!)
    }

    this.buffer.update()
    this.uniforms.uPalette.set(palette)
  }

  destroy(): void {
    this.mesh.destroy(true)
    this.view.destroy({ children: true })
  }
}

/** Reused so the ribbon builder allocates nothing per frame. */
const normalScratch: [number, number] = [0, 0]

function normalAt(xs: Float32Array, ys: Float32Array, i: number, n: number): [number, number] {
  const a = i === 0 ? 0 : i - 1
  const b = i === n - 1 ? i : i + 1
  const dx = xs[b]! - xs[a]!
  const dy = ys[b]! - ys[a]!
  const len = Math.hypot(dx, dy) || 1
  normalScratch[0] = -dy / len
  normalScratch[1] = dx / len
  return normalScratch
}

function writePair(
  v: Float32Array,
  point: number,
  x: number,
  y: number,
  ox: number,
  oy: number,
  shade: number,
): void {
  let o = point * 2 * FLOATS_PER_VERTEX
  v[o] = x + ox
  v[o + 1] = y + oy
  v[o + 2] = shade
  o += FLOATS_PER_VERTEX
  v[o] = x - ox
  v[o + 1] = y - oy
  v[o + 2] = shade
}

import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js'
import type { BaitSchool } from '../sim/boids.ts'
import baitVert from './shaders/bait.vert?raw'
import baitFrag from './shaders/bait.frag?raw'

const PROGRAM = GlProgram.from({ vertex: baitVert, fragment: baitFrag, name: 'bait-marks' })

const FLOATS_PER_VERTEX = 3
const VERTS_PER_AGENT = 4

/** Mark size in metres. At a phone's scale this lands on about 3px (§8.5). */
const MARK_LENGTH = 0.030
const MARK_WIDTH = 0.011

/**
 * The whole school in one draw call.
 *
 * Each agent is a short dash oriented along its own velocity, rendered
 * interpolated between 30Hz simulation steps so the marks move at 60fps
 * without the simulation having to.
 */
export class BaitRenderer {
  readonly view = new Container()
  private readonly vertices: Float32Array
  private readonly buffer: Buffer
  private readonly mesh: Mesh<Geometry, Shader>
  private readonly uniforms: { uPalette: Float32Array; uAlpha: number }

  constructor(readonly capacity: number) {
    this.vertices = new Float32Array(capacity * VERTS_PER_AGENT * FLOATS_PER_VERTEX)
    this.buffer = new Buffer({ data: this.vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST })

    const indices = new Uint32Array(capacity * 6)
    for (let i = 0; i < capacity; i++) {
      const v = i * 4
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6)
    }

    const stride = FLOATS_PER_VERTEX * 4
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.buffer, format: 'float32x2', stride, offset: 0 },
        aFlash: { buffer: this.buffer, format: 'float32', stride, offset: 8 },
      },
      indexBuffer: indices,
    })

    const group = new UniformGroup({
      uPalette: { value: new Float32Array(18), type: 'vec3<f32>', size: 6 },
      uAlpha: { value: 0.95, type: 'f32' },
    })
    this.uniforms = group.uniforms as typeof this.uniforms

    this.mesh = new Mesh({
      geometry,
      shader: new Shader({ glProgram: PROGRAM, resources: { baitUniforms: group } }),
    })
    this.mesh.eventMode = 'none'
    this.view.addChild(this.mesh)
    this.view.eventMode = 'none'
    this.view.interactiveChildren = false
  }

  render(school: BaitSchool, palette: Float32Array): void {
    const n = Math.min(school.count, this.capacity)
    const a = school.alpha
    const v = this.vertices

    for (let i = 0; i < n; i++) {
      // Interpolate between the last two 30Hz steps.
      const x = school.px[i]! + (school.x[i]! - school.px[i]!) * a
      const y = school.py[i]! + (school.y[i]! - school.py[i]!) * a

      let dx = school.vx[i]!
      let dy = school.vy[i]!
      const len = Math.hypot(dx, dy)
      if (len < 1e-4) {
        dx = 1
        dy = 0
      } else {
        dx /= len
        dy /= len
      }

      // A frightened fish is stretched out and swimming hard, so its mark runs
      // longer. The flash comes from the same panic value.
      const panic = school.panic[i]!
      const half = (MARK_LENGTH * (1 + panic * 0.7)) / 2
      const w = MARK_WIDTH / 2
      const nx = -dy * w
      const ny = dx * w
      const hx = dx * half
      const hy = dy * half
      const flash = panic * 0.85

      let o = i * VERTS_PER_AGENT * FLOATS_PER_VERTEX
      v[o] = x - hx + nx; v[o + 1] = y - hy + ny; v[o + 2] = flash
      o += FLOATS_PER_VERTEX
      v[o] = x - hx - nx; v[o + 1] = y - hy - ny; v[o + 2] = flash
      o += FLOATS_PER_VERTEX
      v[o] = x + hx + nx; v[o + 1] = y + hy + ny; v[o + 2] = flash
      o += FLOATS_PER_VERTEX
      v[o] = x + hx - nx; v[o + 1] = y + hy - ny; v[o + 2] = flash
    }

    // Collapse any unused agents to a degenerate point rather than reallocating.
    for (let i = n; i < this.capacity; i++) {
      v.fill(0, i * VERTS_PER_AGENT * FLOATS_PER_VERTEX, (i + 1) * VERTS_PER_AGENT * FLOATS_PER_VERTEX)
    }

    this.buffer.update()
    this.uniforms.uPalette.set(palette)
  }

  destroy(): void {
    this.mesh.destroy(true)
    this.view.destroy({ children: true })
  }
}

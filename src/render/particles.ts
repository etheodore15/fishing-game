import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js'
import type { ParticleField } from '../sim/particles.ts'
import particleVert from './shaders/particle.vert?raw'
import particleFrag from './shaders/particle.frag?raw'

const PROGRAM = GlProgram.from({ vertex: particleVert, fragment: particleFrag, name: 'particles' })

const FLOATS_PER_VERTEX = 4
const VERTS_PER_PARTICLE = 4

/** The whole field in one draw call. */
export class ParticleRenderer {
  readonly view = new Container()
  private readonly vertices: Float32Array
  private readonly buffer: Buffer
  private readonly mesh: Mesh<Geometry, Shader>
  private readonly uniforms: { uPalette: Float32Array; uEncode: number }

  /**
   * @param encodeSRGB true for the layer that draws over the finished water,
   *                   false for the one that draws into the refraction target.
   */
  readonly capacity: number

  constructor(capacity: number, encodeSRGB: boolean) {
    this.capacity = capacity
    this.vertices = new Float32Array(capacity * VERTS_PER_PARTICLE * FLOATS_PER_VERTEX)
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
        aData: { buffer: this.buffer, format: 'float32x2', stride, offset: 8 },
      },
      indexBuffer: indices,
    })

    const group = new UniformGroup({
      uPalette: { value: new Float32Array(18), type: 'vec3<f32>', size: 6 },
      uEncode: { value: encodeSRGB ? 1 : 0, type: 'f32' },
    })
    this.uniforms = group.uniforms as typeof this.uniforms

    this.mesh = new Mesh({
      geometry,
      shader: new Shader({ glProgram: PROGRAM, resources: { particleUniforms: group } }),
    })
    this.mesh.eventMode = 'none'
    this.view.addChild(this.mesh)
    this.view.eventMode = 'none'
    this.view.interactiveChildren = false
  }

  render(field: ParticleField, palette: Float32Array): void {
    const v = this.vertices
    const n = Math.min(field.capacity, this.capacity)

    for (let i = 0; i < n; i++) {
      const o = i * VERTS_PER_PARTICLE * FLOATS_PER_VERTEX
      const life = field.life[i]!
      if (life <= 0) {
        // Collapse dead particles rather than compacting the array.
        v.fill(0, o, o + VERTS_PER_PARTICLE * FLOATS_PER_VERTEX)
        continue
      }
      const t = life / Math.max(1e-4, field.maxLife[i]!)
      const alpha = t * t
      const slot = field.slotFor(i)
      // Marks stretch along their own travel — a splash droplet is a streak,
      // not a dot, and a rising bubble is not the same shape as spray.
      let dx = field.vx[i]!
      let dy = field.vy[i]!
      const speed = Math.hypot(dx, dy)
      const s = field.size[i]!
      const long = s * (1 + Math.min(2.5, speed * 0.5))
      if (speed < 1e-4) {
        dx = 1
        dy = 0
      } else {
        dx /= speed
        dy /= speed
      }
      const hx = dx * long * 0.5
      const hy = dy * long * 0.5
      const nx = -dy * s * 0.5
      const ny = dx * s * 0.5
      const x = field.x[i]!
      const y = field.y[i]!

      write(v, o, x - hx + nx, y - hy + ny, slot, alpha)
      write(v, o + FLOATS_PER_VERTEX, x - hx - nx, y - hy - ny, slot, alpha)
      write(v, o + FLOATS_PER_VERTEX * 2, x + hx + nx, y + hy + ny, slot, alpha)
      write(v, o + FLOATS_PER_VERTEX * 3, x + hx - nx, y + hy - ny, slot, alpha)
    }

    this.buffer.update()
    this.uniforms.uPalette.set(palette)
  }

  destroy(): void {
    this.mesh.destroy(true)
    this.view.destroy({ children: true })
  }
}

function write(v: Float32Array, o: number, x: number, y: number, slot: number, alpha: number): void {
  v[o] = x
  v[o + 1] = y
  v[o + 2] = slot
  v[o + 3] = alpha
}

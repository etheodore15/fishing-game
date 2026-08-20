import { Buffer, BufferUsage, Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js'
import {
  FLOATS_PER_VERTEX,
  VERTEX_COUNT,
  buildIndices,
  poseFish,
  type FishPose,
} from '../art/fishRig.ts'
import type { Species } from '../content/schema.ts'
import type { Fish } from '../sim/fish.ts'
import fishVert from './shaders/fish.vert?raw'
import fishFrag from './shaders/fish.frag?raw'

const MARK_TYPE: Record<string, number> = { none: 0, ocelli: 1, stripes: 2, spots: 3 }

/** Shared across every fish — the topology is identical for all species. */
const INDICES = buildIndices()

/** Compiled once and shared: every fish runs the same program. */
const PROGRAM = GlProgram.from({ vertex: fishVert, fragment: fishFrag, name: 'fish-rig' })

/**
 * One fish, one mesh, one draw call.
 *
 * Species differences are uniforms and vertex data, never code (§8.1). The
 * vertex buffer is written in place every frame from the rig — nothing here
 * allocates once it is built.
 */
class FishMesh {
  readonly mesh: Mesh<Geometry, Shader>
  private readonly vertices: Float32Array
  private readonly buffer: Buffer
  private readonly uniforms: {
    uPalette: Float32Array
    uDorsalIdx: number
    uVentralIdx: number
    uIridescence: number
    uMarkType: number
    uMarkCount: number
    uMarkSeed: number
    uLightDir: Float32Array
    uLightLevel: number
    uAlpha: number
  }

  constructor(species: Species) {
    this.vertices = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX)
    this.buffer = new Buffer({ data: this.vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST })
    const stride = FLOATS_PER_VERTEX * 4

    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.buffer, format: 'float32x2', stride, offset: 0 },
        aUV: { buffer: this.buffer, format: 'float32x2', stride, offset: 8 },
        aRole: { buffer: this.buffer, format: 'float32', stride, offset: 16 },
        aFlank: { buffer: this.buffer, format: 'float32', stride, offset: 20 },
      },
      indexBuffer: INDICES,
    })

    const group = new UniformGroup({
      uPalette: { value: new Float32Array(18), type: 'vec3<f32>', size: 6 },
      uDorsalIdx: { value: species.palette.dorsalIdx, type: 'f32' },
      uVentralIdx: { value: species.palette.ventralIdx, type: 'f32' },
      uIridescence: { value: species.palette.iridescence, type: 'f32' },
      uMarkType: { value: MARK_TYPE[species.markings.type] ?? 0, type: 'i32' },
      uMarkCount: { value: Math.min(16, species.markings.count), type: 'i32' },
      uMarkSeed: { value: species.markings.seed, type: 'f32' },
      uLightDir: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
      uLightLevel: { value: 1, type: 'f32' },
      uAlpha: { value: 1, type: 'f32' },
    })
    this.uniforms = group.uniforms as typeof this.uniforms

    this.mesh = new Mesh({
      geometry,
      shader: new Shader({ glProgram: PROGRAM, resources: { fishUniforms: group } }),
    })
    // Nothing in the water is hit-tested; input is gestural.
    this.mesh.eventMode = 'none'
  }

  write(species: Species, pose: FishPose): void {
    poseFish(species, pose, this.vertices, 0)
    this.buffer.update()
  }

  setScene(palette: Float32Array, lightX: number, lightY: number, lightLevel: number, alpha: number): void {
    this.uniforms.uPalette.set(palette)
    this.uniforms.uLightDir[0] = lightX
    this.uniforms.uLightDir[1] = lightY
    this.uniforms.uLightLevel = lightLevel
    this.uniforms.uAlpha = alpha
  }

  destroy(): void {
    this.mesh.destroy(true)
  }
}

/**
 * Draws every fish in the scene.
 *
 * Meshes are pooled by species and reused as fish come and go, so a fish
 * spooking off and another moving in costs no allocation.
 */
export class FishRenderer {
  readonly view = new Container()
  private readonly meshes = new Map<number, FishMesh>()
  private readonly pool: FishMesh[] = []
  private readonly pose: FishPose = {
    x: 0, y: 0, heading: 0, lengthM: 0.5, t: 0,
    omega: 1, ampScale: 1, turnBias: 0, phase: 0, finPhase: 0,
  }
  private readonly seen = new Set<number>()
  private readonly retire: number[] = []

  constructor() {
    this.view.eventMode = 'none'
    this.view.interactiveChildren = false
  }

  render(
    fishes: readonly Fish[],
    t: number,
    palette: Float32Array,
    lightX: number,
    lightY: number,
    lightLevel: number,
  ): void {
    this.seen.clear()

    for (const fish of fishes) {
      this.seen.add(fish.id)
      let fm = this.meshes.get(fish.id)
      if (!fm) {
        fm = this.pool.pop() ?? new FishMesh(fish.species)
        this.meshes.set(fish.id, fm)
        this.view.addChild(fm.mesh)
      }
      fish.writePose(this.pose, t)
      fm.write(fish.species, this.pose)
      // A spooked fish fades as it reaches the edge of the scene rather than
      // popping out of existence.
      const alpha = fish.state === 'spook' ? 0.55 + 0.45 * Math.min(1, fish.spookTimer / 2) : 1
      fm.setScene(palette, lightX, lightY, lightLevel, alpha)
    }

    // Iterating keys rather than entries: `for (const [id, fm] of map)`
    // allocates a two-element array per entry, every frame.
    for (const id of this.meshes.keys()) {
      if (this.seen.has(id)) continue
      this.retire.push(id)
    }
    for (const id of this.retire) {
      const fm = this.meshes.get(id)!
      this.meshes.delete(id)
      this.view.removeChild(fm.mesh)
      this.pool.push(fm)
    }
    this.retire.length = 0
  }

  destroy(): void {
    for (const fm of this.meshes.values()) fm.destroy()
    for (const fm of this.pool) fm.destroy()
    this.meshes.clear()
    this.pool.length = 0
    this.view.destroy({ children: true })
  }
}

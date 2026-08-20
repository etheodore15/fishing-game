import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import quadVert from './shaders/quad.vert?raw'
import surfaceFrag from './shaders/surface.frag?raw'
import subsurfaceFrag from './shaders/subsurface.frag?raw'
import printFrag from './shaders/print.frag?raw'

/**
 * Quality-tier variation is compiled in, not branched at runtime: a phone that
 * cannot afford four wave octaves also cannot afford a dynamic loop testing how
 * many it should run.
 */
function withDefines(src: string, defines: Record<string, number>): string {
  const lines = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`)
  return src.replace('//__DEFINES__', lines.join('\n'))
}

function program(fragment: string, name: string): GlProgram {
  return GlProgram.from({ vertex: quadVert, fragment, name })
}

export const MAX_FOAM_SOURCES = 8

/**
 * Surface pass (§8.2). Applied to a W x 1 sprite holding the previous frame's
 * foam row — the ping-pong that gives foam its ~2s decay is the filter's own
 * input texture.
 */
export class SurfaceFilter extends Filter {
  private readonly u: {
    uTime: number
    uWindKt: number
    uWindDir: number
    uWorldWidth: number
    uDt: number
    uFoam: Float32Array
    uFoamCount: number
  }

  constructor(octaves: number) {
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uWindKt: { value: 10, type: 'f32' },
      uWindDir: { value: 1, type: 'f32' },
      uWorldWidth: { value: 14, type: 'f32' },
      uDt: { value: 1 / 60, type: 'f32' },
      uFoam: { value: new Float32Array(MAX_FOAM_SOURCES * 3), type: 'vec3<f32>', size: MAX_FOAM_SOURCES },
      uFoamCount: { value: 0, type: 'i32' },
    })
    super({
      glProgram: program(withDefines(surfaceFrag, { OCTAVES: octaves }), 'water-surface'),
      resources: { surfaceUniforms: uniforms },
      // The row must not be padded or clipped — it is data, not an image.
      padding: 0,
      clipToViewport: false,
      antialias: 'off',
    })
    this.u = uniforms.uniforms as typeof this.u
  }

  get uniforms() {
    return this.u
  }
}

export class SubsurfaceFilter extends Filter {
  private readonly u: {
    uPalette: Float32Array
    uTime: number
    uWaterlineY: number
    uPixelHeight: number
    uWorldHeight: number
    uLightAngle: number
    uLightElev: number
    uLightLevel: number
    uGlare: number
    uAspect: number
  }

  constructor(caustics: boolean, surfaceTexture: import('pixi.js').Texture) {
    const uniforms = new UniformGroup({
      uPalette: { value: new Float32Array(18), type: 'vec3<f32>', size: 6 },
      uTime: { value: 0, type: 'f32' },
      uWaterlineY: { value: 0.3, type: 'f32' },
      uPixelHeight: { value: 1 / 1080, type: 'f32' },
      uWorldHeight: { value: 6.6, type: 'f32' },
      uLightAngle: { value: 0, type: 'f32' },
      uLightElev: { value: 0.5, type: 'f32' },
      uLightLevel: { value: 1, type: 'f32' },
      uGlare: { value: 0, type: 'f32' },
      uAspect: { value: 16 / 9, type: 'f32' },
    })
    super({
      glProgram: program(withDefines(subsurfaceFrag, { CAUSTICS: caustics ? 1 : 0 }), 'water-subsurface'),
      resources: {
        waterUniforms: uniforms,
        uSurface: surfaceTexture.source,
        uSurfaceSampler: surfaceTexture.source.style,
      },
      padding: 0,
      clipToViewport: false,
      antialias: 'off',
    })
    this.u = uniforms.uniforms as typeof this.u
  }

  get uniforms() {
    return this.u
  }

  setSurfaceTexture(t: import('pixi.js').Texture): void {
    this.resources.uSurface = t.source
    this.resources.uSurfaceSampler = t.source.style
  }
}

/** §5.3 print treatment. Never instantiated on low tier — the pass is skipped. */
export class PrintFilter extends Filter {
  private readonly u: {
    uResolution: Float32Array
    uHalftone: number
    uGrain: number
    uMisreg: number
  }

  constructor(misregistration: boolean) {
    const uniforms = new UniformGroup({
      uResolution: { value: new Float32Array([1920, 1080]), type: 'vec2<f32>' },
      uHalftone: { value: 0.32, type: 'f32' },
      uGrain: { value: 0.035, type: 'f32' },
      uMisreg: { value: 1, type: 'f32' },
    })
    super({
      glProgram: program(withDefines(printFrag, { MISREG: misregistration ? 1 : 0 }), 'print-pass'),
      resources: { printUniforms: uniforms },
      padding: 0,
      clipToViewport: false,
      antialias: 'off',
    })
    this.u = uniforms.uniforms as typeof this.u
  }

  get uniforms() {
    return this.u
  }
}

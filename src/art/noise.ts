/**
 * Seeded value noise, fBm and domain warp.
 *
 * Everything visual in the game is generated (§4 asset rule), and all of it has
 * to be identical on every load — a journal page that re-foxes itself each time
 * you open it is not a physical object. So: seeded, deterministic, no Math.random.
 */

/** Mulberry32 — small, fast, good enough, and reproducible across engines. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Value noise in [0,1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = fade(x - xi)
  const yf = fade(y - yi)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf
}

/** 1D slice, for height fields like the estuary bed. */
export function noise1(x: number, seed = 0): number {
  return noise2(x, 0.5, seed)
}

export function fbm2(x: number, y: number, octaves = 4, seed = 0, lacunarity = 2, gain = 0.5): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fy = y
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(fx, fy, seed + i * 1013)
    norm += amp
    amp *= gain
    fx *= lacunarity
    fy *= lacunarity
  }
  return sum / norm
}

export function fbm1(x: number, octaves = 4, seed = 0): number {
  return fbm2(x, 0.5, octaves, seed)
}

/**
 * Domain-warped fBm. Foxing spots on old paper are blotchy and directional, not
 * round — the warp is what stops them reading as a Photoshop noise layer (§8.7).
 */
export function warpedFbm(x: number, y: number, strength = 1.4, seed = 0): number {
  const qx = fbm2(x, y, 3, seed + 7)
  const qy = fbm2(x + 5.2, y + 1.3, 3, seed + 11)
  return fbm2(x + strength * qx, y + strength * qy, 4, seed + 23)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

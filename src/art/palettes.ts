/**
 * §5.1 — four six-value palettes. The renderer interpolates between adjacent
 * palettes on a continuous 0-24 clock. No other colours may appear in the game
 * world; every draw pulls from a resolved palette.
 *
 * Index meaning is constant across palettes:
 *   0 deep water / shadow   1 mid water        2 shallow water
 *   3 surface highlight     4 sky / light      5 specular / lamp core / paper
 */

export const DAWN_GLASS = ['#101418', '#25333A', '#4E6B66', '#8FA894', '#E3C79B', '#F4E7D3'] as const
export const MIDDAY_GLARE = ['#0B3D49', '#12606D', '#3E9184', '#8FC0AE', '#E7EFE3', '#FFFDF3'] as const
export const DUSK_BURN = ['#1B1220', '#4A2440', '#8E3B44', '#C4593F', '#E8975B', '#F2D9A8'] as const
export const NIGHT_LAMP = ['#03070C', '#0A1620', '#16303A', '#2E5A5C', '#9FD4C4', '#F0E6C8'] as const

export type PaletteHex = readonly [string, string, string, string, string, string]
export const PALETTES = { DAWN_GLASS, MIDDAY_GLARE, DUSK_BURN, NIGHT_LAMP } as const
export type PaletteName = keyof typeof PALETTES

/** Slot names, so call sites read as intent rather than as an index. */
export const SLOT = {
  deep: 0,
  mid: 1,
  shallow: 2,
  highlight: 3,
  sky: 4,
  specular: 5,
} as const

function hexToLinear(hex: string, out: Float32Array, at: number): void {
  const n = parseInt(hex.slice(1), 16)
  for (let c = 0; c < 3; c++) {
    const s = ((n >> (16 - c * 8)) & 0xff) / 255
    // sRGB → linear. Blending palettes in gamma space muddies the dusk ramp.
    out[at + c] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
}

function toLinearPalette(p: PaletteHex): Float32Array {
  const out = new Float32Array(18)
  for (let i = 0; i < 6; i++) hexToLinear(p[i], out, i * 3)
  return out
}

const LINEAR: Record<PaletteName, Float32Array> = {
  DAWN_GLASS: toLinearPalette(DAWN_GLASS),
  MIDDAY_GLARE: toLinearPalette(MIDDAY_GLARE),
  DUSK_BURN: toLinearPalette(DUSK_BURN),
  NIGHT_LAMP: toLinearPalette(NIGHT_LAMP),
}

/** Hour anchors around the 24h clock. Wraps: last must equal first palette. */
const KEYS: ReadonlyArray<readonly [number, PaletteName]> = [
  [0, 'NIGHT_LAMP'],
  [4.6, 'NIGHT_LAMP'],
  [6.4, 'DAWN_GLASS'],
  [9.5, 'MIDDAY_GLARE'],
  [15.5, 'MIDDAY_GLARE'],
  [17.9, 'DUSK_BURN'],
  [19.4, 'DUSK_BURN'],
  [21.3, 'NIGHT_LAMP'],
  [24, 'NIGHT_LAMP'],
]

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Resolve the live palette into `out` (18 floats, linear RGB).
 *
 * The shader receives resolved colours and a light angle — it never sees the
 * clock, so there is nothing for it to branch on (§8.2).
 */
export function paletteAt(hour: number, out: Float32Array): Float32Array {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < KEYS.length - 2 && h >= KEYS[i + 1]![0]) i++
  const [h0, n0] = KEYS[i]!
  const [h1, n1] = KEYS[i + 1]!
  const span = h1 - h0
  const t = span <= 0 ? 0 : smoothstep(Math.min(1, Math.max(0, (h - h0) / span)))
  const a = LINEAR[n0]
  const b = LINEAR[n1]
  for (let k = 0; k < 18; k++) out[k] = a[k]! + (b[k]! - a[k]!) * t
  return out
}

function linearToHex(r: number, g: number, b: number): string {
  let s = '#'
  for (const v of [r, g, b]) {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    s += Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')
  }
  return s
}

const hexScratch = new Float32Array(18)

/** Palette as CSS hex, for the DOM overlay. Low frequency only. */
export function paletteHexAt(hour: number): PaletteHex {
  paletteAt(hour, hexScratch)
  const out: string[] = []
  for (let i = 0; i < 6; i++) {
    out.push(linearToHex(hexScratch[i * 3]!, hexScratch[i * 3 + 1]!, hexScratch[i * 3 + 2]!))
  }
  return out as unknown as PaletteHex
}

/** Palette slot as a packed 0xRRGGBB int, for Pixi tints and Graphics fills. */
export function slotInt(palette: Float32Array, slot: number): number {
  const i = slot * 3
  let n = 0
  for (let c = 0; c < 3; c++) {
    const v = palette[i + c]!
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    n = (n << 8) | Math.round(Math.min(1, Math.max(0, s)) * 255)
  }
  return n
}

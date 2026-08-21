/**
 * Bake the PWA icons from the game's own line art (§12).
 *
 * The icon is the parametric fish rig, posed at rest and rasterised here at
 * build time — the same geometry the player sees in the water and on the
 * journal's species plate. Nothing is drawn by hand and no image is committed;
 * `npm run build` regenerates them.
 *
 * There is deliberately no texture atlas. §4 pencils in a build-time SVG →
 * atlas step for fish and bait, but this renderer never got sprites to pack:
 * fish are a deforming mesh solved per frame and bait are oriented quads, both
 * in one draw call each. Baking an atlas neither of them samples would be a
 * build step that exists to satisfy a filename.
 *
 * Usage: node --experimental-strip-types tools/bake-icons.ts
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROD_SAMPLES, Rod } from '../src/sim/rod.ts'

const OUT = new URL('../public/', import.meta.url)

// NIGHT_LAMP, the palette the app shell wears.
const BG = [0x03, 0x07, 0x0c, 0xff]
const INK = [0xf0, 0xe6, 0xc8, 0xff]
const WATER = [0x16, 0x30, 0x3a, 0xff]

// ---------------------------------------------------------------- PNG

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// ------------------------------------------------------------ geometry

type Poly = { x: number; y: number }[]

function inside(poly: Poly, x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

function insideAny(polys: Poly[], x: number, y: number): boolean {
  for (const poly of polys) if (inside(poly, x, y)) return true
  return false
}

/**
 * The rod, loaded up, with the line running down to the water.
 *
 * This is the icon rather than the fish. §8.4 makes the rod bend the game's
 * only tension display and its central UI decision, so it is the game's most
 * characteristic shape — and a dusky flathead is a genuinely sliver-shaped
 * animal that reads as a dash at 48 pixels, however honestly it is traced.
 */
function rodShape(): { polys: Poly[]; line: Poly } {
  const rod = new Rod()
  // Run it to a settled bend rather than posing it: the bend curve is the
  // rod's own solution to being loaded, and hand-drawing it would be a lie.
  for (let i = 0; i < 400; i++) rod.update(1 / 60, 0.82, 9, 2.4, 'fight')

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < ROD_SAMPLES; i++) {
    minX = Math.min(minX, rod.x[i]!); maxX = Math.max(maxX, rod.x[i]!)
    minY = Math.min(minY, rod.y[i]!); maxY = Math.max(maxY, rod.y[i]!)
  }
  // The line hangs below the tip, so the framing has to allow for it.
  const dropM = 1.5
  maxY += dropM
  const span = Math.max(maxX - minX, maxY - minY)
  const nx = (x: number) => (x - minX) / span
  const ny = (y: number) => (y - minY) / span

  // Taper the blank: thick at the butt, a whip at the tip.
  const upper: Poly = []
  const lower: Poly = []
  for (let i = 0; i < ROD_SAMPLES; i++) {
    const t = i / (ROD_SAMPLES - 1)
    const half = (0.030 - 0.024 * t) / 2
    const a = Math.max(0, i - 1)
    const b = Math.min(ROD_SAMPLES - 1, i + 1)
    const dx = rod.x[b]! - rod.x[a]!
    const dy = rod.y[b]! - rod.y[a]!
    const len = Math.hypot(dx, dy) || 1
    const ox = (-dy / len) * half
    const oy = (dx / len) * half
    upper.push({ x: nx(rod.x[i]!) + ox, y: ny(rod.y[i]!) + oy })
    lower.push({ x: nx(rod.x[i]!) - ox, y: ny(rod.y[i]!) - oy })
  }
  const blank: Poly = [...upper, ...lower.reverse()]

  const tipX = nx(rod.tipX)
  const tipY = ny(rod.tipY)
  const halfLine = 0.007
  const line: Poly = [
    { x: tipX - halfLine, y: tipY },
    { x: tipX + halfLine, y: tipY },
    { x: tipX + halfLine + 0.02, y: tipY + dropM / span },
    { x: tipX - halfLine + 0.02, y: tipY + dropM / span },
  ]
  return { polys: [blank], line }
}

/**
 * Render one icon.
 *
 * Maskable icons get cropped to a circle inscribed in the centre 80%, so all
 * the line art lives well inside that safe zone (§12).
 */
function renderIcon(size: number): Uint8Array {
  const { polys, line } = rodShape()
  const all = [...polys, line]
  const px = new Uint8Array(size * size * 4)
  const SS = 3 // supersample factor, so the edges are not stair-stepped

  // Everything inside the maskable safe zone: the centre 80%, minus a little.
  const art = size * 0.72
  const originX = (size - art) / 2
  const originY = (size - art) / 2
  const waterY = size * 0.74

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ink = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS - originX) / art
          const fy = (y + (sy + 0.5) / SS - originY) / art
          if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 && insideAny(all, fx, fy)) ink += 1
        }
      }
      const cover = ink / (SS * SS)
      const base = y > waterY ? WATER : BG
      const o = (y * size + x) * 4
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(base[c]! + (INK[c]! - base[c]!) * cover)
      px[o + 3] = 255
    }
  }

  // A hard waterline, in the print style: one rule, no gradient.
  const rule = Math.max(1, Math.round(size / 80))
  for (let y = Math.round(waterY); y < Math.round(waterY) + rule; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      for (let c = 0; c < 3; c++) px[o + c] = INK[c]!
    }
  }

  return encodePNG(size, size, px)
}

/** The favicon: the same rod, as vector. */
function renderSvg(): string {
  const { polys, line } = rodShape()
  const art = 46
  const off = (64 - art) / 2
  const d = [...polys, line]
    .map(
      (poly) =>
        poly
          .map((p, i) => `${i ? 'L' : 'M'}${(off + p.x * art).toFixed(2)},${(off + p.y * art).toFixed(2)}`)
          .join('') + 'Z',
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#03070c"/>
  <rect y="47" width="64" height="17" fill="#16303a"/>
  <rect y="46" width="64" height="1.2" fill="#f0e6c8"/>
  <path d="${d}" fill="#f0e6c8"/>
</svg>
`
}

mkdirSync(OUT, { recursive: true })
for (const size of [192, 512]) {
  const png = renderIcon(size)
  writeFileSync(new URL(`icon-${size}.png`, OUT), png)
  console.log(`public/icon-${size}.png  ${png.length} bytes`)
}
writeFileSync(new URL('icon.svg', OUT), renderSvg())
console.log('public/icon.svg')

import { FLOATS_PER_VERTEX, PARTS, VERTEX_COUNT, poseFish, type FishPose } from './fishRig.ts'
import { layoutHand, type HandLayout } from './hand.ts'
import { clamp, rng, warpedFbm } from './noise.ts'
import type { Species } from '../content/schema.ts'

/**
 * Journal page generation (§8.7).
 *
 * Everything on a page is computed: the paper's foxing, the fold, the water
 * damage outline, the handwriting and the species plate. Nothing is drawn by
 * hand and nothing is a bitmap, so a page is a text diff and a page is
 * identical on every load — which is the point, because the journal is meant
 * to be a physical object the player is repairing, not a screen that redraws.
 */

/** Page coordinate system. Everything below is in these units. */
export const PAGE_W = 100
export const PAGE_H = 140

const MARGIN_X = 12
const MARGIN_TOP = 30
const TEXT_SIZE = 3.1
const LINE_HEIGHT = 6.4

export interface Blob {
  d: string
  /** 0-1 how dark this mark sits on the paper. */
  strength: number
}

export interface PageArt {
  id: string
  date: string
  title: string
  seed: number
  /** 0 = clean, 1 = ruined. Drives how much of the page the stain covers. */
  damage: number
  locked: boolean
  hand: HandLayout
  heading: HandLayout
  /** Foxing spots, concentrated at the edges. */
  foxing: Blob[]
  /** Faint ruled lines the hand drifts across. */
  rules: number[]
  /** The fold crease. */
  creaseD: string
  /** Outline of the water-damaged region. */
  damageD: string
  /** The species plate, in the same stroke style as the writing. */
  sketch: { d: string; width: number }[]
  sketchBox: { x: number; y: number; w: number; h: number } | null
  /** The plate's caption, written in the same hand. */
  caption: HandLayout | null
}

export interface PageSource {
  id: string
  date: string
  title: string
  seed: number
  damage: number
  locked: boolean
  sketch: string
  body: string
}

/** Parse the `---` header block off a journal markdown file. */
export function parsePage(id: string, raw: string): PageSource {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw.trim())
  if (!m) throw new Error(`journal page ${id} has no header block`)
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return {
    id,
    date: meta.date ?? '',
    title: meta.title ?? '',
    seed: Number(meta.seed ?? 1),
    damage: Number(meta.damage ?? 0),
    locked: meta.locked === 'true',
    sketch: meta.sketch ?? 'none',
    // Hard-wrap the source for readability; the hand does its own wrapping.
    body: m[2]!.trim().replace(/\n(?!\n)/g, ' '),
  }
}

/**
 * An irregular closed blob, from domain-warped noise around a centre.
 *
 * Foxing and water stains both want the same shape language: lobed, uneven,
 * never a circle. The warp is what stops them reading as a noise filter (§8.7).
 */
function blobPath(cx: number, cy: number, radius: number, seed: number, lobes = 22): string {
  const pts: string[] = []
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2
    const n = warpedFbm(Math.cos(a) * 1.6 + 4, Math.sin(a) * 1.6 + 4, 1.7, seed)
    const r = radius * (0.55 + n * 0.95)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * 0.86
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

/**
 * The species plate.
 *
 * Generated from the parametric rig at rest rather than from a stored path set:
 * the sketch in the journal is then guaranteed to be the same animal the player
 * just caught, and a species is still one JSON file with no art attached.
 */
function speciesSketch(
  species: Species,
  box: { x: number; y: number; w: number },
): { paths: { d: string; width: number }[]; height: number } {
  const verts = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX)
  const pose: FishPose = {
    x: 0, y: 0, heading: Math.PI, lengthM: 1, t: 0,
    // Dead still and dead flat: this is a plate, not a fish in the water.
    omega: 0, ampScale: 0, turnBias: 0, phase: 0, finPhase: 0.4,
  }
  poseFish(species, pose, verts, 0)

  const vx = (v: number) => verts[v * FLOATS_PER_VERTEX]!
  const vy = (v: number) => verts[v * FLOATS_PER_VERTEX + 1]!

  // Measure the whole rig, fins and tail included, so the plate is the animal
  // and not just its body.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let v = 0; v < VERTEX_COUNT; v++) {
    minX = Math.min(minX, vx(v))
    maxX = Math.max(maxX, vx(v))
    minY = Math.min(minY, vy(v))
    maxY = Math.max(maxY, vy(v))
  }
  const scale = box.w / Math.max(0.001, maxX - minX)
  const height = (maxY - minY) * scale
  const tx = (x: number) => box.x + (x - minX) * scale
  const ty = (y: number) => box.y + (y - minY) * scale
  const pt = (v: number) => `${tx(vx(v)).toFixed(2)},${ty(vy(v)).toFixed(2)}`

  const paths: { d: string; width: number }[] = []

  /** Trace the outer edge of a ribbon — one side of each pair. */
  const rim = (part: { offset: number; pairs: number }, side: 0 | 1, width: number, close = false) => {
    const pts: string[] = []
    for (let i = 0; i < part.pairs; i++) pts.push(pt(part.offset + i * 2 + side))
    if (pts.length < 2) return
    paths.push({ d: `M${pts.join('L')}${close ? 'Z' : ''}`, width })
  }

  /**
   * A fin as a closed outline: out along the base, back along the tips.
   *
   * Tracing only the tips leaves a bare diagonal slashed across the body, which
   * is what a fin is not.
   */
  const fin = (part: { offset: number; pairs: number }, width: number) => {
    if (part.pairs < 2) return
    const pts: string[] = []
    for (let i = 0; i < part.pairs; i++) pts.push(pt(part.offset + i * 2))
    for (let i = part.pairs - 1; i >= 0; i--) pts.push(pt(part.offset + i * 2 + 1))
    paths.push({ d: `M${pts.join('L')}Z`, width })
  }

  // The silhouette is the outline ribbon's outer edge, which already runs all
  // the way around the body from head to tail and back.
  rim(PARTS.outline, 1, 0.34, true)
  fin(PARTS.dorsal, 0.24)
  fin(PARTS.anal, 0.24)
  fin(PARTS.caudal, 0.26)

  // Pectoral: the three-point fan, closed.
  paths.push({
    d: `M${pt(PARTS.pectoral.offset)}L${pt(PARTS.pectoral.offset + 2)}L${pt(PARTS.pectoral.offset + 1)}Z`,
    width: 0.22,
  })

  // The lateral line and the gill plate — the two marks a field guide always
  // has, both derived from the same spine the silhouette came from. The line
  // runs the middle of the body only; drawn nose to tail it dominates the plate.
  const mid: string[] = []
  for (let i = 3; i < PARTS.body.pairs - 3; i++) {
    const a = PARTS.body.offset + i * 2
    mid.push(`${tx((vx(a) + vx(a + 1)) / 2).toFixed(2)},${ty((vy(a) + vy(a + 1)) / 2 - 0.004).toFixed(2)}`)
  }
  paths.push({ d: `M${mid.join('L')}`, width: 0.16 })
  paths.push({ d: `M${pt(PARTS.body.offset + 4)}L${pt(PARTS.body.offset + 5)}`, width: 0.2 })

  // The eye.
  const eyeR = box.w * 0.016
  const ex = tx(vx(0) - 0.05)
  const ey = ty(vy(0) + 0.012)
  paths.push({
    d: `M${(ex - eyeR).toFixed(2)},${ey.toFixed(2)}a${eyeR.toFixed(2)},${eyeR.toFixed(2)} 0 1,0 ${(eyeR * 2).toFixed(2)},0a${eyeR.toFixed(2)},${eyeR.toFixed(2)} 0 1,0 ${(-eyeR * 2).toFixed(2)},0`,
    width: 0.24,
  })

  return { paths, height }
}

export function buildPage(src: PageSource, species: Species | null): PageArt {
  const rand = rng(src.seed)

  const heading = layoutHand(`${src.date}`, {
    size: TEXT_SIZE * 1.15,
    columnWidth: PAGE_W - MARGIN_X * 2,
    lineHeight: LINE_HEIGHT,
    slant: 0.1,
    jitter: 0.9,
    seed: src.seed + 17,
    x: MARGIN_X,
    y: MARGIN_TOP - 9,
  })

  const hand = layoutHand(src.body, {
    size: TEXT_SIZE,
    columnWidth: PAGE_W - MARGIN_X * 2,
    lineHeight: LINE_HEIGHT,
    slant: 0.12,
    jitter: 1,
    seed: src.seed,
    x: MARGIN_X,
    y: MARGIN_TOP,
  })

  const rules: number[] = []
  for (let y = MARGIN_TOP; y < PAGE_H - 12; y += LINE_HEIGHT) rules.push(y)

  // Foxing gathers at the edges of a page, where the air gets at it.
  const foxing: Blob[] = []
  for (let i = 0; i < 26; i++) {
    const edge = rand()
    const cx = edge < 0.5 ? rand() * 16 + (rand() < 0.5 ? 1 : PAGE_W - 17) : rand() * PAGE_W
    const cy = edge < 0.5 ? rand() * PAGE_H : rand() * 16 + (rand() < 0.5 ? 1 : PAGE_H - 17)
    foxing.push({
      d: blobPath(cx, cy, 0.9 + rand() * 2.6, src.seed + i * 31, 12),
      strength: 0.12 + rand() * 0.3,
    })
  }

  // The fold: one crease down the page, never quite straight.
  const creasePts: string[] = []
  for (let y = 0; y <= PAGE_H; y += 10) {
    creasePts.push(`${(PAGE_W / 2 + Math.sin(y * 0.08 + src.seed) * 0.5).toFixed(2)},${y}`)
  }

  // The stain. Its footprint grows with the damage value; the restoration
  // animation erodes it from within rather than shrinking this outline. A page
  // with no damage gets no stain at all — an empty path, not a small one.
  const dmg = clamp(src.damage, 0, 1)
  const damageD =
    dmg <= 0
      ? ''
      : blobPath(
          PAGE_W * (0.24 + rand() * 0.3),
          PAGE_H * (0.42 + rand() * 0.3),
          14 + dmg * 66,
          src.seed + 909,
          28,
        )

  let sketch: { d: string; width: number }[] = []
  let sketchBox: PageArt['sketchBox'] = null
  let caption: HandLayout | null = null
  if (species && src.sketch !== 'none') {
    const box = { x: MARGIN_X + 6, y: MARGIN_TOP + hand.height + 6, w: PAGE_W - MARGIN_X * 2 - 12 }
    const built = speciesSketch(species, box)
    sketch = built.paths
    sketchBox = { ...box, h: built.height }
    // Captioned in the same hand as the entry — this is a man's notebook, not
    // a printed plate, and the display face belongs to the game's chrome.
    caption = layoutHand(species.displayName, {
      size: TEXT_SIZE * 0.82,
      columnWidth: PAGE_W - MARGIN_X * 2,
      lineHeight: LINE_HEIGHT * 0.8,
      slant: 0.1,
      jitter: 0.85,
      seed: src.seed + 404,
      x: box.x,
      y: box.y + built.height + 5.5,
    })
  }

  return {
    id: src.id,
    date: src.date,
    title: src.title,
    seed: src.seed,
    damage: dmg,
    locked: src.locked,
    hand,
    heading,
    foxing,
    rules,
    creaseD: `M${creasePts.join('L')}`,
    damageD,
    sketch,
    sketchBox,
    caption,
  }
}

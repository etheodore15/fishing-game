import { rng } from './noise.ts'

/**
 * A single-stroke hand (§8.7).
 *
 * The journal's handwriting has to be *drawable* — the restoration animation
 * reveals it stroke by stroke at handwriting speed — so it cannot be a font.
 * It is a skeleton alphabet: every glyph is a set of polylines through a box
 * one cap-height tall, smoothed into curves and inked with a variable-width
 * stroke at render time.
 *
 * Coordinates: y = 0 at the ascender line, y = 1 at the baseline, descenders
 * run to about 1.25. x starts at 0 and the advance is the glyph's own width.
 * Strokes are separated by '|', points by ' ', ordinates by ','.
 */

const GLYPHS: Record<string, string> = {
  a: '0.52,0.45 0.35,0.38 0.2,0.5 0.18,0.72 0.28,0.94 0.45,0.96 0.54,0.85|0.54,0.4 0.54,0.98',
  b: '0.16,0.02 0.16,1|0.16,0.55 0.3,0.42 0.48,0.5 0.52,0.72 0.44,0.94 0.26,0.98 0.16,0.88',
  c: '0.54,0.5 0.38,0.4 0.2,0.52 0.18,0.75 0.3,0.95 0.5,0.93',
  d: '0.54,0.02 0.54,0.98|0.54,0.52 0.38,0.4 0.2,0.52 0.18,0.75 0.3,0.95 0.48,0.9',
  e: '0.18,0.7 0.54,0.66 0.5,0.48 0.32,0.4 0.19,0.55 0.2,0.8 0.34,0.95 0.52,0.9',
  f: '0.5,0.1 0.36,0.06 0.28,0.2 0.28,0.98|0.14,0.45 0.46,0.42',
  g: '0.54,0.45 0.36,0.38 0.2,0.5 0.19,0.74 0.32,0.93 0.5,0.86|0.54,0.4 0.53,1.05 0.44,1.22 0.26,1.2',
  h: '0.16,0.02 0.16,0.98|0.16,0.6 0.3,0.44 0.46,0.5 0.5,0.68 0.5,0.98',
  i: '0.24,0.42 0.24,0.98|0.24,0.2 0.25,0.26',
  j: '0.4,0.42 0.4,1.05 0.32,1.22 0.18,1.2|0.4,0.2 0.41,0.26',
  k: '0.16,0.02 0.16,0.98|0.5,0.44 0.18,0.75|0.3,0.66 0.52,0.98',
  l: '0.2,0.02 0.2,0.86 0.3,0.98',
  m: '0.14,0.42 0.14,0.98|0.14,0.58 0.26,0.44 0.38,0.52 0.4,0.98|0.4,0.58 0.52,0.44 0.64,0.52 0.66,0.98',
  n: '0.16,0.42 0.16,0.98|0.16,0.58 0.3,0.44 0.46,0.52 0.5,0.68 0.5,0.98',
  o: '0.34,0.4 0.18,0.55 0.19,0.8 0.34,0.96 0.5,0.85 0.52,0.58 0.38,0.41',
  p: '0.16,0.42 0.16,1.24|0.16,0.58 0.3,0.42 0.48,0.5 0.52,0.72 0.44,0.93 0.26,0.96 0.16,0.86',
  q: '0.54,0.45 0.36,0.38 0.2,0.5 0.19,0.74 0.32,0.93 0.5,0.86|0.54,0.4 0.54,1.24',
  r: '0.18,0.42 0.18,0.98|0.18,0.58 0.32,0.44 0.5,0.46',
  s: '0.52,0.48 0.34,0.39 0.2,0.48 0.26,0.64 0.46,0.72 0.5,0.86 0.34,0.96 0.18,0.9',
  t: '0.28,0.12 0.28,0.86 0.4,0.97|0.14,0.42 0.46,0.4',
  u: '0.16,0.42 0.16,0.82 0.28,0.96 0.44,0.9 0.5,0.72|0.5,0.42 0.5,0.98',
  v: '0.14,0.42 0.32,0.98 0.5,0.42',
  w: '0.12,0.42 0.24,0.98 0.36,0.6 0.48,0.98 0.6,0.42',
  x: '0.16,0.42 0.5,0.98|0.5,0.42 0.16,0.98',
  y: '0.14,0.42 0.32,0.94|0.52,0.42 0.28,1.1 0.14,1.22',
  z: '0.16,0.44 0.5,0.44 0.16,0.96 0.52,0.96',

  A: '0.08,1 0.34,0.04 0.6,1|0.18,0.7 0.5,0.7',
  B: '0.14,0.04 0.14,1|0.14,0.04 0.42,0.08 0.5,0.28 0.4,0.48 0.14,0.5|0.14,0.5 0.46,0.55 0.56,0.75 0.44,0.96 0.14,1',
  C: '0.58,0.16 0.4,0.04 0.2,0.2 0.16,0.55 0.24,0.9 0.44,1 0.6,0.9',
  D: '0.14,0.04 0.14,1|0.14,0.04 0.42,0.1 0.56,0.4 0.5,0.82 0.3,0.98 0.14,1',
  E: '0.56,0.06 0.16,0.04 0.16,1 0.56,0.98|0.16,0.5 0.44,0.48',
  F: '0.56,0.06 0.16,0.04 0.16,1|0.16,0.5 0.44,0.48',
  G: '0.58,0.16 0.4,0.04 0.2,0.2 0.16,0.55 0.26,0.92 0.5,1 0.6,0.82 0.6,0.58 0.42,0.56',
  H: '0.14,0.04 0.14,1|0.56,0.04 0.56,1|0.14,0.52 0.56,0.5',
  I: '0.3,0.04 0.3,1',
  J: '0.5,0.04 0.5,0.82 0.4,0.98 0.22,0.94 0.16,0.78',
  K: '0.14,0.04 0.14,1|0.56,0.06 0.16,0.56|0.28,0.44 0.58,1',
  L: '0.16,0.04 0.16,0.98 0.56,0.96',
  M: '0.12,1 0.14,0.04 0.36,0.7 0.58,0.04 0.6,1',
  N: '0.14,1 0.14,0.04 0.56,0.98 0.56,0.04',
  O: '0.36,0.04 0.16,0.24 0.14,0.62 0.3,0.98 0.52,0.9 0.6,0.5 0.5,0.12 0.36,0.04',
  P: '0.14,1 0.14,0.04 0.44,0.08 0.54,0.3 0.42,0.52 0.14,0.54',
  Q: '0.36,0.04 0.16,0.24 0.14,0.62 0.3,0.98 0.52,0.9 0.6,0.5 0.5,0.12 0.36,0.04|0.42,0.72 0.62,1.06',
  R: '0.14,1 0.14,0.04 0.44,0.08 0.54,0.3 0.42,0.52 0.14,0.54|0.34,0.54 0.58,1',
  S: '0.58,0.14 0.38,0.04 0.18,0.16 0.22,0.4 0.5,0.56 0.56,0.8 0.38,0.98 0.16,0.9',
  T: '0.08,0.06 0.6,0.04|0.34,0.05 0.34,1',
  U: '0.14,0.04 0.14,0.76 0.3,0.98 0.5,0.92 0.56,0.7 0.56,0.04',
  V: '0.1,0.04 0.34,1 0.6,0.04',
  W: '0.06,0.04 0.2,1 0.34,0.4 0.48,1 0.62,0.04',
  X: '0.12,0.04 0.58,1|0.58,0.04 0.12,1',
  Y: '0.12,0.04 0.34,0.5 0.56,0.04|0.34,0.5 0.34,1',
  Z: '0.12,0.06 0.58,0.04 0.12,0.98 0.6,0.96',

  '0': '0.34,0.06 0.18,0.3 0.18,0.72 0.34,0.98 0.5,0.74 0.5,0.3 0.34,0.06',
  '1': '0.2,0.2 0.34,0.06 0.34,1',
  '2': '0.16,0.2 0.32,0.05 0.5,0.16 0.46,0.42 0.16,0.98 0.52,0.96',
  '3': '0.16,0.14 0.36,0.04 0.5,0.2 0.36,0.44 0.52,0.62 0.48,0.9 0.26,0.99 0.14,0.88',
  '4': '0.44,0.04 0.14,0.7 0.54,0.68|0.4,0.4 0.4,1',
  '5': '0.5,0.06 0.2,0.06 0.16,0.44 0.36,0.4 0.52,0.58 0.48,0.88 0.26,1 0.14,0.9',
  '6': '0.5,0.08 0.28,0.16 0.18,0.5 0.2,0.84 0.36,0.99 0.5,0.84 0.48,0.6 0.3,0.52 0.19,0.62',
  '7': '0.14,0.06 0.56,0.05 0.3,1',
  '8': '0.34,0.05 0.18,0.2 0.32,0.42 0.5,0.3 0.36,0.06|0.32,0.42 0.16,0.66 0.3,0.96 0.52,0.82 0.36,0.44',
  '9': '0.5,0.5 0.34,0.6 0.18,0.46 0.24,0.18 0.44,0.06 0.52,0.3 0.5,0.72 0.38,0.98 0.2,0.98',

  '.': '0.15,0.94 0.2,0.99',
  ',': '0.18,0.94 0.13,1.12',
  "'": '0.16,0.06 0.12,0.26',
  '"': '0.14,0.06 0.1,0.26|0.28,0.06 0.24,0.26',
  '-': '0.1,0.62 0.44,0.6',
  '—': '0.04,0.62 0.66,0.6',
  '?': '0.14,0.18 0.3,0.05 0.46,0.16 0.4,0.4 0.3,0.5 0.3,0.68|0.29,0.94 0.33,0.98',
  '!': '0.22,0.05 0.2,0.66|0.19,0.94 0.24,0.98',
  ':': '0.17,0.5 0.22,0.54|0.17,0.94 0.22,0.98',
  ';': '0.17,0.5 0.22,0.54|0.2,0.92 0.15,1.1',
  '(': '0.36,0.02 0.2,0.3 0.2,0.72 0.36,1.02',
  ')': '0.14,0.02 0.3,0.3 0.3,0.72 0.14,1.02',
  '/': '0.1,1 0.44,0.02',
  '&': '0.56,1 0.2,0.5 0.2,0.2 0.36,0.1 0.46,0.24 0.36,0.44 0.16,0.68 0.2,0.92 0.4,0.98 0.56,0.82',
}

/** Side bearing added to each glyph's own extent, in cap heights. */
const SIDE_BEARING = 0.09
const SPACE_ADVANCE = 0.34

export interface Stroke {
  /** SVG path data in page units. */
  d: string
  /** Ink width in page units, from the pressure curve. */
  width: number
  /** Path length, so the reveal can set a dasharray without measuring. */
  length: number
}

export interface HandWord {
  strokes: Stroke[]
  /** Left edge and baseline in page units — used for the sequential reveal. */
  x: number
  y: number
  width: number
}

export interface HandLayout {
  words: HandWord[]
  /** Total ink length, for pacing the reveal. */
  totalLength: number
  height: number
}

export interface HandOptions {
  /** Cap height in page units. */
  size: number
  /** Column width in page units. */
  columnWidth: number
  lineHeight: number
  /** Radians of forward slant. */
  slant: number
  /** How much the hand wobbles. 0 is a plotter, 1 is a bad day. */
  jitter: number
  seed: number
  /** Baseline of the first line. */
  x: number
  y: number
}

interface ParsedGlyph {
  strokes: number[][]
  advance: number
}

const parsed = new Map<string, ParsedGlyph>()

function glyph(ch: string): ParsedGlyph | null {
  const cached = parsed.get(ch)
  if (cached) return cached
  const src = GLYPHS[ch]
  if (!src) return null
  let maxX = 0
  const strokes = src.split('|').map((s) =>
    s
      .trim()
      .split(' ')
      .flatMap((pt) => {
        const [x, y] = pt.split(',').map(Number)
        maxX = Math.max(maxX, x!)
        return [x!, y!]
      }),
  )
  const g = { strokes, advance: maxX + SIDE_BEARING }
  parsed.set(ch, g)
  return g
}

/**
 * Catmull-Rom through the skeleton points, emitted as cubic beziers.
 *
 * The skeletons are deliberately coarse — a handwritten letter is a gesture,
 * not a polygon, and interpolating them is what stops the hand looking drawn
 * with a ruler.
 */
function smoothPath(pts: number[], out: string[]): number {
  const n = pts.length / 2
  if (n < 2) return 0
  const px = (i: number) => pts[Math.min(n - 1, Math.max(0, i)) * 2]!
  const py = (i: number) => pts[Math.min(n - 1, Math.max(0, i)) * 2 + 1]!

  out.push(`M${px(0).toFixed(2)},${py(0).toFixed(2)}`)
  let length = 0
  for (let i = 0; i < n - 1; i++) {
    const x0 = px(i - 1)
    const y0 = py(i - 1)
    const x1 = px(i)
    const y1 = py(i)
    const x2 = px(i + 1)
    const y2 = py(i + 1)
    const x3 = px(i + 2)
    const y3 = py(i + 2)
    const c1x = x1 + (x2 - x0) / 6
    const c1y = y1 + (y2 - y0) / 6
    const c2x = x2 - (x3 - x1) / 6
    const c2y = y2 - (y3 - y1) / 6
    out.push(
      `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`,
    )
    // Chord length is a close enough estimate for a dasharray on a short curve.
    length += Math.hypot(x2 - x1, y2 - y1) * 1.06
  }
  return length
}

/**
 * Lay out text as drawable strokes.
 *
 * Seeded, so a page's handwriting is identical on every load — a journal entry
 * that re-writes itself in a different hand each time you open it is not a
 * physical object, and this journal is meant to be one.
 */
export function layoutHand(text: string, opts: HandOptions): HandLayout {
  const rand = rng(opts.seed)
  const words: HandWord[] = []
  const size = opts.size
  let cursorX = opts.x
  let baseline = opts.y
  let totalLength = 0

  // Pre-roll the generator so the first letter is not always jittered the same.
  for (let i = 0; i < 7; i++) rand()

  const paragraphs = text.split('\n')
  for (let p = 0; p < paragraphs.length; p++) {
    const tokens = paragraphs[p]!.split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      const measured = measure(token) * size
      if (cursorX + measured > opts.x + opts.columnWidth && cursorX > opts.x) {
        cursorX = opts.x
        baseline += opts.lineHeight
      }
      const word = drawWord(token, cursorX, baseline, size, opts, rand)
      for (const s of word.strokes) totalLength += s.length
      words.push(word)
      cursorX += measured + SPACE_ADVANCE * size
    }
    if (p < paragraphs.length - 1) {
      cursorX = opts.x
      baseline += opts.lineHeight
    }
  }

  return { words, totalLength, height: baseline - opts.y + opts.lineHeight }
}

function measure(token: string): number {
  let w = 0
  for (const ch of token) w += glyph(ch)?.advance ?? SPACE_ADVANCE
  return w
}

function drawWord(
  token: string,
  x: number,
  baseline: number,
  size: number,
  opts: HandOptions,
  rand: () => number,
): HandWord {
  const strokes: Stroke[] = []
  // Per-word drift: a hand drifts off the ruled line across a word, not per
  // letter, and it is that drift that reads as a person rather than a printer.
  const wordDrift = (rand() - 0.5) * 0.06 * size * opts.jitter
  const wordSlant = opts.slant + (rand() - 0.5) * 0.05 * opts.jitter
  let cursor = x

  for (const ch of token) {
    const g = glyph(ch)
    if (!g) {
      cursor += SPACE_ADVANCE * size
      continue
    }
    const jx = (rand() - 0.5) * 0.035 * size * opts.jitter
    const jy = (rand() - 0.5) * 0.045 * size * opts.jitter + wordDrift
    const scale = 1 + (rand() - 0.5) * 0.07 * opts.jitter
    const rot = (rand() - 0.5) * 0.06 * opts.jitter

    for (const raw of g.strokes) {
      const pts: number[] = []
      for (let i = 0; i < raw.length; i += 2) {
        // Glyph space → page space: scale, rotate a little, slant, place.
        let gx = raw[i]! * scale
        let gy = (raw[i + 1]! - 1) * scale // baseline-relative
        const c = Math.cos(rot)
        const s = Math.sin(rot)
        const rx = gx * c - gy * s
        const ry = gx * s + gy * c
        gx = rx - ry * Math.tan(wordSlant)
        gy = ry
        pts.push(cursor + gx * size + jx, baseline + gy * size + jy)
      }

      // Pressure: the nib bites at the start of a stroke and lightens as it
      // runs out. Split each stroke so the width actually varies along it.
      const pressure = 0.72 + rand() * 0.5
      const half = Math.max(2, Math.floor(pts.length / 4) * 2)
      const front = pts.slice(0, half + 2)
      const back = pts.slice(Math.max(0, half - 2))
      for (const [seg, mult] of [
        [front, 1],
        [back, 0.78],
      ] as const) {
        if (seg.length < 4) continue
        const out: string[] = []
        const length = smoothPath(seg, out)
        strokes.push({
          d: out.join(''),
          width: size * 0.055 * pressure * mult,
          length,
        })
      }
    }
    cursor += g.advance * size * scale
  }

  return { strokes, x, y: baseline, width: cursor - x }
}

/** True if the hand can draw this character. Used to keep content honest. */
export function canDraw(ch: string): boolean {
  return ch === ' ' || ch === '\n' || GLYPHS[ch] !== undefined
}

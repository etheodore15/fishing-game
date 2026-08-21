/**
 * Draw the rod, headless, through a whole cast.
 *
 * A screenshot cannot show a stroke: the wind-up and the forward swing take
 * five frames each, and by the time a headless browser has written a PNG the
 * lure is already in the water. This poses the rod off the same solve the game
 * runs and lays the poses over one another, so the shape of the cast — where
 * the tip goes, which way the blank is loaded, when the lure leaves — can
 * actually be looked at.
 *
 * Usage: node --experimental-strip-types tools/rod-preview.ts [out.svg]
 */
import { writeFileSync } from 'node:fs'
import { Rod, ROD_SAMPLES } from '../src/sim/rod.ts'

const DT = 1 / 60
/** The frame: two metres of sky, four of water (render/layers.ts). */
const FRAME_TOP = -2.15
const FRAME_BOTTOM = 0.55
const FRAME_LEFT = -0.6
const FRAME_RIGHT = 3.2
const HIGH_WATER = -0.7
const SCALE = 250

const W = (FRAME_RIGHT - FRAME_LEFT) * SCALE
const H = (FRAME_BOTTOM - FRAME_TOP) * SCALE
const px = (x: number) => ((x - FRAME_LEFT) * SCALE).toFixed(1)
const py = (y: number) => ((y - FRAME_TOP) * SCALE).toFixed(1)

function blank(rod: Rod, stroke: string, width = 2.5, dash = ''): string {
  const pts: string[] = []
  for (let i = 0; i < ROD_SAMPLES; i++) pts.push(`${px(rod.x[i]!)},${py(rod.y[i]!)}`)
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${dash} />`
}

/** The lure, where the trip hangs it while the rod still has it. */
function drop(rod: Rod, stroke: string): string {
  const x = rod.tipX + 0.02
  const y = rod.tipY + 0.3
  return (
    `<line x1="${px(rod.tipX)}" y1="${py(rod.tipY)}" x2="${px(x)}" y2="${py(y)}" stroke="${stroke}" stroke-width="1" />` +
    `<circle cx="${px(x)}" cy="${py(y)}" r="3.5" fill="${stroke}" />`
  )
}

function settle(pose: 'rest' | 'work' | 'fight', tension = 0): Rod {
  const rod = new Rod()
  for (let i = 0; i < 240; i++) rod.update(DT, tension, 6, 1.2, pose)
  return rod
}

function panel(title: string, body: string): string {
  return `<g><rect width="${W}" height="${H}" fill="#e9dfc4" />
<rect x="${px(FRAME_LEFT)}" y="${py(HIGH_WATER)}" width="${W}" height="${(FRAME_BOTTOM - HIGH_WATER) * SCALE}" fill="#2f4f53" opacity="0.28" />
<rect x="${px(FRAME_LEFT)}" y="${py(0)}" width="${W}" height="${FRAME_BOTTOM * SCALE}" fill="#2f4f53" opacity="0.4" />
<line x1="0" y1="1" x2="${W}" y2="1" stroke="#b03a2e" stroke-width="2" stroke-dasharray="6 4" />
${body}
<text x="12" y="${H - 12}" font-family="monospace" font-size="15" fill="#12181c">${title}</text></g>`
}

// ---- the stroke, laid over itself
const rod = settle('rest')
const layers: string[] = [blank(rod, '#12181c', 3), drop(rod, '#12181c')]
rod.beginCast(1, 0.5)
let t = 0
let released = -1
for (let i = 0; i < 46; i++) {
  rod.update(DT, 0, 6, 1.2, 'work')
  t += DT
  if (rod.released) released = t
  if (i % 2) continue
  const done = released > 0
  const shade = done ? '#8a6b3c' : '#1f6f6a'
  const fade = (0.25 + 0.75 * Math.min(1, i / 24)).toFixed(2)
  layers.push(`<g opacity="${fade}">${blank(rod, shade, 1.6)}${done ? '' : drop(rod, shade)}</g>`)
}

// ---- the three postures
const postures = (['rest', 'work', 'fight'] as const).map((pose, i) => {
  const r = settle(pose, pose === 'fight' ? 0.85 : pose === 'work' ? 0.12 : 0)
  const colour = ['#12181c', '#1f6f6a', '#b03a2e'][i]!
  return `<g>${blank(r, colour, 3)}${pose === 'rest' ? drop(r, colour) : ''}</g>`
})

const panels = [
  panel(`a cast at full power  ·  lure leaves at ${released.toFixed(2)}s (gold is after)`, layers.join('\n')),
  panel('rest (black) · working a lure (green) · a fish on at 0.85 (red)', postures.join('\n')),
]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H * panels.length + 8}" viewBox="0 0 ${W} ${H * panels.length + 8}">
${panels.map((p, i) => `<g transform="translate(0 ${i * (H + 8)})">${p}</g>`).join('\n')}
</svg>`

const out = process.argv[2] ?? 'scratch/rod.svg'
writeFileSync(out, svg)
console.log(`wrote ${out} — released at ${released.toFixed(3)}s`)

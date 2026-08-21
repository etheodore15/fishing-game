/**
 * Render the fish rig to SVG, headless.
 *
 * The rig is the one piece of geometry in the game that is hard to judge from
 * a screenshot — it is 40 pixels long, underwater, and moving. This poses it at
 * a readable size so silhouette, fin placement and mirror orientation can be
 * checked without hunting for a fish in the scene.
 *
 * Usage: node --experimental-strip-types tools/rig-preview.ts [species-id]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  FLOATS_PER_VERTEX,
  VERTEX_COUNT,
  buildIndices,
  poseFish,
  type FishPose,
} from '../src/art/fishRig.ts'
import type { Species } from '../src/content/schema.ts'

// Read the species file directly rather than through src/content/index.ts:
// that module imports JSON the way the bundler does, which Node will not do
// without import attributes, and a dev tool is not worth contorting the app for.
const speciesId = process.argv[2] ?? 'dusky-flathead'
const sp = JSON.parse(
  readFileSync(new URL(`../src/content/species/${speciesId}.json`, import.meta.url), 'utf8'),
) as Species
const indices = buildIndices()
const verts = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX)

const ROLE_FILL = ['#3E9184', '#101418', '#2b5f59']
const SCALE = 420
const rows: string[] = []

const poses: Array<[string, Partial<FishPose>]> = [
  ['heading left, cruising', { heading: Math.PI, omega: 3.8, ampScale: 1 }],
  ['heading right, cruising', { heading: 0, omega: 3.8, ampScale: 1 }],
  ['heading right, burst', { heading: 0, omega: 26, ampScale: 2.2, turnBias: 0.4 }],
  ['heading left, turning hard', { heading: Math.PI, omega: 8, ampScale: 1.4, turnBias: -0.8 }],
]

poses.forEach(([label, over], row) => {
  const pose: FishPose = {
    x: 0.9, y: 0.09, heading: Math.PI, lengthM: 0.62, t: 1.37,
    omega: 4, ampScale: 1, turnBias: 0, phase: 0.6, finPhase: 2.2,
    ...over,
  }
  poseFish(sp, pose, verts, 0)

  const yOff = row * 150 + 30
  const tris: string[] = []
  for (let i = 0; i < indices.length; i += 3) {
    const pts: string[] = []
    let role = 0
    for (let k = 0; k < 3; k++) {
      const v = indices[i + k]!
      const o = v * FLOATS_PER_VERTEX
      role = verts[o + 4]!
      pts.push(`${(verts[o]! * SCALE).toFixed(1)},${(verts[o + 1]! * SCALE + yOff).toFixed(1)}`)
    }
    tris.push(`<polygon points="${pts.join(' ')}" fill="${ROLE_FILL[Math.round(role)]}"/>`)
  }
  rows.push(
    `<text x="12" y="${yOff - 4}" font-family="monospace" font-size="11" fill="#8FA894">${label}</text>`,
    ...tris,
  )
})

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${poses.length * 150 + 40}" viewBox="0 0 760 ${poses.length * 150 + 40}">
<rect width="100%" height="100%" fill="#12303a"/>
${rows.join('\n')}
</svg>`

const out = process.argv[3] ?? `scratch/rig-${speciesId}.svg`
writeFileSync(out, svg)
console.log(`wrote ${out}`)

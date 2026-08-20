/**
 * Render the journal's species plate on its own, large.
 *
 * On the page it is 300 pixels of a 5:1 silhouette; nothing about whether the
 * fins are traced correctly is visible at that size.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildPage, parsePage } from '../src/art/journalPage.ts'
import type { Species } from '../src/content/schema.ts'

const sp = JSON.parse(
  readFileSync(new URL('../src/content/species/dusky-flathead.json', import.meta.url), 'utf8'),
) as Species
const src = parsePage('p001', readFileSync(new URL('../src/content/journal/p001.md', import.meta.url), 'utf8'))
const art = buildPage(src, sp)

const box = art.sketchBox!
const pad = 4
const paths = art.sketch
  .map((s) => `<path d="${s.d}" fill="none" stroke="#22262e" stroke-width="${s.width}" stroke-linecap="round"/>`)
  .join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" viewBox="${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}">
<rect x="${box.x - pad}" y="${box.y - pad}" width="${box.w + pad * 2}" height="${box.h + pad * 2}" fill="#e9dfc4"/>
${paths}
</svg>`

writeFileSync(process.argv[2] ?? 'scratch/plate.svg', svg)
console.log('box', JSON.stringify(box), 'paths', art.sketch.length)

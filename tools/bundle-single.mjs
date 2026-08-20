/**
 * Bundle the game into one self-contained HTML file.
 *
 * For sharing a playable snapshot — a link someone can open on a phone without
 * a checkout or a server. It is NOT the shipped artefact: `npm run build`
 * produces the real PWA, with the service worker, the manifest and the split
 * chunks that let a returning player start from cache.
 *
 * Everything is inlined, including the typefaces, because the page has to work
 * with no network at all behind it.
 *
 * Usage: node tools/bundle-single.mjs [out.html]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] ?? 'dist-single/slack-water.html'

console.log('building…')
execFileSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, SINGLE_FILE: '1', BASE_PATH: './' },
})

const dist = new URL('../dist/', import.meta.url)
const assets = readdirSync(new URL('assets/', dist))
const js = assets.filter((f) => f.endsWith('.js'))
const css = assets.filter((f) => f.endsWith('.css'))
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.length}: ${js.join(', ')}`)

const read = (p) => readFileSync(new URL(p, dist), 'utf8')

// Fonts as data URIs. §5.2 self-hosts them so the game works offline; in one
// file, "self-hosted" has to mean "in the file".
let styles = css.map((f) => read(`assets/${f}`)).join('\n')
styles = styles.replace(/url\(([^)]*?\/)?fonts\/([^)]+?\.woff2)\)/g, (_m, _dir, file) => {
  const bytes = readFileSync(new URL(`fonts/${file}`, dist))
  return `url(data:font/woff2;base64,${bytes.toString('base64')})`
})

const script = read(`assets/${js[0]}`)

// The Artifact host supplies the document skeleton, so this is page content
// only — no doctype, html, head or body of our own. Title first, so it is
// found inside the 8KB the host scans.
const html = `<title>Slack Water</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, maximum-scale=1" />
<style>
${styles}
</style>
<div id="app">
  <canvas id="world"></canvas>
  <div id="overlay"></div>
</div>
<script type="module">
${script}
</script>
`

writeFileSync(out, html)
const kb = (n) => `${(n / 1024).toFixed(0)}KB`
console.log(`\n${out}  ${kb(Buffer.byteLength(html))}`)
console.log(`  script ${kb(script.length)}   styles+fonts ${kb(styles.length)}`)

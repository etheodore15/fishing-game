# Slack Water

**Play it: https://etheodore15.github.io/fishing-game/** — landscape, and it
installs to a homescreen.

A story-driven 2D fishing game for the NSW coast between Lake Macquarie and
Seal Rocks. Installable PWA, offline-capable, no backend, no accounts.

The subject is **reading water** — tide, wind, light, structure and bait — not
reflex timing. You get better because you understand more, and the game stores
that understanding in a journal you reconstruct one page at a time.

Built to `slack-water-design-doc` v1.0. This repository is the **Chapter 1
vertical slice** (§13 of that document): one water, one species, the full
read → cast → work → fight → log loop, and three journal pages.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173/fishing-game/
npm run build      # bake icons, typecheck, bundle to dist/
npm test           # simulation and content unit tests
```

Four harnesses check the things unit tests cannot:

| Command | What it proves |
|---|---|
| `npm run smoke` | The built game boots in headless Chromium with no WebGL or console errors. Shaders only compile at runtime — a green `tsc` proves nothing about the water. |
| `npm run play` | A whole trip, driven by real pointer gestures: cast, work, hook up, fight, resolve. Most of the bugs in the git history came out of this. |
| `npm run offline` | The save survives a reload and the game cold-starts with the network switched off. |
| `npm run perf` | Draw calls per frame against §11's cap of 40, and heap retention while rendering. |

Each takes a URL, so they can be pointed at a deployment as easily as at
`vite preview`.

Two more render pieces of generated art at a readable size, because neither is
reviewable in situ: `npm run rig` (the fish rig, 40 pixels long and underwater)
and `node --experimental-strip-types tools/plate-preview.ts` (the journal's
species plate).

## Shape of the code

| Path | What lives there |
|---|---|
| `src/engine/` | Fixed-step loop, the one authoritative clock, gesture input, device tiering, store, and every hand-feel constant in `tuning.ts` |
| `src/render/` | PixiJS stage, layer stack, and the GLSL passes |
| `src/sim/` | Tide, water field, fish, boids, line, rod, the fight, the trip |
| `src/art/` | Palettes, the parametric fish rig, the handwriting, journal pages, noise |
| `src/content/` | Species JSON, chapter JSON, journal markdown — content, not code |
| `src/ui/` | React DOM overlay. Never renders inside the play area |
| `tools/` | Build-time icon baking, and the harnesses above |

Rules the codebase holds to, all from the spec:

- **All visual output is generated from code.** The only binary assets are the
  three self-hosted WOFF2 typefaces, which §5.2 requires for offline use.
  Everything else — bathymetry, fish, weed, oyster racks, handwriting, paper
  fibre, water damage, the app icons — is drawn procedurally, so every art
  change is a text diff.
- **React is never in the animation path.** The game world is one PixiJS canvas
  driven by one clock; the DOM overlay updates at 4Hz at most. PixiJS's own
  tickers are stopped for the same reason.
- **The rod bend is the tension display.** There is no meter, no bar and no
  number, and none may be added.
- **Bust-ups are measured, never triggered.** If the bait is showering, a
  predator is genuinely inside the school.

## Deploying

A push to `main` runs the gates and publishes `dist/` to the `gh-pages`
branch, which is what §3 specifies. Pages serves that branch at
`https://<owner>.github.io/<repo>/`, and `BASE_PATH` is derived from the
repository name so a fork or a rename needs no edit.

Worth knowing if you ever start this from a bare repository: the newer
"Pages as an Actions source" flow cannot bootstrap itself, because
`GITHUB_TOKEN` may deploy to a Pages site but may not create one. Pushing a
`gh-pages` branch enables Pages on its own, which is why the deploy takes
that route.

## Where this build departs from the spec

Three places, all deliberate:

1. **WebGL2 only, not WebGPU.** §3 asks for "WebGL2, WebGPU when available".
   Every pass here is GLSL; supporting WebGPU means a WGSL copy of each shader
   and two rendering paths to keep in step. Device tiering still reads WebGPU
   support as a proxy for device class, exactly as §11 specifies. Adding WGSL
   later is additive — the shaders are already isolated in `render/shaders/`.
2. **No texture atlas.** §4 pencils in a build-time SVG → atlas step for fish
   and bait, but this renderer never got sprites to pack: fish are a deforming
   mesh solved per frame and bait are oriented quads, one draw call each.
   `tools/bake-icons.ts` does the build-time raster work that is actually
   needed — the PWA icons, from the loaded rod's own geometry.
3. **Audio is synthesised, not sampled.** §4 allows audio as the one binary
   asset; generating it from code instead keeps the repository reviewable as
   text, removes the download from the cold-start budget, and makes a sound
   change a diff. It is still played through Howler, as §3 specifies, as WAV
   data URIs built at boot.

## Still outstanding

**A device profile.** §11 targets a locked 60fps at 1080p on a Snapdragon
6-series-class phone, and §13 asks for a profile at the end of every milestone.
This build has never run on a GPU: the harnesses run under SwiftShader, where
the frame rate says nothing. Draw calls (15, against a cap of 40) and heap
retention (steady) are measured and hold; frame time is not, and cannot be
until someone runs it on hardware.

The three acceptance criteria about *feel* — that a first-time player can hook
a flathead with no tutorial, that a loss to the racks feels earned, and that
the tide pattern is articulable after three sessions — are playtest questions.
The simulation is built so they can be tuned rather than rewritten: every
constant behind them is in `src/engine/tuning.ts`.

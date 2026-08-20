# Slack Water

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
npm run build      # typecheck + production bundle into dist/
npm run test       # simulation unit tests
```

`npm run smoke` boots the built game in headless Chromium, fails on any WebGL
or console error, and writes a screenshot. Shader problems are runtime
problems — a green `tsc` proves nothing about the water.

## Shape of the code

| Path | What lives there |
|---|---|
| `src/engine/` | Fixed-step loop, the one authoritative clock, gesture input, device tiering, store |
| `src/render/` | PixiJS stage, layer stack, and the GLSL passes |
| `src/sim/` | Tide, water field, fish, boids, line, rod, the fight |
| `src/art/` | Palettes, the parametric fish rig, journal page generation, noise |
| `src/content/` | Species and chapter JSON — content, not code |
| `src/ui/` | React DOM overlay. Never renders inside the play area |

Two rules the codebase holds to, both from the spec:

- **All visual output is generated from code.** The only binary assets are the
  three self-hosted WOFF2 typefaces (§5.2 requires them for offline use).
  Everything else — bathymetry, fish, weed, oyster racks, handwriting, paper
  fibre, water damage — is drawn procedurally, so every art change is a text
  diff.
- **React is never in the animation path.** The game world is one PixiJS
  canvas driven by one clock. The DOM overlay updates at 4Hz at most.

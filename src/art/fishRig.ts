import type { Species } from '../content/schema.ts'

/**
 * The parametric fish rig (§8.1).
 *
 * ONE rig, every species. Nothing in this file knows what a flathead is — the
 * silhouette, the swim wave, the fins and the markings all come out of the
 * species JSON. Adding a species is adding a file, never adding code.
 *
 * The rig produces raw vertex data; render/fish.ts owns the GPU side and
 * sim/fish.ts owns the behaviour that drives it.
 */

/** Spine joints, root at the head. Fixed by the schema's 14-value curves. */
export const STATIONS = 14

/**
 * profileCurve is authored so that 0.5 is a normally-proportioned fish. This
 * converts it to half-depth as a fraction of body length: a 60cm flathead ends
 * up about 8cm deep in side view, which is what a dusky actually is.
 */
const PROFILE_SCALE = 0.135

/** Lateral travel of the tail tip, as a fraction of body length, at amp 1. */
const SWIM_AMPLITUDE = 0.085

/** Body wavelengths held along the spine. Just under one, as a fish does. */
const BODY_WAVES = 0.82

export interface FishPose {
  /** Head position, world metres. */
  x: number
  y: number
  /** Heading in radians; 0 points right (+x). */
  heading: number
  lengthM: number
  /** Seconds; the swim wave is a pure function of this and the state. */
  t: number
  /** Tail-beat rate, radians/sec. */
  omega: number
  /** Multiplier on SWIM_AMPLITUDE. Cruise is ~1, a burst is ~2.2. */
  ampScale: number
  /** Steady lateral bend from turning, -1..1. Adds to the swim wave. */
  turnBias: number
  /** Per-fish phase so a school does not beat in unison. */
  phase: number
  /** Fin flutter runs faster than the body and on its own phase. */
  finPhase: number
}

/**
 * Vertex layout. One interleaved buffer keeps the whole fish in a single draw
 * call — silhouette, outline and every fin.
 *
 *   aPosition vec2   world metres
 *   aUV       vec2   u along the body 0..1, v across the body -1..1
 *   aRole     float  0 body, 1 outline, 2 fin
 *   aFlank    float  -1..1, how far this flank has turned toward the camera;
 *                    the iridescence band rides on it
 */
export const FLOATS_PER_VERTEX = 6

/** Fin spans, as station indices. */
const DORSAL = { from: 3, to: 10 }
const ANAL = { from: 8, to: 11 }
const PECTORAL_STATION = 3
const CAUDAL_RAYS = 7

const BODY_VERTS = STATIONS * 2
const OUTLINE_PAIRS = STATIONS * 2
const OUTLINE_VERTS = OUTLINE_PAIRS * 2
const DORSAL_VERTS = (DORSAL.to - DORSAL.from + 1) * 2
const ANAL_VERTS = (ANAL.to - ANAL.from + 1) * 2
const PECTORAL_VERTS = 3
const CAUDAL_VERTS = CAUDAL_RAYS * 2

export const VERTEX_COUNT =
  BODY_VERTS + OUTLINE_VERTS + DORSAL_VERTS + ANAL_VERTS + PECTORAL_VERTS + CAUDAL_VERTS

const OFF_BODY = 0
const OFF_OUTLINE = OFF_BODY + BODY_VERTS
const OFF_DORSAL = OFF_OUTLINE + OUTLINE_VERTS
const OFF_ANAL = OFF_DORSAL + DORSAL_VERTS
const OFF_PECTORAL = OFF_ANAL + ANAL_VERTS
const OFF_CAUDAL = OFF_PECTORAL + PECTORAL_VERTS

/**
 * Where each part sits in the vertex buffer.
 *
 * Exported so the journal's species plate can be traced from the same rig the
 * player just caught, rather than from a second, hand-authored path set that
 * could drift away from it (§8.7).
 */
export const PARTS = {
  body: { offset: OFF_BODY, pairs: STATIONS },
  outline: { offset: OFF_OUTLINE, pairs: OUTLINE_PAIRS },
  dorsal: { offset: OFF_DORSAL, pairs: DORSAL.to - DORSAL.from + 1 },
  anal: { offset: OFF_ANAL, pairs: ANAL.to - ANAL.from + 1 },
  pectoral: { offset: OFF_PECTORAL, pairs: 0 },
  caudal: { offset: OFF_CAUDAL, pairs: CAUDAL_RAYS },
} as const

/** Triangle indices. Topology never changes, so this is built once. */
export function buildIndices(): Uint32Array {
  const idx: number[] = []
  const strip = (base: number, pairs: number, closed = false) => {
    const n = closed ? pairs : pairs - 1
    for (let i = 0; i < n; i++) {
      const a = base + ((i * 2) % (pairs * 2))
      const b = a + 1
      const c = base + (((i + 1) * 2) % (pairs * 2))
      const d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  strip(OFF_BODY, STATIONS)
  strip(OFF_DORSAL, DORSAL.to - DORSAL.from + 1)
  strip(OFF_ANAL, ANAL.to - ANAL.from + 1)
  idx.push(OFF_PECTORAL, OFF_PECTORAL + 1, OFF_PECTORAL + 2)
  strip(OFF_CAUDAL, CAUDAL_RAYS)
  // The silhouette is inked last, over the fins. On a screen-printed plate the
  // body outline is a continuous line; drawn before the fins, the dorsal simply
  // paints over the top half of it and the fish loses its edge.
  strip(OFF_OUTLINE, OUTLINE_PAIRS, true)
  return new Uint32Array(idx)
}

export const INDEX_COUNT = buildIndices().length

/** Scratch spine, reused across every fish and every frame. */
const sx = new Float32Array(STATIONS)
const sy = new Float32Array(STATIONS)
const nx = new Float32Array(STATIONS)
const ny = new Float32Array(STATIONS)
const halfW = new Float32Array(STATIONS)

/**
 * Solve the spine for this pose.
 *
 * The wave is applied as a lateral offset and the tangents are then recovered
 * from the resulting polyline, so the body widths stay genuinely perpendicular
 * to the spine instead of shearing as the fish flexes.
 */
function solveSpine(species: Species, pose: FishPose): void {
  const L = pose.lengthM
  const k = (Math.PI * 2 * BODY_WAVES) / (STATIONS - 1)
  const cos = Math.cos(pose.heading)
  const sin = Math.sin(pose.heading)

  for (let i = 0; i < STATIONS; i++) {
    const along = -(i / (STATIONS - 1)) * L // head at 0, tail behind
    const amp = species.amplitudeProfile[i]!
    // offset(i) = A(i) * sin(wt - k*i + phase), exactly as specified.
    const wave = Math.sin(pose.omega * pose.t - k * i + pose.phase)
    const lateral =
      amp * SWIM_AMPLITUDE * L * pose.ampScale * wave + amp * pose.turnBias * L * 0.16
    sx[i] = pose.x + along * cos - lateral * sin
    sy[i] = pose.y + along * sin + lateral * cos
    halfW[i] = species.profileCurve[i]! * PROFILE_SCALE * L
  }

  // The rig is a side view, so the fish mirrors when it turns around. Flip the
  // normals as a set, or a fish heading one way gets its dorsal surface —
  // colour, fins and markings — on its belly.
  //
  // Note the spine runs head to TAIL, so its tangent points backwards along the
  // fish: for a fish heading right (+x) the tangent is -x and the raw normal
  // already points up-screen. Hence flip is +1 there, not -1.
  const flip = cos >= 0 ? 1 : -1

  for (let i = 0; i < STATIONS; i++) {
    const a = i === 0 ? 0 : i - 1
    const b = i === STATIONS - 1 ? i : i + 1
    let tx = sx[b]! - sx[a]!
    let ty = sy[b]! - sy[a]!
    const len = Math.hypot(tx, ty) || 1
    tx /= len
    ty /= len
    nx[i] = -ty * flip
    ny[i] = tx * flip
  }
}

function put(
  out: Float32Array,
  v: number,
  x: number,
  y: number,
  u: number,
  vv: number,
  role: number,
  flank: number,
): void {
  const o = v * FLOATS_PER_VERTEX
  out[o] = x
  out[o + 1] = y
  out[o + 2] = u
  out[o + 3] = vv
  out[o + 4] = role
  out[o + 5] = flank
}

/**
 * Write one posed fish into `out` at `vertexOffset`.
 *
 * Allocation-free: the scratch spine is module-level and every write is into
 * the caller's buffer (§11 — zero allocations in the render loop).
 */
export function poseFish(
  species: Species,
  pose: FishPose,
  out: Float32Array,
  vertexOffset = 0,
): void {
  solveSpine(species, pose)
  const L = pose.lengthM
  const V = vertexOffset

  // The flank turn drives iridescence: as the body wave rolls down the fish,
  // each section presents more or less of its side to the viewer.
  const flankAt = (i: number) => nx[i]! * Math.sin(pose.heading) + ny[i]! * Math.cos(pose.heading)

  // ---- body ----
  for (let i = 0; i < STATIONS; i++) {
    const u = i / (STATIONS - 1)
    const f = flankAt(i)
    const w = halfW[i]!
    put(out, V + OFF_BODY + i * 2, sx[i]! + nx[i]! * w, sy[i]! + ny[i]! * w, u, -1, 0, f)
    put(out, V + OFF_BODY + i * 2 + 1, sx[i]! - nx[i]! * w, sy[i]! - ny[i]! * w, u, 1, 0, f)
  }

  // ---- outline ribbon ----
  // A variable-width stroke: heavy at the head, tapering to a hairline at the
  // tail, which is how the reference plates are inked.
  for (let p = 0; p < OUTLINE_PAIRS; p++) {
    const top = p < STATIONS
    const i = top ? p : OUTLINE_PAIRS - 1 - p
    const side = top ? 1 : -1
    const u = i / (STATIONS - 1)
    const stroke = L * (0.016 - 0.008 * u)
    const w = halfW[i]!
    const bx = sx[i]! + nx[i]! * w * side
    const by = sy[i]! + ny[i]! * w * side
    const f = flankAt(i)
    put(out, V + OFF_OUTLINE + p * 2, bx, by, u, side, 1, f)
    put(
      out,
      V + OFF_OUTLINE + p * 2 + 1,
      bx + nx[i]! * stroke * side,
      by + ny[i]! * stroke * side,
      u,
      side,
      1,
      f,
    )
  }

  // ---- fins ----
  // Each fin is parented to its spine joints and flutters on its own phase
  // offset, so nothing in the animation is in lockstep.
  const finWave = (offset: number, freq: number) =>
    Math.sin(pose.finPhase * freq + offset) * 0.22

  writeFin(out, V + OFF_DORSAL, DORSAL.from, DORSAL.to, 1, L * 0.048, finWave(0, 1.6), pose, flankAt)
  writeFin(out, V + OFF_ANAL, ANAL.from, ANAL.to, -1, L * 0.032, finWave(2.1, 1.9), pose, flankAt)

  // Pectoral: one broad triangle off the shoulder, on its own beat.
  {
    const i = PECTORAL_STATION
    const w = halfW[i]!
    const sweep = 0.45 + finWave(1.2, 2.4)
    const baseX = sx[i]! - nx[i]! * w
    const baseY = sy[i]! - ny[i]! * w
    const tipX = baseX - nx[i]! * L * 0.055 * sweep - (sx[i]! - sx[i + 2]!) * 0.7
    const tipY = baseY - ny[i]! * L * 0.055 * sweep - (sy[i]! - sy[i + 2]!) * 0.7
    const f = flankAt(i)
    put(out, V + OFF_PECTORAL, baseX, baseY, 0.25, 1, 2, f)
    put(out, V + OFF_PECTORAL + 1, sx[i + 1]! - nx[i + 1]! * halfW[i + 1]!, sy[i + 1]! - ny[i + 1]! * halfW[i + 1]!, 0.32, 1, 2, f)
    put(out, V + OFF_PECTORAL + 2, tipX, tipY, 0.3, 1, 2, f)
  }

  // Caudal: a fan off the last joint. `fork` pinches the centre rays, `span`
  // sets the height — a flathead's near-square tail and a tailor's deep fork
  // are the same code with different numbers.
  {
    const i = STATIONS - 1
    const span = species.caudal.span * L * 0.095
    const fork = species.caudal.fork
    const beat = Math.sin(pose.omega * pose.t - ((Math.PI * 2 * BODY_WAVES) / (STATIONS - 1)) * i + pose.phase + 1.1)
    const f = flankAt(i)
    for (let r = 0; r < CAUDAL_RAYS; r++) {
      const s = (r / (CAUDAL_RAYS - 1)) * 2 - 1 // -1 top .. 1 bottom
      // The fork is a notch: rays near the centre are shorter.
      const reach = L * 0.115 * (1 - fork * (1 - Math.abs(s)) * 2.2)
      const spread = span * s
      const rootX = sx[i]! + nx[i]! * spread * 0.25
      const rootY = sy[i]! + ny[i]! * spread * 0.25
      const tx = sx[i]! - sx[i - 1]!
      const ty = sy[i]! - sy[i - 1]!
      const tl = Math.hypot(tx, ty) || 1
      const lash = beat * 0.35 * (1 - Math.abs(s) * 0.4)
      put(out, V + OFF_CAUDAL + r * 2, rootX, rootY, 1, s, 2, f)
      put(
        out,
        V + OFF_CAUDAL + r * 2 + 1,
        rootX + (tx / tl) * reach + nx[i]! * (spread + lash * span),
        rootY + (ty / tl) * reach + ny[i]! * (spread + lash * span),
        1,
        s,
        2,
        f,
      )
    }
  }
}

function writeFin(
  out: Float32Array,
  base: number,
  from: number,
  to: number,
  side: number,
  height: number,
  flutter: number,
  pose: FishPose,
  flankAt: (i: number) => number,
): void {
  const n = to - from
  for (let j = 0; j <= n; j++) {
    const i = from + j
    const t = j / n
    // Fins are tallest in the middle and taper to nothing at either end.
    const profile = Math.sin(Math.PI * t)
    const w = halfW[i]!
    const bx = sx[i]! + nx[i]! * w * side
    const by = sy[i]! + ny[i]! * w * side
    const h = height * profile * (1 + flutter * Math.sin(t * 5 + pose.finPhase))
    const f = flankAt(i)
    const u = i / (STATIONS - 1)
    put(out, base + j * 2, bx, by, u, side, 2, f)
    put(out, base + j * 2 + 1, bx + nx[i]! * (w + h) * side * 0.001 + nx[i]! * h * side, by + ny[i]! * h * side, u, side * 1.6, 2, f)
  }
}

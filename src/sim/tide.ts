/**
 * Tide, light and moon.
 *
 * §15.1 recommendation: keep this standalone and dependency-free so it can be
 * lifted into a shared package with Fisherman's Almanac later without dragging
 * the game engine along. It therefore imports nothing, takes its configuration
 * as arguments, and returns plain data. Do not add imports to this file.
 */

export type TideState = 'run-in' | 'high-slack' | 'run-out' | 'low-slack'

export interface TideConfig {
  /** Real seconds for a full low→high→low cycle. */
  cycleRealSeconds: number
  /** Tidal range low to high, metres. */
  rangeM: number
  /** Mean water height, metres. */
  meanM: number
  /** |normalised flow| below this reads as slack water. */
  slackThreshold: number
  /** Cycle phase at t=0, 0-1. 0 = dead low. */
  phaseOffset: number
}

export const DEFAULT_TIDE: TideConfig = {
  cycleRealSeconds: 360,
  rangeM: 1.4,
  meanM: 0.9,
  slackThreshold: 0.3,
  phaseOffset: 0.62,
}

export interface TideReading {
  /** 0-1 through the cycle. 0 = dead low, 0.5 = dead high. */
  phase: number
  /** Water height in metres. */
  heightM: number
  state: TideState
  /** Signed flow: +1 full flood, -1 full ebb, 0 slack. */
  flow: number
  /** |flow|, the figure the sim actually pushes bait and drift with. */
  speed: number
  /** True while the tide is falling, regardless of slack. */
  falling: boolean
}

const TAU = Math.PI * 2

/**
 * `out` lets callers reuse a reading across fixed steps. §11 asks for zero
 * allocations in the hot path and this is read every step.
 */
export function readTide(
  elapsedSeconds: number,
  cfg: TideConfig = DEFAULT_TIDE,
  out?: TideReading,
): TideReading {
  const raw = elapsedSeconds / cfg.cycleRealSeconds + cfg.phaseOffset
  const phase = raw - Math.floor(raw)

  // Height is a cosine trough-to-trough; flow is its derivative, normalised.
  const heightM = cfg.meanM - (cfg.rangeM / 2) * Math.cos(TAU * phase)
  const flow = Math.sin(TAU * phase)
  const speed = Math.abs(flow)
  const falling = phase > 0.5

  let state: TideState
  if (speed < cfg.slackThreshold) {
    state = phase < 0.25 || phase >= 0.75 ? 'low-slack' : 'high-slack'
  } else {
    state = falling ? 'run-out' : 'run-in'
  }

  if (out) {
    out.phase = phase
    out.heightM = heightM
    out.state = state
    out.flow = flow
    out.speed = speed
    out.falling = falling
    return out
  }
  return { phase, heightM, state, flow, speed, falling }
}

export function emptyTideReading(): TideReading {
  return { phase: 0, heightM: 0, state: 'low-slack', flow: 0, speed: 0, falling: false }
}

/** Human label for the utility strip: "TIDE ↓ 0.8m". */
export function tideGlyph(r: TideReading): string {
  if (r.state === 'high-slack' || r.state === 'low-slack') return '—'
  return r.falling ? '↓' : '↑'
}

export interface LightReading {
  /** 0 = full dark, 1 = full midday sun. Drives palette blend and glare. */
  level: number
  /** Sun/moon elevation, radians above the horizon. Negative is below. */
  elevation: number
  /** Horizontal position of the light source, -1 (east) to 1 (west). */
  azimuth: number
  /** True between civil dusk and civil dawn — the moon is the light source. */
  night: boolean
  /** 0-1, peaks at dawn and dusk. Drives the DUSK_BURN / DAWN_GLASS blends. */
  goldenness: number
}

/**
 * A day/night curve good enough for a game, not an ephemeris.
 * Sunrise ~5:45, sunset ~18:15 — a plausible NSW coastal spring.
 */
export function readLight(hourOfDay: number, moonPhase = 0.5, out?: LightReading): LightReading {
  const sunrise = 5.75
  const sunset = 18.25
  const dayLength = sunset - sunrise

  // Elevation as a half-sine across daylight hours, continuous into night.
  const t = (hourOfDay - sunrise) / dayLength
  const elevation = Math.sin(Math.PI * t) * 1.2 - 0.08

  const night = elevation <= 0
  // Moonlight: never more than a tenth of daylight, scaled by phase.
  const moonLevel = 0.02 + 0.08 * (1 - Math.abs(moonPhase - 0.5) * 2)
  const level = night ? moonLevel : Math.min(1, Math.max(0, Math.sin(Math.PI * t)))

  const azimuth = Math.max(-1, Math.min(1, (hourOfDay - 12) / 6))

  // Golden hour: brightest weighting where the sun sits just above the horizon.
  const g = night ? 0 : Math.exp(-Math.pow((elevation - 0.18) / 0.22, 2))
  if (out) {
    out.level = level
    out.elevation = elevation
    out.azimuth = azimuth
    out.night = night
    out.goldenness = g
    return out
  }
  return { level, elevation, azimuth, night, goldenness: g }
}

export function emptyLightReading(): LightReading {
  return { level: 0, elevation: 0, azimuth: 0, night: false, goldenness: 0 }
}

export interface WindReading {
  speedKt: number
  dirDeg: number
  /** Unit vector, screen space: +x is right (west-ward), +y is into the scene. */
  x: number
  y: number
}

export function emptyWindReading(): WindReading {
  return { speedKt: 0, dirDeg: 0, x: 0, y: 0 }
}

/** Wind for a session: a steady vector with slow, seeded gusting. */
export function readWind(
  elapsedSeconds: number,
  baseKt: number,
  baseDirDeg: number,
  out: WindReading = emptyWindReading(),
): WindReading {
  const gust = Math.sin(elapsedSeconds * 0.13) * 0.5 + Math.sin(elapsedSeconds * 0.041) * 0.5
  const speedKt = Math.max(0, baseKt + gust * baseKt * 0.28)
  const dirDeg = baseDirDeg + Math.sin(elapsedSeconds * 0.027) * 11
  const rad = (dirDeg * Math.PI) / 180
  out.speedKt = speedKt
  out.dirDeg = dirDeg
  out.x = Math.sin(rad)
  out.y = Math.cos(rad)
  return out
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const

export function compass(dirDeg: number): string {
  const i = Math.round((((dirDeg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[i]!
}

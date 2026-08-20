export type Tier = 'high' | 'mid' | 'low'

export interface QualitySettings {
  tier: Tier
  /** Gerstner octaves in the surface pass. */
  waterOctaves: number
  caustics: boolean
  particleCap: number
  /** 'full' = halftone + grain + misregistration, 'halftone' = no misregistration. */
  printPass: 'full' | 'halftone' | 'off'
  /** Boid agent count — §8.5 calls for 200-400. */
  baitAgents: number
}

const TABLE: Record<Tier, Omit<QualitySettings, 'tier'>> = {
  high: { waterOctaves: 4, caustics: true, particleCap: 600, printPass: 'full', baitAgents: 400 },
  mid: { waterOctaves: 3, caustics: true, particleCap: 350, printPass: 'halftone', baitAgents: 300 },
  low: { waterOctaves: 2, caustics: false, particleCap: 150, printPass: 'off', baitAgents: 200 },
}

export function settingsFor(tier: Tier): QualitySettings {
  return { tier, ...TABLE[tier] }
}

/** Initial tier from device capability alone (§11). */
export function detectTier(): Tier {
  const cores = navigator.hardwareConcurrency ?? 4
  const hasWebGPU = 'gpu' in navigator
  if (hasWebGPU || cores > 6) return 'high'
  return 'mid'
}

/**
 * Device tiering with a live probe.
 *
 * Detection alone is a guess — a phone that reports eight cores still thermally
 * throttles. §11 defines low tier as *measured* <45fps over the first three
 * seconds, so the probe is the authority and may only ever demote.
 */
export class Quality {
  settings: QualitySettings
  private probeElapsed = 0
  private probeFrames = 0
  private probeDone = false
  private listeners = new Set<(s: QualitySettings) => void>()

  /** Ignore the first second: shader compilation and texture upload land there. */
  private readonly warmupSec = 1
  private readonly probeSec = 3
  private readonly floorFps = 45

  constructor(tier: Tier = detectTier()) {
    this.settings = settingsFor(tier)
  }

  onChange(fn: (s: QualitySettings) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Feed the loop's per-second fps sample. */
  sample(fps: number, dt = 1): void {
    if (this.probeDone) return
    this.probeElapsed += dt
    if (this.probeElapsed <= this.warmupSec) return
    this.probeFrames += 1
    this.probeAverage = (this.probeAverage * (this.probeFrames - 1) + fps) / this.probeFrames
    if (this.probeElapsed >= this.probeSec + this.warmupSec) {
      this.probeDone = true
      if (this.probeAverage < this.floorFps) this.demote()
    }
  }

  private probeAverage = 60

  /** Manual override from the settings menu. Ends the probe. */
  force(tier: Tier): void {
    this.probeDone = true
    this.apply(tier)
  }

  private demote(): void {
    const next: Tier = this.settings.tier === 'high' ? 'mid' : 'low'
    this.apply(next)
  }

  private apply(tier: Tier): void {
    if (tier === this.settings.tier) return
    this.settings = settingsFor(tier)
    for (const fn of this.listeners) fn(this.settings)
  }
}

/** §9: reduced motion kills misregistration, shake and parallax — never the sim. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

import { Howl, Howler } from 'howler'
import { rng } from './art/noise.ts'

/**
 * Sound.
 *
 * Every cue is synthesised at boot and handed to Howler as a WAV data URI.
 * That is deliberate: §4 allows audio as the one binary asset, but generating
 * it from code instead keeps the whole repository reviewable as text diffs,
 * removes the download from the cold-start budget (§13: under 3s offline), and
 * means a sound change is a diff rather than a new file.
 *
 * §12: audio is fully optional and nothing is communicated by sound alone —
 * every cue here has a visual counterpart that carries the same information.
 */

const RATE = 22050

export type Cue =
  | 'cast'
  | 'splash'
  | 'snag'
  | 'hookup'
  | 'headshake'
  | 'surge'
  | 'line-break'
  | 'hook-pull'
  | 'bust-off'
  | 'landed'

/** A one-pole lowpass. Enough shaping for cues this short. */
class LowPass {
  private z = 0
  constructor(private a: number) {}
  set cutoff(a: number) {
    this.a = Math.min(1, Math.max(0.001, a))
  }
  run(x: number): number {
    this.z += this.a * (x - this.z)
    return this.z
  }
}

interface Voice {
  seconds: number
  render(t: number, i: number, rand: () => number, lp: LowPass): number
}

/** Exponential decay, the shape almost every physical impact has. */
function decay(t: number, tau: number): number {
  return Math.exp(-t / tau)
}

const VOICES: Record<Cue, Voice> = {
  // A rod loading and unloading: air over the blank, no impact.
  cast: {
    seconds: 0.42,
    render(t, _i, rand, lp) {
      const swell = Math.sin((Math.PI * t) / this.seconds)
      lp.cutoff = 0.05 + swell * 0.5
      return lp.run(rand() * 2 - 1) * swell * 0.5
    },
  },
  // A small lure hitting flat water: bright transient, quick dark tail.
  splash: {
    seconds: 0.55,
    render(t, _i, rand, lp) {
      lp.cutoff = 0.7 * decay(t, 0.06) + 0.03
      const noise = lp.run(rand() * 2 - 1)
      const plop = Math.sin(2 * Math.PI * (420 - 260 * Math.min(1, t / 0.12)) * t) * decay(t, 0.05)
      return noise * decay(t, 0.16) * 0.8 + plop * 0.35
    },
  },
  // Something solid, and then nothing. A snag is an ending.
  snag: {
    seconds: 0.4,
    render(t, _i, rand, lp) {
      lp.cutoff = 0.12
      const thud = Math.sin(2 * Math.PI * 96 * t) * decay(t, 0.07)
      return thud * 0.6 + lp.run(rand() * 2 - 1) * decay(t, 0.05) * 0.4
    },
  },
  // Weight arriving at the rod tip.
  hookup: {
    seconds: 0.45,
    render(t, _i, rand, lp) {
      lp.cutoff = 0.25
      const thump = Math.sin(2 * Math.PI * (150 - 60 * t) * t) * decay(t, 0.12)
      return thump * 0.7 + lp.run(rand() * 2 - 1) * decay(t, 0.03) * 0.25
    },
  },
  // Three hard knocks through the blank — the tip ringing.
  headshake: {
    seconds: 0.36,
    render(t, _i, _rand, lp) {
      lp.cutoff = 0.4
      const beat = Math.max(0, Math.sin(2 * Math.PI * 8.5 * t))
      const knock = Math.sin(2 * Math.PI * 190 * t) * Math.pow(beat, 6)
      return lp.run(knock) * decay(t, 0.16) * 0.75
    },
  },
  // Drag giving line: a hiss that climbs and then eases.
  surge: {
    seconds: 0.7,
    render(t, _i, rand, lp) {
      const shape = Math.sin((Math.PI * t) / this.seconds)
      lp.cutoff = 0.10 + shape * 0.30
      const grain = Math.sin(2 * Math.PI * 55 * t) * 0.2
      return lp.run(rand() * 2 - 1 + grain) * shape * 0.42
    },
  },
  // A crack, then the whip of a line with nothing on the end of it.
  'line-break': {
    seconds: 0.6,
    render(t, _i, rand, lp) {
      lp.cutoff = 0.9 * decay(t, 0.012) + 0.06
      const crack = lp.run(rand() * 2 - 1) * decay(t, 0.02)
      const whip = Math.sin(2 * Math.PI * (900 * decay(t, 0.09) + 110) * t) * decay(t, 0.22)
      return crack * 0.9 + whip * 0.3
    },
  },
  // The opposite: no crack at all, just weight vanishing.
  'hook-pull': {
    seconds: 0.34,
    render(t, _i, _rand, lp) {
      lp.cutoff = 0.08
      const pop = Math.sin(2 * Math.PI * (128 - 70 * t) * t) * decay(t, 0.06)
      return lp.run(pop) * 0.75
    },
  },
  // Line dragged across oyster shell, then gone.
  'bust-off': {
    seconds: 0.62,
    render(t, _i, rand, lp) {
      const rasp = 0.5 + 0.5 * Math.sin(2 * Math.PI * 34 * t)
      lp.cutoff = 0.35 + rasp * 0.3
      const grind = lp.run(rand() * 2 - 1) * rasp
      const snap = decay(Math.max(0, t - 0.44), 0.02) * (t > 0.44 ? rand() * 2 - 1 : 0)
      return grind * decay(t, 0.4) * 0.55 + snap * 0.5
    },
  },
  // Water moving, and the fish alongside.
  landed: {
    seconds: 0.8,
    render(t, _i, rand, lp) {
      lp.cutoff = 0.16
      const wash = lp.run(rand() * 2 - 1) * Math.sin((Math.PI * t) / this.seconds)
      const tone = Math.sin(2 * Math.PI * 196 * t) * decay(t, 0.28) * 0.18
      return wash * 0.5 + tone
    },
  },
}

function renderWav(cue: Cue, seed: number): string {
  const voice = VOICES[cue]
  const n = Math.floor(voice.seconds * RATE)
  const bytes = new Uint8Array(44 + n * 2)
  const view = new DataView(bytes.buffer)

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 2, true)

  const rand = rng(seed)
  const lp = new LowPass(0.2)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    let s = voice.render(t, i, rand, lp)
    // A short fade at both ends, so no cue starts or ends on a click.
    const edge = Math.min(1, i / 64, (n - i) / 256)
    s *= edge
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true)
  }

  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

const VOLUMES: Record<Cue, number> = {
  cast: 0.35,
  splash: 0.5,
  snag: 0.6,
  hookup: 0.7,
  headshake: 0.55,
  surge: 0.5,
  'line-break': 0.8,
  'hook-pull': 0.6,
  'bust-off': 0.75,
  landed: 0.6,
}

export class Audio {
  private sounds = new Map<Cue, Howl>()
  private ready = false
  private enabled = true

  /**
   * Build every cue. Cheap enough to do at boot — the whole set is well under
   * a megabyte of samples and takes a few milliseconds to synthesise.
   */
  init(): void {
    if (this.ready) return
    this.ready = true
    let seed = 91
    for (const cue of Object.keys(VOICES) as Cue[]) {
      this.sounds.set(
        cue,
        new Howl({ src: [renderWav(cue, (seed += 977))], format: ['wav'], volume: VOLUMES[cue] }),
      )
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    Howler.mute(!on)
  }

  play(cue: Cue, rate = 1): void {
    if (!this.enabled || !this.ready) return
    const h = this.sounds.get(cue)
    if (!h) return
    const id = h.play()
    if (rate !== 1) h.rate(Math.max(0.5, Math.min(2, rate)), id)
  }

  destroy(): void {
    for (const h of this.sounds.values()) h.unload()
    this.sounds.clear()
    this.ready = false
  }
}

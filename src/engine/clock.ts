import { TIME_COMPRESSION } from './tuning.ts'

/**
 * The single authoritative game clock (§9).
 *
 * Nothing in the game world may read Date.now() or performance.now() directly.
 * Every animated value is a pure function of the values this clock exposes, so
 * a paused game is genuinely frozen and a replayed sim is identical.
 */
export class Clock {
  /** Accumulated simulated seconds. Advances only on a fixed step. */
  simTime = 0
  /** Completed fixed steps since start. */
  tick = 0
  /** Fixed step length in seconds. */
  readonly step: number
  /** Interpolation factor 0-1 between the last two sim steps, set by the loop. */
  alpha = 0
  /** Wall-clock seconds of the current frame, for the loop's accumulator only. */
  frameTime = 0
  /** In-game hour at session start (0-24). */
  startHour: number

  constructor(step = 1 / 60, startHour = 6.8) {
    this.step = step
    this.startHour = startHour
  }

  advance(): void {
    this.simTime += this.step
    this.tick += 1
  }

  /** In-game seconds elapsed, compressed from real time. */
  get gameSeconds(): number {
    return this.startHour * 3600 + this.simTime * TIME_COMPRESSION
  }

  /** Continuous 0-24 clock the palette interpolates along (§5.1). */
  get hourOfDay(): number {
    const h = (this.gameSeconds / 3600) % 24
    return h < 0 ? h + 24 : h
  }

  /** Render-time seconds: sim time plus the un-stepped remainder. */
  get renderTime(): number {
    return this.simTime + this.alpha * this.step
  }

  /** HH:MM for the utility strip. */
  format(): string {
    const h = this.hourOfDay
    const hh = Math.floor(h)
    const mm = Math.floor((h - hh) * 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  reset(startHour = this.startHour): void {
    this.simTime = 0
    this.tick = 0
    this.alpha = 0
    this.startHour = startHour
  }
}

import { GESTURE } from './tuning.ts'

export type GestureEvent =
  | { type: 'tap'; x: number; y: number; nx: number; ny: number }
  | { type: 'holdstart'; x: number; y: number; nx: number; ny: number }
  | { type: 'holdmove'; x: number; y: number; nx: number; ny: number }
  | { type: 'holdend'; x: number; y: number; durationMs: number }
  | { type: 'hop' }
  | {
      type: 'flick'
      /** Where the flick began, in normalised 0-1 screen space. */
      nx: number
      ny: number
      /** Flick direction, screen space, unit length. */
      dx: number
      dy: number
      /** 0-1 across GESTURE.flickMin/MaxPx. */
      power: number
      /** Radians, atan2(-dy, dx) — up-screen is positive. */
      angle: number
    }

type Listener = (e: GestureEvent) => void

/**
 * Cast power from a gesture, 0-1.
 *
 * Pure and exported so it can be tested without a DOM: this is the single most
 * important number in the game's feel, and it was wrong for a long time
 * without anything noticing.
 *
 * @param distPx    total travel of the gesture, start to finish
 * @param peakSpeed fastest sampled speed, in viewport diagonals per second
 * @param diagonal  viewport diagonal in px, so the feel is screen-relative
 */
export function castPower(distPx: number, peakSpeed: number, diagonal: number): number {
  const diag = diagonal || 1
  const minFraction = GESTURE.flickMinPx / diag
  const travelSpan = Math.max(1e-4, GESTURE.flickFullTravel - minFraction)
  const byTravel = (distPx / diag - minFraction) / travelSpan
  const speedSpan = Math.max(1e-4, GESTURE.flickFullSpeed - GESTURE.flickIdleSpeed)
  const bySpeed = (peakSpeed - GESTURE.flickIdleSpeed) / speedSpan
  return Math.min(1, Math.max(0, Math.max(byTravel, bySpeed)))
}

interface Sample {
  x: number
  y: number
  t: number
}

/**
 * Pointer → normalised gesture events (§12).
 *
 * One pointer at a time: the game never needs two, and accepting a second
 * during a fight is how a player accidentally dumps drag. Thresholds all come
 * from engine/tuning.ts so they can be tuned on hardware without touching this.
 */
export class InputRouter {
  private listeners = new Set<Listener>()
  private pointerId: number | null = null
  private startX = 0
  private startY = 0
  private startT = 0
  private moved = 0
  private holding = false
  private holdTimer = 0
  private lastReleaseT = -Infinity
  private lastReleaseWasHold = false
  private samples: Sample[] = []
  /** Reused so the router allocates nothing per pointer event. */
  private readonly scratch: Sample = { x: 0, y: 0, t: 0 }

  private readonly el: HTMLElement

  constructor(el: HTMLElement) {
    this.el = el
    el.addEventListener('pointerdown', this.onDown, { passive: false })
    el.addEventListener('pointermove', this.onMove, { passive: false })
    el.addEventListener('pointerup', this.onUp, { passive: false })
    el.addEventListener('pointercancel', this.onCancel, { passive: false })
    el.addEventListener('contextmenu', this.onContextMenu)
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** True while the player is holding — the drag/retrieve gesture. */
  get isHolding(): boolean {
    return this.holding
  }

  destroy(): void {
    const el = this.el
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('contextmenu', this.onContextMenu)
    clearTimeout(this.holdTimer)
    this.listeners.clear()
  }

  private emit(e: GestureEvent): void {
    for (const fn of this.listeners) fn(e)
  }

  private norm(x: number, y: number): { nx: number; ny: number } {
    const r = this.el.getBoundingClientRect()
    this.scratch.t = 0 // keep scratch hot; value unused here
    return { nx: (x - r.left) / r.width, ny: (y - r.top) / r.height }
  }

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault()
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return
    e.preventDefault()
    // Capture is an optimisation, not a requirement: it throws for synthetic
    // pointers and on a couple of mobile browsers, and losing it only means a
    // gesture that leaves the canvas ends early.
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* not fatal */
    }
    this.pointerId = e.pointerId
    this.startX = e.clientX
    this.startY = e.clientY
    this.startT = e.timeStamp
    this.moved = 0
    this.samples.length = 0
    this.pushSample(e.clientX, e.clientY, e.timeStamp)

    clearTimeout(this.holdTimer)
    this.holdTimer = window.setTimeout(() => {
      if (this.pointerId === null || this.moved > GESTURE.flickMinPx) return
      this.holding = true
      const { nx, ny } = this.norm(this.startX, this.startY)
      this.emit({ type: 'holdstart', x: this.startX, y: this.startY, nx, ny })
    }, GESTURE.holdMinMs)
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    e.preventDefault()
    const dx = e.clientX - this.startX
    const dy = e.clientY - this.startY
    this.moved = Math.hypot(dx, dy)
    this.pushSample(e.clientX, e.clientY, e.timeStamp)
    // Once the pointer has travelled far enough to be a cast, it can no longer
    // become a hold. Without this a slow flick turns into a drag partway
    // through and the cast is silently swallowed.
    if (!this.holding && this.moved > GESTURE.flickMinPx) clearTimeout(this.holdTimer)
    if (this.holding) {
      const { nx, ny } = this.norm(e.clientX, e.clientY)
      this.emit({ type: 'holdmove', x: e.clientX, y: e.clientY, nx, ny })
    }
  }

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    e.preventDefault()
    this.pushSample(e.clientX, e.clientY, e.timeStamp)
    clearTimeout(this.holdTimer)
    const duration = e.timeStamp - this.startT
    const wasHolding = this.holding
    this.pointerId = null
    this.holding = false

    if (wasHolding) {
      this.emit({ type: 'holdend', x: e.clientX, y: e.clientY, durationMs: duration })
      // hold → release → hold reads as a hop; the second hold closes the pattern.
      this.lastReleaseWasHold = true
      this.lastReleaseT = e.timeStamp
      return
    }

    const flick = this.resolveFlick(e.clientX, e.clientY, e.timeStamp)
    if (flick) {
      this.lastReleaseWasHold = false
      this.emit(flick)
      return
    }

    if (duration <= GESTURE.tapMaxMs && this.moved <= GESTURE.tapSlopPx) {
      if (this.lastReleaseWasHold && e.timeStamp - this.lastReleaseT <= GESTURE.hopGapMaxMs) {
        this.lastReleaseWasHold = false
        this.emit({ type: 'hop' })
        return
      }
      const { nx, ny } = this.norm(e.clientX, e.clientY)
      this.emit({ type: 'tap', x: e.clientX, y: e.clientY, nx, ny })
    }
    this.lastReleaseWasHold = false
  }

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    clearTimeout(this.holdTimer)
    if (this.holding) {
      this.emit({ type: 'holdend', x: this.startX, y: this.startY, durationMs: 0 })
    }
    this.pointerId = null
    this.holding = false
    this.lastReleaseWasHold = false
  }

  private pushSample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t })
    if (this.samples.length > GESTURE.flickSamples) this.samples.shift()
  }

  /**
   * Resolve a cast.
   *
   * Power is the greater of how far the thumb went and how fast it was going,
   * both measured against the size of the screen so the gesture feels the same
   * on a phone and a tablet.
   *
   * This used to measure displacement across the last few samples only — about
   * eighty milliseconds — and score that against a fixed pixel span. That is a
   * velocity dressed up as a distance: a full-blooded swipe across the screen
   * came out at a tenth of full power, so every cast landed a couple of metres
   * from the rod tip.
   */
  private resolveFlick(endX: number, endY: number, endT: number): GestureEvent | null {
    if (endT - this.startT > GESTURE.flickMaxMs) return null

    // Distance is the whole gesture, start to finish. Nothing partial.
    const dx = endX - this.startX
    const dy = endY - this.startY
    const dist = Math.hypot(dx, dy)
    if (dist < GESTURE.flickMinPx) return null

    const r = this.el.getBoundingClientRect()
    const diagonal = Math.hypot(r.width, r.height) || 1

    // Peak speed across the sample window, in diagonals per second.
    let peak = 0
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1]!
      const b = this.samples[i]!
      const dt = (b.t - a.t) / 1000
      if (dt <= 0) continue
      peak = Math.max(peak, Math.hypot(b.x - a.x, b.y - a.y) / diagonal / dt)
    }

    const power = castPower(dist, peak, diagonal)
    const { nx, ny } = this.norm(this.startX, this.startY)
    return {
      type: 'flick',
      nx,
      ny,
      dx: dx / dist,
      dy: dy / dist,
      power,
      angle: Math.atan2(-dy, dx),
    }
  }
}

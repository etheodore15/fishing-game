import type { Clock } from './clock.ts'

export interface LoopHandlers {
  /** Fixed-step simulation. Called 0..maxSubSteps times per frame. */
  update(dt: number, clock: Clock): void
  /** Variable-rate render. Interpolate using clock.alpha. */
  render(clock: Clock): void
  /** Called once per second with the measured frame rate. */
  sample?(fps: number): void
}

/**
 * Fixed-step simulation with an accumulator; render interpolates (§9).
 *
 * The loop allocates nothing per frame — acceptance depends on a locked 60fps
 * and a GC pause is a dropped frame.
 */
export class GameLoop {
  private raf = 0
  private last = 0
  private accumulator = 0
  private running = false
  private fpsFrames = 0
  private fpsElapsed = 0

  /** Beyond this many sub-steps we drop simulated time rather than spiral. */
  readonly maxSubSteps = 5

  private readonly clock: Clock
  private readonly handlers: LoopHandlers

  constructor(clock: Clock, handlers: LoopHandlers) {
    this.clock = clock
    this.handlers = handlers
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.accumulator = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  get isRunning(): boolean {
    return this.running
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)

    // Clamp: a backgrounded tab returns with a huge delta. Never simulate it.
    let elapsed = (now - this.last) / 1000
    this.last = now
    if (elapsed > 0.25) elapsed = 0.25
    this.clock.frameTime = now / 1000

    this.fpsFrames += 1
    this.fpsElapsed += elapsed
    if (this.fpsElapsed >= 1) {
      this.handlers.sample?.(this.fpsFrames / this.fpsElapsed)
      this.fpsFrames = 0
      this.fpsElapsed = 0
    }

    this.accumulator += elapsed
    const step = this.clock.step
    let steps = 0
    while (this.accumulator >= step && steps < this.maxSubSteps) {
      this.clock.advance()
      this.handlers.update(step, this.clock)
      this.accumulator -= step
      steps += 1
    }
    if (steps === this.maxSubSteps) this.accumulator = 0

    this.clock.alpha = this.accumulator / step
    this.handlers.render(this.clock)
  }
}

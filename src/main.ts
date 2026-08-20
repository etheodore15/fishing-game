import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import './ui/fonts.css'
import './ui/shell.css'
import { Clock } from './engine/clock.ts'
import { GameLoop } from './engine/loop.ts'
import { Quality, prefersReducedMotion } from './engine/quality.ts'
import { gameStore } from './engine/store.ts'
import { Stage } from './render/stage.ts'
import { World } from './sim/world.ts'
import { chapter } from './content/index.ts'
import { App } from './ui/App.tsx'

interface Debug {
  ready: boolean
  fps: number
  tier: string
  [k: string]: unknown
}

const debug: Debug = { ready: false, fps: 0, tier: 'mid' }
;(globalThis as unknown as { __slackwater: Debug }).__slackwater = debug

async function boot(): Promise<void> {
  const canvas = document.getElementById('world') as HTMLCanvasElement
  const overlay = document.getElementById('overlay') as HTMLElement

  const ch = chapter('ch1-estuary')
  const reduced = prefersReducedMotion()
  gameStore.getState().setSettings({ reducedMotion: reduced })

  const quality = new Quality()
  const stage = new Stage()
  await stage.init(canvas, quality.settings, reduced)

  const clock = new Clock(1 / 60, ch.startHour)
  const world = new World(ch, stage, quality)
  world.layout()

  quality.onChange((s) => {
    stage.setQuality(s)
    world.setQuality()
    world.layout()
  })

  const loop = new GameLoop(clock, {
    update: (dt, c) => world.update(dt, c),
    render: (c) => world.render(c),
    sample: (fps) => {
      quality.sample(fps)
      debug.fps = Math.round(fps)
      debug.tier = quality.settings.tier
    },
  })

  // A small debug handle. Not telemetry — it leaves the device only if someone
  // reads it off the console. §14 rules out analytics, and this is not that.
  Object.assign(debug, {
    ready: true,
    tier: quality.settings.tier,
    get phase() { return gameStore.getState().phase },
    get hour() { return clock.hourOfDay },
    get tide() { return world.tide.state },
    stage,
    world,
    clock,
  })

  // The sim runs while the title card is up — the player should be able to read
  // the water before they decide to fish it (§6.1).
  loop.start()
  gameStore.getState().hydrate({ ready: true })

  createRoot(overlay).render(createElement(App))

  // A backgrounded tab must not accumulate simulated time it never rendered.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop()
    else loop.start()
  })
}

boot().catch((err) => {
  console.error('[slack-water] boot failed', err)
  const overlay = document.getElementById('overlay')
  if (overlay) {
    overlay.textContent = 'Slack Water could not start on this device.'
    overlay.setAttribute('style', 'padding:2rem;font-family:monospace;pointer-events:auto')
  }
})

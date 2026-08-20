declare const __BUILD_ID__: string
declare const __ENABLE_SW__: boolean

import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import './ui/fonts.css'
import './ui/shell.css'
import { Clock } from './engine/clock.ts'
import { GameLoop } from './engine/loop.ts'
import { InputRouter } from './engine/input.ts'
import { Quality, prefersReducedMotion } from './engine/quality.ts'
import { gameStore } from './engine/store.ts'
import { Stage } from './render/stage.ts'
import { World } from './sim/world.ts'
import { chapter } from './content/index.ts'
import { applySave, autosave, load } from './persist.ts'
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

  // The save is read before anything is built: a returning player's restored
  // pages and settings have to be in place before the first frame.
  const saved = await load()
  if (saved) applySave(saved)

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

  const input = new InputRouter(canvas)
  input.on((e) => world.onGesture(e))

  // Browsers will not start audio until the player has touched the screen, and
  // §12 makes sound optional anyway — so it is built on the first gesture.
  const startAudio = () => {
    world.audio.init()
    world.audio.setEnabled(gameStore.getState().settings.audio)
  }
  input.on(startAudio)
  canvas.addEventListener('pointerdown', startAudio, { once: true })
  gameStore.subscribe((s, prev) => {
    if (s.settings.audio !== prev.settings.audio) world.audio.setEnabled(s.settings.audio)
    // A manual tier ends the automatic probe: the player has overruled it.
    if (s.settings.tierOverride !== prev.settings.tierOverride && s.settings.tierOverride) {
      quality.force(s.settings.tierOverride)
    }
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
  // defineProperties, not Object.assign: assign *invokes* getters and copies
  // their values, which turns every live probe below into a boot-time snapshot.
  Object.defineProperties(debug, Object.getOwnPropertyDescriptors({
    ready: true,
    tier: quality.settings.tier,
    get phase() { return gameStore.getState().phase },
    get hour() { return clock.hourOfDay },
    get tide() { return world.tide.state },
    get tension() { return world.trip.tension },
    get willingness() { return world.conditions.willingness },
    get bust() { return world.bait.bustUp },
    get loss() { return gameStore.getState().loss },
    get restoring() { return gameStore.getState().restoring },
    get pages() { return gameStore.getState().pagesRestored },
    get catches() { return gameStore.getState().catchLog.length },
    get particles() { return world.particleCount },
    get fish() {
      return world.fish.map((f) => ({
        id: f.id, state: f.state, cm: Math.round(f.lengthCm),
        x: +f.x.toFixed(2), y: +f.y.toFixed(2),
        interest: +f.interest.toFixed(2), stamina: +f.stamina.toFixed(2),
      }))
    },
    get lure() {
      return {
        x: +world.lure.x.toFixed(2), y: +world.lure.y.toFixed(2),
        inWater: world.lure.inWater, airborne: world.lure.airborne,
        cadence: world.lure.cadence, quality: +world.lure.cadenceQuality.toFixed(2),
      }
    },
    stage,
    world,
    clock,
    input,
    store: gameStore,
  }))

  // The sim runs while the title card is up — the player should be able to read
  // the water before they decide to fish it (§6.1).
  loop.start()
  gameStore.getState().hydrate({ ready: true })

  createRoot(overlay).render(createElement(App, { world }))
  autosave()
  registerServiceWorker()

  // §9: reduced motion is a live system setting, not a boot-time reading.
  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  motionQuery?.addEventListener('change', (e) => {
    gameStore.getState().setSettings({ reducedMotion: e.matches })
    stage.setReducedMotion(e.matches)
  })

  // A backgrounded tab must not accumulate simulated time it never rendered.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop()
    else loop.start()
  })
}

/**
 * §12 — the game must run fully offline after first load. Registered after the
 * first frame so it never competes with boot for bandwidth.
 */
function registerServiceWorker(): void {
  if (!__ENABLE_SW__ || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const base = new URL(import.meta.env.BASE_URL, location.href)
  const url = new URL(`sw.js?v=${__BUILD_ID__}`, base)
  navigator.serviceWorker.register(url, { scope: base.pathname }).catch((err) => {
    console.warn('[slack-water] service worker registration failed', err)
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

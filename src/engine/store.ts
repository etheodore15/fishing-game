import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Hint } from '../sim/coach.ts'
import type { TideState } from '../sim/tide.ts'
import type { Tier } from './quality.ts'

export type Screen = 'title' | 'fishing' | 'journal' | 'settings'
/** §6: five phases, strictly ordered. */
export type Phase = 'read' | 'cast' | 'work' | 'fight' | 'log'
export type LossKind = 'line-break' | 'hook-pull' | 'bust-off' | 'snag'

export interface HudState {
  time: string
  tideHeightM: number
  tideState: TideState
  tideGlyph: string
  windKt: number
  windLabel: string
}

export interface CatchRecord {
  speciesId: string
  displayName: string
  lengthCm: number
  weightKg: number
  tideState: TideState
  timeLabel: string
  /** ms since epoch — logged for the journal, never used by the sim. */
  at: number
}

/**
 * The guide (§6.1).
 *
 * 'auto' shows it until the player has landed a fish, which is the point at
 * which they have demonstrably found the retrieve. It is a setting rather than
 * a one-shot tutorial because a player who comes back a month later is allowed
 * to have forgotten.
 */
export type GuideMode = 'auto' | 'on' | 'off'

export interface Settings {
  audio: boolean
  tierOverride: Tier | null
  reducedMotion: boolean
  guide: GuideMode
}

export interface GameState {
  screen: Screen
  phase: Phase
  hud: HudState
  /** The guide's current line, or null when it has nothing to say. */
  hint: Hint | null
  /** Non-null while a loss banner is showing. Cleared on the next cast. */
  loss: LossKind | null
  lastCatch: CatchRecord | null
  catchLog: CatchRecord[]
  pagesRestored: string[]
  /** Page currently playing its restoration animation (§5.4). */
  restoring: string | null
  /** The first restoration may not be skipped. */
  hasSeenRestoration: boolean
  settings: Settings
  ready: boolean

  setScreen(s: Screen): void
  setPhase(p: Phase): void
  setHud(h: Partial<HudState>): void
  setHint(h: Hint | null): void
  setLoss(l: LossKind | null): void
  logCatch(c: CatchRecord): void
  restorePage(id: string): void
  finishRestoration(): void
  hydrate(s: Partial<GameState>): void
  setSettings(s: Partial<Settings>): void
}

export const gameStore = createStore<GameState>()((set) => ({
  screen: 'title',
  phase: 'read',
  hud: {
    time: '--:--',
    tideHeightM: 0,
    tideState: 'run-out',
    tideGlyph: '↓',
    windKt: 0,
    windLabel: 'NE',
  },
  hint: null,
  loss: null,
  lastCatch: null,
  catchLog: [],
  pagesRestored: ['p001'], // the tutorial page ships restored (§13.8)
  restoring: null,
  hasSeenRestoration: false,
  settings: { audio: true, tierOverride: null, reducedMotion: false, guide: 'auto' },
  ready: false,

  setScreen: (screen) => set({ screen }),
  setPhase: (phase) => set({ phase }),
  // Object identity changes only when a field changes, so the HUD does not
  // re-render on every write from the sim.
  setHud: (h) =>
    set((s) => {
      let changed = false
      for (const k of Object.keys(h) as (keyof HudState)[]) {
        if (h[k] !== undefined && h[k] !== s.hud[k]) { changed = true; break }
      }
      return changed ? { hud: { ...s.hud, ...h } } : s
    }),
  // Same identity guard as the HUD: the guide is written at 4Hz and mostly
  // says the same thing, and a new object every quarter second would re-render
  // the overlay for nothing.
  setHint: (h) =>
    set((s) => (h?.key === s.hint?.key && h?.text === s.hint?.text ? s : { hint: h })),
  setLoss: (loss) => set({ loss }),
  logCatch: (c) => set((s) => ({ lastCatch: c, catchLog: [...s.catchLog, c] })),
  restorePage: (id) =>
    set((s) =>
      s.pagesRestored.includes(id)
        ? s
        : { pagesRestored: [...s.pagesRestored, id], restoring: id, screen: 'journal' },
    ),
  finishRestoration: () => set({ restoring: null, hasSeenRestoration: true }),
  hydrate: (s) => set(s),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
}))

/** React binding. The overlay only — never called from inside the game world. */
export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector)
}

export const getState = gameStore.getState

import { gameStore, useGame, type GuideMode } from '../engine/store.ts'
import type { Tier } from '../engine/quality.ts'

declare const __BUILD_ID__: string

const TIERS: (Tier | null)[] = [null, 'high', 'mid', 'low']
const GUIDES: GuideMode[] = ['auto', 'on', 'off']

/**
 * Settings.
 *
 * §12: audio is fully optional, and nothing in the game is communicated by
 * sound alone — every cue has a visual counterpart carrying the same
 * information, so turning it off costs the player nothing but atmosphere.
 *
 * Reduced motion is read from the system and shown here as a reminder rather
 * than a toggle the game invents: it disables the print misregistration, the
 * camera shake and the parallax, and never the simulation (§9).
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useGame((s) => s.settings)
  const set = gameStore.getState().setSettings

  return (
    <div className="sheet settings">
      <h2>Settings</h2>

      <label className="row">
        <span>Sound</span>
        <button data-interactive onClick={() => set({ audio: !settings.audio })}>
          {settings.audio ? 'On' : 'Off'}
        </button>
      </label>

      <label className="row">
        <span>Guide</span>
        <span className="tiers">
          {GUIDES.map((g) => (
            <button
              key={g}
              data-interactive
              className={settings.guide === g ? 'on' : ''}
              onClick={() => set({ guide: g })}
            >
              {g}
            </button>
          ))}
        </span>
      </label>

      <label className="row">
        <span>Detail</span>
        <span className="tiers">
          {TIERS.map((t) => (
            <button
              key={t ?? 'auto'}
              data-interactive
              className={settings.tierOverride === t ? 'on' : ''}
              onClick={() => set({ tierOverride: t })}
            >
              {t ?? 'Auto'}
            </button>
          ))}
        </span>
      </label>

      <p className="note">
        The guide names the gestures and nothing about the water; on auto it
        stands down once you have landed a fish. Detail follows the device, and
        drops a tier if the first few seconds run below 45fps.
        {settings.reducedMotion
          ? ' Reduced motion is on in your system settings: print misregistration and camera movement are off, the water is not.'
          : ''}
      </p>

      {/*
        Pinned to the bottom of the sheet. On a landscape phone the sheet is
        taller than the screen and scrolls, and a Done button you have to go
        looking for is a Done button that is not there.
      */}
      <div className="sheet-foot">
        <button data-interactive onClick={onClose}>
          Done
        </button>
        {/* So a player on a stale cache can say which build they are actually
            running, rather than us guessing from a screenshot. */}
        <p className="build">Build {__BUILD_ID__}</p>
      </div>
    </div>
  )
}

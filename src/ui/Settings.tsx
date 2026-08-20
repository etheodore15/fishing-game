import { gameStore, useGame } from '../engine/store.ts'
import type { Tier } from '../engine/quality.ts'

const TIERS: (Tier | null)[] = [null, 'high', 'mid', 'low']

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
        {settings.reducedMotion
          ? 'Reduced motion is on in your system settings. Print misregistration and camera movement are off; the water is not.'
          : 'Detail follows the device by default, and drops a tier if the first few seconds run below 45fps.'}
      </p>

      <button data-interactive onClick={onClose}>
        Done
      </button>
    </div>
  )
}

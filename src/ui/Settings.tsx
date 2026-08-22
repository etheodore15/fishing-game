import { useEffect, useRef, useState } from 'react'
import { gameStore, useGame, type GuideMode } from '../engine/store.ts'
import type { Tier } from '../engine/quality.ts'
import { startAgain, type StartAgain } from '../persist.ts'

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
 *
 * And starting again, which lives here because there is nowhere else it could:
 * everything this game knows about a player is in their browser, so without it
 * a journal is permanent, a chapter can never be played twice, and the phone
 * cannot be handed to somebody else. Two steps and plain words about what goes,
 * because it is the one control in the game that destroys something.
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

      <StartOver />

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

/** What each restart takes, said before it takes it. */
const WHAT_GOES: Record<StartAgain, { label: string; warning: string }> = {
  chapter: {
    label: 'Start the chapter again',
    warning:
      'The journal goes back to page one, the tackle box back to one lure, and every fish you have caught is forgotten. Sound, guide and detail stay as they are.',
  },
  everything: {
    label: 'Erase everything',
    warning:
      'The journal, the record, the tackle box and these settings. Everything this game knows about you is on this device, so there is no copy of it anywhere else.',
  },
}

function StartOver() {
  const [asking, setAsking] = useState<StartAgain | null>(null)
  const [going, setGoing] = useState(false)
  const confirm = useRef<HTMLDivElement>(null)

  /**
   * Bring the question into view when it is asked.
   *
   * On a landscape phone the sheet is taller than the screen and its Done
   * button is pinned over the bottom of it, so a confirm that opens near the
   * end of the sheet opens underneath the pin: the warning is readable and the
   * two buttons that answer it are not. Instant, not smooth — this is a
   * question, not an effect.
   */
  useEffect(() => {
    if (asking) confirm.current?.scrollIntoView({ block: 'center' })
  }, [asking])

  const go = (mode: StartAgain) => {
    setGoing(true)
    // Written, then the game is opened again on it: the one code path that is
    // known to build the whole world from a save is the one that runs on boot.
    void startAgain(mode).then(() => window.location.reload())
  }

  return (
    <div className="start-over">
      <span className="row-label">Start again</span>
      {asking === null ? (
        <span className="tiers">
          {(Object.keys(WHAT_GOES) as StartAgain[]).map((mode) => (
            <button key={mode} data-interactive onClick={() => setAsking(mode)}>
              {WHAT_GOES[mode].label}
            </button>
          ))}
        </span>
      ) : (
        <div className="confirm" ref={confirm}>
          <p>{WHAT_GOES[asking].warning}</p>
          <span className="tiers">
            <button data-interactive disabled={going} onClick={() => go(asking)}>
              {going ? 'Starting…' : 'Yes, start again'}
            </button>
            <button data-interactive disabled={going} onClick={() => setAsking(null)}>
              Keep it
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

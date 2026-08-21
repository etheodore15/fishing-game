import { lureOutline } from '../art/lureRig.ts'
import { LURES } from '../content/index.ts'
import type { CadenceKind, Lure } from '../content/schema.ts'
import { gameStore, useGame } from '../engine/store.ts'
import { unlockedLures } from '../sim/tackle.ts'

/**
 * The tackle box.
 *
 * Three things to tie on, each good at one retrieve and poor at another, so
 * choosing tackle and choosing a retrieve are the same choice made twice. The
 * plastic ships; the other two are earned by landing the fish they are for,
 * which is what stops a tailor being a consolation prize.
 *
 * The silhouettes are drawn by the same solve the water uses, at rest, so what
 * is in the sheet is what goes on the end of the line.
 */

const CADENCE_WORD: Record<CadenceKind, string> = {
  hop: 'hopped',
  twitch: 'twitched',
  steady: 'swum straight',
}

/** What a lure is for, read off its own numbers rather than written twice. */
function suits(l: Lure): CadenceKind {
  const kinds: CadenceKind[] = ['hop', 'twitch', 'steady']
  return kinds.reduce((a, b) => (l.action[b] > l.action[a] ? b : a))
}

export function Tackle({ onClose }: { onClose: () => void }) {
  const log = useGame((s) => s.catchLog)
  const chosen = useGame((s) => s.settings.lureId)
  const box = unlockedLures(LURES, log)
  const have = new Set(box.map((l) => l.id))

  return (
    <div className="sheet tackle">
      <h2>Tackle</h2>

      <ul className="tackle-box">
        {LURES.map((l) => {
          const unlocked = have.has(l.id)
          const on = unlocked && l.id === chosen
          return (
            <li key={l.id} className={`tackle-slot${on ? ' on' : ''}${unlocked ? '' : ' locked'}`}>
              <button
                data-interactive
                disabled={!unlocked}
                aria-pressed={on}
                onClick={() => gameStore.getState().setSettings({ lureId: l.id })}
              >
                <svg className="tackle-lure" viewBox="0 0 100 28" aria-hidden="true">
                  <path d={lureOutline(l.form)} />
                </svg>
                <span className="tackle-name">{unlocked ? l.displayName : '—'}</span>
                <span className="tackle-note">
                  {unlocked ? `Best ${CADENCE_WORD[suits(l)]}.` : lockedNote(l)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="note">{LURES.find((l) => l.id === chosen)?.note ?? ''}</p>

      <div className="sheet-foot">
        <button data-interactive onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

/**
 * How a locked slot gets filled: by catching the fish it is for.
 *
 * Named, not described, because the species pages are where a fish is
 * described and this is a box with a gap in it.
 */
function lockedNote(l: Lure): string {
  if (!l.unlockedBy) return ''
  const words = l.unlockedBy.split('-').join(' ')
  return `After a${/^[aeiou]/i.test(words) ? 'n' : ''} ${words}.`
}

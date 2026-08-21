import { LURES } from '../content/index.ts'
import { useGame } from '../engine/store.ts'
import { firstCatch, unlockLine } from '../sim/tackle.ts'

/**
 * §6.5 — the catch, measured and written up.
 *
 * Deliberately a card and not a frame that flashes past: the log phase is part
 * of the loop, and the numbers on it are the same ones the journal's unlock
 * rules read. Utility face for the measurements, display face for the name.
 */
export function CatchCard({ onDismiss }: { onDismiss: () => void }) {
  const c = useGame((s) => s.lastCatch)
  const log = useGame((s) => s.catchLog)
  const restoring = useGame((s) => s.restoring)
  // A restoration takes precedence: the page is the reward, not the card.
  if (!c || restoring) return null

  // The first of a species is worth more than the fish: it opens that fish's
  // page and, for two of the three, puts the lure it is caught on in the box.
  // Both used to happen off screen, which made a bycatch look like a smaller
  // flathead rather than the way this game hands out everything it has.
  const first = firstCatch(LURES, log, c)

  return (
    <div className="sheet catch-card">
      <h2>{c.displayName}</h2>
      <dl>
        <div>
          <dt>Length</dt>
          <dd>{c.lengthCm} cm</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd>{c.weightKg.toFixed(2)} kg</dd>
        </div>
        <div>
          <dt>Tide</dt>
          <dd>{c.tideState.replace('-', ' ')}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{c.timeLabel}</dd>
        </div>
      </dl>
      {first && <p className="catch-unlock">{unlockLine(first)}</p>}
      <button data-interactive onClick={onDismiss}>
        Back on the water
      </button>
    </div>
  )
}

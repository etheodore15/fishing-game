import { useCallback, useState } from 'react'
import { gameStore, useGame } from '../engine/store.ts'
import { chapter } from '../content/index.ts'
import { JournalPage, type Restoration } from './JournalPage.tsx'

/**
 * The journal screen (§5.5).
 *
 * Two pages at a time and a run of dots for the chapter. Restored pages carry
 * both the story and the strategy; the ones still under water carry neither,
 * which is the whole incentive.
 *
 * §5.4: the first restoration cannot be skipped. It is the one place the design
 * spends animation budget on spectacle, and a player who skips it has not seen
 * what the game is about.
 */
export function Journal({ chapterId }: { chapterId: string }) {
  const pages = chapter(chapterId).pages
  const restored = useGame((s) => s.pagesRestored)
  const restoring = useGame((s) => s.restoring)
  const hasSeen = useGame((s) => s.hasSeenRestoration)
  const [spread, setSpread] = useState(0)

  // A restoration always shows the page it is restoring.
  const restoringIndex = restoring ? pages.indexOf(restoring) : -1
  const base = restoringIndex >= 0 ? Math.floor(restoringIndex / 2) * 2 : spread * 2
  const visible = pages.slice(base, base + 2)

  const finish = useCallback(() => gameStore.getState().finishRestoration(), [])

  const modeFor = (id: string): Restoration => {
    if (id === restoring) return 'restoring'
    return restored.includes(id) ? 'clean' : 'stained'
  }

  const spreads = Math.ceil(pages.length / 2)

  return (
    <div className="journal">
      <div className="journal-spread">
        {visible.map((id) => (
          <JournalPage key={id} pageId={id} mode={modeFor(id)} onRestored={finish} />
        ))}
      </div>

      <div className="journal-foot">
        <div className="journal-dots" role="group" aria-label="Chapter one pages">
          {pages.map((id, i) => (
            <span
              key={id}
              className={restored.includes(id) ? 'dot filled' : 'dot'}
              aria-label={`Page ${i + 1}${restored.includes(id) ? ' restored' : ' not yet restored'}`}
            />
          ))}
        </div>
        <span className="journal-chapter">chapter 1</span>
      </div>

      {!restoring && spreads > 1 && (
        <div className="journal-nav">
          <button data-interactive disabled={spread === 0} onClick={() => setSpread((s) => s - 1)}>
            ‹
          </button>
          <button
            data-interactive
            disabled={spread >= spreads - 1}
            onClick={() => setSpread((s) => s + 1)}
          >
            ›
          </button>
        </div>
      )}

      {/* Un-skippable the first time (§5.4). After that, the player has seen it. */}
      {restoring && hasSeen && (
        <button className="journal-skip" data-interactive onClick={finish}>
          Skip
        </button>
      )}

      {!restoring && (
        <button
          className="journal-close"
          data-interactive
          onClick={() => gameStore.getState().setScreen('fishing')}
        >
          Close
        </button>
      )}
    </div>
  )
}

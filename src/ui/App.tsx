import { useEffect } from 'react'
import { LURES } from '../content/index.ts'
import { gameStore, useGame } from '../engine/store.ts'
import { knownSpecies } from '../sim/knowledge.ts'
import { isChapterComplete } from '../sim/progress.ts'
import { unlockedLures } from '../sim/tackle.ts'
import type { World } from '../sim/world.ts'
import { CatchCard } from './CatchCard.tsx'
import { Guide } from './Guide.tsx'
import { Journal } from './Journal.tsx'
import { Settings } from './Settings.tsx'
import { Tackle } from './Tackle.tsx'
import { UtilityStrip } from './UtilityStrip.tsx'

/**
 * The DOM overlay (§3).
 *
 * React renders menus, the journal and the utility strip. It never renders
 * anything inside the play area, and no re-render here is in the animation
 * path — the strip updates at 4Hz from the sim, nothing else updates at all
 * unless the player changes screens.
 */
export function App({ world }: { world: World }) {
  const screen = useGame((s) => s.screen)
  const phase = useGame((s) => s.phase)
  const loss = useGame((s) => s.loss)
  const restored = useGame((s) => s.pagesRestored)
  const log = useGame((s) => s.catchLog)
  const speciesSeen = useGame((s) => s.speciesSeen)
  const luresSeen = useGame((s) => s.luresSeen)
  // The one pointer from the water to the book: a player who never opens the
  // journal never learns the chapter has an end.
  const pageOutstanding = !isChapterComplete(world.chapter, restored)

  /**
   * The two marks that say something has arrived.
   *
   * Both are a count of what the log has earned against a count of what the
   * player has been shown, so neither can claim a lure or a page the water did
   * not actually give them. Counted off catches alone: the flathead's page can
   * be read from the first trip because page one is about flathead, and a mark
   * that is on before anything has happened is a mark nobody reads.
   */
  const newSpecies = knownSpecies(log).size > speciesSeen
  const newLures = unlockedLures(LURES, log).length > luresSeen
  const journalWork = pageOutstanding || newSpecies

  // Clear a loss banner after it has been read. The animation and sound carry
  // the information; the words are only there to name what happened.
  useEffect(() => {
    if (!loss) return
    const id = window.setTimeout(() => gameStore.getState().setLoss(null), 2600)
    return () => window.clearTimeout(id)
  }, [loss])

  return (
    <>
      {screen === 'title' && <Title />}
      {screen === 'journal' && <Journal chapterId={world.chapter.id} />}
      {screen === 'settings' && <Settings onClose={() => gameStore.getState().setScreen('fishing')} />}
      {screen === 'tackle' && <Tackle onClose={() => gameStore.getState().setScreen('fishing')} />}
      {screen === 'fishing' && (
        <>
          <UtilityStrip />
          <Guide />
          {loss && <LossBanner kind={loss} />}
          {phase === 'log' && <CatchCard onDismiss={() => world.dismissLog()} />}
          <div className="corner-nav">
            <button
              data-interactive
              className={mark(journalWork, newSpecies)}
              aria-label={
                newSpecies
                  ? 'Journal, a new fish written up'
                  : pageOutstanding
                    ? 'Journal, a page still missing'
                    : 'Journal'
              }
              onClick={() => gameStore.getState().setScreen('journal')}
            >
              Journal
            </button>
            {/* Between casts only. Nobody reties with a lure in the water. */}
            <button
              data-interactive
              disabled={phase !== 'read'}
              className={mark(newLures, newLures)}
              aria-label={newLures ? 'Tackle box, something new in it' : 'Tackle box'}
              onClick={() => gameStore.getState().setScreen('tackle')}
            >
              Tackle
            </button>
            <button
              data-interactive
              aria-label="Settings"
              onClick={() => gameStore.getState().setScreen('settings')}
            >
              ⚙
            </button>
          </div>
        </>
      )}
    </>
  )
}

/**
 * A mark on a corner button: steady for outstanding, breathing for new.
 *
 * Reduced motion is handled in the stylesheet rather than here — the class is
 * a statement about what is true, not about what should move.
 */
function mark(work: boolean, fresh: boolean): string | undefined {
  if (!work) return undefined
  return fresh ? 'has-work is-new' : 'has-work'
}

function Title() {
  const start = () => gameStore.getState().setScreen('fishing')
  return (
    <div className="title">
      <h1>Slack&nbsp;Water</h1>
      <p className="title-sub">Lake Macquarie to Seal Rocks</p>
      <button data-interactive onClick={start}>
        Take the tinnie out
      </button>
    </div>
  )
}

const LOSS_TEXT: Record<string, string> = {
  'line-break': 'Line parted.',
  'hook-pull': 'Hook pulled.',
  'bust-off': 'Into the racks.',
  snag: 'Snagged. Lure gone.',
}

function LossBanner({ kind }: { kind: string }) {
  return <div className="loss-banner">{LOSS_TEXT[kind] ?? ''}</div>
}

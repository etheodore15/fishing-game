import { useEffect } from 'react'
import { gameStore, useGame } from '../engine/store.ts'
import type { World } from '../sim/world.ts'
import { CatchCard } from './CatchCard.tsx'
import { Journal } from './Journal.tsx'
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
      {screen === 'fishing' && (
        <>
          <UtilityStrip />
          {loss && <LossBanner kind={loss} />}
          {phase === 'log' && <CatchCard onDismiss={() => world.dismissLog()} />}
          <button
            className="journal-open"
            data-interactive
            onClick={() => gameStore.getState().setScreen('journal')}
          >
            Journal
          </button>
        </>
      )}
    </>
  )
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

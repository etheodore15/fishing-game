import { useCallback, useEffect, useState } from 'react'
import { gameStore, useGame } from '../engine/store.ts'
import { chapter, journalPage, species as speciesById } from '../content/index.ts'
import { knownSpecies } from '../sim/knowledge.ts'
import { recordLeaves } from '../art/recordPage.ts'
import { speciesLeaves } from '../art/speciesPage.ts'
import { describeUnlock, isChapterComplete, remainingUnlocks } from '../sim/progress.ts'
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
  const ch = chapter(chapterId)
  const pages = ch.pages
  const restored = useGame((s) => s.pagesRestored)
  const restoring = useGame((s) => s.restoring)
  const hasSeen = useGame((s) => s.hasSeenRestoration)
  const celebrated = useGame((s) => s.chaptersCelebrated)
  const catches = useGame((s) => s.catchLog)
  const [spread, setSpread] = useState(0)
  const [view, setView] = useState<'pages' | 'species' | 'record'>('pages')

  const remaining = remainingUnlocks(ch, restored)
  const done = isChapterComplete(ch, restored) && !restoring
  // Shown once, on the trip that finishes the chapter.
  const showClose = done && !celebrated.includes(chapterId)

  /**
   * A species page nobody has filled in yet says how it gets filled in: by
   * catching one. There is nothing else to it, and pretending otherwise would
   * make it a quest.
   */
  const wantedSpecies = (leafId: string): string | null => {
    if (view !== 'species') return null
    const sp = ch.species.map((id) => speciesById(id)).find((s) => `species-${s.id}` === leafId)
    if (!sp || known.has(sp.id)) return null
    return `Land one and this fills itself in.`
  }

  /**
   * What a missing page needs, written under it.
   *
   * §6.1 keeps the game from advising the player about the water. This is the
   * journal saying what it is missing, which is the premise of the whole
   * chapter — without it the win condition was a rule in a JSON file and a
   * page that quietly appeared in a book nobody had a reason to open.
   */
  const wantedFor = (id: string): string | null => {
    if (restored.includes(id) || id === restoring) return null
    const rule = ch.unlocks.find((u) => u.pageId === id)
    if (!rule) return null
    const name = rule.require.species ? speciesById(rule.require.species).displayName : 'a fish'
    return describeUnlock(rule, name)
  }

  const known = knownSpecies(
    catches,
    pages.filter((id) => restored.includes(id)).map((id) => journalPage(id).sketch),
  )
  const leaves =
    view === 'record'
      ? recordLeaves(catches)
      : speciesLeaves(ch.species.map((id) => speciesById(id)), catches, known)
  // A restoration always shows the page it is restoring, and never the back of
  // the book.
  const restoringIndex = restoring ? pages.indexOf(restoring) : -1
  const showBack = view !== 'pages' && restoringIndex < 0
  const sheet = showBack ? leaves.map((l) => l.id) : pages
  const base = restoringIndex >= 0 ? Math.floor(restoringIndex / 2) * 2 : spread * 2
  const visible = sheet.slice(base, base + 2)

  /**
   * Opening the fish tab is what clears the mark on the Journal button.
   *
   * Counted off catches alone, which is the same count the button compares
   * against — the page the player was handed does not need to be gone and
   * looked at, because they were handed it.
   */
  const landedSpecies = knownSpecies(catches).size
  useEffect(() => {
    if (view === 'species') gameStore.getState().markSeen('species', landedSpecies)
  }, [view, landedSpecies])

  const finish = useCallback(() => gameStore.getState().finishRestoration(), [])

  const modeFor = (id: string): Restoration => {
    if (id === restoring) return 'restoring'
    return restored.includes(id) ? 'clean' : 'stained'
  }

  const spreads = Math.max(1, Math.ceil(sheet.length / 2))
  const flip = (to: 'pages' | 'species' | 'record') => {
    setView(to)
    setSpread(0)
  }

  return (
    <div className="journal">
      <div className="journal-spread">
        {visible.map((id) => (
          <div className="journal-leaf" key={id}>
            <JournalPage
              pageId={id}
              mode={showBack ? (leaves.find((l) => l.id === id)?.locked ? 'stained' : 'clean') : modeFor(id)}
              source={showBack ? leaves.find((l) => l.id === id) : undefined}
              onRestored={finish}
            />
            {!showBack && wantedFor(id) && <p className="journal-wanted">{wantedFor(id)}</p>}
            {showBack && wantedSpecies(id) && (
              <p className="journal-wanted">{wantedSpecies(id)}</p>
            )}
          </div>
        ))}
      </div>

      <div className="journal-foot">
        {!showBack && (
          <div className="journal-dots" role="group" aria-label="Chapter one pages">
            {pages.map((id, i) => (
              <span
                key={id}
                className={restored.includes(id) ? 'dot filled' : 'dot'}
                aria-label={`Page ${i + 1}${restored.includes(id) ? ' restored' : ' not yet restored'}`}
              />
            ))}
          </div>
        )}
        <span className="journal-chapter">
          {view === 'record'
            ? `record · ${catches.length === 1 ? 'one fish' : `${catches.length} fish`}`
            : view === 'species'
              ? `species · ${known.size} of ${ch.species.length}`
              : done
                ? 'chapter 1 · complete'
                : `chapter 1 · ${remaining.length} to find`}
        </span>
        {!restoring && (
          <div className="journal-tabs" role="group" aria-label="Journal sections">
            <button
              data-interactive
              className={view === 'pages' ? 'on' : ''}
              onClick={() => flip('pages')}
            >
              pages
            </button>
            <button
              data-interactive
              className={view === 'species' ? 'on' : ''}
              onClick={() => flip('species')}
            >
              fish
            </button>
            <button
              data-interactive
              className={view === 'record' ? 'on' : ''}
              onClick={() => flip('record')}
            >
              record
            </button>
          </div>
        )}
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

      {!restoring && !showClose && (
        <button
          className="journal-close"
          data-interactive
          onClick={() => gameStore.getState().setScreen('fishing')}
        >
          Close
        </button>
      )}

      {showClose && <ChapterClose title={ch.title} catches={catches.length} chapterId={chapterId} />}
    </div>
  )
}

/**
 * The end of the chapter.
 *
 * The only moment in the game that says "you have finished something", and it
 * is the journal that says it, because the journal is the thing that was
 * broken. It counts fish because the fish are what mended it.
 */
function ChapterClose({
  title,
  catches,
  chapterId,
}: {
  title: string
  catches: number
  chapterId: string
}) {
  const close = () => {
    gameStore.getState().celebrate(chapterId)
    gameStore.getState().setScreen('fishing')
  }
  return (
    <div className="sheet chapter-close">
      <h2>{title}</h2>
      <p className="chapter-close-line">Every page back.</p>
      <p className="note">
        {catches === 1 ? 'One fish' : `${catches} fish`} on the flat, and the book is whole again.
        The water is still there.
      </p>
      <div className="sheet-foot">
        <button data-interactive onClick={close}>
          Back on the water
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useGame } from '../engine/store.ts'
import { GestureGlyph } from './GestureGlyph.tsx'

/**
 * The guide's one line, above the utility strip.
 *
 * Same mono, same weight, same restraint as the strip — it is a note in the
 * margin, not a tutorial pop-up, and it never covers the water. §9 forbids CSS
 * animation inside the game world; this is DOM overlay, where a cross-fade is
 * allowed and is the difference between advice appearing and advice flashing.
 */
export function Guide() {
  const hint = useGame((s) => s.hint)
  const [shown, setShown] = useState(hint)
  const [visible, setVisible] = useState(Boolean(hint))
  const timer = useRef(0)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!hint) {
      setVisible(false)
      return
    }
    if (!shown) {
      setShown(hint)
      setVisible(true)
      return
    }
    if (hint.key === shown.key) {
      setShown(hint)
      setVisible(true)
      return
    }
    // A live prompt cuts straight over: during a fight the advice changes every
    // second or two, and fading out first would leave the line blank at exactly
    // the moment the player is looking at it.
    if (hint.live) {
      setShown(hint)
      setVisible(true)
      return
    }
    // Otherwise fade the old line out before the new one arrives, so two pieces
    // of advice never cross-dissolve into an unreadable smudge.
    setVisible(false)
    timer.current = window.setTimeout(() => {
      setShown(hint)
      setVisible(true)
    }, 180)
    return () => window.clearTimeout(timer.current)
  }, [hint, shown])

  if (!shown) return null
  return (
    <div className={`guide${visible ? ' on' : ''}`} role="status" aria-live="polite">
      {shown.gesture ? <GestureGlyph gesture={shown.gesture} /> : null}
      <p>{shown.text}</p>
    </div>
  )
}

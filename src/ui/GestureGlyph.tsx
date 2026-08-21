import type { Gesture } from '../sim/coach.ts'

/**
 * A thumb, drawn doing the thing.
 *
 * "Hold, release, tap" is four words for a rhythm, and prose is bad at rhythm —
 * it names the three parts without giving the timing between them, which is the
 * only part that matters. So each glyph is a strip of time running left to
 * right: a solid bar is the thumb down, a gap is the thumb up, and a filled dot
 * rides the strip at the speed the gesture wants doing. A long bar is a hold. A
 * stub is a tap. A long bar, a gap and a stub is a hop.
 *
 * That notation carries the fight too, where the whole skill is knowing which
 * of press and release is being asked of you this second — a pad on the bar or
 * a pad lifted off it, readable without reading.
 *
 * One SVG per form, in the strip's own ink. Animation is CSS: §9 bars it from
 * the game world, and this is the DOM overlay.
 */
export function GestureGlyph({ gesture }: { gesture: Gesture }) {
  return (
    <svg
      className={`glyph glyph-${gesture}`}
      viewBox="0 0 96 26"
      width="96"
      height="26"
      aria-hidden="true"
      focusable="false"
    >
      {gesture === 'hop' ? <Hop /> : null}
      {gesture === 'press' ? <Press /> : null}
      {gesture === 'release' ? <Release /> : null}
      {gesture === 'tap' ? <Tap /> : null}
      {gesture === 'flick' ? <Flick /> : null}
    </svg>
  )
}

/** The strip of time the gesture happens on. */
function Axis({ x1 = 8, x2 = 88 }: { x1?: number; x2?: number }) {
  return <line className="axis" x1={x1} y1={20} x2={x2} y2={20} />
}

/** Thumb down, for as long as the bar is wide. */
function Contact({ x1, x2 }: { x1: number; x2: number }) {
  return <line className="contact" x1={x1} y1={20} x2={x2} y2={20} />
}

/**
 * Hold, lift, tap.
 *
 * The bar is the length of the hold and the gap is the length of the pause, so
 * the drawing is the timing.
 */
function Hop() {
  return (
    <>
      <Axis />
      <Contact x1={14} x2={50} />
      <Contact x1={70} x2={74} />
      <circle className="ripple" cx={72} cy={20} r={5} />
      <circle className="thumb" cx={14} cy={20} r={5} />
    </>
  )
}

/** Down, and staying down: one bar, end to end. */
function Press() {
  return (
    <>
      <Axis x1={12} x2={84} />
      <Contact x1={16} x2={80} />
      <circle className="thumb" cx={16} cy={20} r={5} />
    </>
  )
}

/** Off the glass, and stay off: an empty strip and a lifted pad. */
function Release() {
  return (
    <>
      <Axis x1={20} x2={76} />
      <path className="lift-arrow" d="M42 19 L48 13 L54 19" />
      <circle className="thumb lifted" cx={48} cy={9} r={5} />
    </>
  )
}

/** Down and straight back up: a stub, not a bar. */
function Tap() {
  return (
    <>
      <Axis x1={20} x2={76} />
      <Contact x1={46} x2={50} />
      <circle className="ripple" cx={48} cy={20} r={5} />
      <circle className="thumb" cx={48} cy={20} r={5} />
    </>
  )
}

/** Down, and away — the cast. */
function Flick() {
  return (
    <>
      <Axis x1={10} x2={86} />
      <Contact x1={14} x2={40} />
      <path className="streak" d="M40 20 Q62 20 80 8" />
      <path className="lift-arrow" d="M72 6 L81 6 L81 14" />
      <circle className="thumb" cx={14} cy={20} r={5} />
    </>
  )
}

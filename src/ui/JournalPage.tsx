import { useEffect, useMemo, useRef } from 'react'
import { PAGE_H, PAGE_W, buildPage, type PageSource } from '../art/journalPage.ts'
import { SPECIES, journalPage } from '../content/index.ts'

/**
 * One journal page, as SVG in the DOM (§8.7).
 *
 * Not canvas: the page is a document, it wants to be selectable and crisp at
 * any zoom, and the restoration animation is a handful of attribute writes
 * rather than a redraw. This is DOM UI, so it is allowed its own animation —
 * §9's ban on tweening applies to the game world, which this is not.
 */

export type Restoration = 'clean' | 'stained' | 'restoring'

interface Props {
  pageId: string
  mode: Restoration
  /**
   * A page that is not in the chapter's content.
   *
   * The catch record is written out of the save rather than off disk, and it is
   * a page of the journal like any other — same paper, same hand, same
   * machinery — so it arrives here as a source instead of an id.
   */
  source?: PageSource
  /** Called when a restoration animation finishes. */
  onRestored?: () => void
}

/** The whole sequence, in seconds. §5.4 asks for 6-9. */
const T_STAIN_END = 2.4
const T_FOXING_START = 0.6
const T_FOXING_END = 1.9
const T_WRITE_START = 1.9
const T_WRITE_END = 6.9
const T_SKETCH_END = 7.6
export const RESTORATION_SECONDS = T_SKETCH_END

/** Pen lift between words, in seconds. */
const LIFT = 0.09

/** Threshold at which the noise mask is entirely open, and entirely closed. */
const STAIN_CLEAR = 1.2
const STAIN_FULL = -7.5

export function JournalPage({ pageId, mode, source, onRestored }: Props) {
  const src = source ?? journalPage(pageId)
  const art = useMemo(
    () => buildPage(src, src.sketch === 'none' ? null : (SPECIES[src.sketch] ?? null)),
    [src],
  )

  const rootRef = useRef<SVGSVGElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const words = Array.from(root.querySelectorAll<SVGGElement>('[data-word]'))
    const sketch = Array.from(root.querySelectorAll<SVGPathElement>('[data-sketch]'))

    // Measure every path for real.
    //
    // The layout's own chord estimate is close enough for pacing but not for a
    // dasharray: under-estimate it and the pattern repeats, so bits of the
    // plate are visible before a single stroke has been drawn.
    let inkTotal = 0
    for (const g of words) {
      let wordLen = 0
      for (const path of g.children as unknown as SVGPathElement[]) {
        const l = path.getTotalLength()
        path.dataset.len = String(l)
        path.style.strokeDasharray = String(l)
        wordLen += l
      }
      g.dataset.len = String(Math.max(0.001, wordLen))
      inkTotal += wordLen
    }
    for (const path of sketch) {
      const l = path.getTotalLength()
      path.dataset.len = String(l)
      path.style.strokeDasharray = String(l)
    }
    const foxing = root.querySelector<SVGGElement>('[data-foxing]')
    const stainFns = Array.from(root.querySelectorAll<SVGElement>('[data-stain]'))
    const inkFns = Array.from(root.querySelectorAll<SVGElement>('[data-stain-ink]'))
    const bleed = root.querySelector<SVGGElement>('[data-bleed]')

    /** Write the whole page at a single point in the sequence, 0-1 per stage. */
    const apply = (stain: number, fox: number, write: number, plate: number) => {
      // The stain recedes as the noise threshold sweeps past it.
      //
      // feTurbulence's fractalNoise sits around 0.5, so with a slope of 7 the
      // mask is fully black below about -7 and fully white above about +1.
      // Sweeping a narrower range leaves the page half clear before the
      // animation has started. Where it starts is the page's own damage value:
      // a badly stained page begins almost entirely obscured, a lightly
      // stained one begins readable-but-not-legible.
      const start = STAIN_CLEAR + art.damage * (STAIN_FULL - STAIN_CLEAR)
      const threshold = start + (STAIN_CLEAR - start) * stain
      // The mask opens up as `intercept` climbs, so the visible ink has to run
      // the other way — it is 1 minus the mask, or the stain would arrive as
      // the page cleared.
      for (const fn of stainFns) fn.setAttribute('intercept', String(threshold))
      for (const fn of inkFns) fn.setAttribute('intercept', String(1 - threshold))
      if (bleed) bleed.style.opacity = String((1 - stain) * 0.55)
      if (foxing) foxing.style.opacity = String(1 - fox * 0.6)

      // Handwriting, word by word, with a pen lift between them.
      let cursor = 0
      const total = inkTotal || 1
      const liftShare = (LIFT * words.length) / Math.max(0.001, T_WRITE_END - T_WRITE_START)
      for (const g of words) {
        const len = Number(g.dataset.len ?? 1)
        const share = (len / total) * (1 - Math.min(0.5, liftShare))
        const local = clamp01((write - cursor) / Math.max(1e-4, share))
        cursor += share + Math.min(0.5, liftShare) / Math.max(1, words.length)
        for (const path of g.children as unknown as SVGPathElement[]) {
          const l = Number(path.dataset.len ?? 1)
          path.style.strokeDashoffset = String(l * (1 - local))
        }
      }

      for (const path of sketch) {
        const l = Number(path.dataset.len ?? 1)
        path.style.strokeDashoffset = String(l * (1 - plate))
      }
    }

    if (mode !== 'restoring') {
      const p = mode === 'clean' ? 1 : 0
      apply(p, p, p, p)
      if (mode === 'clean') {
        // Set the ink directly rather than trusting the timeline to land
        // exactly on 1: a page that has already been restored must be fully
        // written, and rounding is not a good enough reason for it not to be.
        for (const g of words) {
          for (const path of g.children as unknown as SVGPathElement[]) path.style.strokeDashoffset = '0'
        }
        for (const path of sketch) path.style.strokeDashoffset = '0'
      }
      return
    }

    doneRef.current = false
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = (now - start) / 1000
      apply(
        clamp01(t / T_STAIN_END),
        clamp01((t - T_FOXING_START) / (T_FOXING_END - T_FOXING_START)),
        clamp01((t - T_WRITE_START) / (T_WRITE_END - T_WRITE_START)),
        clamp01((t - T_WRITE_END) / (T_SKETCH_END - T_WRITE_END)),
      )
      if (t < T_SKETCH_END) {
        raf = requestAnimationFrame(tick)
      } else if (!doneRef.current) {
        doneRef.current = true
        onRestored?.()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [art, mode, onRestored])

  const id = `${art.id}-${art.seed}`

  return (
    <svg
      ref={rootRef}
      className="journal-page"
      viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Journal page ${art.date}${art.locked ? ', water damaged and illegible' : ''}`}
    >
      <defs>
        {/* Paper fibre: turbulence, because a few hundred hairline strokes is
            a few hundred DOM nodes for something nobody looks at directly. */}
        <filter id={`fibre-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.05" numOctaves={2} seed={art.seed} />
          <feColorMatrix type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.34 0 0 0 0 0.24 0 0 0 0.16 0" />
        </filter>

        {/* The stain mask. The sweep of `intercept` is the restoration. */}
        <filter id={`stainmask-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.06" numOctaves={4} seed={art.seed + 5} result="n" />
          <feColorMatrix in="n" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1" result="g" />
          <feComponentTransfer in="g">
            <feFuncR data-stain type="linear" slope={7} intercept={-1.7} />
            <feFuncG data-stain type="linear" slope={7} intercept={-1.7} />
            <feFuncB data-stain type="linear" slope={7} intercept={-1.7} />
          </feComponentTransfer>
        </filter>

        {/* The stain itself: the same threshold, flooded with tannin brown. */}
        <filter id={`stainink-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.06" numOctaves={4} seed={art.seed + 5} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="a" />
          <feComponentTransfer in="a" result="t">
            <feFuncA data-stain-ink type="linear" slope={-7} intercept={2.7} />
          </feComponentTransfer>
          <feFlood floodColor="#7d5a33" result="ink" />
          <feComposite in="ink" in2="t" operator="in" />
        </filter>

        {/* Ink bleed: the same boundary, blurred, sitting under the stain. */}
        <filter id={`bleed-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>

        {/* The damaged area is a soft mask, not a hard clip: water does not
            stop at an outline, and clipping the stain left it with straight
            cut edges where the blob crossed the page. */}
        <filter id={`soften-${id}`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
        <mask id={`damage-${id}`}>
          <path d={art.damageD || 'M0,0'} fill="#fff" filter={`url(#soften-${id})`} />
        </mask>

        <mask id={`mask-${id}`}>
          <rect x="0" y="0" width={PAGE_W} height={PAGE_H} fill="#fff" />
          {art.damageD && (
            <g mask={`url(#damage-${id})`}>
              <rect x="0" y="0" width={PAGE_W} height={PAGE_H} filter={`url(#stainmask-${id})`} />
            </g>
          )}
        </mask>
      </defs>

      <rect className="paper" x="0" y="0" width={PAGE_W} height={PAGE_H} />
      <rect x="0" y="0" width={PAGE_W} height={PAGE_H} filter={`url(#fibre-${id})`} />

      <g className="rules">
        {art.rules.map((y) => (
          <line key={y} x1={8} x2={PAGE_W - 8} y1={y + 1.2} y2={y + 1.2} />
        ))}
      </g>

      <g data-foxing className="foxing">
        {art.foxing.map((b, i) => (
          <path key={i} d={b.d} opacity={b.strength} />
        ))}
      </g>

      <path className="crease" d={art.creaseD} />

      {/* Everything the water took is behind the mask. */}
      <g mask={`url(#mask-${id})`}>
        <g className="ink heading">
          {art.heading.words.map((w, wi) => (
            <g key={wi} data-word data-len={wordLength(w.strokes)}>
              {w.strokes.map((s, si) => (
                <path key={si} d={s.d} strokeWidth={s.width} data-len={s.length}
                      style={{ strokeDasharray: s.length, strokeDashoffset: s.length }} />
              ))}
            </g>
          ))}
        </g>
        <g className="ink body">
          {art.hand.words.map((w, wi) => (
            <g key={wi} data-word data-len={wordLength(w.strokes)}>
              {w.strokes.map((s, si) => (
                <path key={si} d={s.d} strokeWidth={s.width} data-len={s.length}
                      style={{ strokeDasharray: s.length, strokeDashoffset: s.length }} />
              ))}
            </g>
          ))}
        </g>
        <g className="ink caption">
          {art.caption?.words.map((w, wi) => (
            <g key={wi} data-word data-len={wordLength(w.strokes)}>
              {w.strokes.map((s, si) => (
                <path key={si} d={s.d} strokeWidth={s.width} data-len={s.length}
                      style={{ strokeDasharray: s.length, strokeDashoffset: s.length }} />
              ))}
            </g>
          ))}
        </g>
        <g className="ink plate">
          {art.sketch.map((s, i) => (
            <path key={i} data-sketch d={s.d} strokeWidth={s.width} data-len={sketchLength(s.d)}
                  style={{ strokeDasharray: sketchLength(s.d), strokeDashoffset: sketchLength(s.d) }} />
          ))}
        </g>
      </g>

      {/* The bleed halo sits under the stain and fades with it. */}
      {art.damageD && (
        <>
          <g data-bleed className="bleed">
            <path d={art.damageD} filter={`url(#bleed-${id})`} />
          </g>
          <g mask={`url(#damage-${id})`} className="stain">
            <rect x="0" y="0" width={PAGE_W} height={PAGE_H} filter={`url(#stainink-${id})`} />
          </g>
        </>
      )}
    </svg>
  )
}

function wordLength(strokes: { length: number }[]): number {
  let n = 0
  for (const s of strokes) n += s.length
  return Math.max(0.001, n)
}

/** Rough path length for the plate, which is polylines rather than curves. */
function sketchLength(d: string): number {
  const nums = d.match(/-?\d+(\.\d+)?/g)
  if (!nums || nums.length < 4) return 10
  let n = 0
  for (let i = 2; i + 1 < nums.length; i += 2) {
    n += Math.hypot(Number(nums[i]) - Number(nums[i - 2]), Number(nums[i + 1]) - Number(nums[i - 1]))
  }
  return Math.max(1, n)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

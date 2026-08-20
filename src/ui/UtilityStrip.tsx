import { useGame } from '../engine/store.ts'

/**
 * §5.5 — one line of mono, and that is the entire HUD.
 *
 * Everything else the player needs to know is in the water: bait behaviour,
 * surface texture, colour, the seam at the drop-off. There is deliberately no
 * bite indicator and no advice (§6.1).
 */
export function UtilityStrip() {
  const hud = useGame((s) => s.hud)
  return (
    <div className="utility-strip" role="status" aria-live="off">
      <span>{hud.time}</span>
      <span>
        TIDE {hud.tideGlyph} {hud.tideHeightM.toFixed(1)}m
      </span>
      <span>
        {hud.windLabel} {hud.windKt}kt
      </span>
    </div>
  )
}

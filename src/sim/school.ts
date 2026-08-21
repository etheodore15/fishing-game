import type { Fish } from './fish.ts'
import { WORK } from '../engine/tuning.ts'

/**
 * Where your own kind are (§8.1's states, read across a species).
 *
 * Tailor and Australian salmon are schooling fish. A dusky flathead is not:
 * it lies on the sand on its own and waits. That difference is most of what
 * the flat looks like — one species scattered across the bottom, the others
 * moving as a body — and none of it existed, because every fish picked its own
 * lie and swam to it alone.
 *
 * This is the one thing a fish cannot work out for itself: where the rest of
 * them are. It is rebuilt once a step, before anything moves, so every fish in
 * the step reads the same answer and none of them is a frame ahead of the
 * others.
 *
 * Three things come out of it. Cohesion, which is a school holding together
 * and travelling as one. Feeding, which is a school going at the bait as one —
 * a bust-up is several fish at once, not one fish repeatedly. And the rally: the keenest fish of a species, once it is
 * genuinely interested, is something the rest can see — a fish turning hard on
 * something is the most visible event in an estuary — so the school comes to
 * have a look. That is the whole reason a school of tailor is easy to find and
 * impossible to leave alone once it switches on.
 *
 * The rally can never make a fish eat. It brings it over; the lure has to do
 * the rest, which keeps the retrieve the thing that catches fish.
 */

export interface SchoolRow {
  /** How many of this species are on the water and free-swimming. */
  n: number
  /** Where the body of them is. */
  cx: number
  cy: number
  /** Mean heading as a unit-ish vector, so a school travels together. */
  hx: number
  hy: number
  /** Where the body of them is going: the lead fish's lie, shared. */
  lieX: number
  lieY: number
  /** How many of them are into the bait right now, and where. */
  lungeN: number
  lungeX: number
  lungeY: number
  /** The keenest one, if it is interested enough to be worth following. */
  rallyId: number
  rallyX: number
  rallyY: number
  rallyInterest: number
  /** Lowest free-swimming id of the species. Stable, so the school does not
   *  change its mind about where it is going every time one is hooked. */
  lead: number
}

export class Schools {
  private readonly rows = new Map<string, SchoolRow>()
  /** The water as it was at the last observe. Held, not copied. */
  private list: readonly Fish[] = []

  /**
   * Read the water. Called once a step, before any fish moves.
   *
   * Allocation-free after the first step: the rows are reused in place, which
   * §11 asks of anything that runs every frame.
   */
  observe(fish: readonly Fish[]): void {
    this.list = fish
    for (const row of this.rows.values()) {
      row.n = 0
      row.lead = Infinity
      row.cx = 0
      row.cy = 0
      row.hx = 0
      row.hy = 0
      row.rallyId = -1
      row.rallyX = 0
      row.rallyY = 0
      row.rallyInterest = 0
      row.lungeN = 0
    }
    for (const f of fish) {
      // A hooked or landed fish is not part of the school any more, and a
      // spooked one is leaving: neither is something to follow.
      if (f.isHooked || f.state === 'landed' || f.state === 'spook') continue
      let row = this.rows.get(f.species.id)
      if (!row) {
        row = {
          n: 0, cx: 0, cy: 0, hx: 0, hy: 0, lieX: 0, lieY: 0,
          lungeN: 0, lungeX: 0, lungeY: 0,
          rallyId: -1, rallyX: 0, rallyY: 0, rallyInterest: 0, lead: Infinity,
        }
        this.rows.set(f.species.id, row)
      }
      row.n += 1
      row.cx += f.x
      row.cy += f.y
      row.hx += Math.cos(f.heading)
      row.hy += Math.sin(f.heading)
      if (f.id < row.lead) {
        row.lead = f.id
        row.lieX = f.lieX
        row.lieY = f.lieY
      }
      if (f.lunging) {
        row.lungeN += 1
        row.lungeX = f.lungeAtX
        row.lungeY = f.lungeAtY
      }
      if (f.interest > row.rallyInterest) {
        row.rallyInterest = f.interest
        row.rallyId = f.id
        row.rallyX = f.x
        row.rallyY = f.y
      }
    }
    for (const row of this.rows.values()) {
      if (row.n === 0) continue
      row.cx /= row.n
      row.cy /= row.n
      const h = Math.hypot(row.hx, row.hy) || 1
      row.hx /= h
      row.hy /= h
      // Below inspect it is a fish that has noticed something, which happens
      // all day and is not news. Above it, it is a fish turning on something.
      if (row.rallyInterest < WORK.inspectAt) row.rallyId = -1
    }
  }

  /** The row for a species, or null if none of them are free-swimming. */
  row(speciesId: string): SchoolRow | null {
    const row = this.rows.get(speciesId)
    return row && row.n > 0 ? row : null
  }

  /** The nearest fish of the same species, for personal space. Never itself. */
  nearestMate(self: Fish): Fish | null {
    let best: Fish | null = null
    let bestD = Infinity
    for (const f of this.list) {
      if (f === self || f.species.id !== self.species.id) continue
      if (f.isHooked || f.state === 'landed') continue
      const d = Math.hypot(f.x - self.x, f.y - self.y)
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }
}

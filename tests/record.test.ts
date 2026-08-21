import { strict as assert } from 'node:assert'
import test from 'node:test'
import { recordLeaves, recordLine, recordSummary } from '../src/art/recordPage.ts'
import type { CatchRecord } from '../src/engine/store.ts'

/**
 * The catch record.
 *
 * Every fish was already being written into the save and there was nowhere to
 * read it back. These check the page it becomes: that it is a page of the same
 * journal rather than a table beside it, that it is in the order you would
 * flick to, and that a line fits on a line.
 */

const fish = (n: number, over: Partial<CatchRecord> = {}): CatchRecord => ({
  speciesId: 'dusky-flathead',
  displayName: 'Dusky Flathead',
  lengthCm: 38 + n,
  weightKg: 0.8,
  tideState: 'run-out',
  timeLabel: '07:14',
  at: 1000 + n * 60000,
  ...over,
})

test('an empty record is still a page', () => {
  const leaves = recordLeaves([])
  assert.equal(leaves.length, 1)
  assert.match(leaves[0]!.body, /Nothing in it yet/)
  assert.equal(leaves[0]!.damage, 0, 'the part the player wrote is not the ruined part')
  assert.equal(leaves[0]!.locked, false)
})

test('the newest fish is at the top', () => {
  const log = [fish(0), fish(1), fish(2)]
  // The em dash is the entry's own mark; the summary line has none.
  const lines = recordLeaves(log)[0]!.body.split('\n').filter((l) => l.includes('—'))
  assert.equal(lines.length, 3)
  assert.match(lines[0]!, /40cm/)
  assert.match(lines[2]!, /38cm/)
})

test('the summary counts the fish and names the best of them', () => {
  assert.match(recordSummary([fish(0)]), /^One fish\. Best 38cm/)
  assert.match(recordSummary([fish(0), fish(9)]), /^2 fish\. Best 47cm, a dusky flathead\./)
})

test('the summary notices more than one kind of fish', () => {
  const mixed = [fish(0), fish(3, { speciesId: 'tailor', displayName: 'Tailor' })]
  assert.match(recordSummary(mixed), /2 kinds/)
  assert.doesNotMatch(recordSummary([fish(0), fish(1)]), /kinds/)
})

test('a line is short enough to stay a line', () => {
  // The hand wraps at the column, and a wrapped entry costs two of the eleven
  // ruled lines a leaf has. Measured against the longest thing it can say.
  const worst = recordLine(
    fish(40, { displayName: 'Australian Salmon', tideState: 'high-slack', timeLabel: '10:59' }),
  )
  assert.ok(worst.length <= 44, `"${worst}" is ${worst.length} characters`)
  assert.doesNotMatch(worst, /\n/)
})

test('a long season runs onto more leaves, in order', () => {
  const log = Array.from({ length: 25 }, (_, i) => fish(i))
  const leaves = recordLeaves(log)
  assert.equal(leaves.length, 3)
  assert.match(leaves[0]!.date, /CATCH RECORD/)
  assert.match(leaves[1]!.date, /CONTINUED/)
  // Newest on the first leaf, oldest on the last, and nothing dropped.
  const all = leaves.flatMap((l) => l.body.split('\n').filter((x) => x.includes('—')))
  assert.equal(all.length, 25)
  assert.match(all[0]!, /62cm/)
  assert.match(all[24]!, /38cm/)
})

test('every leaf has its own stable seed', () => {
  const leaves = recordLeaves(Array.from({ length: 25 }, (_, i) => fish(i)))
  const seeds = new Set(leaves.map((l) => l.seed))
  assert.equal(seeds.size, leaves.length, 'two leaves would wobble identically')
  // Same input, same page: the journal is a physical object, not a redraw.
  const again = recordLeaves(Array.from({ length: 25 }, (_, i) => fish(i)))
  assert.deepEqual(leaves.map((l) => l.seed), again.map((l) => l.seed))
})

test('the record is not written by the tide, so it carries no damage', () => {
  const leaves = recordLeaves(Array.from({ length: 25 }, (_, i) => fish(i)))
  for (const l of leaves) {
    assert.equal(l.damage, 0)
    assert.equal(l.sketch, 'none')
  }
})

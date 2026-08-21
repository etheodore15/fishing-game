import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Chapter } from '../src/content/schema.ts'
import { describeUnlock, isChapterComplete, remainingUnlocks } from '../src/sim/progress.ts'

/**
 * Finishing the chapter.
 *
 * The rule that ends chapter one has always been in the content, and there was
 * nothing anywhere that said so, showed it happening, or marked it done. These
 * check the two halves of the fix: that "complete" means something a player can
 * actually reach, and that what is still missing can be said out loud without
 * telling anybody how to fish.
 */

const CHAPTER = JSON.parse(
  readFileSync(new URL('../src/content/chapters/ch1-estuary.json', import.meta.url), 'utf8'),
) as Chapter

test('the chapter ships with something left to do', () => {
  assert.equal(remainingUnlocks(CHAPTER, ['p001']).length, 1)
  assert.equal(isChapterComplete(CHAPTER, ['p001']), false)
})

test('a page with no rule is not something the player has failed to do', () => {
  // p002 belongs to a fish nobody has caught in any chapter. Counting it as
  // outstanding would leave chapter one permanently, invisibly unfinishable.
  const withRules = new Set(CHAPTER.unlocks.map((u) => u.pageId))
  assert.ok(CHAPTER.pages.some((p) => p !== 'p001' && !withRules.has(p)), 'no ruleless page to check')
  assert.equal(isChapterComplete(CHAPTER, ['p001', 'p003']), true)
})

test('every rule names a page the chapter actually has', () => {
  for (const u of CHAPTER.unlocks) {
    assert.ok(CHAPTER.pages.includes(u.pageId), `${u.pageId} is not in the chapter`)
  }
})

test('the rule is stated in the journal’s own voice', () => {
  const line = describeUnlock(CHAPTER.unlocks[0]!, 'Dusky Flathead')
  assert.match(line, /dusky flathead over 45cm/)
  assert.match(line, /run-out/)
  assert.doesNotMatch(line, /you|cast|try|must|need/i)
  assert.ok(line.endsWith('.'))
})

test('a rule with no tide or size still says something', () => {
  const line = describeUnlock({ pageId: 'x', require: { species: 'dusky-flathead' } }, 'Dusky Flathead')
  assert.equal(line, 'a dusky flathead.')
})

test('an hour window is spelled as a clock, not a decimal', () => {
  const line = describeUnlock(
    { pageId: 'x', require: { species: 'dusky-flathead', hourWindow: [5.5, 7.25] } },
    'Dusky Flathead',
  )
  assert.match(line, /between 05:30 and 07:15/)
})

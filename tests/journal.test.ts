import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildPage, parsePage, PAGE_W } from '../src/art/journalPage.ts'
import { canDraw, layoutHand } from '../src/art/hand.ts'
import type { Species } from '../src/content/schema.ts'

const dir = new URL('../src/content/journal/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const pages = files.map((f) => parsePage(f.replace('.md', ''), readFileSync(new URL(f, dir), 'utf8')))
const SPECIES = JSON.parse(
  readFileSync(new URL('../src/content/species/dusky-flathead.json', import.meta.url), 'utf8'),
) as Species

const chapter = JSON.parse(
  readFileSync(new URL('../src/content/chapters/ch1-estuary.json', import.meta.url), 'utf8'),
)

test('the slice ships the three pages §13.8 asks for', () => {
  assert.equal(pages.length, 3)
  const clean = pages.filter((p) => p.damage === 0)
  const locked = pages.filter((p) => p.locked)
  assert.equal(clean.length, 1, 'exactly one page ships already restored')
  assert.equal(locked.length, 1, 'exactly one page is stained and locked')
})

/**
 * The hand is a skeleton alphabet, not a font: a character with no skeleton
 * silently vanishes from the page. This is the test that stops a typo in the
 * prose becoming a hole in the journal.
 */
test('every character in every page can actually be written', () => {
  for (const page of pages) {
    for (const text of [page.body, page.date, page.title]) {
      for (const ch of text) {
        assert.ok(canDraw(ch), `page ${page.id}: the hand cannot draw ${JSON.stringify(ch)}`)
      }
    }
  }
})

test('the species display name can be written, since it captions the plate', () => {
  for (const ch of SPECIES.displayName) assert.ok(canDraw(ch), `cannot draw ${ch}`)
})

test('the hand wraps inside its column and never runs off the page', () => {
  const page = pages[0]!
  const layout = layoutHand(page.body, {
    size: 3.1, columnWidth: 76, lineHeight: 6.4, slant: 0.12,
    jitter: 1, seed: page.seed, x: 12, y: 30,
  })
  assert.ok(layout.words.length > 20)
  for (const w of layout.words) {
    assert.ok(w.x + w.width <= PAGE_W - 6, `a word ran to ${w.x + w.width}`)
  }
  assert.ok(layout.totalLength > 0)
})

test('a page is identical every time it is built', () => {
  // §8.7: seeded per page. A journal that re-writes itself in a different hand
  // on every load is not a physical object, and this one is meant to be.
  const a = buildPage(pages[0]!, SPECIES)
  const b = buildPage(pages[0]!, SPECIES)
  assert.equal(a.hand.words.length, b.hand.words.length)
  assert.equal(JSON.stringify(a.hand.words[3]), JSON.stringify(b.hand.words[3]))
  assert.equal(a.damageD, b.damageD)
  assert.equal(JSON.stringify(a.foxing), JSON.stringify(b.foxing))
})

test('a clean page has no stain geometry at all', () => {
  const clean = pages.find((p) => p.damage === 0)!
  assert.equal(buildPage(clean, SPECIES).damageD, '')
})

test('a stained page has a stain and hides its writing', () => {
  const stained = pages.find((p) => p.damage > 0.5)!
  const art = buildPage(stained, null)
  assert.notEqual(art.damageD, '')
  assert.ok(art.hand.words.length > 0, 'the writing exists; the water is what hides it')
})

test('the plate is traced from the rig, so a species needs no art', () => {
  const art = buildPage(pages[0]!, SPECIES)
  assert.ok(art.sketch.length >= 6, 'silhouette, fins, tail, lateral line and eye')
  assert.ok(art.sketchBox)
  assert.ok(art.caption && art.caption.words.length > 0)
  for (const s of art.sketch) {
    assert.ok(s.d.startsWith('M'), 'every plate path is a real path')
    assert.ok(!s.d.includes('NaN'))
  }
})

test('every unlock rule names a page that exists', () => {
  const ids = new Set(pages.map((p) => p.id))
  for (const rule of chapter.unlocks) {
    assert.ok(ids.has(rule.pageId), `chapter unlocks ${rule.pageId}, which is not a page`)
    assert.ok(chapter.pages.includes(rule.pageId), `${rule.pageId} is not in the chapter's spread`)
  }
})

test('the earned page is not one of the pages the player starts with', () => {
  const earned = chapter.unlocks.map((u: { pageId: string }) => u.pageId)
  for (const id of earned) {
    const page = pages.find((p) => p.id === id)!
    assert.ok(page.damage > 0, `${id} is earned, so it has to start damaged`)
  }
})

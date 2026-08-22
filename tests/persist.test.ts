import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/engine/store.ts'
import { SCHEMA_VERSION, freshSave, migrate } from '../src/persist.ts'

/**
 * §10.3 makes schemaVersion mandatory from day one and asks for the migration
 * hook to be written before the first release. These tests are that hook's
 * contract: they exist so the second release cannot quietly break the first
 * one's journals.
 */

const current = {
  schemaVersion: SCHEMA_VERSION,
  chapterProgress: { 'ch1-estuary': 2 },
  pagesRestored: ['p001', 'p003'],
  catchLog: [],
  settings: { audio: true, tierOverride: null, reducedMotion: false },
  hasSeenRestoration: true,
  lastPlayed: 1,
}

test('a save from this build loads unchanged', () => {
  const out = migrate(structuredClone(current))
  assert.deepEqual(out, current)
})

test('junk is refused rather than half-loaded', () => {
  assert.equal(migrate(null), null)
  assert.equal(migrate('nope'), null)
  assert.equal(migrate(42), null)
})

test('a save with no version is refused, not guessed at', () => {
  // Nothing shipped before version 1, so an unversioned blob is either
  // corruption or another application's data. Guessing at its shape is how a
  // player ends up with a journal that half exists.
  assert.equal(migrate({ pagesRestored: ['p001'] }), null)
})

test('a save from a newer build is refused rather than truncated', () => {
  const future = { ...current, schemaVersion: SCHEMA_VERSION + 1 }
  assert.equal(migrate(future), null)
})

test('every version below the current one has a migration to run', () => {
  // The real guarantee: if this build reads schema N, then a save at any
  // version below N has to be able to climb. A missing step returns null,
  // which is a deleted journal, so it has to be caught here and not there.
  for (let v = 1; v < SCHEMA_VERSION; v++) {
    const old = { ...current, schemaVersion: v }
    const out = migrate(structuredClone(old))
    assert.ok(out, `no migration path from schema ${v}`)
    assert.equal(out.schemaVersion, SCHEMA_VERSION)
  }
})

/**
 * Starting again.
 *
 * Everything this game knows about a player is in their browser, so a restart
 * is the only way back to page one — and the only thing here that deletes
 * anything. What survives it is exactly the part that is easy to get quietly
 * wrong, so it is a table rather than a sequence of mutations.
 */

const played = {
  ...current,
  catchLog: [
    {
      speciesId: 'tailor',
      displayName: 'Tailor',
      lengthCm: 41,
      weightKg: 0.84,
      tideState: 'run-out' as const,
      timeLabel: '07:14',
      at: 12,
    },
  ],
  chaptersCelebrated: ['ch1-estuary'],
  speciesSeen: 2,
  luresSeen: 2,
  settings: { ...DEFAULT_SETTINGS, audio: false, guide: 'off' as const, lureId: 'metal-slug' },
}

test('starting the chapter again empties the journal and the record', () => {
  const next = freshSave('chapter', played)
  assert.deepEqual(next.pagesRestored, ['p001'])
  assert.deepEqual(next.catchLog, [])
  assert.deepEqual(next.chaptersCelebrated, [])
  assert.equal(next.schemaVersion, SCHEMA_VERSION)
})

test('and keeps what is a preference rather than progress', () => {
  // Somebody restarting the chapter has not changed their mind about the
  // volume, and §5.4's un-skippable restoration is a fact about the person.
  const next = freshSave('chapter', played)
  assert.equal(next.settings.audio, false)
  assert.equal(next.settings.guide, 'off')
  assert.equal(next.hasSeenRestoration, true)
})

test('but not a lure it has just taken away', () => {
  // What is tied on is progress wearing a preference's clothes: after a
  // restart the metal is back behind a salmon nobody has caught.
  assert.equal(freshSave('chapter', played).settings.lureId, DEFAULT_SETTINGS.lureId)
})

test('erasing everything means everything', () => {
  const next = freshSave('everything', played)
  assert.deepEqual(next.settings, DEFAULT_SETTINGS)
  assert.equal(next.hasSeenRestoration, false)
  assert.deepEqual(next.catchLog, [])
  assert.deepEqual(next.pagesRestored, ['p001'])
})

test('the marks go back with the things they count', () => {
  // Both counts are compared against what the log has earned. Left where they
  // were, the mark that says "something new is in here" would stay off until
  // the player had re-earned more than they ever had.
  for (const mode of ['chapter', 'everything'] as const) {
    const next = freshSave(mode, played)
    assert.equal(next.speciesSeen, 0, mode)
    assert.equal(next.luresSeen, 0, mode)
  }
})

test('a restart is a save this build can read straight back', () => {
  // It is written to the same store the game reads on boot, so if migrate
  // refused it the player would come back to a wiped journal AND a broken one.
  for (const mode of ['chapter', 'everything'] as const) {
    const next = freshSave(mode, played)
    assert.deepEqual(migrate(structuredClone(next)), next, mode)
  }
})

test('what a restart relocks is not a list anyone has to remember', () => {
  // The tackle box, the species pages and what the guide will tell you are all
  // derived from the catch log. Emptying it is the whole reset.
  const next = freshSave('chapter', played)
  assert.equal(next.catchLog.length, 0)
  assert.equal(Object.keys(next).some((k) => /unlock|tackle|known/i.test(k)), false)
})

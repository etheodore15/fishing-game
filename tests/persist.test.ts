import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, migrate } from '../src/persist.ts'

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

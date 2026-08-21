import { openDB, type IDBPDatabase } from 'idb'
import { gameStore, type CatchRecord, type Settings } from './engine/store.ts'

/**
 * Save state (§10.3, §13.10).
 *
 * `schemaVersion` is mandatory from day one and the migration hook is written
 * before the first release, not after — a save format with no way forward is a
 * save format you have to delete, and deleting a player's journal is not a
 * thing this game gets to do.
 */

export const SCHEMA_VERSION = 1

export interface SaveState {
  schemaVersion: number
  chapterProgress: Record<string, number>
  pagesRestored: string[]
  catchLog: CatchRecord[]
  settings: Settings
  hasSeenRestoration: boolean
  /** Chapters whose completion card the player has already seen. */
  chaptersCelebrated?: string[]
  lastPlayed: number
}

const DB_NAME = 'slack-water'
const STORE = 'save'
const KEY = 'current'

/**
 * Bring an old save up to the current schema.
 *
 * Each step migrates exactly one version forward and they run in order, so a
 * save from any release can climb to the present. Add a case, never edit one.
 */
const MIGRATIONS: Record<number, (s: SaveState) => SaveState> = {
  // 0 → 1: the first shipped format. Anything without a version predates the
  // slice and is treated as a fresh journal rather than guessed at.
}

export function migrate(raw: unknown): SaveState | null {
  if (!raw || typeof raw !== 'object') return null
  let save = raw as SaveState
  let version = Number(save.schemaVersion ?? 0)
  if (!Number.isFinite(version) || version < 0) return null
  if (version > SCHEMA_VERSION) {
    // A save from a newer build. Refuse rather than silently dropping fields.
    console.warn(`[slack-water] save is schema ${version}, this build reads ${SCHEMA_VERSION}`)
    return null
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) return null
    save = step(save)
    version += 1
    save.schemaVersion = version
  }
  return save
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    },
  })
  return dbPromise
}

export async function load(): Promise<SaveState | null> {
  try {
    const raw = await (await db()).get(STORE, KEY)
    return migrate(raw)
  } catch (err) {
    // A broken or blocked IndexedDB must not stop the game starting; the
    // player loses their journal, not their trip.
    console.warn('[slack-water] could not read the save', err)
    return null
  }
}

export function snapshot(): SaveState {
  const s = gameStore.getState()
  return {
    schemaVersion: SCHEMA_VERSION,
    chapterProgress: { 'ch1-estuary': s.pagesRestored.length },
    pagesRestored: s.pagesRestored,
    catchLog: s.catchLog,
    settings: s.settings,
    hasSeenRestoration: s.hasSeenRestoration,
    chaptersCelebrated: s.chaptersCelebrated,
    lastPlayed: Date.now(),
  }
}

export async function save(): Promise<void> {
  try {
    await (await db()).put(STORE, snapshot(), KEY)
  } catch (err) {
    console.warn('[slack-water] could not write the save', err)
  }
}

export function applySave(s: SaveState): void {
  gameStore.getState().hydrate({
    pagesRestored: s.pagesRestored?.length ? s.pagesRestored : ['p001'],
    catchLog: s.catchLog ?? [],
    hasSeenRestoration: Boolean(s.hasSeenRestoration),
    chaptersCelebrated: s.chaptersCelebrated ?? [],
    settings: { ...gameStore.getState().settings, ...s.settings },
  })
}

/**
 * Write on the things worth writing on: a restored page, a logged catch, a
 * settings change. Not every frame, and not on a timer.
 */
export function autosave(): () => void {
  let last = ''
  const unsubscribe = gameStore.subscribe((s) => {
    const key = `${s.pagesRestored.join()}|${s.catchLog.length}|${s.hasSeenRestoration}|${s.chaptersCelebrated.join()}|${JSON.stringify(s.settings)}`
    if (key === last) return
    last = key
    void save()
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') void save()
  }
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHide)
  }
}

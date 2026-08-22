import { openDB, type IDBPDatabase } from 'idb'
import { DEFAULT_SETTINGS, FIRST_PAGE, gameStore, type CatchRecord, type Settings } from './engine/store.ts'

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
  /** How many species pages and lures the player has actually looked at. */
  speciesSeen?: number
  luresSeen?: number
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

/**
 * Starting again (§10.3, the other direction).
 *
 * Everything this game knows about a player lives in their browser, which
 * meant that until now there was no way to start the chapter over, hand the
 * phone to someone else, or undo a trip you would rather not have had. The two
 * shapes here are the two things a player actually means by it.
 *
 * A pure function of the save it replaces, because *what survives a restart*
 * is the part that is easy to get quietly wrong, and a table of it can be
 * checked. Everything the game unlocks is derived from the catch log — the
 * tackle box, the species pages, what the guide is willing to tell you — so
 * emptying the log relocks all of it with no second list to remember.
 */
export type StartAgain = 'chapter' | 'everything'

export function freshSave(mode: StartAgain, from: SaveState): SaveState {
  const keep = mode === 'chapter'
  return {
    schemaVersion: SCHEMA_VERSION,
    chapterProgress: { 'ch1-estuary': 1 },
    pagesRestored: [FIRST_PAGE],
    catchLog: [],
    chaptersCelebrated: [],
    // Both counts go back with the things they count, or the marks that say
    // "something new is in here" would stay off until the player re-earned
    // more than they ever had.
    speciesSeen: 0,
    luresSeen: 0,
    // Sound, guide and detail are preferences rather than progress: a player
    // restarting the chapter has not changed their mind about the volume.
    // What is tied on is not a preference — it is a lure they have just been
    // relocked out of — so it goes back to the one that ships.
    settings: keep
      ? { ...from.settings, lureId: DEFAULT_SETTINGS.lureId }
      : { ...DEFAULT_SETTINGS },
    // §5.4 keeps the first restoration un-skippable. Having seen it once is a
    // fact about the person, not about the journal, so it survives a chapter
    // restart and not a wipe.
    hasSeenRestoration: keep ? Boolean(from.hasSeenRestoration) : false,
    lastPlayed: Date.now(),
  }
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
    speciesSeen: s.speciesSeen,
    luresSeen: s.luresSeen,
    lastPlayed: Date.now(),
  }
}

export async function save(): Promise<void> {
  if (suspended) return
  try {
    await (await db()).put(STORE, snapshot(), KEY)
  } catch (err) {
    console.warn('[slack-water] could not write the save', err)
  }
}

/**
 * Once a restart is written, nothing else may write.
 *
 * The autosave watches the store, and the store is still holding the trip the
 * player is walking away from. Between writing the fresh save and the game
 * coming back up, one stray write would put the whole journal back.
 */
let suspended = false

/**
 * Write the fresh save. The caller brings the game back up on it.
 *
 * Deliberately a reload rather than reaching into every subsystem to put it
 * back: the water, the tide, the clock, the fish, the trip and the overlay all
 * hold live state, and the one code path that is known to build all of them
 * correctly from a save is the one that runs every time the game is opened.
 */
export async function startAgain(mode: StartAgain): Promise<void> {
  const next = freshSave(mode, snapshot())
  try {
    await (await db()).put(STORE, next, KEY)
  } catch (err) {
    console.warn('[slack-water] could not write the restart', err)
  }
  suspended = true
}

export function applySave(s: SaveState): void {
  gameStore.getState().hydrate({
    pagesRestored: s.pagesRestored?.length ? s.pagesRestored : ['p001'],
    catchLog: s.catchLog ?? [],
    hasSeenRestoration: Boolean(s.hasSeenRestoration),
    chaptersCelebrated: s.chaptersCelebrated ?? [],
    // Absent in a save from before the marks existed. Zero means everything
    // already earned reads as unseen, which for a returning player is a
    // one-off nudge to go and look at what they have — not a wrong answer.
    speciesSeen: s.speciesSeen ?? 0,
    luresSeen: s.luresSeen ?? 0,
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
    const key = `${s.pagesRestored.join()}|${s.catchLog.length}|${s.hasSeenRestoration}|${s.chaptersCelebrated.join()}|${s.speciesSeen},${s.luresSeen}|${JSON.stringify(s.settings)}`
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

/* eslint-disable no-restricted-globals */
/**
 * Service worker (§12).
 *
 * Cache-first for everything the game owns. The requirement is that the whole
 * game — including the journal — runs offline after one load, and that a cold
 * start offline is under three seconds, so nothing here goes to the network
 * first and then falls back.
 *
 * The cache name comes from the ?v= on this worker's own URL, which the app
 * stamps with the build id. A new build is a new worker, a new cache, and an
 * old cache deleted on activate.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE = `slack-water-${VERSION}`
const BASE = new URL('./', self.location.href).pathname

/** The shell. Everything else is cached the first time it is asked for. */
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icon.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
  `${BASE}fonts/chivo-black-latin.woff2`,
  `${BASE}fonts/newsreader-var-latin.woff2`,
  `${BASE}fonts/space-mono-400-latin.woff2`,
  `${BASE}fonts/space-mono-700-latin.woff2`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Individually, so one missing file cannot fail the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('slack-water-') && name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)

      // A navigation always resolves to the shell: the game is one page, and
      // it has to open with the aeroplane mode switch on.
      if (request.mode === 'navigate') {
        const shell = await cache.match(`${BASE}index.html`)
        if (shell) return shell
      }

      const hit = await cache.match(request, { ignoreSearch: false })
      if (hit) return hit

      try {
        const response = await fetch(request)
        // Only cache things we actually served: an opaque or failed response
        // cached here would be an offline start that renders nothing.
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => {})
        }
        return response
      } catch (err) {
        const shell = await cache.match(`${BASE}index.html`)
        if (shell && request.destination === 'document') return shell
        throw err
      }
    })(),
  )
})

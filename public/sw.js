/* eslint-disable no-restricted-globals */
/**
 * Service worker (§12).
 *
 * Two requirements pull in opposite directions. §12 wants the whole game —
 * journal included — to run offline after one load, with a cold offline start
 * under three seconds. But a player who opens the game every week also has to
 * end up on the build that is actually deployed.
 *
 * A worker that answers everything from cache satisfies the first and fails
 * the second permanently: index.html never changes, so the build id in it
 * never changes, so this worker's own ?v= URL never changes, so the browser's
 * byte comparison never sees an update, and the player is pinned to the first
 * build they ever loaded. That is the bug this split fixes.
 *
 *   navigations + index.html : network first, with a short timeout and a cache
 *                              fallback. Online, the player gets the current
 *                              build. Offline, fetch rejects at once and the
 *                              shell comes straight back out of the cache.
 *   hashed build assets      : cache first. The hash is in the name, so a
 *                              changed file is a different URL.
 *   everything else          : stale while revalidate. Instant from cache,
 *                              refreshed behind the player's back.
 *
 * The cache name comes from the ?v= on this worker's own URL, which the app
 * stamps with the build id. A new build is a new worker, a new cache, and an
 * old cache deleted on activate.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE = `slack-water-${VERSION}`
const BASE = new URL('./', self.location.href).pathname
const SHELL_URL = `${BASE}index.html`

/** How long a navigation waits for the network before falling back to cache. */
const NETWORK_TIMEOUT_MS = 2500

/** The shell. Everything else is cached the first time it is asked for. */
const SHELL = [
  BASE,
  SHELL_URL,
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

/** Vite writes content-hashed names, so an asset URL is immutable. */
function isImmutable(url) {
  return url.pathname.startsWith(`${BASE}assets/`) || url.pathname.startsWith(`${BASE}fonts/`)
}

function isShell(request, url) {
  return request.mode === 'navigate' || url.pathname === SHELL_URL || url.pathname === BASE
}

function cacheable(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default')
}

/**
 * A response that arrived via a redirect, made safe to hand to a navigation.
 *
 * A worker may not answer a navigation with a redirected response — the
 * browser rejects it and the navigation fails outright, which looks to the
 * player like the game has stopped existing. That is not hypothetical: this
 * worker asks for `index.html` by name, and a static host with clean URLs on
 * (`serve`, and plenty of CDNs) answers that with a 301 to `index`. Every
 * visit after the first died with ERR_FAILED, found while testing a restart
 * button that reloads the page.
 *
 * Rebuilding it from its body clears the redirected flag and keeps the bytes,
 * which are the bytes we asked for either way.
 */
async function unredirect(response) {
  const body = await response.blob()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Resolves to null rather than throwing, so a caller can fall through. */
async function fromNetwork(cache, request, key, timeoutMs) {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : 0
  try {
    const response = await fetch(request, { signal: controller.signal })
    const usable = response.redirected ? await unredirect(response) : response
    if (cacheable(usable)) cache.put(key || request, usable.clone()).catch(() => {})
    return usable
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)

      // The one page. Ask the network first so a deployed build actually
      // reaches a returning player; fall back to the cached shell the moment
      // the network says no, which offline it does immediately.
      if (isShell(request, url)) {
        const fresh = await fromNetwork(
          cache,
          new Request(SHELL_URL, { cache: 'reload' }),
          SHELL_URL,
          NETWORK_TIMEOUT_MS,
        )
        if (fresh) return fresh
        const shell = await cache.match(SHELL_URL)
        if (shell) return shell
        return fetch(request)
      }

      const hit = await cache.match(request, { ignoreSearch: false })

      // Hashed names cannot go stale. Anything else gets served from cache and
      // refreshed in the background, so a stray file is at most one load behind.
      if (hit) {
        if (!isImmutable(url)) event.waitUntil(fromNetwork(cache, request, null, 0))
        return hit
      }

      const fresh = await fromNetwork(cache, request, null, 0)
      if (fresh) return fresh
      const shell = await cache.match(SHELL_URL)
      if (shell && request.destination === 'document') return shell
      return Response.error()
    })(),
  )
})

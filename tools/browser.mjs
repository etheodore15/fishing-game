import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

/**
 * Launch Chromium wherever it happens to live.
 *
 * These harnesses run in three places with three different browsers: a dev
 * container with a pre-installed Chromium at a fixed path, a CI runner where
 * Playwright installs its own, and a developer's machine which could be
 * either. Hard-coding one path works in exactly one of them — which is how the
 * first CI run failed, with everything else green.
 */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  return existsSync(preinstalled) ? preinstalled : undefined
}

/** Software rendering, so these run on a headless box with no GPU. */
export const SOFTWARE_GL = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
]

export function launchChromium({ args = SOFTWARE_GL } = {}) {
  const executablePath = chromiumPath()
  return chromium.launch({ args, ...(executablePath ? { executablePath } : {}) })
}

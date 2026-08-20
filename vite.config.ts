import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from /<repo>/. Override with BASE_PATH in CI
// if the repo is ever renamed or moved to a custom domain.
const base = process.env.BASE_PATH ?? '/fishing-game/'

// Stamped onto the service worker's URL so a new build installs a new worker
// and drops the old cache.
const buildId = process.env.BUILD_ID ?? Date.now().toString(36)

// A single-file build for sharing a playable snapshot (tools/bundle-single.mjs).
// Everything ends up in one chunk so it can be inlined into one HTML file, and
// the service worker is compiled out because there is nothing to install.
const singleFile = process.env.SINGLE_FILE === '1'

export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __ENABLE_SW__: JSON.stringify(!singleFile),
  },
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: singleFile
        ? { inlineDynamicImports: true }
        : {
            manualChunks: {
              pixi: ['pixi.js'],
              react: ['react', 'react-dom'],
            },
          },
    },
  },
  server: { host: true },
})

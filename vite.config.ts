import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from /<repo>/. Override with BASE_PATH in CI
// if the repo is ever renamed or moved to a custom domain.
const base = process.env.BASE_PATH ?? '/fishing-game/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: { host: true },
})

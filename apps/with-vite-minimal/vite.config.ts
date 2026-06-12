import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { resolve } from 'path'

export default defineConfig({
  root: 'resources',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  build: { outDir: '../dist/client' },
})

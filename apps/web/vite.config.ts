import {defineConfig} from 'vite'
import {fileURLToPath} from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    host: '127.0.0.1', port: 5183, strictPort: true,
    proxy: {
      '/agency-api': 'http://127.0.0.1:3003',
      '/agency-ws': {target: 'ws://127.0.0.1:3003', ws: true},
    },
  },
  build: {
    outDir: '../../dist/web', emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        agency: fileURLToPath(new URL('./agency.html', import.meta.url)),
      },
      output: {manualChunks: id => id.includes('/node_modules/three/') ? 'three' : undefined},
    },
  },
})

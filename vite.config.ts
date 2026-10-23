import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The web app that the tlx server (server/) serves; the server pulls the
// catalog, holds the site login, and stands in for the site's API and websocket.
export default defineConfig({
  root: 'web',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  // `npm run dev`: hot reload, with everything else answered by a tlx server on its default port.
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/backend': 'http://127.0.0.1:8765',
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
    },
  },
  build: { outDir: fileURLToPath(new URL('server/tlx_server/static', import.meta.url)), emptyOutDir: true, target: 'es2023' },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Build only the HTMX/browser helpers; Python renders every page and fragment.
export default defineConfig({
  root: 'web',
  build: {
    outDir: fileURLToPath(new URL('server/tlx_server/static', import.meta.url)),
    emptyOutDir: true, target: 'es2023', manifest: true,
    rollupOptions: { input: fileURLToPath(new URL('src/web.ts', import.meta.url)) },
  },
});

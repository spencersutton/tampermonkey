import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Two builds from the same source:
// - default: the Tampermonkey userscript. It takes over /tlx on the site,
//   pulls and caches the catalog itself, and uses the site's own login.
// - `--mode web`: a plain web app (phones included) that the tlx server
//   (server/) serves; the server pulls the catalog, holds the site login,
//   and stands in for the site's API and websocket.
// Modules that differ are imported by alias and swapped per build.
const RAW = 'https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js';
const app = (file: string) => fileURLToPath(new URL(`src/app/${file}`, import.meta.url));

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  const alias = {
    '@source': app(web ? 'source-web.tsx' : 'source-local.tsx'),
    '@auth': app(web ? 'auth-web.tsx' : 'auth-site.tsx'),
    '@storage': app(web ? 'storage-web.ts' : 'storage-gm.ts'),
  };
  const oxc = { jsx: { runtime: 'automatic', importSource: 'preact' } } as const;
  if (web) {
    return {
      root: 'web',
      oxc,
      resolve: { alias },
      // `npm run dev:web`: hot reload, with everything else answered by a tlx server on its default port.
      server: {
        proxy: {
          '/api': 'http://127.0.0.1:8765',
          '/backend': 'http://127.0.0.1:8765',
          '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
        },
      },
      build: { outDir: fileURLToPath(new URL('server/tlx_server/static', import.meta.url)), emptyOutDir: true, target: 'es2023' },
    };
  }
  return {
    oxc,
    resolve: { alias },
    build: { minify: false, target: 'esnext' },
    plugins: [
      monkey({
        entry: 'src/main.ts',
        userscript: {
          name: 'Triangle Liquidators – Hide, Filter & Bid Confirm',
          namespace: 'https://triangleliquidators.com/',
          version: '3.8.22',
          icon: 'https://www.google.com/s2/favicons?sz=64&domain=triangleliquidators.com',
          description: 'A fast cached catalog view at /tlx, with confirmed bidding. The site\'s other pages are left unchanged.',
          match: ['https://triangleliquidators.com/tlx*', 'https://www.triangleliquidators.com/tlx*'],
          homepageURL: 'https://github.com/spencersutton/tampermonkey',
          updateURL: RAW,
          downloadURL: RAW,
          'run-at': 'document-start',
          grant: ['GM_getValue', 'GM_setValue', 'GM_addValueChangeListener', 'unsafeWindow'],
        },
        build: { fileName: 'triangle-liquidators.user.js', autoGrant: false },
      }),
    ],
  };
});

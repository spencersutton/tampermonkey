import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Two builds from the same source:
// - default: standalone, the browser pulls and caches the catalog itself.
// - `--mode server`: the catalog and synced settings come from the tlx server
//   (server/), reached through GM_xmlhttpRequest.
const RAW = 'https://raw.githubusercontent.com/spencersutton/tampermonkey/main';

export default defineConfig(({ mode }) => {
  const server = mode === 'server';
  const fileName = server ? 'triangle-liquidators-server.user.js' : 'triangle-liquidators.user.js';
  return {
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    resolve: {
      alias: { '@source': fileURLToPath(new URL(`src/app/source-${server ? 'server' : 'local'}.tsx`, import.meta.url)) },
    },
    // Both builds write to dist/; don't let the second one wipe the first.
    build: { minify: false, target: 'esnext', emptyOutDir: false },
    plugins: [
      monkey({
        entry: 'src/main.ts',
        userscript: {
          name: server ? 'Triangle Liquidators – Hide, Filter & Bid Confirm (server)' : 'Triangle Liquidators – Hide, Filter & Bid Confirm',
          namespace: 'https://triangleliquidators.com/',
          version: server ? '1.0.0' : '3.8.8',
          icon: 'https://www.google.com/s2/favicons?sz=64&domain=triangleliquidators.com',
          description: server
            ? 'The /tlx catalog view, backed by your own tlx server (catalog pulls, history and synced settings). Install this or the standalone script, not both.'
            : 'A fast cached catalog view at /tlx, with confirmed bidding. The site\'s other pages are left unchanged.',
          match: ['https://triangleliquidators.com/tlx*', 'https://www.triangleliquidators.com/tlx*'],
          homepageURL: 'https://github.com/spencersutton/tampermonkey',
          updateURL: `${RAW}/${fileName}`,
          downloadURL: `${RAW}/${fileName}`,
          'run-at': 'document-start',
          grant: ['GM_getValue', 'GM_setValue', 'GM_addValueChangeListener', ...(server ? (['GM_xmlhttpRequest'] as const) : [])],
          // localhost by default; `*` lets Tampermonkey ask before reaching a server elsewhere.
          ...(server ? { connect: ['127.0.0.1', 'localhost', '*'] } : {}),
        },
        build: { fileName, autoGrant: false },
      }),
    ],
  };
});

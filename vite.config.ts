import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const RAW = 'https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { minify: false },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Triangle Liquidators – Hide, Filter & Bid Confirm',
        namespace: 'https://triangleliquidators.com/',
        version: '2.2.2',
        description:
          'Hide lots, gray out lots matching filter words, confirm bids, show estimated total cost, and a fast cached catalog view at /tlx.',
        match: ['https://triangleliquidators.com/*', 'https://www.triangleliquidators.com/*'],
        homepageURL: 'https://github.com/spencersutton/tampermonkey',
        updateURL: RAW,
        downloadURL: RAW,
        'run-at': 'document-start',
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_addStyle',
          'GM_addValueChangeListener',
          'GM_registerMenuCommand',
        ],
      },
      build: { fileName: 'triangle-liquidators.user.js', autoGrant: false },
    }),
  ],
});

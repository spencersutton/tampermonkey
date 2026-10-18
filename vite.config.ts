import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const RAW = 'https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { minify: false, target: 'esnext' },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Triangle Liquidators – Hide, Filter & Bid Confirm',
        namespace: 'https://triangleliquidators.com/',
        version: '3.8.0',
        description: 'A fast cached catalog view at /tlx, with confirmed bidding. The site\'s other pages are left unchanged.',
        match: ['https://triangleliquidators.com/tlx*', 'https://www.triangleliquidators.com/tlx*'],
        homepageURL: 'https://github.com/spencersutton/tampermonkey',
        updateURL: RAW,
        downloadURL: RAW,
        'run-at': 'document-start',
        grant: ['GM_getValue', 'GM_setValue', 'GM_addValueChangeListener'],
      },
      build: { fileName: 'triangle-liquidators.user.js', autoGrant: false },
    }),
  ],
});

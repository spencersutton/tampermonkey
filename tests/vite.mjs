// Shared setup for the web tests: a Vite dev server that loads the app's TS/TSX modules with
// ssrLoadModule, with the globals the app's entry point (src/web.tsx) installs before anything
// else, so modules need not import them themselves.
import 'temporal-polyfill/global';
import { createServer } from 'vite';

export async function createTestServer() {
  const vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  await vite.ssrLoadModule('/src/shared/arrayToSet.ts');
  await vite.ssrLoadModule('/src/shared/temporalGlobals.ts');
  return vite;
}

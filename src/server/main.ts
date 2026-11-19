// Runs the tlx server: the web app (phones included), backed by its own catalog
// pulls, synced settings and login to the site.
//
//   npm run server                                             # this computer only: http://127.0.0.1:8765
//   TLX_PASSWORD='pick-one' npm run server -- --host 0.0.0.0   # also your phone
//   npm run server -- --help
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import '../shared/arrayToSet';
import { MINUTE } from '../shared/constants';
import { createApp, LOCAL_HOSTS } from './app';
import { Catalog } from './catalog';
import { History } from './history';
import { DEFAULT_MODEL, DEFAULT_URL, Labeller } from './itemtypes';
import { log, setVerbose } from './log';
import { relayHandler, type RelayData } from './relay';
import { SiteSession } from './session';
import { SiteApi } from './site';
import { Store } from './store';

const env = (name: string) => process.env[name];
const REPO = new URL('../../', import.meta.url).pathname;
export const STATIC_DIR = join(REPO, 'dist');
export const DEFAULT_DB = join(
  env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
  'tlx-server',
  'tlx.db',
);
const TOKEN_CHECK_MS = MINUTE; // refresh the token before it expires, for background pulls too

const HELP = `Usage: npm run server -- [options]

The /tlx catalog as a web app (phones included), backed by its own catalog
pulls, synced settings and login to the site.

  --host HOST                 address to listen on (default 127.0.0.1; 0.0.0.0 for your phone)
  --port PORT                 (default 8765)
  --db FILE                   SQLite file (default ${DEFAULT_DB})
  --password PASSWORD         password for the app (or set TLX_PASSWORD); required unless listening on loopback only
  --llm-key KEY               API key for naming each lot's item type (or set TLX_LLM_KEY); without one, lots get no item types
  --llm-url URL               OpenAI-compatible API base URL (or TLX_LLM_URL; default ${DEFAULT_URL})
  --llm-model MODEL           model for item types (or TLX_LLM_MODEL; default ${DEFAULT_MODEL})
  --tls-cert FILE             serve HTTPS with this certificate (PEM)
  --tls-key FILE              private key for --tls-cert
  --allow-host NAME           extra Host name to accept when there's no password (repeatable)
  -v, --verbose               log every request
`;

function fail(message: string): never {
  console.error(`tlx-server: ${message}`);
  process.exit(2);
}

const isLoopback = (host: string) =>
  LOCAL_HOSTS.includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '[::1]';

function main() {
  const { values: args } = parseArgs({
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8765' },
      db: { type: 'string', default: DEFAULT_DB },
      password: { type: 'string' },
      'llm-key': { type: 'string' },
      'llm-url': { type: 'string' },
      'llm-model': { type: 'string' },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' },
      'allow-host': { type: 'string', multiple: true, default: [] },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  setVerbose(args.verbose);
  const password = args.password ?? env('TLX_PASSWORD') ?? null;
  if (!password && !isLoopback(args.host)) {
    fail(
      'set --password (or TLX_PASSWORD) to listen beyond this machine; the server can bid as you.',
    );
  }
  if (Boolean(args['tls-cert']) !== Boolean(args['tls-key'])) {
    fail('--tls-cert and --tls-key go together.');
  }
  if (!existsSync(join(STATIC_DIR, 'index.html'))) {
    log.warn(
      `the web app isn't built (${STATIC_DIR}/index.html is missing): run \`npm run build\``,
    );
  }

  const store = new Store(args.db);
  const site = new SiteApi();
  const session = new SiteSession(store);
  const history = new History(store, site);
  const catalog = new Catalog(store, session, history, site);
  void catalog.runForever();
  void history.runForever();
  history.wake(); // finish what the last run left
  const llmKey = args['llm-key'] ?? env('TLX_LLM_KEY');
  if (llmKey) {
    const labeller = new Labeller(
      store,
      llmKey,
      args['llm-url'] ?? env('TLX_LLM_URL') ?? DEFAULT_URL,
      args['llm-model'] ?? env('TLX_LLM_MODEL') ?? DEFAULT_MODEL,
    );
    catalog.afterPull = () => labeller.wake();
    void labeller.runForever();
  }
  setInterval(() => void session.token(), TOKEN_CHECK_MS);

  const app = createApp({
    store,
    session,
    catalog,
    history,
    password,
    allowHosts: args['allow-host'],
    tls: Boolean(args['tls-cert']),
    staticDir: STATIC_DIR,
  });
  const server = Bun.serve<RelayData>({
    hostname: args.host,
    port: Number(args.port),
    idleTimeout: 120, // seconds; site logins and slow pages take a while
    fetch: async (req, srv) => {
      const res = await app.fetch(req, srv);
      log.debug(`${req.method} ${new URL(req.url).pathname} ${res.status}`);
      return res;
    },
    websocket: relayHandler,
    ...(args['tls-cert'] && args['tls-key']
      ? { tls: { cert: Bun.file(args['tls-cert']), key: Bun.file(args['tls-key']) } }
      : {}),
  });
  log.info(`serving the app on ${server.url.href}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.stop(true);
      store.close();
      process.exit(0);
    });
  }
}

if (import.meta.main) {
  main();
}

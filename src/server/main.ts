// Runs the tlx server: the web app, the site's API and websocket, and the
// login, in TypeScript; the catalog still comes from the Python server, which
// this starts on a loopback port and forwards to (see app.ts).
//
//   npm run server                                       # this computer only: http://127.0.0.1:8765
//   TLX_PASSWORD='pick-one' npm run server -- --host 0.0.0.0   # also your phone
//   npm run server -- --help
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { backendAt, createApp, LOCAL_HOSTS } from './app';
import { relayHandler, type RelayData } from './relay';
import { SiteSession } from './session';
import { Store } from './store';

const env = (name: string) => process.env[name];
const REPO = new URL('../../', import.meta.url).pathname;
const STATIC_DIR = join(REPO, 'server/tlx_server/static');
const DEFAULT_DB = join(
  env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
  'tlx-server',
  'tlx.db',
);
const TOKEN_CHECK_MS = 60_000; // keep the token fresh for the Python server's pulls
const BACKEND_START_MS = 120_000; // the first `uv run` may install dependencies

const HELP = `Usage: npm run server -- [options]

  --host HOST                 address to listen on (default 127.0.0.1; 0.0.0.0 for your phone)
  --port PORT                 (default 8765)
  --db FILE                   SQLite file, shared with the Python server (default ${DEFAULT_DB})
  --password PASSWORD         password for the app (or set TLX_PASSWORD); required unless listening on loopback only
  --allow-host NAME           extra Host name to accept when there's no password (repeatable)
  --tls-cert FILE, --tls-key FILE   serve HTTPS
  --backend URL               use a Python server that's already running there (with --shared-login)
                              instead of starting one; set TLX_BACKEND_KEY the same for both, if any
  --backend-port PORT         loopback port for the Python server this starts (default 8766)
  --background-minutes N, --llm-key KEY, --llm-url URL, --llm-model MODEL, -v
                              passed to the Python server (see: cd server && uv run python -m tlx_server --help)
`;

const { values: args } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8765' },
    db: { type: 'string', default: DEFAULT_DB },
    password: { type: 'string' },
    'allow-host': { type: 'string', multiple: true, default: [] },
    'tls-cert': { type: 'string' },
    'tls-key': { type: 'string' },
    backend: { type: 'string' },
    'backend-port': { type: 'string', default: '8766' },
    'background-minutes': { type: 'string' },
    'llm-key': { type: 'string' },
    'llm-url': { type: 'string' },
    'llm-model': { type: 'string' },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function fail(message: string): never {
  console.error(`tlx-server: ${message}`);
  process.exit(2);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}
const password = args.password ?? env('TLX_PASSWORD') ?? null;
const loopback = LOCAL_HOSTS.includes(args.host) || args.host.startsWith('127.');
if (!password && !loopback) {
  fail(
    'set --password (or TLX_PASSWORD) to listen beyond this machine; the server can bid as you.',
  );
}
if (Boolean(args['tls-cert']) !== Boolean(args['tls-key'])) {
  fail('--tls-cert and --tls-key go together.');
}
if (!existsSync(join(STATIC_DIR, 'index.html'))) {
  console.warn(
    `the web app isn't built (${STATIC_DIR}/index.html is missing): run \`npm run build\``,
  );
}

/** Start the Python server on loopback, sharing the database and our login. */
function startPython(key: string) {
  const forwarded = [
    ...(['background-minutes', 'llm-key', 'llm-url', 'llm-model'] as const).flatMap((name) => {
      const v = args[name];
      return v === undefined ? [] : [`--${name}`, v];
    }),
    ...(args.verbose ? ['--verbose'] : []),
  ];
  // The Python server is behind this one, on loopback: no password of its own.
  const env = Object.fromEntries(
    Object.entries({ ...process.env, TLX_BACKEND_KEY: key }).filter(
      ([name]) => name !== 'TLX_PASSWORD',
    ),
  );
  return Bun.spawn(
    [
      'uv',
      'run',
      '--project',
      join(REPO, 'server'),
      'python',
      '-m',
      'tlx_server',
      '--host',
      '127.0.0.1',
      '--port',
      args['backend-port'],
      '--db',
      args.db,
      '--shared-login',
      ...forwarded,
    ],
    { env, stdout: 'inherit', stderr: 'inherit' },
  );
}

async function waitForBackend(url: string, key: string | null, exited: Promise<unknown>) {
  const deadline = Date.now() + BACKEND_START_MS;
  const gone = exited.then(() => 'gone' as const);
  const check = async () => {
    try {
      const res = await fetch(`${url}/api/health`, {
        headers: key ? { 'X-TLX-Backend-Key': key } : {},
      });
      if (res.ok) {
        return 'up' as const;
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(250);
    return 'waiting' as const;
  };
  while (Date.now() < deadline) {
    const state = await Promise.race([gone, check()]);
    if (state === 'gone') {
      fail('the Python server exited during startup');
    }
    if (state === 'up') {
      return;
    }
  }
  fail(`the Python server at ${url} didn't start`);
}

const store = new Store(args.db);
const session = new SiteSession(store);
let backendUrl = args.backend?.replace(/\/$/, '');
let backendKey = env('TLX_BACKEND_KEY') ?? null;
let child: ReturnType<typeof startPython> | null = null;
if (!backendUrl) {
  backendKey = randomBytes(32).toString('base64url');
  backendUrl = `http://127.0.0.1:${args['backend-port']}`;
  child = startPython(backendKey);
  void child.exited.then((code) => {
    console.error(`tlx-server: the Python server exited (${code}); stopping`);
    process.exit(1);
  });
}
await waitForBackend(backendUrl, backendKey, child?.exited ?? new Promise(() => {}));

const app = createApp({
  store,
  session,
  backend: backendAt(backendUrl, backendKey),
  password,
  allowHosts: args['allow-host'],
  tls: Boolean(args['tls-cert']),
  staticDir: STATIC_DIR,
});
const server = Bun.serve<RelayData>({
  hostname: args.host,
  port: Number(args.port),
  idleTimeout: 120, // seconds; site logins and slow pages take a while
  fetch: (req, srv) => app.fetch(req, srv),
  websocket: relayHandler,
  ...(args['tls-cert'] && args['tls-key']
    ? { tls: { cert: Bun.file(args['tls-cert']), key: Bun.file(args['tls-key']) } }
    : {}),
});
setInterval(() => void session.token(), TOKEN_CHECK_MS);
console.info(`serving the app on ${server.url.href} (catalog from ${backendUrl})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    child?.kill();
    void server.stop(true);
    process.exit(0);
  });
}

// The database contract between this server and the Python one while both run
// (src/server/store.ts and session.ts against server/tlx_server/): a login
// either keeps is one the other reads, and app sessions are shared. Runs the
// real Python code, so it needs uv; skipped without it.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SiteSession } from '../../src/server/session';
import { Store } from '../../src/server/store';
import { FakeSite } from './fake-site';

const SERVER = new URL('../../server/', import.meta.url).pathname;
const hasUv = Bun.which('uv') !== null;
const dir = mkdtempSync(join(tmpdir(), 'tlx-interop-'));
afterAll(() => rmSync(dir, { recursive: true }));

function python(script: string, db: string): unknown {
  const run = Bun.spawnSync(['uv', 'run', '--project', SERVER, 'python', '-c', script, db], {
    cwd: SERVER,
  });
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
  return JSON.parse(run.stdout.toString());
}

describe.skipIf(!hasUv)('with the Python server', () => {
  test("Python's --shared-login reads the login this server keeps", async () => {
    const db = join(dir, 'ts-login.db');
    const site = new FakeSite();
    const store = new Store(db);
    expect(await new SiteSession(store, site.fetch).login('user@example.test', 'right')).toBeNull();
    store.close();
    const seen = python(
      `
import json, sys
from pathlib import Path
from tlx_server.session import SiteSession
from tlx_server.store import Store
s = SiteSession(Store(Path(sys.argv[1])), shared=True)
print(json.dumps({"token": s.token(), "status": s.status()}))
`,
      db,
    );
    expect(seen).toEqual({
      token: site.token,
      status: { loggedIn: true, email: 'user@example.test', name: 'Test User' },
    });
  });

  test('this server reads a login the Python server kept, and app sessions are shared', () => {
    const db = join(dir, 'py-login.db');
    const py = python(
      `
import json, sys
from pathlib import Path
import httpx
from tests.test_session import FakeSite
from tlx_server.session import SiteSession
from tlx_server.store import Store
store = Store(Path(sys.argv[1]))
site = FakeSite()
SiteSession(store, transport=httpx.MockTransport(site)).login("user@example.test", "right")
store.add_session("from-python")
print(json.dumps({"token": site.token}))
`,
      db,
    ) as { token: string };
    const store = new Store(db);
    const session = new SiteSession(store);
    expect(session.status()).toEqual({
      loggedIn: true,
      email: 'user@example.test',
      name: 'Test User',
    });
    expect(store.hasSession('from-python', 60)).toBe(true);
    expect(store.hasSession('from-python', 0)).toBe(false);
    store.addSession('from-ts');
    store.close();
    expect(
      python(
        `
import json, sys
from pathlib import Path
from tlx_server.store import Store
print(json.dumps(Store(Path(sys.argv[1])).has_session("from-ts", 60)))
`,
        db,
      ),
    ).toBe(true);
    expect(py.token).toBeTruthy();
  });
});

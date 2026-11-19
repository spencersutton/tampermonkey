// The itemtypes command, run as a user would.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../../src/server/store';

const dir = mkdtempSync(join(tmpdir(), 'tlx-cli-'));
afterAll(() => rmSync(dir, { recursive: true }));
const db = join(dir, 'tlx.db');
const store = new Store(db);
store.replaceAll([
  { id: 1, title: 'Satin Nickel Knob' },
  { id: 2, title: 'Brass Pull' },
]);
store.saveItemTypes({ 'Brass Pull': ['cabinet pull', null] });
store.close();

const SERVER = new URL('../../src/server/', import.meta.url).pathname;
function run(script: string, ...args: string[]) {
  const p = Bun.spawnSync([process.execPath, join(SERVER, script), '--db', db, ...args], {
    env: { ...process.env, TLX_LLM_KEY: '' },
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

test('itemtypes: reset, and try needs a key', () => {
  expect(run('itemtypes-cli.ts', 'reset').out).toStartWith('forgot the item types of 1 titles;');
  expect(run('itemtypes-cli.ts', 'try')).toMatchObject({ code: 1, err: 'set TLX_LLM_KEY\n' });
});

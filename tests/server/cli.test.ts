// The tags and itemtypes commands, run as a user would.
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

test('tags: rules, lot tags, and errors', () => {
  expect(run('tags-cli.ts', 'rule', 'add', '(satin nickel|brass)', 'finish: $1').out).toBe(
    'rule 1: /(satin nickel|brass)/ → finish: $1\n  lots updated: 2\n',
  );
  expect(run('tags-cli.ts', 'rule', 'preview', 'knob', 'cabinet knob').out).toBe(
    'Satin Nickel Knob  → cabinet knob\n1 lots, 1 distinct titles match\n',
  );
  expect(run('tags-cli.ts', 'rule', 'list').out).toBe(
    '   1  /(satin nickel|brass)/ → finish: $1\n',
  );
  expect(run('tags-cli.ts', 'set', '1', 'Cabinet  Knob').out).toBe(
    'Satin Nickel Knob\n  tags: Cabinet Knob, finish: Satin Nickel\n  lots updated: 1\n',
  );
  expect(run('tags-cli.ts', 'show', '1').out).toBe(
    'Cabinet Knob\nfinish: Satin Nickel\n  from rule 1: /(satin nickel|brass)/ → finish: $1\n',
  );
  expect(run('tags-cli.ts', 'clear', '1').out).toContain('tags: finish: Satin Nickel');
  expect(run('tags-cli.ts', 'reset').out).toBe('forgot 1 tag rows\n');
  expect(run('tags-cli.ts', 'rule', 'remove', '1').out).toBe('removed rule 1\n  lots updated: 2\n');
  expect(run('tags-cli.ts', 'rule', 'remove', '1')).toMatchObject({ code: 1, err: 'no rule 1\n' });
  expect(run('tags-cli.ts', 'show', '9')).toMatchObject({
    code: 1,
    err: 'lot 9 is not in the catalog\n',
  });
  expect(run('tags-cli.ts', 'rule', 'add', '(bad', 'x').code).toBe(1);
});

test('itemtypes: reset, and try needs a key', () => {
  expect(run('itemtypes-cli.ts', 'reset').out).toStartWith('forgot the item types of 1 titles;');
  expect(run('itemtypes-cli.ts', 'try')).toMatchObject({ code: 1, err: 'set TLX_LLM_KEY\n' });
});

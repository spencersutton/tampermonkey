import { afterAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

// Isolated Postgres schemas in tlx_test for server tests, cleaned up in afterAll.
import { SQL } from 'bun';

import { Store } from '../../src/server/store';

export const TEST_DB_URL = process.env['TLX_TEST_DB'] ?? 'postgres://localhost:5432/tlx_test';

let seq = 0;
const runId = randomBytes(4).toString('hex');
const schemas = new Set<string>();
const stores: Store[] = [];

export async function cleanupTestDb() {
  for (const store of stores.splice(0)) {
    await store.close();
  }
  if (!schemas.size) {
    return;
  }
  const toDrop = [...schemas];
  schemas.clear();
  const admin = new SQL(TEST_DB_URL);
  try {
    for (const schema of toDrop) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  } finally {
    await admin.close();
  }
}

export function nextTestSchema() {
  const schema = `t_${runId}_${++seq}`;
  schemas.add(schema);
  return schema;
}

export async function openTestStore(schema = nextTestSchema()) {
  schemas.add(schema);
  const store = await Store.open(TEST_DB_URL, { schema });
  stores.push(store);
  return store;
}

/** Register afterAll cleanup for a test file and return isolated schema/store helpers. */
export function testDb() {
  afterAll(cleanupTestDb);
  return { nextSchema: nextTestSchema, openStore: openTestStore, url: TEST_DB_URL };
}

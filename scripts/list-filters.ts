// Prints every saved regex filter, one per line.
//
//   npm run list-filters
//   npm run list-filters -- --db /path/to/tlx.db
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { KEYS } from '../src/shared/keys';

const env = (name: string) => process.env[name];
const DEFAULT_DB = join(
  env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
  'tlx-server',
  'tlx.db',
);

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: DEFAULT_DB },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`Usage: npm run list-filters -- [--db FILE]\n\nDefault DB: ${DEFAULT_DB}`);
  process.exit(0);
}

if (!existsSync(args.db)) {
  console.error(`list-filters: database not found: ${args.db}`);
  process.exit(2);
}

const db = new Database(args.db, { readonly: true });
try {
  const row = db
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(KEYS.words);
  if (row) {
    const parsed: unknown = JSON.parse(row.value);
    if (Array.isArray(parsed)) {
      for (const word of parsed) {
        if (typeof word === 'string') {
          console.log(word);
        }
      }
    }
  }
} finally {
  db.close();
}

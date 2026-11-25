// Copies an existing tlx-server SQLite database into PostgreSQL.
//
//   bun scripts/migrate-sqlite.ts
//   bun scripts/migrate-sqlite.ts --sqlite /path/to/tlx.db --db postgres://localhost:5432/tlx
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import '../src/shared/arrayToSet';
import { DEFAULT_DB_URL, Store } from '../src/server/store';

const env = (name: string) => process.env[name];
const DEFAULT_SQLITE = join(
  env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
  'tlx-server',
  'tlx.db',
);
const BATCH = 500;

const HELP = `Usage: bun scripts/migrate-sqlite.ts [options]

Copy all data from an existing tlx-server SQLite file into PostgreSQL.

  --sqlite FILE   SQLite file to read (default ${DEFAULT_SQLITE})
  --db URL        PostgreSQL connection URL (default TLX_DB / DATABASE_URL / ${DEFAULT_DB_URL})
  --truncate      Clear existing Postgres tables before copying
  -h, --help      Show this help
`;

function valuePlaceholders(rows: number, cols: number): string {
  const groups: string[] = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    const ph: string[] = [];
    for (let c = 0; c < cols; c++) {
      ph.push(`$${n++}`);
    }
    groups.push(`(${ph.join(', ')})`);
  }
  return groups.join(', ');
}

interface TableSpec {
  name: string;
  columns: string[];
  conflict: string;
  booleans?: Set<string>;
}

const TABLES: TableSpec[] = [
  { name: 'categories', columns: ['value', 'label'], conflict: '(value)' },
  { name: 'conditions', columns: ['value', 'label'], conflict: '(value)' },
  { name: 'locations', columns: ['id', 'name'], conflict: '(id)' },
  {
    name: 'lots',
    columns: [
      'id',
      'seq',
      'auction_period',
      'title',
      'lot_number',
      'category',
      'condition',
      'location',
      'is_transferable',
      'transfer_fee',
      'current_price',
      'estimated_retail_price',
      'ends_at',
      'status',
      'version',
      'bid_count',
      'next_min_increment',
      'is_leading',
      'your_max_bid',
      'is_watchlisted',
      'has_bid',
      'first_seen_at',
      'past_close_count',
      'group_id',
    ],
    conflict: '(id)',
    booleans: new Set(['is_transferable', 'is_leading', 'is_watchlisted', 'has_bid']),
  },
  {
    name: 'lot_images',
    columns: ['lot_id', 'position', 'thumb', 'card', 'large'],
    conflict: '(lot_id, position)',
  },
  {
    name: 'lot_past_closes',
    columns: ['lot_id', 'rank', 'closed_id'],
    conflict: '(lot_id, rank)',
  },
  { name: 'meta', columns: ['key', 'value'], conflict: '(key)' },
  { name: 'settings', columns: ['key', 'value', 'rev'], conflict: '(key)' },
  { name: 'filter_types', columns: ['type'], conflict: '(type)' },
  { name: 'app_sessions', columns: ['id', 'created'], conflict: '(id)' },
  {
    name: 'item_types',
    columns: ['brand', 'model', 'title', 'type', 'category', 'at', 'manual'],
    conflict: '(brand, model, title)',
    booleans: new Set(['manual']),
  },
  {
    name: 'closed_lots',
    columns: [
      'id',
      'title',
      'auction_period',
      'ends_at',
      'price',
      'bid_count',
      'sold',
      'final',
      'condition',
      'location',
      'category',
      'retail',
    ],
    conflict: '(id)',
    booleans: new Set(['sold']),
  },
  {
    name: 'lot_details',
    columns: [
      'lot_id',
      'auction_period',
      'title',
      'status',
      'current_price',
      'description',
      'brand',
      'model',
      'lot_fee',
      'bid_history',
      'fetched_at',
      'images',
    ],
    conflict: '(lot_id)',
  },
];

async function main() {
  const { values: args } = parseArgs({
    options: {
      sqlite: { type: 'string', default: DEFAULT_SQLITE },
      db: { type: 'string', default: env('TLX_DB') ?? env('DATABASE_URL') ?? DEFAULT_DB_URL },
      truncate: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!existsSync(args.sqlite)) {
    console.error(`migrate-sqlite: SQLite database not found: ${args.sqlite}`);
    process.exit(2);
  }

  const sqlite = new Database(args.sqlite, { readonly: true });
  const store = await Store.open(args.db);
  try {
    if (args.truncate) {
      await store.sql.unsafe(
        `TRUNCATE ${TABLES.map(t => t.name)
          .toReversed()
          .join(', ')} CASCADE`,
      );
    }

    for (const table of TABLES) {
      const exists = sqlite
        .query<{ name: string }, [string]>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(table.name);
      if (!exists) {
        continue;
      }
      const cols = table.columns.join(', ');
      const rows = sqlite
        .query<Record<string, string | number | null>, []>(`SELECT ${cols} FROM ${table.name}`)
        .all();
      if (!rows.length) {
        console.log(`${table.name}: 0 rows`);
        continue;
      }
      const booleans = table.booleans ?? new Set<string>();
      await store.sql.begin(async tx => {
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const params: (string | number | boolean | null)[] = [];
          for (const row of chunk) {
            for (const col of table.columns) {
              const raw = row[col] ?? null;
              if (col === 'ends_at' && table.name === 'lots' && raw !== null) {
                params.push(typeof raw === 'number' ? new Date(raw).toISOString() : raw);
              } else if (booleans.has(col)) {
                params.push(raw === null ? null : Boolean(raw));
              } else {
                params.push(raw);
              }
            }
          }
          await tx.unsafe(
            `INSERT INTO ${table.name} (${cols}) VALUES ${valuePlaceholders(chunk.length, table.columns.length)} ON CONFLICT ${table.conflict} DO NOTHING`,
            params,
          );
        }
      });
      console.log(`${table.name}: ${rows.length} rows`);
    }
  } finally {
    sqlite.close();
    await store.close();
  }
}

await main();

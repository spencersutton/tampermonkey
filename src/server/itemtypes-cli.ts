// The itemtypes command (a port of the Python server's `tlx_server.itemtypes`):
// try the labelling prompt on a sample of stored titles, or start over after
// changing it.
//
//   TLX_LLM_KEY=... npm run itemtypes -- try [-n 80] [-c tools]   # label a sample, print it, save nothing
//   npm run itemtypes -- reset                                     # forget every type; the server relabels on its next run
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BATCH, DEFAULT_MODEL, DEFAULT_URL, Labeller, RETRY_MS, VOCAB } from './itemtypes';
import { DEFAULT_DB } from './main';
import { type Lot, Store } from './store';

const HELP = `Usage: npm run itemtypes -- [--db FILE] COMMAND

  try [-n N] [-c CATEGORY]   label a sample of stored titles (default ${BATCH * 2}) and print them; saves nothing.
                             -c samples one site category (its value, e.g. tools or Building_Hardware).
                             Needs TLX_LLM_KEY (and TLX_LLM_URL, TLX_LLM_MODEL to change the model).
  reset                      forget every stored item type; a running server relabels them

  --db FILE                  SQLite file (default ${DEFAULT_DB})
`;

/** A small seeded random generator, so `try` samples the same titles each time (to compare prompts). */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function sample<T>(items: T[], n: number, random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

const byCode = (a: string, b: string) => (a < b ? -1 : Number(a > b));

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      db: { type: 'string', default: DEFAULT_DB },
      n: { type: 'string', short: 'n', default: String(BATCH * 2) },
      category: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  const [cmd] = positionals;
  if (values.help || (cmd !== 'try' && cmd !== 'reset')) {
    console.log(HELP);
    process.exit(values.help ? 0 : 2);
  }
  if (!existsSync(values.db)) {
    console.error(`no database at ${values.db}`);
    process.exit(1);
  }
  const store = new Store(values.db);
  if (cmd === 'reset') {
    const n = store.resetItemTypes();
    console.log(
      `forgot the item types of ${n} titles; a running server relabels them on its next run (after a pull, or within ${RETRY_MS / 60_000} minutes)`,
    );
    return;
  }
  const key = process.env['TLX_LLM_KEY'];
  if (!key) {
    console.error('set TLX_LLM_KEY');
    process.exit(1);
  }
  const labeller = new Labeller(
    store,
    key,
    process.env['TLX_LLM_URL'] ?? DEFAULT_URL,
    process.env['TLX_LLM_MODEL'] ?? DEFAULT_MODEL,
  );
  let lots = new Map(store.allLots().values().map((lot) => [lot.title, lot])).values().toArray();
  if (values.category) {
    lots = lots.filter((lot) => lot.category?.value === values.category);
  }
  const byCategory = new Map<string | null, Lot[]>();
  for (const lot of sample(lots, Number(values.n), seeded(0))) {
    const value = lot.category?.value ?? null;
    byCategory.set(value, [...(byCategory.get(value) ?? []), lot]);
  }
  for (const [value, group] of byCategory) {
    const label = group[0]?.category?.label || 'Other';
    const titles = group
      .map((lot) => lot.title)
      .toSorted((a, b) => byCode(a.toLowerCase(), b.toLowerCase()));
    console.log(`\n## ${label}`);
    const seen = new Map<string, number>(); // types given so far in this run, standing in for the ones a real run saves
    for (let start = 0; start < titles.length; start += BATCH) {
      const batch = titles.slice(start, start + BATCH);
      const vocab = [
        ...store.commonTypes(value, VOCAB),
        ...[...seen.keys()].toSorted((a, b) => (seen.get(b) ?? 0) - (seen.get(a) ?? 0)),
      ].slice(0, VOCAB);
      const types = await labeller.ask(label, batch, vocab);
      batch.forEach((title, i) => {
        const t = types.get(i + 1);
        if (t) {
          seen.set(t, (seen.get(t) ?? 0) + 1);
        }
        console.log(`${(t ?? '(none)').padEnd(28)} ${title}`);
      });
    }
  }
}

await main();

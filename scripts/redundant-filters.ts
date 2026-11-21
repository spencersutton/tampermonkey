// Reports regex title filters that are redundant or overlap on current open lots.
//
//   npm run check-filters
//   npm run check-filters -- --all
//   npm run check-filters -- --db /path/to/tlx.db --json
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { buildRegexes, filterMatches } from '../src/shared/filters';
import { KEYS } from '../src/shared/keys';

const env = (name: string) => process.env[name];
const DEFAULT_DB = join(
  env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
  'tlx-server',
  'tlx.db',
);
const DEFAULT_EXAMPLES = 20;

const HELP = `Usage: npm run check-filters -- [options]

Find regex filters in tlx.db that are redundant or overlap on open lot titles.

  --db FILE       SQLite file (default ${DEFAULT_DB})
  --examples N    Max multi-matched titles to print (default ${DEFAULT_EXAMPLES}; 0 to hide)
  --all           Print every multi-matched title
  --json          Output results as JSON
  -h, --help      Show this help
`;

export interface FilterOverlap {
  other: string;
  shared: number;
  equivalent: boolean;
}

export interface RedundantFilter {
  pattern: string;
  total: number;
  /** Single filters whose matched open lots are a superset of this filter's. */
  subsumedBy: { pattern: string; total: number; equivalent: boolean }[];
  /** All other filters sharing at least one open lot with this filter. */
  overlaps: FilterOverlap[];
}

export interface OverlappingFilter {
  pattern: string;
  total: number;
  unique: number;
  shared: number;
  overlaps: FilterOverlap[];
}

export interface MultiMatchedTitle {
  title: string;
  lots: number;
  filters: string[];
}

export interface FilterAnalysis {
  totalLots: number;
  totalFilters: number;
  invalidFilters: string[];
  multiMatchedLots: number;
  redundant: RedundantFilter[];
  overlapping: OverlappingFilter[];
  multiMatchedTitles: MultiMatchedTitle[];
}

/** Analyze regex filters against a list of lot titles for redundancy and overlap. */
export function analyzeFilters(patterns: string[], titles: string[]): FilterAnalysis {
  const uniquePatterns: string[] = [];
  const seen = new Set<string>();
  for (const raw of patterns) {
    if (raw.trim() && !seen.has(raw)) {
      seen.add(raw);
      uniquePatterns.push(raw);
    }
  }

  const compiled = buildRegexes(uniquePatterns);
  const invalidFilters = compiled.filter(f => f.re === null).map(f => f.word);
  const valid = compiled.filter(f => f.re !== null);

  const matchedByFilter = new Map<string, Set<number>>(valid.map(f => [f.word, new Set()]));
  const uniqueCount = new Map<string, number>(valid.map(f => [f.word, 0]));
  const titleHits = new Map<string, { lots: number; filters: string[] }>();
  let multiMatchedLots = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i] ?? '';
    const hits: string[] = [];
    for (const f of valid) {
      if (filterMatches(f, title)) {
        hits.push(f.word);
        matchedByFilter.get(f.word)?.add(i);
      }
    }
    if (hits.length === 1) {
      for (const only of hits) {
        uniqueCount.set(only, (uniqueCount.get(only) ?? 0) + 1);
      }
    } else if (hits.length >= 2) {
      multiMatchedLots += 1;
      const existing = titleHits.get(title);
      if (existing) {
        existing.lots += 1;
      } else {
        titleHits.set(title, { lots: 1, filters: hits.toSorted() });
      }
    }
  }

  const pairShared = (a: Set<number>, b: Set<number>): number => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let n = 0;
    for (const id of small) {
      if (large.has(id)) {
        n += 1;
      }
    }
    return n;
  };

  const redundant: RedundantFilter[] = [];
  const overlapping: OverlappingFilter[] = [];

  for (const f of valid) {
    const mine = matchedByFilter.get(f.word) ?? new Set<number>();
    const total = mine.size;
    const unique = uniqueCount.get(f.word) ?? 0;
    const shared = total - unique;
    if (shared === 0) {
      continue;
    }

    const overlaps: FilterOverlap[] = [];
    const subsumedBy: { pattern: string; total: number; equivalent: boolean }[] = [];

    for (const other of valid) {
      if (other.word === f.word) {
        continue;
      }
      const theirs = matchedByFilter.get(other.word) ?? new Set<number>();
      if (theirs.size === 0) {
        continue;
      }
      const count = pairShared(mine, theirs);
      if (count === 0) {
        continue;
      }
      const equivalent = count === total && count === theirs.size;
      overlaps.push({ other: other.word, shared: count, equivalent });
      if (count === total) {
        subsumedBy.push({ pattern: other.word, total: theirs.size, equivalent });
      }
    }

    overlaps.sort((a, b) => b.shared - a.shared || a.other.localeCompare(b.other));
    subsumedBy.sort((a, b) => b.total - a.total || a.pattern.localeCompare(b.pattern));

    if (unique === 0) {
      redundant.push({ pattern: f.word, total, subsumedBy, overlaps });
    } else {
      overlapping.push({ pattern: f.word, total, unique, shared, overlaps });
    }
  }

  redundant.sort((a, b) => b.total - a.total || a.pattern.localeCompare(b.pattern));
  overlapping.sort((a, b) => b.shared - a.shared || a.pattern.localeCompare(b.pattern));

  const multiMatchedTitles: MultiMatchedTitle[] = [...titleHits.entries()]
    .map(([title, info]) => ({ title, lots: info.lots, filters: info.filters }))
    .toSorted(
      (a, b) =>
        b.filters.length - a.filters.length || b.lots - a.lots || a.title.localeCompare(b.title),
    );

  return {
    totalLots: titles.length,
    totalFilters: valid.length,
    invalidFilters,
    multiMatchedLots,
    redundant,
    overlapping,
    multiMatchedTitles,
  };
}

/** Read filterWords and open lot titles from a tlx-server SQLite database. */
export function loadFromDb(dbPath: string): { patterns: string[]; titles: string[] } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get(KEYS.words);
    let patterns: string[] = [];
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        patterns = parsed.filter((v): v is string => typeof v === 'string');
      }
    }
    const titles = db
      .query<{ title: string }, []>('SELECT title FROM lots')
      .all()
      .map(r => r.title);
    return { patterns, titles };
  } finally {
    db.close();
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Format the analysis as a concise human-readable report. */
export function formatReport(analysis: FilterAnalysis, maxExamples: number): string {
  const lines: string[] = [];
  lines.push(
    `Checked ${plural(analysis.totalFilters, 'filter')} against ${plural(analysis.totalLots, 'open lot')} ` +
      `(${plural(analysis.multiMatchedLots, 'lot')} matched by 2+ filters).`,
  );
  if (analysis.invalidFilters.length > 0) {
    lines.push(
      `Invalid regex (${analysis.invalidFilters.length}): ${analysis.invalidFilters.join(', ')}`,
    );
  }

  lines.push('');
  if (analysis.redundant.length === 0) {
    lines.push('Fully redundant filters (0 unique matches): none');
  } else {
    lines.push(`Fully redundant filters (0 unique matches): ${analysis.redundant.length}`);
    for (const r of analysis.redundant) {
      let reason: string;
      if (r.subsumedBy.length > 0) {
        const covered = r.subsumedBy.map(s =>
          s.equivalent ? `${s.pattern} (exact same matches)` : `${s.pattern} (${s.total})`,
        );
        reason = `covered by ${covered.join(', ')}`;
      } else {
        const parts = r.overlaps.map(o => `${o.other} (${o.shared})`);
        reason = `covered by combination of ${parts.join(', ')}`;
      }
      lines.push(`  ${r.pattern} (${plural(r.total, 'match', 'matches')}) — ${reason}`);
    }
  }

  lines.push('');
  if (analysis.overlapping.length === 0) {
    lines.push('Partially overlapping filters: none');
  } else {
    lines.push(`Partially overlapping filters: ${analysis.overlapping.length}`);
    for (const o of analysis.overlapping) {
      const peers = o.overlaps.map(p => `${p.other} (${p.shared})`).join(', ');
      lines.push(
        `  ${o.pattern} (${o.total} total, ${o.unique} unique, ${o.shared} shared) — ${peers}`,
      );
    }
  }

  if (maxExamples > 0 && analysis.multiMatchedTitles.length > 0) {
    const shown = analysis.multiMatchedTitles.slice(0, maxExamples);
    const totalTitles = analysis.multiMatchedTitles.length;
    lines.push('');
    lines.push(`Titles matched by multiple filters (showing ${shown.length} of ${totalTitles}):`);
    for (const item of shown) {
      const countTag = item.lots > 1 ? ` (${plural(item.lots, 'lot')})` : '';
      lines.push(`  "${item.title}"${countTag}`);
      lines.push(`    -> ${item.filters.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

function main() {
  const { values: args } = parseArgs({
    options: {
      db: { type: 'string', default: DEFAULT_DB },
      examples: { type: 'string', default: String(DEFAULT_EXAMPLES) },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!existsSync(args.db)) {
    console.error(`check-filters: database not found: ${args.db}`);
    process.exit(2);
  }

  const parsedExamples = Number(args.examples);
  if (!Number.isInteger(parsedExamples) || parsedExamples < 0) {
    console.error(`check-filters: --examples must be a non-negative integer, got ${args.examples}`);
    process.exit(2);
  }

  const { patterns, titles } = loadFromDb(args.db);
  const analysis = analyzeFilters(patterns, titles);

  if (args.json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    const maxExamples = args.all ? analysis.multiMatchedTitles.length : parsedExamples;
    console.log(formatReport(analysis, maxExamples));
  }
}

if (import.meta.main) {
  main();
}

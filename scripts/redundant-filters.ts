// Reports regex title filters that are redundant or overlap on current open lots.
//
//   npm run check-filters
//   npm run check-filters -- --all
//   npm run check-filters -- --db postgres://localhost:5432/tlx --json
import { parseArgs } from 'node:util';

import { DEFAULT_DB_URL, Store, type StoreOptions } from '../src/server/store';
import { buildRegexes, filterMatches } from '../src/shared/filters';
import { KEYS } from '../src/shared/keys';

const env = (name: string) => process.env[name];
const DEFAULT_DB = env('TLX_DB') ?? env('DATABASE_URL') ?? DEFAULT_DB_URL;
const DEFAULT_EXAMPLES = 20;

const HELP = `Usage: npm run check-filters -- [options]

Find regex filters in PostgreSQL that are redundant or overlap on open lot titles.

  --db URL        PostgreSQL connection URL (or TLX_DB / DATABASE_URL; default ${DEFAULT_DB_URL})
  --examples N    Max multi-matched titles to print (default ${DEFAULT_EXAMPLES}; 0 to hide)
  --all           Print every multi-matched title
  --remove        Remove fully redundant and 0-match filters from the database (preserving coverage)
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

export interface PruneResult {
  kept: string[];
  removed: string[];
}

/**
 * Iteratively remove fully redundant and unmatched (0-match) filters while preserving exact
 * open-lot coverage. Invalid patterns are kept untouched.
 */
export function pruneRedundantFilters(patterns: string[], titles: string[]): PruneResult {
  const uniquePatterns: string[] = [];
  const seen = new Set<string>();
  for (const raw of patterns) {
    if (raw.trim() && !seen.has(raw)) {
      seen.add(raw);
      uniquePatterns.push(raw);
    }
  }

  const valid = buildRegexes(uniquePatterns).filter(f => f.re !== null);
  const matchedByFilter = new Map<string, Set<number>>();
  const lotCoverCount = new Int32Array(titles.length);
  const unmatched: string[] = [];

  for (const f of valid) {
    const matched = new Set<number>();
    for (let i = 0; i < titles.length; i++) {
      if (filterMatches(f, titles[i] ?? '')) {
        matched.add(i);
        lotCoverCount[i] = (lotCoverCount[i] ?? 0) + 1;
      }
    }
    if (matched.size > 0) {
      matchedByFilter.set(f.word, matched);
    } else {
      unmatched.push(f.word);
    }
  }

  const isStrictSuperset = (sub: Set<number>, sup: Set<number>): boolean => {
    if (sup.size <= sub.size) {
      return false;
    }
    for (const id of sub) {
      if (!sup.has(id)) {
        return false;
      }
    }
    return true;
  };

  const removedSet = new Set<string>();
  const removed: string[] = [];

  for (;;) {
    const candidates: { pattern: string; total: number; strictSubsumed: boolean }[] = [];
    for (const [pattern, matched] of matchedByFilter) {
      let redundant = true;
      for (const id of matched) {
        if ((lotCoverCount[id] ?? 0) <= 1) {
          redundant = false;
          break;
        }
      }
      if (!redundant) {
        continue;
      }
      let strictSubsumed = false;
      for (const [other, theirs] of matchedByFilter) {
        if (other !== pattern && isStrictSuperset(matched, theirs)) {
          strictSubsumed = true;
          break;
        }
      }
      candidates.push({ pattern, total: matched.size, strictSubsumed });
    }

    if (candidates.length === 0) {
      break;
    }

    candidates.sort(
      (a, b) =>
        Number(b.strictSubsumed) - Number(a.strictSubsumed) ||
        a.total - b.total ||
        b.pattern.length - a.pattern.length ||
        a.pattern.localeCompare(b.pattern),
    );

    const pick = candidates.at(0);
    if (!pick) {
      break;
    }
    const matched = matchedByFilter.get(pick.pattern);
    if (matched) {
      for (const id of matched) {
        lotCoverCount[id] = (lotCoverCount[id] ?? 0) - 1;
      }
    }
    matchedByFilter.delete(pick.pattern);
    removedSet.add(pick.pattern);
    removed.push(pick.pattern);
  }

  unmatched.sort((a, b) => a.localeCompare(b));
  for (const pattern of unmatched) {
    removedSet.add(pattern);
    removed.push(pattern);
  }

  const kept = patterns.filter(p => !removedSet.has(p));
  return { kept, removed };
}

/** Persist updated filterWords via Store (bumping settingsRev). */
export async function saveToDb(
  dbUrl: string,
  patterns: string[],
  options?: StoreOptions,
): Promise<number> {
  const store = await Store.open(dbUrl, options);
  try {
    return await store.putSetting(KEYS.words, patterns);
  } finally {
    await store.close();
  }
}

/** Read filterWords and open lot titles from PostgreSQL. */
export async function loadFromDb(
  dbUrl: string,
  options?: StoreOptions,
): Promise<{ patterns: string[]; titles: string[] }> {
  const store = await Store.open(dbUrl, options);
  try {
    const raw = await store.setting(KEYS.words);
    const patterns = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string')
      : [];
    const rows: unknown = await store.sql.unsafe('SELECT title FROM lots');
    const titles: string[] = [];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === 'object' && 'title' in row && typeof row.title === 'string') {
          titles.push(row.title);
        }
      }
    }
    return { patterns, titles };
  } finally {
    await store.close();
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

async function main() {
  const { values: args } = parseArgs({
    options: {
      db: { type: 'string', default: DEFAULT_DB },
      examples: { type: 'string', default: String(DEFAULT_EXAMPLES) },
      all: { type: 'boolean', default: false },
      remove: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const parsedExamples = Number(args.examples);
  if (!Number.isInteger(parsedExamples) || parsedExamples < 0) {
    console.error(`check-filters: --examples must be a non-negative integer, got ${args.examples}`);
    process.exit(2);
  }

  const { patterns, titles } = await loadFromDb(args.db);

  if (args.remove) {
    const { kept, removed } = pruneRedundantFilters(patterns, titles);
    const rev = removed.length > 0 ? await saveToDb(args.db, kept) : null;
    if (args.json) {
      console.log(JSON.stringify({ removed, keptCount: kept.length, rev }, null, 2));
    } else if (removed.length === 0) {
      console.log('No redundant or unmatched filters to remove.');
    } else {
      console.log(
        `Removed ${plural(removed.length, 'redundant or unmatched filter')} (${kept.length} remaining, settings rev ${rev}):`,
      );
      for (const p of removed) {
        console.log(`  - ${p}`);
      }
    }
    return;
  }

  const analysis = analyzeFilters(patterns, titles);

  if (args.json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    const maxExamples = args.all ? analysis.multiMatchedTitles.length : parsedExamples;
    console.log(formatReport(analysis, maxExamples));
  }
}

if (import.meta.main) {
  await main();
}

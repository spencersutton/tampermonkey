// SQLite storage (a port of the Python server's store.py, on the same schema,
// so an existing database carries over): the catalog, catalog meta, synced
// settings, the site login cookies, sessions of this app's own password login,
// item types and tags, every lot that has left the catalog with its final
// price, and the last detail fetched for each lot (description, brand/model,
// bid history), kept after the lot closes.
//
// A lot is a row of `lots` with its site category, condition and location in
// lookup tables, its images in `lot_images`, its item type joined from
// `identity_item_types` by brand/model (or `item_types` by title when identity
// is missing), its tags from every `tag_rules` pattern its title matches, and
// its most recent past closes in `lot_past_closes`, pointing at `closed_lots`.
// The store hands lots out, and takes them in, as one object each, in the shape
// the app gets them (ServerLot in src/app/server/api.ts).
//
// Every full pull that changes anything gets a new sequence number, and each
// lot row records the sequence of its last change, so a client that has seen
// sequence N only needs the rows with seq > N (plus the current id list, to
// drop lots that are gone). Changes are found by comparing lots as a whole, so
// a lot read back must equal the one stored: optional fields are left out, not
// set to undefined.
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { dequal } from 'dequal';

import { brandModelKey, ItemTypeIndex } from '../shared/identity';
import { endsAtMs, type LotImage, type LotMetadata, type Standing } from '../shared/lot';
import { byCode } from '../shared/sortKey';
import { toLower } from '../shared/tags';
import { isRecord } from './json';
import {
  cleanTags,
  CompiledRule,
  compileTagPattern,
  ruleTags,
  type TagRule,
  uniqueTags,
} from './tags';
import '../shared/arrayToSet';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (value TEXT PRIMARY KEY, label TEXT);
CREATE TABLE IF NOT EXISTS conditions (value INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, auction_period TEXT, title TEXT NOT NULL, lot_number TEXT NOT NULL,
  category TEXT REFERENCES categories, condition INTEGER REFERENCES conditions, location INTEGER REFERENCES locations,
  is_transferable INTEGER NOT NULL, transfer_fee NUMERIC, current_price NUMERIC, estimated_retail_price NUMERIC,
  ends_at INTEGER, status TEXT, version INTEGER, bid_count INTEGER, next_min_increment NUMERIC,
  is_leading INTEGER, your_max_bid NUMERIC, is_watchlisted INTEGER NOT NULL, has_bid INTEGER NOT NULL,
  first_seen_at INTEGER, past_close_count INTEGER NOT NULL DEFAULT 0, group_id INTEGER
);
CREATE INDEX IF NOT EXISTS lots_seq ON lots (seq);
CREATE INDEX IF NOT EXISTS lots_title ON lots (title);
CREATE TABLE IF NOT EXISTS lot_images (
  lot_id INTEGER NOT NULL REFERENCES lots, position INTEGER NOT NULL, thumb TEXT, card TEXT, large TEXT, PRIMARY KEY (lot_id, position)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lot_past_closes (
  lot_id INTEGER NOT NULL REFERENCES lots, rank INTEGER NOT NULL, closed_id INTEGER NOT NULL, PRIMARY KEY (lot_id, rank)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lot_past_closes_closed ON lot_past_closes (closed_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id TEXT PRIMARY KEY, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS item_types (
  title TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT, at REAL NOT NULL, manual INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS item_types_category ON item_types (category);
CREATE TABLE IF NOT EXISTS identity_item_types (
  brand TEXT NOT NULL, model TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, category TEXT,
  at REAL NOT NULL, manual INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (brand, model, title)
);
CREATE TABLE IF NOT EXISTS tag_rules (
  id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, tags TEXT NOT NULL, at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS closed_lots (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, auction_period TEXT, ends_at INTEGER, price REAL, bid_count INTEGER,
  sold INTEGER NOT NULL, final INTEGER NOT NULL, condition TEXT, location TEXT, category TEXT, retail REAL
);
CREATE INDEX IF NOT EXISTS closed_lots_pending ON closed_lots (final, ends_at);
CREATE TABLE IF NOT EXISTS lot_details (
  lot_id INTEGER PRIMARY KEY, auction_period TEXT, title TEXT NOT NULL, status TEXT, current_price NUMERIC, description TEXT,
  brand TEXT, model TEXT, lot_fee NUMERIC, bid_history TEXT NOT NULL, fetched_at INTEGER NOT NULL, images TEXT
);
`;

// lots: ends_at is the site's ISO 8601 text (epoch ms in rows from older servers);
// is_leading and your_max_bid are null without a standing; past_close_count
// counts every matching closed lot, lot_past_closes holds the most recent few;
// group_id is the smallest id of the open lots listing the same item (null when
// no other does; see groupLots in src/shared/identity.ts).
const LOT_COLUMNS =
  'id, seq, auction_period, title, lot_number, category, condition, location, is_transferable, transfer_fee, current_price, ' +
  'estimated_retail_price, ends_at, status, version, bid_count, next_min_increment, is_leading, your_max_bid, is_watchlisted, ' +
  'has_bid, first_seen_at, past_close_count, group_id';
// closed_lots.final: the price is the site's final one (1), the last one a pull saw
// and the site no longer has the lot (-1), or the last one seen, to be asked for (0).
const CLOSED_COLUMNS =
  'id, title, auction_period, ends_at, price, bid_count, sold, final, condition, location, category, retail';

/** A closed lot as attached to an open lot's `pastCloses`. */
export interface PastClose {
  id: number;
  price: number | null;
  endsAt: number | null;
  condition: string | null;
  sold: boolean;
  final: boolean;
}

/** A closed lot in full (`closedLots`, GET /api/history). */
export interface ClosedLot extends PastClose {
  title: string;
  auctionPeriod: string | null;
  bidCount: number | null;
  location: string | null;
  category: string | null;
  retail: number | null;
  brand: string | null;
  model: string | null;
}

/**
 * A lot as stored and as the app gets it: the site's fields (RawLot in src/shared/lot.ts) plus the
 * server's own. Lots from tests and older code may leave fields out.
 */
export interface Lot {
  id: number;
  title: string;
  auction_period?: string | null;
  lot_number?: string;
  category?: { value: string; label?: string | null } | null;
  condition?: { value: number; display_name?: string | null } | null;
  location?: { id: number; name?: string | null } | null;
  is_transferable?: boolean;
  transfer_fee?: number | null;
  current_price?: number | null;
  estimated_retail_price?: number | null;
  ends_at?: string | null;
  status?: string | null;
  version?: number | null;
  bid_count?: number | null;
  next_min_increment?: number | null;
  your_standing?: Standing | null;
  is_watchlisted?: boolean;
  has_bid?: boolean;
  images?: LotImage[];
  firstSeenAt?: number;
  pastCloses?: { n: number; recent: PastClose[] };
  groupId?: number;
  brand?: string | null;
  model?: string | null;
  itemType?: string;
  tags?: string[];
}

/** Something with a title, and maybe an id and identity: what item types and tags are looked up by. */
export interface Item {
  id?: number;
  title: string;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  category?: { value: string; label?: string | null } | null | undefined;
  itemType?: string;
  tags?: string[];
}

/** A lot detail as saved (RawLotDetail in src/shared/lot.ts; tests may leave fields out). */
export interface Detail {
  id: number;
  auction_period?: string | null;
  title?: string;
  status?: string | null;
  current_price?: number | null;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  lot_fee?: number | null;
  bid_history?: unknown[];
  images?: LotImage[];
}

/** Ends at, as the epoch ms closed_lots keeps. */
const endsAtColumn = (lot: Lot) => {
  const ms = endsAtMs(lot);
  return Number.isNaN(ms) ? null : ms;
};

export interface CatalogMeta {
  fetchedAt: number | null; // when the last complete pull finished (epoch ms)
  pullStartedAt: number | null; // when the last pull (successful or not) started – rate limit anchor
  count: number; // lot count the API reported in the last complete pull
  authed: boolean; // whether that pull carried account data
}

export interface CatalogChanges {
  seq: number;
  lots: Lot[]; // each changed lot
  ids: number[]; // every lot id currently stored
}

const num = (v: unknown) => (typeof v === 'number' ? v : null);
const now = () => Date.now() / 1000;
/** A JSON list of strings, as tags are saved. */
function jsonList(text: string): string[] {
  const v: unknown = JSON.parse(text);
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

function catalogMeta(v: unknown): CatalogMeta {
  const field = (key: keyof CatalogMeta): unknown => (isRecord(v) ? v[key] : undefined);
  return {
    fetchedAt: num(field('fetchedAt')),
    pullStartedAt: num(field('pullStartedAt')),
    count: Math.trunc(num(field('count')) ?? 0),
    authed: field('authed') === true,
  };
}

/** A lot as a lots row (LOT_COLUMNS order). */
function lotRow(lot: Lot, seq: number): SQLQueryBindings[] {
  const s = lot.your_standing;
  return [
    lot.id,
    seq,
    lot.auction_period ?? null,
    lot.title || '',
    lot.lot_number || '',
    lot.category?.value ?? null,
    lot.condition?.value ?? null,
    lot.location?.id ?? null,
    lot.is_transferable ? 1 : 0,
    lot.transfer_fee ?? null,
    lot.current_price ?? null,
    lot.estimated_retail_price ?? null,
    lot.ends_at ?? null,
    lot.status ?? null,
    lot.version ?? null,
    lot.bid_count ?? null,
    lot.next_min_increment ?? null,
    s ? Number(s.is_leading) : null,
    s ? s.your_max_bid : null,
    lot.is_watchlisted ? 1 : 0,
    lot.has_bid ? 1 : 0,
    lot.firstSeenAt ?? null,
    lot.pastCloses?.n ?? 0,
    lot.groupId ?? null,
  ];
}

/**
 * A lot as a closed_lots row (CLOSED_COLUMNS order). Until the final price is known, a lot with
 * bids counts as sold.
 */
function closedRow(lot: Lot, final: number): SQLQueryBindings[] {
  const sold = final === 1 ? lot.status === 'sold' : (lot.bid_count ?? 0) > 0;
  return [
    lot.id,
    lot.title || '',
    lot.auction_period ?? null,
    endsAtColumn(lot),
    lot.current_price ?? null,
    lot.bid_count ?? null,
    sold ? 1 : 0,
    final,
    lot.condition?.display_name ?? null,
    lot.location?.name ?? null,
    lot.category?.value ?? null,
    lot.estimated_retail_price ?? null,
  ];
}

/** An image as lot_details.images keeps it. */
interface SavedImage {
  position: number;
  thumb: string;
  card: string;
  large: string;
}
const savedImage = (im: LotImage): SavedImage => ({
  position: im.position,
  thumb: im.image_thumb,
  card: im.image_card,
  large: im.image_large,
});

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Commonest first; ties keep the order first seen (Python's Counter.most_common). */
function mostCommon<K>(counts: Map<K, number>): [K, number][] {
  return counts
    .entries()
    .toArray()
    .sortBy(([, n]) => n)
    .toReversed();
}

export class Store {
  readonly db: Database;
  // Indexes rebuilt only after their tables change (this process makes every change).
  private typeIndexCache: ItemTypeIndex | null = null;
  private rulesCache: CompiledRule[] | null = null;
  private lastStamp = 0;

  constructor(path: string) {
    const file = path !== ':memory:';
    if (file) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(path, { create: true, strict: true });
    this.db.run('PRAGMA journal_mode=WAL');
    this.db.run('PRAGMA busy_timeout=5000');
    this.db.run(SCHEMA);
    if (file) {
      chmodSync(path, 0o600); // holds the site login cookies
    }
  }

  /**
   * When a label or tag is saved, in epoch seconds. Strictly increasing, so two corrections in the
   * same millisecond still rank in the order they were made.
   */
  private stamp(): number {
    this.lastStamp = Math.max(Date.now() / 1000, this.lastStamp + 1e-6);
    return this.lastStamp;
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private all<R>(sql: string, ...params: SQLQueryBindings[]): R[] {
    return this.db.query<R, SQLQueryBindings[]>(sql).all(...params);
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the row type the caller expects
  private get<R>(sql: string, ...params: SQLQueryBindings[]): R | null {
    return this.db.query<R, SQLQueryBindings[]>(sql).get(...params);
  }

  private run(sql: string, ...params: SQLQueryBindings[]): number {
    return this.db.query(sql).run(...params).changes;
  }

  // -- meta -------------------------------------------------------------------
  getMeta(key: string): unknown {
    const row = this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row ? JSON.parse(row.value) : null;
  }

  setMeta(key: string, value: unknown): void {
    this.run(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      key,
      JSON.stringify(value ?? null),
    );
  }

  private int(key: string): number {
    const v = this.getMeta(key);
    return typeof v === 'number' ? Math.trunc(v) : 0;
  }

  meta(): CatalogMeta {
    return catalogMeta(this.getMeta('catalog'));
  }

  writeMeta(patch: Partial<CatalogMeta>): CatalogMeta {
    const meta = { ...this.meta(), ...patch };
    this.setMeta('catalog', meta);
    return meta;
  }

  seq(): number {
    return this.int('seq');
  }

  // -- reading lots -------------------------------------------------------------
  /** The lots matching `where` (on lots as l), assembled from their rows. */
  private load(where = '', ...params: SQLQueryBindings[]): Map<number, Lot> {
    interface Row {
      id: number;
      period: string | null;
      title: string;
      number: string;
      cat: string | null;
      catLabel: string | null;
      cond: number | null;
      condLabel: string | null;
      loc: number | null;
      locName: string | null;
      transferable: number;
      fee: number | null;
      price: number | null;
      retail: number | null;
      ends: string | null;
      status: string | null;
      version: number | null;
      bids: number | null;
      increment: number | null;
      leading: number | null;
      maxBid: number | null;
      watched: number;
      hasBid: number;
      firstSeen: number | null;
      n: number;
      groupId: number | null;
    }
    const lots = new Map<number, Lot>();
    const rows = this.all<Row>(
      `SELECT l.id, l.auction_period AS period, l.title, l.lot_number AS number, l.category AS cat, c.label AS catLabel,
        l.condition AS cond, k.label AS condLabel, l.location AS loc, p.name AS locName, l.is_transferable AS transferable,
        l.transfer_fee AS fee, l.current_price AS price, l.estimated_retail_price AS retail, l.ends_at AS ends, l.status,
        l.version, l.bid_count AS bids, l.next_min_increment AS increment, l.is_leading AS leading, l.your_max_bid AS maxBid,
        l.is_watchlisted AS watched, l.has_bid AS hasBid, l.first_seen_at AS firstSeen, l.past_close_count AS n,
        l.group_id AS groupId
      FROM lots l LEFT JOIN categories c ON c.value = l.category LEFT JOIN conditions k ON k.value = l.condition
        LEFT JOIN locations p ON p.id = l.location ${where}`,
      ...params,
    );
    for (const r of rows) {
      const lot: Lot = {
        id: r.id,
        auction_period: r.period,
        title: r.title,
        lot_number: r.number,
        category: r.cat === null ? null : { value: r.cat, label: r.catLabel },
        condition: r.cond === null ? null : { value: r.cond, display_name: r.condLabel },
        location: r.loc === null ? null : { id: r.loc, name: r.locName },
        is_transferable: Boolean(r.transferable),
        transfer_fee: r.fee,
        current_price: r.price,
        estimated_retail_price: r.retail,
        ends_at: r.ends,
        status: r.status,
        version: r.version,
        bid_count: r.bids,
        next_min_increment: r.increment,
        your_standing:
          r.leading === null ? null : { is_leading: Boolean(r.leading), your_max_bid: r.maxBid },
        is_watchlisted: Boolean(r.watched),
        has_bid: Boolean(r.hasBid),
        images: [],
      };
      if (r.firstSeen !== null) {
        lot.firstSeenAt = r.firstSeen;
      }
      if (r.n) {
        lot.pastCloses = { n: r.n, recent: [] };
      }
      if (r.groupId !== null) {
        lot.groupId = r.groupId;
      }
      lots.set(r.id, lot);
    }
    if (!lots.size) {
      return lots;
    }
    const ids = `(SELECT l.id FROM lots l ${where})`;
    for (const { id, ...im } of this.all<LotImage & { id: number }>(
      `SELECT lot_id AS id, position, thumb AS image_thumb, card AS image_card, large AS image_large
        FROM lot_images WHERE lot_id IN ${ids} ORDER BY lot_id, position`,
      ...params,
    )) {
      lots.get(id)?.images?.push(im);
    }
    for (const c of this.all<{
      lotId: number;
      id: number;
      price: number | null;
      endsAt: number | null;
      condition: string | null;
      sold: number;
      final: number;
    }>(
      `SELECT r.lot_id AS lotId, c.id, c.price, c.ends_at AS endsAt, c.condition, c.sold, c.final FROM lot_past_closes r
        JOIN closed_lots c ON c.id = r.closed_id WHERE r.lot_id IN ${ids} ORDER BY r.lot_id, r.rank`,
      ...params,
    )) {
      lots.get(c.lotId)?.pastCloses?.recent.push({
        id: c.id,
        price: c.price,
        endsAt: c.endsAt,
        condition: c.condition,
        sold: Boolean(c.sold),
        final: c.final === 1,
      });
    }
    this.annotateItems(lots.values());
    return lots;
  }

  /** Every stored lot (used by a pull to merge with what it fetched). */
  allLots(): Map<number, Lot> {
    return this.load();
  }

  lot(id: number): Lot | null {
    return this.load('WHERE l.id = ?', id).get(id) ?? null;
  }

  // -- item identity, types and tags ----------------------------------------------
  private typeIndex(): ItemTypeIndex {
    this.typeIndexCache ??= new ItemTypeIndex(
      this.all<{
        title: string;
        type: string;
        category: string | null;
        at: number;
        manual: number;
        brand: string | null;
        model: string | null;
      }>(
        `SELECT title, type, category, at, manual, NULL AS brand, NULL AS model FROM item_types
         UNION ALL SELECT title, type, category, at, manual, brand, model FROM identity_item_types`,
      ).map(r => ({ ...r, manual: Boolean(r.manual) })),
    );
    return this.typeIndexCache;
  }

  private compiledRules(): CompiledRule[] {
    this.rulesCache ??= this.tagRules().map(r => new CompiledRule(r.pattern, r.tags));
    return this.rulesCache;
  }

  private changedTypes() {
    this.typeIndexCache = null;
  }

  private changedTags() {
    this.rulesCache = null;
  }

  /** Attach saved brand/model details (by `idField`), including to the site's closed-lot pages. */
  annotateIdentities<T extends object>(lots: Iterable<T>, idField: keyof T & string): void {
    const stmt = this.db.query<{ brand: string | null; model: string | null }, [number]>(
      'SELECT brand, model FROM lot_details WHERE lot_id = ?',
    );
    for (const lot of lots) {
      const id: unknown = lot[idField];
      const identity = typeof id === 'number' ? stmt.get(id) : null;
      if (identity) {
        Object.assign(lot, { brand: identity.brand, model: identity.model });
      }
    }
  }

  /**
   * Attach cached identities, item types and tags (before comparing a catalog pull, or reading
   * lots).
   */
  annotateItems(lots: Iterable<Item>): void {
    const list = [...lots];
    this.annotateIdentities(list, 'id');
    const index = this.typeIndex();
    const rules = this.compiledRules();
    for (const lot of list) {
      const record = index.match(lot);
      if (record) {
        lot.itemType = record.type;
      } else {
        delete lot.itemType;
      }
      const tags = rules.flatMap(rule => rule.tagsFor(lot.title) ?? []);
      if (tags.length) {
        lot.tags = uniqueTags(tags);
      } else {
        delete lot.tags;
      }
    }
  }

  private titles(): Item[] {
    const items = this.all<{ id: number; title: string }>('SELECT id, title FROM lots');
    this.annotateItems(items);
    return items;
  }

  private typeAssignments(): Map<number, string | null> {
    return new Map(this.titles().map(lot => [lot.id!, lot.itemType ?? null]));
  }

  private tagAssignments(): Map<number, string[] | null> {
    return new Map(this.titles().map(lot => [lot.id!, lot.tags ?? null]));
  }

  /** Give lots whose assignment changed a new sequence; returns their new values, by lot id. */
  private touchChanges<V>(previous: Map<number, V>, current: Map<number, V>): Map<number, V> {
    const changed = new Map(
      current.entries().filter(([i, v]) => !dequal(previous.get(i) ?? null, v)),
    );
    if (changed.size) {
      const seq = this.int('seq') + 1;
      const stmt = this.db.query('UPDATE lots SET seq = ? WHERE id = ?');
      for (const i of changed.keys()) {
        stmt.run(seq, i);
      }
      this.setMeta('seq', seq);
    }
    return changed;
  }

  // -- writing lots ----------------------------------------------------------------
  /** Store these lots under this sequence, replacing their old rows (in the caller's transaction). */
  private writeLots(lots: Lot[], seq: number): void {
    type Pick = (l: Lot) => [string | number, string | null] | null;
    const lookups: [string, string, string, Pick][] = [
      [
        'categories',
        'value',
        'label',
        l => (l.category ? [l.category.value, l.category.label ?? null] : null),
      ],
      [
        'conditions',
        'value',
        'label',
        l => (l.condition ? [l.condition.value, l.condition.display_name ?? null] : null),
      ],
      [
        'locations',
        'id',
        'name',
        l => (l.location ? [l.location.id, l.location.name ?? null] : null),
      ],
    ];
    for (const [table, key, label, pick] of lookups) {
      const stmt = this.db.query(
        `INSERT INTO ${table} (${key}, ${label}) VALUES (?, ?) ON CONFLICT (${key}) DO UPDATE SET ${label} = excluded.${label}`,
      );
      const seen = new Set<string>();
      for (const lot of lots) {
        const pair = pick(lot);
        if (pair && !seen.has(JSON.stringify(pair))) {
          seen.add(JSON.stringify(pair));
          stmt.run(...pair);
        }
      }
    }
    const delImages = this.db.query('DELETE FROM lot_images WHERE lot_id = ?');
    const delCloses = this.db.query('DELETE FROM lot_past_closes WHERE lot_id = ?');
    const insLot = this.db.query(
      `INSERT OR REPLACE INTO lots (${LOT_COLUMNS}) VALUES (${placeholders(24)})`,
    );
    const insImage = this.db.query(
      'INSERT INTO lot_images (lot_id, position, thumb, card, large) VALUES (?, ?, ?, ?, ?)',
    );
    const insClose = this.db.query(
      'INSERT INTO lot_past_closes (lot_id, rank, closed_id) VALUES (?, ?, ?)',
    );
    for (const lot of lots) {
      delImages.run(lot.id);
      delCloses.run(lot.id);
      insLot.run(...lotRow(lot, seq));
      for (const im of lot.images ?? []) {
        insImage.run(lot.id, im.position, im.image_thumb, im.image_card, im.image_large);
      }
      (lot.pastCloses?.recent ?? []).forEach((c, n) => insClose.run(lot.id, n, c.id));
    }
  }

  private deleteLots(ids: Iterable<number>): void {
    for (const id of ids) {
      this.run('DELETE FROM lot_images WHERE lot_id = ?', id);
      this.run('DELETE FROM lot_past_closes WHERE lot_id = ?', id);
      this.run('DELETE FROM lots WHERE id = ?', id);
    }
  }

  /**
   * Give the lots listing any of these closed lots among their past closes a new sequence (what
   * they show changed).
   */
  private touchCloses(closedIds: Iterable<number>): void {
    const seq = this.int('seq') + 1;
    let changes = 0;
    for (const id of closedIds) {
      changes += this.run(
        'UPDATE lots SET seq = ? WHERE id IN (SELECT lot_id FROM lot_past_closes WHERE closed_id = ?)',
        seq,
        id,
      );
    }
    if (changes) {
      this.setMeta('seq', seq);
    }
  }

  private bumpClosedRev(): void {
    this.setMeta('closedRev', this.int('closedRev') + 1);
  }

  /**
   * Store a full pull: changed lots get the next sequence, missing ones move to closed_lots.
   * Returns the sequence.
   */
  replaceAll(lots: Iterable<Lot>, meta: Partial<CatalogMeta> = {}): number {
    const old = this.load();
    let seq = this.int('seq');
    const fresh = new Map([...lots].map(lot => [lot.id, lot]));
    this.annotateItems(fresh.values());
    const changed = fresh
      .values()
      .filter(lot => !dequal(old.get(lot.id), lot))
      .toArray();
    const gone = old
      .keys()
      .filter(i => !fresh.has(i))
      .toArray();
    const back = fresh
      .keys()
      .filter(i => !old.has(i))
      .toArray(); // usually new, but may have been taken for closed
    this.tx(() => {
      if (changed.length || gone.length) {
        seq += 1;
        this.writeLots(changed, seq);
        this.deleteLots(gone);
        this.setMeta('seq', seq);
      }
      if (gone.length || back.length) {
        for (const i of back) {
          this.run('DELETE FROM closed_lots WHERE id = ?', i);
        }
        this.touchCloses(back);
        const ins = this.db.query(
          `INSERT OR REPLACE INTO closed_lots (${CLOSED_COLUMNS}) VALUES (${placeholders(12)})`,
        );
        for (const i of gone) {
          ins.run(...closedRow(old.get(i)!, 0));
        }
        this.bumpClosedRev();
      }
      this.setMeta('catalog', { ...this.meta(), ...meta });
    });
    return this.int('seq');
  }

  /** Lots changed after sequence `since` (all of them for 0) and the current id list. */
  changes(since: number): CatalogChanges {
    const seq = this.int('seq');
    const from = since > seq ? 0 : since; // the client saw a newer (since reset) database: send everything
    return {
      seq,
      lots: this.load('WHERE l.seq > ?', from).values().toArray(),
      ids: this.all<{ id: number }>('SELECT id FROM lots').map(r => r.id),
    };
  }

  /**
   * Let fn change every stored lot in place (it sees them all at once), giving the changed ones a
   * new sequence. Returns how many changed.
   */
  updateLots(fn: (lots: Lot[]) => void): number {
    const seq = this.int('seq') + 1;
    const old = this.load();
    const lots = structuredClone(old.values().toArray());
    fn(lots);
    const changed = lots.filter(lot => !dequal(lot, old.get(lot.id)));
    if (changed.length) {
      this.tx(() => {
        this.writeLots(changed, seq);
        this.setMeta('seq', seq);
      });
    }
    return changed.length;
  }

  // -- closed lots ---------------------------------------------------------------------
  /** Goes up whenever closed_lots changes. */
  closedRev(): number {
    return this.int('closedRev');
  }

  /** Every closed lot, with the brand and model saved for it. */
  closedLots(): ClosedLot[] {
    return this.all<Omit<ClosedLot, 'sold' | 'final'> & { sold: number; final: number }>(
      `SELECT c.id, c.title, c.auction_period AS auctionPeriod, c.ends_at AS endsAt, c.price, c.bid_count AS bidCount,
        c.sold, c.final, c.condition, c.location, c.category, c.retail, d.brand, d.model
      FROM closed_lots c LEFT JOIN lot_details d ON d.lot_id = c.id`,
    ).map(r => ({ ...r, sold: Boolean(r.sold), final: r.final === 1 }));
  }

  /**
   * Closed lots (ended before `now`, epoch ms) whose final price hasn't been asked for yet, oldest
   * first.
   */
  pendingCloses(nowMs: number): { id: number; auctionPeriod: string | null }[] {
    return this.all(
      'SELECT id, auction_period AS auctionPeriod FROM closed_lots WHERE final = 0 AND ends_at <= ? ORDER BY ends_at',
      nowMs,
    );
  }

  /** Record a closed lot's final state from the site, or with null, that the site no longer has it. */
  finishClose(id: number, lot: Lot | null): void {
    this.tx(() => {
      if (lot) {
        this.run(
          `INSERT OR REPLACE INTO closed_lots (${CLOSED_COLUMNS}) VALUES (${placeholders(12)})`,
          ...closedRow(lot, 1),
        );
        this.touchCloses([id]);
      } else {
        this.run('UPDATE closed_lots SET final = -1 WHERE id = ?', id);
      }
      this.bumpClosedRev();
    });
  }

  /** Forget a lot taken for closed that is still open. */
  dropClose(id: number): void {
    this.tx(() => {
      this.run('DELETE FROM closed_lots WHERE id = ?', id);
      this.touchCloses([id]);
      this.bumpClosedRev();
    });
  }

  // -- lot details ------------------------------------------------------------------------
  /** Open lots whose detail hasn't been fetched yet, ending soonest first. */
  pendingDetails(): { id: number; auctionPeriod: string }[] {
    return this.all(
      `SELECT l.id, l.auction_period AS auctionPeriod
       FROM lots l
       LEFT JOIN lot_details d ON d.lot_id = l.id
       WHERE d.lot_id IS NULL AND l.auction_period IS NOT NULL AND l.auction_period != ''
       ORDER BY l.ends_at, l.id`,
    );
  }

  /** Whether a lot's detail is already saved. */
  hasLotDetail(id: number): boolean {
    return this.get('SELECT 1 FROM lot_details WHERE lot_id = ?', id) !== null;
  }

  /** Keep a lot's detail (RawLotDetail in src/shared/lot.ts), replacing the one fetched before. */
  saveLotDetail(d: Detail): void {
    this.tx(() => {
      const previous = this.get<{ brand: string | null; model: string | null }>(
        'SELECT brand, model FROM lot_details WHERE lot_id = ?',
        d.id,
      );
      const brand = (d.brand ?? '').trim() || null;
      const model = (d.model ?? '').trim() || null;
      const changed = !previous || previous.brand !== brand || previous.model !== model;
      this.run(
        `INSERT OR REPLACE INTO lot_details (lot_id, auction_period, title, status, current_price, description, brand, model,
          lot_fee, bid_history, fetched_at, images) VALUES (${placeholders(12)})`,
        d.id,
        d.auction_period ?? null,
        d.title || '',
        d.status ?? null,
        d.current_price ?? null,
        d.description ?? null,
        brand,
        model,
        d.lot_fee ?? null,
        JSON.stringify(d.bid_history ?? []),
        Date.now(),
        d.images ? JSON.stringify(d.images.map(savedImage)) : null,
      );
      if (changed) {
        if (this.get('SELECT 1 FROM closed_lots WHERE id = ?', d.id)) {
          this.bumpClosedRev();
        }
        const seq = this.int('seq') + 1;
        if (this.run('UPDATE lots SET seq = ? WHERE id = ?', seq, d.id)) {
          this.setMeta('seq', seq);
        }
      }
    });
  }

  /** Saved item details only; never serve archived auction or account state as current. */
  lotMetadata(id: number, auctionPeriod: string): LotMetadata | null {
    const row = this.get<{
      description: string | null;
      brand: string | null;
      model: string | null;
      lot_fee: number | null;
      images: string | null;
    }>(
      `SELECT description, brand, model, lot_fee, images FROM lot_details
       WHERE lot_id = ? AND auction_period = ?`,
      id,
      auctionPeriod,
    );
    if (!row) {
      return null;
    }
    const metadata: LotMetadata = {
      description: row.description ?? '',
      brand: row.brand,
      model: row.model,
      lot_fee: row.lot_fee,
    };
    if (row.images !== null) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- saved by saveLotDetail
      metadata.images = (JSON.parse(row.images) as SavedImage[]).map(im => ({
        position: im.position,
        image_thumb: im.thumb,
        image_card: im.card,
        image_large: im.large,
      }));
    }
    return metadata;
  }

  // -- item types ----------------------------------------------------------------------------
  /** Stored lots without an item type. */
  untypedItems(): Lot[] {
    return this.load()
      .values()
      .filter(lot => !lot.itemType)
      .toArray();
  }

  /** The item types given most often to titles in a site category. */
  commonTypes(category: string | null, limit: number): string[] {
    return this.all<{ type: string }>(
      `SELECT type FROM (
         SELECT type, category FROM item_types UNION ALL SELECT type, category FROM identity_item_types
       ) WHERE category IS ? GROUP BY type ORDER BY count(*) DESC, type LIMIT ?`,
      category,
      limit,
    ).map(r => r.type);
  }

  /**
   * Persist identity-aware labels and touch only changed effective assignments; returns the new
   * types of the lots whose type changed, by lot id. Automatic labels never replace manual ones.
   */
  saveLotTypes(
    labels: Iterable<[Item, string]>,
    { manual = false } = {},
  ): Map<number, string | null> {
    return this.tx(() => {
      const previous = this.typeAssignments();
      const index = this.typeIndex();
      for (const [lot, label] of labels) {
        const record = index.match(lot);
        if (!manual && record?.manual) {
          continue;
        }
        const values = [
          lot.title,
          label,
          lot.category?.value ?? null,
          this.stamp(),
          manual ? 1 : 0,
        ];
        const identity = brandModelKey(lot);
        if (identity) {
          const [brand, model] = identity.split('\n');
          this.run(
            'INSERT OR REPLACE INTO identity_item_types (brand, model, title, type, category, at, manual) VALUES (?, ?, ?, ?, ?, ?, ?)',
            brand!,
            model!,
            ...values,
          );
        } else {
          this.run(
            'INSERT OR REPLACE INTO item_types (title, type, category, at, manual) VALUES (?, ?, ?, ?, ?)',
            ...values,
          );
        }
      }
      this.changedTypes();
      return this.touchChanges(previous, this.typeAssignments());
    });
  }

  // -- tags -------------------------------------------------------------------------------------
  /** Every tag rule, oldest first. */
  tagRules(): TagRule[] {
    return this.all<{ id: number; pattern: string; tags: string }>(
      'SELECT id, pattern, tags FROM tag_rules ORDER BY id',
    ).map(r => ({ id: r.id, pattern: r.pattern, tags: jsonList(r.tags) }));
  }

  /**
   * Tag every lot whose title matches `pattern`, now and in future pulls. Throws for an invalid
   * pattern or no tags. Returns the rule and the new tags of the lots that changed.
   */
  addTagRule(pattern: string, tags: Iterable<string>): [TagRule, Map<number, string[] | null>] {
    const cleaned = ruleTags(pattern, tags);
    return this.tx(() => {
      const previous = this.tagAssignments();
      const id = Number(
        this.db
          .query('INSERT INTO tag_rules (pattern, tags, at) VALUES (?, ?, ?)')
          .run(pattern, JSON.stringify(cleaned), now()).lastInsertRowid,
      );
      this.changedTags();
      return [{ id, pattern, tags: cleaned }, this.touchChanges(previous, this.tagAssignments())];
    });
  }

  /**
   * Change a tag rule's pattern and tags (checked as for addTagRule). Null when there is no such
   * rule.
   */
  updateTagRule(
    id: number,
    pattern: string,
    tags: Iterable<string>,
  ): [TagRule, Map<number, string[] | null>] | null {
    const cleaned = ruleTags(pattern, tags);
    return this.tx(() => {
      const previous = this.tagAssignments();
      if (
        !this.run(
          'UPDATE tag_rules SET pattern = ?, tags = ? WHERE id = ?',
          pattern,
          JSON.stringify(cleaned),
          id,
        )
      ) {
        return null;
      }
      this.changedTags();
      return [{ id, pattern, tags: cleaned }, this.touchChanges(previous, this.tagAssignments())];
    });
  }

  /**
   * Drop a tag rule. Returns the new tags of the lots that changed, or null when there is no such
   * rule.
   */
  removeTagRule(id: number): Map<number, string[] | null> | null {
    return this.tx(() => {
      const previous = this.tagAssignments();
      if (!this.run('DELETE FROM tag_rules WHERE id = ?', id)) {
        return null;
      }
      this.changedTags();
      return this.touchChanges(previous, this.tagAssignments());
    });
  }

  /**
   * Every rule with how many current lots it matches, and every tag in use (ignoring case, in its
   * most common spelling) with its lot count, commonest first.
   */
  tagOverview(): { rules: [TagRule, number][]; tags: [string, number][] } {
    const items = this.titles();
    const titles = new Map<string, number>();
    for (const lot of items) {
      titles.set(lot.title, (titles.get(lot.title) ?? 0) + 1);
    }
    const rules = this.tagRules().map((rule): [TagRule, number] => {
      const rx = compileTagPattern(rule.pattern);
      let n = 0;
      for (const [title, count] of titles) {
        if (rx.test(title)) {
          n += count;
        }
      }
      return [rule, n];
    });
    const spellings = new Map<string, Map<string, number>>(); // each tag's spellings, by tag key
    for (const lot of items) {
      for (const tag of lot.tags ?? []) {
        const counts = spellings.getOrInsertComputed(tag.toLowerCase(), () => new Map());
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const inUse = new Map<string, number>();
    for (const counts of spellings.values()) {
      const [spelling = ''] = mostCommon(counts)[0] ?? [];
      inUse.set(spelling, counts.values().sum());
    }
    return { rules, tags: mostCommon(inUse) };
  }

  /**
   * The current lots a pattern matches, one entry per distinct title (most lots first): an example
   * lot id, the lot count, where the pattern matched (in code points), the title's current tags,
   * and those of `tags` (with groups filled in) it doesn't have yet. Throws PatternError or
   * TagTemplateError for a bad rule.
   */
  previewTagRule(pattern: string, tags: Iterable<string>, limit: number) {
    const rule = new CompiledRule(pattern, cleanTags(tags));
    interface Match {
      title: string;
      lotId: number;
      lots: number;
      span: [number, number];
      tags: string[];
      adds: string[];
    }
    const groups = new Map<string, Match>();
    for (const lot of this.titles()) {
      const group = groups.get(lot.title);
      if (group) {
        group.lots += 1;
        continue;
      }
      const m = rule.rx.exec(lot.title);
      if (m) {
        const current = lot.tags ?? [];
        const have = current.map(toLower).toSet();
        // Code points, which the tags page counts in.
        const codePoints = (end: number) => Array.from(lot.title.slice(0, end)).length;
        groups.set(lot.title, {
          title: lot.title,
          lotId: lot.id!,
          lots: 1,
          span: [codePoints(m.index), codePoints(m.index + m[0].length)],
          tags: current,
          adds: (rule.tagsFor(lot.title) ?? []).filter(t => !have.has(t.toLowerCase())),
        });
      }
    }
    const ranked = groups
      .values()
      .toArray()
      .toSorted((a, b) => b.lots - a.lots || byCode(a.title.toLowerCase(), b.title.toLowerCase()));
    return {
      lots: ranked.sumBy(g => g.lots),
      titles: ranked.length,
      matches: ranked.slice(0, limit),
    };
  }

  // -- settings ------------------------------------------------------------------------------------
  /** The settings revision and every setting changed after `since`. */
  settings(since = 0): { rev: number; values: Record<string, unknown> } {
    const rev = this.int('settingsRev');
    const rows = this.all<{ key: string; value: string }>(
      'SELECT key, value FROM settings WHERE rev > ?',
      since > rev ? 0 : since,
    );
    return { rev, values: Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)])) };
  }

  setting(key: string): unknown {
    const row = this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return row ? JSON.parse(row.value) : undefined;
  }

  /** Save a setting (last write wins) and return the new settings revision. */
  putSetting(key: string, value: unknown): number {
    return this.tx(() => {
      const rev = this.int('settingsRev') + 1;
      this.run(
        'INSERT OR REPLACE INTO settings (key, value, rev) VALUES (?, ?, ?)',
        key,
        JSON.stringify(value),
        rev,
      );
      this.setMeta('settingsRev', rev);
      return rev;
    });
  }

  // -- app sessions --------------------------------------------------------------------------------
  addSession(id: string): void {
    this.run('INSERT INTO app_sessions (id, created) VALUES (?, ?)', id, now());
  }

  hasSession(id: string, maxAgeSeconds: number): boolean {
    const row = this.get<{ created: number }>('SELECT created FROM app_sessions WHERE id = ?', id);
    return row !== null && now() - row.created < maxAgeSeconds;
  }

  dropSession(id: string): void {
    this.run('DELETE FROM app_sessions WHERE id = ?', id);
  }
}

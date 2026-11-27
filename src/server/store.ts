// PostgreSQL storage (via Bun.SQL): the catalog, catalog meta, synced
// settings, the site login cookies, sessions of this app's own password login,
// item types, every lot that has left the catalog with its final price, and
// the last detail fetched for each lot (description, brand/model, bid
// history), kept after the lot closes.
//
// A lot is a row of `lots` with its site category, condition and location in
// lookup tables, its images in `lot_images`, its item type joined from
// `item_types` (by brand/model when known, or by title when identity is
// missing), and its most recent past closes in `lot_past_closes`, pointing at
// `closed_lots`. The store hands lots out, and takes them in, as one object
// each, in the shape the app gets them (ServerLot in src/app/server/api.ts).
//
// Every full pull that changes anything gets a new sequence number, and each
// lot row records the sequence of its last change, so a client that has seen
// sequence N only needs the rows with seq > N (plus the current id list, to
// drop lots that are gone). Changes are found by comparing lots as a whole, so
// a lot read back must equal the one stored: optional fields are left out, not
// set to undefined.
import { SQL } from 'bun';
import { dequal } from 'dequal';

import { brandModelKey, ItemTypeIndex } from '../shared/identity';
import { type HiddenLot, KEYS } from '../shared/keys';
import {
  endsAtMs,
  type LotImage,
  type LotMetadata,
  parseLotDescription,
  type PastClose,
} from '../shared/lot';
import { isRecord } from './json';

export const DEFAULT_DB_URL = 'postgres://localhost:5432/tlx';

const SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS categories (value TEXT PRIMARY KEY, label TEXT)',
  'CREATE TABLE IF NOT EXISTS conditions (value INTEGER PRIMARY KEY, label TEXT)',
  'CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT)',
  `CREATE TABLE IF NOT EXISTS lots (
    id BIGINT PRIMARY KEY, seq BIGINT NOT NULL, auction_period TEXT, title TEXT NOT NULL, lot_number TEXT NOT NULL,
    category TEXT REFERENCES categories(value), condition INTEGER REFERENCES conditions(value), location INTEGER REFERENCES locations(id),
    is_transferable BOOLEAN NOT NULL, transfer_fee DOUBLE PRECISION, current_price DOUBLE PRECISION, estimated_retail_price DOUBLE PRECISION,
    ends_at TEXT, status TEXT, version INTEGER, bid_count INTEGER, next_min_increment DOUBLE PRECISION,
    is_leading BOOLEAN, your_max_bid DOUBLE PRECISION, is_watchlisted BOOLEAN NOT NULL, has_bid BOOLEAN NOT NULL,
    first_seen_at BIGINT, past_close_count INTEGER NOT NULL DEFAULT 0, group_id BIGINT
  )`,
  'CREATE INDEX IF NOT EXISTS lots_seq ON lots (seq)',
  'CREATE INDEX IF NOT EXISTS lots_title ON lots (title)',
  `CREATE TABLE IF NOT EXISTS lot_images (
    lot_id BIGINT NOT NULL REFERENCES lots(id), position INTEGER NOT NULL, thumb TEXT, card TEXT, large TEXT,
    PRIMARY KEY (lot_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS lot_past_closes (
    lot_id BIGINT NOT NULL REFERENCES lots(id), rank INTEGER NOT NULL, closed_id BIGINT NOT NULL,
    PRIMARY KEY (lot_id, rank)
  )`,
  'CREATE INDEX IF NOT EXISTS lot_past_closes_closed ON lot_past_closes (closed_id)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS filter_types (type TEXT PRIMARY KEY)',
  `CREATE TABLE IF NOT EXISTS hidden_lots (
    lot_id BIGINT PRIMARY KEY, ts BIGINT NOT NULL
  )`,
  'ALTER TABLE hidden_lots DROP COLUMN IF EXISTS href',
  'ALTER TABLE hidden_lots DROP COLUMN IF EXISTS title',
  'CREATE TABLE IF NOT EXISTS app_sessions (id TEXT PRIMARY KEY, created DOUBLE PRECISION NOT NULL)',
  `CREATE TABLE IF NOT EXISTS item_types (
    brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
    type TEXT NOT NULL, category TEXT, at DOUBLE PRECISION NOT NULL, manual BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (brand, model, title)
  )`,
  'CREATE INDEX IF NOT EXISTS item_types_category ON item_types (category)',
  `CREATE TABLE IF NOT EXISTS closed_lots (
    id BIGINT PRIMARY KEY, title TEXT NOT NULL, auction_period TEXT, ends_at BIGINT, price DOUBLE PRECISION, bid_count INTEGER,
    sold BOOLEAN NOT NULL, final INTEGER NOT NULL, condition TEXT, location TEXT, category TEXT, retail DOUBLE PRECISION
  )`,
  'CREATE INDEX IF NOT EXISTS closed_lots_pending ON closed_lots (final, ends_at)',
  `CREATE TABLE IF NOT EXISTS lot_details (
    lot_id BIGINT PRIMARY KEY, auction_period TEXT, title TEXT NOT NULL, status TEXT, current_price DOUBLE PRECISION, description TEXT,
    quantity INTEGER, brand TEXT, model TEXT, lot_fee DOUBLE PRECISION, bid_history TEXT NOT NULL, fetched_at BIGINT NOT NULL
  )`,
  'ALTER TABLE lot_details ADD COLUMN IF NOT EXISTS quantity INTEGER',
  'ALTER TABLE lot_details DROP COLUMN IF EXISTS images',
];

// lots: ends_at is the site's ISO 8601 text; is_leading and your_max_bid are
// null without a standing; past_close_count counts every matching closed lot,
// lot_past_closes holds the most recent few; group_id is the smallest id of
// the open lots listing the same item (null when no other does; see groupLots
// in src/shared/identity.ts).
const LOT_COLUMNS =
  'id, seq, auction_period, title, lot_number, category, condition, location, is_transferable, transfer_fee, current_price, ' +
  'estimated_retail_price, ends_at, status, version, bid_count, next_min_increment, is_leading, your_max_bid, is_watchlisted, ' +
  'has_bid, first_seen_at, past_close_count, group_id';
const LOT_UPDATE_SET = [
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
]
  .map(col => `${col} = EXCLUDED.${col}`)
  .join(', ');

// closed_lots.final: the price is the site's final one (1), the last one a pull saw
// and the site no longer has the lot (-1), or the last one seen, to be asked for (0).
const CLOSED_COLUMNS =
  'id, title, auction_period, ends_at, price, bid_count, sold, final, condition, location, category, retail';
const CLOSED_UPDATE_SET = [
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
]
  .map(col => `${col} = EXCLUDED.${col}`)
  .join(', ');

const SCHEMA_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BATCH_SIZE = 500;

type Queryable = Pick<SQL, 'unsafe'>;
type Param = string | number | boolean | null | number[] | string[];

/** Bun.SQL returns BIGINT values as strings; convert back to JS number. */
const toInt = (v: string | number): number => Number(v);
const toOptInt = (v: string | number | null): number | null => (v === null ? null : Number(v));

function parseHiddenLots(value: unknown): [number, HiddenLot][] {
  if (!isRecord(value)) {
    return [];
  }
  const entries: [number, HiddenLot][] = [];
  for (const [k, v] of Object.entries(value)) {
    const id = Number(k);
    if (!/^\d+$/.test(k) || !Number.isInteger(id) || id <= 0 || !isRecord(v)) {
      continue;
    }
    const { ts } = v;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      continue;
    }
    entries.push([id, { ts: Math.trunc(ts) }]);
  }
  return entries;
}

/** Build multi-row VALUES placeholders: `($1, $2), ($3, $4)` for `rows` rows of `cols` columns. */
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

/**
 * A closed lot in full (`closedLots`, GET /api/history): a PastClose whose price and endsAt columns
 * are nullable.
 */
export interface ClosedLot extends Omit<PastClose, 'price' | 'endsAt'> {
  price: number | null;
  endsAt: number | null;
  title: string;
  auctionPeriod: string | null;
  bidCount: number | null;
  location: string | null;
  category: string | null;
  retail: number | null;
  brand: string | null;
  model: string | null;
}

/** Something with a title, and maybe an id and identity: what item types are looked up by. */
export interface Item {
  id?: number;
  title: string;
  brand?: Nullable<string>;
  model?: Nullable<string>;
  description?: Nullable<string>;
  category?: { value: string; label?: string | null } | null | undefined;
  itemType?: string | undefined;
}

/** A lot detail as saved (RawLotDetail in src/shared/lot.ts; tests may leave fields out). */
export interface Detail {
  id: number;
  auction_period?: string | null;
  title?: string;
  status?: string | null;
  current_price?: number | null;
  description?: Nullable<string>;
  brand?: Nullable<string>;
  model?: Nullable<string>;
  lot_fee?: number | null;
  bid_history?: unknown[];
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
function lotRow(lot: Lot, seq: number): Param[] {
  const s = lot.your_standing;
  return [
    lot.id,
    seq,
    lot.auction_period,
    lot.title,
    lot.lot_number,
    lot.category.value,
    lot.condition.value,
    lot.location.id,
    lot.is_transferable,
    lot.transfer_fee,
    lot.current_price,
    lot.estimated_retail_price,
    lot.ends_at,
    lot.status,
    lot.version,
    lot.bid_count,
    lot.next_min_increment,
    s ? s.is_leading : null,
    s ? s.your_max_bid : null,
    lot.is_watchlisted,
    lot.has_bid,
    lot.firstSeenAt ?? null,
    lot.pastCloses?.n ?? 0,
    lot.groupId ?? null,
  ];
}

/**
 * A lot as a closed_lots row (CLOSED_COLUMNS order). Until the final price is known, a lot with
 * bids counts as sold.
 */
function closedRow(lot: Lot, final: number): Param[] {
  const sold = final === 1 ? lot.status === 'sold' : lot.bid_count > 0;
  return [
    lot.id,
    lot.title,
    lot.auction_period,
    endsAtColumn(lot),
    lot.current_price,
    lot.bid_count,
    sold,
    final,
    lot.condition.display_name,
    lot.location.name,
    lot.category.value,
    lot.estimated_retail_price,
  ];
}

export interface StoreOptions {
  /** Isolate tables in a dedicated Postgres schema (used by tests). */
  schema?: string;
}

export class Store {
  readonly sql: SQL;
  // Indexes rebuilt only after their tables change (this process makes every change).
  private typeIndexCache: ItemTypeIndex | null = null;
  private lastStamp = 0;

  private constructor(sql: SQL) {
    this.sql = sql;
  }

  /** Connect to PostgreSQL, ensure the schema exists, and run one-time migrations. */
  static async open(url = DEFAULT_DB_URL, options: StoreOptions = {}): Promise<Store> {
    const schema = options.schema;
    if (schema !== undefined && !SCHEMA_IDENT.test(schema)) {
      throw new Error(`Invalid Postgres schema name: ${schema}`);
    }
    const sql = schema ? new SQL({ url, max: 1 }) : new SQL(url);
    const store = new Store(sql);
    try {
      if (schema) {
        await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        await sql.unsafe(`SET search_path TO "${schema}"`);
      }
      for (const stmt of SCHEMA_STATEMENTS) {
        await sql.unsafe(stmt);
      }
      await store.migrateFilterTypes();
      await store.migrateHiddenLots();
      return store;
    } catch (e) {
      await sql.close();
      throw e;
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

  async close(): Promise<void> {
    await this.sql.close();
  }

  private async tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.sql.begin(tx => fn(tx));
  }

  private async all<R>(sql: string, params: Param[] = [], q: Queryable = this.sql): Promise<R[]> {
    const rows: unknown = await q.unsafe(sql, params);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller supplies the expected row shape
    return rows as R[];
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the row type the caller expects
  private async get<R>(
    sql: string,
    params: Param[] = [],
    q: Queryable = this.sql,
  ): Promise<R | null> {
    const rows = await this.all<R>(sql, params, q);
    return rows[0] ?? null;
  }

  private async run(sql: string, params: Param[] = [], q: Queryable = this.sql): Promise<number> {
    const res = await q.unsafe(sql, params);
    return res.count;
  }

  // -- meta -------------------------------------------------------------------
  async getMeta(key: string, q: Queryable = this.sql): Promise<unknown> {
    const row = await this.get<{ value: string }>(
      'SELECT value FROM meta WHERE key = $1',
      [key],
      q,
    );
    return row ? JSON.parse(row.value) : null;
  }

  async setMeta(key: string, value: unknown, q: Queryable = this.sql): Promise<void> {
    await this.run(
      'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value ?? null)],
      q,
    );
  }

  private async int(key: string, q: Queryable = this.sql): Promise<number> {
    const v = await this.getMeta(key, q);
    return typeof v === 'number' ? Math.trunc(v) : 0;
  }

  async meta(q: Queryable = this.sql): Promise<CatalogMeta> {
    return catalogMeta(await this.getMeta('catalog', q));
  }

  async writeMeta(patch: Partial<CatalogMeta>): Promise<CatalogMeta> {
    const meta = { ...(await this.meta()), ...patch };
    await this.setMeta('catalog', meta);
    return meta;
  }

  async seq(): Promise<number> {
    return this.int('seq');
  }

  // -- reading lots -------------------------------------------------------------
  /** The lots matching `where` (on lots as l), assembled from their rows. */
  private async load(
    where = '',
    params: Param[] = [],
    q: Queryable = this.sql,
  ): Promise<Map<number, Lot>> {
    interface Row {
      id: string | number;
      period: string | null;
      title: string;
      number: string;
      cat: string | null;
      catLabel: string | null;
      cond: number | null;
      condLabel: string | null;
      loc: number | null;
      locName: string | null;
      transferable: boolean;
      fee: number | null;
      price: number | null;
      retail: number | null;
      ends: string | null;
      status: string | null;
      version: number | null;
      bids: number | null;
      increment: number | null;
      leading: boolean | null;
      maxBid: number | null;
      watched: boolean;
      hasBid: boolean;
      firstSeen: string | number | null;
      n: number;
      groupId: string | number | null;
    }
    const lots = new Map<number, Lot>();
    const rows = await this.all<Row>(
      `SELECT l.id, l.auction_period AS period, l.title, l.lot_number AS number, l.category AS cat, c.label AS "catLabel",
        l.condition AS cond, k.label AS "condLabel", l.location AS loc, p.name AS "locName", l.is_transferable AS transferable,
        l.transfer_fee AS fee, l.current_price AS price, l.estimated_retail_price AS retail, l.ends_at AS ends, l.status,
        l.version, l.bid_count AS bids, l.next_min_increment AS increment, l.is_leading AS leading, l.your_max_bid AS "maxBid",
        l.is_watchlisted AS watched, l.has_bid AS "hasBid", l.first_seen_at AS "firstSeen", l.past_close_count AS n,
        l.group_id AS "groupId"
      FROM lots l LEFT JOIN categories c ON c.value = l.category LEFT JOIN conditions k ON k.value = l.condition
        LEFT JOIN locations p ON p.id = l.location ${where}`,
      params,
      q,
    );
    for (const r of rows) {
      const id = toInt(r.id);
      // The columns are nullable, but every row was written (lotRow) from a complete site lot.
      const lot: Lot = {
        id,
        auction_period: r.period!,
        title: r.title,
        lot_number: r.number,
        category: { value: r.cat!, label: r.catLabel! },
        condition: { value: r.cond!, display_name: r.condLabel! },
        location: { id: r.loc!, name: r.locName! },
        is_transferable: r.transferable,
        transfer_fee: r.fee!,
        current_price: r.price!,
        estimated_retail_price: r.retail!,
        ends_at: r.ends!,
        status: r.status!,
        version: r.version!,
        bid_count: r.bids!,
        next_min_increment: r.increment!,
        your_standing:
          r.leading === null ? null : { is_leading: r.leading, your_max_bid: r.maxBid },
        is_watchlisted: r.watched,
        has_bid: r.hasBid,
        images: [],
      };
      if (r.firstSeen !== null) {
        lot.firstSeenAt = toInt(r.firstSeen);
      }
      if (r.n) {
        lot.pastCloses = { n: r.n, recent: [] };
      }
      if (r.groupId !== null) {
        lot.groupId = toInt(r.groupId);
      }
      lots.set(id, lot);
    }
    if (!lots.size) {
      return lots;
    }
    const lotIds = [...lots.keys()];
    for (const { id, ...im } of await this.all<LotImage & { id: string | number }>(
      `SELECT lot_id AS id, position, thumb AS image_thumb, card AS image_card, large AS image_large
        FROM lot_images WHERE lot_id = ANY($1::bigint[]) ORDER BY lot_id, position`,
      [lotIds],
      q,
    )) {
      lots.get(toInt(id))?.images.push(im);
    }
    for (const c of await this.all<{
      lotId: string | number;
      id: string | number;
      price: number | null;
      endsAt: string | number | null;
      condition: string | null;
      sold: boolean;
      final: number;
    }>(
      `SELECT r.lot_id AS "lotId", c.id, c.price, c.ends_at AS "endsAt", c.condition, c.sold, c.final FROM lot_past_closes r
        JOIN closed_lots c ON c.id = r.closed_id WHERE r.lot_id = ANY($1::bigint[]) ORDER BY r.lot_id, r.rank`,
      [lotIds],
      q,
    )) {
      // price and endsAt are set on every closed lot (closedRow), though their columns are nullable.
      lots.get(toInt(c.lotId))?.pastCloses?.recent.push({
        id: toInt(c.id),
        price: c.price!,
        endsAt: toOptInt(c.endsAt)!,
        condition: c.condition,
        sold: c.sold,
        final: c.final === 1,
      });
    }
    await this.annotateItems(lots.values(), q);
    return lots;
  }

  /** Every stored lot (used by a pull to merge with what it fetched). */
  async allLots(): Promise<Map<number, Lot>> {
    return this.load();
  }

  async lot(id: number): Promise<Lot | null> {
    return (await this.load('WHERE l.id = $1', [id])).get(id) ?? null;
  }

  // -- item identity, types and tags ----------------------------------------------
  private async typeIndex(q: Queryable = this.sql): Promise<ItemTypeIndex> {
    if (!this.typeIndexCache) {
      const rows = await this.all<{
        title: string;
        type: string;
        category: string | null;
        at: number;
        manual: boolean;
        brand: string;
        model: string;
      }>('SELECT title, type, category, at, manual, brand, model FROM item_types', [], q);
      this.typeIndexCache = new ItemTypeIndex(rows);
    }
    return this.typeIndexCache;
  }

  private changedTypes() {
    this.typeIndexCache = null;
  }

  /** Attach saved brand/model details (by `idField`), including to the site's closed-lot pages. */
  async annotateIdentities<T extends object>(
    lots: Iterable<T>,
    idField: keyof T & string,
    q: Queryable = this.sql,
  ): Promise<void> {
    const list = [...lots];
    const ids: number[] = [];
    for (const lot of list) {
      const id: unknown = lot[idField];
      if (typeof id === 'number') {
        ids.push(id);
      }
    }
    if (!ids.length) {
      return;
    }
    const rows = await this.all<{
      lotId: string | number;
      brand: string | null;
      model: string | null;
    }>(
      'SELECT lot_id AS "lotId", brand, model FROM lot_details WHERE lot_id = ANY($1::bigint[])',
      [ids],
      q,
    );
    const byId = new Map(rows.map(r => [toInt(r.lotId), { brand: r.brand, model: r.model }]));
    for (const lot of list) {
      const id: unknown = lot[idField];
      const identity = typeof id === 'number' ? byId.get(id) : undefined;
      if (identity) {
        Object.assign(lot, identity);
      }
    }
  }

  /**
   * Attach cached details (brand, model, description) and item types (before comparing a catalog
   * pull, or reading lots).
   */
  async annotateItems(lots: Iterable<Item>, q: Queryable = this.sql): Promise<void> {
    const list = [...lots];
    const ids = list.map(lot => lot.id).filter((id): id is number => typeof id === 'number');
    if (ids.length) {
      const rows = await this.all<{
        lotId: string | number;
        brand: string | null;
        model: string | null;
        description: string | null;
      }>(
        'SELECT lot_id AS "lotId", brand, model, description FROM lot_details WHERE lot_id = ANY($1::bigint[])',
        [ids],
        q,
      );
      const byId = new Map(
        rows.map(r => [
          toInt(r.lotId),
          { brand: r.brand, model: r.model, description: r.description },
        ]),
      );
      for (const lot of list) {
        const detail = typeof lot.id === 'number' ? byId.get(lot.id) : undefined;
        if (detail) {
          Object.assign(lot, detail);
        }
      }
    }
    const index = await this.typeIndex(q);
    for (const lot of list) {
      const record = index.match(lot);
      if (record) {
        lot.itemType = record.type;
      } else {
        delete lot.itemType;
      }
    }
  }

  private async titles(q: Queryable = this.sql): Promise<Item[]> {
    const items = (
      await this.all<{ id: string | number; title: string }>('SELECT id, title FROM lots', [], q)
    ).map(r => ({ id: toInt(r.id), title: r.title }));
    await this.annotateItems(items, q);
    return items;
  }

  private async typeAssignments(q: Queryable = this.sql): Promise<Map<number, string | null>> {
    return new Map((await this.titles(q)).map(lot => [lot.id!, lot.itemType ?? null]));
  }

  /** Give lots whose assignment changed a new sequence; returns their new values, by lot id. */
  private async touchChanges<V>(
    previous: Map<number, V>,
    current: Map<number, V>,
    q: Queryable,
  ): Promise<Map<number, V>> {
    const changed = new Map(
      current.entries().filter(([i, v]) => !dequal(previous.get(i) ?? null, v)),
    );
    if (changed.size) {
      const seq = (await this.int('seq', q)) + 1;
      await this.run(
        'UPDATE lots SET seq = $1 WHERE id = ANY($2::bigint[])',
        [seq, [...changed.keys()]],
        q,
      );
      await this.setMeta('seq', seq, q);
    }
    return changed;
  }

  // -- writing lots ----------------------------------------------------------------
  /** Store these lots under this sequence, replacing their old rows (in the caller's transaction). */
  private async writeLots(lots: Lot[], seq: number, q: Queryable): Promise<void> {
    if (!lots.length) {
      return;
    }
    type Pick = (l: Lot) => [string | number, string];
    const lookups: [string, string, string, Pick][] = [
      ['categories', 'value', 'label', l => [l.category.value, l.category.label]],
      ['conditions', 'value', 'label', l => [l.condition.value, l.condition.display_name]],
      ['locations', 'id', 'name', l => [l.location.id, l.location.name]],
    ];
    for (const [table, key, label, pick] of lookups) {
      const pairs = new Map<string | number, string>();
      for (const lot of lots) {
        const [k, v] = pick(lot);
        pairs.set(k, v);
      }
      const entries = [...pairs.entries()];
      if (entries.length) {
        const params: Param[] = entries.flat();
        await this.run(
          `INSERT INTO ${table} (${key}, ${label}) VALUES ${valuePlaceholders(entries.length, 2)} ON CONFLICT (${key}) DO UPDATE SET ${label} = EXCLUDED.${label}`,
          params,
          q,
        );
      }
    }

    const lotIds = lots.map(l => l.id);
    await this.run('DELETE FROM lot_images WHERE lot_id = ANY($1::bigint[])', [lotIds], q);
    await this.run('DELETE FROM lot_past_closes WHERE lot_id = ANY($1::bigint[])', [lotIds], q);

    for (let i = 0; i < lots.length; i += BATCH_SIZE) {
      const chunk = lots.slice(i, i + BATCH_SIZE);
      const params: Param[] = chunk.flatMap(lot => lotRow(lot, seq));
      await this.run(
        `INSERT INTO lots (${LOT_COLUMNS}) VALUES ${valuePlaceholders(chunk.length, 24)} ON CONFLICT (id) DO UPDATE SET ${LOT_UPDATE_SET}`,
        params,
        q,
      );
    }

    const imageRows: Param[][] = [];
    const closeRows: Param[][] = [];
    for (const lot of lots) {
      for (const im of lot.images) {
        imageRows.push([lot.id, im.position, im.image_thumb, im.image_card, im.image_large]);
      }
      (lot.pastCloses?.recent ?? []).forEach((c, n) => closeRows.push([lot.id, n, c.id]));
    }
    for (let i = 0; i < imageRows.length; i += BATCH_SIZE) {
      const chunk = imageRows.slice(i, i + BATCH_SIZE);
      await this.run(
        `INSERT INTO lot_images (lot_id, position, thumb, card, large) VALUES ${valuePlaceholders(chunk.length, 5)}`,
        chunk.flat(),
        q,
      );
    }
    for (let i = 0; i < closeRows.length; i += BATCH_SIZE) {
      const chunk = closeRows.slice(i, i + BATCH_SIZE);
      await this.run(
        `INSERT INTO lot_past_closes (lot_id, rank, closed_id) VALUES ${valuePlaceholders(chunk.length, 3)}`,
        chunk.flat(),
        q,
      );
    }
  }

  private async deleteLots(ids: number[], q: Queryable): Promise<void> {
    if (!ids.length) {
      return;
    }
    await this.run('DELETE FROM lot_images WHERE lot_id = ANY($1::bigint[])', [ids], q);
    await this.run('DELETE FROM lot_past_closes WHERE lot_id = ANY($1::bigint[])', [ids], q);
    await this.run('DELETE FROM lots WHERE id = ANY($1::bigint[])', [ids], q);
  }

  /**
   * Give the lots listing any of these closed lots among their past closes a new sequence (what
   * they show changed).
   */
  private async touchCloses(closedIds: number[], q: Queryable): Promise<void> {
    if (!closedIds.length) {
      return;
    }
    const seq = (await this.int('seq', q)) + 1;
    const changes = await this.run(
      'UPDATE lots SET seq = $1 WHERE id IN (SELECT lot_id FROM lot_past_closes WHERE closed_id = ANY($2::bigint[]))',
      [seq, closedIds],
      q,
    );
    if (changes) {
      await this.setMeta('seq', seq, q);
    }
  }

  private async bumpClosedRev(q: Queryable): Promise<void> {
    await this.setMeta('closedRev', (await this.int('closedRev', q)) + 1, q);
  }

  /**
   * Store a full pull: changed lots get the next sequence, missing ones move to closed_lots.
   * Returns the sequence.
   */
  async replaceAll(lots: Iterable<Lot>, meta: Partial<CatalogMeta> = {}): Promise<number> {
    const old = await this.load();
    let seq = await this.int('seq');
    const fresh = new Map(Iterator.from(lots).map(lot => [lot.id, lot]));
    await this.annotateItems(fresh.values());
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
    return this.tx(async tx => {
      if (changed.length || gone.length) {
        seq += 1;
        await this.writeLots(changed, seq, tx);
        await this.deleteLots(gone, tx);
        await this.setMeta('seq', seq, tx);
      }
      if (gone.length || back.length) {
        if (back.length) {
          await this.run('DELETE FROM closed_lots WHERE id = ANY($1::bigint[])', [back], tx);
          await this.touchCloses(back, tx);
        }
        for (let i = 0; i < gone.length; i += BATCH_SIZE) {
          const chunk = gone.slice(i, i + BATCH_SIZE);
          const params = chunk.flatMap(id => closedRow(old.get(id)!, 0));
          await this.run(
            `INSERT INTO closed_lots (${CLOSED_COLUMNS}) VALUES ${valuePlaceholders(chunk.length, 12)} ON CONFLICT (id) DO UPDATE SET ${CLOSED_UPDATE_SET}`,
            params,
            tx,
          );
        }
        await this.bumpClosedRev(tx);
      }
      await this.setMeta('catalog', { ...(await this.meta(tx)), ...meta }, tx);
      return this.int('seq', tx);
    });
  }

  /** Lots changed after sequence `since` (all of them for 0) and the current id list. */
  async changes(since: number): Promise<CatalogChanges> {
    const seq = await this.int('seq');
    const from = since > seq ? 0 : since; // the client saw a newer (since reset) database: send everything
    return {
      seq,
      lots: (await this.load('WHERE l.seq > $1', [from])).values().toArray(),
      ids: (await this.all<{ id: string | number }>('SELECT id FROM lots')).map(r => toInt(r.id)),
    };
  }

  /**
   * Let fn change every stored lot in place (it sees them all at once), giving the changed ones a
   * new sequence. Returns how many changed.
   */
  async updateLots(fn: (lots: Lot[]) => void): Promise<number> {
    const seq = (await this.int('seq')) + 1;
    const old = await this.load();
    const lots = old
      .values()
      .map(lot => structuredClone(lot))
      .toArray();
    fn(lots);
    const changed = lots.filter(lot => !dequal(lot, old.get(lot.id)));
    if (changed.length) {
      await this.tx(async tx => {
        await this.writeLots(changed, seq, tx);
        await this.setMeta('seq', seq, tx);
      });
    }
    return changed.length;
  }

  // -- closed lots ---------------------------------------------------------------------
  /** Goes up whenever closed_lots changes. */
  async closedRev(): Promise<number> {
    return this.int('closedRev');
  }

  /** Every closed lot, with the brand and model saved for it. */
  async closedLots(): Promise<ClosedLot[]> {
    return (
      await this.all<{
        id: string | number;
        title: string;
        auctionPeriod: string | null;
        endsAt: string | number | null;
        price: number | null;
        bidCount: number | null;
        sold: boolean;
        final: number;
        condition: string | null;
        location: string | null;
        category: string | null;
        retail: number | null;
        brand: string | null;
        model: string | null;
      }>(
        `SELECT c.id, c.title, c.auction_period AS "auctionPeriod", c.ends_at AS "endsAt", c.price, c.bid_count AS "bidCount",
          c.sold, c.final, c.condition, c.location, c.category, c.retail, d.brand, d.model
        FROM closed_lots c LEFT JOIN lot_details d ON d.lot_id = c.id`,
      )
    ).map(r => ({
      ...r,
      id: toInt(r.id),
      endsAt: toOptInt(r.endsAt),
      final: r.final === 1,
    }));
  }

  /**
   * Closed lots (ended before `now`, epoch ms) whose final price hasn't been asked for yet, oldest
   * first.
   */
  async pendingCloses(nowMs: number): Promise<{ id: number; auctionPeriod: string | null }[]> {
    return (
      await this.all<{ id: string | number; auctionPeriod: string | null }>(
        'SELECT id, auction_period AS "auctionPeriod" FROM closed_lots WHERE final = 0 AND ends_at <= $1 ORDER BY ends_at',
        [nowMs],
      )
    ).map(r => ({ id: toInt(r.id), auctionPeriod: r.auctionPeriod }));
  }

  /** Record a closed lot's final state from the site, or with null, that the site no longer has it. */
  async finishClose(id: number, lot: Lot | null): Promise<void> {
    await this.tx(async tx => {
      if (lot) {
        await this.run(
          `INSERT INTO closed_lots (${CLOSED_COLUMNS}) VALUES ${valuePlaceholders(1, 12)} ON CONFLICT (id) DO UPDATE SET ${CLOSED_UPDATE_SET}`,
          closedRow(lot, 1),
          tx,
        );
        await this.touchCloses([id], tx);
      } else {
        await this.run('UPDATE closed_lots SET final = -1 WHERE id = $1', [id], tx);
      }
      await this.bumpClosedRev(tx);
    });
  }

  /** Forget a lot taken for closed that is still open. */
  async dropClose(id: number): Promise<void> {
    await this.tx(async tx => {
      await this.run('DELETE FROM closed_lots WHERE id = $1', [id], tx);
      await this.touchCloses([id], tx);
      await this.bumpClosedRev(tx);
    });
  }

  // -- lot details ------------------------------------------------------------------------
  /** Open lots whose detail hasn't been fetched yet, ending soonest first. */
  async pendingDetails(): Promise<{ id: number; auctionPeriod: string }[]> {
    return (
      await this.all<{ id: string | number; auctionPeriod: string }>(
        `SELECT l.id, l.auction_period AS "auctionPeriod"
         FROM lots l
         LEFT JOIN lot_details d ON d.lot_id = l.id
         WHERE d.lot_id IS NULL AND l.auction_period IS NOT NULL AND l.auction_period != ''
         ORDER BY l.ends_at, l.id`,
      )
    ).map(r => ({ id: toInt(r.id), auctionPeriod: r.auctionPeriod }));
  }

  /** Whether a lot's detail is already saved. */
  async hasLotDetail(id: number): Promise<boolean> {
    return (await this.get('SELECT 1 FROM lot_details WHERE lot_id = $1', [id])) !== null;
  }

  /** Keep a lot's detail (RawLotDetail in src/shared/lot.ts), replacing the one fetched before. */
  async saveLotDetail(d: Detail): Promise<void> {
    await this.tx(async tx => {
      const previous = await this.get<{
        brand: string | null;
        model: string | null;
        description: string | null;
      }>('SELECT brand, model, description FROM lot_details WHERE lot_id = $1', [d.id], tx);
      const brand = (d.brand ?? '').trim() || null;
      const model = (d.model ?? '').trim() || null;
      const { description, quantity } = parseLotDescription(d.description);
      const identityChanged = !previous || previous.brand !== brand || previous.model !== model;
      const catalogChanged = identityChanged || previous.description !== description;
      await this.run(
        `INSERT INTO lot_details (lot_id, auction_period, title, status, current_price, description, quantity, brand, model,
          lot_fee, bid_history, fetched_at) VALUES ${valuePlaceholders(1, 12)}
         ON CONFLICT (lot_id) DO UPDATE SET
          auction_period = EXCLUDED.auction_period, title = EXCLUDED.title, status = EXCLUDED.status,
          current_price = EXCLUDED.current_price, description = EXCLUDED.description, quantity = EXCLUDED.quantity,
          brand = EXCLUDED.brand, model = EXCLUDED.model, lot_fee = EXCLUDED.lot_fee,
          bid_history = EXCLUDED.bid_history, fetched_at = EXCLUDED.fetched_at`,
        [
          d.id,
          d.auction_period ?? null,
          d.title || '',
          d.status ?? null,
          d.current_price ?? null,
          description,
          quantity,
          brand,
          model,
          d.lot_fee ?? null,
          JSON.stringify(d.bid_history ?? []),
          Date.now(),
        ],
        tx,
      );
      if (
        identityChanged &&
        (await this.get('SELECT 1 FROM closed_lots WHERE id = $1', [d.id], tx))
      ) {
        await this.bumpClosedRev(tx);
      }
      if (catalogChanged) {
        const seq = (await this.int('seq', tx)) + 1;
        if (await this.run('UPDATE lots SET seq = $1 WHERE id = $2', [seq, d.id], tx)) {
          await this.setMeta('seq', seq, tx);
        }
      }
    });
  }

  /** Saved item details only; never serve archived auction or account state as current. */
  async lotMetadata(id: number, auctionPeriod: string): Promise<LotMetadata | null> {
    const row = await this.get<{
      description: string | null;
      quantity: number | null;
      brand: string | null;
      model: string | null;
      lot_fee: number | null;
    }>(
      `SELECT description, quantity, brand, model, lot_fee FROM lot_details
       WHERE lot_id = $1 AND auction_period = $2`,
      [id, auctionPeriod],
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
    if (row.quantity !== null) {
      metadata.quantity = row.quantity;
    }
    return metadata;
  }

  // -- item types ----------------------------------------------------------------------------
  /** Stored lots without an item type. */
  async untypedItems(): Promise<Lot[]> {
    return (await this.load())
      .values()
      .filter(lot => !lot.itemType)
      .toArray();
  }

  /** The item types given most often to titles in a site category. */
  async commonTypes(category: string | null, limit: number): Promise<string[]> {
    return (
      await this.all<{ type: string }>(
        'SELECT type FROM item_types WHERE category IS NOT DISTINCT FROM $1 GROUP BY type ORDER BY count(*) DESC, type LIMIT $2',
        [category, limit],
      )
    ).map(r => r.type);
  }

  /**
   * Persist identity-aware labels and touch only changed effective assignments; returns the new
   * types of the lots whose type changed, by lot id. Automatic labels never replace manual ones.
   */
  async saveLotTypes(
    labels: Iterable<[Item, string]>,
    { manual = false } = {},
  ): Promise<Map<number, string | null>> {
    return this.tx(async tx => {
      const previous = await this.typeAssignments(tx);
      const index = await this.typeIndex(tx);
      for (const [lot, label] of labels) {
        const record = index.match(lot);
        if (!manual && record?.manual) {
          continue;
        }
        const identity = brandModelKey(lot);
        const [brand, model] = identity ? identity.split('\n') : ['', ''];
        await this.run(
          `INSERT INTO item_types (brand, model, title, type, category, at, manual)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (brand, model, title) DO UPDATE SET
            type = EXCLUDED.type, category = EXCLUDED.category, at = EXCLUDED.at, manual = EXCLUDED.manual`,
          [brand!, model!, lot.title, label, lot.category?.value ?? null, this.stamp(), manual],
          tx,
        );
      }
      this.changedTypes();
      return this.touchChanges(previous, await this.typeAssignments(tx), tx);
    });
  }

  // -- settings ------------------------------------------------------------------------------------
  private async filterTypesRev(q: Queryable = this.sql): Promise<number | null> {
    const v = await this.getMeta('filterTypesRev', q);
    return typeof v === 'number' ? Math.trunc(v) : null;
  }

  /** All globally filtered item types, sorted. */
  async filterTypes(q: Queryable = this.sql): Promise<string[]> {
    return (
      await this.all<{ type: string }>('SELECT type FROM filter_types ORDER BY type', [], q)
    ).map(r => r.type);
  }

  private async writeFilterTypes(types: Iterable<string>, q: Queryable): Promise<void> {
    await this.run('DELETE FROM filter_types', [], q);
    const cleaned = [...new Set([...types].map(raw => raw.trim().toLowerCase()).filter(Boolean))];
    if (cleaned.length) {
      await this.run(
        `INSERT INTO filter_types (type) VALUES ${valuePlaceholders(cleaned.length, 1)} ON CONFLICT DO NOTHING`,
        cleaned,
        q,
      );
    }
  }

  private async migrateFilterTypes(): Promise<void> {
    const row = await this.get<{ value: string; rev: number }>(
      'SELECT value, rev FROM settings WHERE key = $1',
      [KEYS.filterTypes],
    );
    if (!row) {
      return;
    }
    const parsed: unknown = JSON.parse(row.value);
    const types = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
    await this.tx(async tx => {
      await this.writeFilterTypes(types, tx);
      await this.setMeta('filterTypesRev', row.rev, tx);
      await this.run('DELETE FROM settings WHERE key = $1', [KEYS.filterTypes], tx);
    });
  }

  private async hiddenLotsRev(q: Queryable = this.sql): Promise<number | null> {
    const v = await this.getMeta('hiddenLotsRev', q);
    return typeof v === 'number' ? Math.trunc(v) : null;
  }

  /** All hidden lots, keyed by lot id string. */
  async hiddenLots(q: Queryable = this.sql): Promise<Record<string, HiddenLot>> {
    const rows = await this.all<{
      lot_id: string | number;
      ts: string | number;
    }>('SELECT lot_id, ts FROM hidden_lots ORDER BY lot_id', [], q);
    return Object.fromEntries(rows.map(r => [String(r.lot_id), { ts: toInt(r.ts) }]));
  }

  private async writeHiddenLots(entries: [number, HiddenLot][], q: Queryable): Promise<void> {
    await this.run('DELETE FROM hidden_lots', [], q);
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const params: Param[] = [];
      for (const [id, h] of batch) {
        params.push(id, h.ts);
      }
      await this.run(
        `INSERT INTO hidden_lots (lot_id, ts) VALUES ${valuePlaceholders(batch.length, 2)}
         ON CONFLICT (lot_id) DO UPDATE SET ts = EXCLUDED.ts`,
        params,
        q,
      );
    }
  }

  private async migrateHiddenLots(): Promise<void> {
    const row = await this.get<{ value: string; rev: number }>(
      'SELECT value, rev FROM settings WHERE key = $1',
      [KEYS.hidden],
    );
    if (!row) {
      return;
    }
    const entries = parseHiddenLots(JSON.parse(row.value));
    await this.tx(async tx => {
      await this.writeHiddenLots(entries, tx);
      await this.setMeta('hiddenLotsRev', row.rev, tx);
      await this.run('DELETE FROM settings WHERE key = $1', [KEYS.hidden], tx);
    });
  }

  /** The settings revision and every setting changed after `since`. */
  async settings(since = 0): Promise<{ rev: number; values: Record<string, unknown> }> {
    const rev = await this.int('settingsRev');
    const from = since > rev ? 0 : since;
    const rows = await this.all<{ key: string; value: string }>(
      'SELECT key, value FROM settings WHERE rev > $1',
      [from],
    );
    const values: Record<string, unknown> = Object.fromEntries(
      rows.map(r => [r.key, JSON.parse(r.value)]),
    );
    const ftRev = await this.filterTypesRev();
    if (ftRev !== null && ftRev > from) {
      values[KEYS.filterTypes] = await this.filterTypes();
    }
    const hlRev = await this.hiddenLotsRev();
    if (hlRev !== null && hlRev > from) {
      values[KEYS.hidden] = await this.hiddenLots();
    }
    return { rev, values };
  }

  async setting(key: string): Promise<unknown> {
    if (key === KEYS.filterTypes) {
      return (await this.filterTypesRev()) === null ? undefined : this.filterTypes();
    }
    if (key === KEYS.hidden) {
      return (await this.hiddenLotsRev()) === null ? undefined : this.hiddenLots();
    }
    const row = await this.get<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
      key,
    ]);
    return row ? JSON.parse(row.value) : undefined;
  }

  /** Save a setting (last write wins) and return the new settings revision. */
  async putSetting(key: string, value: unknown): Promise<number> {
    if (key === KEYS.filterTypes) {
      const types = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : [];
      return this.tx(async tx => {
        const rev = (await this.int('settingsRev', tx)) + 1;
        await this.writeFilterTypes(types, tx);
        await this.setMeta('filterTypesRev', rev, tx);
        await this.setMeta('settingsRev', rev, tx);
        return rev;
      });
    }
    if (key === KEYS.hidden) {
      const entries = parseHiddenLots(value);
      return this.tx(async tx => {
        const rev = (await this.int('settingsRev', tx)) + 1;
        await this.writeHiddenLots(entries, tx);
        await this.setMeta('hiddenLotsRev', rev, tx);
        await this.setMeta('settingsRev', rev, tx);
        return rev;
      });
    }
    return this.tx(async tx => {
      const rev = (await this.int('settingsRev', tx)) + 1;
      await this.run(
        `INSERT INTO settings (key, value, rev) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, rev = EXCLUDED.rev`,
        [key, JSON.stringify(value), rev],
        tx,
      );
      await this.setMeta('settingsRev', rev, tx);
      return rev;
    });
  }

  // -- app sessions --------------------------------------------------------------------------------
  async addSession(id: string): Promise<void> {
    await this.run('INSERT INTO app_sessions (id, created) VALUES ($1, $2)', [id, now()]);
  }

  async hasSession(id: string, maxAge: Duration): Promise<boolean> {
    const row = await this.get<{ created: number }>(
      'SELECT created FROM app_sessions WHERE id = $1',
      [id],
    );
    return row !== null && now() - row.created < maxAge.total('seconds');
  }

  async dropSession(id: string): Promise<void> {
    await this.run('DELETE FROM app_sessions WHERE id = $1', [id]);
  }
}

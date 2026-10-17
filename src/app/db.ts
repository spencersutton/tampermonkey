// IndexedDB cache of the full catalog: one record per lot plus a meta record.
import type { Lot } from './types';

export interface CatalogMeta {
  fetchedAt: number | null; // when the last complete pull finished
  pullStartedAt: number | null; // when the last pull (successful or not) started – rate limit anchor
  count: number; // lot count the API reported in the last complete pull
  authed: boolean; // whether that pull carried account data
}

/** Meta record used before any pull has been stored. */
export const EMPTY_META: CatalogMeta = { fetchedAt: null, pullStartedAt: null, count: 0, authed: false };

/** The open database connection, opened lazily and shared. */
let dbp: Promise<IDBDatabase> | null = null;

/** Open (and on first use create) the IndexedDB database. */
function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('tlx-catalog', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('lots', { keyPath: 'id' });
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** Resolves when a transaction commits, rejects if it fails or aborts. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Promise for a single IndexedDB request. */
const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Read the catalog meta record. */
export async function readMeta(): Promise<CatalogMeta> {
  const db = await open();
  const m = await result(db.transaction('meta').objectStore('meta').get('catalog'));
  return { ...EMPTY_META, ...(m || {}) };
}

/** Merge a patch into the catalog meta record and return the result. */
export async function writeMeta(patch: Partial<CatalogMeta>): Promise<CatalogMeta> {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  const cur = { ...EMPTY_META, ...((await result(store.get('catalog'))) || {}) };
  const next = { ...cur, ...patch };
  store.put(next, 'catalog');
  await done(tx);
  return next;
}

/** Read every cached lot plus the meta record in one transaction. */
export async function readAll(): Promise<{ lots: Lot[]; meta: CatalogMeta }> {
  const db = await open();
  const tx = db.transaction(['lots', 'meta']);
  const [lots, meta] = await Promise.all([
    result(tx.objectStore('lots').getAll() as IDBRequest<Lot[]>),
    result(tx.objectStore('meta').get('catalog')),
  ]);
  return { lots, meta: { ...EMPTY_META, ...(meta || {}) } };
}

/** Replace the whole cached catalog with a fresh pull and update the meta record. */
export async function replaceAll(lots: Lot[], meta: Partial<CatalogMeta>): Promise<void> {
  const db = await open();
  const tx = db.transaction(['lots', 'meta'], 'readwrite');
  const store = tx.objectStore('lots');
  store.clear();
  for (const l of lots) store.put(l);
  const metaStore = tx.objectStore('meta');
  const cur = { ...EMPTY_META, ...((await result(metaStore.get('catalog'))) || {}) };
  metaStore.put({ ...cur, ...meta }, 'catalog');
  await done(tx);
}

/** Insert or update individual lots (incremental updates between pulls). */
export async function putLots(lots: Lot[]): Promise<void> {
  if (!lots.length) return;
  const db = await open();
  const tx = db.transaction('lots', 'readwrite');
  const store = tx.objectStore('lots');
  for (const l of lots) store.put(l);
  await done(tx);
}

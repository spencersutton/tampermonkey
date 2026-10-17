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

/** The stored meta record, with defaults for anything missing. */
const getMeta = async (tx: IDBTransaction): Promise<CatalogMeta> => ({ ...EMPTY_META, ...(await result(tx.objectStore('meta').get('catalog'))) });

/** Merge a patch into the meta record within a readwrite transaction. */
async function patchMeta(tx: IDBTransaction, patch: Partial<CatalogMeta>): Promise<CatalogMeta> {
  const next = { ...(await getMeta(tx)), ...patch };
  tx.objectStore('meta').put(next, 'catalog');
  return next;
}

/** Read the catalog meta record. */
export async function readMeta(): Promise<CatalogMeta> {
  return getMeta((await open()).transaction('meta'));
}

/** Merge a patch into the catalog meta record and return the result. */
export async function writeMeta(patch: Partial<CatalogMeta>): Promise<CatalogMeta> {
  const tx = (await open()).transaction('meta', 'readwrite');
  const next = await patchMeta(tx, patch);
  await done(tx);
  return next;
}

/** Read every cached lot plus the meta record in one transaction. */
export async function readAll(): Promise<{ lots: Lot[]; meta: CatalogMeta }> {
  const tx = (await open()).transaction(['lots', 'meta']);
  const [lots, meta] = await Promise.all([result(tx.objectStore('lots').getAll() as IDBRequest<Lot[]>), getMeta(tx)]);
  return { lots, meta };
}

/** Replace the whole cached catalog with a fresh pull and update the meta record. */
export async function replaceAll(lots: Lot[], meta: Partial<CatalogMeta>): Promise<void> {
  const tx = (await open()).transaction(['lots', 'meta'], 'readwrite');
  const store = tx.objectStore('lots');
  store.clear();
  lots.forEach((l) => store.put(l));
  await patchMeta(tx, meta);
  await done(tx);
}

/** Insert or update individual lots (incremental updates between pulls). */
export async function putLots(lots: Lot[]): Promise<void> {
  if (!lots.length) {
    return;
  }
  const tx = (await open()).transaction('lots', 'readwrite');
  const store = tx.objectStore('lots');
  lots.forEach((l) => store.put(l));
  await done(tx);
}

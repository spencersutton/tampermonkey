// Fetching and caching the site's "Closed Auctions" sections (Won / Lost).
import { MINUTE } from '../../shared/constants';
import { errorMessage } from '../logic/util';
import type { ClosedLot } from '../types';
import { fetchClosed, type ClosedSection } from './api';

/** A fetched section is shown again without refetching for this long. */
const FRESH = 2 * MINUTE;

export interface ClosedCache {
  lots: ClosedLot[];
  count: number; // what the site reports, while pages are still arriving
  done: boolean;
  at: number;
  error?: string;
}

/** Last fetch of each section, kept while the app is open. */
const cache = new Map<ClosedSection, ClosedCache>();

export const getCachedClosed = (section: ClosedSection) => cache.get(section) ?? null;

/**
 * Load a closed-lots section when not already fresh in cache, calling `onUpdate` as pages arrive.
 * Returns a cleanup function that aborts the request.
 */
export function loadClosedSection(
  section: ClosedSection,
  authed: boolean,
  onUpdate: (data: ClosedCache) => void,
): () => void {
  const hit = cache.get(section);
  if (!authed || (hit && !hit.error && Date.now() - hit.at < FRESH)) {
    return () => {};
  }
  const ac = new AbortController();
  const put = (d: ClosedCache) => {
    cache.set(section, d);
    if (!ac.signal.aborted) {
      onUpdate(d);
    }
  };
  fetchClosed(
    section,
    (lots, count) => put({ lots, count, done: false, at: Date.now() }),
    ac.signal,
  ).then(
    lots => put({ lots, count: lots.length, done: true, at: Date.now() }),
    e =>
      !ac.signal.aborted &&
      put({
        lots: hit?.lots ?? [],
        count: 0,
        done: true,
        at: 0,
        error: errorMessage(e) || String(e),
      }),
  );
  return () => ac.abort();
}

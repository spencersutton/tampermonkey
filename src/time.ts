export function timeLeft(endsAt: number, now = Date.now()): string {
  const seconds = Math.ceil((endsAt - now) / 1000);
  if (seconds <= 0) return 'Closed';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}

export function timestamp(value: unknown): number | null {
  if (value == null) return null;
  const result = typeof value === 'string' ? Date.parse(value) : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new TypeError('Invalid timestamp in browser settings');
  return result;
}

export function migrateSetting(key: string, value: unknown): unknown {
  if (key === 'tlxLastVisit') return timestamp(value);
  if (key === 'tlxView' && value && typeof value === 'object' && 'newSince' in value) {
    return { ...value, newSince: timestamp(value.newSince) };
  }
  if (key === 'tlxSavedSearches') {
    if (!Array.isArray(value)) throw new TypeError('Invalid saved searches in browser settings');
    return value.map((search: unknown) => {
      if (!search || typeof search !== 'object' || !('lastViewedAt' in search)) throw new TypeError('Invalid saved search');
      return { ...search, lastViewedAt: timestamp(search.lastViewedAt) ?? 0 };
    });
  }
  return value;
}

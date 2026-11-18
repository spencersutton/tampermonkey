// Reading untrusted JSON (the site's replies, request bodies) without casts.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A field of a JSON object (undefined if it isn't one). */
export const prop = (o: unknown, key: string): unknown => (isRecord(o) ? o[key] : undefined);

/** A string field of a JSON object, or null. */
export function field(o: unknown, key: string): string | null {
  const v = prop(o, key);
  return typeof v === 'string' ? v : null;
}

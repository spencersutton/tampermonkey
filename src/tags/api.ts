// The tlx server's tag rule endpoints (see src/server/app.ts).
import { authedFetch } from '../app/server/auth';

export interface TagRule {
  id: number;
  pattern: string;
  tags: string[];
  /** Current lots the pattern matches (in listings only). */
  lots?: number;
}

export interface PreviewMatch {
  title: string;
  /** One lot with this title, to open in the catalog. */
  lotId: number;
  /** Lots with this title. */
  lots: number;
  /** Where the pattern matched, in code points. */
  span: [number, number];
  /** The title's tags now, from every source. */
  tags: string[];
  /** The previewed tags (groups filled in) the title doesn't have yet. */
  adds: string[];
}

export interface Preview {
  lots: number;
  titles: number;
  /** The titles matched, most lots first (capped by the server). */
  matches: PreviewMatch[];
}

export interface Overview {
  rules: TagRule[];
  /** Every tag in use, with its lot count, commonest first. */
  tags: [string, number][];
}

/** A refused request; `field` says which part of a rule was wrong ('pattern' or 'tags'), if known. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

const textField = (data: unknown, key: string): unknown =>
  data && typeof data === 'object' ? Reflect.get(data, key) : undefined;

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  const res = await authedFetch(path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = textField(data, 'error');
    const field = textField(data, 'field');
    throw new ApiError(
      typeof error === 'string' ? error : `Server replied ${res.status}`,
      typeof field === 'string' ? field : null,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return data as T;
}

export const loadOverview = () => call<Overview>('GET', '/api/tag-rules');

export function previewRule(pattern: string, tags: string[], signal: AbortSignal) {
  const query = new URLSearchParams([['pattern', pattern], ...tags.map(t => ['tag', t])]);
  return call<Preview>('GET', `/api/tag-rules/preview?${query}`, undefined, signal);
}

export const saveRule = (id: number | null, pattern: string, tags: string[]) =>
  id == null
    ? call<{ rule: TagRule; changed: number }>('POST', '/api/tag-rules', { pattern, tags })
    : call<{ rule: TagRule; changed: number }>('PUT', `/api/tag-rules/${id}`, { pattern, tags });

export const deleteRule = (id: number) =>
  call<{ changed: number }>('DELETE', `/api/tag-rules/${id}`);

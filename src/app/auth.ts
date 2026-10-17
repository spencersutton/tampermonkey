// Login state for /tlx.
//
// The site's API token lives in a readable `token` cookie that the site's
// server re-issues whenever the page calls next-auth's /api/auth/session. The
// site does that on page load, when the tab becomes visible again, and after
// any 401. /tlx stops the site's own code from loading, so we make the same
// calls here; otherwise the token quietly expires and /tlx looks logged out
// while the rest of the site (which refreshes it) is fine.
import { useEffect, useState } from 'preact/hooks';

const SESSION_URL = '/api/auth/session';
const FOCUS_MIN_GAP = 60_000; // don't re-check the session more than once a minute on tab focus
const EXPIRY_MARGIN = 2 * 60_000; // refresh this long before the token's own expiry

export function authToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'token') return decodeURIComponent(v.join('=')) || null;
  }
  return null;
}

// The session endpoint said there's no session (logged out on the site).
let signedOut = false;
// A token the API rejected even after a session refresh; a new cookie value clears it.
let rejectedToken: string | null = null;

export function isAuthenticated(): boolean {
  const t = authToken();
  return !signedOut && t !== null && t !== rejectedToken;
}

const subs = new Set<() => void>();
let lastState = isAuthenticated();
function notify() {
  const now = isAuthenticated();
  if (now === lastState) return;
  lastState = now;
  subs.forEach((f) => f());
}

export function onAuthChange(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

/** Re-renders when the login state changes. */
export function useAuthed(): boolean {
  const [authed, set] = useState(isAuthenticated);
  useEffect(() => {
    const f = () => set(isAuthenticated());
    f();
    return onAuthChange(f);
  }, []);
  return authed;
}

/** Epoch ms when the token expires, if it's a JWT with an `exp` claim. */
function tokenExpiry(token: string | null): number | null {
  try {
    const part = token?.split('.')[1];
    if (!part) return null;
    const exp = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

let inflight: Promise<boolean> | null = null;
let lastCheck = 0;
let timer = 0;

/** Ask the site's server for the session, which also re-issues the token cookie. Resolves to the login state. */
export function refreshSession(): Promise<boolean> {
  return (inflight ??= checkSession().finally(() => {
    inflight = null;
    lastCheck = Date.now();
    notify();
    scheduleRefresh();
  }));
}

async function checkSession(): Promise<boolean> {
  try {
    const res = await fetch(SESSION_URL, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    // Server trouble: keep the current state rather than logging out.
    if (!res.ok) return isAuthenticated();
    const s = await res.json().catch(() => null);
    // Logged out is `{}`; a session whose refresh failed carries `error` (the site signs out then).
    signedOut = !s || typeof s !== 'object' || !Object.keys(s).length || !!s.error;
  } catch {
    // Offline: keep the current state.
  }
  return isAuthenticated();
}

function scheduleRefresh() {
  clearTimeout(timer);
  const exp = tokenExpiry(authToken());
  if (exp == null || signedOut) return;
  timer = window.setTimeout(() => void refreshSession(), Math.max(30_000, exp - EXPIRY_MARGIN - Date.now()));
}

let ready: Promise<unknown> = Promise.resolve();

/** Check the session once at startup (like the site's page load) and keep it fresh afterwards. */
export function startAuth() {
  ready = refreshSession();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > FOCUS_MIN_GAP) void refreshSession();
  });
  // Logging in or out in another tab changes the cookie. Our own refresh can
  // re-issue it too, hence the gap (which also stops a refresh loop).
  (window as any).cookieStore?.addEventListener?.('change', (e: any) => {
    const touched = [...(e.changed ?? []), ...(e.deleted ?? [])].some((c: any) => c?.name === 'token');
    if (touched && Date.now() - lastCheck > 5000) void refreshSession();
  });
}

function withAuth(headers: Record<string, string>, withToken: boolean): Record<string, string> {
  const token = withToken ? authToken() : null;
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

/**
 * fetch() with the bearer token. On a 401 the session is refreshed and the
 * request retried once with the new token, like the site's own client.
 * A 401 means the request wasn't processed, so this is safe for bids too.
 * With `anonFallback`, a still-rejected request is retried without the token.
 */
export async function authedFetch(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  anonFallback = false,
): Promise<Response> {
  await ready.catch(() => {});
  const send = (withToken: boolean) => fetch(url, { ...init, credentials: 'same-origin', headers: withAuth(init.headers ?? {}, withToken) });
  const had = isAuthenticated();
  let res = await send(had);
  if (res.status !== 401 || !had) return res;
  const used = authToken();
  if (await refreshSession()) res = await send(true);
  if (res.status === 401) {
    if (authToken() === used) rejectedToken = used;
    notify();
    if (anonFallback) res = await send(false);
  }
  return res;
}

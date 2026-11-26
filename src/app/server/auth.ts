// Login state and server auth requests for the web app.
//
// Two logins are involved, both held by the tlx server:
// - the app's own password, which unlocks the server (a session cookie);
// - the server's login to Triangle Liquidators. The server keeps the site's
//   session cookies and adds the API token to every /backend request, so this
//   page never sees a token at all.
import { computed, effect, signal, untracked } from '@preact/signals';

import { ms, within } from '../../shared/time';

const CHECK_EVERY = Temporal.Duration.from({ minutes: 5 });
const FOCUS_MIN_GAP = Temporal.Duration.from({ minutes: 1 });

export interface Me {
  version: string;
  app: { locked: boolean; password: boolean };
  site: { loggedIn: boolean; email: string | null; name: string | null } | null;
}

/** The server's last answer to /api/me (null until the first one). */
export const me = signal<Me | null>(null);
let markUnlocked: () => void;
/** Resolves on the first unlocked session, including after the password prompt. */
export const appUnlocked = new Promise<void>(resolve => (markUnlocked = resolve));
const authed = computed(() => Boolean(me.value?.site?.loggedIn));

/** Whether the server is logged in to the site. */
export const isAuthenticated = () => authed.value;

/** `fn` runs whenever the site login flips (what live.ts and the catalog care about). */
export function onAuthChange(fn: () => void): () => void {
  let last = authed.peek();
  return effect(() => {
    if (authed.value !== last) {
      last = authed.value;
      untracked(fn);
    }
  });
}

/** Call one of the server's /api endpoints and take the login state from its reply. */
async function callMe(path: string, body?: unknown): Promise<Me & { error?: string | null }> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-TLX-Client': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({ error: `Server replied ${res.status}` }));
  if (data?.app) {
    me.value = data;
    if (!data.app.locked) {
      markUnlocked();
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || `Server replied ${res.status}`);
  }
  return data;
}

/** Check in-flight, shared by concurrent callers. */
let inflight: Promise<boolean> | null = null;
let lastCheck: Temporal.Instant | null = null;

/** Ask the server for the login state. Resolves to whether it's logged in to the site. */
export function refreshSession(): Promise<boolean> {
  return (inflight ??= callMe('/api/me')
    .then(isAuthenticated, isAuthenticated)
    .finally(() => {
      inflight = null;
      lastCheck = Temporal.Now.instant();
    }));
}

let ready: Promise<unknown> = Promise.resolve();
/** Resolves once the first login check is done (it never rejects). */
export const authReady = () => ready;

/** Check the login state now, when the tab comes back, and every few minutes. */
export function startAuth() {
  ready = refreshSession();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible' &&
        !(lastCheck && within(lastCheck, FOCUS_MIN_GAP))
      ) {
        void refreshSession();
      }
    });
  }
  setInterval(() => void refreshSession(), ms(CHECK_EVERY));
}

/**
 * Fetch() for the site's API through the server, which adds the token (and refreshes and retries
 * it). A 401 means a login ended somewhere, so the state is checked again.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await authReady();
  const headers = new Headers(init.headers);
  headers.set('X-TLX-Client', '1');
  const res = await fetch(url, { ...init, credentials: 'same-origin', headers });
  if (res.status === 401) {
    void refreshSession();
  }
  return res;
}

export const unlockApp = (password: string) => callMe('/api/app-login', { password });
export const lockApp = () => callMe('/api/app-logout', {});
export const logoutSite = () => callMe('/api/site-logout', {});

export async function loginSite(email: string, password: string): Promise<void> {
  const r = await callMe('/api/site-login', { email, password });
  if (r.error) {
    throw new Error(r.error);
  }
}

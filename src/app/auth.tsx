// Login state for the web app.
//
// Two logins are involved, both held by the tlx server:
// - the app's own password, which unlocks the server (a session cookie);
// - the server's login to Triangle Liquidators, made from the form here. The
//   server keeps the site's session cookies and adds the API token to every
//   /backend request, so this page never sees a token at all.
import type { ComponentChildren } from 'preact';
import { computed, effect, signal, untracked } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Dialog } from './Dialog';
import { MINUTE } from './util';

const CHECK_EVERY = 5 * MINUTE;
const FOCUS_MIN_GAP = MINUTE;

export interface Me {
  version: string;
  app: { locked: boolean; password: boolean };
  site: { loggedIn: boolean; email: string | null; name: string | null } | null;
}

/** The server's last answer to /api/me (null until the first one). */
export const me = signal<Me | null>(null);
/** Whether the login form is open. */
const loginOpen = signal(false);
const authed = computed(() => !!me.value?.site?.loggedIn);

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

/** A link-styled button that opens the login form. */
export function LoginLink({ class: cls = 'link-button', title, children }: { class?: string; title?: string; children: ComponentChildren }) {
  return (
    <button type="button" class={cls} title={title} onClick={() => setLoginOpen(true)}>
      {children}
    </button>
  );
}

const setLoginOpen = (open: boolean) => void (loginOpen.value = open);

/** Call one of the server's /api endpoints and take the login state from its reply. */
async function callMe(path: string, body?: unknown): Promise<Me & { error?: string | null }> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'X-TLX-Client': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Server replied ${res.status}` }));
  if (data?.app) {
    me.value = data;
  }
  if (!res.ok) {
    throw new Error(data?.error || `Server replied ${res.status}`);
  }
  return data;
}

/** Check in-flight, shared by concurrent callers. */
let inflight: Promise<boolean> | null = null;
let lastCheck = 0;

/** Ask the server for the login state. Resolves to whether it's logged in to the site. */
export function refreshSession(): Promise<boolean> {
  return (inflight ??= callMe('/api/me')
    .then(isAuthenticated, isAuthenticated)
    .finally(() => {
      inflight = null;
      lastCheck = Date.now();
    }));
}

let ready: Promise<unknown> = Promise.resolve();
/** Resolves once the first login check is done (it never rejects). */
export const authReady = () => ready;

/** Check the login state now, when the tab comes back, and every few minutes. */
export function startAuth() {
  ready = refreshSession();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > FOCUS_MIN_GAP) {
      void refreshSession();
    }
  });
  window.setInterval(() => void refreshSession(), CHECK_EVERY);
}

/**
 * fetch() for the site's API through the server, which adds the token (and
 * refreshes and retries it). A 401 means a login ended somewhere, so the
 * state is checked again.
 */
export async function authedFetch(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  await authReady();
  const res = await fetch(url, { ...init, credentials: 'same-origin', headers: { ...init.headers, 'X-TLX-Client': '1' } });
  if (res.status === 401) {
    void refreshSession();
  }
  return res;
}

export const unlockApp = (password: string) => callMe('/api/app-login', { password });
export const lockApp = () => callMe('/api/app-logout', {});
export const logoutSite = () => callMe('/api/site-logout', {});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
/** Small form card: a title, fields, an error line and one submit button. */
function FormCard({ title, intro, fields, submit, onSubmit, onCancel }: {
  title: string;
  intro: ComponentChildren;
  fields: ComponentChildren;
  submit: string;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="confirm login-form" onSubmit={run} aria-labelledby="login-title">
      <h2 id="login-title">{title}</h2>
      <div class="confirm-body">
        <p class="muted small">{intro}</p>
        {fields}
        {error && <p class="error small">{error}</p>}
      </div>
      <div class="confirm-actions">
        {onCancel && (
          <button type="button" class="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" class="btn" disabled={busy}>
          {busy ? 'One moment…' : submit}
        </button>
      </div>
    </form>
  );
}

/** Full-page password prompt while the server is locked. */
export function AppLock() {
  const [password, setPassword] = useState('');
  return (
    <div class="lock-page">
      <FormCard
        title="TL Catalog"
        intro="Enter the password this server was started with."
        submit="Unlock"
        onSubmit={async () => void (await unlockApp(password))}
        fields={
          <label class="field">
            <span>Password</span>
            <input type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          </label>
        }
      />
    </div>
  );
}

/** The Triangle Liquidators login form, opened by any LoginLink. */
export function LoginDialog() {
  return loginOpen.value ? <LoginForm /> : null;
}

function LoginForm() {
  const [email, setEmail] = useState(me.peek()?.site?.email ?? '');
  const [password, setPassword] = useState('');
  return (
    <Dialog onClose={() => setLoginOpen(false)} aria-labelledby="login-title">
      <FormCard
        title="Log in to Triangle Liquidators"
        intro="The tlx server signs in for you and stays logged in. Your password goes to the site once and isn’t stored."
        submit="Log in"
        onCancel={() => setLoginOpen(false)}
        onSubmit={async () => {
          const r = await callMe('/api/site-login', { email, password });
          if (r.error) {
            throw new Error(r.error);
          }
          setLoginOpen(false);
        }}
        fields={
          <>
            <label class="field">
              <span>Email</span>
              <input autofocus type="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Password</span>
              <input type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
            </label>
          </>
        }
      />
    </Dialog>
  );
}

/** Account rows for the Settings panel: who the server is logged in as, and log out / lock. */
export function AccountSettings() {
  const state = me.value;
  const site = state?.site;
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    await fn().catch(() => {});
    setBusy(false);
  };
  return (
    <div class="account">
      <span class="muted small">
        {site?.loggedIn ? `Logged in as ${site.email ?? site.name ?? 'you'}` : 'Not logged in to Triangle Liquidators'}
      </span>
      <div class="row-gap">
        {site?.loggedIn ? (
          <button type="button" class="btn-text" disabled={busy} onClick={act(logoutSite)}>
            Log out
          </button>
        ) : (
          <LoginLink class="btn-text">Log in</LoginLink>
        )}
        {state?.app.password && (
          <button type="button" class="btn-text" disabled={busy} onClick={act(lockApp)} title="Forget this device’s server password">
            Lock app
          </button>
        )}
      </div>
    </div>
  );
}

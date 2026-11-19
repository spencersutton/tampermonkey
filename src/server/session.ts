// The server's own login to triangleliquidators.com.
//
// The site uses next-auth: signing in with email and password sets an HttpOnly
// session cookie, and every call to /api/auth/session re-issues a readable
// `token` cookie, the bearer token its JSON API takes. The server signs in
// itself (the password is used once and never stored), keeps the cookies in
// SQLite (in the format the earlier Python server used, so its login carries
// over), and refreshes the token shortly before it expires or after the API
// rejects it.
import { SITE } from '../shared/site';
import { field, isRecord, prop } from './json';
import { USER_AGENT } from './site';
import type { Store } from './store';

const EXPIRY_MARGIN = 120; // seconds; refresh the token this long before it expires
const REFRESH_MIN_GAP = 30; // seconds between forced refreshes (after a 401)
const COOKIES_KEY = 'siteCookies';
const USER_KEY = 'siteUser';
const SITE_HOST = new URL(SITE).hostname;

const LOGIN_ERRORS: Record<string, string> = {
  CredentialsSignin: 'Wrong email or password.',
  user_blocked: 'Your account is blocked. Contact Triangle Liquidators support.',
  email_not_verified: 'Your email address isn’t verified yet. Finish signing up on the site first.',
};

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number; // epoch ms; kept in memory only, like the Python jar's saved form
}

export interface SiteUser {
  email: string | null;
  name: string | null;
}

export interface SiteStatus {
  loggedIn: boolean;
  email: string | null;
  name: string | null;
}

/** Epoch seconds when a JWT expires (its `exp` claim), or null if it has none. */
export function tokenExpiry(token: string | null): number | null {
  const part = token?.split('.')[1];
  if (!part) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(Buffer.from(part, 'base64url').toString());
    const exp = claims && typeof claims === 'object' && 'exp' in claims ? claims.exp : null;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** A Set-Cookie header as a cookie, or null if it can't be read. */
function parseSetCookie(header: string, now: number): Cookie | null {
  const [pair = '', ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) {
    return null;
  }
  const cookie: Cookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: SITE_HOST,
    path: '/',
  };
  for (const attr of attrs) {
    const [key = '', ...rest] = attr.split('=');
    const value = rest.join('=').trim();
    switch (key.trim().toLowerCase()) {
      case 'domain':
        cookie.domain = value ? `.${value.replace(/^\./, '')}` : cookie.domain;
        break;
      case 'path':
        cookie.path = value.startsWith('/') ? value : '/';
        break;
      case 'max-age':
        // Max-Age wins over Expires.
        cookie.expires = now + Number(value) * 1000;
        break;
      case 'expires':
        if (!attrs.some(a => a.trim().toLowerCase().startsWith('max-age='))) {
          cookie.expires = Date.parse(value);
        }
        break;
    }
  }
  return cookie;
}

export class SiteSession {
  user: SiteUser | null;
  private cookies: Cookie[] = [];
  private lastRefresh = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly store: Store;
  private readonly fetch: typeof fetch;

  constructor(store: Store, fetchImpl: typeof fetch = fetch) {
    this.store = store;
    this.fetch = fetchImpl;
    this.loadCookies(store.getMeta(COOKIES_KEY));
    const user = store.getMeta(USER_KEY);
    this.user = isRecord(user) ? { email: field(user, 'email'), name: field(user, 'name') } : null;
  }

  /** Run one session operation at a time, as the Python version's lock does. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // -- cookies --------------------------------------------------------------
  /** Restore saved cookies, or the older {name: value} form (taken as host cookies for the site). */
  private loadCookies(saved: unknown) {
    const list = isRecord(saved)
      ? Object.entries(saved).map(([name, value]) => ({
          name,
          value,
          domain: SITE_HOST,
          path: '/',
        }))
      : saved;
    this.cookies = [];
    for (const c of Array.isArray(list) ? (list as unknown[]) : []) {
      const [name, value, domain, path] = ['name', 'value', 'domain', 'path'].map(k => field(c, k));
      if (name != null && value != null && domain != null && path != null) {
        this.cookies.push({ name, value, domain, path });
      }
    }
  }

  private save() {
    this.store.setMeta(
      COOKIES_KEY,
      this.live().map(({ name, value, domain, path }) => ({ name, value, domain, path })),
    );
    this.store.setMeta(USER_KEY, this.user);
  }

  private live(): Cookie[] {
    const now = Date.now();
    return this.cookies.filter(c => c.expires === undefined || c.expires > now);
  }

  private cookie(name: string): string | null {
    return this.live().find(c => c.name === name && c.value)?.value ?? null;
  }

  private clearCookies() {
    this.cookies = [];
  }

  private takeCookies(res: Response) {
    const now = Date.now();
    for (const header of res.headers.getSetCookie()) {
      const cookie = parseSetCookie(header, now);
      if (cookie) {
        const same = (c: Cookie) =>
          c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path;
        this.cookies = this.cookies.filter(c => !same(c));
        if (cookie.expires === undefined || cookie.expires > now) {
          this.cookies.push(cookie);
        }
      }
    }
  }

  private cookieHeader(path: string): string {
    return this.live()
      .filter(c => {
        const domain = c.domain.replace(/^\./, '');
        return (
          (SITE_HOST === domain || SITE_HOST.endsWith(`.${domain}`)) && path.startsWith(c.path)
        );
      })
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }

  /**
   * Call one of the site's next-auth endpoints with our cookies; returns the status and parsed JSON
   * (or null). Throws on network errors.
   */
  private async request(
    method: string,
    path: string,
    form?: Record<string, string>,
  ): Promise<[number, unknown]> {
    const headers = new Headers({ Accept: 'application/json', 'User-Agent': USER_AGENT });
    const cookie = this.cookieHeader(path);
    if (cookie) {
      headers.set('Cookie', cookie);
    }
    if (form) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    }
    // Redirects stay off: next-auth answers with them, and we read the reply.
    const res = await this.fetch(SITE + path, {
      method,
      headers,
      redirect: 'manual',
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    this.takeCookies(res);
    const text = await res.text();
    try {
      return [res.status, text ? JSON.parse(text) : null];
    } catch {
      return [res.status, null];
    }
  }

  // -- state ----------------------------------------------------------------
  /** A method, not a getter: TypeScript would assume it can't change across an await. */
  loggedIn(): boolean {
    return this.user !== null && this.cookie('token') !== null;
  }

  status(): SiteStatus {
    return {
      loggedIn: this.loggedIn(),
      email: this.user?.email ?? null,
      name: this.user?.name ?? null,
    };
  }

  /** The API bearer token, refreshed first if it's about to expire; null when logged out. */
  token(): Promise<string | null> {
    return this.exclusive(async () => {
      if (!this.loggedIn()) {
        return null;
      }
      const exp = tokenExpiry(this.cookie('token'));
      if (exp !== null && exp - EXPIRY_MARGIN < Date.now() / 1000) {
        await this.refreshNow(false);
      }
      return this.loggedIn() ? this.cookie('token') : null;
    });
  }

  /**
   * Ask next-auth for the session, which re-issues the token cookie. Returns whether we're logged
   * in.
   */
  refresh(force = false): Promise<boolean> {
    return this.exclusive(() => this.refreshNow(force));
  }

  private async refreshNow(force: boolean): Promise<boolean> {
    if (!this.user) {
      return false;
    }
    if (force && Date.now() / 1000 - this.lastRefresh < REFRESH_MIN_GAP) {
      return this.loggedIn();
    }
    this.lastRefresh = Date.now() / 1000;
    let status: number;
    let s: unknown;
    try {
      [status, s] = await this.request('GET', '/api/auth/session');
    } catch (e) {
      console.warn(`session refresh failed: ${String(e)}`); // offline: keep the current state
      return this.loggedIn();
    }
    if (status >= 500) {
      return this.loggedIn();
    }
    // Logged out is `{}`; a session whose refresh failed carries `error`.
    if (!isRecord(s) || !Object.keys(s).length || prop(s, 'error')) {
      console.info('site session ended');
      this.clearCookies();
      this.user = null;
    } else if (isRecord(prop(s, 'user'))) {
      const user = prop(s, 'user');
      this.user = { email: field(user, 'email'), name: field(user, 'name') };
    }
    this.save();
    return this.loggedIn();
  }

  /** The API rejected `token`: refresh once and return the new token, if any. */
  rejected(token: string): Promise<string | null> {
    return this.exclusive(async () => {
      if (this.cookie('token') !== token) {
        return this.loggedIn() ? this.cookie('token') : null;
      }
      await this.refreshNow(true);
      const fresh = this.cookie('token');
      return this.loggedIn() && fresh !== token ? fresh : null;
    });
  }

  // -- log in / out -----------------------------------------------------------
  /** Sign in like the site's login form; returns an error message, or null on success. */
  login(email: string, password: string): Promise<string | null> {
    return this.exclusive(async () => {
      this.clearCookies();
      this.user = null;
      let status: number;
      let d: unknown;
      try {
        const [, csrf] = await this.request('GET', '/api/auth/csrf');
        const csrfToken = field(csrf, 'csrfToken');
        if (!csrfToken) {
          return 'The site didn’t start a login (no CSRF token).';
        }
        const form = { email, password, csrfToken, callbackUrl: SITE, json: 'true' };
        [status, d] = await this.request('POST', '/api/auth/callback/credentials', form);
      } catch (e) {
        return `Couldn’t reach the site: ${String(e)}`;
      }
      const url = field(d, 'url') ?? '';
      let err: string | null = null;
      try {
        err = new URL(url, SITE).searchParams.get('error');
      } catch {
        // no usable URL: judge by the status alone
      }
      if (err || status >= 400) {
        this.clearCookies();
        this.save();
        return LOGIN_ERRORS[err ?? ''] ?? `Login failed (${err ?? status}).`;
      }
      this.user = { email, name: null };
      if (!(await this.refreshNow(false)) || this.cookie('token') === null) {
        this.clearCookies();
        this.user = null;
        this.save();
        return 'Logged in, but the site didn’t hand out an API token.';
      }
      console.info(`logged in to the site as ${email}`);
      return null;
    });
  }

  logout(): Promise<void> {
    return this.exclusive(async () => {
      try {
        const [, csrf] = await this.request('GET', '/api/auth/csrf');
        const csrfToken = field(csrf, 'csrfToken');
        if (csrfToken) {
          await this.request('POST', '/api/auth/signout', {
            csrfToken,
            callbackUrl: SITE,
            json: 'true',
          });
        }
      } catch {
        // forget the session locally either way
      }
      this.clearCookies();
      this.user = null;
      this.save();
    });
  }
}

// A fake of the site's next-auth endpoints, as far as SiteSession uses them
// (ported from the earlier Python server's tests).

export const jwt = (exp: number) =>
  `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;

/** Next-auth's endpoints, as far as SiteSession uses them. */
export class FakeSite {
  token = jwt(Date.now() / 1000 + 3600);
  sessionCookie: string | null = null;
  requests: { method: string; path: string; cookie: string; body: string }[] = [];

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? String(init.body) : '';
    const cookie = headers.get('Cookie') ?? '';
    this.requests.push({ method: init?.method ?? 'GET', path: url.pathname, cookie, body });
    const cookies = Object.fromEntries(
      cookie
        .split('; ')
        .filter(Boolean)
        .map(c => c.split('=', 2)),
    );
    const reply = (status: number, data?: unknown, setCookies: string[] = []) => {
      const h = new Headers({ 'Content-Type': 'application/json' });
      setCookies.forEach(c => h.append('Set-Cookie', c));
      return new Response(data === undefined ? null : JSON.stringify(data), { status, headers: h });
    };
    switch (url.pathname) {
      case '/api/auth/csrf':
        return reply(200, { csrfToken: 'csrf-1' }, ['csrf=csrf-1; Path=/api/auth']);
      case '/api/auth/callback/credentials': {
        const form = new URLSearchParams(body);
        if (cookies['csrf'] !== 'csrf-1' || form.get('csrfToken') !== 'csrf-1') {
          return reply(403);
        }
        if (form.get('password') !== 'right') {
          return reply(401, {
            url: 'https://triangleliquidators.com/login?error=CredentialsSignin',
          });
        }
        this.sessionCookie = 'session-1';
        return reply(200, { url: 'https://triangleliquidators.com/' }, [
          'session=session-1; Path=/; HttpOnly',
        ]);
      }
      case '/api/auth/session':
        if (!this.sessionCookie || cookies['session'] !== this.sessionCookie) {
          return reply(200, {});
        }
        return reply(200, { user: { email: 'user@example.test', name: 'Test User' } }, [
          `token=${this.token}; Path=/`,
        ]);
      case '/api/auth/signout':
        this.sessionCookie = null;
        return reply(200, { url: 'https://triangleliquidators.com/' }, [
          'session=; Path=/; Max-Age=0',
          'token=; Path=/; Max-Age=0',
        ]);
    }
    return reply(404);
  }) as typeof fetch;
}

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import { errorMessage } from '../logic/util';
import { lockApp, loginSite, logoutSite, me, unlockApp } from '../server/auth';
import { Dialog } from './Dialog';

/** Whether the login form is open. */
const loginOpen = signal(false);
const setLoginOpen = (open: boolean) => void (loginOpen.value = open);

/** A link-styled button that opens the login form. */
export function LoginLink({
  class: cls = 'link-button',
  title,
  children,
}: {
  class?: string;
  title?: string;
  children: ComponentChildren;
}) {
  return (
    <button type="button" class={cls} title={title} onClick={() => setLoginOpen(true)}>
      {children}
    </button>
  );
}

/** Small form card: a title, fields, an error line and one submit button. */
function FormCard({
  title,
  intro,
  fields,
  submit,
  onSubmit,
  onCancel,
}: {
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
      setError(errorMessage(err));
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
            <input
              type="password"
              autocomplete="current-password"
              required
              value={password}
              onInput={e => setPassword(e.currentTarget.value)}
            />
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
          await loginSite(email, password);
          setLoginOpen(false);
        }}
        fields={
          <>
            <label class="field">
              <span>Email</span>
              <input
                autofocus
                type="email"
                autocomplete="username"
                required
                value={email}
                onInput={e => setEmail(e.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>Password</span>
              <input
                type="password"
                autocomplete="current-password"
                required
                value={password}
                onInput={e => setPassword(e.currentTarget.value)}
              />
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
        {site?.loggedIn
          ? `Logged in as ${site.email ?? site.name ?? 'you'}`
          : 'Not logged in to Triangle Liquidators'}
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
          <button
            type="button"
            class="btn-text"
            disabled={busy}
            onClick={act(lockApp)}
            title="Forget this device’s server password"
          >
            Lock app
          </button>
        )}
      </div>
    </div>
  );
}

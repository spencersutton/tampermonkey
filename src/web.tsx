// Entry point of the web app (the tlx server serves it; see server/): the
// catalog UI behind the server's password prompt, with the site login form
// available from anywhere.
import { effect, untracked } from '@preact/signals';
import { render } from 'preact';
import './app/app.css';
import { App } from './app/App';
import { AppLock, LoginDialog, me, startAuth } from './app/auth';
import { navFromUrl } from './app/history';
import { setSetting } from './app/settings';
import { KEYS } from './shared/keys';
import { startCatalog } from './app/source';

// A URL with parameters (/tlx?search=foo&sort=...) overrides the saved view, pages shown and open lot.
const fromUrl = navFromUrl();
// A link to just the Won / Lost page (/tlx?closed=won) keeps the current view.
if (fromUrl && new URLSearchParams(location.search).keys().some((k) => k !== 'closed')) {
  setSetting(KEYS.view, fromUrl.view);
}

// The catalog starts once the server is unlocked, so its first poll isn't refused.
let started = false;
effect(() => {
  if (!started && me.value && !me.value.app.locked) {
    started = true;
    untracked(startCatalog);
  }
});

function Root() {
  const state = me.value;
  if (!state) {
    return <p class="muted lock-page">Connecting…</p>;
  }
  if (state.app.locked) {
    return <AppLock />;
  }
  return (
    <>
      <App fromUrl={fromUrl} />
      <LoginDialog />
    </>
  );
}

startAuth();
render(<Root />, document.getElementById('app')!);

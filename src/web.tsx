// Entry point of the web app (the tlx server serves it; see server/): the
// catalog UI behind the server's password prompt, with the site login form
// available from anywhere.
import 'temporal-polyfill/global';
import { render } from 'preact';

import './app/app.css';
import { App } from './app/App';
import { AppLock, appUnlocked, LoginDialog, me, startAuth } from './app/auth';
import { startBrandWatch } from './app/brands';
import { error } from './app/catalog';
import { navFromUrl, startHistory } from './app/history';
import { startLiveWatch } from './app/live';
import { setSetting } from './app/settings';
import { settingsLoaded, settingsReady, startCatalog } from './app/source';
import { closed, filteredOnly, openId, page, startApp } from './app/state';
import { KEYS } from './shared/keys';

// A URL with parameters (/tlx?search=foo&sort=...) overrides the saved view, pages shown and open lot.
const fromUrl = navFromUrl();
if (fromUrl) {
  // A link to just the Won / Lost page (/tlx?closed=won) keeps the current view.
  if (new URLSearchParams(location.search).keys().some((k) => k !== 'closed')) {
    setSetting(KEYS.view, fromUrl.view);
  }
  page.value = fromUrl.page;
  openId.value = fromUrl.openId;
  closed.value = fromUrl.closed;
  filteredOnly.value = fromUrl.filteredOnly;
}

// The app starts once the server is unlocked, so its first requests aren't refused.
void appUnlocked.then(async () => {
  startCatalog();
  await settingsReady;
  startApp();
  startHistory();
  startLiveWatch();
  startBrandWatch();
});

function Root() {
  const state = me.value;
  if (!state) {
    return <p class="muted lock-page">Connecting…</p>;
  }
  if (state.app.locked) {
    return <AppLock />;
  }
  if (!settingsLoaded.value) {
    return <p class="muted lock-page">{error.value || 'Loading settings…'}</p>;
  }
  return (
    <>
      <App />
      <LoginDialog />
    </>
  );
}

startAuth();
render(<Root />, document.getElementById('app')!);

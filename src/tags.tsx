// Entry point of the tag rules page (/tags on the tlx server): a full-screen
// editor for the server's title rules, behind the same password prompt as the
// catalog.
import { render } from 'preact';

import './app/app.css';
import './tags/tags.css';
import { AppLock, me, startAuth } from './app/auth';
import { TagRulesPage } from './tags/TagRulesPage';

function Root() {
  const state = me.value;
  if (!state) {
    return <p class="muted lock-page">Connecting…</p>;
  }
  if (state.app.locked) {
    return <AppLock />;
  }
  return <TagRulesPage />;
}

startAuth();
render(<Root />, document.getElementById('app')!);

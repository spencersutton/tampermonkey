// Entry point of the web app (the tlx server serves it; see server/): the
// catalog UI behind the server's password prompt, with the site login form
// available from anywhere.
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './app/app.css';
import { App } from './app/App';
import { AppLock, LoginDialog, startAuth, useMe } from './app/auth-web';
import { source } from './app/source-web';

let started = false;

function Root() {
  const me = useMe();
  const unlocked = !!me && !me.app.locked;
  // The catalog starts once the server is unlocked, so its first poll isn't refused.
  useEffect(() => {
    if (unlocked && !started) {
      started = true;
      void source.start();
    }
  }, [unlocked]);
  if (!me) {
    return <p class="muted lock-page">Connecting…</p>;
  }
  if (me.app.locked) {
    return <AppLock />;
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

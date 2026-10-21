// /tlx is a 404 on the real site. At document-start we stop the page from
// loading (no Next.js bundles, images or API calls) and render our own app.
import { render } from 'preact';
import css from './app.css?inline';
import { App } from './App';
import { startAuth } from './auth';
import { source } from '@source';

/** Stop the site's page, build a fresh document, and mount the /tlx app in it. */
export function takeOver() {
  window.stop();
  const root = document.documentElement ?? document.appendChild(document.createElement('html'));
  root.replaceChildren();
  root.lang = 'en';

  const head = document.createElement('head');
  head.innerHTML = `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="icon" href="/favicon.ico">
    <title>TL Catalog</title>`;
  const style = document.createElement('style');
  style.textContent = css;
  head.appendChild(style);
  const body = document.createElement('body');
  const mount = document.createElement('div');
  body.appendChild(mount);
  root.append(head, body);

  // Belt and braces: drop any of the site's scripts that still make it in.
  const guard = new MutationObserver((records) => {
    for (const node of records.flatMap((r) => [...r.addedNodes])) {
      if (node instanceof HTMLScriptElement || (node instanceof HTMLLinkElement && node.rel !== 'icon')) {
        node.remove();
      }
    }
  });
  guard.observe(root, { childList: true, subtree: true });

  startAuth();
  render(<App />, mount);
  void source.start();
}

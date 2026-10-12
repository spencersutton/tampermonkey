import { runLegacy } from './legacy/legacy.js';
import { takeOver } from './app/takeover';

// The script runs at document-start so /tlx can be taken over before the
// site's own app loads. Everywhere else the site loads normally and the
// enhancements start once the DOM is ready (the old document-idle timing).
if (location.pathname.replace(/\/+$/, '') === '/tlx') {
  takeOver();
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runLegacy, { once: true });
} else {
  runLegacy();
}

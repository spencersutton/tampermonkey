import { takeOver } from './app/takeover';

// The script runs at document-start so /tlx can be taken over before the
// site's own app loads. The @match also catches paths like /tlxfoo, so the
// path is checked exactly here; the site's other pages are left untouched.
if (location.pathname.replace(/\/+$/, '') === '/tlx') {
  takeOver();
}

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { Dialog } = await vite.ssrLoadModule('/src/app/Dialog.tsx');

class Element {
  focused = 0;
  focus() { this.focused++; }
}

test('dialog refs own opening, focus and cleanup without component effects', (t) => {
  const previous = new Element();
  const content = new Element();
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: previous };
  t.after(() => {
    delete globalThis.HTMLElement;
    delete globalThis.document;
  });
  let open = false;
  let autofocus = false;
  const element = {
    firstElementChild: content,
    querySelector: () => autofocus ? new Element() : null,
    showModal: () => { open = true; },
    close: () => { open = false; },
  };
  const vnode = Dialog({ onClose: () => {}, children: null });
  assert.equal(vnode.ref(null), undefined);
  const cleanup = vnode.ref(element);
  assert.equal(open, true);
  assert.equal(content.focused, 1);
  cleanup();
  assert.equal(open, false);
  assert.equal(previous.focused, 1);

  autofocus = true;
  vnode.ref(element)();
  assert.equal(content.focused, 1, 'explicit autofocus is left to the browser');
});

test('dialog events use the current callback and ignore close events after removal', () => {
  let first = 0;
  let latest = 0;
  const initial = Dialog({ onClose: () => { first++; }, children: null });
  const updated = Dialog({ onClose: () => { latest++; }, children: null });
  assert.equal(initial.ref, updated.ref, 'rerenders do not restart DOM setup');
  let prevented = false;
  updated.props.onCancel({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(first, 0);
  assert.equal(latest, 1);
  let opened = 0;
  const element = { isConnected: true, showModal: () => { opened++; } };
  updated.props.onMouseDown({ target: {}, currentTarget: element });
  assert.equal(latest, 1, 'clicks inside the box do not close it');
  updated.props.onMouseDown({ target: element, currentTarget: element });
  assert.equal(latest, 2);
  updated.props.onClose({ currentTarget: element });
  assert.equal(opened, 1);
  assert.equal(latest, 3);
  element.isConnected = false;
  updated.props.onClose({ currentTarget: element });
  assert.equal(opened, 1);
  assert.equal(latest, 3);
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { h, render, options } from 'preact';
import { signal } from '@preact/signals';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { Dialog } = await vite.ssrLoadModule('/src/app/Dialog.tsx');

class Element {
  focused = 0;
  childNodes = [];
  /** @type {Element | null} */
  parentNode = null;
  attributes = [];
  style = {};
  open = false;
  showCount = 0;
  closeCount = 0;
  get firstChild() { return this.childNodes[0] ?? null; }
  get firstElementChild() { return this.firstChild; }
  get isConnected() { return this.parentNode != null; }
  insertBefore(child, before) {
    child.parentNode?.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
  }
  removeChild(child) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
  }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  showModal() { this.open = true; this.showCount++; }
  close() { this.open = false; this.closeCount++; }
  focus() { this.focused++; }
}

function mountDialog(t) {
  const previous = new Element();
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: previous, createElementNS: () => new Element() };
  const root = new Element();
  let vnode;
  const diffed = options.diffed;
  options.diffed = (node) => {
    diffed?.(node);
    if (node.type === 'dialog') vnode = node;
  };
  t.after(() => {
    render(null, root);
    options.diffed = diffed;
    delete globalThis.HTMLElement;
    delete globalThis.document;
  });
  return {
    root,
    previous,
    update(props) {
      render(h(Dialog, props), root);
      return vnode;
    },
  };
}

test('dialog combines the backdrop class with plain and signal class values', (t) => {
  const { update } = mountDialog(t);
  const props = { onClose: () => {}, children: null };
  assert.equal(update(props).props.class, 'backdrop ');
  assert.equal(update({ ...props, class: 'custom' }).props.class, 'backdrop custom');
  assert.equal(update({ ...props, class: signal('custom') }).props.class, 'backdrop custom');
  assert.equal(update({ ...props, class: signal(undefined) }).props.class, 'backdrop ');
});

test('dialog refs own opening, focus and cleanup without component effects', (t) => {
  const { previous, update } = mountDialog(t);
  const content = new Element();
  let open = false;
  let autofocus = false;
  const element = {
    firstElementChild: content,
    querySelector: () => autofocus ? new Element() : null,
    showModal: () => { open = true; },
    close: () => { open = false; },
  };
  const vnode = update({ onClose: () => {}, children: null });
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

test('closing a category dialog restores focus without scrolling to the updated lot', (t) => {
  const { root, previous, update } = mountDialog(t);
  let scrollY = 1800;
  let lotTop = 1900;
  previous.focus = (options) => {
    previous.focused++;
    if (!options?.preventScroll) scrollY = lotTop;
  };
  update({ onClose: () => {}, children: h('form', { tabIndex: -1 }) });

  // Saving can change category labels and the position of the original button.
  lotTop = 2050;
  render(null, root);
  assert.equal(previous.focused, 1);
  assert.equal(scrollY, 1800);
});

test('dialog events use the current callback and ignore close events after removal', (t) => {
  const { update } = mountDialog(t);
  let first = 0;
  let latest = 0;
  const initial = update({ onClose: () => { first++; }, children: null });
  const updated = update({ onClose: () => { latest++; }, children: null });
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

test('stacked dialogs keep independent ref cleanup across rerenders and unmounts', (t) => {
  const { root } = mountDialog(t);
  let closed = 0;
  const dialog = (key) => h(Dialog, { key, onClose: () => { closed++; }, children: null });
  render([dialog('lot')], root);
  const lot = root.firstChild;
  assert.equal(lot.open, true);

  render([dialog('lot'), dialog('bid')], root);
  const bid = root.childNodes[1];
  assert.equal(lot.open, true, 'opening confirmation must not close the lot');
  assert.equal(lot.closeCount, 0);
  assert.equal(bid.open, true);

  render([dialog('lot'), dialog('bid')], root);
  assert.equal(lot.showCount, 1, 'rerender must not reopen either dialog');
  assert.equal(bid.showCount, 1);
  render([dialog('lot')], root);
  assert.equal(bid.open, false);
  assert.equal(bid.closeCount, 1);
  assert.equal(lot.open, true);
  assert.equal(lot.closeCount, 0);

  render(null, root);
  assert.equal(lot.open, false);
  assert.equal(lot.closeCount, 1);
  assert.equal(bid.closeCount, 1, 'unmounting the lot must not rerun bid cleanup');
  assert.equal(closed, 0);
});

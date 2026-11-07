import htmx, { type HtmxBeforeSwapDetails, type HtmxResponseInfo } from 'htmx.org';
import './app.css';
import './web.css';
import { migrateSetting, timeLeft } from './time';

htmx.config.allowEval = false;
htmx.config.allowScriptTags = false;
htmx.config.historyCacheSize = 0;
htmx.config.selfRequestsOnly = true;
htmx.config.timeout = 35_000;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const all = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const tab = crypto.randomUUID();
const nearby = new Set<number>();
let source: EventSource | undefined;
let lastActivity = Date.now();
let hiddenAt = 0;
let requests = 0;
let refreshNeeded = false;
let refreshing = false;
let activityTimer: ReturnType<typeof setTimeout>;
let previewTimer: ReturnType<typeof setTimeout>;
let previousUrl = location.href;
let serverSkew = 0;
let lastServerNow = 0;
let generation = 0;
let liveGeneration = 0;
let restoreScroll = 0;
let scrollTimer: ReturnType<typeof setTimeout>;
let noticeTimer: ReturnType<typeof setTimeout>;
let sidebarOpen = false;
let initialized = false;
const sharedUrl = !!location.search && [...new URLSearchParams(location.search).keys()].some(key => key !== 'closed');
history.scrollRestoration = 'manual';

function notify(message: string) {
  const box = $('#notifications');
  if (!box) return;
  box.textContent = message;
  box.classList.add('error');
  box.setAttribute('role', 'alert');
  showNotice();
}

function showNotice() {
  const box = $('#notifications');
  if (!box?.textContent?.trim() || box.dataset['shown'] === box.textContent) return;
  box.dataset['shown'] = box.textContent;
  box.showPopover();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    if (box.isConnected) {
      box.hidePopover();
      box.replaceChildren();
      delete box.dataset['shown'];
    }
  }, 8000);
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(35_000),
    headers: { 'Content-Type': 'application/json', 'X-TLX-Client': '1' }, body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (response.status === 401) location.reload();
  if (!response.ok) {
    throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : `Server replied ${response.status}`);
  }
}

function activity() {
  if (!$('#app')) return;
  const ids = new Set(nearby);
  all('[data-dialog] [data-lot]').forEach(element => ids.add(Number(element.dataset['lot'])));
  void post('/api/activity', {
    tab, ids: [...ids], active: document.visibilityState === 'visible' && Date.now() - lastActivity < 600_000,
  }).catch(error => notify(String(error)));
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.target.isConnected || !(entry.target instanceof HTMLElement)) continue;
    const id = Number(entry.target.dataset['lot']);
    if (entry.isIntersecting) nearby.add(id); else nearby.delete(id);
  }
  clearTimeout(activityTimer);
  activityTimer = setTimeout(activity, 150);
}, { rootMargin: '600px 0px' });

function refresh() {
  refreshNeeded = true;
  if (refreshing || requests || document.hidden || !$('#app')) return;
  refreshing = true;
  refreshNeeded = false;
  liveGeneration = generation;
  void htmx.ajax('get', $('#app')!.dataset['url'] ?? location.pathname + location.search, {
    source: '#live-sink', target: '#live-sink', swap: 'innerHTML', headers: { 'X-TLX-Client': '1', 'X-TLX-Live': '1' },
  }).catch(error => {
    if (liveGeneration === generation) notify(`Could not refresh the page: ${String(error)}`);
  }).finally(() => {
    refreshing = false;
    if (refreshNeeded) refresh();
  });
}

function connect() {
  if (source || document.hidden || !$('#app')) return;
  source = new EventSource('/events');
  source.addEventListener('refresh', refresh);
  source.addEventListener('locked', () => location.reload());
  source.onerror = () => {
    const state = $('#status .live');
    if (state) state.textContent = 'Reconnecting...';
  };
}

function clocks() {
  const now = Date.now() + serverSkew;
  all<HTMLTimeElement>('time[data-ends]').forEach(element => {
    const ends = Number(element.dataset['ends']);
    element.textContent = timeLeft(ends, now);
    element.dateTime = new Date(ends).toISOString();
    element.title = new Date(ends).toLocaleString();
    element.classList.toggle('soon', ends - now < 3600_000);
  });
  all<HTMLTimeElement>('time[data-date]').forEach(element => {
    const date = new Date(Number(element.dataset['date']));
    element.textContent = date.toLocaleDateString();
    element.dateTime = date.toISOString();
  });
  all('time[data-ago]').forEach(element => {
    const minutes = Math.max(0, Math.round((now - Number(element.dataset['ago'])) / 60_000));
    element.textContent = minutes ? `${minutes} min ago` : 'just now';
  });
  all<HTMLButtonElement>('[data-next-pull]').forEach(button => {
    const wait = Number(button.dataset['nextPull']) - now;
    if (!$('#status progress')) {
      button.disabled = wait > 0;
      button.textContent = wait > 0 ? `Refresh in ${Math.ceil(wait / 1000)}s` : 'Refresh';
    }
  });
}

function closeDialog(dialog: HTMLDialogElement) {
  if (dialog.querySelector('[data-dirty-confirm][data-dirty="true"]') && !confirm('Discard your changes to custom categories?')) return;
  if (dialog.querySelector('form.htmx-request')) return;
  const url = dialog.dataset['closeUrl'] ?? '/tlx';
  if (dialog.dataset['dialog']?.startsWith('lot-') && history.state?.tlxLot) history.back();
  else void htmx.ajax('get', url, { target: '#app', swap: 'outerHTML' }).catch(error => notify(String(error)));
}

function initialize() {
  showNotice();
  const app = $('#app');
  if (!app) return;
  if (!initialized) {
    initialized = true;
    history.replaceState({ ...history.state, htmx: true }, '', app.dataset['url'] ?? location.href);
    previousUrl = location.href;
  }
  $('.sidebar')?.classList.toggle('open', sidebarOpen);
  $('[data-toggle-sidebar]')?.setAttribute('aria-expanded', String(sidebarOpen));
  const serverNow = Number($('#live-meta')?.dataset['serverNow'] ?? app.dataset['serverNow']);
  if (serverNow !== lastServerNow) {
    lastServerNow = serverNow;
    serverSkew = serverNow - Date.now();
  }
  app.dataset['serverNow'] = String(serverNow);
  const fresh = Number($('#live-meta')?.dataset['totalNew'] ?? app.dataset['totalNew'] ?? 0);
  app.dataset['totalNew'] = String(fresh);
  document.title = `${fresh ? `(${fresh}) ` : ''}TL Catalog`;
  $('#live-meta')?.removeAttribute('data-total-new');
  $('#live-meta')?.removeAttribute('data-server-now');
  observer.disconnect();
  nearby.clear();
  all('.card[data-lot]').forEach(element => observer.observe(element));
  all<HTMLInputElement>('[data-branch]').forEach(input => {
    const values: string[] = JSON.parse(input.dataset['branch']!);
    const selected = all<HTMLInputElement>('#filters input[name="category"]:checked').filter(child => values.includes(child.value)).length;
    input.indeterminate = selected > 0 && selected < values.length;
  });
  all<HTMLDialogElement>('dialog[data-dialog]').forEach(dialog => {
    if (dialog.open) return;
    dialog.showModal();
    if (!dialog.querySelector('[autofocus]')) dialog.querySelector<HTMLElement>('[tabindex]')?.focus();
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
  });
  try {
    const collapsed: unknown = JSON.parse(localStorage.getItem('tlx:collapsedLists') ?? '{}');
    if (collapsed && typeof collapsed === 'object') {
      for (const details of all<HTMLDetailsElement>('details[data-collapse]')) {
        const key = details.dataset['collapse']!;
        if (key in collapsed) details.open = !Reflect.get(collapsed, key);
      }
    }
  } catch (error) {
    console.warn('Could not restore collapsed panels', error);
  }
  clocks();
  activity();
  connect();
  const typeForm = $<HTMLFormElement>('#type-category');
  if (typeForm && !typeForm.dataset['previewed']) {
    typeForm.dataset['previewed'] = '1';
    preview(typeForm);
  }
}

function imageStep(delta: number) {
  const images = all<HTMLButtonElement>('[data-image]');
  const current = Math.max(0, images.findIndex(button => button.classList.contains('on')));
  images[(current + delta + images.length) % images.length]?.click();
}

function preview(form: HTMLFormElement, selected?: string) {
  const values = new FormData(form);
  if (selected != null) values.set('selected', selected);
  const categories = form.id === 'category-editor';
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void htmx.ajax('post', `/ui/${categories ? 'categories-preview' : 'type-preview'}`, {
      source: form, target: categories ? '#category-preview' : '#type-preview', swap: 'outerHTML',
      headers: { 'X-TLX-Client': '1' }, values,
    }).catch(error => notify(String(error)));
  }, 250);
}

document.addEventListener('click', event => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.sidebar a[href]') : null;
  if (link && new URL(link.href).searchParams.has('closed')) sidebarOpen = false;
  if (event.target instanceof Element && event.target.closest('#notifications')) {
    const box = $('#notifications')!;
    box.hidePopover();
    box.replaceChildren();
    delete box.dataset['shown'];
  }
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [data-image]') : null;
  if (!target) return;
  if (target.hasAttribute('data-close-dialog')) {
    const dialog = target.closest('dialog');
    if (dialog) closeDialog(dialog);
  }
  if (target.hasAttribute('data-toggle-sidebar')) {
    sidebarOpen = !sidebarOpen;
    $('.sidebar')?.classList.toggle('open', sidebarOpen);
    target.setAttribute('aria-expanded', String(sidebarOpen));
  }
  if (target.dataset['only']) {
    const values: string[] = JSON.parse(target.dataset['only']);
    all<HTMLInputElement>('#filters input[name="category"]').forEach(input => { input.checked = values.includes(input.value); });
    $('#filters')?.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (target.dataset['expandCategories'] != null) {
    all<HTMLDetailsElement>('.category-tree details').forEach(details => { details.open = target.dataset['expandCategories'] === '1'; });
  }
  if (target.dataset['image']) {
    const image = $<HTMLImageElement>('#gallery-image');
    if (image) image.src = target.dataset['image'];
    all('[data-image]').forEach(button => button.classList.toggle('on', button === target));
  }
  if (target.dataset['imageStep']) imageStep(Number(target.dataset['imageStep']));
  const form = target.closest<HTMLFormElement>('#category-editor');
  if (!form) return;
  if (target.hasAttribute('data-add-category')) {
    const template = $<HTMLTemplateElement>('#category-row-template');
    if (!template) return;
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const key = crypto.randomUUID();
    row.dataset['categoryRow'] = key;
    row.querySelector<HTMLInputElement>('[name="cat-key"]')!.value = key;
    row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-name]').forEach(input => { input.name = `${input.dataset['name']}-${key}`; });
    row.querySelector<HTMLElement>('[data-preview-category]')!.dataset['previewCategory'] = key;
    form.querySelector('ol')!.append(row);
    row.querySelector<HTMLInputElement>('.cat-name')!.focus();
    form.dataset['dirty'] = 'true';
  }
  if (target.hasAttribute('data-remove-category')) {
    target.closest('[data-category-row]')?.remove();
    form.dataset['dirty'] = 'true';
  }
  if (target.hasAttribute('data-add-type')) {
    const row = target.closest('[data-category-row]')!;
    const input = row.querySelector<HTMLInputElement>('.type-add')!;
    const types = row.querySelector<HTMLTextAreaElement>('.cat-types')!;
    if (input.value.trim()) types.value = [...new Set([...types.value.split('\n'), input.value.trim().toLowerCase()])].filter(Boolean).join('\n');
    input.value = '';
    types.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (target.dataset['previewCategory'] != null) preview(form, target.dataset['previewCategory']);
});

document.addEventListener('change', event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.dataset['branch']) {
    const values: string[] = JSON.parse(input.dataset['branch']);
    all<HTMLInputElement>('#filters input[name="category"]').forEach(child => { if (values.includes(child.value)) child.checked = input.checked; });
  }
  if ((input instanceof HTMLInputElement || input instanceof HTMLSelectElement) && input.form?.id === 'filters' && !input.form.contains(input)) {
    htmx.trigger(input.form, 'change');
  }
}, true);

document.addEventListener('input', event => {
  if (!(event.target instanceof HTMLElement)) return;
  const target = event.target;
  const form = target.closest<HTMLFormElement>('form');
  if (form?.hasAttribute('data-dirty-confirm')) form.dataset['dirty'] = 'true';
  if (target instanceof HTMLInputElement && target.hasAttribute('data-category-search')) {
    all<HTMLOptionElement>('#type-category select option').forEach(option => { option.hidden = !option.text.toLowerCase().includes(target.value.toLowerCase()); });
  }
  if (form?.id === 'category-editor') preview(form, target.closest<HTMLElement>('[data-category-row]')?.dataset['categoryRow']);
  if (form?.id === 'type-category') preview(form);
  if (form?.id === 'category-editor' && target instanceof HTMLInputElement && target.classList.contains('cat-name')) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const list = form.querySelector('ol')!;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-category-row]')];
    rows.sort((a, b) => a.querySelector<HTMLInputElement>('.cat-name')!.value.localeCompare(b.querySelector<HTMLInputElement>('.cat-name')!.value, undefined, { numeric: true, sensitivity: 'base' }));
    for (const row of rows) list.append(row);
    target.focus();
    target.setSelectionRange(start, end);
  }
});

document.addEventListener('focusin', event => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains('type-add')) return;
  const selected = new Set(event.target.closest('[data-category-row]')!.querySelector<HTMLTextAreaElement>('.cat-types')!.value.toLowerCase().split('\n'));
  all<HTMLOptionElement>('#category-type-options option').forEach(option => { option.disabled = selected.has(option.value); });
});
document.addEventListener('focusout', event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.hasAttribute('data-select') && input.isConnected && input.closest('details')?.open && !input.form?.classList.contains('htmx-request')) {
    input.form?.requestSubmit();
  }
});
document.addEventListener('submit', event => {
  clearTimeout(previewTimer);
  if (event.target instanceof HTMLFormElement && new URL(event.target.action).pathname === '/ui/search-open') sidebarOpen = false;
}, true);

document.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (event.key === 'Escape' && typing && event.target.hasAttribute('data-select')) {
    event.preventDefault();
    event.stopPropagation();
    const details = event.target.closest('details');
    if (details) details.open = false;
  } else if (!typing && event.key === 'ArrowLeft') imageStep(-1);
  else if (!typing && event.key === 'ArrowRight') imageStep(1);
});

document.addEventListener('toggle', event => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  if (details.open) details.querySelector<HTMLInputElement>('[data-select]')?.select();
  if (details.dataset['collapse']) {
    try {
      const state = JSON.parse(localStorage.getItem('tlx:collapsedLists') ?? '{}');
      localStorage.setItem('tlx:collapsedLists', JSON.stringify({ ...state, [details.dataset['collapse']]: !details.open }));
    } catch (error) { console.warn('Could not save collapsed panels', error); }
  }
}, true);

document.addEventListener('htmx:beforeRequest', event => {
  const info = (event as CustomEvent<HtmxResponseInfo>).detail;
  if (info.requestConfig.headers['X-TLX-Live'] !== '1') {
    generation++;
    if (refreshing) htmx.trigger('#live-sink', 'htmx:abort');
  }
  requests++;
});
document.addEventListener('htmx:afterRequest', event => {
  requests = Math.max(0, requests - 1);
  const info = (event as CustomEvent<HtmxResponseInfo>).detail;
  if (info.xhr.status === 401 && !info.requestConfig.path.endsWith('/ui/unlock')) location.reload();
  if (refreshNeeded && !refreshing) refresh();
});
document.addEventListener('htmx:beforeSwap', event => {
  const info = (event as CustomEvent<HtmxBeforeSwapDetails>).detail;
  if (info.requestConfig.headers['X-TLX-Live'] === '1' && liveGeneration !== generation) {
    info.shouldSwap = false;
    return;
  }
  if (info.xhr.status >= 400) {
    info.shouldSwap = !!info.xhr.getResponseHeader('HX-Retarget');
    if (!info.shouldSwap) notify(`Request failed (${info.xhr.status}). Please try again.`);
  }
});
document.addEventListener('htmx:sendError', () => notify('Cannot reach the server. Check your connection.'));
document.addEventListener('htmx:timeout', () => notify('The request timed out. If you were bidding, check the lot before trying again.'));
document.addEventListener('htmx:afterSettle', () => {
  const before = new URL(previousUrl);
  if (!before.searchParams.has('lot') && new URL(location.href).searchParams.has('lot')) {
    history.replaceState({ ...history.state, tlxLot: true }, '');
  }
  previousUrl = location.href;
  const app = $('#app');
  if (app) app.dataset['url'] = location.pathname + location.search;
  initialize();
});

for (const name of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) {
  document.addEventListener(name, () => { lastActivity = Date.now(); }, { passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    source?.close();
    source = undefined;
    activity();
  } else {
    lastActivity = Date.now();
    if (hiddenAt && Date.now() - hiddenAt >= 1800_000) {
      void post('/api/visit', {}).then(refresh).catch(error => notify(String(error)));
    }
    connect();
    activity();
    refresh();
  }
});
window.addEventListener('pagehide', () => { source?.close(); source = undefined; });
window.addEventListener('pageshow', connect);
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => history.replaceState({ ...history.state, tlxScroll: scrollY }, ''), 200);
}, { passive: true });
window.addEventListener('popstate', event => { restoreScroll = event.state?.tlxScroll ?? 0; });
document.addEventListener('htmx:historyRestore', () => {
  initialize();
  previousUrl = location.href;
  window.scrollTo(0, restoreScroll);
});

async function migrate() {
  const app = $('#app');
  if (!app) return;
  const values: Record<string, unknown> = {};
  if (app.dataset['imported'] !== '1') {
    const keys = ['hiddenLots', 'filterWords', 'filterEnabled', 'showHidden', 'removeFiltered', 'tlxSyncMinutes', 'tlxPickup', 'tlxView', 'tlxDefaultFilters', 'tlxSavedSearches', 'tlxCustomCategories', 'tlxLastCategory', 'tlxTitleLines', 'tlxLastVisit', 'tlxNameMatch'];
    for (const key of keys) {
      const raw = localStorage.getItem(`tlx:${key}`);
      if (raw != null) values[key] = migrateSetting(key, JSON.parse(raw));
    }
  }
  await post('/api/import', { values, shared: sharedUrl, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (app.dataset['imported'] !== '1') {
    await htmx.ajax('get', sharedUrl ? location.pathname + location.search : '/tlx', { target: '#app', swap: 'outerHTML', headers: { 'X-TLX-Init': '1' } });
  }
}

initialize();
void migrate().catch(error => notify(`Could not restore browser preferences: ${String(error)}`));
setInterval(clocks, 1000);
setInterval(activity, 30_000);

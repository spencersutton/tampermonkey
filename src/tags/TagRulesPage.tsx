// The tag rules editor: every rule on the left (pattern, tags, lots matched),
// and on the right the rule being written or changed with a live preview of
// the current lots its pattern matches, the matched text marked.
import { computed, signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';

import { Icon } from '../app/icons';
import { fmtCount } from '../app/util';
import { cleanTag, tagLabel } from '../shared/tags';
import {
  ApiError,
  deleteRule,
  loadOverview,
  previewRule,
  saveRule,
  type Overview,
  type Preview,
  type PreviewMatch,
} from './api';

const PREVIEW_DELAY = 250;

interface Draft {
  id: number | null; // null for a new rule
  pattern: string;
  tags: string[];
}

const EMPTY: Draft = { id: null, pattern: '', tags: [] };

const overview = signal<Overview | null>(null);
const loadError = signal<string | null>(null);
const draft = signal<Draft>(EMPTY);
/** The draft as it was loaded, to tell whether it has unsaved changes. */
const saved = signal<Draft>(EMPTY);
const notice = signal<string | null>(null);
/** Bumped after every save or delete, so the preview shows the tags lots have now. */
const revision = signal(0);

const sameDraft = (a: Draft, b: Draft) =>
  a.id === b.id && a.pattern === b.pattern && a.tags.join('\n') === b.tags.join('\n');
const dirty = computed(() => !sameDraft(draft.value, saved.value));

async function refresh() {
  try {
    overview.value = await loadOverview();
    revision.value++;
    loadError.value = null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

/** Open a rule (or a blank one) in the editor, after confirming unsaved changes are dropped. */
function edit(next: Draft) {
  if (dirty.peek() && !confirm('Discard your unsaved changes to this rule?')) {
    return;
  }
  draft.value = next;
  saved.value = next;
  notice.value = null;
}

const lotsText = (n: number) => `${fmtCount(n)} lot${n === 1 ? '' : 's'}`;

export function TagRulesPage() {
  useEffect(() => {
    void refresh();
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.peek()) {
        e.preventDefault();
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);
  return (
    <div class="tr-page">
      <header class="topbar tr-topbar">
        <a class="brand" href="/tlx" title="Back to the catalog">
          TL <span>Tag rules</span>
        </a>
        <p class="muted small tr-intro">
          Every lot whose title matches a rule’s pattern gets its tags, including lots in future
          pulls.
        </p>
        <a class="btn btn-outline btn-small" href="/tlx">
          <Icon name="chevronLeft" size={16} /> Catalog
        </a>
      </header>
      <main class="tr-main">
        <RuleList />
        <Editor />
      </main>
    </div>
  );
}

function RuleList() {
  const [filter, setFilter] = useState('');
  const data = overview.value;
  const q = filter.trim().toLowerCase();
  const rules = (data?.rules ?? []).filter(
    r => !q || r.pattern.toLowerCase().includes(q) || r.tags.some(t => t.includes(q)),
  );
  const current = draft.value.id;
  return (
    <section class="tr-pane tr-rules" aria-labelledby="tr-rules-title">
      <div class="tr-pane-head">
        <h2 id="tr-rules-title">
          Rules {data && <span class="muted">{fmtCount(data.rules.length)}</span>}
        </h2>
        <button type="button" class="btn btn-small" onClick={() => edit(EMPTY)}>
          <Icon name="add" size={16} /> New rule
        </button>
      </div>
      {(data?.rules.length ?? 0) > 5 && (
        <input
          class="search tr-filter"
          type="search"
          placeholder="Find a rule by pattern or tag"
          value={filter}
          onInput={e => setFilter(e.currentTarget.value)}
        />
      )}
      {loadError.value && <p class="error small">{loadError.value}</p>}
      {!data && !loadError.value && <p class="muted">Loading…</p>}
      {data && !data.rules.length && (
        <p class="muted tr-empty">
          No rules yet. Write a pattern, check which lots it matches, and give them tags.
        </p>
      )}
      <ul class="tr-rule-list">
        {rules.map(r => (
          <li key={r.id}>
            <button
              type="button"
              class={`tr-rule${r.id === current ? ' selected' : ''}`}
              aria-current={r.id === current}
              onClick={() => edit({ id: r.id, pattern: r.pattern, tags: r.tags })}
            >
              <code class="tr-pattern">{r.pattern}</code>
              <span class="tr-rule-tags">
                {r.tags.map(t => (
                  <span key={t} class="tr-tag">
                    {tagLabel(t)}
                  </span>
                ))}
              </span>
              <span class={`tr-count${r.lots ? '' : ' none'}`}>{lotsText(r.lots ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The current lots the draft rule matches, with the tags it would add, fetched as it's typed. */
function usePreview(pattern: string, tags: string[], rev: number) {
  const [state, setState] = useState<{
    preview: Preview | null;
    error: string | null;
    errorField: string | null;
    busy: boolean;
  }>({ preview: null, error: null, errorField: null, busy: false });
  const tagKey = tags.join('\n');
  useEffect(() => {
    if (!pattern.trim()) {
      setState({ preview: null, error: null, errorField: null, busy: false });
      return;
    }
    const ctl = new AbortController();
    setState(s => ({ ...s, busy: true }));
    const timer = setTimeout(() => {
      previewRule(pattern, tagKey ? tagKey.split('\n') : [], ctl.signal).then(
        preview => setState({ preview, error: null, errorField: null, busy: false }),
        (e: unknown) => {
          if (!ctl.signal.aborted) {
            setState({
              preview: null,
              error: e instanceof Error ? e.message : String(e),
              errorField: e instanceof ApiError ? e.field : null,
              busy: false,
            });
          }
        },
      );
    }, PREVIEW_DELAY);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [pattern, tagKey, rev]);
  return state;
}

function Editor() {
  const d = draft.value;
  const { preview, error, errorField, busy } = usePreview(d.pattern, d.tags, revision.value);
  const patternError = error && errorField !== 'tags' ? error : null;
  const tagsError = errorField === 'tags' ? error : null;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const patternRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Draft>) => {
    draft.value = { ...draft.value, ...patch };
    setSaveError(null);
    notice.value = null;
  };
  useEffect(() => patternRef.current?.focus(), [d.id]);

  const submitLabel = d.id == null ? 'Add rule' : 'Save changes';
  const canSave = Boolean(d.pattern.trim() && d.tags.length && !error && dirty.value && !saving);
  const run = async (fn: () => Promise<string>) => {
    setSaving(true);
    setSaveError(null);
    try {
      notice.value = await fn();
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const save = () =>
    run(async () => {
      const { rule, changed } = await saveRule(d.id, d.pattern, d.tags);
      const next = { id: rule.id, pattern: rule.pattern, tags: rule.tags };
      draft.value = next;
      saved.value = next;
      return `Saved. ${lotsText(changed)} changed.`;
    });
  const remove = () => {
    if (d.id == null || !confirm('Delete this rule? The tags it gave go away.')) {
      return;
    }
    const id = d.id;
    void run(async () => {
      const { changed } = await deleteRule(id);
      draft.value = EMPTY;
      saved.value = EMPTY;
      return `Deleted. ${lotsText(changed)} changed.`;
    });
  };

  return (
    <section class="tr-pane tr-editor" aria-labelledby="tr-editor-title">
      <form
        class="tr-form"
        onSubmit={e => {
          e.preventDefault();
          if (canSave) {
            void save();
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSave) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div class="tr-pane-head">
          <h2 id="tr-editor-title">{d.id == null ? 'New rule' : `Rule ${d.id}`}</h2>
          {dirty.value && <span class="muted small">Unsaved changes</span>}
        </div>
        <label class="tr-field">
          <span>Title pattern</span>
          <input
            ref={patternRef}
            class={`tr-input mono${patternError ? ' invalid' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder={String.raw`e.g. satin nickel   or   \bcabinet (knob|pull)s?\b`}
            value={d.pattern}
            onInput={e => update({ pattern: e.currentTarget.value })}
            aria-invalid={Boolean(patternError)}
            aria-describedby="tr-pattern-help"
          />
          <small id="tr-pattern-help" class={patternError ? 'error' : 'muted'}>
            {patternError ??
              'A regular expression (JavaScript syntax), matched anywhere in the title, ignoring case.'}
          </small>
        </label>
        <div class="tr-field">
          <span id="tr-tags-label">Tags to give</span>
          <TagInput
            tags={d.tags}
            invalid={Boolean(tagsError)}
            onChange={tags => update({ tags })}
          />
          {tagsError && <small class="error">{tagsError}</small>}
          <small class="muted">
            Use <code>name: value</code> for an attribute (<code>finish: brass</code>) to get a
            filter dropdown for it in the catalog. Press Enter or comma after each tag.
          </small>
          <small class="muted">
            Fill in what the pattern captured with <code>$1</code>, <code>$2</code>… or{' '}
            <code>{'${name}'}</code> for <code>{'(?<name>…)'}</code>, and <code>$0</code> for the
            whole match: pattern <code>(satin nickel|brass|chrome)</code> with tag{' '}
            <code>finish: $1</code>. A tag whose group captured nothing is skipped.
          </small>
        </div>
        <div class="tr-actions">
          <button type="submit" class="btn" disabled={!canSave} aria-disabled={!canSave}>
            {saving ? 'Saving…' : submitLabel}
          </button>
          {dirty.value && (
            <button
              type="button"
              class="btn btn-outline"
              onClick={() => (draft.value = saved.value)}
            >
              Revert
            </button>
          )}
          {d.id != null && (
            <button
              type="button"
              class="btn btn-outline tr-delete"
              onClick={remove}
              disabled={saving}
            >
              <Icon name="delete" size={16} /> Delete
            </button>
          )}
          {saveError && <span class="error small">{saveError}</span>}
          {notice.value && <span class="tr-notice small">{notice.value}</span>}
        </div>
      </form>
      <PreviewList preview={preview} busy={busy} hasPattern={Boolean(d.pattern.trim())} />
    </section>
  );
}

/** Tags as removable chips, with a text box (suggesting tags in use) to add more. */
function TagInput({
  tags,
  invalid,
  onChange,
}: {
  tags: string[];
  invalid: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState('');
  /** Add each comma-separated tag in `raw` that isn't there yet. */
  const add = (raw: string) => {
    // Tags differing only in case are the same tag; the first spelling stays.
    const next = [...tags];
    for (const tag of raw.split(',').map(cleanTag)) {
      if (tag && !next.some(t => t.toLowerCase() === tag.toLowerCase())) {
        next.push(tag);
      }
    }
    if (next.length > tags.length) {
      onChange(next);
    }
    setText('');
  };
  return (
    <div
      class={`tr-tag-input${invalid ? ' invalid' : ''}`}
      onClick={e => e.currentTarget.querySelector('input')?.focus()}
    >
      {tags.map(t => (
        <button
          type="button"
          key={t}
          class="chip"
          title={`Remove ${tagLabel(t)}`}
          onClick={() => onChange(tags.filter(x => x !== t))}
        >
          <span>{tagLabel(t)}</span>
          <Icon name="close" size={14} />
        </button>
      ))}
      <input
        list="tr-known-tags"
        aria-labelledby="tr-tags-label"
        placeholder={tags.length ? 'Add another' : 'e.g. finish: satin nickel'}
        value={text}
        onInput={e => {
          // A comma ends a tag (typed or pasted); what follows the last one stays in the box.
          const v = e.currentTarget.value;
          const cut = v.lastIndexOf(',');
          if (cut < 0) {
            setText(v);
            return;
          }
          add(v.slice(0, cut));
          setText(v.slice(cut + 1));
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id="tr-known-tags">
        {overview.value?.tags.map(([t, n]) => (
          <option key={t} value={t}>
            {lotsText(n)}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function PreviewList({
  preview,
  busy,
  hasPattern,
}: {
  preview: Preview | null;
  busy: boolean;
  hasPattern: boolean;
}) {
  return (
    <div class="tr-preview" aria-live="polite" aria-busy={busy}>
      <div class="tr-preview-head">
        <h2>Matching lots</h2>
        {preview && (
          <span class="muted">
            {lotsText(preview.lots)} · {fmtCount(preview.titles)} distinct title
            {preview.titles === 1 ? '' : 's'}
            {preview.matches.length < preview.titles &&
              ` (first ${fmtCount(preview.matches.length)} shown)`}
          </span>
        )}
        {busy && <span class="muted small">Checking…</span>}
      </div>
      {!hasPattern && <p class="muted tr-empty">Type a pattern to see which lots it matches.</p>}
      {hasPattern && preview?.lots === 0 && (
        <p class="muted tr-empty">No current lot titles match this pattern.</p>
      )}
      <ul class="tr-matches">
        {preview?.matches.map(m => (
          <MatchRow key={m.title} m={m} />
        ))}
      </ul>
    </div>
  );
}

function MatchRow({ m }: { m: PreviewMatch }) {
  // The server counts the span in code points.
  const chars = Array.from(m.title);
  const [start, end] = m.span;
  return (
    <li class="tr-match">
      <a class="tr-match-title" href={`/tlx?lot=${m.lotId}`} target="_blank" rel="noopener">
        {chars.slice(0, start).join('')}
        <mark>{chars.slice(start, end).join('')}</mark>
        {chars.slice(end).join('')}
      </a>
      {m.lots > 1 && <span class="tr-count">×{fmtCount(m.lots)}</span>}
      <span class="tr-match-tags">
        {m.tags.map(t => (
          <span key={t} class="tr-tag">
            {tagLabel(t)}
          </span>
        ))}
        {m.adds.map(t => (
          <span key={t} class="tr-tag new" title="This rule would add it">
            + {tagLabel(t)}
          </span>
        ))}
      </span>
    </li>
  );
}

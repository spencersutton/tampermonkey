// Reactive state and server-backed actions for the tag rules editor.
// Zero Preact/DOM/UI dependencies.
import { computed, signal } from '@preact/signals';

import { errorMessage, plural } from '../app/logic/util';
import {
  ApiError,
  deleteRule,
  loadOverview,
  previewRule,
  saveRule,
  type Overview,
  type Preview,
} from './api';
import { EMPTY_DRAFT, sameDraft, type TagDraft } from './logic';

const PREVIEW_DELAY = 250;

export const overview = signal<Overview | null>(null);
export const loadError = signal<string | null>(null);
export const draft = signal<TagDraft>(EMPTY_DRAFT);
/** The draft as it was loaded, to tell whether it has unsaved changes. */
export const saved = signal<TagDraft>(EMPTY_DRAFT);
export const notice = signal<string | null>(null);
/** Bumped after every save or delete, so the preview shows the tags lots have now. */
export const revision = signal(0);

export const dirty = computed(() => !sameDraft(draft.value, saved.value));

export async function refreshOverview(): Promise<void> {
  try {
    overview.value = await loadOverview();
    revision.value++;
    loadError.value = null;
  } catch (e) {
    loadError.value = errorMessage(e);
  }
}

export function selectDraft(next: TagDraft): void {
  draft.value = next;
  saved.value = next;
  notice.value = null;
}

export function updateDraft(patch: Partial<TagDraft>): void {
  draft.value = { ...draft.value, ...patch };
  notice.value = null;
}

export function revertDraft(): void {
  draft.value = saved.value;
}

export async function commitDraft(): Promise<void> {
  const d = draft.value;
  const { rule, changed } = await saveRule(d.id, d.pattern, d.tags);
  const next: TagDraft = { id: rule.id, pattern: rule.pattern, tags: rule.tags };
  draft.value = next;
  saved.value = next;
  notice.value = `Saved. ${plural(changed, 'lot')} changed.`;
  await refreshOverview();
}

export async function removeDraft(id: number): Promise<void> {
  const { changed } = await deleteRule(id);
  draft.value = EMPTY_DRAFT;
  saved.value = EMPTY_DRAFT;
  notice.value = `Deleted. ${plural(changed, 'lot')} changed.`;
  await refreshOverview();
}

export interface PreviewState {
  preview: Preview | null;
  error: string | null;
  errorField: string | null;
  busy: boolean;
}

/**
 * Debounced server preview for a rule draft; returns a cleanup function that cancels pending timers
 * and in-flight requests.
 */
export function startPreview(
  pattern: string,
  tags: string[],
  onUpdate: (update: PreviewState | ((prev: PreviewState) => PreviewState)) => void,
): () => void {
  if (!pattern.trim()) {
    onUpdate({ preview: null, error: null, errorField: null, busy: false });
    return () => {};
  }
  const ctl = new AbortController();
  onUpdate(s => ({ ...s, busy: true }));
  const timer = setTimeout(() => {
    previewRule(pattern, tags, ctl.signal).then(
      preview => onUpdate({ preview, error: null, errorField: null, busy: false }),
      (e: unknown) => {
        if (!ctl.signal.aborted) {
          onUpdate({
            preview: null,
            error: errorMessage(e),
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
}

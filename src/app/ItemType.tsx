import { useMemo, useState } from 'preact/hooks';
import { collator } from '../shared/sortKey';
import { lots } from './catalog';
import { Dialog } from './Dialog';
import { Icon } from './icons';
import { setItemType } from './source';
import { addType, editType } from './state';
import { toast } from './toast';
import type { Lot } from './types';

export const MAX_ITEM_TYPE_LENGTH = 60;

export function itemTypeError(name: string): string | null {
  if (!name.trim()) {
    return 'Item type is required';
  }
  return name.length > MAX_ITEM_TYPE_LENGTH ? `Use at most ${MAX_ITEM_TYPE_LENGTH} characters` : null;
}

export function ItemTypeActions({ lot }: { lot: Lot }) {
  return (
    <div class="item-type-row">
      {lot.itemType && (
        <button type="button" class="item-type" title="Make a category of this item type" onClick={() => addType(lot)}>
          <span>{lot.itemType}</span>
          <Icon name="add" size={14} />
        </button>
      )}
      <button
        type="button"
        class="icon-btn item-type-edit"
        title={lot.itemType ? 'Change item type' : 'Set item type'}
        aria-label={lot.itemType ? 'Change item type' : 'Set item type'}
        onClick={() => editType(lot)}
      >
        <Icon name="edit" size={14} />
        {!lot.itemType && <span>Set item type</span>}
      </button>
    </div>
  );
}

export function ItemTypeEditor({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const [name, setName] = useState(lot.itemType ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalog = lots.value;
  const suggestions = useMemo(
    () => [...new Set([...catalog.values()].flatMap((l) => l.itemType ? [l.itemType] : []))].sort(collator.compare),
    [catalog],
  );
  const validation = itemTypeError(name);
  const close = () => {
    if (!saving) {
      onClose();
    }
  };
  const save = async () => {
    if (saving || validation) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await setItemType(lot.id, name.trim());
      toast('good', `Item type saved: ${saved}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };
  return (
    <Dialog onClose={close} aria-labelledby="item-type-title">
      <form class="confirm" tabIndex={-1} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 id="item-type-title">Change item type</h2>
        <div class="confirm-body">
          <p class="confirm-lot">{lot.title}</p>
          <label class="field">
            <span>Item type</span>
            <input
              type="text"
              value={name}
              autoFocus
              required
              maxLength={MAX_ITEM_TYPE_LENGTH}
              list="item-type-options"
              disabled={saving}
              aria-describedby={`item-type-help${error || validation ? ' item-type-error' : ''}`}
              aria-invalid={!!validation}
              onInput={(e) => { setName(e.currentTarget.value); setError(null); }}
            />
            <datalist id="item-type-options">
              {suggestions.map((type) => <option key={type} value={type} />)}
            </datalist>
          </label>
          <p id="item-type-help" class="muted small">
            Pick an existing type or enter a short, singular name, like "drill driver". Saved in lowercase for all listings with this exact title,
            including future relistings. Automatic labelling will not replace your correction.
          </p>
          {(error || validation) && <p id="item-type-error" class="error" role="alert">{error || validation}</p>}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" disabled={saving} onClick={close}>Cancel</button>
          <button type="submit" class="btn" disabled={saving || !!validation}>{saving ? 'Saving...' : 'Save item type'}</button>
        </div>
      </form>
    </Dialog>
  );
}

import { useMemo, useState } from 'preact/hooks';

import { MAX_TYPE_LENGTH } from '../../shared/itemtype';
import { itemTypeError, itemTypeSuggestions } from '../logic/catalog';
import { errorMessage } from '../logic/util';
import { lots } from '../server/catalog';
import { setItemType } from '../server/source';
import { toast } from '../server/toast';
import type { Lot } from '../types';
import { Dialog } from './Dialog';
import { hasModifierKey } from './dom';
import { Icon } from './icons';
import { hideItemType, modalActions, setView, storedView } from './state';

export function ItemTypeActions({ lot }: { lot: Lot }) {
  const type = lot.itemType;
  return (
    <div class="item-type-row">
      {type && (
        <>
          <button
            type="button"
            class="item-type"
            title={`Show only ${type}`}
            onClick={() =>
              setView({
                types: [type],
                excludedTypes: storedView.value.excludedTypes.filter(t => t !== type),
              })
            }
          >
            <span>{type}</span>
          </button>
          <button
            type="button"
            class="icon-btn item-type-hide"
            title={`Hide item type: ${type} (hold modifier key for this search only)`}
            aria-label={`Hide item type: ${type}`}
            onClick={(e?: MouseEvent) =>
              hideItemType(type, e?.currentTarget, Boolean(e && hasModifierKey(e)))
            }
          >
            <Icon name="visibilityOff" size={14} />
          </button>
        </>
      )}
      <button
        type="button"
        class="icon-btn item-type-edit"
        title={lot.itemType ? 'Change item type' : 'Set item type'}
        aria-label={lot.itemType ? 'Change item type' : 'Set item type'}
        onClick={() => modalActions.editType(lot)}
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
  const suggestions = useMemo(() => itemTypeSuggestions(catalog.values()), [catalog]);
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
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  return (
    <Dialog onClose={close} aria-labelledby="item-type-title">
      <form
        class="confirm"
        tabIndex={-1}
        onSubmit={e => {
          e.preventDefault();
          void save();
        }}
      >
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
              maxLength={MAX_TYPE_LENGTH}
              list="item-type-options"
              disabled={saving}
              aria-describedby={`item-type-help${error || validation ? ' item-type-error' : ''}`}
              aria-invalid={Boolean(validation)}
              onInput={e => {
                setName(e.currentTarget.value);
                setError(null);
              }}
            />
            <datalist id="item-type-options">
              {suggestions.map(type => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </label>
          <p id="item-type-help" class="muted small">
            Pick an existing type or enter a short, singular name, like "drill driver". Saved in
            lowercase for matching brands and models, falling back to the exact title if either
            listing lacks brand or model, including future relistings. Automatic labelling will not
            replace your correction.
          </p>
          {(error || validation) && (
            <p id="item-type-error" class="error" role="alert">
              {error || validation}
            </p>
          )}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button type="submit" class="btn" disabled={saving || Boolean(validation)}>
            {saving ? 'Saving...' : 'Save item type'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

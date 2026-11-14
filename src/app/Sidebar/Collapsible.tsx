import type { ComponentChildren } from 'preact';

import { KEYS } from '../../shared/keys';
import { Icon } from '../icons';
import { getSetting, setSetting } from '../settings';

/** Section whose open/closed state is remembered across sessions. */
export function Collapsible({
  id,
  title,
  children,
}: {
  id: string;
  title: ComponentChildren;
  children: ComponentChildren;
}) {
  const collapsed = getSetting(KEYS.collapsed);
  const setCollapsed = (value: ReturnType<typeof getSetting<typeof KEYS.collapsed>>) =>
    setSetting(KEYS.collapsed, value);
  const open = !collapsed[id];
  return (
    <div class="collapsible">
      <button
        type="button"
        class="collapse-head"
        aria-expanded={open}
        onClick={() => setCollapsed({ ...collapsed, [id]: open })}
      >
        <span>{title}</span>
        <Icon name="expandMore" size={20} />
      </button>
      {open && <div class="collapse-body">{children}</div>}
    </div>
  );
}

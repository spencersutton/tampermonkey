import type { ComponentChildren } from 'preact';

import { KEYS } from '../../../shared/keys';
import { useSetting } from '../../server/settings';
import { Icon } from '../icons';

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
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
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

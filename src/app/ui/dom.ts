export const hasModifierKey = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * Click handler for a link: a plain click runs `open` in-app; modified/middle clicks follow the
 * real link.
 */
export function openHandler(open: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || hasModifierKey(e)) {
      return;
    }
    e.preventDefault();
    open();
  };
}

/**
 * Apply a filter change without jumping the page: keep the loaded cards and align the next
 * surviving card where the clicked card was.
 */
export function keepScrollAnchor(from: EventTarget | null | undefined, update: () => void) {
  const clicked =
    typeof Element !== 'undefined' && from instanceof Element
      ? from.closest('article[data-lot]')
      : null;
  const cards = clicked ? [...document.querySelectorAll('article[data-lot]')] : [];
  const at = clicked ? cards.indexOf(clicked) : -1;
  const anchorTop = clicked?.getBoundingClientRect().top;
  const after = at >= 0 ? cards.slice(at + 1) : [];
  const before = at >= 0 ? cards.slice(0, at).toReversed() : [];
  const beforeTops = new Map(before.map(card => [card, card.getBoundingClientRect().top]));
  update();
  if (anchorTop == null) {
    return;
  }
  // Preact renders on a microtask, so this runs after the grid updates but before it's painted.
  requestAnimationFrame(() => {
    const next = after.find(card => card.isConnected);
    const prev = next ? undefined : before.find(card => card.isConnected);
    const target = next ?? prev;
    if (!target) {
      return;
    }
    const want = next ? anchorTop : beforeTops.get(target)!;
    window.scrollBy(0, target.getBoundingClientRect().top - want);
  });
}

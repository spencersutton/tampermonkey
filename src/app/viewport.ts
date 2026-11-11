import { effect, signal } from '@preact/signals';

import { gridView, onScreen, page, PAGE_SIZE } from './state';

const nearby = new Set<number>();
let cards: IntersectionObserver | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function observeLot(element: HTMLElement | null) {
  if (!element) return;
  cards ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.target.isConnected) continue;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const id = Number((entry.target as HTMLElement).dataset['lot']);
        if (entry.isIntersecting) {
          nearby.add(id);
        } else {
          nearby.delete(id);
        }
      }
      publish();
    },
    { rootMargin: '600px 0px' },
  );
  cards.observe(element);
  return () => {
    cards!.unobserve(element);
    nearby.delete(Number(element.dataset['lot']));
    publish();
  };
}

function publish() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    onScreen.value = [...nearby].toSorted((first, second) => first - second);
  }, 150);
}

const nearEnd = signal(false);
let endObserver: IntersectionObserver | undefined;

export function observeEnd(element: HTMLElement | null) {
  if (!element) return;
  endObserver ??= new IntersectionObserver(
    (entries) => {
      nearEnd.value = entries.some((entry) => entry.isIntersecting);
    },
    { rootMargin: '0px 0px 1200px 0px' },
  );
  endObserver.observe(element);
  const dispose = effect(() => {
    const current = page.value;
    if (!nearEnd.value || current * PAGE_SIZE >= gridView.value.rows.length) return;
    const frame = requestAnimationFrame(() => {
      page.value = current + 1;
    });
    return () => cancelAnimationFrame(frame);
  });
  return () => {
    dispose();
    endObserver!.unobserve(element);
    nearEnd.value = false;
  };
}

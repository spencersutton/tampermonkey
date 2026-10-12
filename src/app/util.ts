import { useEffect, useState } from 'preact/hooks';

export function timeLabel(endsAt: number, now: number) {
  const ms = endsAt - now;
  if (ms <= 0) return { text: 'Closed', soon: true };
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const soon = ms <= 3600000;
  if (ms >= 86400000) return { text: `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`, soon };
  if (m >= 60) return { text: `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`, soon };
  return { text: `${m}m ${String(s % 60).padStart(2, '0')}s`, soon };
}

export function ago(ts: number, now: number) {
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : new Date(ts).toLocaleString();
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

const tickSubs = new Map<number, { set: Set<(n: number) => void>; timer: number }>();

/** Current time, re-rendering every `every` ms (one shared timer per interval). */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let t = tickSubs.get(every);
    if (!t) {
      const set = new Set<(n: number) => void>();
      t = { set, timer: window.setInterval(() => set.forEach((f) => f(Date.now())), every) };
      tickSubs.set(every, t);
    }
    t.set.add(setNow);
    return () => {
      t!.set.delete(setNow);
      if (!t!.set.size) {
        clearInterval(t!.timer);
        tickSubs.delete(every);
      }
    };
  }, [every]);
  return now;
}

export const fmtCount = (n: number) => n.toLocaleString('en-US');

export function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

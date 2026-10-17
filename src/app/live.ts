// Live updates over the site's own Centrifugo websocket. Like the site, we
// subscribe only to the lots currently on screen (`lot:{id}`); when logged in,
// the server also pushes this account's outbid/winning events.
import { Centrifuge, type Subscription } from 'centrifuge';
import { useEffect, useState } from 'preact/hooks';
import { fetchWsToken, isAuthenticated, normalizeStanding } from './api';
import { onAuthChange } from './auth';
import { getLot, updateLot } from './catalog';
import type { Lot } from './types';

const WS_URL = 'wss://ws.triangleliquidators.com/connection/websocket';

export type LiveState = 'off' | 'connecting' | 'connected' | 'disconnected';

let liveState: LiveState = 'off';
const stateSubs = new Set<(s: LiveState) => void>();
const subs = new Map<number, Subscription>();

function setState(s: LiveState) {
  liveState = s;
  stateSubs.forEach((f) => f(s));
}

export function useLiveState(): LiveState {
  const [s, set] = useState(liveState);
  useEffect(() => {
    stateSubs.add(set);
    set(liveState);
    return () => void stateSubs.delete(set);
  }, []);
  return s;
}

let connecting: Promise<Centrifuge> | null = null;
const connect = () => (connecting ??= open());
let watched: number[] = [];

// The connection token decides whether we get this account's outbid/winning
// events, so log in/out means a new connection (with the same lot channels).
onAuthChange(() => {
  const old = connecting;
  if (!old) return;
  const oldSubs = [...subs.values()];
  subs.clear();
  connecting = null;
  void old.then((c) => {
    for (const sub of oldSubs) {
      sub.unsubscribe();
      c.removeSubscription(sub);
    }
    c.disconnect();
  });
  void watchLots(watched).catch(() => {});
});

async function open(): Promise<Centrifuge> {
  let token: string | null = null;
  if (isAuthenticated()) token = await fetchWsToken().catch(() => null);
  // Without a token the site's server still allows public lot channels.
  const c = new Centrifuge(WS_URL, token ? { token, getToken: () => fetchWsToken() } : {});
  c.on('connecting', () => setState('connecting'));
  c.on('connected', () => setState('connected'));
  c.on('disconnected', () => setState('disconnected'));
  // Server-side subscriptions (user:…) arrive as client-level publications.
  c.on('publication', (ctx) => {
    if (!ctx.channel.startsWith('user:')) return;
    const d = ctx.data || {};
    const lotId = Number(d.lot_id);
    const lot = getLot(lotId);
    if (!lot) return;
    let standing = normalizeStanding(d.relationship);
    if (!standing && d.type === 'outbid') standing = { isLeading: false, yourMaxBid: lot.yourStanding?.yourMaxBid ?? null };
    if (!standing && d.type === 'winning') standing = { isLeading: true, yourMaxBid: lot.yourStanding?.yourMaxBid ?? null };
    if (standing) updateLot(lotId, { yourStanding: standing, hasBid: true }, { force: true });
  });
  c.connect();
  return c;
}

function onLotPublication(data: any) {
  if (!data || typeof data.id !== 'number') return;
  const patch: Partial<Lot> = {
    currentPrice: data.current_price,
    bidCount: data.bid_count,
    nextMinIncrement: data.next_min_increment,
    endsAt: data.ends_at ? Date.parse(data.ends_at) : undefined,
    status: data.status,
    version: data.version,
  };
  for (const k of Object.keys(patch) as (keyof Lot)[]) if (patch[k] == null) delete patch[k];
  updateLot(data.id, patch);
}

/** Keep subscriptions in sync with the lots on screen. */
export async function watchLots(ids: number[]) {
  watched = ids;
  const c = await connect();
  const want = new Set(ids);
  for (const [id, sub] of subs) {
    if (want.has(id)) continue;
    sub.unsubscribe();
    c.removeSubscription(sub);
    subs.delete(id);
  }
  for (const id of want) {
    if (subs.has(id)) continue;
    const sub = c.getSubscription(`lot:${id}`) ?? c.newSubscription(`lot:${id}`);
    sub.on('publication', (ctx) => onLotPublication(ctx.data));
    sub.subscribe();
    subs.set(id, sub);
  }
}

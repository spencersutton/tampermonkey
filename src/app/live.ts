// Live updates over the site's own Centrifugo websocket. Like the site, we
// subscribe only to the lots currently on screen (`lot:{id}`); when logged in,
// the server also pushes this account's outbid/winning events.
import { signal } from '@preact/signals';
import { Centrifuge, type SubscribedContext, type Subscription } from 'centrifuge';
import { fetchWsToken, normalizeStanding } from './api';
import { isAuthenticated, onAuthChange } from './auth';
import { getLot, loadDetail, updateLot } from './catalog';
import type { Lot } from './types';

/**
 * The tlx server's relay to the site's Centrifugo websocket, which only
 * accepts the site's own Origin.
 */
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export type LiveState = 'off' | 'connecting' | 'connected' | 'disconnected';

/** Current connection state, shown in the status bar. */
export const liveState = signal<LiveState>('off');
/** Active `lot:{id}` channel subscriptions, by lot id. */
const subs = new Map<number, Subscription>();

const setState = (s: LiveState) => void (liveState.value = s);

/** The websocket client, created on first use (null after a login change). */
let connecting: Promise<Centrifuge> | null = null;
/** Get the shared websocket client, connecting if needed. */
const connect = () => (connecting ??= open());
/** Lot ids currently on screen, re-subscribed after reconnecting. */
let watched: number[] = [];

/** Unsubscribe from a lot channel and drop it from the client. */
function drop(c: Centrifuge, sub: Subscription) {
  sub.unsubscribe();
  c.removeSubscription(sub);
}

// The connection token decides whether we get this account's outbid/winning
// events, so log in/out means a new connection (with the same lot channels).
onAuthChange(() => {
  const old = connecting;
  if (!old) {
    return;
  }
  const oldSubs = [...subs.values()];
  subs.clear();
  connecting = null;
  void old.then((c) => {
    oldSubs.forEach((sub) => drop(c, sub));
    c.disconnect();
  });
  void watchLots(watched).catch(() => {});
});

/** Create and connect a websocket client; with a login, it also receives this account's bid events. */
async function open(): Promise<Centrifuge> {
  const token = isAuthenticated() ? await fetchWsToken().catch(() => null) : null;
  // Without a token the site's server still allows public lot channels.
  const c = new Centrifuge(WS_URL, token ? { token, getToken: () => fetchWsToken() } : {});
  c.on('connecting', () => setState('connecting'));
  c.on('connected', () => setState('connected'));
  c.on('disconnected', () => setState('disconnected'));
  // Server-side subscriptions (user:…) arrive as client-level publications.
  c.on('publication', (ctx) => {
    if (ctx.channel.startsWith('user:')) {
      onUserPublication(ctx.data ?? {});
    }
  });
  c.connect();
  return c;
}

/** Apply this account's outbid/winning event to the lot it is about. */
function onUserPublication(d: any) {
  const lotId = Number(d.lot_id);
  const lot = getLot(lotId);
  if (!lot) {
    return;
  }
  const yourMaxBid = lot.yourStanding?.yourMaxBid ?? null;
  const fallback = d.type === 'outbid' ? { isLeading: false, yourMaxBid } : d.type === 'winning' ? { isLeading: true, yourMaxBid } : null;
  const standing = normalizeStanding(d.relationship) ?? fallback;
  if (standing) {
    updateLot(lotId, { yourStanding: standing, hasBid: true }, { force: true });
  }
}

/** Apply a lot channel update (price, bids, end time, status) to the catalog. */
function onLotPublication(data: any) {
  if (typeof data?.id !== 'number') {
    return;
  }
  const patch: Partial<Lot> = {
    currentPrice: data.current_price,
    bidCount: data.bid_count,
    nextMinIncrement: data.next_min_increment,
    endsAt: data.ends_at ? Date.parse(data.ends_at) : undefined,
    status: data.status,
    version: data.version,
  };
  // Only the fields the message actually carried.
  updateLot(data.id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)));
}

/** Keep subscriptions in sync with the lots on screen. */
export async function watchLots(ids: number[]) {
  watched = ids;
  const c = await connect();
  const want = new Set(ids);
  for (const [id, sub] of subs) {
    if (!want.has(id)) {
      drop(c, sub);
      subs.delete(id);
    }
  }
  // Lots on screen that aren't subscribed yet.
  for (const id of want.difference(subs)) {
    const sub = c.getSubscription(`lot:${id}`) ?? c.newSubscription(`lot:${id}`);
    sub.on('publication', (ctx) => onLotPublication(ctx.data));
    sub.on('subscribed', (ctx) => catchUp(id, ctx));
    sub.subscribe();
    subs.set(id, sub);
  }
}

// ---------------------------------------------------------------------------
// Catching up lots that changed before they came on screen
// ---------------------------------------------------------------------------
// A subscription only delivers updates from now on (the site doesn't let
// clients read channel history), so a card could show an old price until the
// next bid. But the subscribe reply carries the channel's stream offset, which
// is the lot's `version`. An offset ahead of ours means the lot changed since
// we fetched it, so fetch just that lot. This also runs after a reconnect.
const CATCH_UP_CONCURRENCY = 2;
/** Lots waiting to be refetched, oldest first. */
const behind: number[] = [];
let fetching = 0;

/** Queue the lot for a refetch if the channel is ahead of our copy. */
function catchUp(id: number, ctx: SubscribedContext) {
  const lot = getLot(id);
  const offset = ctx.streamPosition?.offset;
  if (lot && offset != null && offset > lot.version && !behind.includes(id)) {
    behind.push(id);
    pump();
  }
}

/** Refetch queued lots a couple at a time, skipping any that left the screen. */
function pump() {
  while (fetching < CATCH_UP_CONCURRENCY && behind.length) {
    const lot = getLot(behind.shift()!);
    if (!lot || !subs.has(lot.id)) {
      continue;
    }
    fetching++;
    // loadDetail updates the catalog entry; failures just leave the old copy.
    void loadDetail(lot)
      .catch(() => {})
      .finally(() => {
        fetching--;
        pump();
      });
  }
}

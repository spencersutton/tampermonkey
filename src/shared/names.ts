// A lot's identity for display, sorting and search. Matching items to each
// other (duplicate listings, relisted items, past closing prices) happens only
// on the tlx server (src/server/history.ts, with identity.ts); the app reads
// its results (`groupId`, `relisted`, `pastCloses`).

export interface ItemIdentity {
  title: string;
  brand?: Nullable<string>;
  model?: Nullable<string>;
}

export interface ItemDetails {
  brands: ReadonlyMap<number, string | null>;
  models: ReadonlyMap<number, string | null>;
  descriptions?: ReadonlyMap<number, string | null>;
}

/** Detail caches can be newer than the price-versioned catalog entry. */
export function itemIdentity(
  item: ItemIdentity & { id: number },
  details?: ItemDetails,
): ItemIdentity {
  const brand = details?.brands.get(item.id);
  const model = details?.models.get(item.id);
  return {
    title: item.title,
    brand: brand === undefined ? item.brand : brand,
    model: model === undefined ? item.model : model,
  };
}

/** A lot's description, preferring the newest client detail cache when present. */
export function itemDescription(
  item: { id: number; description?: Nullable<string> },
  details?: ItemDetails,
): Nullable<string> {
  const desc = details?.descriptions?.get(item.id);
  return desc === undefined ? item.description : desc;
}

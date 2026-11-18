// A lot's identity for display, sorting and search. Matching items to each
// other (duplicate listings, relisted items, past closing prices) happens only
// on the tlx server (server/tlx_server/history.py, ported to identity.ts); the
// app reads its results (`groupId`, `relisted`, `pastCloses`).

export interface ItemIdentity {
  title: string;
  brand?: string | null | undefined;
  model?: string | null | undefined;
}

export interface ItemDetails {
  brands: ReadonlyMap<number, string | null>;
  models: ReadonlyMap<number, string | null>;
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

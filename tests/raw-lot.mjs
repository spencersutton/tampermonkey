// A complete raw lot detail, shaped like the site's (tests/fixtures/site), for
// tests to patch with the fields they care about.

/**
 * @param {Partial<
 *   import('../src/shared/lot').RawLotDetail & { similar: import('../src/shared/lot').RawLot[] }
 * >} patch
 */
export const rawLot = (patch = {}) => ({
  id: 1,
  auction_period: 'test',
  title: 'Drill',
  lot_number: '1',
  category: { value: 'tools', label: 'Tools' },
  condition: { value: 1, display_name: 'New' },
  location: { id: 1, name: 'Raleigh' },
  is_transferable: false,
  transfer_fee: 0,
  current_price: 0,
  estimated_retail_price: 0,
  ends_at: '2030-01-01T00:00:00Z',
  status: 'live',
  version: 1,
  bid_count: 0,
  next_min_increment: 0,
  /** @type {import('../src/shared/lot').RawStanding | null} */
  your_standing: null,
  is_watchlisted: false,
  has_bid: false,
  /** @type {import('../src/shared/lot').RawLot['images']} */
  images: [],
  description: '',
  brand: '',
  /** @type {string | null} */
  model: null,
  lot_fee: 0,
  /** @type {import('../src/shared/lot').RawLotDetail['bid_history']} */
  bid_history: [],
  /** @type {import('../src/shared/lot').RawLot[]} */
  similar: [],
  ...patch,
});

// Complete lots shaped like the site's (tests/fixtures/site), for tests to
// patch with the fields they care about.

/** @typedef {import('../src/shared/lot').RawLot} RawLot */
/** @typedef {import('../src/shared/lot').RawLotDetail} RawLotDetail */

/**
 * A lot as the catalog lists it.
 *
 * @param {Partial<RawLot>} patch
 * @returns {RawLot}
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
  your_standing: null,
  is_watchlisted: false,
  has_bid: false,
  images: [],
  ...patch,
});

/**
 * A lot's detail.
 *
 * @param {Partial<RawLotDetail>} patch
 * @returns {RawLotDetail}
 */
export const rawDetail = (patch = {}) => ({
  ...rawLot(),
  description: '',
  brand: '',
  model: null,
  lot_fee: 0,
  bid_history: [],
  similar: [],
  ...patch,
});

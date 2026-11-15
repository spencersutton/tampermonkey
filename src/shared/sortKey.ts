/** Case-insensitive, number-aware string comparison used for title sorting. */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

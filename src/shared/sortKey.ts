/** Plain code-unit order, for stable sorts that don't depend on the locale. */
export const byCode = (a: string, b: string) => (a < b ? -1 : Number(a > b));
/** Case-insensitive, number-aware string comparison used for title sorting. */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

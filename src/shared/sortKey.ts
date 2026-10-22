/** Case-insensitive, number-aware string comparison used for title sorting. */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
// Sort key: move leading specs (measurements, pack counts, "Set of 3",
// parentheticals like "(2026 Upgraded)") to the end, so "1 in. Copper Tubing
// Cutter" sorts with other "Copper Tubing Cutter"s. Bare numbers (years,
// model numbers), "3-in-1"/"2 in 1", and brands like "3M" stay put.
// Number: 1,200 / 2.5 / 5/8 / 1-3/8, optionally a range (33-39, 2500-5000).
const SORT_ONE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[- ]\d+\/\d+|\/\d+)?`;
const SORT_NUM = String.raw`${SORT_ONE}(?:\s*[-–]\s*${SORT_ONE})?`;
const SORT_UNIT = [
  String.raw`in(?:ch(?:es)?)?(?!\s*-|\s+\d+(?![\d.,/]))\.?`, // not "3-in-1" / "2 in 1", but "18.5 in 3.2 cu. ft."
  String.raw`ft\.?|feet|foot|yds?\.?|yards?|mm|cm|mil|ga\.?|gauge|awg`,
  String.raw`gal(?:lons?)?\.?|qts?\.?|quarts?|pints?|pt\.?|cups?|fl\.? ?oz\.?|oz\.?|lbs?\.?|pounds?|kg|tons?|ml|l|liters?|litres?|cc`,
  String.raw`(?:cu|sq)\.? ?(?:ft|in|yd)\.?`,
  String.raw`v|volts?|w|watts?|kw|amps?|a|ah|mah|wh|btus?|psi|gpm|cfm|mph|hp|lm|lumens?`,
  String.raw`[mg]bps|[gkm]?hz|rpm|db|deg(?:rees?)?|°|%`,
  String.raw`pcs?\.?|pieces?|pk|packs?|count|ct|pairs?|tiers?|panels?|channels?`,
].join('|');
// Counts that only read as a spec when hyphenated ("4-Light", "2-Cycle", "2-Tools").
const SORT_HYPHEN_UNIT = String.raw`(?:light|bulb|gang|outlet|port|drawer|shelf|shelves|cube|seat|person|burner|speed|blade|tool|bottle|door|zone|way|step|cutter|cycle|stroke|handle|row|tooth|teeth)s?`;
const SORT_MARK = String.raw`(?:"|''|”|″|'|′)`; // inch / foot marks
const SORT_MEASURE = String.raw`${SORT_NUM}\s*(?:${SORT_MARK}|-?\s*(?:${SORT_UNIT}))?`;
const SORT_LEAD = new RegExp(
  '^(?:' +
    [
      String.raw`[(\[][^)\]]*[)\]]`, // (2026 Upgraded)
      String.raw`(?:set|pack|box|case|lot)\s+of\s+\d+`, // Set of 3
      // Dimensions: 24 x 36 / 12x12 in. / 56"x15" / 6FTx300FT
      `${SORT_MEASURE}(?:\\s*[x×]\\s*${SORT_MEASURE})+(?=[\\s,.)/]|$)`,
      `${SORT_NUM}\\s*${SORT_MARK}`, // 15" / 6'
      `${SORT_NUM}-${SORT_HYPHEN_UNIT}(?=[\\s,.)/]|$)`, // 4-Light
      `${SORT_NUM}[\\s-]?(?:${SORT_UNIT})(?=[\\s,.)/x×]|$)`, // 1 in. / 20V / 5-Pack / 80,000 BTU
      `${SORT_NUM}\\s*[x×](?=\\s*\\d)`, // multiplier: 2x180W
    ].join('|') +
    ')',
  'iu'
);
// "x" between measurements ("12 in. x 12 in."); only after a measurement was
// moved, so model names like "X20" or "X2 Robotic Pool Vacuum" stay put.
const SORT_SEP = /^[x×]\s*(?=\d)/i;

/** Title rearranged for sorting: leading specs moved to the end and leading punctuation dropped. */
export function sortKey(title: string): string {
  let rest = title.trim();
  const moved: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = rest.match(SORT_LEAD) || (moved.length ? rest.match(SORT_SEP) : null);
    if (!m?.[0]) {
      break;
    }
    moved.push(m[0].trim());
    rest = rest.slice(m[0].length).replace(/^[\s,;:/–—-]+/, '');
  }
  const key = rest ? (moved.length ? `${rest} ${moved.join(' ')}` : rest) : title;
  return key.replace(/^[^\p{L}\p{N}]+/u, '');
}

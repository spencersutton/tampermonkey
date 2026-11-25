/**
 * Deterministic, code-only item attribute extractors.
 *
 * Parses normalized specifications (hose length, rug/item dimensions, battery platform, finish,
 * PSI, etc.) directly from auction lot titles without database tables or rule editors.
 *
 * How extraction works:
 *
 * 1. Declarative {@link RULES} are evaluated in order against the lot title. Each rule may specify an
 *    optional guard regex (`when`) to scope extraction to relevant item types and reduce false
 *    positives.
 * 2. Derived attributes are inferred from extracted specs (e.g. any `Battery system` implies `Power
 *    source: Battery`; `Engine (cc)` implies `Power source: Gas`).
 * 3. Multi-dimensional sizes (`L × W` / `L × W × H`, plus rug sizes) are extracted separately via
 *    {@link extractSize}.
 * 4. Values within each attribute group are deduplicated case-insensitively while preserving
 *    first-seen display casing.
 *
 * Consumed by facet filtering (`src/app/logic/view.ts`) and active-filter chips
 * (`src/app/logic/refinements.ts`), which identify selections using canonical lowercase keys
 * produced by {@link attrKey}.
 */

/**
 * Extracted attributes for a single lot, keyed by display group name (e.g. `"Hose length"`,
 * `"Finish"`) to deduplicated display values (e.g. `["50 ft"]`, `["Matte Black", "Gold"]`).
 */
export type Attrs = Record<string, string[]>;

/** Convert whitespace-separated words to Title Case and collapse runs of spaces. */
const titleCase = (s: string) =>
  s
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Normalize numeric strings (stripping leading zeros and trailing decimal zeros, e.g. `"050"` ->
 * `"50"`, `"2.50"` -> `"2.5"`). Non-numeric values such as fractions (`"1/2"`) are returned
 * unchanged.
 */
const normNum = (s: string) => {
  // Strip commas from numeric strings before conversion
  s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

/**
 * Build the canonical lowercase selection key (`"<name>:<value>"`) for an attribute value, used in
 * filter state, URL params, and case-insensitive matching.
 *
 * @example
 *   attrKey('Hose length', '50 ft'); // => 'hose length:50 ft'
 */
export const attrKey = (name: string, value: string) =>
  `${name.toLowerCase()}:${value.toLowerCase()}`;

/**
 * Split a canonical selection key back into its lowercase attribute `name` and `value` on the first
 * `:` delimiter.
 *
 * Returns `null` if the key has no `:` or if either side is empty.
 */
export function parseAttrKey(key: string): { name: string; value: string } | null {
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) {
    return null;
  }
  return { name: key.slice(0, i).toLowerCase(), value: key.slice(i + 1).toLowerCase() };
}

/**
 * Parse a leading fraction (e.g. `"1/4 in"` -> `0.25`) or integer/decimal (e.g. `"50 ft"` -> `50`)
 * for natural numeric ordering.
 *
 * Returns `null` when the string does not start with a number or has a zero denominator.
 */
function numericPrefix(s: string): number | null {
  const frac = /^(\d+)\s*\/\s*(\d+)/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : null;
  }
  const num = /^(\d+(?:\.\d+)?)/.exec(s);
  return num ? Number(num[1]) : null;
}

/**
 * Comparator for sorting attribute facet values in natural order.
 *
 * Values with leading numbers or fractions are compared numerically first (e.g. `"1/4 in"` < `"1/2
 * in"`, `"25 ft"` < `"50 ft"` < `"100 ft"`). Ties and non-numeric values fall back to
 * case-insensitive, numeric-aware locale comparison.
 */
export function compareAttrValues(a: string, b: string): number {
  const na = numericPrefix(a);
  const nb = numericPrefix(b);
  if (na != null && nb != null && na !== nb) {
    return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// Declarative extraction rules
// ---------------------------------------------------------------------------

/** Static display value or match-to-value(s) formatter for a {@link Rule}. */
type RuleValue = string | ((m: RegExpExecArray) => string | string[]);

/**
 * A single attribute extraction rule:
 *
 * - `name`: Display attribute group name (e.g. `"Finish"`, `"PSI"`).
 * - `re`: Pattern matched against the lot title. When the `g` flag is set, all matches are extracted
 *   via `matchAll`; otherwise only the first match is used.
 * - `value`: Static string or callback producing one or more display values.
 * - `when`: Optional guard regex; the rule is skipped unless `when.test(title)` succeeds.
 */
type Rule = [name: string, re: RegExp, value: RuleValue, when?: RegExp | undefined];

/** Expand multiple `[re, value, when?]` entries into {@link Rule} tuples under one attribute group. */
const group = (name: string, entries: [RegExp, RuleValue, (RegExp | undefined)?][]): Rule[] =>
  entries.map(([re, value, when]) => [name, re, value, when]);

/**
 * Shorthand for numeric-unit rules whose first capture group (`m[1]`) is normalized with
 * {@link normNum} and formatted as `"<num> <suffix>"`.
 */
const unit = (name: string, re: RegExp, suffix: string, when?: RegExp): Rule => [
  name,
  re,
  m => `${normNum(m[1]!)} ${suffix}`,
  when,
];

/** Context guard identifying bedding/mattress lots so `"Full"`/`"Twin"` aren't misclassified. */
const BED_ITEM = /\b(?:box spring|bunk|bed|mattress|comforter|sheets?|pad)\b/i;

/**
 * Ordered list of declarative title-extraction rules.
 *
 * Rules are evaluated sequentially; multiple rules may contribute values to the same attribute
 * group (deduplicated case-insensitively by {@link add}).
 */
const RULES: Rule[] = [
  // Surface/hardware finishes. Specific compounds ("Black & Gold", "Matte ...")
  // precede generic metals; "Gold" excludes art/rug/brand false positives.
  ...group('Finish Family', [
    [/gold.*(lights?|chandelier|sconces?)/i, 'Gold'],
    [/, Gold$/i, 'Gold'],
    [
      /\b(?:satin|polished|brushed|antique|vintage|warm|french|beige|modern|oil[ -]rubbed|cocoa|champagne|venetian|matte|aged|rustic|rubbed|blackened) (brass|chrome|nickel|white|gold|silver|bronze)\b/i,
      m => titleCase(m[1]!),
    ],
    [/\bPop-Up Drain and Mounting Ring in Chrome\b/, 'Chrome'],
    [/\bBath Hardware Set.*, (Chrome|Matte Black)\b/, m => titleCase(m[1]!)],
  ]),
  ...group('Finish', [
    [
      /\b((?:satin|polished|brushed|antique|vintage|warm|french|beige|modern|oil[ -]rubbed|cocoa|champagne|venetian|matte|aged|rustic|rubbed|blackened) (brass|chrome|nickel|white|gold|silver|bronze))\b/i,
      m => titleCase(m[1]!),
    ],
  ]),

  // Colors (global: multi-color items emit each color). `black(?!\+)` avoids
  // matching the "Black+Decker" brand; British "grey" is normalized to "Gray".
  [
    'Color',
    /\b(black(?!\+)|white|gr[ae]y|blue|red|green|brown|beige|tan|khaki|navy|ivory|cream|yellow|orange|purple|pink|burgundy|taupe|mauve|wheat|dune)\b/gi,
    m => titleCase(m[1]!.toLowerCase() === 'grey' ? 'gray' : m[1]!),
  ],

  // Primary construction materials (global where multiple materials can co-occur).
  ...group('Material', [
    [
      /\b(?<!(?:antique|brushed|aged|satin) )(stainless steel|aluminum|carbon fiber|rubber|brass|latex|copper)(?! finish)\b/gi,
      m => titleCase(m[1]!),
    ],
    [/\b(?:pvc|vinyl)\b/i, 'PVC / Vinyl'],
  ]),

  // Cordless tool battery platforms. Any match here also infers Power source: Battery
  // in extractAttrs(). DeWalt 20V excludes Black+Decker; Ryobi ONE+ excludes USB/40V.
  ...group('Battery system', [
    [/\bM(12|18)\b/, m => `Milwaukee M${m[1]}`],
    [/\bflexvolt\b/i, 'DeWalt Flexvolt'],
    [/^(?!.*black ?\+ ?decker).*(?:20v max|dewalt 20v)/i, 'DeWalt 20V MAX'],
    [/\bridgid 18v\b/i, 'RIDGID 18V'],
    [/\bhart 20v\b/i, 'HART 20V'],
    [/\bryobi usb\b/i, 'Ryobi USB Lithium'],
    [/\bryobi 40-?v\b|^40-?v\b/i, 'Ryobi 40V'],
    [
      /\bONE\+|\bryobi\b(?!.*(?:\bUSB\b|\b40-?V))(?=.*(?:\b18-?V|\bbatter(?:y|ies)\b))/i,
      'Ryobi ONE+',
    ],
  ]),

  // Power source. "Pneumatic" excludes pneumatic tires.
  ...group('Power source', [
    [
      /\bcordless\b|\bbatter(?:y|ies)\b|\brechargeable\b|\bREDLITHIUM\b|\btool[ -]only\b/i,
      'Battery',
    ],
    [
      /\bcorded\b|\b1[12]0v\b|\b(?:dewalt|ridgid)\b.*\d[ -]amps?\b|\d[ -]amps?\b.*\b(?:saws?|drill|sander|grinder|router|planer|heat gun|blower|mower|trimmer|polisher|buffer|washer|cut-off)\b/i,
      'Corded',
    ],
    [
      /\b\d-(?:stroke|cycle)\b|\bgas-powered\b|\bgas\b.*(?:pressure washer|garden tiller|leaf blower)/i,
      'Gas',
    ],
    [/\bpneumatic\b(?!.*tire)/i, 'Pneumatic'],
  ]),

  // Bedding sizes. "Full/Queen" emits both values; "Full" and "Twin" require a bedding keyword.
  ...group('Bedding size', [
    [/\bfull\s*\/\s*queen\b/i, () => ['Full', 'Queen']],
    [/\b(California King|Queen|King)\b/i, m => titleCase(m[1]!)],
    [/\b(full|twin)\b/i, m => titleCase(m[1]!), BED_ITEM],
  ]),

  // Grill fuel type: normalizes both "propane" and "gas" to "Gas".
  [
    'Fuel type',
    /\b(propane|gas|charcoal)\b/i,
    m => (m[1]!.toLowerCase() === 'charcoal' ? 'Charcoal' : 'Gas'),
    /\bgrill\b/i,
  ],

  // Numeric specifications & tool/equipment measurements.
  // Hose length excludes "hose reel" titles whose length is reel capacity, not an included hose.
  unit('Hose length', /\b(\d+)\s*-?\s*ft\b/i, 'ft', /\bhose\b(?! reel)/i),
  unit('Hose diameter', /(\d+\/\d+)\s*(?:in\.?|")/i, 'in', /\bhose\b/i),
  unit('Watts', /\b(\d+(?:\.\d+)?)[\s-]*W(?:atts?)?\b/i, 'Watts'),
  unit('CFM', /\b\d+\s*CFM\b/i, 'CFM'),
  unit('PSI', /\b([\d,]+)\s*PSI\b/i, 'PSI'),
  unit('Volume', /\b(\d+(?:\.\d+)?)\s*-?Cu\.?[ -]ft\.?\b/i, 'cu ft'),
  unit('GPM', /\b(\d+(?:\.\d+)?)\s*GPM\b/i, 'GPM'),
  unit('Gauge', /\b(\d+)[ -]Ga(?:uge)?\b/i, 'Gauge'),
  unit('Capacity (Ah)', /\b(\d+(?:\.\d+)?)\s*Ah\b/i, 'Ah'),
  // Negative lookbehind avoids matching partial decimals (e.g. ".5-amp" inside "1.5-amp").
  unit('Amps', /(?<![\d.])(\d+(?:\.\d+)?)[ -]amps?\b/i, 'A'),
  unit('Lumens', /\b([\d,]+)[ -]*(?:lumens?|lm)\b/i, 'lm'),
  // Normalizes half-gauge notation ("15-1/2 gauge" -> "15.5 Gauge"); lookbehind avoids fractions/ranges.
  [
    'Gauge',
    /(?<![\d/.-])(\d+(?:\.5|-1\/2)?)[ -]?gauge\b/i,
    m => `${m[1]!.replace('-1/2', '.5')} Gauge`,
  ],
  // Chuck size excludes "drill bit" titles where the fraction is bit diameter, not chuck capacity.
  unit('Chuck size', /(\d+\/\d+)\s*-?\s*(?:in\.?|")/i, 'in', /\b(?:drill|driver)\b(?! bit)/i),
  unit('Blade size', /\b(\d+(?:-\d+\/\d+|\.\d+)?)\s*-?\s*in\b/i, 'in', /\bcircular saw\b/i),
  // Wheel size excludes die grinders and avoids matching the upper bound of ranges ("4 to 5 in").
  unit(
    'Wheel size',
    /(?<!to )\b(\d+(?:-\d+\/\d+|\.\d+)?)\s*-?\s*(?:in\.?|inch)\b/i,
    'in',
    /(?<!die )grinder\b/i,
  ),
  // Engine displacement; also infers Power source: Gas in extractAttrs().
  unit('Engine (cc)', /\b(\d+(?:\.\d+)?)\s*cc\b/i, 'cc'),
  unit('Capacity (Tons)', /\b(\d+(?:\.\d+)?)[ -]ton\b/i, 'Ton', /\bjack\b/i),
  // ANSI ladder duty ratings (Type IAA, IA, I, II, III).
  [
    'Ladder type',
    /\btype\s+(IAA|IA|I|II|III)\b/i,
    m => `Type ${m[1]!.toUpperCase()}`,
    /\bladder\b/i,
  ],
  // Automotive/powersports make; normalizes "Chevy" to "Chevrolet".
  [
    'Vehicle',
    /\b(Toyota|Honda|Ford|Chevy|Chevrolet|Jeep|Dodge|Kia|Hyundai|BMW|Mercedes|Audi|Lexus|Tesla|VW|Mazda|Kawasaki|Harley|Can-Am|Isuzu)\b/i,
    m => (m[1]!.toLowerCase() === 'chevy' ? 'Chevrolet' : m[1]!),
  ],
];

// ---------------------------------------------------------------------------
// Dimension / size extraction
// ---------------------------------------------------------------------------

/** Single dimension token (`<number> in|ft`); lookbehind avoids matching fraction denominators. */
const DIM_PART = String.raw`(?<![/\d.])(\d+(?:\.\d+)?)\s*(in|ft)\.?`;
/** 3D dimension pattern (e.g. `"24 in x 18 in x 12 in"`). */
const DIM3_RE = new RegExp(`${DIM_PART}\\s*x\\s*${DIM_PART}\\s*x\\s*${DIM_PART}\\b`, 'i');
/** 2D dimension pattern (e.g. `"5 ft x 7 ft"`, `"20 in x 30 in"`). */
const DIM2_RE = new RegExp(`${DIM_PART}\\s*x\\s*${DIM_PART}\\b`, 'i');
/**
 * Rug dimension pattern allowing tick marks or bare integers assumed to be feet (e.g. `"5' x 7'"`,
 * `"8 x 10"`).
 */
const RUG_DIM_RE = /(?<![/\d.])(\d+)\s*'?\s*x\s*(\d+)\s*'?\b/i;

/**
 * Append one or more trimmed, non-empty values to `out[name]`, skipping case-insensitive duplicates
 * while preserving the first-seen casing.
 */
function add(out: Attrs, name: string, value: string | string[]) {
  const list = (out[name] ??= []);
  for (const raw of Array.isArray(value) ? value : [value]) {
    const v = raw.trim();
    if (v && !list.some(x => x.toLowerCase() === v.toLowerCase())) {
      list.push(v);
    }
  }
}

/**
 * Extract a normalized 2D or 3D size string formatted with `×` (`U+00D7`).
 *
 * Prefers 3D dimensions over 2D dimensions when both could match. If no explicit `in`/`ft`
 * dimensions are present and the title mentions a rug, falls back to {@link RUG_DIM_RE} and assumes
 * feet.
 */
function extractSize(title: string): string | null {
  const dim = DIM3_RE.exec(title) ?? DIM2_RE.exec(title);
  if (dim) {
    const parts: string[] = [];
    for (let i = 1; i < dim.length; i += 2) {
      parts.push(`${normNum(dim[i]!)} ${dim[i + 1]!.toLowerCase()}`);
    }
    return parts.join(' × ');
  }
  if (/\brugs?\b/i.test(title)) {
    const rug = RUG_DIM_RE.exec(title);
    if (rug) {
      return `${rug[1]} ft × ${rug[2]} ft`;
    }
  }
  return null;
}

/**
 * Extract normalized item attributes from a lot title.
 *
 * Runs all declarative {@link RULES}, adds inferred `Power source` values when `Battery system` or
 * `Engine (cc)` is present, and attaches a normalized `Size` attribute if {@link extractSize}
 * matches.
 */
export function extractAttrs(lot: Lot): Attrs {
  const out: Attrs = {};
  for (const [name, re, value, when] of RULES) {
    if (when && !when.test(lot.title)) {
      continue;
    }
    if (re.global) {
      for (const m of lot.title.matchAll(re)) {
        add(out, name, typeof value === 'function' ? value(m) : value);
      }
    } else {
      const m = re.exec(lot.title);
      if (m) {
        add(out, name, typeof value === 'function' ? value(m) : value);
      }
    }
  }
  // Inferred power sources from more specific specs.
  if (out['Battery system']) {
    add(out, 'Power source', 'Battery');
  }
  if (out['Engine (cc)']) {
    add(out, 'Power source', 'Gas');
  }
  const size = extractSize(lot.title);
  if (size) {
    add(out, 'Size', size);
  }
  return out;
}

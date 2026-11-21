// Deterministic, code-only item attribute extractors (specs like hose length,
// rug size, battery system, finish, PSI, etc.). Computed locally from titles
// without DB tables or rule editors.

export type Attrs = Record<string, string[]>;

const titleCase = (s: string) =>
  s
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();

const normNum = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

/** Canonical selection key for an attribute value (case-insensitive). */
export const attrKey = (name: string, value: string) =>
  `${name.toLowerCase()}:${value.toLowerCase()}`;

/** Split a selection key back into lowercase attribute name and value. */
export function parseAttrKey(key: string): { name: string; value: string } | null {
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) {
    return null;
  }
  return { name: key.slice(0, i).toLowerCase(), value: key.slice(i + 1).toLowerCase() };
}

/** Natural sort for attribute values (e.g. "25 ft" < "50 ft" < "100 ft", "1/4 in" < "1/2 in"). */
function numericPrefix(s: string): number | null {
  const frac = /^(\d+)\s*\/\s*(\d+)/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : null;
  }
  const num = /^(\d+(?:\.\d+)?)/.exec(s);
  return num ? Number(num[1]) : null;
}

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

type RuleValue = string | ((m: RegExpExecArray) => string | string[]);
type Rule = [name: string, re: RegExp, value: RuleValue, when?: RegExp | undefined];

const group = (name: string, entries: [RegExp, RuleValue, (RegExp | undefined)?][]): Rule[] =>
  entries.map(([re, value, when]) => [name, re, value, when]);

const unit = (name: string, re: RegExp, suffix: string, when?: RegExp): Rule => [
  name,
  re,
  m => `${normNum(m[1]!)} ${suffix}`,
  when,
];

const FINISH_MOD =
  '(?:satin|polished|brushed|antique|vintage|warm|french|beige|modern|oil[ -]rubbed|cocoa|champagne|venetian|matte|aged|rustic|rubbed|blackened)';
const BED_ITEM = /\b(?:box spring|bunk|bed|mattress|comforter|sheets?|pad)\b/i;

const RULES: Rule[] = [
  ...group('Finish', [
    [/\bblack (?:and|&) gold\b/i, 'Black & Gold'],
    [/\bmatte (black|white|gr[ae]y)\b/i, m => `Matte ${titleCase(m[1]!.replace(/grey/i, 'gray'))}`],
    [
      new RegExp(
        `\\b${FINISH_MOD} brass\\b|\\bbrass\\b.*(?:door handle|pendant|knob|pull|faucet)`,
        'i',
      ),
      'Brass',
    ],
    [new RegExp(`\\b${FINISH_MOD} (silver|stainless steel)\\b`, 'i'), m => titleCase(m[1]!)],
    [/\b(nickel|chrome|bronze)\b/gi, m => titleCase(m[1]!)],
    [
      /^(?!.*\b(?:rugs?|canvas|wall art|greenguard|dura-gold|duraflame)\b).*\bgold(?:en)?\b/i,
      'Gold',
    ],
  ]),
  [
    'Color',
    /\b(black(?!\+)|white|gr[ae]y|blue|red|green|brown|beige|tan|khaki|navy|ivory|cream|yellow|orange|purple|pink|burgundy|taupe|mauve|wheat|dune)\b/gi,
    m => titleCase(m[1]!.toLowerCase() === 'grey' ? 'gray' : m[1]!),
  ],
  ...group('Material', [
    [/\b(stainless steel|aluminum|carbon fiber|rubber)\b/gi, m => titleCase(m[1]!)],
    [/\b(?:pvc|vinyl)\b/i, 'PVC / Vinyl'],
  ]),
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
  ...group('Power source', [
    [/\bcordless\b|\bbatter(?:y|ies)\b|\brechargeable\b|\bREDLITHIUM\b|\btool[ -]only\b/i, 'Battery'],
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
  ...group('Bedding size', [
    [/\bfull\s*\/\s*queen\b/i, () => ['Full', 'Queen']],
    [/\b(California King|Queen|King)\b/i, m => titleCase(m[1]!)],
    [/\b(full|twin)\b/i, m => titleCase(m[1]!), BED_ITEM],
  ]),
  [
    'Fuel type',
    /\b(propane|gas|charcoal)\b/i,
    m => (m[1]!.toLowerCase() === 'charcoal' ? 'Charcoal' : 'Gas'),
    /\bgrill\b/i,
  ],
  unit('Hose length', /\b(\d+)\s*-?\s*ft\b/i, 'ft', /\bhose\b(?! reel)/i),
  unit('Hose diameter', /(\d+\/\d+)\s*(?:in\.?|")/i, 'in', /\bhose\b/i),
  unit('PSI', /\b(\d+(?:\.\d+)?)\s*PSI\b/i, 'PSI'),
  unit('GPM', /\b(\d+(?:\.\d+)?)\s*GPM\b/i, 'GPM'),
  unit('Capacity (Ah)', /\b(\d+(?:\.\d+)?)\s*Ah\b/i, 'Ah'),
  unit('Amps', /(?<![\d.])(\d+(?:\.\d+)?)[ -]amps?\b/i, 'A'),
  unit('Lumens', /\b(\d{2,6})[ -]lumens?\b/i, 'lm'),
  [
    'Gauge',
    /(?<![\d/.-])(\d{1,2}(?:\.5|-1\/2)?)[ -]?gauge\b/i,
    m => `${m[1]!.replace('-1/2', '.5')} Gauge`,
  ],
  unit('Chuck size', /(\d+\/\d+)\s*-?\s*(?:in\.?|")/i, 'in', /\b(?:drill|driver)\b(?! bit)/i),
  unit('Blade size', /\b(\d+(?:-\d+\/\d+|\.\d+)?)\s*-?\s*in\b/i, 'in', /\bcircular saw\b/i),
  unit(
    'Wheel size',
    /(?<!to )\b(\d+(?:-\d+\/\d+|\.\d+)?)\s*-?\s*(?:in\.?|inch)\b/i,
    'in',
    /(?<!die )grinder\b/i,
  ),
  unit('Engine (cc)', /\b(\d+(?:\.\d+)?)\s*cc\b/i, 'cc'),
  unit('Capacity (Tons)', /\b(\d+(?:\.\d+)?)[ -]ton\b/i, 'Ton', /\bjack\b/i),
  [
    'Ladder type',
    /\btype\s+(IAA|IA|I|II|III)\b/i,
    m => `Type ${m[1]!.toUpperCase()}`,
    /\bladder\b/i,
  ],
  [
    'Vehicle',
    /\b(Toyota|Honda|Ford|Chevy|Chevrolet|Jeep|Dodge|Kia|Hyundai|BMW|Mercedes|Audi|Lexus|Tesla|VW|Mazda|Kawasaki|Harley|Can-Am|Isuzu)\b/i,
    m => (m[1]!.toLowerCase() === 'chevy' ? 'Chevrolet' : m[1]!),
  ],
];

const DIM_PART = String.raw`(?<![/\d.])(\d+(?:\.\d+)?)\s*(in|ft)\.?`;
const DIM3_RE = new RegExp(`${DIM_PART}\\s*x\\s*${DIM_PART}\\s*x\\s*${DIM_PART}\\b`, 'i');
const DIM2_RE = new RegExp(`${DIM_PART}\\s*x\\s*${DIM_PART}\\b`, 'i');
const RUG_DIM_RE = /(?<![/\d.])(\d+)\s*'?\s*x\s*(\d+)\s*'?\b/i;

function add(out: Attrs, name: string, value: string | string[]) {
  const list = (out[name] ??= []);
  for (const raw of Array.isArray(value) ? value : [value]) {
    const v = raw.trim();
    if (v && !list.some(x => x.toLowerCase() === v.toLowerCase())) {
      list.push(v);
    }
  }
}

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

/** Extract normalized item attributes from a lot title. */
export function extractAttrs(title: string): Attrs {
  const out: Attrs = {};
  for (const [name, re, value, when] of RULES) {
    if (when && !when.test(title)) {
      continue;
    }
    if (re.global) {
      for (const m of title.matchAll(re)) {
        add(out, name, typeof value === 'function' ? value(m) : value);
      }
    } else {
      const m = re.exec(title);
      if (m) {
        add(out, name, typeof value === 'function' ? value(m) : value);
      }
    }
  }
  if (out['Battery system']) {
    add(out, 'Power source', 'Battery');
  }
  if (out['Engine (cc)']) {
    add(out, 'Power source', 'Gas');
  }
  const size = extractSize(title);
  if (size) {
    add(out, 'Size', size);
  }
  return out;
}

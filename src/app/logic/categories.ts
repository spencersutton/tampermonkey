// Fixed two-level custom category taxonomy derived from item types.
//
// Each lot with an item type is matched against the ordered rules below (first
// match wins). Lots whose item type doesn't match any rule—or that don't have
// an item type yet—fall back to the site's original category.
import { collator } from '../../shared/sortKey';
import type { Lot } from '../types';
import { assert } from './util';
import type { Facet } from './view';

type SiteCategory =
  | 'health-beauty'
  | 'outdoor'
  | 'electronics-appliances'
  | 'baby-kids'
  | 'General-Merchandise'
  | 'Pets'
  | 'automotive'
  | 'tools'
  | 'home'
  | 'Toys_Sports'
  | 'Building_Hardware'
  | 'Apparel'
  | 'lighting-electrical'
  | 'plumbing-bath';

function isSiteCategory(value: string): value is SiteCategory {
  return [
    'health-beauty',
    'outdoor',
    'electronics-appliances',
    'baby-kids',
    'General-Merchandise',
    'Pets',
    'automotive',
    'tools',
    'home',
    'Toys_Sports',
    'Building_Hardware',
    'Apparel',
    'lighting-electrical',
    'plumbing-bath',
  ].includes(value);
}

export interface CategoryDef {
  /** Stable slug used in ViewState.categories, e.g. "tools/power-tools". */
  value: string;
  /** Top-level parent group shown in the sidebar tree, e.g. "Tools". */
  parent: string;
  /** Subcategory label shown in the tree, on cards, and in filter chips. */
  label: string;
  /** Matches the lot's lowercase itemType (and optionally its site category value). */
  match: RegExp | ((type: string, siteCategory: SiteCategory) => boolean);
}

/**
 * Ordered classification rules. All rules match on `itemType` (never broad `site === ...`
 * catch-alls), so items misfiled by the auction site still land in the right logical category.
 * Narrow site-category tie-breakers are only used for genuinely ambiguous nouns like "battery" or
 * "floor mat".
 */
export const CATEGORIES: readonly CategoryDef[] = [
  // --- Seasonal & Holiday (pulls together scattered holiday/party items) ---
  {
    value: 'seasonal/holiday-decor',
    parent: 'Seasonal & Holiday',
    label: 'Seasonal & Holiday',
    match:
      /\b(christmas|halloween|animatronic|wreaths?|garlands?|ornaments?|nativity|santa|snowman|pumpkins?|skeletons?|holiday\s+decor(?:ation)?s?|tree\s+(?:skirt|stand|topper)|stocking\s+holder|nutcracker|menorah|easter|valentine|thanksgiving|harvest\s+decor(?:ation)?s?|prop\s+bat|standup\s+prop|tombstone|fog\s+machine|costumes?)\b/,
  },

  // --- Pets (before Home/Furniture/Hardware so dog beds, pet gates, etc. stay in Pets) ---
  {
    value: 'pets/supplies',
    parent: 'Pets',
    label: 'Pets',
    match:
      /\b(dog|cat|pet|puppy|kitten|aquariums?|fish\s+tanks?|reptiles?|hamsters?|rabbits?|chicken\s+coop|bird\s+cages?|litter\s+box|scratching\s+post|leash(es)?|kennels?|crate\s+pad|pee\s+pad|animal\s+trap|kibble|terrarium|livestock)\b/,
  },

  // --- Baby & Kids (before Home/Furniture/Hardware so baby gates, cribs, high chairs stay here) ---
  {
    value: 'baby-kids/gear',
    parent: 'Baby & Kids',
    label: 'Baby & Kids',
    match:
      /\b(baby|toddler|infant|cribs?|bassinets?|strollers?|car\s+seats?|booster\s+seats?|high\s+chairs?|playpens?|playards?|changing\s+(pad|table)|diapers?|bottle\s+(warmer|sterilizer)|breast\s+pump|nursing\s+pillow|pregnancy\s+pillow|pacifiers?|bouncers?|activity\s+jumper|banister\s+guard|potty|sippy|swaddles?|nursery|pack\s+n\s+play|hooded\s+towel)\b/,
  },

  // --- Automotive (before Lighting, HVAC, Home Mats, Tools) ---
  {
    value: 'automotive/jacks-maintenance',
    parent: 'Automotive',
    label: 'Jacks & Maintenance',
    match:
      /\b(bottle\s+jack|floor\s+jack|garage\s+jack|trolley\s+jack|scissor\s+jack|jack\s+stand|car\s+ramp|jump\s+starter|tire\s+(inflator|gauge|chain|cover)|fuel\s+can|gas\s+can|jerry\s+can|antifreeze|motor\s+oil|2-cycle\s+oil|obd|code\s+reader|tow\s+strap|wheel\s+chock|battery\s+tender|trickle\s+charger|oil\s+filter|funnel|grease\s+fitting|car\s+wash)\b/,
  },
  {
    value: 'automotive/parts-exterior',
    parent: 'Automotive',
    label: 'Parts & Exterior',
    match:
      /\b(headlights?|tail\s*lights?|fog\s+lights?|brake\s+(caliper|pad|rotor|line|kit)|windshield\s+wiper|wiper\s+blade|[w]indow\s+deflector|rain\s+guard|splash\s+shield|fenders?|bumpers?|grille|door\s+mirror|side\s+mirror|radiator|alternator|starter\s+motor|catalytic|muffler|exhaust\s+pipe|control\s+arm|ball\s+joint|wheel\s+bearing|hub\s+assembly|struts?|shock\s+absorber|spark\s+plug|ignition\s+coil|fuel\s+pump|tonneau|roof\s+rack|hitch|trailer|rv\s+cover|car\s+cover|golf\s+cart|motorcycle|atv|utv|automotive|weatherstrip\b|running\s+board|mud\s+flap|license\s+plate|lug\s+nut|wheel\s+cover|hubcap)\b/,
  },
  {
    value: 'automotive/interior-tech',
    parent: 'Automotive',
    label: 'Interior & Tech',
    match: (t, site) =>
      /\b(seat\s+covers?|car\s+stereo|dash\s+cam|backup\s+camera|steering\s+wheel|car\s+charger|sun\s+shade|trunk\s+organizer|cargo\s+liner|car\s+mount|bluetooth\s+headset\s+adapter|fm\s+transmitter|(auto|car|garage)\s+floor\s+mat)\b/.test(
        t,
      ) ||
      (site === 'automotive' && /\b(floor\s+mat|seat\s+cushion|mat)\b/.test(t)),
  },

  // --- Tools (accessories & outdoor power before general power tools) ---
  {
    value: 'tools/outdoor-power',
    parent: 'Tools',
    label: 'Outdoor Power',
    match:
      /\b(ice auger|(?:lawn|reel|riding|push)\s+mower|mower|string\s+trimmer|weed\s+(?:eater|whacker|trimmer)|leaf\s+blower|blower$|chainsaws?|pole\s+saws?|hedge\s+trimmer|pressure\s+washer|surface\s+cleaner|snow\s+blower|tiller|cultivator|lawn\s+edger|edger\b|log\s+splitter|wood\s+chipper|earth\s+auger|post\s+hole\s+digger|stump\s+grinder|dethatcher|aerator|backpack\s+sprayer|pump\s+sprayer|sprayer\b(?!.*(?:paint|head|faucet|sink))|trimmer\s+(?:line|head|spool|attachment)|chainsaw\s+chain|guide\s+bar)\b/,
  },
  {
    value: 'tools/batteries-chargers',
    parent: 'Tools',
    label: 'Batteries & Chargers',
    match: (t, site) =>
      /\b(tool\s+battery|tool\s+charger|battery\s+charger.*tool)\b/.test(t) ||
      (site === 'tools' && /\b(battery|charger|inverter)\b/.test(t)),
  },
  {
    value: 'tools/accessories',
    parent: 'Tools',
    label: 'Bits & Blades',
    match:
      /\b(drill\s+bits?|driver\s+bits?|impact\s+bits?|router\s+bits?|screwdriver\s+bit|bit\s+set|hole\s+saws?|saw\s+blades?|blade\s+set|oscillating\s+blades?|sanding\s+(?:discs?|belts?|pads?|sheets?|blocks?)|sandpaper|grinding\s+(?:wheels?|discs?)|cutting\s+(?:wheels?|discs?)|flap\s+discs?|wire\s+(?:wheels?|brush(?:es)?)|socket\s+sets?|impact\s+sockets?|socket\s+adapter|chucks?|arbors?|mandrels?|collets?|dado|abrasive|sharpening\s+stone|diamond\s+blade)\b/,
  },
  {
    value: 'tools/power-tools',
    parent: 'Tools',
    label: 'Power Tools',
    match: (itemType, category) => {
      if (category === 'tools' && itemType.startsWith('cordless')) {
        return true;
      }

      return /\b(tool[ -]only|cordless (ratchet|press tool)|drill(?:\s+driver)?|impact\s+(?:driver|wrench)|hammer\s+drill|rotary\s+hammer|miter\s+saw|circular\s+saw|reciprocating\s+saw|table\s+saw|jigsaw$|band\s+saw|scroll\s+saw|track\s+saw|tile\s+saw|cut-off\s+saw|chop\s+saw|oscillating\s+(?:tool|multi-tool)|multi-tool|angle\s+grinder|bench\s+grinder|die\s+grinder|sanders?|polishers?|buffers?|wood\s+router|plunge\s+router|trim\s+router|planers?|jointers?|nailers?|nail\s+gun|brad\s+nailer|framing\s+nailer|power\s+tool|combo\s+kit|grease\s+gun|caulk\s+gun|heat\s+gun|glue\s+gun|soldering|welders?|welding|plasma\s+cutter|powder\s+actuated|rivet\s+gun|paint\s+sprayer|concrete\s+vibrator|drywall\s+screw\s+gun|nibbler|cutout\s+tool|air\s+inflator|inflator\b)\b/.test(
        itemType,
      );
    },
  },
  {
    value: 'tools/safety-workwear',
    parent: 'Tools',
    label: 'Safety & Workwear',
    match:
      /\b(hard\s+hats?|safety\s+(?:glasses|goggles?|vest|harness|helmet|boot|shoe)|goggles|work\s+gloves?|nitrile\s+gloves?|leather\s+gloves?|cut-resistant\s+gloves?|ear\s+(?:muffs?|plugs?|protection)|hearing\s+protection|knee\s+pads?|respirators?|dust\s+masks?|face\s+shields?|welding\s+(?:helmet|glove|jacket)|fall\s+protection|hi-vis|high\s+visibility|coveralls|work\s+apron)\b/,
  },
  {
    value: 'tools/tool-storage',
    parent: 'Tools',
    label: 'Tool Storage',
    match:
      /\b(?<!hair )(tool\s+(?:chest|box(?:es)?|bag|belt|pouch(?:es)?|organizer|cabinet|cart|tote|roll|stand|rack|holster)|parts\s+organizer|workbench(?:es)?|sawhorses?)\b/,
  },
  {
    value: 'tools/ladders-moving',
    parent: 'Tools',
    label: 'Ladders & Moving',
    match:
      /\b(ladders?|step\s+stools?|scaffolding|scaffolds?|work\s+platform|hand\s+trucks?|dollies|dolly|platform\s+truck|hoists?|winch(?:es)?)\b/,
  },
  {
    value: 'tools/shop-equipment',
    parent: 'Tools',
    label: 'Shop Equipment',
    match:
      /\b(tool\s+lot|air\s+compressors?|(?<!steam )generators?|shop\s+vac|wet[\s/-]+dry\s+vac|air\s+movers?|dust\s+extractor|work\s+lights?|shop\s+lights?|trouble\s+light|vises?|anvils?|air\s+hose)\b/,
  },
  {
    value: 'tools/hand-measuring',
    parent: 'Tools',
    label: 'Hand Tools',
    match: itemType => {
      if (['cordless', 'fireplace'].some(x => itemType.startsWith(x))) {
        return false;
      }

      return /\b(fitting removal tool|pvc cutter|aviation snips?|pliers|wrench(?:es)?|screwdrivers?|hammers?|mallets?|sledgehammers?|clamps?|laser\s+levels?|levels?\b|tape\s+measures?|measuring\s+(?:tape|wheel)|(?:utility|folding|pocket)\s+knives?|(?:utility|folding|pocket)\s+knife|box\s+cutters?|sheet\s+cutter|chisels?|pry\s+bars?|crowbars?|bolt\s+cutters?|wire\s+(?:stripper|cutter|crimper)|crimpers?|snips|shears|torque\s+wrench|stud\s+finders?|multimeters?|voltage\s+tester|circuit\s+tester|moisture\s+meter|calipers?|micrometers?|framing\s+square|speed\s+square|hex\s+keys?|allen\s+wrench|hand\s+saws?|hacksaws?|coping\s+saw|axes?|hatchets?|mauls?|trowels?|putty\s+knives?|putty\s+knife|scrapers?|ratchets?|breaker\s+bar|tap\s+and\s+die|pipe\s+cutter|tube\s+cutter|fish\s+tape|chalk\s+line|plumb\s+bob|riveters?|staple\s+guns?|extension\s+poles?|torch(?:es)?|hand\s+tools?|tool\s+sets?|tool\s+kits?|mechanic.*set)\b/.test(
        itemType,
      );
    },
  },

  // --- HVAC & Air (before Lighting/Electrical & Appliances) ---
  {
    value: 'hvac/ventilation',
    parent: 'HVAC & Air',
    label: 'Ventilation & Fans',
    match:
      /\b(exhaust\s+fans?|bath\s+fans?|bathroom\s+fans?|fan\s+motors?|inline\s+fan|duct\s+(?:fan|cap)|attic\s+fan|gable\s+fan|crawl\s+space\s+fan|vent\s+(?:cover|grille|register|hood|cap|pipe|duct)|air\s+register|floor\s+register|return\s+grille|ductwork|dryer\s+vent|dampers?|roof\s+vent|soffit\s+vent|chimney\s+cap)\b/,
  },
  {
    value: 'hvac/air-quality',
    parent: 'HVAC & Air',
    label: 'Air Quality',
    match:
      /\b(air\s+filters?|furnace\s+filters?|hvac\s+filters?|air\s+purifiers?|hepa\s+filters?|dehumidifiers?|humidifiers?|thermostats?|hygrometers?|air\s+quality|evaporative\s+cooler|moisture\s+absorber)\b/,
  },
  {
    value: 'hvac/heating-cooling',
    parent: 'HVAC & Air',
    label: 'Heating & Cooling',
    match:
      /\b(space\s+heaters?|propane\s+heaters?|gas\s+heaters?|baseboard\s+heaters?|wall\s+heaters?|garage\s+heaters?|radiant\s+heaters?|electric\s+fireplaces?|fireplace\s+insert|air\s+conditioners?|mini\s+split|ac\s+units?|ceiling\s+fans?|tower\s+fans?|box\s+fans?|pedestal\s+fans?|desk\s+fans?|oscillating\s+fans?|wall\s+mount\s+fans?|drum\s+fans?|misting\s+fans?|floor\s+fans?|portable\s+fans?|handheld\s+fans?|neck\s+fans?)\b/,
  },

  // --- Lighting & Electrical ---
  {
    value: 'lighting/outdoor',
    parent: 'Lighting & Electrical',
    label: 'Outdoor Lighting',
    match:
      /\b(post\s+lights?|outdoor\s+(?:wall\s+)?(?:lights?|lanterns?|sconces?|fixtures?|lamps?)|flood\s+lights?|security\s+lights?|motion\s+(?:sensor\s+)?lights?|path(?:way)?\s+lights?|landscape\s+lights?|solar\s+(?:spot\s+)?lights?|string\s+lights?|deck\s+lights?|step\s+lights?|porch\s+lights?|barn\s+lights?|dusk\s+to\s+dawn|area\s+lights?|bollard\s+lights?|bollards?|pier\s+mount)\b/,
  },
  {
    value: 'lighting/bulbs-strips',
    parent: 'Lighting & Electrical',
    label: 'Bulbs & Strips',
    match:
      /\b(led\s+bulbs?|light\s+bulbs?|bulbs?\b|led\s+(?:light\s+)?strips?|strip\s+lights?|tape\s+lights?|neon\s+signs?|led\s+signs?|grow\s+lights?|fluorescent\s+tubes?|led\s+tubes?|rope\s+lights?)\b/,
  },
  {
    value: 'lighting/indoor',
    parent: 'Lighting & Electrical',
    label: 'Indoor Lighting',
    match:
      /\b(pendant\s+(?:lights?|lamps?)|ceiling\s+lights?|flush\s+mount|semi-flush|chandeliers?|vanity\s+lights?|wall\s+sconces?|sconces?|recessed\s+lights?|recessed\s+.*trim|downlights?|can\s+lights?|track\s+light(?:ing|s)?|floor\s+lamps?|table\s+lamps?|desk\s+lamps?|bedside\s+lamps?|mood\s+lamps?|lamp\s*shades?|led\s+panel|panel\s+lights?|high\s+bay|under[\s-]+cabinet\s+light(?:ing|s)?|puck\s+lights?|night\s+lights?|picture\s+lights?|reading\s+lights?|ring\s+lights?|light\s+fixtures?|linear\s+lights?|troffers?|wraparound\s+light|closet\s+light|garage\s+light|led\s+lights?)\b/,
  },
  {
    value: 'lighting/detectors',
    parent: 'Lighting & Electrical',
    label: 'Detectors & Alarms',
    match:
      /\b(smoke\s+(?:and\s+co\s+)?detectors?|smoke\s+alarms?|co\s+detectors?|carbon\s+monoxide|radon\s+detectors?|fire\s+alarms?)\b/,
  },
  {
    value: 'lighting/electrical-safety',
    parent: 'Lighting & Electrical',
    label: 'Electrical & Wiring',
    match:
      /\b(circuit\s+breakers?|breaker\s+box|load\s+center|electrical\s+panel|transfer\s+switch(?:es)?|duplex\s+outlets?|gfci|outlets?|receptacles?|wall\s+plates?|(?:light|dimmer|toggle|rocker|timer)\s+switch(?:es)?|^switch(?:es)?$|extension\s+cords?|surge\s+protectors?|power\s+strips?|outdoor\s+timers?|conduit|junction\s+box(?:es)?|electrical\s+box(?:es)?|lamp\s+sockets?|electrical\s+wire|romex|wire\s+connectors?|wire\s+nuts?|ground\s+rod|transformers?|ballasts?|ev\s+chargers?|doorbells?)\b/,
  },

  // --- Health & Beauty (before Plumbing/Computers/Appliances for raised toilet seats, BP monitors, flat irons) ---
  {
    value: 'health/massage',
    parent: 'Health & Beauty',
    label: 'Massage & Recovery',
    match:
      /\b((?:back|foot|neck)\s+massagers?|massage\s+guns?|massagers?|foot\s+(?:bath|spa)|heating\s+pads?|ice\s+packs?|tens\s+unit)\b/,
  },
  {
    value: 'health/mobility-medical',
    parent: 'Health & Beauty',
    label: 'Mobility & Medical',
    match: (t, site) =>
      /\b(raised\s+toilet\s+seat|bed\s+rails?|shower\s+(?:seats?|chairs?|bench(?:es)?|stools?)|bath\s+(?:seats?|bench(?:es)?|chairs?)|transfer\s+bench|grab\s+bars?|wheelchairs?|wheelchair\s+ramp|rollators?|canes?\b|crutch(?:es)?|blood\s+pressure|thermometers?|oximeters?|glucose|nebulizers?|cpap|hearing\s+aids?|(?:knee|ankle|back|wrist)\s+brace|brace\b|splints?|compression\s+(?:socks?|sleeves?)|wedge\s+pillows?|bed\s+wedge|incontinence|adult\s+diapers?|first\s+aid|bandages?|gauze|pill\s+organizers?|stethoscopes?|bathroom\s+scale|body\s+scale)\b/.test(
        t,
      ) ||
      (site === 'health-beauty' && /\bseat\s+cushion\b/.test(t)),
  },
  {
    value: 'health/personal-care',
    parent: 'Health & Beauty',
    label: 'Personal Care',
    match:
      /\b(body\s+(?:wash|lotion|oil|scrub|butter|cream)|shampoo|conditioner|cologne|perfume|fragrance|deodorant|face\s+(?:wash|cream|serum|mask)|moisturizer|sunscreen|lip\s+balm|acne\s+patch(?:es)?|skincare|makeup|cosmetics?|nail\s+(?:polish|lamp|drill|clipper)|electric\s+toothbrush(?:es)?|toothbrush(?:es)?|water\s+flosser|mouthwash|razors?|shavers?|beard\s+trimmer|nose\s+trimmer|hair\s+(?:dryer|straightener|curler|clipper|trimmer|bundle|clip|brush(?:es)?|comb|extension|oil|mask)|flat\s+iron|curling\s+iron|hairspray|wigs?\b|eyelash(?:es)?|tweezers?|epilators?|ipl|supplements?|vitamins?|protein\s+powder|collagen|probiotics?|melatonin|essential\s+oils?|diffusers?|bath\s+bombs?|hand\s+sanitizer|hand\s+soap|bar\s+soap|cotton\s+swab|feminine|tampons?|sanitary)\b/,
  },

  // --- Plumbing & Bath ---
  {
    value: 'plumbing/toilets-bidets',
    parent: 'Plumbing & Bath',
    label: 'Toilets & Bidets',
    match:
      /\b(toilets?(?!\s+(?:paper\s+holder|brush))|bidets?|urinals?|flush\s+valve|fill\s+valve|flapper|wax\s+ring|plungers?)\b/,
  },
  {
    value: 'plumbing/vanities-mirrors',
    parent: 'Plumbing & Bath',
    label: 'Vanities & Mirrors',
    match:
      /\b(bathroom\s+vanity|vanity\s+(?:top|cabinet|sidesplash|backsplash|mirror)|vanity\b(?!\s+light)|bathroom\s+mirror|led\s+mirror|medicine\s+cabinet)\b/,
  },
  {
    value: 'plumbing/water-filters-heaters',
    parent: 'Plumbing & Bath',
    label: 'Water Filters & Heaters',
    match:
      /\b(water\s+heaters?|tankless|water\s+filters?|fridge\s+filters?|refrigerator\s+.*filter|water\s+softener|reverse\s+osmosis|ro\s+system|filtration|ice\s+maker\s+connector)\b/,
  },
  {
    value: 'plumbing/pumps-water',
    parent: 'Plumbing & Bath',
    label: 'Pumps & Pipe Fittings',
    match:
      /\b((?:utility|sump|sewage|well|transfer|booster|circulation|submersible|water)\s+pumps?|macerator|drain\s+hose|supply\s+line|gas\s+line|pex|pvc\s+pipe|copper\s+pipe|pipe\s+fitting|tube\s+cap|ball\s+valve|check\s+valve|shut-off\s+valve|pressure\s+regulator|backflow|expansion\s+tank|manifold|drain\s+(?:auger|snake)|^elbow$)\b/,
  },
  {
    value: 'plumbing/showers-tubs',
    parent: 'Plumbing & Bath',
    label: 'Showers & Tubs',
    match:
      /\b(shower\s+(?:faucet|head|valve|trim|arm|door|enclosure|pan|base|niche|drain|caddy|curtain|rod|system|panel|kit|tote)|handheld\s+shower|tub\s+(?:spout|drain|faucet|filler|door|surround)|bath\s+drain|bathtubs?|towel\s+(?:bar|ring|rack|warmer|hook)|toilet\s+paper\s+holder|robe\s+hook|bathroom\s+hardware|bath\s+hardware|bathroom\s+accessory)\b/,
  },
  {
    value: 'plumbing/faucets-sinks',
    parent: 'Plumbing & Bath',
    label: 'Faucets & Sinks',
    match:
      /\b(faucets?|(?:kitchen|bathroom|laundry|utility|vessel|undermount|drop-in|bar)\s+sinks?|sinks?\b|pop-up\s+drain|sink\s+drain|channel\s+drain|floor\s+drain|trench\s+drain|drain\s+kit|garbage\s+disposal|soap\s+dispensers?|pot\s+filler|sprayer\s+head|aerators?|p-trap)\b/,
  },

  // --- Outdoor & Garden (before Building/Hardware so edging & landscape fabric stay here) ---
  {
    value: 'outdoor/grills-fire',
    parent: 'Outdoor & Garden',
    label: 'Grills & Fire Pits',
    match:
      /\b(grills?|smokers?|fire\s+pits?|fire\s+table|patio\s+heaters?|propane\s+(?:hose|tank|regulator)|coolers?\b(?!.*(?:wine|beverage|evaporative|cpu))|ice\s+chest|pool\s+(?:chemical|float|pump|filter|cover|ladder|vacuum|net|toy|cleaner)|inflatable\s+float|hot\s+tub|spa\s+cover)\b/,
  },
  {
    value: 'outdoor/patio-grills-pools',
    parent: 'Outdoor & Garden',
    label: 'Patio & Shade',
    match:
      /\b(canopies|canopy|gazebos?|pergolas?|patio\s+umbrellas?|umbrella\s+(?:base|stand)|awnings?|shade\s+(?:sails?|cloths?)|privacy\s+screens?|patio\s+(?:furniture|chair|table|sofa|set|bench|cushion)|adirondack|hammocks?|porch\s+swing|outdoor\s+(?:chair|table|rug|cushion|bench|furniture|sofa)|chair\s+cushions?)\b/,
  },
  {
    value: 'outdoor/lawn-garden',
    parent: 'Outdoor & Garden',
    label: 'Lawn & Garden',
    match:
      /\b(garden\s+hoses?|hose\s+(?:reel|nozzle|regulator|splitter|cart)|sprinklers?|drip\s+irrigation|irrigation|landscape\s+(?:edging|fabric|pebble|rock|staple|border)|edging\b|weed\s+(?:killer|barrier|control)|herbicides?|pesticides?|insecticides?|fertilizers?|plant\s+food|potting\s+soil|mulch|grass\s+seed|planters?|flower\s+pots?|ceramic\s+pots?|plant\s+(?:stand|saucer|caddy|hanger|pot)|raised\s+garden\s+bed|garden\s+beds?|greenhouses?|trellis(?:es)?|garden\s+(?:fence|stake|decor|decoration|arch|kneeler|cart|tool)|wheelbarrows?|composters?|bird\s+(?:feeder|bath|house)|wind\s+chimes?|flagpoles?|garden\s+flags?|shovels?|rakes?|hoes?\b|pruners?|loppers?|post\s+digger|tree\s+guard|frost\s+cloth)\b/,
  },

  // --- Building & Hardware ---
  {
    value: 'building/fasteners',
    parent: 'Building & Hardware',
    label: 'Fasteners & Anchors',
    match:
      /\b(screws?|nails?\b|framing\s+nails?|finish\s+nails?|roofing\s+nails?|brad\s+nails?|concrete\s+anchors?|wall\s+anchors?|wedge\s+anchors?|sleeve\s+anchors?|toggle\s+bolts?|anchor\s+bolts?|deck\s+fasteners?|fasteners?|flooring\s+staples?|staples?\b|bolts?\b|hex\s+nuts?|lock\s+nuts?|rivets?|threaded\s+rods?|joist\s+hangers?|hurricane\s+ties?|post\s+(?:bases?|caps?|connectors?)|tie\s+plates?|angle\s+brackets?|corner\s+braces?|mending\s+plates?)\b/,
  },
  {
    value: 'building/cabinet-hardware',
    parent: 'Building & Hardware',
    label: 'Cabinet Hardware',
    match:
      /\b(cabinet\s+(?:knobs?|pulls?|hinges?|latches?|handles?)|drawer\s+(?:pulls?|slides?|knobs?|handles?)|shelf\s+brackets?|closet\s+rod\s+support|casters?|turnbuckles?|ratchet\s+straps?|tie\s+downs?)\b/,
  },
  {
    value: 'building/doors-hardware',
    parent: 'Building & Hardware',
    label: 'Doors & Locks',
    match:
      /\b(door\s+(?:knobs?|handles?|levers?|hinges?|closers?|stops?|sweeps?|bottoms?|locks?|viewers?|knockers?|hardware|slabs?|kits?|tracks?)|^doors?$|deadbolts?|smart\s+locks?|keypad\s+locks?|padlocks?|locksets?|^locks?$|gate\s+(?:latch(?:es)?|hinges?|kits?|hardware)|barn\s+doors?|pocket\s+doors?|screen\s+doors?|storm\s+doors?|bifold\s+doors?|mailbox(?:es)?|house\s+numbers?|address\s+plaques?|hasps?|key\s+box|lock\s+box)\b/,
  },
  {
    value: 'building/flooring-tile',
    parent: 'Building & Hardware',
    label: 'Flooring & Tile',
    match:
      /\b(flooring|vinyl\s+plank|laminate|hardwood|(?:porcelain|ceramic|mosaic|wall|floor|carpet|subway|drop\s+ceiling|backsplash|peel-and-stick)\s+tiles?|backsplash|tiles?\b|stair\s+(?:treads?|nosing|risers?)|baseboards?|moldings?|mouldings?|quarter\s+round|transition\s+strips?|thresholds?|underlayment|grout|mortar|thinset|tile\s+(?:spacer|leveling)|^trim$)\b/,
  },
  {
    value: 'building/cabinets',
    parent: 'Building & Hardware',
    label: 'Cabinets',
    match: /\b((?:wall|base|kitchen|pantry|garage|utility)\s+cabinets?)\b/,
  },
  {
    value: 'building/cabinets-decking',
    parent: 'Building & Hardware',
    label: 'Fencing & Decking',
    match:
      /\b(line\s+posts?|deck\s+posts?|fence\s+(?:posts?|panels?)|deck\s+railings?|railing\s+posts?|balusters?|handrails?|newels?|deck\s+(?:boards?|tiles?)|lattice|siding|shingles?|roofing|flashing|gutters?|downspouts?|shutters?|[w]indow\s+screens?|^[w]indows?$|skylights?|column\s+wrap|post\s+sleeves?)\b/,
  },
  {
    value: 'building/paint-walls-prep',
    parent: 'Building & Hardware',
    label: 'Paint & Materials',
    match:
      /\b(paint\b(?!.*(?:by\s+number|palette))|primers?|wood\s+stain|varnish|polyurethane|wallpaper|caulk|sealants?|silicone|adhesives?|wood\s+glue|liquid\s+glue|epoxy|drop\s+cloths?|painter.?s\s+tape|masking\s+tape|duct\s+tape|foil\s+tape|acoustic\s+panels?|wall\s+panels?|decorative\s+panels?|peel-and-stick\s+panels?|slat\s+wall|insulation|access\s+panels?|weather\s*stripping|[w]indow\s+film|contractor\s+bags?|tarps?|drywall|spackle|joint\s+compound|patching|paint\s+(?:rollers?|trays?|brush(?:es)?)|mesh\s+screen|hardware\s+cloth|sheet\s+metal|plexiglass|acrylic\s+sheet|plywood|lumber|foam\s+board|vapor\s+barrier|house\s+wrap)\b/,
  },

  // --- Appliances ---
  {
    value: 'appliances/vacuums-floorcare',
    parent: 'Appliances',
    label: 'Vacuums',
    match:
      /\b((?:stick|handheld|robot|upright|canister|cordless)\s+vacuums?|vacuums?\b|vacuum\s+filters?|steam\s+cleaners?|steam\s+mops?|carpet\s+cleaners?|spot\s+cleaners?|floor\s+scrubbers?)\b/,
  },
  {
    value: 'appliances/laundry',
    parent: 'Appliances',
    label: 'Laundry',
    match:
      /\b(laundry\s+pedestals?|washing\s+machines?|clothes\s+(?:washers?|dryers?)|portable\s+(?:washers?|dryers?)|washer\s+dryer|spin\s+dryer|(?:handheld|garment|clothes)\s+steamers?|steamers?\b|steam\s+iron|clothes\s+iron|ironing\s+boards?)\b/,
  },
  {
    value: 'appliances/kitchen',
    parent: 'Appliances',
    label: 'Kitchen',
    match:
      /\b(microwaves?|range\s+hoods?|cooktops?|induction|ovens?\b|toasters?|air\s+fryers?|coffee\s+makers?|espresso|k-cup|milk\s+frothers?|ice\s+makers?|refrigerators?|mini\s+fridges?|freezers?|wine\s+coolers?|beverage\s+coolers?|dishwashers?|blenders?|food\s+processors?|stand\s+mixers?|hand\s+mixers?|juicers?|slow\s+cookers?|crock\s+pots?|pressure\s+cookers?|rice\s+cookers?|instant\s+pots?|hot\s+plates?|electric\s+kettles?|tea\s+kettles?|waffle\s+makers?|yogurt\s+makers?|griddles?|panini|deep\s+fryers?|dehydrators?|bread\s+makers?|meat\s+(?:slicers?|grinders?)|vacuum\s+sealers?|heat\s+sealers?|sous\s+vide|popcorn\s+(?:makers?|poppers?)|ice\s+cream\s+makers?|water\s+dispensers?|kegerators?|warming\s+trays?|electric\s+skillets?|stove\s+covers?)\b/,
  },

  // --- Electronics ---
  {
    value: 'electronics/audio',
    parent: 'Electronics',
    label: 'Audio',
    match:
      /\b(earbuds?|headphones?|headsets?|bluetooth\s+speakers?|smart\s+speakers?|speakers?|soundbars?|subwoofers?|microphones?|turntables?|record\s+players?|stereo\s+receivers?|amplifiers?|audio\s+interfaces?|karaoke|walkie\s+talkies?|radios?\b|boombox(?:es)?|cd\s+players?|mp3|hearing\s+amplifiers?)\b/,
  },
  {
    value: 'electronics/phones-wearables',
    parent: 'Electronics',
    label: 'Phones & Wearables',
    match:
      /\b(phone\s+cases?|phones?\b|smartphones?|iphones?|cell\s+phones?|tablet\s+(?:cases?|stands?)|tablets?\b|ipads?|e-readers?|kindles?|screen\s+protectors?|smart\s*watch(?:es)?|fitness\s+trackers?|smart\s+rings?|smart\s+glasses|watch\s+bands?|phone\s+(?:mounts?|stands?)|stylus(?:es)?|apple\s+pencil|selfie\s+sticks?)\b/,
  },
  {
    value: 'electronics/computers',
    parent: 'Electronics',
    label: 'Computers',
    match:
      /\b(laptops?|chromebooks?|macbooks?|desktop\s+pcs?|mini\s+pcs?|computers?|(?:computer|gaming|portable)\s+monitors?|^monitors?$|keyboards?|(?:computer|wireless|gaming)\s+mouse|keyboard\s+and\s+mouse|trackpads?|webcams?|wi-?fi|routers?|modems?|mesh\s+systems?|network\s+switch(?:es)?|ethernet|usb\s+hubs?|docking\s+stations?|kvms?|ssds?|hard\s+drives?|flash\s+drives?|sd\s+cards?|memory\s+cards?|printers?|scanners?|toners?|ink\s+cartridges?|laptop\s+(?:stands?|batteries|battery|chargers?)|monitor\s+(?:arms?|stands?)|mouse\s+pads?|cooling\s+pads?|graphics\s+cards?|motherboards?|cpus?|pc\s+cases?|server\s+racks?)\b/,
  },
  {
    value: 'electronics/smart-home-security',
    parent: 'Electronics',
    label: 'Smart Home',
    match:
      /\b(security\s+cameras?|trail\s+cameras?|ip\s+cameras?|nvr|dvr|video\s+doorbells?|smart\s+doorbells?|smart\s+plugs?|smart\s+hubs?|smart\s+home|alarm\s+systems?|motion\s+sensors?|door\s+sensors?|tracker\s+tags?|airtags?|gps\s+trackers?|intercoms?|metal\s+detectors?)\b/,
  },
  {
    value: 'electronics/tv-video-cameras',
    parent: 'Electronics',
    label: 'TV & Cameras',
    match:
      /\b(tv\s+(?:wall\s+)?mounts?|televisions?|smart\s+tvs?|tv\s+antennas?|projectors?|projection\s+screens?|projector\s+(?:screens?|lamps?)|action\s+cameras?|body\s+cameras?|digital\s+cameras?|camera\s+cases?|cameras?\b|camcorders?|tripods?|gimbals?|drones?|streaming\s+(?:devices?|sticks?|box(?:es)?)|digital\s+photo\s+frames?|hdmi|remote\s+controls?|capture\s+cards?|green\s+screens?|studio\s+lights?|softbox(?:es)?|game\s+controllers?|^controllers?$)\b/,
  },
  {
    value: 'electronics/power-cables',
    parent: 'Electronics',
    label: 'Cables & Power',
    match:
      /\b(power\s+banks?|portable\s+power\s+stations?|solar\s+panels?|wireless\s+chargers?|wall\s+chargers?|usb\s+chargers?|charging\s+(?:stations?|cables?|pads?|docks?)|power\s+adapters?|ac\s+adapters?|usb\s+cables?|lightning\s+cables?|power\s+cords?|ups\b|battery\s+backups?|batteries|battery\b|alkaline|lithium\s+battery|coin\s+battery|adapters?\b)\b/,
  },

  // --- Sports & Toys (before Home so vibration plates & camping chairs land here) ---
  {
    value: 'sports-toys/fitness',
    parent: 'Sports & Toys',
    label: 'Fitness',
    match:
      /\b(vibration\s+plates?|treadmills?|walking\s+pads?|exercise\s+bikes?|stationary\s+bikes?|ellipticals?|rowing\s+machines?|steppers?|dumbbells?|kettlebells?|barbells?|weight\s+(?:plates?|bench(?:es)?|racks?|sets?)|weighted\s+vests?|(?:yoga|exercise|interlocking|gym)\s+mats?|resistance\s+bands?|pull-up\s+bars?|push-up|ab\s+rollers?|jump\s+ropes?|foam\s+rollers?|medicine\s+balls?|pilates|boxing|punching\s+bags?|inversion\s+tables?|squat\s+racks?|bench\s+press)\b/,
  },
  {
    value: 'sports-toys/camping-rec',
    parent: 'Sports & Toys',
    label: 'Camping & Fishing',
    match:
      /\b(camping\s+(?:chairs?|tables?|cots?|stoves?|lanterns?|mats?|pads?|gear|tents?)|pop-up\s+tents?|beach\s+tents?|tents?\b|sleeping\s+(?:bags?|pads?)|fishing\s+(?:rods?|reels?|tackle|nets?|kits?|lines?|lures?)|kayaks?|paddleboards?|paddles?\b|oars?\b|life\s+(?:jackets?|vests?)|dry\s+bags?|binoculars?|telescopes?|monoculars?|spotting\s+scopes?|compass(?:es)?|stadium\s+seats?|bleacher\s+seats?|trekking\s+poles?|hiking|headlamps?|flashlights?|tactical|hunting|tree\s+stands?|beach\s+(?:chairs?|umbrellas?)|folding\s+wagons?|utility\s+wagons?)\b/,
  },
  {
    value: 'sports-toys/sports-bikes',
    parent: 'Sports & Toys',
    label: 'Sports & Bikes',
    match:
      /\b(basketballs?|footballs?|soccer|baseballs?|baseball\s+gloves?|softballs?|volleyballs?|tennis|pickleball|badminton|golf\b(?!\s+cart)|hockey(?!\s+table)|lacrosse|archery|bow\s+and\s+arrow|dartboards?|cornhole|disc\s+golf|bowling|bicycles?|bikes?\b|e-bikes?|scooters?|skateboards?|longboards?|roller\s+skates?|inline\s+skates?|helmets?\b|shin\s+guards?|batting|goal\s+nets?|rebounders?|ball\s+pumps?|swim\s+goggles?|snorkels?|wetsuits?|surfboards?|sleds?\b|snowboards?|skis?\b)\b/,
  },
  {
    value: 'sports-toys/toys-games-music',
    parent: 'Sports & Toys',
    label: 'Toys & Games',
    match:
      /\b((?:water|foam)\s+blasters?|nerf|blasters?|ride-on|toys?\b|board\s+games?|card\s+games?|puzzles?|stuffed\s+animals?|plush|action\s+figures?|dolls?|dollhouses?|playsets?|building\s+blocks?|lego|magnetic\s+tiles?|arcade\s+games?|air\s+hockey|foosball|pool\s+tables?|ping\s+pong|table\s+tennis|bounce\s+houses?|ball\s+pits?|trampolines?|swing\s+sets?|rc\s+cars?|remote\s+control\s+(?:cars?|trucks?|boats?|helicopters?|planes?)|train\s+sets?|slot\s+cars?|play\s+kitchens?|coloring|craft\s+kits?|slime|play-doh|bingo|chess|poker|mahjong|digital\s+pianos?|keyboard\s+pianos?|guitars?|ukuleles?|drum\s+sets?|violins?|trumpets?|harmonicas?|music\s+stands?|metronomes?|kites?|bubble\s+machines?|fidget|collectibles?|trading\s+cards?)\b/,
  },

  // --- Home ---
  {
    value: 'home/rugs-mats',
    parent: 'Home',
    label: 'Rugs & Mats',
    match:
      /\b(area\s+rugs?|runner\s+rugs?|rugs?\b|rug\s+pads?|door\s*mats?|floor\s+mats?|bath\s*mats?|kitchen\s+mats?|anti-fatigue\s+mats?|chair\s+mats?|string\s+mats?|welcome\s+mats?|entryway\s+mats?|^mats?$)\b/,
  },
  {
    value: 'home/curtains-blinds',
    parent: 'Home',
    label: 'Curtains & Blinds',
    match:
      /\b(curtain\s+rods?|curtains?\b|drapes?|valances?|[w]indow\s+(?:blinds?|shades?)|blinds?\b|roller\s+shades?|roman\s+shades?|venetian\s+blinds?)\b/,
  },
  {
    value: 'home/towels-linens',
    parent: 'Home',
    label: 'Towels & Linens',
    match:
      /\b(bath\s+towels?|hand\s+towels?|washcloths?|towel\s+sets?|kitchen\s+towels?|dish\s+towels?|tablecloths?|table\s+runners?|placemats?|napkins?|(?:couch|sofa|chair)\s+(?:covers?|cushions?)|slipcovers?)\b/,
  },
  {
    value: 'home/bedding-linens',
    parent: 'Home',
    label: 'Bedding',
    match:
      /\b(sheet\s+sets?|fitted\s+sheets?|flat\s+sheets?|bed\s+sheets?|pillowcases?|pillows?\b|comforters?|quilts?|duvets?|bedspreads?|blankets?|throws?\b|mattress\s+(?:toppers?|protectors?|pads?|covers?)|air\s+mattress(?:es)?|mattress(?:es)?\b|box\s+springs?|bed\s+skirts?)\b/,
  },
  {
    value: 'home/kitchen-dining',
    parent: 'Home',
    label: 'Kitchen & Dining',
    match:
      /\b(cookware|frying\s+pans?|skillets?|saucepans?|stockpots?|dutch\s+ovens?|woks?|roasting\s+pans?|bakeware|baking\s+(?:sheets?|pans?|dish(?:es)?|mats?)|cake\s+pans?|muffin\s+pans?|casseroles?|water\s+bath\s+canner|food\s+storage|meal\s+prep|lunch\s+box(?:es)?|bento|chafing\s+dish(?:es)?|knife\s+(?:sets?|strips?)|chef\s+knives?|steak\s+knives?|kitchen\s+knives?|cutting\s+boards?|utensils?|spatulas?|ladles?|whisks?|tongs|colanders?|strainers?|mixing\s+bowls?|measuring\s+(?:cups?|spoons?)|dinner\s+plates?|charger\s+plates?|plates?\b(?!.*(?:wall|license|weight|vibration|hot|tie|mending))|dinnerware|bowls?\b|mugs?\b|cups?\b|drinking\s+glasses?|wine\s+glasses?|champagne\s+flutes?|tumblers?|water\s+bottles?|shaker\s+bottles?|thermos(?:es)?|flasks?|pitchers?|carafes?|drink\s+dispensers?|mason\s+jars?|teapots?|french\s+press|dish\s+racks?|drying\s+mats?|spice\s+racks?|silverware|flatware|cutlery|serving\s+(?:trays?|platters?|bowls?)|lazy\s+susan|canisters?|bread\s+box(?:es)?|wine\s+racks?|bottle\s+(?:openers?|pourers?)|jar\s+openers?|corkscrews?|can\s+openers?|can\s+sleeves?|peelers?|graters?|mandolines?|garlic\s+press|kitchen\s+scales?|ice\s+cube\s+trays?|ice\s+cream\s+cone\s+holders?|straws?\b|coasters?|trivets?|oven\s+mitts?|pot\s+holders?|aprons?\b|mini\s+pots?)\b/,
  },
  {
    value: 'home/storage-organization',
    parent: 'Home',
    label: 'Storage',
    match:
      /\b(storage\s+(?:bins?|containers?|box(?:es)?|baskets?|racks?|totes?|bags?|chests?|bench(?:es)?|cubes?|drawers?|carts?|shelves?|organizers?|trunks?)|shelving\s+units?|wire\s+shelves?|floating\s+shelves?|wall\s+shelves?|corner\s+shelves?|shelves?\b|shelf\b|shoe\s+(?:racks?|organizers?|cabinets?|box(?:es)?|storage)|closet\s+organizers?|cabinet\s+organizers?|drawer\s+organizers?|desk\s+organizers?|pantry\s+organizers?|makeup\s+organizers?|jewelry\s+(?:box(?:es)?|organizers?)|trash\s+cans?|garbage\s+cans?|waste\s+baskets?|recycling\s+bins?|laundry\s+(?:baskets?|hampers?|sorters?|bags?)|drying\s+racks?|clothes\s+racks?|garment\s+racks?|utility\s+carts?|rolling\s+carts?|key\s+racks?|hangers?\b|hooks?\b|pegboards?|gun\s+safes?|safes?\b|cash\s+box(?:es)?|file\s+box(?:es)?|crates?\b|baskets?\b|bins?\b|organizers?\b)\b/,
  },
  {
    value: 'home/furniture',
    parent: 'Home',
    label: 'Furniture',
    match:
      /\b(bed\s+frames?|folding\s+beds?|headboards?|footboards?|bunk\s+beds?|daybeds?|futons?|sofas?|couch(?:es)?|sectionals?|loveseats?|recliners?|armchairs?|accent\s+chairs?|dining\s+chairs?|office\s+chairs?|gaming\s+chairs?|folding\s+chairs?|rocking\s+chairs?|bar\s*stools?|counter\s+stools?|stools?\b|desks?\b|(?:coffee|end|side|console|dining|folding|accent|vanity)\s+tables?|bookshelves?|bookcases?|dressers?|chest\s+of\s+drawers|nightstands?|wardrobes?|armoires?|ottomans?|tv\s+stands?|entertainment\s+centers?|sideboards?|buffets?|credenzas?|hutches?|coat\s+racks?|hall\s+trees?|room\s+dividers?|bean\s+bags?|chairs?\b)\b/,
  },
  {
    value: 'home/decor',
    parent: 'Home',
    label: 'Decor',
    match:
      /\b(wall\s+art|canvas\s+art|framed\s+art|posters?|tapestries|picture\s+frames?|photo\s+frames?|(?:wall|floor|full-length)\s+mirrors?|mirrors?\b|decorative\s+vases?|vases?\b|(?:wall|desk|alarm)\s+clocks?|clocks?\b|(?:artificial|faux)\s+(?:plants?|flowers?|trees?|greenery|succulents?)|candles?|candle\s+holders?|figurines?|sculptures?|statues?|centerpieces?|decorative\s+(?:bowls?|trays?|pillows?|box(?:es)?|accents?|signs?|globes?)|wall\s+(?:decor|hangings?|decals?)|bookends?|snow\s+globes?|music\s+box(?:es)?|tissue\s+box\s+cover|doorstops?)\b/,
  },
  {
    value: 'home/cleaning-household',
    parent: 'Home',
    label: 'Cleaning',
    match:
      /\b(cleaners?\b|detergents?|laundry\s+products?|bleach|disinfectants?|sanitizing\s+spray|stain\s+removers?|fabric\s+softeners?|dryer\s+sheets?|air\s+fresheners?|odor\s+eliminators?|mops?\b|mop\s+buckets?|brooms?|dust\s*pans?|squeegees?|sponges?|scrub\s+brush(?:es)?|toilet\s+brush(?:es)?|dusters?|microfiber\s+cloths?|cleaning\s+(?:cloths?|kits?|brush(?:es)?|pads?|wipes?)|wet\s+wipes?|trash\s+bags?|garbage\s+bags?|paper\s+towels?|lint\s+rollers?|buckets?\b|pest\s+control|insect\s+traps?|mouse\s+traps?|bug\s+zappers?|fly\s+swatters?|repellents?|step\s+cans?|clotheslines?|clothespins?|lint\s+traps?)\b/,
  },

  // --- Apparel & Bags ---
  {
    value: 'apparel/clothing-accessories',
    parent: 'Apparel & Bags',
    label: 'Apparel & Bags',
    match:
      /\b(polos?|t-shirts?|tees?\b|shirts?|blouses?|sweaters?|cardigans?|hoodies?|sweatshirts?|jackets?|coats?\b|vests?\b|dress(?:es)?|skirts?|pants?\b|jeans?\b|shorts?\b|leggings?|joggers?|trousers?|suits?\b|blazers?|bodysuits?|rompers?|jumpsuits?|bikinis?|swimsuits?|swimwear|lingerie|shapewear|underwear|boxers?|briefs|bras?\b|socks?\b|pajamas?|robes?\b|lounge\s+sets?|boots?\b|shoes?\b|sneakers?|sandals?|slippers?|loafers?|heels?\b|hats?\b|beanies?|scarves|scarf|gloves?\b|belts?\b|sunglasses|eyeglasses|watch(?:es)?\b|jewelry|necklaces?|bracelets?|earrings?|rings?\b|backpacks?|duff(?:el|le)\s+bags?|tote\s+bags?|handbags?|purses?|wallets?|briefcases?|laptop\s+bags?|messenger\s+bags?|luggage|suitcases?|carry-ons?|packing\s+cubes?|fanny\s+packs?|umbrellas?\b|ponchos?|raincoats?)\b/,
  },

  // --- Office & Misc ---
  {
    value: 'office/office-shipping',
    parent: 'Office & Misc',
    label: 'Office & Shipping',
    match:
      /\b(shipping\s+box(?:es)?|cardboard\s+box(?:es)?|cake\s+box(?:es)?|mailers?|bubble\s+wrap|packing\s+tape|stretch\s+wrap|shipping\s+labels?|label\s+(?:makers?|printers?)|postal\s+scales?|whiteboards?|bulletin\s+boards?|cork\s+boards?|chalkboards?|easels?|books?\b|workbooks?|planners?|notebooks?|journals?|calendars?|binders?|folders?|clipboards?|staplers?|shredders?|laminators?|calculators?|pens?\b|pencils?|markers?|highlighters?|scissors|tape\s+dispensers?|envelopes?|sticky\s+notes?|stickers?|newsprint|kraft\s+.*bags?|circle\s+punch|hole\s+punch|display\s+(?:cases?|stands?)|grid\s+wall|slatwall|mannequins?|stanchions?|backdrops?|sign\s+holders?|brochure\s+holders?|cash\s+registers?|barcode\s+scanners?|receipt\s+printers?|time\s+clocks?|badge\s+holders?|lanyards?|party\s+suppl|balloons?|gift\s+bags?|wrapping\s+paper|ribbons?|art\s+suppl|sewing|yarn|crafts?)\b/,
  },
  {
    value: 'office/misc-lots',
    parent: 'Office & Misc',
    label: 'Bulk & Misc Lots',
    match:
      /\b((?:miscellaneous|misc|assorted|bathroom|hardware|mixed|electronic|school\s+accessory)\s+lots?|lot\s+box(?:es)?|mystery\s+box(?:es)?)\b/,
  },
];

const BY_VALUE = new Map(CATEGORIES.map(c => [c.value, c]));

const CUSTOM_PARENTS = new Set(CATEGORIES.map(c => c.parent));

const PARENT_SUB_COUNTS = new Map<string, number>();
for (const c of CATEGORIES) {
  PARENT_SUB_COUNTS.set(c.parent, (PARENT_SUB_COUNTS.get(c.parent) ?? 0) + 1);
}

/**
 * Where unmapped site-category fallbacks nest in the two-level tree so they never appear as
 * duplicate top-level rows alongside a custom parent.
 */
const SITE_FALLBACK_PARENT: Record<string, string> = {
  automotive: 'Automotive',
  Building_Hardware: 'Building & Hardware',
  'electronics-appliances': 'Electronics',
  'General-Merchandise': 'Office & Misc',
  'health-beauty': 'Health & Beauty',
  home: 'Home',
  'lighting-electrical': 'Lighting & Electrical',
  outdoor: 'Outdoor & Garden',
  'plumbing-bath': 'Plumbing & Bath',
  tools: 'Tools',
  Toys_Sports: 'Sports & Toys',
} satisfies Record<SiteCategory, string>;

/**
 * Single-subcategory parents whose matching site category can absorb unmapped lots directly instead
 * of creating a redundant "Other" child.
 */
const SINGLE_SUB_FALLBACK: Record<string, CategoryDef> = {
  Apparel: BY_VALUE.get('apparel/clothing-accessories')!,
  'baby-kids': BY_VALUE.get('baby-kids/gear')!,
  Pets: BY_VALUE.get('pets/supplies')!,
};

/** Whether a category value belongs to a fixed custom category (not a site fallback). */
export const isCustomCategory = (value: string): boolean => BY_VALUE.has(value);

/** Classify a lot into its fixed custom category, falling back to the site's category. */
export function categorizeLot(lot: Pick<Lot, 'category' | 'itemType'>): {
  value: string;
  label: string;
} {
  const type = lot.itemType?.trim().toLowerCase();
  const site = lot.category.value;
  assert(isSiteCategory(site), `Unexpected site category: ${site}`);
  if (type) {
    for (const def of CATEGORIES) {
      const matched =
        typeof def.match === 'function' ? def.match(type, site) : def.match.test(type);
      if (matched) {
        return { value: def.value, label: def.label };
      }
    }
  }
  const single = SINGLE_SUB_FALLBACK[site];
  if (single) {
    return { value: single.value, label: single.label };
  }
  return lot.category;
}

/** A top-level row in the sidebar's category tree. */
export interface CategoryGroup {
  /** Collapse/React key (parent name for groups, facet value for standalone fallbacks). */
  id: string;
  label: string;
  /** Total lot count across this group (sum of subs, or the standalone facet's count). */
  count: number;
  /** Subcategory facets; empty for standalone fallback site categories. */
  subs: Facet<string>[];
  /** Standalone facet when subs is empty. */
  facet: Facet<string> | null;
}

/** All leaf category values covered by a group. */
export function groupValues(g: CategoryGroup): string[] {
  if (g.subs.length) {
    return g.subs.map(s => s.value);
  }
  return g.facet ? [g.facet.value] : [];
}

export const categoryCollapseId = (id: string) => `cat:${id}`;

/**
 * Group flat category facets into a two-level tree: custom categories nested under their parent,
 * with unmapped site-category fallbacks nested as "Other" under their matching parent so no parent
 * name is duplicated at the top level.
 */
export function groupCategories(facets: Facet<string>[]): CategoryGroup[] {
  const byParent = new Map<string, Facet<string>[]>();
  const fallbackByParent = new Map<string, Facet<string>[]>();
  const standalone: CategoryGroup[] = [];

  for (const f of facets) {
    const def = BY_VALUE.get(f.value);
    if (def) {
      let list = byParent.get(def.parent);
      if (!list) {
        list = [];
        byParent.set(def.parent, list);
      }
      list.push(f);
      continue;
    }

    const fallbackParent =
      SITE_FALLBACK_PARENT[f.value] ?? (CUSTOM_PARENTS.has(f.label) ? f.label : undefined);
    if (fallbackParent) {
      let list = fallbackByParent.get(fallbackParent);
      if (!list) {
        list = [];
        fallbackByParent.set(fallbackParent, list);
      }
      list.push({ ...f, label: 'Other' });
    } else {
      standalone.push({
        id: f.value,
        label: f.label,
        count: f.count,
        subs: [],
        facet: f,
      });
    }
  }

  const allParents = new Set([...byParent.keys(), ...fallbackByParent.keys()]);
  const groups: CategoryGroup[] = [];
  for (const parent of allParents) {
    const customSubs = (byParent.get(parent) ?? []).toSorted((a, b) =>
      collator.compare(a.label, b.label),
    );
    const otherSubs = fallbackByParent.get(parent) ?? [];
    const subs = [...customSubs, ...otherSubs];

    if (subs.length === 1 && otherSubs.length === 0 && PARENT_SUB_COUNTS.get(parent) === 1) {
      // Single-subcategory parents (Pets, Baby & Kids, Apparel & Bags, Seasonal & Holiday)
      // work cleanly as standalone top-level items without redundant nesting.
      const only = subs[0]!;
      groups.push({
        id: only.value,
        label: parent,
        count: only.count,
        subs: [],
        facet: only,
      });
    } else {
      groups.push({
        id: parent,
        label: parent,
        count: subs.reduce((sum, s) => sum + s.count, 0),
        subs,
        facet: null,
      });
    }
  }

  return [...groups, ...standalone].toSorted((a, b) => collator.compare(a.label, b.label));
}

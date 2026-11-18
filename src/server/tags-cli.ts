// The tags command (a port of the Python server's `tlx_server.tags`).
//
// Tags: any number of short labels per item, beyond its one item type. A plain
// tag ("cabinet knob") is a label; "name: value" ("finish: satin nickel") is an
// attribute, and the app offers a dropdown per attribute name to filter the
// current results by its values.
//
// A lot's tags come from two places, merged:
// - tags set on the lot itself, stored like item types: by brand/model when
//   both are known, else by exact title, so a relisted item keeps them;
// - rules: a regular expression (case-insensitive, matched anywhere in the
//   title) and the tags every matching lot gets, now and in future pulls. A
//   rule's tag can use what the pattern captured: $1 for the first group,
//   ${name} for (?<name>...), $0 for the whole match, $$ for a dollar sign
//   (single-quote such tags in the shell). A tag whose group captured nothing
//   is left out.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { DEFAULT_DB } from './main';
import { Store } from './store';
import { compileTagPattern } from './tags';

const PREVIEW_TITLES = 15;

const HELP = `Usage: npm run tags -- [--db FILE] COMMAND

Change tags while the server runs; open app tabs pick changes up on their next check.

  set LOT_ID TAG...          replace a lot's tags (and those of the same item listed again)
  show LOT_ID                print a lot's tags, and the rules that give it any
  clear LOT_ID               remove a lot's tags
  reset                      forget the tags set on lots (rules are kept)
  rule add PATTERN TAG...    add a rule; it applies to current and future lots
  rule preview PATTERN [TAG...]  list the current lots a pattern matches, without saving
  rule list                  print every rule with its id
  rule remove RULE_ID        drop a rule (the tags it gave go away)

  --db FILE                  SQLite file (default ${DEFAULT_DB})

Examples:
  npm run tags -- set 198469 "cabinet knob" "finish: satin nickel"
  npm run tags -- rule add '\\bcabinet (knob|pull)s?\\b' "cabinet hardware"
  npm run tags -- rule preview '(satin nickel|brass|chrome)' 'finish: $1'
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function id(text: string | undefined): number {
  const n = Number(text);
  if (!text || !Number.isInteger(n)) {
    fail(`expected a number, got ${JSON.stringify(text ?? '')}`);
  }
  return n;
}

function rule(store: Store, [cmd, ...rest]: string[]) {
  switch (cmd) {
    case 'list': {
      const rules = store.tagRules();
      for (const r of rules) {
        console.log(`${String(r.id).padStart(4)}  /${r.pattern}/ → ${r.tags.join(', ')}`);
      }
      if (!rules.length) {
        console.log('(no rules)');
      }
      return;
    }
    case 'preview': {
      const [pattern = '', ...tags] = rest;
      const preview = store.previewTagRule(pattern, tags, PREVIEW_TITLES);
      for (const m of preview.matches) {
        console.log(`${m.title}${m.adds.length ? `  → ${m.adds.join(', ')}` : ''}`);
      }
      const more = preview.titles > PREVIEW_TITLES ? ` (first ${PREVIEW_TITLES} shown)` : '';
      console.log(`${preview.lots} lots, ${preview.titles} distinct titles match${more}`);
      return;
    }
    case 'add': {
      const [pattern = '', ...tags] = rest;
      const [r, changed] = store.addTagRule(pattern, tags);
      console.log(
        `rule ${r.id}: /${r.pattern}/ → ${r.tags.join(', ')}\n  lots updated: ${changed.size}`,
      );
      return;
    }
    case 'remove': {
      const ruleId = id(rest[0]);
      const changed = store.removeTagRule(ruleId);
      if (!changed) {
        fail(`no rule ${ruleId}`);
      }
      console.log(`removed rule ${ruleId}\n  lots updated: ${changed.size}`);
      return;
    }
    default:
      fail(HELP);
  }
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      db: { type: 'string', default: DEFAULT_DB },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) {
    console.log(HELP);
    process.exit(values.help ? 0 : 2);
  }
  if (!existsSync(values.db)) {
    fail(`no database at ${values.db}`);
  }
  const store = new Store(values.db);
  try {
    if (cmd === 'rule') {
      rule(store, rest);
      return;
    }
    if (cmd === 'reset') {
      console.log(`forgot ${store.resetTags()} tag rows`);
      return;
    }
    if (!['set', 'show', 'clear'].includes(cmd)) {
      fail(HELP);
    }
    const lotId = id(rest[0]);
    const lot = store.lot(lotId);
    if (!lot) {
      fail(`lot ${lotId} is not in the catalog`);
    }
    if (cmd === 'show') {
      console.log((lot.tags ?? ['(no tags)']).join('\n'));
      for (const r of store.tagRules()) {
        if (compileTagPattern(r.pattern).test(lot.title)) {
          console.log(`  from rule ${r.id}: /${r.pattern}/ → ${r.tags.join(', ')}`);
        }
      }
      return;
    }
    if (cmd === 'set' && rest.length < 2) {
      fail('give at least one tag (or use clear)');
    }
    const changed = store.saveLotTags([[lot, cmd === 'set' ? rest.slice(1) : []]], {
      manual: true,
    });
    const tags = store.lot(lotId)?.tags ?? [];
    console.log(
      `${lot.title}\n  tags: ${tags.join(', ') || '(none)'}\n  lots updated: ${changed.size}`,
    );
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    store.close();
  }
}

main();

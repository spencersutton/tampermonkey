---
name: simplify-filters
description: Simplify the lot-title filter regexes stored in the tlx server database, show a diff, and save them after the user confirms. Use when the user asks to simplify, merge or clean up their filters.
model: haiku
allowed-tools: Bash(env PYTHONPATH=server python3 -m tlx_server.filters get), Bash(env PYTHONPATH=server python3 -m tlx_server.filters diff:*)
---

Simplify the filter regexes stored in the tlx server database. Only make a change when the result is still a short, readable regex. Leaving a filter alone is better than a clever rewrite.

Always read and write the filters through `tlx_server.filters`, run from the repo root. Never open the database with `sqlite3` or any other tool, and never write the filters any other way: `apply` is what backs up the database and checks nobody else edited the list.

## Steps

1. Read the current filters:
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters get
   ```
   The first line is `# rev N, …`. Remember N.
2. Work out the simplified list using the rules below.
3. Show the diff, passing the whole new list on stdin with a quoted heredoc (so `\`, `$` and quotes stay as they are):
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters diff <<'EOF'
   …one filter per line…
   EOF
   ```
   If it prints `no changes`, say nothing could be simplified safely and stop.
4. Reply with the diff and the notes described under Output, then ask the user to confirm. Stop and wait. Don't run `apply` in the same turn.
5. Only after the user says yes, save the exact same list:
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters apply --rev N <<'EOF'
   …the same lines…
   EOF
   ```
   It backs up the database first and prints where. If it says the filters changed since rev N, start again from step 1. If the user asks for changes, go back to step 3 with the edited list.

## How filters are matched

Each line is compiled by `compileFilter` in `src/shared/filters.ts`:

```ts
const EDGE = '(?:(?<!\\w)|(?!\\w))';
new RegExp(`${EDGE}(?:${pattern})${EDGE}`, 'i');
```

A title is hidden if any filter matches. So:

- **Case-insensitive.** `Gold` and `gold` are the same, so filters that differ only in case can be merged.
- **Whole-word at both ends.** A match can't start or end in the middle of a word. This also works next to punctuation, so `\(Gold\)` can match at the end of a title.
- **The ends still need `s?` for plurals.** `light` won't match "lights", so keep `lights?`.
- **A `\b` inside a pattern is still needed.** The whole-word rule only covers the two ends. `gold\b.*mirror` blocks "golden mirror" and `gold.*mirror` doesn't.
- **Filters are OR'd together.** Two filters can be merged into one alternation, or one can be dropped if another already matches everything it matches.

## Safe simplifications

- Merge filters that share a prefix or suffix into one alternation, e.g. `gold\b.*(mirror|door)` + `Gold\b.*plates?` → `gold\b.*(mirror|door|plates?)`.
- Drop an optional group right after `.*`. `.*(metal )?candlesticks?` → `.*candlesticks?`, because `.*` already matches "metal ".
- Drop a filter that another filter already fully covers. Say which filter covers it.
- Remove duplicate alternatives and unneeded groups.

## Broader merges (allowed, with a warning)

A merge that makes a filter match more titles than before is allowed if it's clearly simpler. For example, merging `(antique|brushed) gold` and `(aged|cocoa) bronze` into `(antique|brushed|aged|cocoa) (gold|bronze)` also catches "cocoa gold". Mark every change like this with **⚠ Broader:** and list the new matches it adds, so the user can decide whether to keep it.

## Don't

- Don't remove `\b`, `s?`, `^` or other anchors unless the reasoning above shows they do nothing.
- Don't rewrite into something longer or harder to read, even if it's technically equivalent.
- Don't change case just for looks. Leave capitalisation alone unless you're merging filters.

## Output

Keep the filters in their stored order; a merged filter goes where the first of its parts was.

1. The diff from step 3 in a fenced `diff` block.
2. A short bullet per change: what changed, and why it matches exactly the same titles. Give one example title it still matches if that helps. For a broader merge, start the bullet with **⚠ Broader:** and list the titles it now catches that it didn't before.
3. One line asking whether to save it.

Don't edit any files. The database only changes through `apply`.

$ARGUMENTS

---
name: simplify-sort-types
description: Simplify the "item types for sorting" regexes stored in the tlx server database, show a diff, and save them after the user confirms. Use when the user asks to simplify, dedupe or clean up their sort types or sorting filters.
model: haiku
allowed-tools: Bash(env PYTHONPATH=server python3 -m tlx_server.filters --list sort-types get), Bash(env PYTHONPATH=server python3 -m tlx_server.filters --list sort-types diff:*)
---

Simplify the item-type regexes used for sorting, stored in the tlx server database. Only make a change when the result is still a short, readable regex. Leaving a type alone is better than a clever rewrite.

Always read and write the list through `tlx_server.filters --list sort-types`, run from the repo root. Never open the database with `sqlite3` or any other tool, and never write the list any other way: `apply` is what backs up the database and checks nobody else edited the list.

## Steps

1. Read the current types:
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters --list sort-types get
   ```
   The first line is `# rev N, …`. Remember N.
2. Work out the simplified list using the rules below.
3. Show the diff, passing the whole new list on stdin with a quoted heredoc (so `\`, `$` and quotes stay as they are):
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters --list sort-types diff <<'EOF'
   …one type per line…
   EOF
   ```
   If it prints `no changes`, say nothing could be simplified safely and stop.
4. Reply with the diff and the notes described under Output, then ask the user to confirm. Stop and wait. Don't run `apply` in the same turn.
5. Only after the user says yes, save the exact same list:
   ```bash
   env PYTHONPATH=server python3 -m tlx_server.filters --list sort-types apply --rev N <<'EOF'
   …the same lines…
   EOF
   ```
   It backs up the database first and prints where. If it says the list changed since rev N, start again from step 1. If the user asks for changes, go back to step 3 with the edited list.

## How item types are used

Each line is compiled by `compileFilter` in `src/shared/filters.ts` (case-insensitive, whole words at both ends, same as the filters), then used by `sortKey` in `src/shared/sortKey.ts`:

- Every type is tried against the title. **The longest match wins**, and a tie goes to the match earlier in the title. The order of the list doesn't matter.
- The text the winning type matched is moved to the front of the title for sorting, so "1/3 HP Garbage Disposal" sorts as "Garbage Disposal 1/3 HP".
- The sidebar shows how many lots each type is used for, so a type that never wins shows 0.

This is not like the filters, where any match is enough. Here, **which** type wins and **what text** it matched both matter:

- **A longer type is not redundant just because a shorter one also matches.** `chainsaw chain` beats `chainsaw` on "Chainsaw Chain 16 in.", so both are needed. The same goes for `hole saw arbor` vs `hole saw`, `kitchen sink` vs `sink`.
- **A shorter type is redundant** only if another type always matches the same text or more at the same place. `monitor` is covered by `monitors?`; `stapler` by `stapler|staple gun`; `water filter` by `water filters?`.
- **Merging types into one alternation can change the winner.** Inside one regex the earliest position wins, not the longest text. Only merge types that match the same words in different spellings or plurals (`refrigerator|fridge`, `shower ?head`), and never merge a type with a longer type that contains it.

## Safe simplifications

- Remove exact duplicates, including ones that differ only in case (`Welding tip` and `welding tip`).
- Remove a type that another type fully covers, as above. Say which type covers it.
- Fold plain plural pairs together: `speaker` + `speakers?` → `speakers?`.
- Remove duplicate alternatives and unneeded groups inside one type.

## Broader changes (allowed, with a warning)

A change that makes a type win on titles where it didn't before, or match different text, is allowed if it's clearly simpler. Mark every change like this with **⚠ Broader:** and say which titles now sort differently, so the user can decide whether to keep it.

## Also point out (don't change)

- Likely typos, like `water fitration` or `battry inverter`. List them in a separate note; don't fix them unless the user asks.

## Don't

- Don't remove `\b`, `s?`, `^`, `$` or other anchors unless the reasoning above shows they do nothing.
- Don't rewrite into something longer or harder to read, even if it's technically equivalent.
- Don't change case just for looks.

## Output

Keep the types in their stored order; a merged type goes where the first of its parts was.

1. The diff from step 3 in a fenced `diff` block.
2. A short bullet per change: what changed, and why every title still sorts the same. For a broader change, start the bullet with **⚠ Broader:** and say which titles now sort differently.
3. The typo note, if there is one.
4. One line asking whether to save it.

Don't edit any files. The database only changes through `apply`.

$ARGUMENTS

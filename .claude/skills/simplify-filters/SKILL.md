---
name: simplify-filters
description: Simplify a pasted list of lot-title filter regexes without changing what they match. Use when the user pastes filter patterns and asks to simplify, merge or clean them up.
model: haiku
argument-hint: <paste filter list, one regex per line>
---

Simplify the filter regexes the user pasted (one per line). Only make a change when the result is still a short, readable regex. Leaving a filter alone is better than a clever rewrite.

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

1. The full simplified list in one fenced code block, one filter per line, in the same order as the input (merged filters go where the first one was).
2. A short bullet per change: what changed, and why it matches exactly the same titles. Give one example title it still matches if that helps. For a broader merge, start the bullet with **⚠ Broader:** and list the titles it now catches that it didn't before.
3. If nothing can be simplified safely, say so in one line and repeat the list unchanged.

Don't edit any files. This skill only answers in chat.

$ARGUMENTS

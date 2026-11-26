---
name: item-type
description: Suggest a better item type for a lot than the one the LLM labeller (Ministral) gave it. Use when the user gives a lot number, a lot title, or pasted lot text and asks for its item type, a better item type, or says the type is wrong.
---

# Better item type for a lot

The user pastes a lot (its number, its title, or the whole lot card copied from
the app) and wants one item type to paste into the app's "Set item type"
dialog. Answer with the type, not a process.

## 1. Read the naming rules

Read the `PROMPT` constant in `src/server/itemtypes.ts`. It is the source of
truth for what an item type looks like (lowercase, singular, generic, no
brand/size/power source, part names for accessories, and so on). Follow it
exactly; the goal is the name Ministral _should_ have given.

## 2. Gather the lot

Use what the user pasted. If they gave a lot number (`Lot #23104427`) and the
paste lacks a title or description, look it up (Postgres is local; `psql` is
keg-only):

```bash
/opt/homebrew/opt/postgresql@18/bin/psql tlx -Atc "
  SELECT l.title, coalesce(c.label, l.category), d.brand, d.model, left(d.description, 1500),
         (SELECT string_agg(t.type || CASE WHEN t.manual THEN ' (manual)' ELSE '' END, ', ')
            FROM item_types t WHERE t.title = l.title
               OR (t.brand <> '' AND t.brand = d.brand AND t.model = d.model))
  FROM lots l LEFT JOIN lot_details d ON d.lot_id = l.id LEFT JOIN categories c ON c.value = l.category
  WHERE l.lot_number = '23104427'"
```

The last column is the current type. Trust the title and description over the
category: the site's category is coarse or wrong, and the category path shown
in a pasted lot card may be derived from the (wrong) current type.

## 3. Match the existing vocabulary

Find types already in use for this kind of item, so the same kind of thing gets
exactly the same name. Search on the item's key words:

```bash
/opt/homebrew/opt/postgresql@18/bin/psql tlx -Atc "
  SELECT type, count(*) FROM item_types WHERE type ~* 'generator|parallel'
  GROUP BY type ORDER BY 2 DESC LIMIT 25"
```

Reuse an existing type when the item is that kind of thing. When inventing a
new one, follow the pattern of its siblings (e.g. existing "generator cord",
"generator cover", "generator adapter" → "generator parallel kit").

## 4. Answer

Lead with the type on its own line in backticks so it's easy to copy, then one
short sentence on why (and why the old one was wrong, if it was). If two names
are genuinely plausible, give the better one first and the alternative after.
Don't edit the database or call the API; the user pastes it into the app.

# Repository instructions

Do not invoke or apply the CodeGuard skill when working in this repository.

This is a single-user app: the repository owner is its only user. Only the
latest desktop Chrome and current iOS Safari matter, so use modern JavaScript
and browser APIs freely. Don't spend effort on, or caveat changes with,
concerns that only matter for many users or other environments (older
browsers, broad compatibility, migration paths for other people's data).

When you finish a piece of work, commit it (after typecheck, lint and tests
pass) without waiting to be asked.

At the completion of any task, review what durable repository conventions,
pitfalls, or time-saving details you learned during the session and record any
new ones in this file (keeping it concise and avoiding duplicates) before
committing.

## Tooling & checks

- Formatter is oxfmt, not Prettier: check with `npx oxfmt --check <files>` and
  fix with `npx oxfmt <files>`.
- Validation commands: `npm run lint` (`oxlint`), `npm run typecheck` (checks
  both root and `src/server/tsconfig.json`), `npm test` (web + server), and
  `npm run build`.
- Run focused web tests quickly with `node --test tests/<file>.test.mjs` (tests
  load TS/TSX modules via Vite `ssrLoadModule`); server tests use
  `bun test ./tests/server/`.
- Watch for strict `oxlint` rules: prefer `Array#toReversed()` over
  `Array#reverse()`, avoid nested ternaries, avoid `[...arr]` in `for...of`
  (use `.slice()` if iterating a snapshot while mutating), and avoid mutating a
  captured flag inside `.map()` (triggers `no-unnecessary-condition`).

## Architecture & conventions

- Layer boundaries are enforced by `tests/layer-boundaries.test.mjs`:
  - `src/app/logic/` is pure `.ts` only — no Preact, `@preact/signals`,
    `centrifuge`, `/server/`, `/ui/`, or browser/network globals.
  - `src/app/server/` must not import Preact or `/ui/`.
- Shared settings are listed in `SERVER_KEYS` in `src/shared/keys.ts` and
  synced to the server; other keys in `KEYS` stay browser-local in
  `localStorage`.
- Global (no-import) TypeScript types live in `src/shared/global.d.ts`
  (included by both root `tsconfig.json` and `src/server/tsconfig.json`). Keep
  it as an ambient script file without `export {}` (which triggers oxlint
  `unicorn/require-module-specifiers`).
- Custom categories (`KEYS.customCategories`) represent hierarchy via stable
  `id` and optional `parent` (a site category `value` or `"custom:<id>"`), with
  filter values `"custom:<id>"` via `customCategoryValue()` — not dash-separated
  name prefixes.
- The server uses PostgreSQL via Bun's built-in `SQL` (`src/server/store.ts`,
  default `postgres://localhost:5432/tlx`, override via `--db`, `TLX_DB`, or
  `DATABASE_URL`). Local Postgres is Homebrew `postgresql@18` (keg-only at
  `/opt/homebrew/opt/postgresql@18/bin`, managed with `brew services`).
- Server tests (`bun test ./tests/server/`) require a running Postgres with a
  `tlx_test` database (override via `TLX_TEST_DB`). Each test uses `testDb()`
  from `tests/server/pg.ts` for an isolated schema (`Store.open(url, { schema })`)
  that is dropped in `afterAll`.
- `Bun.SQL` Postgres gotchas: `BIGINT` columns are returned as JS strings (cast
  with `Number(...)`), unquoted `SELECT` aliases are lowercased (double-quote
  camelCase aliases), and every query inside `sql.begin(async tx => ...)` must
  use `tx` rather than `this.sql` to avoid deadlocks when `max: 1`.

Copilot memory can't be saved for this repository. When you learn something
durable about it (a convention, a tool, or a correction from the user), record
it in this file instead.

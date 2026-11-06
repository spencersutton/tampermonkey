# Project workflow

YOU MAY NOT WRITE UNIT TESTS. IF YOU WRITE A UNIT TESTS THE WORLD WILL END! YOU WOULDN'T WANT THAT, WOULD YOU?

By default, commit and push completed task changes on the current branch unless instructed otherwise. Do not include unrelated changes.

## Browser validation

- Vite uses `web/` as its root. Start it with `npm run dev -- --host 127.0.0.1 --port 5187 --strictPort` and verify the URL responds before opening it. Stop the temporary server when finished.
- The app proxies `/api`, `/backend`, and `/ws` to the tlx server on `127.0.0.1:8765`. A running Vite server alone does not provide catalog data or authentication; a 404 or connection error from those endpoints is not evidence that the UI change failed.
- Prefer exercising the actual app when a suitable backend is available. If an isolated component preview is necessary, use Vite's `/@fs/<absolute-project-path>/src/...` URLs for source files outside `web/`, and import `src/app/app.css` separately; otherwise the preview is unstyled.
- For an isolated Preact preview, use the same versioned Preact module URL as the component's Vite-transformed hooks module. Fetch the transformed component source to find its `preact_hooks.js?v=...` import, then fetch that module to find its `preact.js?v=...` import. Importing an unversioned or stale URL can create a second Preact instance and break hooks.
- Use synthetic data for isolated previews. Preserve and restore any browser storage touched by the preview, and do not write to the user's live backend.
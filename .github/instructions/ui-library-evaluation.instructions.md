---
description: "Use when evaluating UI libraries, component frameworks, form libraries, or drag-and-drop alternatives for this project."
---

# UI library evaluations

Start with the existing UI and the option of keeping or removing a feature, not just replacing it with a dependency. Identify the specific code a candidate would replace, what application-specific logic would remain, and the likely maintenance, accessibility, UX, bundle, licensing, and migration costs. Verify current library documentation and compatibility; distinguish estimates from measured results.

## Project context

- The web app uses Preact and signals, not React. Check `package.json`, `tsconfig.json`, and `vite.config.ts` before assuming React libraries or aliases are configured. React-specific libraries may need `preact/compat`, type configuration, and behavioral testing.
- `src/app/app.css` contains shared and component-specific styling. `src/app/Dialog.tsx` already wraps native `<dialog>` with focus restoration and controlled closing; compare replacements with that behavior rather than assuming it must be replaced.
- `src/app/CategoryEditor.tsx` combines UI with domain logic: category matching and previews, validation, saved-search filter migration, and Apply/Save semantics. A UI library will not eliminate that logic. `src/app/TypeCategory.tsx` is a related category-editing surface.
- In the category editor, drag-and-drop is a convenience, not the only way to reorder. The up/down buttons and `move` function are shared with drag-and-drop and should remain if only dragging is removed. Category order affects regex matching, so preserve ordering behavior and keyboard access. Check README guidance and visible instructions when evaluating removal.

## Candidates to recheck

- [FormKit Drag and Drop](https://drag-and-drop.formkit.com/) has a framework-agnostic API that updates list data. Its default timing may differ from the editor's drop-to-commit behavior; assess that and touch/keyboard support before proposing it.
- [SortableJS](https://github.com/SortableJS/Sortable) supports touch and drag handles, but moves DOM elements; assess synchronization with Preact state.
- [Web Awesome](https://webawesome.com/docs/components/) provides web components for common controls. Assess Preact/TypeScript integration, component behavior, styling migration, and bundle impact.
- [Radix UI](https://www.radix-ui.com/primitives/docs/overview/introduction) and [React Hook Form](https://react-hook-form.com/) are React-oriented; measure the benefit against Preact compatibility and integration work. [daisyUI](https://daisyui.com/docs/install/) requires Tailwind and is a broader styling decision.

For any proposal, describe a small representative pilot and how to verify behavior and bundle impact. Do not claim compatibility or savings were tested unless they actually were.

# UI Instruction Changelog

## v2.1 — 2026-08-12

* Required conditional visual states to use Tailwind branches through `cn`,
  while reserving inline styles for runtime-calculated values such as Motion
  CSS custom properties.

## v2.0 — 2026-08-12

* Recreated the missing UI instructions from Mobii's current shadcn/Base UI,
  Tailwind, feature-component, responsive, font, and client-boundary patterns.

## v1.5 — 2026-07-19

* Removed duplicate feature and support-ticket placement rules; UI placement
  now references `architecture.md`.

## v1.4 — 2026-07-13

* Aligned support issue placement with feature-first architecture guidance.
* Clarified `src/app/support-tickets/_components` is route-private glue only.

## v1.3 — 2026-07-13

* Added feature-first UI placement rules.
* Clarified support issue UI defaults to `src/features/support-issue/components`.
* Restricted route-local `_components` to route-private glue.

## v1.2 — 2026-06-30

* Existing UI instruction version before feature-first placement update.

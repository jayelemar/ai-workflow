Version: 1.5
Last Updated: 2026-07-19

# UI Instructions

## Purpose

Keep route pages and reusable UI components aligned with the existing component
system, Tailwind class composition, and icon usage.

## Applies To

Changes under `src/app`, `src/components/layout`, `src/components/shared`,
`src/components/ui`, and UI code inside route pages.

## Rules

- Wrap main protected route content with `PageContainer` from
  `src/components/layout/page-container.tsx`.
- Check existing primitives and wrappers in `src/components/ui` before creating
  a new UI component.
- Use `PageHeading`, `EmptyState`, `LoadingSpinner`, `MetricCard`,
  `NativeSelect`, `PersonAvatar`, `ProgressBar`, `SearchInput`, and
  `StatusBadge` from `src/components/shared` when those patterns match the UI.
- Use primitives and wrappers from `src/components/ui/*` for buttons, cards,
  dialogs, dropdowns, inputs, labels, skeletons, textareas, checkboxes,
  popovers, sheets, and toasts.
- Keep using `next/image` for app images. When a UI image is remote,
  user-uploaded, or storage-backed and should bypass Next optimization, prefer
  `<Image unoptimized />` instead of dropping to a raw `<img>`.
- Compose Tailwind classes with `cn` from `src/lib/utils.ts` when classes are
  conditional, variant-driven, or merged from caller `className`.
- Use `lucide-react` icons for page actions, navigation indicators, empty
  controls, and metric cards when an icon is needed.
- Keep protected-route shell and fixed-height route layout behavior aligned
  with `src/components/layout/app-shell.tsx`; use `auth.md` for redirect and
  role-gating rules.
- Keep route pages responsible for page-specific state, filtering, sorting,
  dialog state, and render composition; move repeated UI to shared components
  only after it appears across routes.
- Do not create a route-local `_components` folder when `architecture.md`
  assigns the UI to an existing feature namespace.
- Preserve established loading and empty states with `Skeleton`,
  `LoadingSpinner`, and `EmptyState` instead of ad hoc placeholders.

## Placement

- Shared, domain-neutral UI belongs in `src/components/shared`.
- Design-system primitives and Radix/shadcn-style wrappers belong in
  `src/components/ui`.
- Layout shell and container pieces belong in `src/components/layout`.
- Route-specific UI that is not reused can remain in its `src/app/<route>`
  page file.
- Follow `architecture.md` for feature-owned and route-private UI placement.

## Validation

- Run `pnpm typecheck` and `pnpm lint` after component or route-page edits.
- Run focused component tests when touching tested components such as
  `src/components/shared/empty-state.tsx`.
- Run Playwright validation for layout, navigation, or browser-only UI behavior
  when the change affects route flows.
- Run focused tests for AppShell, header, shared map, dashboard, attendance, or
  messages UI when changing those tested surfaces.
- For instruction-only UI guidance updates, run
  `pnpm exec prettier --check .ai/instructions .ai/changelogs`.

## Anti-Patterns

- Creating one-off button, input, card, dialog, or badge implementations when a
  `src/components/ui` or `src/components/shared` component fits.
- Creating custom UI before checking `src/components/ui` and available shadcn
  skills.
- Duplicating `PageContainer` spacing in every page instead of using the shared
  layout wrapper.
- Building custom class string concatenation instead of using `cn`.
- Replacing `next/image` with a raw `<img>` when `unoptimized` on `next/image`
  would satisfy the requirement.
- Using inline SVG icons when a matching `lucide-react` icon is already
  available.
- Moving a large route page into abstractions before a repeated local pattern is
  visible.

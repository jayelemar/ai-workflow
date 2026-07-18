Version: 1.3
Last Updated: 2026-07-13

# Architecture Instructions

## Purpose

Describe repository structure, ownership boundaries, and cross-cutting patterns for the law-firm operations app.

## Applies To

- `src/app/`, `src/components/`, `src/features/`, `src/hooks/`, `src/services/`, `src/lib/`, `src/providers/`, `src/types/`
- `supabase/`, `e2e/`, root Next.js, Vitest, Playwright, TypeScript, and package configuration.

## Key Folder Map

```text
root
|- src
|  |- app
|  |  |- api/**/route.ts
|  |  |- <route>/page.tsx
|  |  `- <route>/route.ts
|  |- features
|  |  `- <feature>
|  |     |- components
|  |     |- store
|  |     `- service.ts
|  |- components
|  |  |- ui
|  |  |- shared
|  |  `- layout
|  |- hooks
|  |- services
|  |- lib
|  `- types
|- supabase
|  |- migrations
|  |- tests/database
|  `- functions
`- e2e
   `- *.spec.ts

```

- `src/app/`: Next.js route entrypoints, route-only composition, route handlers, and page-level wiring.
- `src/features/`: domain feature code, including feature-specific UI, models, stores, and feature-owned services.
- `src/components/`: shared UI primitives, reusable app components, and global layout pieces.
- `src/hooks/`: reusable client hooks shared across routes or features.
- `src/services/`: domain data access, Supabase calls, app-facing service contracts, and service tests.
- `src/lib/`: reusable non-UI helpers, server helpers, permissions, integrations, and utilities.
- `src/types/`: generated database types and normalized domain types.
- `supabase/`: database migrations, policies, database tests, local config, and Edge Functions.
- `e2e/`: Playwright browser workflow tests.


## Rules

- Treat the app as a Next.js App Router project: route entrypoints live under `src/app/`, global layout in `src/app/layout.tsx`, and route redirects in `src/proxy.ts`.
- Keep global providers centralized through `src/providers/app-providers.tsx`; do not instantiate app-wide auth, theme, toaster, or React Query providers in individual pages.
- Keep server API handlers under `src/app/api/**/route.ts`; move reusable server behavior into `src/lib/**` modules like the Gondoor route handlers do.
- Keep domain data access in `src/services/` or `src/features/*/service.ts`; pages and components should consume hooks or services rather than embedding Supabase queries.
- Keep shared UI primitives in `src/components/ui/`, reusable app components in `src/components/shared/`, layout components in `src/components/layout/`, and domain-specific components in `src/features/<feature>/components/` when a matching feature namespace exists.
- Use a feature-first placement rule for new domain code: create or modify feature-owned UI, models, stores, and feature services under `src/features/<feature>/` before adding route-local modules.
- Use `src/app/**/_components` only for route-private glue that cannot reasonably belong to an existing feature namespace.
- For new support issue UI, UI models, and component tests, use `src/features/support-issue/components/`.
- Use `src/app/support-tickets/_components` only for route-private glue; keep support ticket route files focused on route entry composition unless the user explicitly asks for route-local files.
- Keep generated or database-shaped types in `src/types/`; normalize database rows through mapper functions before exposing domain objects.
- Use the `@/*` path alias for imports from `src/`, matching `tsconfig.json`.
- Keep Supabase database state under `supabase/migrations/`, local configuration under `supabase/config.toml`, Edge Functions under `supabase/functions/`, and database tests under `supabase/tests/database/`.
- Keep browser workflow tests under `e2e/`; unit and component tests are colocated as `*.test.ts` or `*.test.tsx`.

## Placement

- Put route-only composition in `src/app/**/page.tsx` or `src/app/**/route.ts`.
- Put feature-owned UI and UI models in `src/features/<feature>/components/`.
- Put reusable business rules, mappers, permission checks, and external integration code in `src/lib/` or `src/services/`.
- Put stateful client hooks in `src/hooks/` unless they are specific to one feature namespace.
- Put Supabase schema and policy changes in migrations, not in application code comments or ad hoc SQL snippets.

## Validation

- Run `pnpm typecheck` when changing TypeScript contracts, imports, route handlers, or shared modules.
- Run `pnpm test --run` for colocated unit/component/service changes.
- Run `pnpm e2e` only for user workflows that depend on browser routing, local Supabase fixtures, or Playwright web-server behavior.
- Run `pnpm build` for Next.js config, layout, server route, or environment changes that can fail only at build time.

## Anti-Patterns

- Adding Supabase queries directly inside page components when a service or hook boundary already exists.
- Creating a second app-wide provider tree outside `AppProviders`.
- Putting reusable server logic directly in `route.ts` files.
- Bypassing mappers and returning raw Supabase rows to UI code.
- Adding app instructions to shared baseline files.

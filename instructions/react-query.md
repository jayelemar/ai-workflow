Version: 1.1
Last Updated: 2026-06-30

# React Query Instructions

## Purpose

Preserve the repository's React Query setup, centralized query key strategy, and
hook-level cache invalidation patterns.

## Applies To

Changes under `src/providers/query-provider.tsx`, `src/hooks`, route pages that
consume hooks, and services called by query hooks.

## Rules

- Keep the single `QueryClient` setup in `src/providers/query-provider.tsx` and
  provide it through `QueryProvider` inside `AppProviders`.
- Preserve the configured defaults unless a cache behavior change is deliberate:
  query `staleTime` 60 seconds, `gcTime` 5 minutes, query retry 1, mutation
  retry 0, and no refetch on window focus.
- Use centralized keys from `src/hooks/query-keys.ts` for reusable queries and
  detail records.
- Put React Query usage in `src/hooks/use-*.ts` files instead of embedding
  `useQuery` or `useMutation` directly in route pages when the data is reused.
- Use `enabled: Boolean(id)` for optional IDs and provide a stable placeholder
  query key for missing IDs, matching `useEmployee` and `useDebtor`.
- Use service functions as `queryFn` and `mutationFn`; do not place Supabase
  query chains in hook bodies.
- Invalidate affected list and detail keys in mutation `onSuccess` callbacks.
- Invalidate all dependent families when a mutation affects cross-page state,
  such as employees, attendance context, payroll summaries, live activity,
  settings, support tickets, or dashboard data.
- Use `void queryClient.invalidateQueries(...)` for fire-and-forget cache
  invalidation inside mutation callbacks.

## Placement

- Add new query keys to `src/hooks/query-keys.ts`.
- Add reusable hooks to `src/hooks/use-<domain>.ts`.
- Keep domain persistence and mapping in `src/services` or existing
  `src/features/*/service.ts` re-exports.
- Consume hooks from `src/app/**/page.tsx` and components rather than importing
  services directly for reactive data.

## Validation

- Run `pnpm typecheck` after query key, hook, or service signature changes.
- Run `pnpm lint` after hook edits.
- Run focused tests when adding hook tests or changing behavior used by tested
  components.
- Run hook tests such as employee, office-location, payroll-record, report, or
  location hooks when cache invalidation changes in those areas.
- Use route or Playwright validation when cache invalidation changes affect
  visible page refresh behavior.

## Anti-Patterns

- Creating ad hoc query key arrays in pages when a key belongs in
  `query-keys.ts`.
- Calling hooks conditionally to handle optional IDs.
- Mutating server data without invalidating the affected list and detail
  caches.
- Importing `supabase` directly into React Query hook files when a service
  function should own the query.
- Creating a second `QueryClientProvider` outside `QueryProvider`.

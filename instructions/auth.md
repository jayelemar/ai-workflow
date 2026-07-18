Version: 1.1
Last Updated: 2026-06-30

# Auth Instructions

## Purpose

Keep authentication state, login redirects, protected routes, and role-based
authorization centralized in the existing auth boundaries.

## Applies To

Changes under `src/providers/auth-provider.tsx`,
`src/components/layout/app-shell.tsx`, `src/app/login/page.tsx`,
`src/constants/routes.ts`, `src/lib/role-routing.ts`, and services used by auth
or profile loading.

## Rules

- Use `AuthProvider` from `src/providers/auth-provider.tsx` as the source of
  session, user, profile, loading, error, sign-in, sign-out, refresh, and profile
  update state.
- Use `useAuth()` inside components and pages that need auth state; do not
  create a second auth context.
- Keep session initialization and `supabase.auth.onAuthStateChange` handling
  inside `AuthProvider`.
- Keep protected path detection and redirect decisions in
  `src/components/layout/app-shell.tsx`.
- Preserve AppShell loading and profile-error states for protected routes;
  protected pages should not render their own session-loading gates.
- Add protected route constants to `protectedRoutes` in
  `src/constants/routes.ts` when a new route requires authentication.
- Use `routes.login` and the `next` query parameter pattern for unauthenticated
  redirects to login.
- Use `getDefaultRouteForRole` and `canAccessRoute` from
  `src/lib/role-routing.ts` for role-based navigation and authorization.
- Keep profile loading through `getProfileByUserId` and auth operations through
  `src/services/authService.ts`.

## Placement

- Route path constants and detail builders belong in `src/constants/routes.ts`.
- Role-to-route access rules belong in `src/lib/role-routing.ts`.
- Auth state and auth methods belong in `src/providers/auth-provider.tsx`.
- Shell-level redirects and protected route loading states belong in
  `src/components/layout/app-shell.tsx`.

## Validation

- Run `pnpm typecheck` and `pnpm lint` after auth, route constant, or role
  routing changes.
- Run focused browser validation for login redirects, protected routes,
  unauthorized role redirects, and sign-out flows when those behaviors change.
- Run focused AppShell, auth provider, login page, and role-routing tests when
  changing the corresponding files.
- Run `pnpm e2e` when route gating or login behavior affects user-visible
  navigation.
- For instruction-only auth guidance updates, run
  `pnpm exec prettier --check .ai/instructions .ai/changelogs`.

## Anti-Patterns

- Duplicating protected-route redirect effects in individual pages.
- Hard-coding protected route strings outside `routes` and `protectedRoutes`.
- Checking role access inline in pages when `role-routing.ts` owns the rule.
- Calling Supabase auth APIs directly from route pages instead of using
  `useAuth` and `authService`.
- Redirecting authenticated login users without considering
  `getDefaultRouteForRole`.

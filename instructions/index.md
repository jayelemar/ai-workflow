Version: 1.2
Last Updated: 2026-07-19

# Index Instructions

## Purpose

Route AI agents to the repository instruction files that match the code they are changing.

## Applies To

- All work in this Next.js, Supabase, and Playwright application.
- Instruction selection for files under `src/`, `supabase/`, `e2e/`, `.ai/`, and project configuration.

## Rules

- Always load `.ai/instructions/shared/security.md` for application code, API routes, Supabase migrations, Supabase Edge Functions, storage, authentication, authorization, uploads, and external integrations.
- Load `.ai/instructions/shared/security-observability.md` for authentication, authorization, privileged actions, sensitive configuration, data access, security audit events, alerts, CI security scanning, or incident response.
- Always load `.ai/instructions/shared/testing.md` before adding, updating, deleting, or choosing validation for tests.
- Load `.ai/instructions/testing.md` when selecting repository validation commands or changing application, Supabase, Playwright, Vitest, or `.ai` workflow tests.
- Load `.ai/instructions/shared/debugging.md` when diagnosing a failure, bugfix, failed validation, or review remediation.
- Load `.ai/instructions/shared/maintainability.md` for production-code changes that add or modify routes, pages, services, components, hooks, libraries, module boundaries, or cross-layer plans.
- Load `.ai/instructions/shared/migrations.md` for any schema, data, policy, storage, permission, or generated-contract migration.
- Load `.ai/instructions/shared/performance-observability.md` for performance-sensitive database, endpoint, background-work, external-integration, or high-risk-flow changes.
- Load `.ai/instructions/shared/documentation-runbooks.md` for security-sensitive domains, cross-system contracts, ownership boundaries, migrations, deployments, or operational recovery changes.
- Load `.ai/instructions/shared/delivery-hygiene.md` when planning, reviewing, committing, or handing off implementation changes.
- Load `.ai/instructions/shared/workflow-state.md` for `.ai/prompts/`, `.ai/templates/`, `.ai/scripts/`, `.ai/plans/`, and workflow status or next-action changes.
- Load `.ai/instructions/ai-workflow.md` and `.ai/instructions/shared/reasoning-quality.md` for `.ai/plans/`, `.ai/artifacts/`, `.ai/prompts/`, `.ai/templates/`, `.ai/scripts/workflow/`, and workflow state changes.
- Load `.ai/instructions/shared/flow-trace-artifacts.md` when creating, syncing, validating, executing, or reviewing a plan with user-facing flow mapping.
- Load `.ai/instructions/architecture.md` for any change that crosses route, provider, service, hook, Supabase, or E2E boundaries.
- Load `.ai/instructions/ui.md` for `src/app/`, `src/components/`, `src/features/*/components/`, and client-side UI composition changes.
- Load `.ai/instructions/auth.md` for auth state, login redirects, protected routes, role routing, and profile loading changes.
- Load `.ai/instructions/react-query.md` for `src/providers/query-provider.tsx`, `src/hooks/`, `src/hooks/query-keys.ts`, and cache invalidation behavior.
- Load `.ai/instructions/data-services.md` for `src/services/`, `src/features/*/service.ts`, `src/types/`, `src/lib/supabaseClient.ts`, and row mapper behavior.
- Load `.ai/instructions/supabase.md` for `supabase/`, database migrations, storage policies, database tests, Supabase Edge Functions, and Supabase CLI scripts.
- Load `.ai/instructions/gondoor.md` for `src/lib/gondoor/`, `src/features/gondoor/`, and `src/app/api/gondoor/`.
- Load `.ai/instructions/maps.md` for `src/components/shared/maps/`, geofence UI, employee location maps, attendance map previews, and MapTiler environment behavior.

## Placement

- Keep repository-wide structure and ownership rules in `architecture.md`.
- Keep UI composition and client interaction rules in `ui.md`.
- Keep auth state and protected routing rules in `auth.md`.
- Keep React Query key and cache rules in `react-query.md`.
- Keep Supabase client, service-layer, mapper, and domain data rules in `data-services.md`.
- Keep schema, RLS, storage, and Edge Function rules in `supabase.md`.
- Keep Gondoor-specific chat, SSE, tools, knowledge, persistence, and artifact rules in `gondoor.md`.
- Keep map provider, MapTiler, geofence, and render-state rules in `maps.md`.
- Keep repository test commands and test-layout facts in `testing.md`; use `shared/testing.md` for portable test strategy and validation selection.
- Keep workflow-plan contracts in `ai-workflow.md`, state transitions in `shared/workflow-state.md`, reasoning safeguards in `shared/reasoning-quality.md`, debugging method in `shared/debugging.md`, and user-flow artifact rules in `shared/flow-trace-artifacts.md`.
- Keep portable maintainability, migration, performance-observability, documentation-runbook, delivery-hygiene, and security-observability rules in their matching `shared/` files; keep provider, path, command, dashboard, and on-call details in local area instructions or runbooks.

## Validation

- Select the narrowest validation command that covers the changed area, then broaden only when the change crosses boundaries.
- Use `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test --run`, and `pnpm e2e` according to changed scope.
- For Supabase migrations, also use local migration and database test commands documented in `supabase.md`.
- For workflow prompt or script changes, validate with `.ai/scripts/maintenance/health-check.mjs` or the relevant `.ai/scripts/**/*.test.*` tests.

## Anti-Patterns

- Editing code after loading only shared baseline instructions when a routed local area file applies.
- Creating a new instruction area for a one-off file or weak pattern.
- Duplicating shared security, testing, or workflow-state rules in local area files.
- Treating this index as a substitute for reading the matching area instructions.

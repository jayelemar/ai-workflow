Version: 1.1
Last Updated: 2026-07-18

# Supabase Instructions

## Purpose

Guide Supabase database, storage, auth-adjacent schema, Edge Function, and local CLI changes.

## Applies To

- `supabase/config.toml`, `supabase/migrations/`, `supabase/scripts/`, `supabase/seeds/`, `supabase/tests/database/`, `supabase/functions/`, and Supabase-backed app services.

## Rules

- Follow `.ai/instructions/shared/migrations.md` for deployed-migration immutability, compatibility, backfill, rollout, monitoring, rollback or recovery, and validation evidence.
- Keep schema, RLS, policy, function, grant, storage, and seed changes in timestamped SQL migrations under `supabase/migrations/`.
- Enable RLS for new exposed tables and pair grants with policies that enforce firm, profile, role, or ownership scope.
- For private or service-role-only data, use private schemas or revoked public access like the two-factor and salary-access migrations do.
- Treat `SECURITY DEFINER` functions as privileged boundaries: include caller checks, firm/profile scope checks, and narrow grants.
- Keep storage bucket definitions in `supabase/config.toml`; keep storage object policies in migrations or `supabase/scripts/` when runtime storage tables must exist first.
- Keep database regression coverage in `supabase/tests/database/` for RLS, storage, RPC atomicity, account deletion, and workflow-sensitive migrations.
- Keep Edge Function request normalization, authorization, rollback, and service abstractions in `supabase/functions/<name>/index.ts` with colocated tests.
- Use the project local Supabase ports from `supabase/config.toml` when configuring Playwright, local scripts, or fixtures.

## Placement

- Put migration SQL in `supabase/migrations/`.
- Put local SQL helper scripts in `supabase/scripts/`.
- Put database tests in `supabase/tests/database/`.
- Put Edge Functions and their tests under `supabase/functions/<function-name>/`.
- Put Supabase client calls used by the Next.js app in `src/services/`, not in migrations or Edge Function code.

## Validation

- Run `pnpm migration:local` after migration changes when local Supabase is available.
- Run the affected `supabase/tests/database/*.test.sql` tests for RLS, storage, RPC, and trigger changes.
- Run `pnpm test --run` for Supabase Edge Function tests because Vitest config maps Deno and Supabase imports for `supabase/functions/**`.
- Run `pnpm typecheck` for app service changes that consume new tables, RPCs, or generated types.

## Anti-Patterns

- Adding a table, function, or storage policy without an accompanying migration.
- Granting `authenticated` access without a row, firm, profile, or ownership predicate.
- Using `SECURITY DEFINER` to bypass an RLS error without documenting and enforcing the caller boundary in SQL.
- Updating Edge Function behavior without its colocated test when a handler or service abstraction exists.

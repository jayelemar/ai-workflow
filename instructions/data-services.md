Version: 1.0
Last Updated: 2026-06-30

# Data Services Instructions

## Purpose

Guide application data access, row normalization, Supabase client use, and service-layer contracts.

## Applies To

- `src/services/`, `src/features/*/service.ts`, `src/lib/supabaseClient.ts`, `src/services/supabaseMappers.ts`, `src/types/`, and domain row mapping code.

## Rules

- Call `assertSupabaseConfigured()` before service operations that require the browser Supabase client.
- Keep Supabase `.from()` and `.rpc()` calls in service modules; expose typed domain functions to hooks and UI.
- Normalize Supabase rows with mapper helpers before returning data to hooks or components.
- Keep salary, role, firm, and permission-sensitive data behind explicit service options or RPCs rather than broad table selects.
- Map Supabase RPC denial or permission errors into domain-specific errors before surfacing them to UI.

## Placement

- Put shared mapper logic in `src/services/supabaseMappers.ts` or the owning service module.
- Put domain contracts in `src/types/domain.ts` or focused type files when the domain already has one.
- Put generated database typings in `src/types/database.generated.ts`.

## Validation

- Run the relevant service test file for mapper, RPC, Supabase error, or permission-mapping changes.
- Run `pnpm test --run` when changing `supabaseMappers`, shared service utilities, or domain row normalization.
- Run `pnpm typecheck` after changing service return types, hook options, domain types, or Supabase result shapes.

## Anti-Patterns

- Returning raw database rows from services to UI.
- Selecting sensitive columns by default when existing services require explicit options or RPC hydration.
- Spreading row-normalization logic across pages or components.
- Treating Supabase RPC errors as generic strings when existing services map denials to domain errors.

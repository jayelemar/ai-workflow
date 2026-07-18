Version: 1.0
Last Updated: 2026-06-30

# Gondoor Instructions

## Purpose

Guide changes to the Gondoor Engine chat, legal knowledge, tools, SSE streaming, persistence, and generated artifacts.

## Applies To

- `src/lib/gondoor/`, `src/features/gondoor/`, `src/app/api/gondoor/`, related Supabase migrations, storage buckets, and Gondoor tests.

## Rules

- Keep API route files thin; use `createProductionGondoorChatHandler` and reusable handlers under `src/lib/gondoor/server/`.
- Authenticate server chat requests with bearer tokens, Supabase `auth.getUser`, profile lookup, firm scope, role normalization, and `canUseGondoorEngine`.
- Return `GondoorRouteError` JSON responses with stable `code`, `message`, status, and `retry-after` when rate-limited.
- Stream chat through SSE helpers and client parsers; keep event contracts in `contracts.ts`, `chat-events.ts`, and tests.
- Build prompts through `prompt-builder` using conversation history, retrieved knowledge sources, prior sessions, and greeting anomalies.
- Keep persistence, audit, tool cleanup, generated files, knowledge repository, and resolved anomaly logic in focused `src/lib/gondoor/**` modules.
- Store Gondoor database objects and RLS policies in Supabase migrations with `gondoor_*` tables, storage buckets, RPCs, and tests.
- Keep client chat state transitions in `src/features/gondoor/gondoor-chat-state.ts` and stream client errors in `gondoor-chat-service.ts`.

## Placement

- Put server-only route orchestration in `src/lib/gondoor/server/`.
- Put client widget, state, SSE parser, and browser service code in `src/features/gondoor/`.
- Put tool contracts and implementations in `src/lib/gondoor/tools/`.
- Put knowledge retrieval and persistence code in `src/lib/gondoor/knowledge/`.
- Put generated artifact handlers in `src/lib/gondoor/artifacts/`.

## Validation

- Run targeted Gondoor tests under `src/lib/gondoor/**/*.test.ts`, `src/features/gondoor/**/*.test.tsx`, and `src/app/api/gondoor/**/*.test.ts`.
- Run `pnpm test --run` when changing shared Gondoor contracts, stream events, prompt building, persistence, or tools.
- Run `pnpm e2e` for the full Gondoor browser workflow when the widget, chat route, generated files, or Playwright fake agent behavior changes.
- Run Supabase migration and database tests when Gondoor tables, policies, buckets, or RPCs change.

## Anti-Patterns

- Putting production chat logic directly in `src/app/api/gondoor/**/route.ts`.
- Emitting new stream event shapes without updating contracts, parser, state reducer, and tests.
- Returning raw internal errors from chat routes.
- Bypassing firm or Gondoor permission checks in knowledge, file, or tool handlers.

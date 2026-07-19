Version: 1.1
Last Updated: 2026-07-19

# Testing Instructions

## Purpose

Document the repository's validation commands, test locations, and sandbox
expectations so agents choose the smallest useful validation set and report
unverified work accurately.

## Applies To

Changes to TypeScript, React components, hooks, services, route pages, Supabase
integration code, Playwright specs, Vitest specs, and `.ai` workflow tests.

## Rules

- Use package scripts from `package.json`: `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm test --run`, `pnpm e2e`, and aggregate
  `pnpm check`.
- Vitest is configured in `vitest.config.mts` with `jsdom`, globals enabled,
  `vite-tsconfig-paths`, React plugin support, V8 coverage, and include pattern
  `src/**/*.{test,spec}.{ts,tsx}`.
- Testing Library matchers are installed through `src/test/setup.ts` via
  `@testing-library/jest-dom/vitest`.
- Playwright specs live in `e2e`; `playwright.config.ts` starts `pnpm dev`,
  uses `NEXT_PUBLIC_APP_URL` or `http://localhost:3000`, reuses non-CI servers,
  captures trace on first retry, and currently targets Desktop Chrome.
- `pnpm check` runs typecheck, lint, format check, and Vitest in run mode; it
  does not run Playwright.
- Follow `shared/testing.md` for test-layer selection, regression-test policy,
  skipped-validation reporting, and environment constraints.

## Placement

- Put unit and component tests beside source under `src` with
  `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` names so Vitest includes
  them.
- Put browser flow tests under `e2e`.
- Keep shared test setup in `src/test/setup.ts`.
- Keep `.ai` workflow runner tests beside the script in `.ai/scripts` because
  they are local workflow tests, not app runtime tests.

## Validation

- For formatting-only or instruction-only changes, run
  `pnpm exec prettier --check <paths>`.
- Use `pnpm check` only when shared behavior or cross-module contracts require
  repository-wide static and Vitest validation.

## Anti-Patterns

- Claiming `pnpm check` covers Playwright.
- Adding tests outside the configured Vitest include pattern and assuming they
  run through `pnpm test`.
- Running broad app validation for `.ai` instruction-only edits and presenting
  it as required by the change.
- Mutating application data or external services just to validate a static or
  documentation-only update.

Version: 1.0
Last Updated: 2026-06-05

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
- In the Codex sandbox, Node/Playwright local network or browser-server
  operations may require command-level escalation. Request escalation for the
  specific command when needed and explain that the command needs local network
  or browser access.
- Do not use `yolo` or broad sandbox bypasses for validation.
- For `.ai` instruction-only changes, verify instruction metadata and Prettier
  formatting instead of running application tests as the completion gate.

## Placement

- Put unit and component tests beside source under `src` with
  `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` names so Vitest includes
  them.
- Put browser flow tests under `e2e`.
- Keep shared test setup in `src/test/setup.ts`.
- Keep `.ai` workflow runner tests beside the script in `.ai/scripts` because
  they are local workflow tests, not app runtime tests.

## Validation

- For source-only changes, start with the narrowest command that covers the
  touched area, then broaden to `pnpm check` when shared behavior or
  cross-module contracts changed.
- For route or browser behavior, run `pnpm e2e` or a focused Playwright command
  after unit-level validation.
- For formatting-only or instruction-only changes, run
  `pnpm exec prettier --check <paths>`.
- Always report commands run and any commands skipped, including why they were
  skipped.

## Anti-Patterns

- Claiming `pnpm check` covers Playwright.
- Adding tests outside the configured Vitest include pattern and assuming they
  run through `pnpm test`.
- Skipping validation silently because a command needs local network,
  Playwright, or sandbox escalation.
- Running broad app validation for `.ai` instruction-only edits and presenting
  it as required by the change.
- Mutating application data or external services just to validate a static or
  documentation-only update.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { selectInstructionPaths } from "./instruction-router.ts";

const select = (planOwnedPaths: string[]) =>
  selectInstructionPaths({ planOwnedPaths });

test("routes current application, security, migration, WCAG, and E2E instructions", () => {
  const paths = select([
    "src/app/api/health/route.ts",
    "src/app/settings/auth/page.tsx",
    "src/features/landing-page/components/landing-hero.tsx",
    "migrations/20260812_add_policy.sql",
    "e2e/auth.spec.ts",
  ]);

  for (const expectedPath of [
    ".ai/instructions/shared/security.md",
    ".ai/instructions/shared/security-observability.md",
    ".ai/instructions/shared/testing.md",
    ".ai/instructions/shared/maintainability.md",
    ".ai/instructions/shared/migrations.md",
    ".ai/instructions/shared/performance-observability.md",
    ".ai/instructions/shared/documentation-runbooks.md",
    ".ai/instructions/shared/wcag.md",
    ".ai/instructions/architecture.md",
    ".ai/instructions/ui.md",
  ]) {
    assert.ok(paths.includes(expectedPath), expectedPath);
  }

  assert.equal(paths.every((instructionPath) => existsSync(instructionPath)), true);
});

test("routes workflow source and its tests without obsolete package paths", () => {
  const paths = select([
    ".ai/scripts/workflow/runner/instruction-router.test.ts",
  ]);

  assert.deepEqual(paths, [
    ".ai/instructions/shared/ai-workflow.md",
    ".ai/instructions/shared/workflow-state.md",
    ".ai/instructions/shared/testing.md",
  ]);
  assert.equal(paths.some((path) => path.startsWith(".ai/instructions/web")), false);
});

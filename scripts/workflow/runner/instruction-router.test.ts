import assert from "node:assert/strict";
import test from "node:test";

import { selectInstructionPaths } from "./instruction-router.ts";

const select = (planOwnedPaths: string[]) =>
  selectInstructionPaths({ planOwnedPaths });

test("routes API, auth, service, query, map, Gondoor, Supabase, and E2E paths from the index", () => {
  const paths = select([
    "src/app/api/gondoor/route.ts",
    "src/app/settings/auth/page.tsx",
    "src/services/account-service.ts",
    "src/hooks/query-keys.ts",
    "src/components/shared/maps/employee-map.tsx",
    "supabase/migrations/20260718_add_policy.sql",
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
    ".ai/instructions/architecture.md",
    ".ai/instructions/ui.md",
    ".ai/instructions/auth.md",
    ".ai/instructions/react-query.md",
    ".ai/instructions/data-services.md",
    ".ai/instructions/supabase.md",
    ".ai/instructions/gondoor.md",
    ".ai/instructions/maps.md",
  ]) {
    assert.ok(paths.includes(expectedPath), expectedPath);
  }
});

test("routes workflow source and its tests without obsolete package paths", () => {
  const paths = select([
    ".ai/scripts/workflow/runner/instruction-router.test.ts",
  ]);

  assert.deepEqual(paths, [
    ".ai/instructions/ai-workflow.md",
    ".ai/instructions/shared/workflow-state.md",
    ".ai/instructions/shared/testing.md",
  ]);
  assert.equal(paths.some((path) => path.startsWith(".ai/instructions/web")), false);
});

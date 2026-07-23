import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTaskFileScope,
  unstagePathsOutsideTaskFileScope,
} from "./task-file-scope.ts";

test("task file scope accepts later-task working-tree changes", async () => {
  const result = await checkTaskFileScope({
    task: {
      id: "01-schema",
      words: "schema",
      name: "Add schema",
      artifactWords: "schema",
      files: ["supabase/migrations/example.sql"],
    },
    planOwnedPaths: [
      "supabase/migrations/example.sql",
      "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
    ],
  });

  assert.deepEqual(result, { ok: true });
});

test("task file scope rejects a task file outside the plan-owned inventory", async () => {
  const result = await checkTaskFileScope({
    task: {
      id: "01-schema",
      words: "schema",
      name: "Add schema",
      artifactWords: "schema",
      files: ["supabase/migrations/undeclared.sql"],
    },
    planOwnedPaths: ["supabase/migrations/example.sql"],
  });

  assert.deepEqual(result, {
    ok: false,
    reason:
      "task 01-schema declares Files outside the plan-owned scope: supabase/migrations/undeclared.sql",
  });
});

test("task file scope unstages later-task changes and preserves current-task staging", async () => {
  const calls: string[] = [];
  const result = await unstagePathsOutsideTaskFileScope({
    rootDir: "/workspace",
    task: {
      id: "01-schema",
      words: "schema",
      name: "Add schema",
      artifactWords: "schema",
      files: ["supabase/migrations/example.sql"],
    },
    planOwnedPaths: [
      "supabase/migrations/example.sql",
      "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
    ],
    processRunner: async (call) => {
      calls.push(`${call.promptPath}:${call.args.join(" ")}`);
      if (call.promptPath === "git-task-file-scope-staged-check") {
        return {
          launched: true,
          stdout: [
            "supabase/migrations/example.sql",
            "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    unstagedPaths: ["apps/backend/src/payments/webhooks/whop-webhook.service.ts"],
  });
  assert.deepEqual(calls, [
    "git-task-file-scope-staged-check:diff --cached --name-only -- supabase/migrations/example.sql apps/backend/src/payments/webhooks/whop-webhook.service.ts",
    "git-task-file-scope-unstage:restore --staged -- apps/backend/src/payments/webhooks/whop-webhook.service.ts",
  ]);
});

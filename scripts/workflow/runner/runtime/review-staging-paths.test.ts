import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewStagingPaths } from "./review-staging-paths.ts";

test("review staging includes literal paths required by the latest failed review", async () => {
  const result = await resolveReviewStagingPaths({
    rootDir: "/workspace",
    planContent: `
## Files (MANDATORY)

### Created files

* supabase/migrations/20260720150000_mode_scoped_billing.sql

## Generated Latest Event Context

### Latest Review Event (generated) v40

* Summary: NEEDS FIX
* Outcome: active
* Remediation:
  * Include \`supabase/migrations/20260720145900_legacy_fixture.sql\` so the clean-index reset is reproducible.
  * Preserve mode in \`apps/backend/src/payments/webhooks/whop-webhook.service.ts\` and cover it in \`apps/backend/test/payments/whop-webhook.service.spec.ts\`.
`,
    ownershipPreflight: {
      hasOwnershipScope: true,
      artifact: {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/example.md",
        owns: [],
        released: [],
        resolvedFiles: [],
        changedFiles: [],
        headSha: "abc123",
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
      reviewStagingPaths: [
        "supabase/migrations/20260720150000_mode_scoped_billing.sql",
      ],
    },
    isIgnored: async () => false,
  });

  assert.deepEqual(result, {
    ok: true,
    paths: [
      "supabase/migrations/20260720150000_mode_scoped_billing.sql",
      "supabase/migrations/20260720145900_legacy_fixture.sql",
      "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
      "apps/backend/test/payments/whop-webhook.service.spec.ts",
    ],
  });
});

test("review staging ignores unsafe remediation fragments", async () => {
  const result = await resolveReviewStagingPaths({
    rootDir: "/workspace",
    planContent: `
### Latest Review Event (generated) v1

* Remediation:
  * Do not stage \`../outside.ts\`, \`src/*.ts\`, or \`git add --all\`.
`,
    ownershipPreflight: {
      hasOwnershipScope: true,
      artifact: {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/example.md",
        owns: [],
        released: [],
        resolvedFiles: [],
        changedFiles: [],
        headSha: "abc123",
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
      reviewStagingPaths: ["src/owned.ts"],
    },
    isIgnored: async () => false,
  });

  assert.deepEqual(result, { ok: true, paths: ["src/owned.ts"] });
});

test("review staging includes dirty candidates already owned by the plan", async () => {
  const result = await resolveReviewStagingPaths({
    rootDir: "/workspace",
    planContent: "",
    ownershipPreflight: {
      hasOwnershipScope: true,
      artifact: {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/example.md",
        owns: [
          "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
          "apps/backend/test/payments/whop-webhook.service.spec.ts",
        ],
        released: [],
        resolvedFiles: [
          "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
          "apps/backend/test/payments/whop-webhook.service.spec.ts",
        ],
        changedFiles: [],
        headSha: "abc123",
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
      reviewStagingPaths: ["supabase/migrations/mode-scoped-billing.sql"],
    },
    isIgnored: async () => false,
  });

  assert.deepEqual(result, {
    ok: true,
    paths: [
      "supabase/migrations/mode-scoped-billing.sql",
      "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
      "apps/backend/test/payments/whop-webhook.service.spec.ts",
    ],
  });
});

test("task review staging excludes later-task paths from the plan-wide ownership inventory", async () => {
  const result = await resolveReviewStagingPaths({
    rootDir: "/workspace",
    planContent: "",
    selectedTask: {
      id: "01-mode-scoped-billing-schema",
      words: "mode-scoped-billing-schema",
      name: "Add mode-scoped billing state",
      artifactWords: "mode-scoped-billing-schema",
      files: ["supabase/migrations/mode-scoped-billing.sql"],
    },
    ownershipPreflight: {
      hasOwnershipScope: true,
      artifact: {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/example.md",
        owns: [
          "supabase/migrations/mode-scoped-billing.sql",
          "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
        ],
        released: [],
        resolvedFiles: [
          "supabase/migrations/mode-scoped-billing.sql",
          "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
        ],
        changedFiles: [],
        headSha: "abc123",
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
      reviewStagingPaths: [
        "supabase/migrations/mode-scoped-billing.sql",
        "apps/backend/src/payments/webhooks/whop-webhook.service.ts",
      ],
    },
    isIgnored: async () => false,
  });

  assert.deepEqual(result, {
    ok: true,
    paths: ["supabase/migrations/mode-scoped-billing.sql"],
  });
});

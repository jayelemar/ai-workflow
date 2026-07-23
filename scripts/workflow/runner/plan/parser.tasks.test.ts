import assert from "node:assert/strict";
import test from "node:test";

import { parsePlanTasks } from "./parser.ts";

test("plan tasks retain their declared Files boundaries", () => {
  const tasks = parsePlanTasks(`
### Implementation

1. [task:01-schema] Add schema
   - Files: supabase/migrations/example.sql, packages/supabase/src/generated.ts
   - Validation: pnpm db:types
2. [task:02-webhook] Update webhook
   - Files: apps/backend/src/payments/webhooks/whop-webhook.service.ts
   - Validation: pnpm test
`);

  assert.deepEqual(tasks.map((task) => [task.id, task.files]), [
    [
      "01-schema",
      [
        "supabase/migrations/example.sql",
        "packages/supabase/src/generated.ts",
      ],
    ],
    [
      "02-webhook",
      ["apps/backend/src/payments/webhooks/whop-webhook.service.ts"],
    ],
  ]);
});

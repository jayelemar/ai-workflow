import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  resolveLatestTiers,
  updateCodexConfig,
  updateRegistryModels,
  validateOptions,
} from "./update-agent-models.mjs";

const latestModelMarkdown = `---
latestModelInfo:
  model: gpt-5.7-sol
  migrationGuide: /api/docs/guides/upgrading-to-gpt-5p7-sol.md
  promptingGuide: /api/docs/guides/prompt-guidance-gpt-5p7.md
---

Use \`gpt-5.7-sol\` for frontier capability and \`gpt-5.7-terra\` to balance
intelligence and cost.
`;

const registry = `schema_version = 1
source_url = "https://developers.openai.com/api/docs/guides/latest-model.md"

[tiers.frontier]
model = "gpt-5.6-sol"

[tiers.balanced]
model = "gpt-5.6-terra"

[roles.parent]
tier = "frontier"
reasoning_effort = "high"

[roles.builder]
tier = "balanced"
reasoning_effort = "high"
`;

test("model updater defaults to a read-only check", () => {
  const options = parseArgs([]);
  assert.equal(options.apply, false);
  assert.equal(options.evalApproved, false);
  assert.match(options.source, /^https:\/\/developers\.openai\.com\//);
  assert.doesNotThrow(() => validateOptions(options));
});

test("model updater requires explicit eval approval before writes", () => {
  assert.throws(
    () => validateOptions(parseArgs(["--apply"])),
    /--eval-approved/,
  );
  assert.doesNotThrow(() =>
    validateOptions(parseArgs(["--apply", "--eval-approved"])),
  );
});

test("latest model guidance resolves frontier and balanced tiers", () => {
  assert.deepEqual(resolveLatestTiers(latestModelMarkdown), {
    frontier: "gpt-5.7-sol",
    balanced: "gpt-5.7-terra",
  });
  assert.throws(
    () =>
      resolveLatestTiers(
        latestModelMarkdown.replaceAll("gpt-5.7-terra", "balanced-model"),
      ),
    /balanced model/,
  );
});

test("registry update changes only tier model locks", () => {
  const updated = updateRegistryModels(registry, {
    frontier: "gpt-5.7-sol",
    balanced: "gpt-5.7-terra",
  });
  assert.match(updated, /\[tiers\.frontier\]\nmodel = "gpt-5\.7-sol"/);
  assert.match(updated, /\[tiers\.balanced\]\nmodel = "gpt-5\.7-terra"/);
  assert.match(updated, /\[roles\.builder\][\s\S]*tier = "balanced"/);
});

test("Codex config update preserves unrelated settings", () => {
  const updated = updateCodexConfig(
    'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n',
    { model: "gpt-5.7-sol", reasoningEffort: "high" },
  );
  assert.match(updated, /^model = "gpt-5\.7-sol"\n/);
  assert.match(updated, /^model_reasoning_effort = "high"$/m);
  assert.match(updated, /^approval_policy = "never"$/m);
  assert.match(updated, /^sandbox_mode = "danger-full-access"$/m);
});

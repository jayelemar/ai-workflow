import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectAndUpdateModels,
  parseArgs,
  resolveLatestTiers,
  updateCodexConfig,
  updateRegistryModels,
  validateOptions,
} from "./update-agent-models.mjs";

const workflowRoot = fileURLToPath(new URL("../../", import.meta.url));

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

const createApplyFixture = async ({ codexConfig } = {}) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-model-update-"),
  );
  const sourcePath = path.join(temporaryRoot, "latest-model.md");
  const registryPath = path.join(temporaryRoot, "agent-models.toml");
  const codexConfigPath = path.join(temporaryRoot, ".codex", "config.toml");
  await Promise.all([
    writeFile(sourcePath, latestModelMarkdown, "utf8"),
    readFile(
      path.join(workflowRoot, "config", "agent-models.toml"),
      "utf8",
    ).then((contents) => writeFile(registryPath, contents, "utf8")),
  ]);
  if (codexConfig !== undefined) {
    await mkdir(path.dirname(codexConfigPath), { recursive: true });
    await writeFile(codexConfigPath, codexConfig, "utf8");
  }
  return { codexConfigPath, registryPath, sourcePath, temporaryRoot };
};

const applyOptions = ({ sourcePath, registryPath, codexConfigPath }) =>
  parseArgs([
    "--apply",
    "--eval-approved",
    "--source",
    sourcePath,
    "--registry",
    registryPath,
    "--codex-config",
    codexConfigPath,
  ]);

const failOnInstallation = (installationToFail) => {
  let installations = 0;
  return async (filePath, contents) => {
    installations += 1;
    if (installations === installationToFail) {
      throw new Error(`simulated installation failure ${installations}`);
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  };
};

test("model updater defaults to a read-only check", () => {
  const options = parseArgs([]);
  assert.equal(options.apply, false);
  assert.equal(options.evalApproved, false);
  assert.match(options.source, /^https:\/\/developers\.openai\.com\//);
  assert.doesNotThrow(() => validateOptions(options));
});

test("model updater defaults are independent of the caller working directory", async () => {
  const unrelatedDirectory = await mkdtemp(
    path.join(os.tmpdir(), "agent-model-cwd-"),
  );
  const originalDirectory = process.cwd();
  const expectedRegistry = path.join(
    workflowRoot,
    "config",
    "agent-models.toml",
  );
  const expectedCodexConfig = path.join(
    path.dirname(workflowRoot),
    ".codex",
    "config.toml",
  );
  try {
    for (const directory of [
      path.dirname(workflowRoot),
      workflowRoot,
      unrelatedDirectory,
    ]) {
      process.chdir(directory);
      const options = parseArgs([]);
      assert.equal(options.registry, expectedRegistry);
      assert.equal(options.codexConfig, expectedCodexConfig);
    }
  } finally {
    process.chdir(originalDirectory);
    await rm(unrelatedDirectory, { recursive: true, force: true });
  }
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

test("read-only model checks do not require a Codex config", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-model-check-"),
  );
  try {
    const sourcePath = path.join(temporaryRoot, "latest-model.md");
    const missingConfigPath = path.join(temporaryRoot, ".codex", "config.toml");
    await writeFile(sourcePath, latestModelMarkdown, "utf8");

    const result = await inspectAndUpdateModels(
      parseArgs([
        "--source",
        sourcePath,
        "--registry",
        path.join(workflowRoot, "config", "agent-models.toml"),
        "--codex-config",
        missingConfigPath,
      ]),
    );

    assert.equal(result.status, "update-available");
    await assert.rejects(readFile(missingConfigPath, "utf8"), /ENOENT/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("apply failure before installation preserves both original files", async () => {
  const fixture = await createApplyFixture({
    codexConfig: 'approval_policy = "never"\n',
  });
  try {
    const [originalRegistry, originalCodexConfig] = await Promise.all([
      readFile(fixture.registryPath, "utf8"),
      readFile(fixture.codexConfigPath, "utf8"),
    ]);

    await assert.rejects(
      inspectAndUpdateModels(applyOptions(fixture), {
        writeInstalledFile: failOnInstallation(1),
      }),
      /simulated installation failure 1/,
    );

    assert.equal(
      await readFile(fixture.registryPath, "utf8"),
      originalRegistry,
    );
    assert.equal(
      await readFile(fixture.codexConfigPath, "utf8"),
      originalCodexConfig,
    );
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("apply failure after one installation restores both original files", async () => {
  const fixture = await createApplyFixture({
    codexConfig: 'approval_policy = "never"\n',
  });
  try {
    const [originalRegistry, originalCodexConfig] = await Promise.all([
      readFile(fixture.registryPath, "utf8"),
      readFile(fixture.codexConfigPath, "utf8"),
    ]);

    await assert.rejects(
      inspectAndUpdateModels(applyOptions(fixture), {
        writeInstalledFile: failOnInstallation(2),
      }),
      /simulated installation failure 2/,
    );

    assert.equal(
      await readFile(fixture.registryPath, "utf8"),
      originalRegistry,
    );
    assert.equal(
      await readFile(fixture.codexConfigPath, "utf8"),
      originalCodexConfig,
    );
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("apply rollback removes a Codex config that was previously absent", async () => {
  const fixture = await createApplyFixture({ codexConfig: undefined });
  try {
    await assert.rejects(
      inspectAndUpdateModels(applyOptions(fixture), {
        writeInstalledFile: failOnInstallation(2),
      }),
      /simulated installation failure 2/,
    );

    await assert.rejects(readFile(fixture.codexConfigPath, "utf8"), /ENOENT/);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

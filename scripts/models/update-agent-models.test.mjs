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

const latestModelMarkdown = `# GPT-5.6 model guidance

Use \`gpt-5.6-sol\` for frontier capability, \`gpt-5.6-terra\` to balance
intelligence and cost, and \`gpt-5.6-luna\` for efficient bounded work.
`;

const registry = `schema_version = 1
source_url = "https://developers.openai.com/api/docs/guides/latest-model.md"

[tiers.frontier]
model = "gpt-5.6-sol"

[tiers.balanced]
model = "gpt-5.6-terra"

[tiers.efficient]
model = "gpt-5.6-luna"

[roles.parent]
tier = "frontier"
reasoning_effort = "high"

[roles.builder]
tier = "efficient"
reasoning_effort = "xhigh"
retry_tier = "balanced"
retry_reasoning_effort = "high"
retry_limit = 1
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
    ).then((contents) =>
      writeFile(
        registryPath,
        contents.replaceAll("gpt-5.6", "gpt-5.5"),
        "utf8",
      ),
    ),
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
  assert.equal(options.source, undefined);
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

test("locked GPT-5.6 guidance resolves all explicitly confirmed tiers", () => {
  assert.deepEqual(resolveLatestTiers(latestModelMarkdown), {
    frontier: "gpt-5.6-sol",
    balanced: "gpt-5.6-terra",
    efficient: "gpt-5.6-luna",
  });
  assert.throws(
    () =>
      resolveLatestTiers(
        latestModelMarkdown.replaceAll("gpt-5.6-luna", "efficient-model"),
      ),
    /efficient model gpt-5\.6-luna/,
  );
});

test("official Markdown links count as exact model confirmation", () => {
  assert.deepEqual(
    resolveLatestTiers(`
[Sol](/api/docs/models/gpt-5.6-sol.md)
[Terra](/api/docs/models/gpt-5.6-terra.md)
[Luna](/api/docs/models/gpt-5.6-luna.md)
`),
    {
      frontier: "gpt-5.6-sol",
      balanced: "gpt-5.6-terra",
      efficient: "gpt-5.6-luna",
    },
  );
});

test("a dotted model suffix is not exact confirmation", () => {
  assert.throws(
    () =>
      resolveLatestTiers(
        latestModelMarkdown.replaceAll("gpt-5.6-luna", "gpt-5.6-luna.preview"),
      ),
    /efficient model gpt-5\.6-luna/,
  );
});

test("registry update changes all tier model locks", () => {
  const updated = updateRegistryModels(registry, {
    frontier: "gpt-5.7-sol",
    balanced: "gpt-5.7-terra",
    efficient: "gpt-5.7-luna",
  });
  assert.match(updated, /\[tiers\.frontier\]\nmodel = "gpt-5\.7-sol"/);
  assert.match(updated, /\[tiers\.balanced\]\nmodel = "gpt-5\.7-terra"/);
  assert.match(updated, /\[tiers\.efficient\]\nmodel = "gpt-5\.7-luna"/);
  assert.match(updated, /\[roles\.builder\][\s\S]*tier = "efficient"/);
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

    assert.equal(result.status, "current");
    await assert.rejects(readFile(missingConfigPath, "utf8"), /ENOENT/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the registry source is used when no source override is supplied", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-model-registry-source-"),
  );
  try {
    const registryPath = path.join(temporaryRoot, "agent-models.toml");
    const sourcePath = path.join(temporaryRoot, "official-models.md");
    await Promise.all([
      writeFile(sourcePath, latestModelMarkdown, "utf8"),
      readFile(
        path.join(workflowRoot, "config", "agent-models.toml"),
        "utf8",
      ).then((contents) =>
        writeFile(
          registryPath,
          contents.replace(
            "https://developers.openai.com/api/docs/models.md",
            sourcePath,
          ),
          "utf8",
        ),
      ),
    ]);

    const result = await inspectAndUpdateModels(
      parseArgs(["--registry", registryPath]),
    );

    assert.equal(result.status, "current");
    assert.equal(result.source, sourcePath);
    assert.deepEqual(result.current, result.candidate);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("a three-tier drift report includes the efficient Luna candidate", async () => {
  const fixture = await createApplyFixture();
  try {
    const result = await inspectAndUpdateModels(
      parseArgs([
        "--source",
        fixture.sourcePath,
        "--registry",
        fixture.registryPath,
      ]),
    );

    assert.equal(result.status, "update-available");
    assert.deepEqual(result.current, {
      frontier: "gpt-5.5-sol",
      balanced: "gpt-5.5-terra",
      efficient: "gpt-5.5-luna",
    });
    assert.deepEqual(result.candidate, {
      frontier: "gpt-5.6-sol",
      balanced: "gpt-5.6-terra",
      efficient: "gpt-5.6-luna",
    });
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("an efficient-only mismatch reports model drift", async () => {
  const fixture = await createApplyFixture();
  try {
    const registry = await readFile(fixture.registryPath, "utf8");
    await writeFile(
      fixture.registryPath,
      registry
        .replace('model = "gpt-5.5-sol"', 'model = "gpt-5.6-sol"')
        .replace('model = "gpt-5.5-terra"', 'model = "gpt-5.6-terra"'),
      "utf8",
    );

    const result = await inspectAndUpdateModels(
      parseArgs([
        "--source",
        fixture.sourcePath,
        "--registry",
        fixture.registryPath,
      ]),
    );

    assert.equal(result.status, "update-available");
    assert.equal(result.current.efficient, "gpt-5.5-luna");
    assert.equal(result.candidate.efficient, "gpt-5.6-luna");
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("a registry source must be an official OpenAI HTTPS URL", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-model-untrusted-source-"),
  );
  try {
    const registryPath = path.join(temporaryRoot, "agent-models.toml");
    const registryContents = await readFile(
      path.join(workflowRoot, "config", "agent-models.toml"),
      "utf8",
    );
    await writeFile(
      registryPath,
      registryContents.replace(
        "https://developers.openai.com/api/docs/models.md",
        "https://example.com/models.md",
      ),
      "utf8",
    );

    await assert.rejects(
      inspectAndUpdateModels(parseArgs(["--registry", registryPath])),
      /remote source must use https:\/\/developers\.openai\.com/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("missing exact Luna confirmation rejects before any apply write", async () => {
  const fixture = await createApplyFixture({
    codexConfig: 'approval_policy = "never"\n',
  });
  try {
    const [originalRegistry, originalCodexConfig] = await Promise.all([
      readFile(fixture.registryPath, "utf8"),
      readFile(fixture.codexConfigPath, "utf8"),
    ]);
    await writeFile(
      fixture.sourcePath,
      latestModelMarkdown.replaceAll("gpt-5.6-luna", "gpt-5.6-efficient"),
      "utf8",
    );

    await assert.rejects(
      inspectAndUpdateModels(applyOptions(fixture)),
      /efficient model gpt-5\.6-luna/,
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

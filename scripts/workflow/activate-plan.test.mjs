import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activatePlan,
  parseActivateArgs,
  parsePlanManifest,
  parseWorkStatus,
} from "./activate-plan.mjs";

const planSource = ({
  history = [],
  name = "trip-style",
  revision = 1,
  spec = ".ai/specs/trip-style.spec.md",
  supersedes = "N/A: initial plan",
  tasks = ["T-001", "T-002"],
  workItem = "trip-style",
} = {}) => `# Plan: ${name}

## Document Format

plan-manifest@5

## Plan Lineage

- Work item: \`${workItem}\`
- Revision: \`${revision}\`
- Supersedes: \`${supersedes}\`
- Archived revisions: ${history.length ? history.map((item) => `\`${item}\``).join(", ") : "`None`"}

## Classification

MEDIUM

## Spec

\`${spec}\`

## Work Tracking

- Status: \`.ai/artifacts/${workItem}/work-status.md\`
- Task IDs: stable

## Implementation

${tasks.map((id) => `### Task ${id}: Outcome ${id}`).join("\n\n")}
`;

const statusSource = ({
  activePlan = ".ai/plans/trip-style.md",
  spec = ".ai/specs/trip-style.spec.md",
  tasks = ["T-001", "T-002"],
  workItem = "trip-style",
} = {}) => `# Work Status: ${workItem}

## Document Format

work-status@1

## Current Work

- Work item: \`${workItem}\`
- Overall status: \`not started\`
- Classification: \`MEDIUM\`
- Goal: Test goal
- Spec: \`${spec}\`
- Active plan: \`${activePlan}\`

## Current Tasks

${tasks.map((id) => `### ${id}: Outcome ${id}\n\n- State: \`not started\``).join("\n\n")}
`;

const withFixture = async (callback) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "activate-plan-"));
  const workflowDirectory = path.join(temporaryRoot, ".ai");
  for (const directory of ["plans", "tmp", "artifacts"]) {
    await mkdir(path.join(workflowDirectory, directory), { recursive: true });
  }
  try {
    await callback({ workflowDirectory });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
};

const exists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const run = async (fixture, options = {}) => {
  const output = [];
  const result = await activatePlan({
    args: options.args ?? [
      "--candidate-plan",
      ".ai/tmp/trip-style.md",
      "--candidate-status",
      ".ai/tmp/trip-style.work-status.md",
    ],
    output: (line) => output.push(line),
    renameFile: options.renameFile,
    workflowDirectory: fixture.workflowDirectory,
  });
  return { output, result };
};

test("arguments require candidate plan and status; predecessor is optional", () => {
  assert.deepEqual(parseActivateArgs(["--help"]), { help: true });
  assert.match(parseActivateArgs([]).error, /required/);
  assert.equal(
    parseActivateArgs([
      "--candidate-plan",
      ".ai/tmp/a.md",
      "--candidate-status",
      ".ai/tmp/a.work-status.md",
    ]).predecessor,
    undefined,
  );
});

test("parses current plan and status contracts", () => {
  assert.deepEqual(parsePlanManifest(planSource()).taskIds, ["T-001", "T-002"]);
  assert.deepEqual(parseWorkStatus(statusSource()).taskIds, ["T-001", "T-002"]);
  assert.throws(
    () => parsePlanManifest(planSource().replace("@5", "@4")),
    /plan is not plan-manifest@5/,
  );
  assert.throws(
    () => parseWorkStatus(statusSource().replace("@1", "@0")),
    /status is not work-status@1/,
  );
  assert.throws(
    () => parsePlanManifest(planSource({ tasks: ["T-001", "T-001"] })),
    /duplicate task IDs/,
  );
});

test("activates an initial plan and matching stable status", async () => {
  await withFixture(async (fixture) => {
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.md"),
      planSource(),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.work-status.md"),
      statusSource(),
    );

    const { output, result } = await run(fixture);

    assert.equal(result.ok, true, output.join("\n"));
    assert.equal(
      await exists(path.join(fixture.workflowDirectory, "plans/trip-style.md")),
      true,
    );
    assert.equal(
      await exists(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/work-status.md",
        ),
      ),
      true,
    );
  });
});

test("rejects mismatched task IDs without activating either artifact", async () => {
  await withFixture(async (fixture) => {
    const candidatePlan = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.md",
    );
    const candidateStatus = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.work-status.md",
    );
    await writeFile(candidatePlan, planSource());
    await writeFile(candidateStatus, statusSource({ tasks: ["T-001"] }));

    const { result } = await run(fixture);

    assert.equal(result.ok, false);
    assert.equal(await exists(candidatePlan), true);
    assert.equal(await exists(candidateStatus), true);
  });
});

test("rejects mismatched plan links without activating either artifact", async () => {
  await withFixture(async (fixture) => {
    const candidatePlan = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.md",
    );
    const candidateStatus = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.work-status.md",
    );
    await writeFile(candidatePlan, planSource());
    await writeFile(
      candidateStatus,
      statusSource({ activePlan: ".ai/plans/different.md" }),
    );

    const { output, result } = await run(fixture);

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /does not exactly match/);
    assert.equal(await exists(candidatePlan), true);
    assert.equal(await exists(candidateStatus), true);
  });
});

test("initial activation refuses an existing stable status", async () => {
  await withFixture(async (fixture) => {
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.md"),
      planSource(),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.work-status.md"),
      statusSource(),
    );
    await mkdir(path.join(fixture.workflowDirectory, "artifacts/trip-style"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        fixture.workflowDirectory,
        "artifacts/trip-style/work-status.md",
      ),
      statusSource(),
    );

    const { result } = await run(fixture);

    assert.equal(result.ok, false);
    assert.equal(
      await exists(path.join(fixture.workflowDirectory, "plans/trip-style.md")),
      false,
    );
  });
});

test("initial activation rolls status back when plan activation fails", async () => {
  await withFixture(async (fixture) => {
    const candidatePlan = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.md",
    );
    const candidateStatus = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style.work-status.md",
    );
    await writeFile(candidatePlan, planSource());
    await writeFile(candidateStatus, statusSource());
    let calls = 0;
    const renameFile = async (source, destination) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated plan activation failure");
      await rename(source, destination);
    };

    const { output, result } = await run(fixture, { renameFile });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /rolled back/);
    assert.equal(await exists(candidatePlan), true);
    assert.equal(await exists(candidateStatus), true);
    assert.equal(
      await exists(path.join(fixture.workflowDirectory, "plans/trip-style.md")),
      false,
    );
    assert.equal(
      await exists(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/work-status.md",
        ),
      ),
      false,
    );
  });
});

test("activates a replan, archives predecessor, and replaces stable status", async () => {
  await withFixture(async (fixture) => {
    const archive = ".ai/artifacts/trip-style/superseded-plan.md";
    await writeFile(
      path.join(fixture.workflowDirectory, "plans/trip-style.md"),
      planSource(),
    );
    await mkdir(path.join(fixture.workflowDirectory, "artifacts/trip-style"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        fixture.workflowDirectory,
        "artifacts/trip-style/work-status.md",
      ),
      statusSource(),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r2.md"),
      planSource({
        history: [archive],
        name: "trip-style-r2",
        revision: 2,
        supersedes: archive,
        tasks: ["T-001", "T-003"],
      }),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.work-status.md"),
      statusSource({
        activePlan: ".ai/plans/trip-style-r2.md",
        tasks: ["T-001", "T-003"],
      }),
    );

    const { output, result } = await run(fixture, {
      args: [
        "--predecessor",
        ".ai/plans/trip-style.md",
        "--candidate-plan",
        ".ai/tmp/trip-style-r2.md",
        "--candidate-status",
        ".ai/tmp/trip-style.work-status.md",
      ],
    });

    assert.equal(result.ok, true, output.join("\n"));
    assert.equal(
      await exists(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/superseded-plan.md",
        ),
      ),
      true,
    );
    assert.match(
      await readFile(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/work-status.md",
        ),
        "utf8",
      ),
      /trip-style-r2/,
    );
  });
});

test("rolls plan and status back when replan activation fails", async () => {
  await withFixture(async (fixture) => {
    const archive = ".ai/artifacts/trip-style/superseded-plan.md";
    const predecessor = path.join(
      fixture.workflowDirectory,
      "plans/trip-style.md",
    );
    const currentStatus = path.join(
      fixture.workflowDirectory,
      "artifacts/trip-style/work-status.md",
    );
    await writeFile(predecessor, planSource());
    await mkdir(path.dirname(currentStatus), { recursive: true });
    await writeFile(currentStatus, statusSource());
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r2.md"),
      planSource({
        history: [archive],
        name: "trip-style-r2",
        revision: 2,
        supersedes: archive,
      }),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style.work-status.md"),
      statusSource({ activePlan: ".ai/plans/trip-style-r2.md" }),
    );
    let calls = 0;
    const renameFile = async (source, destination) => {
      calls += 1;
      if (calls === 4) throw new Error("simulated plan activation failure");
      await rename(source, destination);
    };

    const { output, result } = await run(fixture, {
      args: [
        "--predecessor",
        ".ai/plans/trip-style.md",
        "--candidate-plan",
        ".ai/tmp/trip-style-r2.md",
        "--candidate-status",
        ".ai/tmp/trip-style.work-status.md",
      ],
      renameFile,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /rolled back/);
    assert.equal(await exists(predecessor), true);
    assert.match(await readFile(currentStatus, "utf8"), /trip-style\.md/);
    assert.equal(
      await exists(
        path.join(fixture.workflowDirectory, "tmp/trip-style-r2.md"),
      ),
      true,
    );
    assert.equal(
      await exists(
        path.join(fixture.workflowDirectory, "tmp/trip-style.work-status.md"),
      ),
      true,
    );
    assert.equal(
      await exists(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/superseded-plan.md",
        ),
      ),
      false,
    );
  });
});

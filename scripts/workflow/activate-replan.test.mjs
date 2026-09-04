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
  activateReplan,
  parseActivateArgs,
  parsePlanManifest,
} from "./activate-replan.mjs";

const initialPlan = (name) => `# Plan: ${name}

## Document Format

plan-manifest@3
`;

const revisionPlan = ({
  history,
  name,
  revision,
  supersedes,
  workItem,
}) => `# Plan: ${name}

## Document Format

plan-manifest@3

## Plan Lineage

- Work item: \`${workItem}\`
- Revision: \`${revision}\`
- Supersedes: \`${supersedes}\`
- Archived revisions: ${history.map((item) => `\`${item}\``).join(", ")}
`;

const withFixture = async (callback) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "activate-replan-"),
  );
  const workflowDirectory = path.join(temporaryRoot, ".ai");
  for (const directory of ["plans", "tmp", "artifacts"]) {
    await mkdir(path.join(workflowDirectory, directory), { recursive: true });
  }
  try {
    await callback({ temporaryRoot, workflowDirectory });
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
  const result = await activateReplan({
    args: options.args ?? [
      "--predecessor",
      ".ai/plans/trip-style.md",
      "--candidate",
      ".ai/tmp/trip-style-r2.md",
    ],
    output: (line) => output.push(line),
    renameFile: options.renameFile,
    workflowDirectory: fixture.workflowDirectory,
  });
  return { output, result };
};

test("arguments require one predecessor and candidate", () => {
  assert.deepEqual(parseActivateArgs(["--help"]), { help: true });
  assert.match(parseActivateArgs([]).error, /required/);
  assert.match(
    parseActivateArgs(["--predecessor", "plans/a.md"]).error,
    /required/,
  );
});

test("lineage-free plan-manifest@3 is inferred as revision one", () => {
  assert.deepEqual(parsePlanManifest(initialPlan("trip-style")), {
    archivedRevisions: [],
    name: "trip-style",
    revision: 1,
    workItem: "trip-style",
  });
});

test("new initial lineage accepts the template's code-formatted None value", () => {
  assert.deepEqual(
    parsePlanManifest(`# Plan: trip-style

## Document Format

plan-manifest@3

## Plan Lineage

- Work item: \`trip-style\`
- Revision: \`1\`
- Supersedes: \`N/A: initial plan\`
- Archived revisions: \`None\`
`),
    {
      archivedRevisions: [],
      name: "trip-style",
      revision: 1,
      supersedes: "N/A: initial plan",
      workItem: "trip-style",
    },
  );
});

test("activates revision two and archives its predecessor", async () => {
  await withFixture(async (fixture) => {
    const archive = ".ai/artifacts/trip-style/superseded-plan.md";
    await writeFile(
      path.join(fixture.workflowDirectory, "plans/trip-style.md"),
      initialPlan("trip-style"),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r2.md"),
      revisionPlan({
        history: [archive],
        name: "trip-style-r2",
        revision: 2,
        supersedes: archive,
        workItem: "trip-style",
      }),
    );

    const { output, result } = await run(fixture);

    assert.equal(result.ok, true, output.join("\n"));
    assert.equal(
      await exists(path.join(fixture.workflowDirectory, "plans/trip-style.md")),
      false,
    );
    assert.match(
      await readFile(
        path.join(
          fixture.workflowDirectory,
          "artifacts/trip-style/superseded-plan.md",
        ),
        "utf8",
      ),
      /# Plan: trip-style/,
    );
    assert.match(
      await readFile(
        path.join(fixture.workflowDirectory, "plans/trip-style-r2.md"),
        "utf8",
      ),
      /Revision: `2`/,
    );
  });
});

test("extends the complete archive history for later revisions", async () => {
  await withFixture(async (fixture) => {
    const first = ".ai/artifacts/trip-style/superseded-plan.md";
    const second = ".ai/artifacts/trip-style-r2/superseded-plan.md";
    await writeFile(
      path.join(fixture.workflowDirectory, "plans/trip-style-r2.md"),
      revisionPlan({
        history: [first],
        name: "trip-style-r2",
        revision: 2,
        supersedes: first,
        workItem: "trip-style",
      }),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r3.md"),
      revisionPlan({
        history: [first, second],
        name: "trip-style-r3",
        revision: 3,
        supersedes: second,
        workItem: "trip-style",
      }),
    );

    const { result } = await run(fixture, {
      args: [
        "--predecessor",
        ".ai/plans/trip-style-r2.md",
        "--candidate",
        ".ai/tmp/trip-style-r3.md",
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(
      await exists(
        path.join(fixture.workflowDirectory, "plans/trip-style-r3.md"),
      ),
      true,
    );
  });
});

test("rejects invalid lineage and collisions without changing the predecessor", async () => {
  await withFixture(async (fixture) => {
    const predecessor = path.join(
      fixture.workflowDirectory,
      "plans/trip-style.md",
    );
    await writeFile(predecessor, initialPlan("trip-style"));
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r2.md"),
      revisionPlan({
        history: [],
        name: "trip-style-r2",
        revision: 2,
        supersedes: ".ai/artifacts/trip-style/superseded-plan.md",
        workItem: "trip-style",
      }),
    );

    const { result } = await run(fixture);

    assert.equal(result.ok, false);
    assert.equal(await exists(predecessor), true);
  });
});

test("rolls the predecessor back when successor activation fails", async () => {
  await withFixture(async (fixture) => {
    const archive = ".ai/artifacts/trip-style/superseded-plan.md";
    const predecessor = path.join(
      fixture.workflowDirectory,
      "plans/trip-style.md",
    );
    const candidate = path.join(
      fixture.workflowDirectory,
      "tmp/trip-style-r2.md",
    );
    await writeFile(predecessor, initialPlan("trip-style"));
    await writeFile(
      candidate,
      revisionPlan({
        history: [archive],
        name: "trip-style-r2",
        revision: 2,
        supersedes: archive,
        workItem: "trip-style",
      }),
    );
    let calls = 0;
    const renameFile = async (source, destination) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated activation failure");
      await rename(source, destination);
    };

    const { output, result } = await run(fixture, { renameFile });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /predecessor was restored/);
    assert.equal(await exists(predecessor), true);
    assert.equal(await exists(candidate), true);
    assert.equal(
      await exists(
        path.join(fixture.workflowDirectory, "plans/trip-style-r2.md"),
      ),
      false,
    );
  });
});

test("rejects a second active plan for the same work item", async () => {
  await withFixture(async (fixture) => {
    const first = ".ai/artifacts/trip-style/superseded-plan.md";
    const second = ".ai/artifacts/trip-style-r2/superseded-plan.md";
    const third = ".ai/artifacts/trip-style-r3/superseded-plan.md";
    await writeFile(
      path.join(fixture.workflowDirectory, "plans/trip-style-r2.md"),
      revisionPlan({
        history: [first],
        name: "trip-style-r2",
        revision: 2,
        supersedes: first,
        workItem: "trip-style",
      }),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "plans/trip-style-r4.md"),
      revisionPlan({
        history: [first, second, third],
        name: "trip-style-r4",
        revision: 4,
        supersedes: third,
        workItem: "trip-style",
      }),
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "tmp/trip-style-r3.md"),
      revisionPlan({
        history: [first, second],
        name: "trip-style-r3",
        revision: 3,
        supersedes: second,
        workItem: "trip-style",
      }),
    );

    const { output, result } = await run(fixture, {
      args: [
        "--predecessor",
        ".ai/plans/trip-style-r2.md",
        "--candidate",
        ".ai/tmp/trip-style-r3.md",
      ],
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /multiple active plans/);
  });
});

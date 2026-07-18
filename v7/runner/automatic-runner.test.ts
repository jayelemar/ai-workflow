import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { runAutomaticV7Plan, type V7StageController } from "./automatic-runner.ts";

const run = promisify(execFile);
const tokens = { inputTokens: 2, cachedInputTokens: 0, uncachedInputTokens: 2, outputTokens: 1, reasoningTokens: 0, totalTokens: 3 };

test("direct plan run audits inputs and creates one ordered commit per immutable task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-auto-"));
  try {
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "v7@example.test"], { cwd: root });
    await run("git", ["config", "user.name", "V7 Test"], { cwd: root });
    await writeFile(path.join(root, ".gitignore"), ".ai/artifacts/\n", "utf8");
    await run("git", ["add", ".gitignore"], { cwd: root });
    await run("git", ["commit", "-m", "chore: initialize test repository"], { cwd: root });
    const workflow = "automatic-run";
    const planPath = path.join(root, ".ai", "plans", `${workflow}.md`);
    const specPath = path.join(root, ".ai", "specs", `${workflow}.spec.md`);
    await mkdir(path.dirname(planPath), { recursive: true });
    await mkdir(path.dirname(specPath), { recursive: true });
    await mkdir(path.join(root, ".ai", "artifacts", workflow, "v7"), { recursive: true });
    await writeFile(specPath, `workflow: ${workflow}\n`, "utf8");
    await writeFile(planPath, `workflow: ${workflow}\n\n## Spec\n\n.ai/specs/${workflow}.spec.md\n\n## Phases\n\n1. [task:01-first] Add first file\n   - Files: first.txt\n   - Validation: test -f first.txt\n   - Depends on: None\n2. [task:02-second] Add second file\n   - Files: second.txt\n   - Validation: test -f second.txt\n   - Depends on: task:01-first\n`, "utf8");
    await writeFile(path.join(root, ".ai", "artifacts", workflow, "v7", "intake.json"), JSON.stringify({ version: 7, workflowId: "automatic-id", workflowName: workflow, risk: "HIGH", route: "feature" }), "utf8");
    let sequence = 0;
    const controller: V7StageController = async ({ stage, task }) => {
      if (stage === "task-implementation" && task) await writeFile(task.files[0], `${task.id}\n`, "utf8");
      return {
        checkpoint: { sessionId: `session-${++sequence}`, model: "gpt-test", tokenUsage: tokens },
        result: stage === "task-review" ? { stage, verdict: "OKAY", conventionalCommit: `feat(v7): complete ${task?.id}` }
          : stage === "feature-intake" ? { stage, verdict: "FINDINGS", findings: [] }
            : { stage, verdict: "OKAY" },
      };
    };
    const result = await runAutomaticV7Plan({ rootDir: root, planInput: planPath, controller });
    assert.equal(result.status, "completed");
    const log = (await run("git", ["log", "--format=%s", "-2"], { cwd: root })).stdout.trim().split("\n");
    assert.deepEqual(log, ["feat(v7): complete 02-second", "feat(v7): complete 01-first"]);
    assert.match(await readFile(result.reportPath, "utf8"), /Hash chain: VERIFIED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

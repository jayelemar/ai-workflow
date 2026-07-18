import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { LIFECYCLE_STAGES, NO_CODEX_COMPLETING_STAGES } from "../lifecycle/lifecycle.ts";

test("V7 stage wrappers exactly match lifecycle policy", async () => {
  const directory = path.join(process.cwd(), ".ai", "v7", "wrappers", "stages");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  assert.deepEqual(files, LIFECYCLE_STAGES.map(([, stage]) => `${stage}.md`).sort());
  for (const stage of LIFECYCLE_STAGES.map(([, id]) => id)) {
    const content = await readFile(path.join(directory, `${stage}.md`), "utf8");
    const noCodex = NO_CODEX_COMPLETING_STAGES.includes(stage);
    assert.match(content, new RegExp(`^stage: ${stage}$`, "m"));
    assert.match(content, new RegExp(`^codexRequired: ${!noCodex}$`, "m"));
    assert.match(content, new RegExp(`^zeroTokenCompletesStage: ${noCodex}$`, "m"));
  }
});

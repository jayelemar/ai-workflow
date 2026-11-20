import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LOCAL_RECORD_ROOTS,
  runCleanup,
  verifyManagedRoots,
} from "./cleanup-local.mjs";

const createFixture = async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cleanup-local-"));
  const workflowDirectory = path.join(temporaryRoot, ".ai");
  await mkdir(workflowDirectory);
  return { temporaryRoot, workflowDirectory };
};

const withFixture = async (callback) => {
  const fixture = await createFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

const run = async (fixture, options = {}) => {
  const output = [];
  const result = await runCleanup({
    output: (line) => output.push(line),
    workflowDirectory: fixture.workflowDirectory,
    ...options,
  });
  return { output, result };
};

for (const args of [[], ["--apply"]]) {
  test(`${args.length ? "apply" : "preview"} blocks marked artifact symlinks before deleting any evidence`, async () => {
    for (const target of ["../tmp/task", "../tmp/missing", "../logs/task"]) {
      await withFixture(async (fixture) => {
        const root = fixture.workflowDirectory;
        const plans = path.join(root, "plans");
        await mkdir(plans);
        await writeFile(
          path.join(plans, "task.md"),
          "# Task\n<!-- task-resources: 0db4af2e-cc8c-499b-ae93-49fe239705fd -->\n",
        );
        const artifacts = path.join(root, "artifacts");
        await mkdir(artifacts);
        await mkdir(path.join(root, "tmp/task"), { recursive: true });
        await mkdir(path.join(root, "logs/task"), { recursive: true });
        await writeFile(
          path.join(root, "tmp/task/resources.json"),
          "ownership evidence\n",
        );
        await writeFile(
          path.join(root, "logs/task/recovery.txt"),
          "recovery evidence\n",
        );
        const link = path.join(artifacts, "task");
        await symlink(target, link);
        const { result, output } = await run(fixture, { args });
        assert.equal(result.ok, false);
        assert.match(output.join("\n"), /preflight:.*marked task artifact/);
        assert.equal(await readlink(link), target);
        assert.equal(
          await readFile(path.join(root, "tmp/task/resources.json"), "utf8"),
          "ownership evidence\n",
        );
        assert.equal(
          await readFile(path.join(root, "logs/task/recovery.txt"), "utf8"),
          "recovery evidence\n",
        );
      });
    }
  });

  test(`${args.length ? "apply" : "preview"} preserves marked task evidence when its manifest is missing`, async () => {
    await withFixture(async (fixture) => {
      const plans = path.join(fixture.workflowDirectory, "plans");
      const artifacts = path.join(fixture.workflowDirectory, "artifacts");
      await mkdir(plans);
      for (const [task, marker] of Object.entries({
        tracked:
          "<!-- task-resources: 0db4af2e-cc8c-499b-ae93-49fe239705fd -->",
        malformed: "<!-- TASK-RESOURCES: interrupted marker",
      })) {
        await writeFile(path.join(plans, `${task}.md`), `# Task\n${marker}\n`);
        await mkdir(path.join(artifacts, task), { recursive: true });
        await writeFile(
          path.join(artifacts, task, "compose-recovery.yaml"),
          "ownership proof\n",
        );
        await writeFile(
          path.join(artifacts, task, "resources-recovery.tmp"),
          "partial recovery record\n",
        );
      }
      await writeFile(path.join(plans, "legacy.md"), "# No resource marker\n");
      await mkdir(path.join(artifacts, "legacy"));
      await writeFile(path.join(artifacts, "legacy", "old.txt"), "legacy\n");
      const { result, output } = await run(fixture, { args });
      assert.equal(result.ok, true, output.join("\n"));
      assert.deepEqual(
        result.entries.map((entry) => entry.relativePath),
        ["artifacts/legacy", "artifacts/legacy/old.txt"],
      );
      assert.deepEqual(
        result.preserved.map((entry) => entry.relativePath),
        ["artifacts/malformed", "artifacts/tracked"],
      );
      for (const task of ["tracked", "malformed"]) {
        assert.equal(
          await readFile(
            path.join(artifacts, task, "compose-recovery.yaml"),
            "utf8",
          ),
          "ownership proof\n",
        );
        assert.equal(
          await readFile(
            path.join(artifacts, task, "resources-recovery.tmp"),
            "utf8",
          ),
          "partial recovery record\n",
        );
      }
    });
  });

  test(`${args.length ? "apply" : "preview"} rejects case-variant plan aliases, including dangling aliases, before mutation`, async () => {
    for (const alias of [
      "root",
      "nested",
      "dangling-root",
      "dangling-nested",
      "uppercase-root",
    ]) {
      await withFixture(async (fixture) => {
        const plans = path.join(fixture.workflowDirectory, "plans");
        const records = path.join(
          fixture.workflowDirectory,
          alias === "uppercase-root" ? "LOGS" : "logs",
        );
        const dangling = alias.startsWith("dangling-");
        if (!dangling) {
          await mkdir(records);
          await writeFile(path.join(records, "active.md"), "active\n");
        }
        if (alias.endsWith("nested")) {
          await mkdir(plans);
          await symlink("../LOGS/active.md", path.join(plans, "linked.md"));
        } else {
          await symlink("LOGS", plans);
        }
        // An actual LOGS directory is unmanaged on case-sensitive volumes;
        // cleanup may succeed, but its linked plans must remain readable.
        // Inspect before apply creates the separate lowercase managed roots.
        const managedAlias =
          alias !== "uppercase-root" ||
          (await lstat(path.join(fixture.workflowDirectory, "logs")).then(
            () => true,
            (error) => {
              if (error.code === "ENOENT") return false;
              throw error;
            },
          ));
        const { output, result } = await run(fixture, { args });
        assert.equal(
          result.ok,
          !managedAlias,
          `${alias}: ${output.join("\n")}`,
        );
        if (managedAlias) {
          assert.match(output.join("\n"), /preflight:.*overlaps a living plan/);
        }
        if (dangling) {
          await assert.rejects(lstat(records), { code: "ENOENT" });
        } else {
          assert.equal(
            await readFile(path.join(records, "active.md"), "utf8"),
            "active\n",
          );
        }
        assert.equal(
          await readlink(
            alias.endsWith("nested") ? path.join(plans, "linked.md") : plans,
          ),
          alias.endsWith("nested") ? "../LOGS/active.md" : "LOGS",
        );
      });
    }
  });

  test(`${args.length ? "apply" : "preview"} rejects cleanup through linked plan aliases before mutating any root`, async () => {
    for (const alias of [
      "root",
      "file",
      "directory",
      "indirect-directory",
      "intermediate-link",
      "parent-segment",
      "ancestor",
      "filesystem-root",
    ]) {
      await withFixture(async (fixture) => {
        const plans = path.join(fixture.workflowDirectory, "plans");
        const records = path.join(fixture.workflowDirectory, "logs");
        const record = path.join(records, "nested", "active.md");
        await mkdir(path.dirname(record), { recursive: true });
        await writeFile(record, "active\n");
        const rootAlias = ["root", "ancestor", "filesystem-root"].includes(
          alias,
        );
        if (rootAlias) {
          await symlink(
            alias === "root"
              ? "logs"
              : alias === "ancestor"
                ? "."
                : path.parse(plans).root,
            plans,
          );
        } else {
          await mkdir(plans);
          const target = alias === "file" ? record : path.dirname(record);
          if (alias === "indirect-directory") {
            const outside = path.join(fixture.temporaryRoot, "outside");
            await mkdir(outside);
            await symlink(target, path.join(outside, "linked-records"));
            await symlink(outside, path.join(plans, "linked-records"));
          } else if (alias === "intermediate-link") {
            const outside = path.join(fixture.temporaryRoot, "outside");
            await mkdir(outside);
            await symlink(outside, path.join(records, "bridge"));
            await symlink(records, path.join(outside, "shortcut"));
            // The final real path is outside managed roots, but deleting bridge
            // would still break the plan's link.
            await symlink(
              path.join(outside, "shortcut", "bridge"),
              path.join(plans, "linked-records"),
            );
          } else if (alias === "parent-segment") {
            const outside = path.join(fixture.temporaryRoot, "outside");
            await mkdir(outside);
            await symlink(path.dirname(record), path.join(outside, "shortcut"));
            // Preserve filesystem '..' semantics after resolving shortcut.
            await symlink(
              `${outside}/shortcut/../nested/active.md`,
              path.join(plans, "linked-records"),
            );
          } else {
            await symlink(target, path.join(plans, "linked-records"));
          }
        }
        await mkdir(path.join(fixture.workflowDirectory, "artifacts"));
        const unrelated = path.join(
          fixture.workflowDirectory,
          "artifacts",
          "old.md",
        );
        await writeFile(unrelated, "old\n");

        const { output, result } = await run(fixture, { args });
        assert.equal(result.ok, false, `${alias}: ${output.join("\n")}`);
        assert.match(
          output.join("\n"),
          /preflight:.*overlaps a living plan/,
          alias,
        );
        assert.equal(await readFile(record, "utf8"), "active\n");
        assert.equal(await readFile(unrelated, "utf8"), "old\n");
        assert.equal((await lstat(plans)).isSymbolicLink(), rootAlias);
      });
    }
  });

  test(`${args.length ? "apply" : "preview"} preserves dangling managed aliases and stops on unresolved plan link cycles`, async () => {
    for (const destination of ["logs", "plans/cycle/tail"]) {
      await withFixture(async (fixture) => {
        const plans = path.join(fixture.workflowDirectory, "plans");
        if (destination === "logs") {
          await symlink(destination, plans);
        } else {
          await mkdir(plans);
          await symlink("cycle/tail", path.join(plans, "cycle"));
        }
        const { output, result } = await run(fixture, { args });
        assert.equal(result.ok, false, output.join("\n"));
        assert.match(
          output.join("\n"),
          /preflight:.*(overlaps a living plan|too many symbolic links)/,
        );
        await assert.rejects(
          lstat(path.join(fixture.workflowDirectory, "logs")),
          { code: "ENOENT" },
        );
        assert.equal(
          await readlink(
            destination === "logs" ? plans : path.join(plans, "cycle"),
          ),
          destination === "logs" ? "logs" : "cycle/tail",
        );
      });
    }
  });

  test(`${args.length ? "apply" : "preview"} preserves the entire living plans tree regardless of status or entry type`, async () => {
    await withFixture(async (fixture) => {
      const plans = path.join(fixture.workflowDirectory, "plans");
      const outside = path.join(fixture.temporaryRoot, "outside");
      await mkdir(path.join(plans, "nested"), { recursive: true });
      await mkdir(outside);
      const contents = {
        "active-plan.md": "- [ ] Still active\n",
        "completed-plan.md": "- [x] Complete\n",
        ".hidden": "hidden\n",
        "nested/record.txt": "nested\n",
      };
      for (const [entry, content] of Object.entries(contents)) {
        await writeFile(path.join(plans, entry), content);
      }
      await writeFile(path.join(outside, "record.md"), "external\n");
      const links = {
        "linked-file.md": path.join(outside, "record.md"),
        "linked-directory": outside,
        "dangling.md": "missing-plan.md",
      };
      for (const [entry, target] of Object.entries(links)) {
        await symlink(target, path.join(plans, entry));
      }
      await mkdir(path.join(fixture.workflowDirectory, "logs"));
      await writeFile(
        path.join(fixture.workflowDirectory, "logs", "old.md"),
        "old\n",
      );

      const { output, result } = await run(fixture, { args });
      assert.equal(result.ok, true, output.join("\n"));
      assert.equal(
        result.entries.some((entry) => entry.relativePath.startsWith("plans/")),
        false,
      );
      for (const [entry, content] of Object.entries(contents)) {
        assert.equal(await readFile(path.join(plans, entry), "utf8"), content);
      }
      for (const [entry, target] of Object.entries(links)) {
        assert.equal(await readlink(path.join(plans, entry)), target);
      }
      assert.deepEqual(
        (await readdir(plans)).sort(),
        [
          "nested",
          ...Object.keys(contents).filter((entry) => !entry.includes("/")),
          ...Object.keys(links),
        ].sort(),
      );
      assert.deepEqual(await readdir(path.join(plans, "nested")), [
        "record.txt",
      ]);
      assert.equal(
        await readFile(path.join(outside, "record.md"), "utf8"),
        "external\n",
      );
      if (args.length)
        assert.deepEqual(
          await readdir(path.join(fixture.workflowDirectory, "logs")),
          [],
        );
    });
  });
}

test("preview and apply leave linked plans roots untouched, including dangling links", async () => {
  await withFixture(async (fixture) => {
    const plans = path.join(fixture.workflowDirectory, "plans");
    const outside = path.join(fixture.temporaryRoot, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "active.md"), "active\n");
    for (const target of [outside, "missing-plans"]) {
      await symlink(target, plans);
      for (const args of [[], ["--apply"]]) {
        const { output, result } = await run(fixture, { args });
        assert.equal(result.ok, true, output.join("\n"));
        assert.equal(await readlink(plans), target);
        assert.equal(
          await readFile(path.join(outside, "active.md"), "utf8"),
          "active\n",
        );
      }
      await rm(plans);
    }
  });
});

test("preview is deterministic and never mutates ordinary, hidden, nested, or linked entries", async () => {
  await withFixture(async (fixture) => {
    const records = path.join(fixture.workflowDirectory, "logs");
    const external = path.join(fixture.temporaryRoot, "external.txt");
    await mkdir(path.join(records, "nested"), { recursive: true });
    await writeFile(path.join(records, ".hidden"), "hidden\n");
    await writeFile(path.join(records, "nested", "plan.md"), "plan\n");
    await writeFile(external, "external\n");
    await symlink(external, path.join(records, "linked-external"));

    const before = await readFile(
      path.join(records, "nested", "plan.md"),
      "utf8",
    );
    const { output, result } = await run(fixture);

    assert.equal(result.ok, true);
    assert.deepEqual(
      output.filter((line) => line.startsWith("Would remove ")),
      [
        "Would remove logs/.hidden",
        "Would remove logs/linked-external",
        "Would remove logs/nested",
        "Would remove logs/nested/plan.md",
      ],
    );
    assert.match(output.join("\n"), /target count: 4/);
    assert.match(output.join("\n"), /No mutation occurred/);
    assert.match(
      output.join("\n"),
      /WARNING: --apply permanently removes legacy local records/,
    );
    assert.equal(
      await readFile(path.join(records, "nested", "plan.md"), "utf8"),
      before,
    );
    assert.equal(await readFile(external, "utf8"), "external\n");
  });
});

test("apply removes every entry without traversing links and leaves all managed roots empty", async () => {
  await withFixture(async (fixture) => {
    const external = path.join(fixture.temporaryRoot, "external.txt");
    await writeFile(external, "external\n");
    await mkdir(path.join(fixture.workflowDirectory, "artifacts", "nested"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workflowDirectory, "artifacts", ".hidden"),
      "hidden\n",
    );
    await writeFile(
      path.join(fixture.workflowDirectory, "artifacts", "nested", "record.md"),
      "record\n",
    );
    await symlink(
      external,
      path.join(fixture.workflowDirectory, "artifacts", "linked-external"),
    );

    const { output, result } = await run(fixture, { args: ["--apply"] });

    assert.equal(result.ok, true, output.join("\n"));
    assert.match(output.join("\n"), /Cleanup removed count: 4/);
    assert.match(
      output.join("\n"),
      /WARNING: --apply permanently removes legacy local records/,
    );
    assert.equal(await readFile(external, "utf8"), "external\n");
    for (const localRoot of LOCAL_RECORD_ROOTS) {
      assert.deepEqual(
        await readdir(path.join(fixture.workflowDirectory, localRoot)),
        [],
      );
    }
  });
});

for (const args of [[], ["--apply"]]) {
  test(`${args.length ? "apply" : "preview"} preserves complete task evidence without parsing resource records`, async () => {
    await withFixture(async (fixture) => {
      const artifacts = path.join(fixture.workflowDirectory, "artifacts");
      const records = {
        valid: JSON.stringify({ schemaVersion: 1, resources: [] }),
        malformed: "{ unfinished",
        unresolved: JSON.stringify({
          sourcePlan: "plans/expected-but-missing.md",
          resources: [{ status: "pending" }],
        }),
      };
      for (const [task, contents] of Object.entries(records)) {
        await mkdir(path.join(artifacts, task, "nested"), { recursive: true });
        await writeFile(path.join(artifacts, task, "resources.json"), contents);
        await writeFile(
          path.join(artifacts, task, "nested", "ownership.txt"),
          "evidence\n",
        );
      }
      await mkdir(path.join(artifacts, "legacy"));
      await writeFile(path.join(artifacts, "legacy", "old.txt"), "legacy\n");

      const { output, result } = await run(fixture, { args });

      assert.equal(result.ok, true, output.join("\n"));
      assert.deepEqual(
        result.entries.map((entry) => entry.relativePath),
        ["artifacts/legacy", "artifacts/legacy/old.txt"],
      );
      assert.deepEqual(
        result.preserved.map((entry) => entry.relativePath),
        ["artifacts/malformed", "artifacts/unresolved", "artifacts/valid"],
      );
      for (const [task, contents] of Object.entries(records)) {
        assert.equal(
          await readFile(path.join(artifacts, task, "resources.json"), "utf8"),
          contents,
        );
        assert.equal(
          await readFile(
            path.join(artifacts, task, "nested", "ownership.txt"),
            "utf8",
          ),
          "evidence\n",
        );
        assert.match(
          output.join("\n"),
          new RegExp(`Preserved artifacts/${task}`),
        );
      }
      if (args.length) {
        await assert.rejects(lstat(path.join(artifacts, "legacy")), {
          code: "ENOENT",
        });
        assert.equal(result.removed.length, 2);
        assert.match(output.join("\n"), /Cleanup removed count: 2/);
        assert.doesNotMatch(output.join("\n"), /roots are present and empty/);
      } else {
        assert.equal(
          await readFile(path.join(artifacts, "legacy", "old.txt"), "utf8"),
          "legacy\n",
        );
      }
    });
  });

  test(`${args.length ? "apply" : "preview"} preserves linked and dangling resource entries without following them`, async () => {
    await withFixture(async (fixture) => {
      const artifacts = path.join(fixture.workflowDirectory, "artifacts");
      const external = path.join(fixture.temporaryRoot, "external");
      await mkdir(external);
      await writeFile(path.join(external, "ownership.txt"), "external\n");
      for (const [task, destination] of [
        ["linked", external],
        ["dangling", "missing.json"],
      ]) {
        await mkdir(path.join(artifacts, task), { recursive: true });
        await symlink(
          destination,
          path.join(artifacts, task, "resources.json"),
        );
      }
      await mkdir(path.join(artifacts, "directory", "resources.json"), {
        recursive: true,
      });
      await writeFile(
        path.join(artifacts, "directory", "resources.json", "ownership.txt"),
        "evidence\n",
      );

      const { output, result } = await run(fixture, { args });

      assert.equal(result.ok, true, output.join("\n"));
      assert.deepEqual(result.entries, []);
      assert.equal(
        await readlink(path.join(artifacts, "linked", "resources.json")),
        external,
      );
      assert.equal(
        await readlink(path.join(artifacts, "dangling", "resources.json")),
        "missing.json",
      );
      assert.equal(
        await readFile(
          path.join(artifacts, "directory", "resources.json", "ownership.txt"),
          "utf8",
        ),
        "evidence\n",
      );
      assert.equal(
        await readFile(path.join(external, "ownership.txt"), "utf8"),
        "external\n",
      );
    });
  });

  test(`${args.length ? "apply" : "preview"} preserves the resource lock independently of its contents`, async () => {
    for (const lockType of ["empty", "populated", "dangling-link"]) {
      await withFixture(async (fixture) => {
        const temporary = path.join(fixture.workflowDirectory, "tmp");
        const lock = path.join(temporary, "task-resources.lock");
        await mkdir(temporary);
        if (lockType === "dangling-link") {
          await symlink("missing-lock", lock);
        } else {
          await mkdir(lock);
          if (lockType === "populated") {
            await mkdir(path.join(lock, "nested"));
            await writeFile(
              path.join(lock, "nested", "holder.json"),
              "holder\n",
            );
          }
        }
        await writeFile(path.join(temporary, "legacy.txt"), "legacy\n");

        const { output, result } = await run(fixture, { args });

        assert.equal(result.ok, true, output.join("\n"));
        assert.deepEqual(
          result.preserved.map((entry) => entry.relativePath),
          ["tmp/task-resources.lock"],
        );
        assert.deepEqual(
          result.entries.map((entry) => entry.relativePath),
          ["tmp/legacy.txt"],
        );
        assert.equal(
          (await lstat(lock)).isSymbolicLink(),
          lockType === "dangling-link",
        );
        if (lockType === "populated") {
          assert.equal(
            await readFile(path.join(lock, "nested", "holder.json"), "utf8"),
            "holder\n",
          );
        }
        if (args.length) {
          assert.deepEqual(await readdir(temporary), ["task-resources.lock"]);
          assert.equal(result.removed.length, 1);
        }
      });
    }
  });
}

test("empty and missing roots succeed without preview mutation and apply creates all roots", async () => {
  await withFixture(async (fixture) => {
    const preview = await run(fixture);
    assert.equal(preview.result.ok, true);
    assert.match(preview.output.join("\n"), /target count: 0/);
    await assert.rejects(lstat(path.join(fixture.workflowDirectory, "tmp")));

    const applied = await run(fixture, { args: ["--apply"] });
    assert.equal(applied.result.ok, true, applied.output.join("\n"));
    for (const localRoot of LOCAL_RECORD_ROOTS) {
      assert.equal(
        (
          await lstat(path.join(fixture.workflowDirectory, localRoot))
        ).isDirectory(),
        true,
      );
    }
    await assert.rejects(lstat(path.join(fixture.workflowDirectory, "plans")), {
      code: "ENOENT",
    });
  });
});

test("help and invalid arguments return without mutation", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, "logs"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workflowDirectory, "logs", "record.md"),
      "record\n",
    );
    const help = await run(fixture, { args: ["--help"] });
    const invalid = await run(fixture, { args: ["--force"] });

    assert.equal(help.result.ok, true);
    assert.match(help.output.join("\n"), /Usage: pnpm cleanup:local/);
    assert.equal(invalid.result.ok, false);
    assert.match(invalid.output.join("\n"), /Unknown option: --force/);
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "logs", "record.md"),
        "utf8",
      ),
      "record\n",
    );
  });
});

test("unsafe root links fail before deleting another managed root", async () => {
  await withFixture(async (fixture) => {
    const externalRoot = path.join(fixture.temporaryRoot, "external-root");
    await mkdir(externalRoot);
    await mkdir(path.join(fixture.workflowDirectory, "logs"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workflowDirectory, "logs", "record.md"),
      "record\n",
    );
    await symlink(externalRoot, path.join(fixture.workflowDirectory, "tmp"));

    const applied = await run(fixture, { args: ["--apply"] });

    assert.equal(applied.result.ok, false);
    assert.match(
      applied.output.join("\n"),
      /unsafe managed root is a symbolic link: tmp/,
    );
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "logs", "record.md"),
        "utf8",
      ),
      "record\n",
    );
  });
});

test("a dangling managed-root link fails before deleting another managed root", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, "logs"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workflowDirectory, "logs", "record.md"),
      "record\n",
    );
    await symlink("missing-root", path.join(fixture.workflowDirectory, "tmp"));

    const applied = await run(fixture, { args: ["--apply"] });

    assert.equal(applied.result.ok, false);
    assert.match(
      applied.output.join("\n"),
      /unsafe managed root is a symbolic link: tmp/,
    );
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "logs", "record.md"),
        "utf8",
      ),
      "record\n",
    );
  });
});

test("a deletion failure identifies the incomplete target and never reports success", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, "logs"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workflowDirectory, "logs", "record.md"),
      "record\n",
    );
    const applied = await run(fixture, {
      args: ["--apply"],
      remove: async () => {
        throw new Error("simulated failure");
      },
    });

    assert.equal(applied.result.ok, false);
    assert.match(
      applied.output.join("\n"),
      /deletion: logs\/record\.md: simulated failure/,
    );
    assert.doesNotMatch(
      applied.output.join("\n"),
      /All managed local-record roots are present and empty/,
    );
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "logs", "record.md"),
        "utf8",
      ),
      "record\n",
    );
  });
});

test("managed-root postcondition verification rejects links and remaining entries", async () => {
  await withFixture(async (fixture) => {
    const roots = LOCAL_RECORD_ROOTS.map((localRoot) =>
      path.join(fixture.workflowDirectory, localRoot),
    );
    await Promise.all(roots.map((root) => mkdir(root, { recursive: true })));
    await writeFile(path.join(roots[0], "concurrent-record.md"), "record\n");
    await assert.rejects(
      verifyManagedRoots(roots),
      /managed root is not empty/,
    );
    await rm(roots[0], { force: true, recursive: true });
    await symlink("missing-root", roots[0]);
    await assert.rejects(
      verifyManagedRoots(roots),
      /managed root is not an empty directory/,
    );
  });
});

test("managed-root postconditions accept only the preflight-preserved entries", async () => {
  await withFixture(async (fixture) => {
    const roots = LOCAL_RECORD_ROOTS.map((localRoot) =>
      path.join(fixture.workflowDirectory, localRoot),
    );
    await Promise.all(roots.map((root) => mkdir(root)));
    const task = path.join(roots[0], "task");
    await mkdir(task);
    await writeFile(path.join(task, "resources.json"), "{ unresolved");
    const { result } = await run(fixture);

    await verifyManagedRoots(roots, result.preserved);
    const unexpected = path.join(roots[0], "unexpected.txt");
    await writeFile(unexpected, "concurrent\n");
    await assert.rejects(
      verifyManagedRoots(roots, result.preserved),
      /does not match preserved entries/,
    );
    await rm(unexpected);
    await rm(task, { recursive: true });
    await assert.rejects(
      verifyManagedRoots(roots, result.preserved),
      /does not match preserved entries/,
    );
  });
});

test("partial failures report completed legacy removals and preserve task evidence", async () => {
  await withFixture(async (fixture) => {
    const task = path.join(fixture.workflowDirectory, "artifacts", "task");
    await mkdir(task, { recursive: true });
    await writeFile(path.join(task, "resources.json"), "{ unresolved");
    const logs = path.join(fixture.workflowDirectory, "logs");
    await mkdir(logs);
    await writeFile(path.join(logs, "a.txt"), "a\n");
    await writeFile(path.join(logs, "b.txt"), "b\n");

    const { output, result } = await run(fixture, {
      args: ["--apply"],
      remove: async (entry) => {
        if (entry.relativePath === "logs/b.txt")
          throw new Error("simulated failure");
        await rm(entry.path);
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.removed.map((entry) => entry.relativePath),
      ["logs/a.txt"],
    );
    assert.deepEqual(
      output.filter((line) => line.startsWith("Removed ")),
      ["Removed logs/a.txt"],
    );
    assert.match(output.join("\n"), /Cleanup removed count before failure: 1/);
    assert.match(output.join("\n"), /Preserved artifacts\/task/);
    assert.equal(
      await readFile(path.join(task, "resources.json"), "utf8"),
      "{ unresolved",
    );
    assert.equal(await readFile(path.join(logs, "b.txt"), "utf8"), "b\n");
  });
});

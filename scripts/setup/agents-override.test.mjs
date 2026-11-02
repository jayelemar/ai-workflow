import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const utilitySourcePath = path.join(
  repositoryRoot,
  "scripts/setup/agents-override.mjs",
);
const oldOverrideContent = `# Local Project AI Instructions

Read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.

## Code Review Rules

- Before approving changes, check that login and access control still work.
- Do not expose private client, user, or firm data.
- Run the relevant tests. If a test cannot be run, clearly say why.

## Parallel Work Rules

- Agents may research or review in parallel.
- Never have more than one agent edit the same file at the same time.
`;
const routingBlock = `<!-- ai-workflow-routing:start -->

Read and follow \`AGENTS.md\` first when it exists in this workspace root.
Then read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.
<!-- ai-workflow-routing:end -->`;
const overrideContent = oldOverrideContent.replace(
  "Read and follow `.ai/AGENTS.md` before starting work.\nUse `.ai/instructions/index.md` to load only instructions relevant to the request.",
  routingBlock,
);
const excludeRule = "/AGENTS.override.md";
const configContent = Buffer.from(
  '# Fixture project configuration\r\nmodel = "fixture"\r\n',
);
const skillNames = ["ai-build", "ai-worktree-setup", "ai-commit", "ai-pr"];
const managedPaths = [
  "AGENTS.override.md",
  ...skillNames.map((name) => `.agents/skills/${name}`),
  ".codex/config.toml",
];
const excludeRules = managedPaths.map((name) => `/${name}`);

// The public copyable example is part of the setup contract; a duplicated
// test-only block can miss differences introduced by Markdown formatting.
test("the literal documented routing block preserves custom guidance", async () => {
  const documentation = await readFile(
    path.join(repositoryRoot, "docs/codex-agent.md"),
    "utf8",
  );
  const documentedBlock = documentation.match(/```md\n([\s\S]*?)\n```/)?.[1];
  assert.ok(documentedBlock);
  await withFixture(async (fixture) => {
    const content = `# Custom guidance\n\n${documentedBlock}\n\nKeep these rules.\n`;
    const override = path.join(fixture.projectRoot, "AGENTS.override.md");
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.md"),
      "# Existing root rules\n",
    );
    await writeFile(override, content);
    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(override, "utf8"), content);
  });
});

const run = async (command, args, options = {}) => {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { exitCode: 0, ...result };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stderr: error.stderr ?? error.message,
      stdout: error.stdout ?? "",
    };
  }
};

const git = async (cwd, ...args) => {
  const result = await run("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
};

const installWorkflow = async (projectRoot, { nestedGit = true } = {}) => {
  const workflowRoot = path.join(projectRoot, ".ai");
  const utilityPath = path.join(
    workflowRoot,
    "scripts/setup/agents-override.mjs",
  );
  await mkdir(path.dirname(utilityPath), { recursive: true });
  await mkdir(path.join(workflowRoot, "instructions"), { recursive: true });
  await mkdir(path.join(workflowRoot, ".codex"));
  await writeFile(path.join(workflowRoot, ".codex/config.toml"), configContent);
  await writeFile(
    path.join(workflowRoot, "AGENTS.md"),
    "# Fixture workflow instructions\n",
  );
  await writeFile(
    path.join(workflowRoot, "instructions/index.md"),
    "# Fixture routes\n",
  );
  for (const name of skillNames) {
    const skillRoot = path.join(workflowRoot, ".agents/skills", name);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      `---\nname: ${name}\ndescription: Fixture skill\n---\n`,
    );
  }
  await writeFile(utilityPath, await readFile(utilitySourcePath, "utf8"));
  await writeFile(
    path.join(workflowRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@fixture/ai-workflow",
        packageManager: "pnpm@10.34.4",
        private: true,
        type: "module",
        scripts: {
          "setup:codex": "node scripts/setup/agents-override.mjs",
        },
      },
      null,
      2,
    )}\n`,
  );
  if (nestedGit) {
    await git(workflowRoot, "init", "-q");
  }
  return { utilityPath, workflowRoot };
};

const createFixture = async ({ initializeParent = true } = {}) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agents-override-"),
  );
  const projectRoot = path.join(temporaryRoot, "project");
  await mkdir(projectRoot);
  await writeFile(
    path.join(projectRoot, "package.json"),
    '{"private":true,"packageManager":"pnpm@10.34.4"}\n',
  );
  if (initializeParent) {
    await git(projectRoot, "init", "-q");
  }
  const workflow = await installWorkflow(projectRoot);
  return { ...workflow, projectRoot, temporaryRoot };
};

const excludePathFor = async (projectRoot) =>
  git(
    projectRoot,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  );

const invokeNode = (fixture, options = {}) =>
  run(process.execPath, [fixture.utilityPath], {
    cwd: options.cwd ?? fixture.workflowRoot,
    env: { ...process.env, ...options.env },
  });

const invokePnpm = (fixture, args, cwd) =>
  run("pnpm", args, {
    cwd,
    env: process.env,
  });

const readManagedState = async (fixture) => {
  const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
  const excludePath = await excludePathFor(fixture.projectRoot);
  return {
    exclude: await readFile(excludePath, "utf8"),
    excludePath,
    override: await readFile(overridePath, "utf8"),
    overridePath,
    config: await readFile(
      path.join(fixture.projectRoot, ".codex/config.toml"),
    ),
    skills: await Promise.all(
      skillNames.map(async (name) => {
        const target = path.join(fixture.projectRoot, ".agents/skills", name);
        return {
          name,
          target: await readlink(target),
          resolved: await realpath(target),
        };
      }),
    ),
  };
};

const assertIgnored = async (projectRoot) => {
  // Query Git without a pathspec: lowercase-only queries can hide case aliases
  // that are actually visible to Git when core.ignorecase=false.
  const status = await run(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: projectRoot },
  );
  assert.equal(status.exitCode, 0, status.stderr);
  const visible = status.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
  for (const relativePath of managedPaths) {
    let parent = projectRoot;
    for (const component of relativePath.split("/")) {
      assert.ok(
        (await readdir(parent)).includes(component),
        `${relativePath} must use its exact spelling`,
      );
      parent = path.join(parent, component);
    }
    assert.ok(
      !visible.some(
        (name) =>
          name.toLowerCase() === relativePath.toLowerCase() ||
          name.toLowerCase().startsWith(`${relativePath.toLowerCase()}/`),
      ),
      `managed output visible to Git: ${JSON.stringify(visible)}`,
    );
    const ignored = await run(
      "git",
      ["check-ignore", "-q", "--", relativePath],
      {
        cwd: projectRoot,
      },
    );
    assert.equal(ignored.exitCode, 0, ignored.stderr);
    assert.equal(await git(projectRoot, "ls-files", "--", relativePath), "");
    assert.equal(
      await git(projectRoot, "status", "--short", "--", relativePath),
      "",
    );
  }
};

const withFixture = async (callback, options) => {
  const fixture = await createFixture(options);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

test("setup creates a real project Codex directory and exact config copy", async () => {
  await withFixture(async (fixture) => {
    const source = path.join(fixture.workflowRoot, ".codex/config.toml");
    await chmod(source, 0o640);
    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    const directory = path.join(fixture.projectRoot, ".codex");
    const config = path.join(directory, "config.toml");
    assert.equal((await lstat(directory)).isDirectory(), true);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    assert.equal((await lstat(config)).isFile(), true);
    assert.equal((await lstat(config)).isSymbolicLink(), false);
    assert.deepEqual(await readFile(config), configContent);
    assert.equal((await stat(config)).mode & 0o777, 0o640);
    assert.match(result.stdout, /\.codex\/config\.toml: created/);
    assert.match(result.stdout, /\/\.codex\/config\.toml exclude rule: added/);
    const custom = path.join(fixture.projectRoot, ".codex/custom.toml");
    await writeFile(custom, "# Keep custom project configuration\n");
    await git(fixture.projectRoot, "add", ".codex/custom.toml");
    const indexBefore = await git(fixture.projectRoot, "ls-files", "--stage");
    await chmod(config, 0o444);
    const before = await stat(config);
    const state = await readManagedState(fixture);
    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /\.codex\/config\.toml: already correct/);
    assert.deepEqual(await readManagedState(fixture), state);
    assert.equal((await stat(config)).mtimeMs, before.mtimeMs);
    assert.equal((await stat(config)).mode & 0o777, 0o444);
    assert.equal(
      await readFile(custom, "utf8"),
      "# Keep custom project configuration\n",
    );
    assert.equal(
      await git(fixture.projectRoot, "ls-files", "--stage"),
      indexBefore,
    );
    assert.equal(state.exclude.includes("/.codex\n"), false);
    assert.equal(state.exclude.includes("/.codex/\n"), false);
    await writeFile(
      path.join(fixture.projectRoot, ".codex/untracked.toml"),
      "# Visible custom file\n",
    );
    assert.match(
      await git(
        fixture.projectRoot,
        "status",
        "--short",
        "--untracked-files=all",
      ),
      /\.codex\/untracked\.toml/,
    );
    await assertIgnored(fixture.projectRoot);
  });
});

test("nested package command creates the exact regular override and local exclude rule", async () => {
  await withFixture(async (fixture) => {
    const result = await invokePnpm(
      fixture,
      ["setup:codex"],
      fixture.workflowRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /AGENTS\.override\.md: created/);
    assert.match(result.stdout, /exclude rule: added/);
    assert.match(result.stdout, /setup verified/i);

    const state = await readManagedState(fixture);
    assert.equal(state.override, overrideContent);
    assert.equal((await lstat(state.overridePath)).isFile(), true);
    assert.equal((await lstat(state.overridePath)).isSymbolicLink(), false);
    assert.deepEqual(
      state.skills.map(({ name, target }) => ({ name, target })),
      skillNames.map((name) => ({
        name,
        target: `../../.ai/.agents/skills/${name}`,
      })),
    );
    for (const { name, resolved } of state.skills) {
      assert.equal(
        resolved,
        await realpath(path.join(fixture.workflowRoot, ".agents/skills", name)),
      );
    }
    assert.deepEqual(
      state.exclude.split("\n").filter((line) => line.startsWith("/.agents")),
      skillNames.map((name) => `/.agents/skills/${name}`),
    );
    assert.equal(
      state.exclude.split("\n").filter((line) => line === excludeRule).length,
      1,
    );
    await assertIgnored(fixture.projectRoot);
  });
});

const snapshotManagedOutputs = async (fixture) => {
  const snapshot = {};
  for (const relativePath of [
    ".agents",
    ".agents/skills",
    ".codex",
    ...managedPaths,
    ".ai/.codex",
    ".ai/.codex/config.toml",
  ]) {
    const target = path.join(fixture.projectRoot, relativePath);
    try {
      const metadata = await lstat(target);
      snapshot[relativePath] = metadata.isSymbolicLink()
        ? { link: await readlink(target) }
        : metadata.isDirectory()
          ? { entries: await readdir(target) }
          : { content: await readFile(target, "utf8") };
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      snapshot[relativePath] = null;
    }
  }
  snapshot.exclude = await readFile(
    await excludePathFor(fixture.projectRoot),
    "utf8",
  );
  snapshot.index = await git(fixture.projectRoot, "ls-files", "--stage");
  return snapshot;
};

test("a different project config refuses all writes and preserves exact source, destination, and index bytes", async () => {
  await withFixture(async (fixture) => {
    const config = path.join(fixture.projectRoot, ".codex/config.toml");
    const custom = Buffer.from(
      '# Keep local preferences\r\nmodel = "custom"\r\n',
    );
    await mkdir(path.dirname(config));
    await writeFile(config, custom);
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.override.md"),
      oldOverrideContent,
    );
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.md"),
      "# Preserve root instructions\n",
    );
    await git(fixture.projectRoot, "add", "AGENTS.md");
    const indexPath = await git(
      fixture.projectRoot,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    );
    const indexBefore = await readFile(indexPath);
    const before = await snapshotManagedOutputs(fixture);
    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(
      result.stderr,
      /\.codex\/config\.toml differs.*custom configuration was preserved/,
    );
    assert.doesNotMatch(result.stderr, /Partial setup:/);
    assert.deepEqual(await snapshotManagedOutputs(fixture), before);
    assert.deepEqual(await readFile(config), custom);
    assert.deepEqual(
      await readFile(path.join(fixture.workflowRoot, ".codex/config.toml")),
      configContent,
    );
    assert.deepEqual(await readFile(indexPath), indexBefore);
  });
});

// File and directory trust boundaries differ from skill links. Exercise their
// refusal paths through disposable real files; shared alias and ignore tests
// cover the common Git protection machinery separately.
test("unsafe or missing config sources and unsafe destinations refuse setup before writes", async (t) => {
  const cases = [
    ["missing source directory", ".ai/.codex", "missing", /\.ai\/\.codex/],
    [
      "linked source directory",
      ".ai/.codex",
      "directory link",
      /\.ai\/\.codex.*real directory/,
    ],
    [
      "non-directory source",
      ".ai/.codex",
      "file",
      /\.ai\/\.codex.*real directory/,
    ],
    [
      "missing source file",
      ".ai/.codex/config.toml",
      "missing",
      /required config source/,
    ],
    [
      "linked source file",
      ".ai/.codex/config.toml",
      "file link",
      /required config source.*regular file/,
    ],
    [
      "non-file source",
      ".ai/.codex/config.toml",
      "directory",
      /required config source.*regular file/,
    ],
    [
      "linked destination directory",
      ".codex",
      "directory link",
      /\.codex.*real directory/,
    ],
    ["non-directory destination", ".codex", "file", /\.codex.*real directory/],
    [
      "linked destination config",
      ".codex/config.toml",
      "file link",
      /config\.toml.*regular file/,
    ],
    [
      "non-file destination config",
      ".codex/config.toml",
      "directory",
      /config\.toml.*regular file/,
    ],
    [
      "tracked identical destination config",
      ".codex/config.toml",
      "tracked",
      /config\.toml is tracked by Git/,
    ],
  ];
  for (const [name, relativePath, kind, message] of cases) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const externalDirectory = path.join(
          fixture.temporaryRoot,
          "preserved-config",
        );
        const externalConfig = path.join(externalDirectory, "config.toml");
        await mkdir(externalDirectory);
        await writeFile(externalConfig, configContent);
        const target = path.join(fixture.projectRoot, relativePath);
        await rm(target, { recursive: true, force: true });
        await mkdir(path.dirname(target), { recursive: true });
        if (kind === "directory link")
          await symlink(externalDirectory, target, "dir");
        else if (kind === "file link") await symlink(externalConfig, target);
        else if (kind === "directory") await mkdir(target);
        else if (kind !== "missing") await writeFile(target, configContent);
        if (kind === "tracked")
          await git(fixture.projectRoot, "add", relativePath);
        await writeFile(
          path.join(fixture.projectRoot, "AGENTS.override.md"),
          oldOverrideContent,
        );
        const before = await snapshotManagedOutputs(fixture);
        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, message);
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
        assert.deepEqual(await readFile(externalConfig), configContent);
      });
    });
  }
});

test("config readability and destination writability failures leave all setup outputs untouched", async (t) => {
  for (const kind of [
    "unreadable source",
    "unreadable destination",
    "unwritable destination directory",
  ]) {
    await t.test(kind, async () => {
      await withFixture(async (fixture) => {
        const directory = path.join(fixture.projectRoot, ".codex");
        const config = path.join(directory, "config.toml");
        await mkdir(directory);
        if (kind === "unreadable destination")
          await writeFile(config, configContent);
        const target =
          kind === "unreadable source"
            ? path.join(fixture.workflowRoot, ".codex/config.toml")
            : kind === "unreadable destination"
              ? config
              : directory;
        await writeFile(
          path.join(fixture.projectRoot, "AGENTS.override.md"),
          oldOverrideContent,
        );
        const before = await snapshotManagedOutputs(fixture);
        let result;
        await chmod(
          target,
          kind === "unwritable destination directory" ? 0o555 : 0o000,
        );
        try {
          result = await invokeNode(fixture);
        } finally {
          await chmod(
            target,
            kind === "unwritable destination directory" ? 0o755 : 0o644,
          );
        }
        assert.notEqual(result.exitCode, 0);
        assert.match(
          result.stderr,
          kind === "unwritable destination directory"
            ? /write \.codex\/config\.toml during preflight/
            : /(?:required config source|EACCES)/,
        );
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
      });
    });
  }
});

// A leaf-only query misses tracked gitlink ancestors. Snapshot the entire
// disposable parent/submodule state to prove refusal precedes every write.
test("repository and tracked ancestors refuse setup before writes", async (t) => {
  const commit = (root) =>
    git(
      root,
      "-c",
      "user.name=Disposable Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "Fixture repository",
    );
  const snapshotTree = async (root) => {
    const entries = [];
    const visit = async (directory) => {
      for (const name of (await readdir(directory)).sort()) {
        if (name === ".ai") continue;
        const target = path.join(directory, name);
        const metadata = await lstat(target);
        entries.push([
          path.relative(root, target),
          metadata.mode,
          metadata.isSymbolicLink()
            ? await readlink(target)
            : metadata.isDirectory()
              ? "directory"
              : await readFile(target),
        ]);
        if (metadata.isDirectory()) await visit(target);
      }
    };
    await visit(root);
    return entries;
  };
  const cases = [
    ...[".agents", ".agents/skills"].flatMap((ancestor) =>
      [
        "initialized submodule",
        "uninitialized submodule",
        "nested repository",
        "parent gitdir alias",
        "bare repository",
        "misleading metadata directory",
        "parent metadata directory",
      ].map((kind) => ({ ancestor, kind })),
    ),
    { ancestor: ".AGENTS", kind: "index-only gitlink" },
    { ancestor: ".agents", kind: "deleted tracked file" },
    { ancestor: ".agents/skills", kind: "deleted tracked symlink" },
    { ancestor: ".CODEX", kind: "index-only gitlink" },
    { ancestor: ".codex", kind: "deleted tracked file" },
    { ancestor: ".codex", kind: "nested repository" },
    { ancestor: ".codex", kind: "parent gitdir alias" },
    { ancestor: ".codex", kind: "parent metadata directory" },
    { ancestor: ".", kind: "parent metadata root" },
    { ancestor: ".", kind: "linked worktree in common metadata" },
    {
      ancestor: ".agents/skills/custom-skill",
      kind: "allowed custom submodule",
    },
  ];
  for (const { ancestor, kind } of cases) {
    await t.test(`${ancestor}: ${kind}`, async () => {
      await withFixture(async (fixture) => {
        const snapshotRoot = fixture.projectRoot;
        const target = path.join(fixture.projectRoot, ancestor);
        await git(fixture.projectRoot, "config", "core.ignorecase", "false");
        if (kind === "linked worktree in common metadata") {
          await git(fixture.projectRoot, "add", "package.json");
          await commit(fixture.projectRoot);
          const worktreeRoot = path.join(
            fixture.projectRoot,
            ".git",
            "linked-worktree",
          );
          await git(
            fixture.projectRoot,
            "worktree",
            "add",
            "-q",
            "-b",
            "metadata-worktree",
            worktreeRoot,
          );
          Object.assign(fixture, {
            projectRoot: worktreeRoot,
            ...(await installWorkflow(worktreeRoot)),
          });
        } else if (kind === "parent metadata root") {
          const oldGitDirectory = path.join(
            fixture.temporaryRoot,
            "old-parent-gitdir",
          );
          await rename(path.join(fixture.projectRoot, ".git"), oldGitDirectory);
          for (const name of await readdir(oldGitDirectory))
            await rename(
              path.join(oldGitDirectory, name),
              path.join(fixture.projectRoot, name),
            );
          await git(
            fixture.projectRoot,
            "config",
            "core.worktree",
            await realpath(fixture.projectRoot),
          );
        } else if (kind === "parent metadata directory") {
          await mkdir(path.dirname(target), { recursive: true });
          await git(
            fixture.projectRoot,
            "init",
            "-q",
            "--separate-git-dir",
            target,
          );
        } else if (kind === "misleading metadata directory") {
          await mkdir(target, { recursive: true });
          await git(target, "init", "--bare", "-q");
          await git(target, "config", "core.bare", "false");
          await git(
            target,
            "config",
            "core.worktree",
            await realpath(fixture.projectRoot),
          );
          assert.equal(
            await git(target, "rev-parse", "--show-toplevel"),
            await realpath(fixture.projectRoot),
          );
          assert.notEqual(
            await git(target, "rev-parse", "--absolute-git-dir"),
            await git(fixture.projectRoot, "rev-parse", "--absolute-git-dir"),
          );
        } else if (kind === "parent gitdir alias") {
          await mkdir(target, { recursive: true });
          await git(
            fixture.projectRoot,
            "config",
            "core.worktree",
            await realpath(fixture.projectRoot),
          );
          await writeFile(
            path.join(target, ".git"),
            `gitdir: ${path.relative(target, path.join(fixture.projectRoot, ".git"))}\n`,
          );
          assert.equal(
            await git(target, "rev-parse", "--show-toplevel"),
            await realpath(fixture.projectRoot),
          );
        } else if (kind === "bare repository") {
          await mkdir(target, { recursive: true });
          await git(target, "init", "--bare", "-q");
        } else if (kind.startsWith("deleted tracked")) {
          await mkdir(path.dirname(target), { recursive: true });
          if (kind.endsWith("symlink")) await symlink("missing-target", target);
          else await writeFile(target, "# Tracked ancestor\n");
          await git(fixture.projectRoot, "add", "--", ancestor);
          await rm(target);
        } else {
          const source =
            kind === "nested repository"
              ? target
              : path.join(fixture.temporaryRoot, "module-source");
          await mkdir(source, { recursive: true });
          await git(source, "init", "-q");
          await writeFile(
            path.join(source, "guidance.md"),
            "# Preserve repository guidance\n",
          );
          await git(source, "add", "guidance.md");
          await commit(source);
          if (kind === "index-only gitlink") {
            await git(
              fixture.projectRoot,
              "update-index",
              "--add",
              "--cacheinfo",
              `160000,${await git(source, "rev-parse", "HEAD")},${ancestor}`,
            );
          } else if (kind !== "nested repository") {
            await git(
              fixture.projectRoot,
              "-c",
              "protocol.file.allow=always",
              "-c",
              "core.hooksPath=/dev/null",
              "submodule",
              "add",
              "-q",
              "--",
              source,
              ancestor,
            );
            await commit(fixture.projectRoot);
            if (kind === "uninitialized submodule")
              await git(
                fixture.projectRoot,
                "submodule",
                "deinit",
                "-f",
                "--",
                ancestor,
              );
          }
        }
        await writeFile(
          path.join(fixture.projectRoot, "AGENTS.override.md"),
          oldOverrideContent,
        );
        const before = await snapshotTree(snapshotRoot);
        const result = await invokeNode(fixture);
        if (kind === "allowed custom submodule") {
          assert.equal(result.exitCode, 0, result.stderr);
          // Setup may add local outputs, but must preserve the existing repo.
          const after = await snapshotTree(snapshotRoot);
          for (const [name, mode, value] of before) {
            if (name === "AGENTS.override.md" || name === ".git/info/exclude")
              continue;
            assert.deepEqual(
              after.find((entry) => entry[0] === name),
              [name, mode, value],
            );
          }
          await assertIgnored(fixture.projectRoot);
        } else {
          assert.notEqual(result.exitCode, 0, result.stdout);
          assert.match(
            result.stderr,
            /tracked by Git|different Git repository|repository boundary|verify repository ownership|Git metadata/,
          );
          assert.doesNotMatch(result.stderr, /Partial setup:/);
          assert.deepEqual(await snapshotTree(snapshotRoot), before);
        }
      });
    });
  }
});

// Existing untracked aliases bypass the index check. Real directory listings
// and unfiltered Git status are required to reproduce this filesystem boundary.
test("noncanonical output spellings refuse setup before writes", async (t) => {
  const cases = [
    ...skillNames.map((name) => ({
      path: `.agents/skills/${name.toUpperCase()}`,
      skill: name,
    })),
    { path: ".AGENTS/skills" },
    { path: ".agents/SKILLS" },
    { path: ".AGENTS/SKILLS" },
    { path: "agents.OVERRIDE.md", override: true },
    { path: ".CODEX" },
    { path: ".codex/CONFIG.TOML", config: true },
  ];
  for (const alias of cases) {
    await t.test(alias.path, async (t) => {
      await withFixture(async (fixture) => {
        // The production code needs no filesystem probe. Only the regression
        // requires a real filesystem that resolves differently cased lookups.
        try {
          await lstat(path.join(fixture.projectRoot, "PACKAGE.JSON"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          t.skip("requires a case-insensitive filesystem");
          return;
        }
        await git(fixture.projectRoot, "config", "core.ignorecase", "false");
        const target = path.join(fixture.projectRoot, alias.path);
        await mkdir(path.dirname(target), { recursive: true });
        if (alias.skill)
          await symlink(
            `../../.ai/.agents/skills/${alias.skill}`,
            target,
            "dir",
          );
        else if (alias.config) await writeFile(target, configContent);
        else if (!alias.override) await mkdir(target, { recursive: true });
        await writeFile(
          path.join(
            fixture.projectRoot,
            alias.override ? alias.path : "AGENTS.override.md",
          ),
          oldOverrideContent,
        );
        const custom = path.join(
          fixture.projectRoot,
          ".agents/skills/custom-skill/SKILL.md",
        );
        await mkdir(path.dirname(custom), { recursive: true });
        await writeFile(custom, "# Preserve custom skill\n");
        await git(
          fixture.projectRoot,
          "add",
          "--",
          ".agents/skills/custom-skill/SKILL.md",
        );
        const before = await snapshotManagedOutputs(fixture);
        const statusBefore = await git(
          fixture.projectRoot,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        );
        const indexPath = await git(
          fixture.projectRoot,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        );
        const indexBefore = await readFile(indexPath);
        const result = await invokeNode(fixture);
        const statusAfter = await git(
          fixture.projectRoot,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        );
        assert.notEqual(
          result.exitCode,
          0,
          `false success; actual Git status: ${JSON.stringify(statusAfter)}`,
        );
        assert.match(result.stderr, /noncanonical.*spelling|case alias/i);
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
        assert.equal(statusAfter, statusBefore);
        assert.deepEqual(await readFile(indexPath), indexBefore);
        assert.equal(
          await readFile(custom, "utf8"),
          "# Preserve custom skill\n",
        );
        if (alias.skill)
          assert.equal(
            await readlink(target),
            `../../.ai/.agents/skills/${alias.skill}`,
          );
      });
    });
  }
  await t.test(
    "canonical outputs stay ignored with core.ignorecase=false",
    async () => {
      await withFixture(async (fixture) => {
        await git(fixture.projectRoot, "config", "core.ignorecase", "false");
        for (let iteration = 0; iteration < 2; iteration++) {
          const result = await invokeNode(fixture);
          assert.equal(result.exitCode, 0, result.stderr);
          await assertIgnored(fixture.projectRoot);
        }
      });
    },
  );
});

// Literal pathspecs miss index entries that alias managed outputs on a
// case-insensitive filesystem. Exercise the public utility with real Git,
// including deleted tracked content; neither the index nor local setup may change.
test("tracked case aliases refuse setup before writes regardless of core.ignorecase", async (t) => {
  for (const name of skillNames) {
    for (const kind of ["existing link", "deleted content"]) {
      await t.test(`${name}: ${kind}`, async () => {
        await withFixture(async (fixture) => {
          await git(fixture.projectRoot, "config", "core.ignorecase", "false");
          const relativePath = `.agents/skills/${name.toUpperCase()}`;
          const target = path.join(fixture.projectRoot, relativePath);
          await mkdir(path.dirname(target), { recursive: true });
          if (kind === "existing link") {
            await symlink(`../../.ai/.agents/skills/${name}`, target, "dir");
          } else {
            await mkdir(target);
            await writeFile(path.join(target, "SKILL.md"), "# Tracked skill\n");
          }
          await git(fixture.projectRoot, "add", "--", relativePath);
          await git(
            fixture.projectRoot,
            "-c",
            "user.name=Disposable Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-qm",
            "Track case alias",
          );
          if (kind === "deleted content") await rm(target, { recursive: true });
          await writeFile(
            path.join(fixture.projectRoot, "AGENTS.override.md"),
            oldOverrideContent,
          );
          const before = await snapshotManagedOutputs(fixture);
          const indexPath = await git(
            fixture.projectRoot,
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "index",
          );
          const indexBefore = await readFile(indexPath);
          const result = await invokeNode(fixture);
          assert.notEqual(result.exitCode, 0, result.stdout);
          assert.match(result.stderr, /tracked by Git/);
          assert.doesNotMatch(result.stderr, /Partial setup:/);
          assert.deepEqual(await snapshotManagedOutputs(fixture), before);
          assert.deepEqual(await readFile(indexPath), indexBefore);
          if (kind === "existing link")
            assert.equal(
              await readlink(target),
              `../../.ai/.agents/skills/${name}`,
            );
        });
      });
    }
  }
  for (const relativePath of [
    "agents.OVERRIDE.md",
    ".AGENTS/SKILLS/ai-pr/SKILL.md",
    ".CODEX/CONFIG.TOML",
  ]) {
    await t.test(`deleted alias ${relativePath}`, async () => {
      await withFixture(async (fixture) => {
        const target = path.join(fixture.projectRoot, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, "# Tracked case alias\n");
        await git(fixture.projectRoot, "add", "--", relativePath);
        await rm(relativePath.includes("/") ? path.dirname(target) : target, {
          recursive: true,
        });
        const before = await snapshotManagedOutputs(fixture);
        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0, result.stdout);
        assert.match(result.stderr, /tracked by Git/);
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
      });
    });
  }
  await t.test(
    "a distinct tracked custom skill remains supported",
    async () => {
      await withFixture(async (fixture) => {
        const relativePath = ".agents/skills/AI-PR-helper/SKILL.md";
        const target = path.join(fixture.projectRoot, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, "# Custom skill\n");
        await git(fixture.projectRoot, "add", "--", relativePath);
        const indexBefore = await git(
          fixture.projectRoot,
          "ls-files",
          "--stage",
        );
        const result = await invokeNode(fixture);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(await readFile(target, "utf8"), "# Custom skill\n");
        assert.equal(
          await git(fixture.projectRoot, "ls-files", "--stage"),
          indexBefore,
        );
        await assertIgnored(fixture.projectRoot);
      });
    },
  );
});

test("higher-priority Git ignore negations refuse setup before any managed output changes", async (t) => {
  const cases = [
    [
      "root override negation",
      ".gitignore",
      "!/AGENTS.override.md\n",
      "AGENTS.override.md",
    ],
    [
      "root skill negation",
      ".gitignore",
      "!/.agents/skills/ai-pr\n",
      ".agents/skills/ai-pr",
    ],
    [
      "ancestor skill negation",
      ".agents/.gitignore",
      "!skills/ai-pr\n",
      ".agents/skills/ai-pr",
    ],
    [
      "nested skill negation",
      ".agents/skills/.gitignore",
      "!ai-pr\n",
      ".agents/skills/ai-pr",
    ],
    [
      "root config negation",
      ".gitignore",
      "!/.codex/config.toml\n",
      ".codex/config.toml",
    ],
    [
      "nested config negation",
      ".codex/.gitignore",
      "!config.toml\n",
      ".codex/config.toml",
    ],
  ];
  for (const [name, ignorePath, ignoreContent, managedPath] of cases) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const customPath = path.join(
          fixture.projectRoot,
          ".agents/skills/custom-skill/SKILL.md",
        );
        const customContent = "# Existing custom skill\n";
        await mkdir(path.dirname(customPath), { recursive: true });
        await writeFile(customPath, customContent);
        const ignoreTarget = path.join(fixture.projectRoot, ignorePath);
        await mkdir(path.dirname(ignoreTarget), { recursive: true });
        await writeFile(ignoreTarget, ignoreContent);
        await git(
          fixture.projectRoot,
          "add",
          ignorePath,
          ".agents/skills/custom-skill/SKILL.md",
        );
        await symlink(
          "../../.ai/.agents/skills/ai-build",
          path.join(fixture.projectRoot, ".agents/skills/ai-build"),
          "dir",
        );
        const override =
          name === "root override negation"
            ? `# Custom rules\n\n${routingBlock}\n`
            : oldOverrideContent;
        await writeFile(
          path.join(fixture.projectRoot, "AGENTS.override.md"),
          override,
        );
        const before = await snapshotManagedOutputs(fixture);
        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.ok(
          result.stderr.includes(
            `${managedPath} is re-included by ${ignorePath}:1`,
          ),
          result.stderr,
        );
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.doesNotMatch(result.stdout, /setup verified/i);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
        assert.equal(await readFile(ignoreTarget, "utf8"), ignoreContent);
        assert.equal(await readFile(customPath, "utf8"), customContent);
      });
    });
  }
});

test("relative global ignore sources remain overridable and preserve custom content", async (t) => {
  for (const [name, ignoreContent] of [
    ["source outside output ancestry", "!AGENTS.override.md\n"],
    [
      "ancestor source with globally rooted pattern",
      "!/.agents/skills/ai-pr\n",
    ],
  ]) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const customPath = path.join(
          fixture.projectRoot,
          ".agents/skills/custom-skill/SKILL.md",
        );
        await mkdir(path.dirname(customPath), { recursive: true });
        const customContent = "# Existing custom skill\r\n";
        await writeFile(customPath, customContent);
        const ignorePath = ".agents/.gitignore";
        const ignoreTarget = path.join(fixture.projectRoot, ignorePath);
        await writeFile(ignoreTarget, ignoreContent);
        await git(
          fixture.projectRoot,
          "config",
          "core.excludesFile",
          ignorePath,
        );
        const configPath = path.join(fixture.projectRoot, ".git/config");
        const configBefore = await readFile(configPath);
        const overridePath = path.join(
          fixture.projectRoot,
          "AGENTS.override.md",
        );
        const customOverride = `# Custom guidance\n\n${routingBlock}\n\nKeep these rules.\n`;
        await writeFile(overridePath, customOverride);
        await git(
          fixture.projectRoot,
          "add",
          ignorePath,
          ".agents/skills/custom-skill/SKILL.md",
        );
        const indexBefore = await git(
          fixture.projectRoot,
          "ls-files",
          "--stage",
        );
        const first = await invokeNode(fixture);
        assert.equal(first.exitCode, 0, first.stderr);
        const firstState = await readManagedState(fixture);
        const second = await invokeNode(fixture);
        assert.equal(second.exitCode, 0, second.stderr);
        assert.deepEqual(await readManagedState(fixture), firstState);
        assert.equal(await readFile(overridePath, "utf8"), customOverride);
        assert.equal(await readFile(customPath, "utf8"), customContent);
        assert.equal(await readFile(ignoreTarget, "utf8"), ignoreContent);
        assert.deepEqual(await readFile(configPath), configBefore);
        assert.equal(
          await git(fixture.projectRoot, "ls-files", "--stage"),
          indexBefore,
        );
        await assertIgnored(fixture.projectRoot);
      });
    });
  }
});

test("exact local excludes override lower-priority negations and preserve positive parent ignores", async (t) => {
  for (const kind of [
    "local negations",
    "local negations after exact rules",
    "global negations",
    "global positive parent ignore",
    "empty global configuration",
    "positive parent ignore",
    "parent-only negation",
    "directory-only negation",
  ]) {
    await t.test(kind, async () => {
      await withFixture(async (fixture) => {
        const excludePath = await excludePathFor(fixture.projectRoot);
        const negations =
          managedPaths.map((name) => `!/${name}`).join("\n") + "\n";
        let originalExclude = "# Existing local rules\n";
        if (kind.startsWith("local")) {
          if (kind === "local negations after exact rules")
            originalExclude += `${excludeRules.join("\n")}\n`;
          originalExclude += negations;
        }
        await writeFile(excludePath, originalExclude);
        let ignoreTarget;
        let ignoreContent;
        if (kind === "empty global configuration") {
          await git(fixture.projectRoot, "config", "core.excludesFile", "");
        }
        if (
          kind === "global negations" ||
          kind === "global positive parent ignore"
        ) {
          ignoreTarget = path.join(fixture.temporaryRoot, ".gitignore");
          ignoreContent =
            kind === "global negations" ? negations : "/.agents/\n";
          await writeFile(ignoreTarget, ignoreContent);
          await git(
            fixture.projectRoot,
            "config",
            "core.excludesFile",
            ignoreTarget,
          );
          if (kind === "global positive parent ignore") {
            await mkdir(path.join(fixture.projectRoot, ".agents/skills"), {
              recursive: true,
            });
            await writeFile(
              path.join(fixture.projectRoot, ".agents/skills/.gitignore"),
              "!ai-pr\n",
            );
          }
        } else if (kind === "positive parent ignore") {
          ignoreTarget = path.join(fixture.projectRoot, ".gitignore");
          ignoreContent = "/.agents/\n";
          await writeFile(ignoreTarget, ignoreContent);
          await mkdir(path.join(fixture.projectRoot, ".agents/skills"), {
            recursive: true,
          });
          await writeFile(
            path.join(fixture.projectRoot, ".agents/skills/.gitignore"),
            "!ai-pr\n",
          );
        } else if (kind === "parent-only negation") {
          ignoreTarget = path.join(fixture.projectRoot, ".gitignore");
          ignoreContent = "!/.agents/skills\n";
          await writeFile(ignoreTarget, ignoreContent);
        } else if (kind === "directory-only negation") {
          ignoreTarget = path.join(
            fixture.projectRoot,
            ".agents/skills/.gitignore",
          );
          ignoreContent = "!ai-pr/\n";
          await mkdir(path.dirname(ignoreTarget), { recursive: true });
          await writeFile(ignoreTarget, ignoreContent);
        }
        const first = await invokeNode(fixture);
        assert.equal(first.exitCode, 0, first.stderr);
        const firstState = await readManagedState(fixture);
        assert.equal(
          firstState.exclude,
          `${originalExclude}${excludeRules.join("\n")}\n`,
        );
        if (ignoreTarget)
          assert.equal(await readFile(ignoreTarget, "utf8"), ignoreContent);
        const second = await invokeNode(fixture);
        assert.equal(second.exitCode, 0, second.stderr);
        assert.deepEqual(await readManagedState(fixture), firstState);
        await assertIgnored(fixture.projectRoot);
      });
    });
  }
});

test("skill sources, destination ancestors, and conflicts all fail before any managed write", async (t) => {
  const cases = [
    ...skillNames.map((name) => ({
      name: `missing ${name} source`,
      prepare: async (fixture) =>
        rm(path.join(fixture.workflowRoot, ".agents/skills", name), {
          recursive: true,
        }),
    })),
    ...["missing", "empty", "directory"].map((kind) => ({
      name: `skill entry point is ${kind}`,
      prepare: async (fixture) => {
        const target = path.join(
          fixture.workflowRoot,
          ".agents/skills/ai-pr/SKILL.md",
        );
        await rm(target);
        if (kind === "empty") await writeFile(target, "");
        else if (kind === "directory") await mkdir(target);
      },
    })),
    ...[".agents", ".agents/skills"].flatMap((relativePath) =>
      ["file", "symlink"].map((kind) => ({
        name: `${relativePath} is a ${kind}`,
        prepare: async (fixture) => {
          const target = path.join(fixture.projectRoot, relativePath);
          await mkdir(path.dirname(target), { recursive: true });
          if (kind === "file") await writeFile(target, "custom ancestor\n");
          else await symlink(fixture.temporaryRoot, target, "dir");
        },
      })),
    ),
    ...[".agents", ".agents/skills", ".agents/skills/ai-pr"].map(
      (relativePath) => ({
        name: `source ${relativePath} escapes through a symlink`,
        prepare: async (fixture) => {
          const target = path.join(fixture.workflowRoot, relativePath);
          const external = path.join(fixture.temporaryRoot, "external-source");
          await rename(target, external);
          await symlink(external, target, "dir");
        },
      }),
    ),
    {
      name: "skill entry point escapes through a symlink",
      prepare: async (fixture) => {
        const target = path.join(
          fixture.workflowRoot,
          ".agents/skills/ai-pr/SKILL.md",
        );
        const external = path.join(fixture.temporaryRoot, "external-skill.md");
        await rename(target, external);
        await symlink(external, target);
      },
    },
    ...[
      "file",
      "directory",
      "dangling link",
      "wrong link",
      "absolute link",
    ].map((kind) => ({
      name: `managed skill is a ${kind}`,
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, ".agents/skills/ai-pr");
        await mkdir(path.dirname(target), { recursive: true });
        if (kind === "file") await writeFile(target, "custom skill\n");
        else if (kind === "directory") await mkdir(target);
        else
          await symlink(
            kind === "dangling link"
              ? "missing-skill"
              : kind === "wrong link"
                ? "../../.ai/.agents/skills/ai-build"
                : path.join(fixture.workflowRoot, ".agents/skills/ai-pr"),
            target,
            "dir",
          );
      },
    })),
    ...skillNames.map((name) => ({
      name: `tracked ${name} link`,
      prepare: async (fixture) => {
        const relativePath = `.agents/skills/${name}`;
        const target = path.join(fixture.projectRoot, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await symlink(`../../.ai/.agents/skills/${name}`, target, "dir");
        await git(fixture.projectRoot, "add", relativePath);
      },
    })),
    {
      name: "tracked managed content deleted from disk",
      prepare: async (fixture) => {
        const relativePath = ".agents/skills/ai-pr/SKILL.md";
        const target = path.join(fixture.projectRoot, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, "tracked custom skill\n");
        await git(fixture.projectRoot, "add", relativePath);
        await rm(path.dirname(target), { recursive: true });
      },
    },
    {
      name: "Git exclude is a symlink",
      prepare: async (fixture) => {
        const exclude = await excludePathFor(fixture.projectRoot);
        const external = path.join(fixture.temporaryRoot, "external-exclude");
        await rename(exclude, external);
        await symlink(external, exclude);
      },
    },
    {
      name: "Git info ancestor is a symlink",
      prepare: async (fixture) => {
        const info = path.dirname(await excludePathFor(fixture.projectRoot));
        const external = path.join(fixture.temporaryRoot, "external-info");
        await rename(info, external);
        await symlink(external, info, "dir");
      },
    },
  ];
  for (const targetCase of cases) {
    await t.test(targetCase.name, async () => {
      await withFixture(async (fixture) => {
        await targetCase.prepare(fixture);
        await writeFile(
          path.join(fixture.projectRoot, "AGENTS.override.md"),
          oldOverrideContent,
        );
        const before = await snapshotManagedOutputs(fixture);
        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.doesNotMatch(result.stdout, /setup verified/i);
        assert.doesNotMatch(result.stderr, /Partial setup:/);
        assert.deepEqual(await snapshotManagedOutputs(fixture), before);
      });
    });
  }
});

test("local skill links preserve custom skills, instructions, excludes, and their Git visibility", async () => {
  await withFixture(async (fixture) => {
    const customRoot = path.join(
      fixture.projectRoot,
      ".agents/skills/custom-skill",
    );
    await mkdir(customRoot, { recursive: true });
    const customPath = path.join(customRoot, "SKILL.md");
    const customContent = "# Existing custom skill\r\n";
    await writeFile(customPath, customContent);
    const customStat = await stat(customPath);
    const override = `# Team rules\n\n${routingBlock}\n\nKeep these rules.\n`;
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.override.md"),
      override,
    );
    const excludePath = await excludePathFor(fixture.projectRoot);
    await writeFile(excludePath, "/custom-cache\n");
    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstState = await readManagedState(fixture);
    const linkStats = await Promise.all(
      skillNames.map((name) =>
        lstat(path.join(fixture.projectRoot, ".agents/skills", name)),
      ),
    );
    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(await readManagedState(fixture), firstState);
    assert.equal(firstState.override, override);
    assert.equal(
      firstState.exclude,
      `/custom-cache\n${excludeRules.join("\n")}\n`,
    );
    assert.equal(await readFile(customPath, "utf8"), customContent);
    assert.equal((await stat(customPath)).mtimeMs, customStat.mtimeMs);
    for (let index = 0; index < skillNames.length; index += 1) {
      assert.equal(
        (
          await lstat(
            path.join(fixture.projectRoot, ".agents/skills", skillNames[index]),
          )
        ).mtimeMs,
        linkStats[index].mtimeMs,
      );
    }
    assert.equal(
      (
        await run(
          "git",
          ["check-ignore", "-q", "--", ".agents/skills/custom-skill/SKILL.md"],
          { cwd: fixture.projectRoot },
        )
      ).exitCode,
      1,
    );
    await assertIgnored(fixture.projectRoot);
  });
});

test("project-root package command produces the same result", async () => {
  await withFixture(async (fixture) => {
    const result = await invokePnpm(
      fixture,
      ["--dir", ".ai", "setup:codex"],
      fixture.projectRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
    await assertIgnored(fixture.projectRoot);
  });
});

test("utility location, not caller directory, selects the target project", async () => {
  await withFixture(async (fixture) => {
    const unrelatedDirectory = await mkdtemp(
      path.join(os.tmpdir(), "agents-override-caller-"),
    );
    try {
      const result = await invokeNode(fixture, { cwd: unrelatedDirectory });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await readManagedState(fixture)).override, overrideContent);
      await assert.rejects(
        readFile(path.join(unrelatedDirectory, "AGENTS.override.md"), "utf8"),
      );

      const projectSubdirectory = path.join(
        fixture.projectRoot,
        "packages/example",
      );
      await mkdir(projectSubdirectory, { recursive: true });
      const repeated = await invokeNode(fixture, { cwd: projectSubdirectory });
      assert.equal(repeated.exitCode, 0, repeated.stderr);
      assert.match(repeated.stdout, /already correct/);
    } finally {
      await rm(unrelatedDirectory, { force: true, recursive: true });
    }
  });
});

test("repeated setup is byte-idempotent and preserves an unterminated exclude line", async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const originalExclude = "# repository-local excludes\n/custom-cache";
    await writeFile(excludePath, originalExclude);

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstState = await readManagedState(fixture);
    assert.equal(
      firstState.exclude,
      `${originalExclude}\n${excludeRules.join("\n")}\n`,
    );
    const overrideStat = await stat(firstState.overridePath);
    const excludeStat = await stat(firstState.excludePath);

    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /AGENTS\.override\.md: already correct/);
    assert.match(second.stdout, /exclude rule: already present/);
    const secondState = await readManagedState(fixture);
    assert.deepEqual(secondState, firstState);
    assert.equal(
      (await stat(secondState.overridePath)).mtimeMs,
      overrideStat.mtimeMs,
    );
    assert.equal(
      (await stat(secondState.excludePath)).mtimeMs,
      excludeStat.mtimeMs,
    );
  });
});

test("one or more existing exact exclude rules are preserved without another duplicate", async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
    const excludePath = await excludePathFor(fixture.projectRoot);
    const duplicateExclude = `/first\n${excludeRules.join("\n")}\n/middle\n${excludeRule}\n/last`;
    await writeFile(overridePath, overrideContent);
    await writeFile(excludePath, duplicateExclude);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(excludePath, "utf8"), duplicateExclude);
    assert.equal(await readFile(overridePath, "utf8"), overrideContent);
  });
});

test("a CRLF-terminated exact exclude rule is preserved byte-for-byte", async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
    const excludePath = await excludePathFor(fixture.projectRoot);
    const crlfExclude = `/first\r\n${excludeRules.join("\r\n")}\r\n/last\r\n`;
    await writeFile(overridePath, overrideContent);
    await writeFile(excludePath, crlfExclude);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /exclude rule: already present/);
    assert.equal(await readFile(excludePath, "utf8"), crlfExclude);
  });
});

test("Git environment overrides cannot redirect repository metadata", async () => {
  await withFixture(async (fixture) => {
    const foreignRoot = path.join(fixture.temporaryRoot, "foreign");
    await mkdir(foreignRoot);
    await git(foreignRoot, "init", "-q");
    const foreignExcludePath = await excludePathFor(foreignRoot);
    const foreignExcludeBefore = await readFile(foreignExcludePath, "utf8");

    const result = await invokeNode(fixture, {
      env: {
        GIT_DIR: path.join(foreignRoot, ".git"),
        GIT_INDEX_FILE: path.join(foreignRoot, ".git/index"),
        GIT_WORK_TREE: fixture.projectRoot,
      },
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
    assert.equal(
      await readFile(foreignExcludePath, "utf8"),
      foreignExcludeBefore,
    );
    await assertIgnored(fixture.projectRoot);
  });
});

test("a missing resolved exclude file is created at the Git-provided path", async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    await rm(excludePath);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      await readFile(excludePath, "utf8"),
      `${excludeRules.join("\n")}\n`,
    );
    await assertIgnored(fixture.projectRoot);
  });
});

test("workflow prerequisite failures happen before either managed target changes", async (t) => {
  const cases = [
    ["missing AGENTS.md", "AGENTS.md", null],
    ["empty AGENTS.md", "AGENTS.md", ""],
    ["non-file AGENTS.md", "AGENTS.md", "directory"],
    ["missing instruction index", "instructions/index.md", null],
    ["empty instruction index", "instructions/index.md", ""],
    ["non-file instruction index", "instructions/index.md", "directory"],
  ];

  for (const [name, relativePath, replacement] of cases) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const target = path.join(fixture.workflowRoot, relativePath);
        if (replacement === null) {
          await rm(target);
        } else if (replacement === "directory") {
          await rm(target);
          await mkdir(target);
        } else {
          await writeFile(target, replacement);
        }
        const excludePath = await excludePathFor(fixture.projectRoot);
        const excludeBefore = await readFile(excludePath, "utf8");

        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /required workflow file/i);
        assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
        await assert.rejects(
          readFile(path.join(fixture.projectRoot, "AGENTS.override.md")),
        );
      });
    });
  }
});

test("a utility installed outside a direct .ai directory is rejected", async () => {
  await withFixture(async (fixture) => {
    const misplacedRoot = path.join(fixture.projectRoot, "workflow");
    await rename(fixture.workflowRoot, misplacedRoot);
    const misplacedFixture = {
      ...fixture,
      utilityPath: path.join(
        misplacedRoot,
        "scripts/setup/agents-override.mjs",
      ),
      workflowRoot: misplacedRoot,
    };
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");

    const result = await invokeNode(misplacedFixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /not installed under a direct \.ai directory/i);
    assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    await assert.rejects(
      readFile(path.join(fixture.projectRoot, "AGENTS.override.md")),
    );
  });
});

test("invoking setup through another project's linked .ai does not mutate either project", async () => {
  await withFixture(async (fixture) => {
    const callerRoot = path.join(fixture.temporaryRoot, "caller-project");
    await mkdir(callerRoot);
    await git(callerRoot, "init", "-q");
    await symlink(fixture.workflowRoot, path.join(callerRoot, ".ai"), "dir");
    const before = await snapshotManagedOutputs(fixture);
    const callerExclude = await excludePathFor(callerRoot);
    const callerExcludeBefore = await readFile(callerExclude, "utf8");
    const result = await invokeNode({
      ...fixture,
      utilityPath: path.join(
        callerRoot,
        ".ai/scripts/setup/agents-override.mjs",
      ),
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(
      result.stderr,
      /invoked \.ai directory must be a real directory/i,
    );
    assert.deepEqual(await snapshotManagedOutputs(fixture), before);
    assert.equal(await readFile(callerExclude, "utf8"), callerExcludeBefore);
    await assert.rejects(lstat(path.join(callerRoot, "AGENTS.override.md")));
    await assert.rejects(lstat(path.join(callerRoot, ".agents")));
  });
});

test("unexpected link write failure reports completed and possibly incomplete outputs and can recover", async () => {
  await withFixture(async (fixture) => {
    const preload = `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.symlink;
fs.symlink = (...args) => {
  if (args[1].endsWith('/ai-commit')) throw new Error('fixture link write failure');
  return original(...args);
};
syncBuiltinESMExports();`;
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");
    const failed = await invokeNode(fixture, {
      env: {
        NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      },
    });
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, /fixture link write failure/);
    assert.match(
      failed.stderr,
      /Partial setup: completed writes: AGENTS\.override\.md, \.agents, \.agents\/skills, \.agents\/skills\/ai-build, \.agents\/skills\/ai-worktree-setup\./,
    );
    assert.match(
      failed.stderr,
      /Failed write may be incomplete: \.agents\/skills\/ai-commit/,
    );
    assert.doesNotMatch(failed.stdout, /setup verified/i);
    assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    const recovered = await invokeNode(fixture);
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.match(
      recovered.stdout,
      /\.agents\/skills\/ai-build: already correct/,
    );
    assert.match(recovered.stdout, /\.agents\/skills\/ai-commit: created/);
    await assertIgnored(fixture.projectRoot);
  });
});

test("unexpected config write failure reports its partial output and can recover", async () => {
  await withFixture(async (fixture) => {
    const preload = `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFile;
fs.writeFile = (...args) => {
  if (args[0].endsWith('/.codex/config.toml')) throw new Error('fixture config write failure');
  return original(...args);
};
syncBuiltinESMExports();`;
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath);
    const failed = await invokeNode(fixture, {
      env: {
        NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      },
    });
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, /fixture config write failure/);
    assert.match(failed.stderr, /Partial setup: completed writes: .*\.codex\./);
    assert.match(
      failed.stderr,
      /Failed write may be incomplete: \.codex\/config\.toml/,
    );
    assert.doesNotMatch(failed.stdout, /setup verified/i);
    assert.deepEqual(await readFile(excludePath), excludeBefore);
    assert.equal(
      (await lstat(path.join(fixture.projectRoot, ".codex"))).isDirectory(),
      true,
    );
    await assert.rejects(
      lstat(path.join(fixture.projectRoot, ".codex/config.toml")),
    );
    const recovered = await invokeNode(fixture);
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.deepEqual((await readManagedState(fixture)).config, configContent);
    await assertIgnored(fixture.projectRoot);
  });
});

test("an unreadable resolved exclude target fails before creating the override", async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    await rm(excludePath);
    await mkdir(excludePath);

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /could not read repository-local Git exclude/i);
    await assert.rejects(
      readFile(path.join(fixture.projectRoot, "AGENTS.override.md")),
    );
  });
});

test("a direct parent below the Git root is rejected without mutation", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agents-override-parent-"),
  );
  try {
    const repository = path.join(temporaryRoot, "repository");
    const projectRoot = path.join(repository, "nested-project");
    await mkdir(projectRoot, { recursive: true });
    await git(repository, "init", "-q");
    const workflow = await installWorkflow(projectRoot);
    const fixture = { ...workflow, projectRoot, temporaryRoot };
    const excludePath = await excludePathFor(projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /direct parent is not the Git worktree root/i);
    assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    await assert.rejects(
      readFile(path.join(projectRoot, "AGENTS.override.md")),
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("a non-repository direct parent is rejected before mutation", async () => {
  await withFixture(
    async (fixture) => {
      const result = await invokeNode(fixture);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Git worktree root/i);
      await assert.rejects(
        readFile(path.join(fixture.projectRoot, "AGENTS.override.md")),
      );
    },
    { initializeParent: false },
  );
});

test("tracked, different, symbolic-link, and non-regular targets are preserved", async (t) => {
  const cases = [
    {
      name: "tracked file",
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, "AGENTS.override.md");
        await writeFile(target, overrideContent);
        await git(fixture.projectRoot, "add", "AGENTS.override.md");
        return { kind: "file", target, value: overrideContent };
      },
      message: /tracked by Git/i,
    },
    {
      name: "different regular file",
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, "AGENTS.override.md");
        const value = "# Personal instructions\n";
        await writeFile(target, value);
        return { kind: "file", target, value };
      },
      message: /routing block.*preserved/is,
    },
    {
      name: "symbolic link",
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, "AGENTS.override.md");
        const linkTarget = "personal-agents.md";
        await writeFile(
          path.join(fixture.projectRoot, linkTarget),
          "# Personal instructions\n",
        );
        await symlink(linkTarget, target);
        return { kind: "symlink", target, value: linkTarget };
      },
      message: /symbolic link/i,
    },
    {
      name: "directory",
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, "AGENTS.override.md");
        await mkdir(target);
        return { kind: "directory", target };
      },
      message: /not a regular file/i,
    },
  ];

  for (const targetCase of cases) {
    await t.test(targetCase.name, async () => {
      await withFixture(async (fixture) => {
        const targetState = await targetCase.prepare(fixture);
        const excludePath = await excludePathFor(fixture.projectRoot);
        const excludeBefore = await readFile(excludePath, "utf8");
        const result = await invokeNode(fixture);

        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, targetCase.message);
        assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
        if (targetState.kind === "file") {
          assert.equal(
            await readFile(targetState.target, "utf8"),
            targetState.value,
          );
        } else if (targetState.kind === "symlink") {
          assert.equal(await readlink(targetState.target), targetState.value);
        } else {
          assert.equal((await lstat(targetState.target)).isDirectory(), true);
        }
      });
    });
  }
});

test("override permission failure is rejected by preflight without writes", async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");
    await chmod(fixture.projectRoot, 0o555);
    try {
      const result = await invokeNode(fixture);
      assert.notEqual(result.exitCode, 0);
      assert.match(
        result.stderr,
        /write AGENTS\.override\.md during preflight/i,
      );
      assert.doesNotMatch(result.stdout, /setup verified/i);
      assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    } finally {
      await chmod(fixture.projectRoot, 0o755);
    }
  });
});

test("skill destination permission failure prevents the override upgrade and every other write", async () => {
  await withFixture(async (fixture) => {
    const directory = path.join(fixture.projectRoot, ".agents/skills");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.override.md"),
      oldOverrideContent,
    );
    const before = await snapshotManagedOutputs(fixture);
    await chmod(directory, 0o555);
    try {
      const result = await invokeNode(fixture);
      assert.notEqual(result.exitCode, 0);
      assert.match(
        result.stderr,
        /write \.agents\/skills\/ai-build during preflight/,
      );
      assert.deepEqual(await snapshotManagedOutputs(fixture), before);
      assert.doesNotMatch(result.stderr, /Partial setup:/);
    } finally {
      await chmod(directory, 0o755);
    }
  });
});

test("exclude permission failure leaves every output untouched and is recoverable", async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");
    await chmod(excludePath, 0o444);
    try {
      const failed = await invokeNode(fixture);
      assert.notEqual(failed.exitCode, 0);
      assert.match(
        failed.stderr,
        /write repository-local Git exclude during preflight/i,
      );
      assert.doesNotMatch(failed.stdout, /setup verified/i);
      assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
      await assert.rejects(
        lstat(path.join(fixture.projectRoot, "AGENTS.override.md")),
      );
      await assert.rejects(lstat(path.join(fixture.projectRoot, ".agents")));
    } finally {
      await chmod(excludePath, 0o644);
    }

    const recovered = await invokeNode(fixture);
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.match(recovered.stdout, /AGENTS\.override\.md: created/);
    await assertIgnored(fixture.projectRoot);
  });
});

test("failed ignored-status verification is reported after writes without false success", async () => {
  await withFixture(async (fixture) => {
    const wrapperDirectory = path.join(fixture.temporaryRoot, "bin");
    const wrapperPath = path.join(wrapperDirectory, "git");
    await mkdir(wrapperDirectory);
    await writeFile(
      wrapperPath,
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('check-ignore') && args.includes('-q')) process.exit(1);
const result = spawnSync('git', args, {
  env: { ...process.env, PATH: process.env.ORIGINAL_PATH },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
`,
    );
    await chmod(wrapperPath, 0o755);

    const result = await invokeNode(fixture, {
      env: {
        ORIGINAL_PATH: process.env.PATH,
        PATH: `${wrapperDirectory}${path.delimiter}${process.env.PATH}`,
      },
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /verify that AGENTS\.override\.md is ignored/i);
    assert.match(
      result.stderr,
      /Partial setup: completed writes: AGENTS\.override\.md, \.agents, \.agents\/skills/,
    );
    assert.match(result.stderr, /\.codex, \.codex\/config\.toml/);
    assert.doesNotMatch(result.stdout, /setup verified/i);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
  });
});

test("linked worktrees use Git-resolved exclude metadata and remain idempotent", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agents-override-worktree-"),
  );
  try {
    const mainRoot = path.join(temporaryRoot, "main");
    const projectRoot = path.join(temporaryRoot, "linked");
    await mkdir(mainRoot);
    await git(mainRoot, "init", "-q");
    await git(mainRoot, "config", "user.email", "fixture@example.com");
    await git(mainRoot, "config", "user.name", "Fixture");
    await writeFile(path.join(mainRoot, "seed.txt"), "seed\n");
    await git(mainRoot, "add", "seed.txt");
    await git(mainRoot, "commit", "-qm", "fixture seed");
    await git(
      mainRoot,
      "worktree",
      "add",
      "-q",
      "--detach",
      projectRoot,
      "HEAD",
    );
    const workflow = await installWorkflow(projectRoot);
    const fixture = { ...workflow, projectRoot, temporaryRoot };
    const excludePath = await excludePathFor(projectRoot);
    const canonicalMainRoot = await realpath(mainRoot);
    const rootPath = path.join(projectRoot, "AGENTS.md");
    const rootContent = "# Linked-worktree root instructions\n";
    await writeFile(rootPath, rootContent);
    assert.equal(
      excludePath.startsWith(path.join(canonicalMainRoot, ".git")),
      true,
    );

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstState = await readManagedState(fixture);
    assert.equal(firstState.override, overrideContent);
    assert.deepEqual(firstState.config, configContent);
    const second = await invokeNode(fixture, { cwd: mainRoot });
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(await readManagedState(fixture), firstState);
    const custom = `# Linked-worktree custom instructions\n\n${routingBlock}\n\nKeep linked rules.\n`;
    await writeFile(firstState.overridePath, custom);
    const third = await invokeNode(fixture);
    assert.equal(third.exitCode, 0, third.stderr);
    assert.equal(await readFile(firstState.overridePath, "utf8"), custom);
    assert.equal(await readFile(rootPath, "utf8"), rootContent);
    await assertIgnored(projectRoot);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("all legacy Codex conflicts are reported before managed targets change", async () => {
  await withFixture(async (fixture) => {
    const preservedFiles = new Map([
      ["AGENTS.md", "# Shared root instructions\n"],
      [".codex/AGENTS.md", "# Legacy Codex instructions\n"],
      [
        ".codex/config.toml",
        'project_doc_fallback_filenames = [".codex/AGENTS.md", "TEAM.md"]\n',
      ],
      [".codex/hooks.json", '{"hooks":{"Stop":["manual_token_stop.py"]}}\n'],
      [".codex/hooks/manual_token_stop.py", "# legacy hook\n"],
      [".codex/hooks/__pycache__/manual_token_stop.pyc", "cache\n"],
      [".codex/state/manual-token-hook.json", "{}\n"],
    ]);
    for (const [relativePath, content] of preservedFiles) {
      const target = path.join(fixture.projectRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stderr, /parent-root AGENTS\.md exists/);
    assert.match(result.stderr, /\.codex\/AGENTS\.md exists/);
    assert.match(result.stderr, /fallback references \.codex\/AGENTS\.md/);
    assert.match(result.stderr, /hooks\.json configures manual-token hooks/);
    assert.match(result.stderr, /hooks\/manual_token_stop\.py/);
    assert.match(result.stderr, /__pycache__\/manual_token_stop\.pyc/);
    assert.match(result.stderr, /state\/manual-token-hook\.json/);
    for (const [relativePath, content] of preservedFiles) {
      assert.equal(
        await readFile(path.join(fixture.projectRoot, relativePath), "utf8"),
        content,
      );
    }
    assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    await assert.rejects(
      readFile(path.join(fixture.projectRoot, "AGENTS.override.md")),
    );
  });
});

test("a later-added root instruction is reachable without rewriting the override", async () => {
  await withFixture(async (fixture) => {
    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, "utf8");
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.md"),
      "# Later root instructions\n",
    );

    const second = await invokeNode(fixture);

    assert.equal(second.exitCode, 0, second.stderr);
    assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    assert.equal(
      await readFile(
        path.join(fixture.projectRoot, "AGENTS.override.md"),
        "utf8",
      ),
      overrideContent,
    );
    assert.equal(
      await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"),
      "# Later root instructions\n",
    );
  });
});

test("existing tracked root guidance is preserved and explicitly routed before workflow guidance", async () => {
  await withFixture(async (fixture) => {
    const rootPath = path.join(fixture.projectRoot, "AGENTS.md");
    const rootContent = Buffer.from(
      "# Root instructions\r\n\r\nKeep existing rules.\r\n",
    );
    await writeFile(rootPath, rootContent);
    await git(fixture.projectRoot, "add", "AGENTS.md");
    const indexBefore = await git(fixture.projectRoot, "ls-files", "--stage");

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    assert.deepEqual(await readFile(rootPath), rootContent);
    assert.equal(
      await git(fixture.projectRoot, "ls-files", "--stage"),
      indexBefore,
    );
    assert.equal((await readManagedState(fixture)).override, overrideContent);
    assert.equal(overrideContent.includes(routingBlock), true);
    await assertIgnored(fixture.projectRoot);
  });
});

test("only the exact previous generated template is upgraded", async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
    await writeFile(overridePath, oldOverrideContent);
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.md"),
      "# Root rules\n",
    );

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    assert.match(first.stdout, /upgraded previous generated template/);
    assert.equal(await readFile(overridePath, "utf8"), overrideContent);
    const firstState = await readManagedState(fixture);
    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(await readManagedState(fixture), firstState);
  });
});

test("a custom override with the exact active routing block is preserved byte-for-byte", async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
    const custom = Buffer.from(
      `# Custom team rules\r\n\r\n${routingBlock.replaceAll("\n", "\r\n")}\r\n\r\nKeep the team's café naming.\r\n`,
    );
    await writeFile(overridePath, custom);
    await writeFile(
      path.join(fixture.projectRoot, "AGENTS.md"),
      "# Root rules\n",
    );
    const metadataBefore = await stat(overridePath);

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    assert.match(first.stdout, /custom routing preserved/);
    assert.deepEqual(await readFile(overridePath), custom);
    assert.equal((await stat(overridePath)).mtimeMs, metadataBefore.mtimeMs);
    const firstState = await readManagedState(fixture);
    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(await readManagedState(fixture), firstState);
    await assertIgnored(fixture.projectRoot);
  });
});

test("ambiguous custom overrides fail before either managed target changes", async (t) => {
  const cases = [
    [
      "old template plus custom text",
      `${oldOverrideContent}\nKeep my rules.\n`,
    ],
    [
      "missing root routing",
      routingBlock.replace(
        "Read and follow `AGENTS.md` first when it exists in this workspace root.\n",
        "",
      ),
    ],
    ["duplicate routing block", `${routingBlock}\n${routingBlock}\n`],
    ["routing example in fenced code", `\`\`\`md\n${routingBlock}\n\`\`\`\n`],
    [
      "routing example in an HTML comment",
      `<!-- example\n${routingBlock}\n-->\n`,
    ],
  ];
  for (const [name, content] of cases) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const overridePath = path.join(
          fixture.projectRoot,
          "AGENTS.override.md",
        );
        await writeFile(overridePath, content);
        const excludePath = await excludePathFor(fixture.projectRoot);
        const excludeBefore = await readFile(excludePath);
        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /routing block.*preserved/is);
        assert.deepEqual(await readFile(overridePath), Buffer.from(content));
        assert.deepEqual(await readFile(excludePath), excludeBefore);
      });
    });
  }
});

test("unsafe root instruction entries fail before managed writes or an old-template upgrade", async (t) => {
  for (const kind of ["directory", "symbolic link", "unreadable file"]) {
    await t.test(kind, async () => {
      await withFixture(async (fixture) => {
        const rootPath = path.join(fixture.projectRoot, "AGENTS.md");
        if (kind === "directory") await mkdir(rootPath);
        else if (kind === "symbolic link")
          await symlink(".ai/AGENTS.md", rootPath);
        else {
          await writeFile(rootPath, "# Root rules\n");
          await chmod(rootPath, 0o000);
        }
        try {
          const overridePath = path.join(
            fixture.projectRoot,
            "AGENTS.override.md",
          );
          await writeFile(overridePath, oldOverrideContent);
          const excludePath = await excludePathFor(fixture.projectRoot);
          const excludeBefore = await readFile(excludePath);
          const result = await invokeNode(fixture);
          assert.notEqual(result.exitCode, 0);
          assert.match(
            result.stderr,
            /(?:root AGENTS\.md|read parent-root AGENTS\.md)/,
          );
          assert.equal(
            await readFile(overridePath, "utf8"),
            oldOverrideContent,
          );
          assert.deepEqual(await readFile(excludePath), excludeBefore);
        } finally {
          if (kind === "unreadable file") await chmod(rootPath, 0o644);
        }
      });
    });
  }
});

test("exclude preflight failure leaves the exact old generated template unchanged", async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, "AGENTS.override.md");
    await writeFile(overridePath, oldOverrideContent);
    const excludePath = await excludePathFor(fixture.projectRoot);
    await rm(excludePath);
    await mkdir(excludePath);
    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /could not read repository-local Git exclude/i);
    assert.equal(await readFile(overridePath, "utf8"), oldOverrideContent);
    assert.equal((await lstat(excludePath)).isDirectory(), true);
  });
});

test("custom fallback configuration refuses setup while unrelated hooks remain preserved", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, ".codex"), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, ".codex/config.toml"),
      'project_doc_fallback_filenames = ["TEAM.md"]\n',
    );
    await writeFile(
      path.join(fixture.projectRoot, ".codex/hooks.json"),
      '{"hooks":{"Stop":["unrelated.py"]}}\n',
    );

    const before = await snapshotManagedOutputs(fixture);
    const result = await invokeNode(fixture);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /config\.toml differs/);
    assert.doesNotMatch(result.stderr, /legacy Codex conflicts/);
    assert.deepEqual(await snapshotManagedOutputs(fixture), before);
    assert.equal(
      await readFile(
        path.join(fixture.projectRoot, ".codex/hooks.json"),
        "utf8",
      ),
      '{"hooks":{"Stop":["unrelated.py"]}}\n',
    );
    assert.equal(
      await readFile(
        path.join(fixture.projectRoot, ".codex/config.toml"),
        "utf8",
      ),
      'project_doc_fallback_filenames = ["TEAM.md"]\n',
    );
  });
});

test("commented and unrelated later fallback arrays produce only the custom-config conflict", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, ".codex"), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, ".codex/config.toml"),
      [
        '# project_doc_fallback_filenames = [".codex/AGENTS.md"]',
        'project_doc_fallback_filenames = ["TEAM.md"]',
        'unrelated_paths = [".codex/AGENTS.md"]',
        "",
      ].join("\n"),
    );

    const before = await snapshotManagedOutputs(fixture);
    const result = await invokeNode(fixture);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /config\.toml differs/);
    assert.doesNotMatch(
      result.stderr,
      /fallback references \.codex\/AGENTS\.md/,
    );
    assert.deepEqual(await snapshotManagedOutputs(fixture), before);
  });
});

test("comments inside a fallback array are ignored while quoted brackets preserve legacy detection", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, ".codex"), { recursive: true });
    const configPath = path.join(fixture.projectRoot, ".codex/config.toml");
    await writeFile(
      configPath,
      'project_doc_fallback_filenames = ["TEAM.md", # ".codex/AGENTS.md"\n"OTHER.md"]\n',
    );
    const commented = await invokeNode(fixture);
    assert.notEqual(commented.exitCode, 0);
    assert.match(commented.stderr, /config\.toml differs/);
    assert.doesNotMatch(
      commented.stderr,
      /fallback references \.codex\/AGENTS\.md/,
    );

    await writeFile(
      configPath,
      'project_doc_fallback_filenames = ["literal].md", ".codex/AGENTS.md"]\n',
    );
    const legacy = await invokeNode(fixture);
    assert.notEqual(legacy.exitCode, 0);
    assert.match(legacy.stderr, /fallback references \.codex\/AGENTS\.md/);
  });
});

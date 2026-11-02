import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Risk: a whole-tree mirror leaks local data and shares Git administration.
// Existing guidance assertions cannot prove copy behavior. This disposable Git
// integration fixture executes the skill's canonical copy block, without a production
// copier or mutations to the consuming workspace.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const procedure = await readFile(
  path.join(
    root,
    ".agents/skills/ai-worktree-setup/references/context-copy.md",
  ),
  "utf8",
);
const copyCommands = procedure.match(
  /<!-- context-copy:start -->\s*```bash\n([\s\S]*?)\n```\s*<!-- context-copy:end -->/,
)?.[1];
assert.ok(copyCommands, "the documented copy operations must be executable");

const managedSkills = ["ai-build", "ai-worktree-setup", "ai-commit", "ai-pr"];

const run = (cwd, ...args) =>
  execFileSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
const git = (cwd, ...args) => run(cwd, "git", ...args).trim();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const exists = async (target) =>
  lstat(target).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
const put = async (base, relative, value) => {
  await mkdir(path.dirname(path.join(base, relative)), { recursive: true });
  await writeFile(path.join(base, relative), value);
};
const init = async (directory) => {
  await mkdir(directory, { recursive: true });
  git(directory, "init", "-b", "main");
  git(directory, "config", "user.email", "fixture@example.invalid");
  git(directory, "config", "user.name", "Disposable Fixture");
};

async function fixture(t, count) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "worktree-context-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  // CI need not install RTK. Its output filtering is outside this copy test;
  // execute the documented commands through a fixture-only passthrough.
  await put(
    workspace,
    ".fixture-bin/rtk",
    '#!/bin/sh\nif [ "$1" = proxy ]; then shift; fi\nexec "$@"\n',
  );
  await chmod(path.join(workspace, ".fixture-bin/rtk"), 0o755);
  const sources =
    count === 1
      ? [workspace]
      : ["app", "api"].map((id) => path.join(workspace, id));
  for (const source of sources) {
    await init(source);
    await put(source, ".gitignore", ".ai/\n.worktrees/\nAGENTS.override.md\n");
    await put(source, "app.txt", "application baseline\n");
    if (count === 1) {
      await put(source, "AGENTS.md", "Existing root guidance.\n");
      await put(source, ".agents/README.md", "Keep custom agent guidance.\n");
      await put(
        source,
        ".agents/skills/custom/SKILL.md",
        "Keep custom skill.\n",
      );
    }
    git(source, "add", ".");
    git(source, "commit", "-m", "fixture baseline");
    await put(source, "unrelated.txt", "preserve unrelated untracked work\n");
  }
  await put(workspace, "AGENTS.md", "Existing root guidance.\n");
  // Git does not record read/write permission bits. A native checkout of this
  // identical tracked file has mode 0644, so context copy must preserve 0600.
  await chmod(path.join(workspace, "AGENTS.md"), 0o600);
  await put(
    workspace,
    "AGENTS.override.md",
    "<!-- ai-workflow-routing:start -->\n\nRead and follow `AGENTS.md` first when it exists in this workspace root.\nThen read and follow `.ai/AGENTS.md` before starting work.\nUse `.ai/instructions/index.md` to load only instructions relevant to the request.\n<!-- ai-workflow-routing:end -->\n\nCustom guidance stays here.\n",
  );
  const workflow = path.join(workspace, ".ai");
  await init(workflow);
  const canonical = {
    ".gitignore":
      "*\n!/.gitignore\n!/AGENTS.md\n!/README.md\n!/.codex/\n!/.codex/config.toml\n!/docs/\n!/docs/**\n!/scripts/\n!/scripts/**\n!/.agents/\n!/.agents/**\n",
    "AGENTS.md": "Workflow baseline\n",
    "README.md": "Workflow readme\n",
    ".codex/config.toml": 'model = "fixture"\n',
    "docs/removed.md": "Selected canonical deletion\n",
  };
  for (const skill of managedSkills) {
    canonical[`.agents/skills/${skill}/SKILL.md`] =
      `---\nname: ${skill}\n---\nFixture skill\n`;
    canonical[`.agents/skills/${skill}/agents/openai.yaml`] =
      `interface:\n  display_name: "${skill}"\n`;
  }
  for (const [relative, value] of Object.entries(canonical))
    await put(workflow, relative, value);
  git(workflow, "add", ".");
  git(workflow, "commit", "-m", "workflow baseline");
  git(
    workflow,
    "remote",
    "add",
    "origin",
    "https://synthetic:fixture-only@example.invalid/private",
  );
  git(workflow, "config", "fixture.privateMarker", "must-not-copy");
  await put(workflow, ".git/hooks/post-checkout", "#!/bin/sh\nexit 78\n");
  await put(workflow, "AGENTS.md", "Staged workflow guidance\n");
  git(workflow, "add", "AGENTS.md");
  await put(workflow, "README.md", "Working workflow readme\n");
  await rm(path.join(workflow, "docs/removed.md"));
  await put(workflow, "scripts/new.mjs", "// selected new workflow source\n");
  await mkdir(path.join(workspace, ".agents/skills"), { recursive: true });
  for (const skill of managedSkills)
    await symlink(
      `../../.ai/.agents/skills/${skill}`,
      path.join(workspace, ".agents/skills", skill),
    );
  const local = {
    ".ai/instructions/index.md":
      "## Rules\n\n- Load `areas/native-qa.md` for this task.\n",
    ".ai/instructions/areas/native-qa.md":
      "Read [required guidance](reference.md).\n",
    ".ai/instructions/areas/reference.md": "Required local guidance\n",
    ".ai/plans/selected-fix.md":
      "# Fix selected behavior\n\nRequired: [design](../../docs/required.md).\n",
    "docs/required.md": "Required external documentation\n",
  };
  for (const [relative, value] of Object.entries(local))
    await put(workspace, relative, value);
  const forbidden = [
    ".ai/.env",
    ".ai/credentials.json",
    ".ai/node_modules/dummy",
    ".ai/.cache/dummy",
    ".ai/dist/dummy",
    ".ai/artifacts/record",
    ".ai/logs/record",
    ".ai/plans/unrelated-plan.md",
    ".ai/specs/unrelated.md",
    "docs/unrelated.md",
  ];
  for (const relative of forbidden)
    await put(workspace, relative, "SYNTHETIC FIXTURE ONLY\n");
  return {
    workspace,
    workflow,
    sources,
    forbidden,
    canonicalFiles: [...Object.keys(canonical), "scripts/new.mjs"],
    localFiles: Object.keys(local).filter((name) => name.startsWith(".ai/")),
    workspaceFiles: ["AGENTS.md", "AGENTS.override.md", "docs/required.md"],
  };
}

// This is fixture-only preflight for the explicit known inputs below, not a
// parser or automatic executor for arbitrary plans/instruction references.
async function preflight(f, plan = "selected-fix") {
  const taskRoot = path.join(f.workspace, ".worktrees", plan);
  assert.equal(await exists(taskRoot), false, "existing task root");
  assert.equal(
    new Set(f.sources).size,
    f.sources.length,
    "duplicate repository roots",
  );
  for (const source of f.sources) {
    assert.ok(
      source === f.workspace || source.startsWith(`${f.workspace}/`),
      "repository escapes workspace",
    );
    assert.equal(
      (await lstat(source)).isSymbolicLink(),
      false,
      "repository symlink",
    );
    assert.ok(
      !f.sources.some(
        (other) => other !== source && source.startsWith(`${other}/`),
      ),
      "overlapping repository roots",
    );
  }
  for (const relative of [...f.localFiles, ...f.workspaceFiles]) {
    assert.ok(
      !path.isAbsolute(relative) && !relative.split("/").includes(".."),
    );
    const parts = relative.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const info = await lstat(
        path.join(f.workspace, ...parts.slice(0, index)),
      );
      assert.equal(
        info.isSymbolicLink(),
        false,
        "symbolic link in selected context",
      );
    }
    assert.ok((await lstat(path.join(f.workspace, relative))).isFile());
    assert.ok(
      (await realpath(path.join(f.workspace, relative))).startsWith(
        `${f.workspace}/`,
      ),
    );
  }
  for (const source of f.sources) {
    assert.equal(git(source, "rev-parse", "--show-toplevel"), source);
    assert.equal(
      git(source, "branch", "--list", `fix/${plan}`),
      "",
      "existing branch",
    );
    assert.equal(
      git(source, "branch", "-r", "--list", `*/fix/${plan}`),
      "",
      "matching remote branch",
    );
    assert.equal(
      git(
        source,
        "ls-tree",
        "--name-only",
        "HEAD",
        ".ai",
        "AGENTS.override.md",
      ),
      "",
      "checkout context collision",
    );
    if (f.sources.length === 1) {
      for (const ancestor of [".agents", ".agents/skills"]) {
        const entry = git(source, "ls-tree", "HEAD", "--", ancestor);
        assert.ok(
          !entry || entry.startsWith("040000 tree "),
          "unsafe skill ancestor in base tree",
        );
      }
      for (const skill of managedSkills)
        assert.equal(
          git(
            source,
            "ls-tree",
            "--name-only",
            "HEAD",
            "--",
            `.agents/skills/${skill}`,
          ),
          "",
          "managed skill collision in base tree",
        );
      for (const relative of f.workspaceFiles) {
        if (git(source, "ls-tree", "--name-only", "HEAD", "--", relative)) {
          assert.equal(
            run(source, "git", "show", `HEAD:${relative}`),
            await readFile(path.join(f.workspace, relative), "utf8"),
            "checkout file differs",
          );
        }
      }
    }
  }
  return taskRoot;
}

async function sourceState(f) {
  const repositories = await Promise.all(
    [f.workflow, ...f.sources].map(async (source) => ({
      head: git(source, "rev-parse", "HEAD"),
      branch: git(source, "branch", "--show-current"),
      status: git(source, "status", "--porcelain=v1", "--untracked-files=all"),
      index: await readFile(path.join(source, ".git/index")),
    })),
  );
  const files = [];
  async function collect(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", ".worktrees"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(full);
      else
        files.push({
          relative: path.relative(f.workspace, full),
          ...(entry.isSymbolicLink()
            ? { link: await readlink(full) }
            : { bytes: await readFile(full) }),
          mode: (await lstat(full)).mode,
        });
    }
  }
  await collect(f.workspace);
  return { repositories, files };
}

async function prepare(f) {
  const taskRoot = await preflight(f);
  await mkdir(path.dirname(taskRoot), { recursive: true });
  if (f.sources.length > 1) await mkdir(taskRoot);
  for (const source of f.sources) {
    const target =
      f.sources.length === 1
        ? taskRoot
        : path.join(taskRoot, path.basename(source));
    git(
      source,
      "worktree",
      "add",
      "-b",
      "fix/selected-fix",
      target,
      git(source, "rev-parse", "HEAD"),
    );
    assert.equal(git(target, "status", "--porcelain"), "");
    assert.equal(git(target, "branch", "--show-current"), "fix/selected-fix");
    assert.ok(
      git(source, "worktree", "list", "--porcelain").includes(
        `worktree ${target}`,
      ),
    );
  }
  copyContext(f, taskRoot);
  return taskRoot;
}

function copyContext(f, taskRoot) {
  const array = (name, values) => `${name}=(${values.map(quote).join(" ")})`;
  run(
    f.workspace,
    "bash",
    "-c",
    [
      `workspace=${quote(f.workspace)}`,
      `task_root=${quote(taskRoot)}`,
      `workflow_head=${quote(git(f.workflow, "rev-parse", "HEAD"))}`,
      array("canonical_files", f.canonicalFiles),
      array("local_files", f.localFiles),
      array("workspace_files", f.workspaceFiles),
      `export PATH=${quote(path.join(f.workspace, ".fixture-bin"))}:"$PATH"`,
      copyCommands,
    ].join("\n"),
  );
}

for (const count of [1, 2]) {
  test(`documented context copy isolates Git and selects files in ${count}-repository topology`, async (t) => {
    const f = await fixture(t, count);
    const before = await sourceState(f);
    const taskRoot = await prepare(f);
    for (const relative of [
      ...f.localFiles,
      ...f.workspaceFiles,
      ...f.canonicalFiles
        .filter((name) => name !== "docs/removed.md")
        .map((name) => `.ai/${name}`),
    ]) {
      assert.deepEqual(
        await readFile(path.join(taskRoot, relative)),
        await readFile(path.join(f.workspace, relative)),
      );
      assert.equal(
        (await lstat(path.join(taskRoot, relative))).mode,
        (await lstat(path.join(f.workspace, relative))).mode,
      );
    }
    for (const relative of [
      ...f.forbidden,
      ".ai/docs/removed.md",
      ".ai/.git/objects/info/alternates",
    ])
      assert.equal(
        await exists(path.join(taskRoot, relative)),
        false,
        relative,
      );
    for (const skill of managedSkills) {
      const link = path.join(taskRoot, ".agents/skills", skill);
      assert.ok((await lstat(link)).isSymbolicLink());
      assert.equal(await readlink(link), `../../.ai/.agents/skills/${skill}`);
      assert.equal(
        await realpath(link),
        path.join(taskRoot, ".ai/.agents/skills", skill),
        "skill discovery resolves inside the independent task-local source",
      );
      assert.notEqual(
        await realpath(link),
        await realpath(path.join(f.workspace, ".agents/skills", skill)),
      );
    }
    if (count === 1) {
      assert.equal(
        await readFile(path.join(taskRoot, ".agents/README.md"), "utf8"),
        "Keep custom agent guidance.\n",
      );
      assert.equal(
        await readFile(
          path.join(taskRoot, ".agents/skills/custom/SKILL.md"),
          "utf8",
        ),
        "Keep custom skill.\n",
      );
      assert.equal(git(taskRoot, "diff", "--name-only"), "");
    } else {
      for (const source of f.sources)
        assert.equal(
          git(
            path.join(taskRoot, path.basename(source)),
            "status",
            "--porcelain",
          ),
          "",
        );
    }
    const copied = path.join(taskRoot, ".ai");
    assert.ok((await lstat(path.join(copied, ".git"))).isDirectory());
    assert.equal(git(copied, "rev-parse", "--show-toplevel"), copied);
    assert.equal(git(copied, "remote"), "");
    assert.doesNotMatch(
      git(copied, "config", "--local", "--list"),
      /fixture\.privatemarker|synthetic|example\.invalid|worktree-context-/i,
    );
    assert.equal(
      await exists(path.join(copied, ".git/hooks/post-checkout")),
      false,
    );
    for (const directory of await readdir(path.join(copied, ".git/objects"))) {
      const dir = path.join(copied, ".git/objects", directory);
      if (!(await lstat(dir)).isDirectory()) continue;
      for (const file of await readdir(dir))
        assert.equal((await lstat(path.join(dir, file))).nlink, 1);
    }
    assert.deepEqual(
      await sourceState(f),
      before,
      "source working state and indexes unchanged",
    );
    await put(copied, "README.md", "task-only edit\n");
    assert.equal(
      await readFile(path.join(f.workflow, "README.md"), "utf8"),
      "Working workflow readme\n",
    );
    assert.equal(git(f.sources[0], "ls-files", "--", ".ai"), "");
  });
}

test("preflight refuses occupied paths, branches, collisions, missing files, and escaping links before mutation", async (t) => {
  const f = await fixture(t, 1);
  const state = await sourceState(f);
  const target = path.join(f.workspace, ".worktrees/selected-fix");
  await mkdir(target, { recursive: true });
  await assert.rejects(preflight(f), /existing task root/);
  await rm(target, { recursive: true });
  const originalSources = f.sources;
  f.sources = [f.workspace, f.workspace];
  await assert.rejects(preflight(f), /duplicate repository roots/);
  f.sources = [path.dirname(f.workspace)];
  await assert.rejects(preflight(f), /repository escapes workspace/);
  f.sources = originalSources;
  git(f.workspace, "branch", "fix/selected-fix");
  await assert.rejects(preflight(f), /existing branch/);
  git(f.workspace, "branch", "-D", "fix/selected-fix");
  git(
    f.workspace,
    "update-ref",
    "refs/remotes/origin/fix/selected-fix",
    "HEAD",
  );
  await assert.rejects(preflight(f), /matching remote branch/);
  git(f.workspace, "update-ref", "-d", "refs/remotes/origin/fix/selected-fix");
  await put(f.workspace, "AGENTS.md", "different checkout guidance\n");
  await assert.rejects(preflight(f), /checkout file differs/);
  await put(f.workspace, "AGENTS.md", "Existing root guidance.\n");
  const required = path.join(f.workspace, "docs/required.md");
  await rm(required);
  await assert.rejects(preflight(f), /ENOENT/);
  await symlink(path.join(f.workspace, "../outside-required.md"), required);
  await assert.rejects(preflight(f), /symbolic link/);
  await rm(required);
  await put(
    f.workspace,
    "docs/required.md",
    "Required external documentation\n",
  );
  assert.equal(await exists(target), false);
  assert.deepEqual(await sourceState(f), state);
});

// Risk: checkout-owned skill paths or unsafe ancestors could redirect setup
// outside the task root. Execute the authoritative block, rather than merely
// asserting its wording, and prove each refusal leaves context uncreated.
test("canonical copy refuses managed collisions and unsafe ancestors before writes", async (t) => {
  const f = await fixture(t, 1);
  const before = await sourceState(f);
  const taskRoot = path.join(f.workspace, ".worktrees/collision-check");
  const scenarios = [
    [
      "managed regular file",
      async () => put(taskRoot, ".agents/skills/ai-pr", "custom collision\n"),
    ],
    [
      "managed directory",
      async () =>
        mkdir(path.join(taskRoot, ".agents/skills/ai-pr"), { recursive: true }),
    ],
    [
      "managed dangling link",
      async () => {
        await mkdir(path.join(taskRoot, ".agents/skills"), { recursive: true });
        await symlink(
          "missing-target",
          path.join(taskRoot, ".agents/skills/ai-pr"),
        );
      },
    ],
    [
      "managed source-workspace link",
      async () => {
        await mkdir(path.join(taskRoot, ".agents/skills"), { recursive: true });
        await symlink(
          path.join(f.workflow, ".agents/skills/ai-pr"),
          path.join(taskRoot, ".agents/skills/ai-pr"),
        );
      },
    ],
    [
      "agents ancestor file",
      async () => put(taskRoot, ".agents", "occupied\n"),
    ],
    [
      "skills ancestor file",
      async () => put(taskRoot, ".agents/skills", "occupied\n"),
    ],
    [
      "agents ancestor symlink",
      async () =>
        symlink(
          path.join(f.workspace, ".agents"),
          path.join(taskRoot, ".agents"),
        ),
    ],
    [
      "skills ancestor symlink",
      async () => {
        await mkdir(path.join(taskRoot, ".agents"));
        await symlink(
          path.join(f.workspace, ".agents/skills"),
          path.join(taskRoot, ".agents/skills"),
        );
      },
    ],
  ];
  for (const [name, occupy] of scenarios) {
    await t.test(name, async () => {
      await mkdir(taskRoot, { recursive: true });
      await occupy();
      assert.throws(() => copyContext(f, taskRoot));
      assert.equal(await exists(path.join(taskRoot, ".ai")), false);
      assert.equal(
        await exists(path.join(taskRoot, "AGENTS.override.md")),
        false,
      );
      assert.deepEqual(await sourceState(f), before);
      await rm(taskRoot, { recursive: true });
    });
  }
});

test("canonical copy requires all real local skill sources before writes", async (t) => {
  const f = await fixture(t, 1);
  const source = path.join(f.workflow, ".agents/skills/ai-pr/SKILL.md");
  const content = await readFile(source);
  const taskRoot = path.join(f.workspace, ".worktrees/missing-source");
  await mkdir(taskRoot, { recursive: true });
  for (const linked of [false, true]) {
    await rm(source);
    if (linked) await symlink(path.join(f.workflow, "README.md"), source);
    assert.throws(() => copyContext(f, taskRoot));
    assert.equal(await exists(path.join(taskRoot, ".ai")), false);
    if (linked) await rm(source);
    await writeFile(source, content);
  }
});

test("base-tree preflight refuses tracked skill outputs and unsafe ancestors", async (t) => {
  const f = await fixture(t, 1);
  // The source links are normally untracked setup outputs. A base containing
  // one must fail even if its text resembles the intended task-local link.
  git(f.workspace, "add", ".agents/skills/ai-pr");
  git(f.workspace, "commit", "-m", "fixture tracked managed link");
  const before = await sourceState(f);
  await assert.rejects(preflight(f), /managed skill collision in base tree/);
  assert.deepEqual(await sourceState(f), before);
  assert.equal(
    await exists(path.join(f.workspace, ".worktrees/selected-fix")),
    false,
  );
  // Use a distinct fixture for an unsafe tracked ancestor without resetting
  // or modifying the earlier fixture's Git index.
  const unsafe = await fixture(t, 1);
  await rm(path.join(unsafe.workspace, ".agents"), { recursive: true });
  await symlink("outside-agents", path.join(unsafe.workspace, ".agents"));
  git(unsafe.workspace, "add", "--all", ".agents");
  git(unsafe.workspace, "commit", "-m", "fixture unsafe ancestor");
  await assert.rejects(preflight(unsafe), /unsafe skill ancestor in base tree/);
  assert.equal(
    await exists(path.join(unsafe.workspace, ".worktrees/selected-fix")),
    false,
  );
});

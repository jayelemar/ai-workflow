import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  readlink,
  rename,
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
  path.join(root, ".agents/skills/worktree-setup/references/context-copy.md"),
  "utf8",
);
const copyCommands = procedure.match(
  /<!-- context-copy:start -->\s*```bash\n([\s\S]*?)\n```\s*<!-- context-copy:end -->/,
)?.[1];
assert.ok(copyCommands, "the documented copy operations must be executable");

const managedSkills = [
  "create-plan",
  "worktree-setup",
  "git-commit",
  "pull-request",
  "show-summary",
  "manual-qa-checklist",
];

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
const init = async (directory, objectFormat) => {
  await mkdir(directory, { recursive: true });
  git(
    directory,
    "init",
    "-b",
    "main",
    ...(objectFormat ? [`--object-format=${objectFormat}`] : []),
  );
  git(directory, "config", "user.email", "fixture@example.invalid");
  git(directory, "config", "user.name", "Disposable Fixture");
};

async function fixture(t, count, { workflowObjectFormat } = {}) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "worktree-context-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  // CI need not install RTK. Its output filtering is outside this copy test;
  // execute the documented commands through a fixture-only passthrough.
  await put(
    workspace,
    ".fixture-bin/rtk",
    '#!/bin/sh\nif [ "$1" = proxy ]; then shift; fi\ncase "$1" in node|git|cp) exec "$@";; *) exit 91;; esac\n',
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
  await init(workflow, workflowObjectFormat);
  const canonical = {
    ".gitignore":
      "*\n!/.gitignore\n!/AGENTS.md\n!/README.md\n!/.codex/\n!/.codex/config.toml\n!/docs/\n!/docs/**\n!/scripts/\n!/scripts/**\n!/.agents/\n!/.agents/**\n!/instructions/\n!/instructions/shared/\n!/instructions/shared/**\n!/instructions/mobile/\n!/instructions/mobile/**\n!/instructions/desktop/\n!/instructions/desktop/**\n!/instructions/web/\n!/instructions/web/**\n!/instructions/server/\n!/instructions/server/**\n",
    "AGENTS.md": "Workflow baseline\n",
    "README.md": "Workflow readme\n",
    ".codex/config.toml": 'model = "fixture"\n',
    ".husky/pre-commit": "pnpm health\n",
    ".husky/pre-push": "pnpm health:full\n",
    "docs/removed.md": "Selected canonical deletion\n",
    "instructions/shared/testing.md": "Shared test principles\n",
    "instructions/mobile/ui.md": "Mobile guidance\n",
    "instructions/desktop/electron/qa.md": "Electron guidance\n",
    "instructions/web/wcag.md": "Browser guidance\n",
    "instructions/server/security.md": "Server guidance\n",
  };
  canonical[".gitignore"] +=
    "!/.husky/\n!/.husky/pre-commit\n!/.husky/pre-push\n";
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
      "## Rules\n\n- Load `local/desktop/native-qa.md`, `shared/testing.md`, `mobile/ui.md`, `desktop/electron/qa.md`, `web/wcag.md`, and `server/security.md` for this fixture.\n",
    ".ai/instructions/local/desktop/native-qa.md":
      "Read [required guidance](reference.md).\n",
    ".ai/instructions/local/desktop/reference.md": "Required local guidance\n",
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
    ".ai/instructions/local/unrelated.md",
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
async function preflight(f, plan = "selected-fix", branch = `fix/${plan}`) {
  const taskRoot = path.join(f.workspace, ".worktrees", plan);
  const errors = [];
  const check = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error.message);
    }
  };
  assert.equal(
    new Set(f.sources).size,
    f.sources.length,
    "duplicate repository roots",
  );
  await check(() => git(f.sources[0], "check-ref-format", "--branch", branch));
  for (const source of f.sources)
    await check(async () => {
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
      assert.equal(git(source, "rev-parse", "--show-toplevel"), source);
      assert.equal(
        git(source, "branch", "-r", "--list", `*/${branch}`),
        "",
        "matching remote branch",
      );
      const target =
        f.sources.length === 1
          ? taskRoot
          : path.join(taskRoot, path.basename(source));
      if (await exists(target)) {
        assert.ok(
          (await lstat(target)).isDirectory(),
          "existing task root is not a worktree directory",
        );
        assert.equal(
          git(target, "rev-parse", "--show-toplevel"),
          target,
          "wrong top level",
        );
        const common = (p) =>
          path.resolve(p, git(p, "rev-parse", "--git-common-dir"));
        assert.equal(common(target), common(source), "wrong repository");
        assert.ok(
          git(source, "worktree", "list", "--porcelain").includes(
            `worktree ${target}\n`,
          ),
          "unregistered target",
        );
        assert.equal(
          git(target, "branch", "--show-current"),
          branch,
          "wrong branch",
        );
        assert.equal(
          git(target, "rev-parse", "HEAD"),
          git(source, "rev-parse", "HEAD"),
          "wrong base or advanced branch",
        );
        assert.equal(
          git(target, "diff", "HEAD", "--name-only"),
          "",
          "application edits",
        );
        const additions = git(target, "ls-files", "--others")
          .split("\n")
          .filter(Boolean);
        for (const relative of additions) {
          assert.ok(
            f.sources.length === 1 &&
              (f.localFiles.includes(relative) ||
                f.workspaceFiles.includes(relative) ||
                relative.startsWith(".ai/") ||
                managedSkills.some(
                  (skill) => relative === `.agents/skills/${skill}`,
                )),
            `unexpected application addition: ${relative}`,
          );
        }
      } else
        assert.equal(
          git(source, "branch", "--list", branch),
          "",
          "existing branch without target",
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
    });
  await check(async () => {
    if (f.sources.length > 1 && (await exists(taskRoot))) {
      const allowed = new Set([
        ...f.sources.map((p) => path.basename(p)),
        ".ai",
        ".agents",
        ...f.workspaceFiles.map((p) => p.split("/")[0]),
      ]);
      for (const name of await readdir(taskRoot))
        assert.ok(allowed.has(name), `unexpected task-root entry: ${name}`);
    }
    copyContext(f, taskRoot, true);
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  return taskRoot;
}

async function sourceState(f) {
  const repositories = await Promise.all(
    [f.workflow, ...f.sources].map(async (source) => ({
      head: git(source, "rev-parse", "HEAD"),
      branch: git(source, "branch", "--show-current"),
      // Shared local excludes may hide managed context in the source checkout.
      // The complete file snapshot below still proves untracked bytes unchanged.
      status: git(source, "status", "--porcelain=v1", "--untracked-files=no"),
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
          mtimeNs: (await lstat(full, { bigint: true })).mtimeNs,
        });
    }
  }
  await collect(f.workspace);
  return { repositories, files };
}

async function prepare(f, branch = "fix/selected-fix") {
  const taskRoot = await preflight(f, "selected-fix", branch);
  await mkdir(path.dirname(taskRoot), { recursive: true });
  if (f.sources.length > 1) await mkdir(taskRoot, { recursive: true });
  for (const source of f.sources) {
    const target =
      f.sources.length === 1
        ? taskRoot
        : path.join(taskRoot, path.basename(source));
    if (await exists(target)) continue;
    git(
      source,
      "worktree",
      "add",
      "-b",
      branch,
      target,
      git(source, "rev-parse", "HEAD"),
    );
    assert.equal(git(target, "status", "--porcelain"), "");
    assert.equal(git(target, "branch", "--show-current"), branch);
    assert.ok(
      git(source, "worktree", "list", "--porcelain").includes(
        `worktree ${target}`,
      ),
    );
  }
  copyContext(f, taskRoot);
  return taskRoot;
}

function copyContext(f, taskRoot, checkOnly = false) {
  const array = (name, values) => `${name}=(${values.map(quote).join(" ")})`;
  try {
    run(
      f.workspace,
      "bash",
      "-c",
      [
        `workspace=${quote(f.workspace)}`,
        `task_root=${quote(taskRoot)}`,
        `workflow_head=${quote(git(f.workflow, "rev-parse", "HEAD"))}`,
        `context_check_only=${checkOnly ? 1 : 0}`,
        array("canonical_files", f.canonicalFiles),
        array("local_files", f.localFiles),
        array("workspace_files", f.workspaceFiles),
        `export PATH=${quote(path.join(f.workspace, ".fixture-bin"))}:"$PATH"`,
        copyCommands,
      ].join("\n"),
    );
  } catch (error) {
    throw new Error(error.stderr || "context-copy failed", {
      cause: error.status,
    });
  }
}

for (const count of [1, 2]) {
  test(`documented context copy isolates Git and selects files in ${count}-repository topology`, async (t) => {
    const f = await fixture(t, count);
    await rm(path.join(f.workflow, "node_modules"), { recursive: true });
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
        (await lstat(path.join(taskRoot, relative))).mtimeMs,
        (await lstat(path.join(f.workspace, relative))).mtimeMs,
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

// Risk: copied control context clutters application status and can be staged
// accidentally. Run the real copy procedure against a native worktree whose
// tracked ignore file has no context rules; retain visibility of application work.
test("context stays locally ignored while application and workflow edits remain visible", async (t) => {
  const f = await fixture(t, 1);
  await put(f.workspace, ".gitignore", ".worktrees/\n");
  git(f.workspace, "add", ".gitignore");
  git(f.workspace, "commit", "-m", "fixture without context ignores");
  const exclude = path.join(f.workspace, ".git/info/exclude");
  await writeFile(exclude, "# preserve existing rules\n/local-only");
  const taskRoot = await preflight(f);
  assert.equal(
    await readFile(exclude, "utf8"),
    "# preserve existing rules\n/local-only",
  );
  await prepare(f);
  const contextPaths = [".ai", ".agents", "AGENTS.override.md"];
  const visibleContext = () =>
    git(
      taskRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...contextPaths,
    );
  assert.equal(visibleContext(), "");
  assert.equal(
    git(taskRoot, "ls-files", "--", ".ai", "AGENTS.override.md"),
    "",
  );
  const rules = await readFile(exclude, "utf8");
  assert.ok(rules.startsWith("# preserve existing rules\n/local-only\n"));
  await writeFile(exclude, "# preserve existing rules\n/local-only");
  await prepare(f);
  assert.equal(visibleContext(), "", "resume repairs missing local excludes");
  await prepare(f);
  assert.equal(
    await readFile(exclude, "utf8"),
    rules,
    "retry does not duplicate excludes",
  );
  await put(taskRoot, ".ai/README.md", "task workflow change\n");
  await put(taskRoot, ".agents/local.md", "local guidance\n");
  await put(taskRoot, "AGENTS.override.md", "local override change\n");
  assert.equal(visibleContext(), "");
  assert.match(
    git(path.join(taskRoot, ".ai"), "status", "--porcelain"),
    / M README\.md/,
  );
  await put(taskRoot, "app.txt", "application change\n");
  await put(taskRoot, "new-app.txt", "new application file\n");
  await put(taskRoot, ".agents/README.md", "tracked custom guidance change\n");
  const status = git(
    taskRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  assert.match(status, /M app\.txt/);
  assert.match(status, /\?\? new-app\.txt/);
  assert.match(status, /M \.agents\/README\.md/);
  assert.equal(git(taskRoot, "diff", "--name-only", "--", ".gitignore"), "");
});

test("unsafe local Git excludes block context writes", async (t) => {
  const f = await fixture(t, 1);
  const taskRoot = await preflight(f);
  await mkdir(path.dirname(taskRoot), { recursive: true });
  git(
    f.workspace,
    "worktree",
    "add",
    "-b",
    "fix/selected-fix",
    taskRoot,
    "HEAD",
  );
  const outside = path.join(f.workspace, "preserved-excludes");
  await writeFile(outside, "# keep these bytes\n");
  const exclude = path.join(f.workspace, ".git/info/exclude");
  await rm(exclude);
  await symlink(outside, exclude);
  assert.throws(
    () => copyContext(f, taskRoot),
    /unsafe application Git exclude/,
  );
  assert.equal(await exists(path.join(taskRoot, ".ai")), false);
  assert.equal(await readFile(outside, "utf8"), "# keep these bytes\n");
});

test("preflight refuses occupied paths, branches, collisions, missing files, and escaping links before mutation", async (t) => {
  const f = await fixture(t, 1);
  const state = await sourceState(f);
  const target = path.join(f.workspace, ".worktrees/selected-fix");
  await mkdir(target, { recursive: true });
  await assert.rejects(
    preflight(f),
    /wrong top level|not a worktree|rev-parse/,
  );
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
  await assert.rejects(preflight(f), /missing selected context/);
  await symlink(path.join(f.workspace, "../outside-required.md"), required);
  await assert.rejects(preflight(f), /symbolic link/);
  await rm(required);
  await put(
    f.workspace,
    "docs/required.md",
    "Required external documentation\n",
  );
  assert.equal(await exists(target), false);
  // This test itself rewrites and restores two source files; compare their
  // content/index state here. Other preservation tests also compare timestamps.
  const withoutTimes = (state) => ({
    ...state,
    files: state.files.map(({ mtimeNs, ...file }) => file),
  });
  assert.deepEqual(withoutTimes(await sourceState(f)), withoutTimes(state));
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
      async () =>
        put(taskRoot, ".agents/skills/pull-request", "custom collision\n"),
    ],
    [
      "managed directory",
      async () =>
        mkdir(path.join(taskRoot, ".agents/skills/pull-request"), {
          recursive: true,
        }),
    ],
    [
      "managed dangling link",
      async () => {
        await mkdir(path.join(taskRoot, ".agents/skills"), { recursive: true });
        await symlink(
          "missing-target",
          path.join(taskRoot, ".agents/skills/pull-request"),
        );
      },
    ],
    [
      "managed source-workspace link",
      async () => {
        await mkdir(path.join(taskRoot, ".agents/skills"), { recursive: true });
        await symlink(
          path.join(f.workflow, ".agents/skills/pull-request"),
          path.join(taskRoot, ".agents/skills/pull-request"),
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
  const source = path.join(f.workflow, ".agents/skills/pull-request/SKILL.md");
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
  git(f.workspace, "add", ".agents/skills/pull-request");
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

// Risk: retries can overwrite task-owned edits or recreate links. Exercise the
// same documented copy block at independently resumable stages in both layouts.
for (const count of [1, 2]) {
  test(`canonical copy resumes and reverifies ${count}-repository context without dependencies`, async (t) => {
    const f = await fixture(t, count);
    await rm(path.join(f.workflow, "node_modules"), { recursive: true });
    const before = await sourceState(f);
    const taskRoot = await preflight(f);
    await mkdir(path.dirname(taskRoot), { recursive: true });
    if (count > 1) await mkdir(taskRoot);
    for (const source of f.sources) {
      git(
        source,
        "worktree",
        "add",
        "-b",
        "fix/selected-fix",
        count === 1 ? taskRoot : path.join(taskRoot, path.basename(source)),
        "HEAD",
      );
    }
    const copied = path.join(taskRoot, ".ai");
    git(
      f.workspace,
      "-c",
      "core.hooksPath=/dev/null",
      "clone",
      "--no-local",
      "--no-hardlinks",
      "--no-checkout",
      f.workflow,
      copied,
    );
    git(copied, "remote", "remove", "origin");
    git(
      copied,
      "-c",
      "core.hooksPath=/dev/null",
      "checkout",
      "--detach",
      git(f.workflow, "rev-parse", "HEAD"),
    );
    await put(
      copied,
      "README.md",
      await readFile(path.join(f.workflow, "README.md")),
    );
    copyContext(f, taskRoot);
    const file = path.join(copied, "README.md");
    const link = path.join(taskRoot, ".agents/skills/create-plan");
    const fileBefore = await lstat(file);
    const linkBefore = await lstat(link);
    copyContext(f, taskRoot);
    assert.equal((await lstat(file)).ino, fileBefore.ino);
    assert.equal((await lstat(file)).mtimeMs, fileBefore.mtimeMs);
    assert.equal((await lstat(link)).ino, linkBefore.ino);
    assert.equal(await exists(path.join(copied, "node_modules")), false);
    assert.equal(await exists(path.join(copied, "docs/removed.md")), false);
    assert.deepEqual(await sourceState(f), before);
  });
}

test("retry conflicts preserve all context before copying missing files", async (t) => {
  const f = await fixture(t, 1);
  const taskRoot = await prepare(f);
  const missing = path.join(taskRoot, ".ai/scripts/new.mjs");
  await rm(missing);
  await put(taskRoot, ".ai/README.md", "unexpected task edit\n");
  const before = await readFile(path.join(taskRoot, ".ai/README.md"));
  assert.throws(() => copyContext(f, taskRoot));
  assert.deepEqual(
    await readFile(path.join(taskRoot, ".ai/README.md")),
    before,
  );
  assert.equal(await exists(missing), false);
});

test("retry refuses incompatible workflow metadata without modifying context", async (t) => {
  for (const corrupt of [
    async (p) =>
      git(p, "remote", "add", "other", "https://example.invalid/repo"),
    async (p) => put(p, ".git/objects/info/alternates", "/missing/objects\n"),
    async (p) => put(p, ".git/hooks/post-checkout", "exit 0\n"),
    async (p) => git(p, "config", "core.worktree", "/missing"),
    async (p) => rm(path.join(p, ".git/index")),
  ]) {
    const f = await fixture(t, 1);
    const taskRoot = await prepare(f);
    const copied = path.join(taskRoot, ".ai");
    await rm(path.join(copied, "scripts/new.mjs"));
    await corrupt(copied);
    assert.throws(() => copyContext(f, taskRoot));
    assert.equal(await exists(path.join(copied, "scripts/new.mjs")), false);
  }
});

// Application preflight is fixture-only; the independent skill trials exercise
// the agent's interpretation. These native Git cases guard the fixture contract
// and ensure no missing sibling gets created when an existing child is unsafe.
test("matching native worktrees resume at each stage in both layouts", async (t) => {
  for (const count of [1, 2]) {
    const f = await fixture(t, count);
    const target = await preflight(f);
    if (count === 2) await mkdir(target, { recursive: true });
    git(
      f.sources[0],
      "worktree",
      "add",
      "-b",
      "fix/selected-fix",
      count === 1 ? target : path.join(target, "app"),
      "HEAD",
    );
    const first = count === 1 ? target : path.join(target, "app");
    const originalGitFile = await readFile(path.join(first, ".git"));
    const before = await sourceState(f);
    assert.equal(await prepare(f), target);
    assert.equal(await prepare(f), target);
    assert.deepEqual(await readFile(path.join(first, ".git")), originalGitFile);
    assert.deepEqual(await sourceState(f), before);
  }
});

test("native retry refuses edits, wrong branches, bases, repositories, and additions", async (t) => {
  const cases = [
    ["application edits", async (f, p) => put(p, "app.txt", "task edit\n")],
    ["wrong branch", async (f, p) => git(p, "switch", "-c", "custom/other")],
    [
      "wrong base or advanced branch",
      async (f, p) => {
        await put(p, "app.txt", "committed task edit\n");
        git(p, "add", "app.txt");
        git(p, "commit", "-m", "task advanced");
      },
    ],
    [
      "unexpected application addition",
      async (f, p) => put(p, "extra.txt", "task addition\n"),
    ],
  ];
  for (const [message, change] of cases)
    await t.test(message, async (t) => {
      const f = await fixture(t, 2);
      const task = path.join(f.workspace, ".worktrees/selected-fix");
      await mkdir(task, { recursive: true });
      const child = path.join(task, "app");
      git(
        f.sources[0],
        "worktree",
        "add",
        "-b",
        "fix/selected-fix",
        child,
        "HEAD",
      );
      await change(f, child);
      const status = git(child, "status", "--porcelain");
      await assert.rejects(prepare(f), new RegExp(message));
      assert.equal(git(child, "status", "--porcelain"), status);
      assert.equal(await exists(path.join(task, "api")), false);
      assert.equal(await exists(path.join(task, ".ai")), false);
    });
  const f = await fixture(t, 2);
  const task = path.join(f.workspace, ".worktrees/selected-fix");
  await mkdir(task, { recursive: true });
  git(
    f.sources[1],
    "worktree",
    "add",
    "-b",
    "fix/selected-fix",
    path.join(task, "app"),
    "HEAD",
  );
  await assert.rejects(prepare(f), /wrong repository/);
  assert.equal(await exists(path.join(task, "api")), false);
});

test("preflight aggregates repository and context blockers without creation", async (t) => {
  const f = await fixture(t, 2);
  git(f.sources[0], "branch", "fix/selected-fix");
  git(
    f.sources[1],
    "update-ref",
    "refs/remotes/origin/fix/selected-fix",
    "HEAD",
  );
  await rm(path.join(f.workspace, "docs/required.md"));
  let failure;
  try {
    await prepare(f);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  for (const message of [
    "existing branch",
    "matching remote branch",
    "missing selected context",
  ])
    assert.ok(failure.message.includes(message), message);
  assert.equal(
    await exists(path.join(f.workspace, ".worktrees/selected-fix")),
    false,
  );
});

test("explicit safe branches use the requested name", async (t) => {
  const f = await fixture(t, 1);
  const target = await prepare(f, "task/arbitrary-safe-name");
  assert.equal(
    git(target, "branch", "--show-current"),
    "task/arbitrary-safe-name",
  );
});

test("changed source context, selected deletions, and link conflicts never overwrite retries", async (t) => {
  for (const scenario of [
    "canonical",
    "local",
    "deletion",
    "link",
    "mode",
    "new commit",
    "incomplete clone",
    "symlink",
  ]) {
    const f = await fixture(t, 1);
    const target = await prepare(f);
    const readme = path.join(target, ".ai/README.md");
    const original = await readFile(readme);
    const missing = path.join(target, ".ai/scripts/new.mjs");
    await rm(missing);
    if (scenario === "canonical")
      await put(f.workflow, "README.md", "incompatible source change\n");
    if (scenario === "local")
      await put(
        f.workspace,
        ".ai/plans/selected-fix.md",
        "incompatible source plan\n",
      );
    if (scenario === "deletion")
      await put(target, ".ai/docs/removed.md", "unexpected restored file\n");
    if (scenario === "mode") await chmod(readme, 0o777);
    if (scenario === "link") {
      await rm(path.join(target, ".agents/skills/git-commit"));
      await symlink(
        "unexpected",
        path.join(target, ".agents/skills/git-commit"),
      );
    }
    if (scenario === "new commit")
      git(
        f.workflow,
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--allow-empty",
        "-m",
        "new workflow commit",
      );
    if (scenario === "incomplete clone")
      await rm(path.join(target, ".ai/.git/HEAD"));
    if (scenario === "symlink") {
      await rm(readme);
      await symlink(path.join(f.workflow, "README.md"), readme);
    }
    assert.throws(() => copyContext(f, target), undefined, scenario);
    assert.equal(await exists(missing), false, scenario);
    if (scenario !== "symlink")
      assert.deepEqual(await readFile(readme), original, scenario);
  }
});

test("indexed additions deleted from working context remain absent without source index changes", async (t) => {
  const f = await fixture(t, 1);
  await put(
    f.workflow,
    "scripts/staged-deleted.mjs",
    "// staged then deleted\n",
  );
  git(f.workflow, "add", "scripts/staged-deleted.mjs");
  await rm(path.join(f.workflow, "scripts/staged-deleted.mjs"));
  f.canonicalFiles.push("scripts/staged-deleted.mjs");
  const before = await sourceState(f);
  const target = await prepare(f);
  assert.equal(
    await exists(path.join(target, ".ai/scripts/staged-deleted.mjs")),
    false,
  );
  assert.equal(await prepare(f), target);
  assert.deepEqual(await sourceState(f), before);
});

test("canonical filenames and large baseline files survive fresh setup and retry", async (t) => {
  const f = await fixture(t, 1);
  for (const name of ["docs/café.md", "docs/two\nlines.md", "docs/large.txt"]) {
    await put(
      f.workflow,
      name,
      name.endsWith(".txt")
        ? "x".repeat(1100000)
        : "selected canonical source\n",
    );
    git(f.workflow, "add", name);
    f.canonicalFiles.push(name);
  }
  git(
    f.workflow,
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "canonical file fixtures",
  );
  const before = await sourceState(f);
  const target = await prepare(f);
  assert.equal(await prepare(f), target);
  for (const name of ["docs/café.md", "docs/two\nlines.md", "docs/large.txt"])
    assert.deepEqual(
      await readFile(path.join(target, ".ai", name)),
      await readFile(path.join(f.workflow, name)),
    );
  assert.deepEqual(await sourceState(f), before);
});

test("retry refuses missing clone object data before any missing context is copied", async (t) => {
  const f = await fixture(t, 1);
  const target = await prepare(f);
  const copied = path.join(target, ".ai");
  const packs = path.join(copied, ".git/objects/pack");
  const packName = (await readdir(packs)).find((name) =>
    name.endsWith(".pack"),
  );
  const bytes = await readFile(path.join(packs, packName));
  for (const name of await readdir(packs)) await rm(path.join(packs, name));
  execFileSync("git", ["-C", copied, "unpack-objects"], { input: bytes });
  const oid = git(f.workflow, "rev-parse", "HEAD:README.md");
  await rm(path.join(copied, ".git/objects", oid.slice(0, 2), oid.slice(2)));
  const missing = path.join(copied, "scripts/new.mjs");
  await rm(missing);
  assert.throws(() => copyContext(f, target));
  assert.equal(await exists(missing), false);
});

test("retry preserves unexpected selected local and workspace permission edits", async (t) => {
  for (const relative of [".ai/plans/selected-fix.md", "docs/required.md"]) {
    const f = await fixture(t, 1);
    const target = await prepare(f);
    const selected = path.join(target, relative);
    await chmod(selected, 0o777);
    const missing = path.join(target, ".ai/scripts/new.mjs");
    await rm(missing);
    assert.throws(() => copyContext(f, target));
    assert.equal((await lstat(selected)).mode & 0o777, 0o777);
    assert.equal(await exists(missing), false);
  }
});

test("retry rejects shared selected-file inodes before copying context", async (t) => {
  for (const relative of [
    ".ai/README.md",
    ".ai/plans/selected-fix.md",
    "docs/required.md",
  ]) {
    const f = await fixture(t, 1);
    const target = await prepare(f);
    const selected = path.join(target, relative);
    await rm(selected);
    await link(path.join(f.workspace, relative), selected);
    const missing = path.join(target, ".ai/scripts/new.mjs");
    await rm(missing);
    const before = await sourceState(f);
    assert.throws(() => copyContext(f, target));
    assert.equal(await exists(missing), false);
    assert.equal(
      (await lstat(selected)).ino,
      (await lstat(path.join(f.workspace, relative))).ino,
    );
    assert.deepEqual(await sourceState(f), before);
  }
});

// These regressions execute the same preflight and copy entrypoint. Snapshot
// partial task administration too: refusing unsafe retry state must not repair it.
async function contextState(directory) {
  const entries = [];
  async function collect(relative) {
    const full = path.join(directory, relative);
    const stat = await lstat(full, { bigint: true });
    entries.push({
      relative,
      mode: stat.mode,
      mtimeNs: stat.mtimeNs,
      ...(stat.isFile() ? { bytes: await readFile(full) } : {}),
      ...(stat.isSymbolicLink() ? { link: await readlink(full) } : {}),
    });
    if (stat.isDirectory())
      for (const name of (await readdir(full)).sort())
        await collect(path.join(relative, name));
  }
  await collect("");
  return entries;
}

test("retry rejects workflow commondir redirects without changing sources or partial context", async (t) => {
  const f = await fixture(t, 1);
  // A remote in the shared source config would hide this redirect behind the
  // existing remote check. A source without remotes demonstrates the isolation bug.
  git(f.workflow, "remote", "remove", "origin");
  const target = await prepare(f);
  await put(target, ".ai/.git/commondir", `${f.workflow}/.git\n`);
  await rm(path.join(target, ".ai/scripts/new.mjs"));
  const before = await sourceState(f);
  const refs = git(f.workflow, "for-each-ref");
  const taskBefore = await contextState(target);
  for (const checkOnly of [true, false]) {
    assert.throws(
      () => copyContext(f, target, checkOnly),
      /workflow common Git directory/,
    );
    assert.deepEqual(await sourceState(f), before);
    assert.equal(git(f.workflow, "for-each-ref"), refs);
    assert.deepEqual(await contextState(target), taskBefore);
  }
});

test("retry aggregates metadata and independent context blockers without mutation", async (t) => {
  for (const invalidRoot of [false, true]) {
    const f = await fixture(t, 1);
    const target = await prepare(f);
    await rm(path.join(target, ".ai/.git/index"));
    await rm(path.join(target, ".ai/scripts/new.mjs"));
    await put(target, ".ai/README.md", "unexpected task edit\n");
    if (invalidRoot) {
      await rm(path.join(target, ".ai"), { recursive: true });
      await symlink(f.workflow, path.join(target, ".ai"));
    }
    await rm(path.join(target, ".agents/skills/git-commit"));
    await symlink("unexpected", path.join(target, ".agents/skills/git-commit"));
    await put(target, "docs/required.md", "unexpected selected edit\n");
    const before = await sourceState(f);
    const taskBefore = await contextState(target);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        (error) => {
          const expected = [
            invalidRoot
              ? "unsafe directory:"
              : "missing selected context: index",
            "conflicting managed skill: git-commit",
            "conflicting selected file: docs/required.md",
            ...(!invalidRoot ? ["conflicting canonical file: README.md"] : []),
          ];
          for (const message of expected)
            assert.ok(error.message.includes(message), message);
          return true;
        },
      );
      assert.deepEqual(await sourceState(f), before);
      assert.deepEqual(await contextState(target), taskBefore);
    }
  }
});

// Actual Git checkouts inherit umask; selected source metadata is still copied
// exactly. Keep the process-local mask scoped with finally and run serially.
test("fresh setup accepts native checkout modes under restrictive umask", async (t) => {
  const f = await fixture(t, 1);
  await chmod(path.join(f.workspace, "AGENTS.md"), 0o644);
  const before = await sourceState(f);
  const previous = process.umask(0o077);
  try {
    const target = await prepare(f);
    assert.equal(
      (await lstat(path.join(target, "app.txt"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await lstat(path.join(target, "AGENTS.md"))).mode & 0o777,
      0o644,
    );
    assert.equal(await prepare(f), target);
    assert.deepEqual(await sourceState(f), before);
  } finally {
    process.umask(previous);
  }
});

test("interrupted context accepts regular and executable baseline modes under restrictive umask", async (t) => {
  for (const count of [1, 2]) {
    const f = await fixture(t, count);
    await chmod(path.join(f.workspace, "AGENTS.md"), 0o644);
    await put(f.workflow, "scripts/executable.sh", "#!/bin/sh\nexit 0\n");
    await chmod(path.join(f.workflow, "scripts/executable.sh"), 0o755);
    git(f.workflow, "add", "scripts/executable.sh");
    git(
      f.workflow,
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "executable fixture",
    );
    f.canonicalFiles.push("scripts/executable.sh");
    const before = await sourceState(f);
    const previous = process.umask(0o077);
    try {
      const target = await preflight(f);
      await mkdir(path.dirname(target), { recursive: true });
      if (count > 1) await mkdir(target);
      for (const source of f.sources)
        git(
          source,
          "worktree",
          "add",
          "-b",
          "fix/selected-fix",
          count === 1 ? target : path.join(target, path.basename(source)),
          "HEAD",
        );
      const copied = path.join(target, ".ai");
      git(
        f.workspace,
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--no-local",
        "--no-hardlinks",
        "--no-checkout",
        f.workflow,
        copied,
      );
      git(copied, "remote", "remove", "origin");
      git(
        copied,
        "-c",
        "core.hooksPath=/dev/null",
        "checkout",
        "--detach",
        git(f.workflow, "rev-parse", "HEAD"),
      );
      assert.equal(
        (await lstat(path.join(copied, "README.md"))).mode & 0o777,
        0o600,
      );
      assert.equal(
        (await lstat(path.join(copied, "scripts/executable.sh"))).mode & 0o777,
        0o700,
      );
      copyContext(f, target);
      for (const relative of [
        ...f.localFiles,
        ...f.workspaceFiles,
        ...f.canonicalFiles
          .filter((p) => p !== "docs/removed.md")
          .map((p) => `.ai/${p}`),
      ]) {
        assert.deepEqual(
          await readFile(path.join(target, relative)),
          await readFile(path.join(f.workspace, relative)),
        );
        assert.equal(
          (await lstat(path.join(target, relative))).mode,
          (await lstat(path.join(f.workspace, relative))).mode,
        );
      }
      const complete = await contextState(target);
      assert.equal(await prepare(f), target);
      assert.deepEqual(await contextState(target), complete);
      assert.deepEqual(await sourceState(f), before);
    } finally {
      process.umask(previous);
    }
  }
});

test("preflight aggregates missing or unsafe skill sources with independent workspace failures", async (t) => {
  for (const scenario of [
    "missing skills",
    "unsafe skill parent",
    "unsafe workflow root",
  ]) {
    const f = await fixture(t, 1);
    await rm(path.join(f.workspace, "docs/required.md"));
    let expected;
    if (scenario === "missing skills") {
      for (const skill of ["pull-request", "git-commit"])
        await rm(path.join(f.workflow, ".agents/skills", skill, "SKILL.md"));
      expected = [
        ".agents/skills/pull-request/SKILL.md",
        ".agents/skills/git-commit/SKILL.md",
      ];
    } else if (scenario === "unsafe skill parent") {
      await rm(path.join(f.workflow, ".agents/skills"), { recursive: true });
      await symlink(f.workspace, path.join(f.workflow, ".agents/skills"));
      expected = ["unsafe directory:", ".agents/skills"];
    } else {
      const backup = path.join(f.workspace, "workflow-backup");
      await rename(f.workflow, backup);
      await symlink(backup, f.workflow);
      expected = ["unsafe directory:", f.workflow];
    }
    const target = path.join(f.workspace, ".worktrees/selected-fix");
    const before = await contextState(f.workspace);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        (error) => {
          for (const message of [
            ...expected,
            "missing selected context: docs/required.md",
          ])
            assert.ok(
              error.message.includes(message),
              `${scenario}: ${message}`,
            );
          return true;
        },
      );
      assert.equal(await exists(target), false);
      assert.deepEqual(await contextState(f.workspace), before);
    }
  }
});

// Git stores normalized blobs but native checkout bytes can differ. Verify both
// configuration paths against the actual canonical copy block, including edits.
test("retry accepts clean checkout line endings and rejects normalized content edits", async (t) => {
  for (const conversion of ["attributes", "autocrlf"]) {
    const f = await fixture(t, 1);
    if (conversion === "attributes") {
      await put(f.workflow, "docs/.gitattributes", "*.md text eol=crlf\n");
      git(f.workflow, "add", "docs/.gitattributes");
      f.canonicalFiles.push("docs/.gitattributes");
    }
    await put(
      f.workflow,
      "docs/eol.md",
      "baseline first line\nbaseline second line\n",
    );
    git(f.workflow, "add", "docs/eol.md");
    git(
      f.workflow,
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "line ending fixture",
    );
    f.canonicalFiles.push("docs/eol.md");
    await put(f.workflow, "docs/eol.md", "selected current source\n");
    const before = await sourceState(f);
    const previous = {};
    if (conversion === "autocrlf") {
      for (const [name, value] of Object.entries({
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.autocrlf",
        GIT_CONFIG_VALUE_0: "true",
      })) {
        previous[name] = process.env[name];
        process.env[name] = value;
      }
    }
    try {
      const target = await preflight(f);
      git(
        f.workspace,
        "worktree",
        "add",
        "-b",
        "fix/selected-fix",
        target,
        "HEAD",
      );
      const copied = path.join(target, ".ai");
      git(
        f.workspace,
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--no-local",
        "--no-hardlinks",
        "--no-checkout",
        f.workflow,
        copied,
      );
      git(copied, "remote", "remove", "origin");
      git(
        copied,
        "-c",
        "core.hooksPath=/dev/null",
        "checkout",
        "--detach",
        git(f.workflow, "rev-parse", "HEAD"),
      );
      const checkout = await readFile(path.join(copied, "docs/eol.md"), "utf8");
      assert.equal(checkout, "baseline first line\r\nbaseline second line\r\n");
      assert.equal(git(copied, "diff", "--name-only"), "");
      copyContext(f, target, true);
      copyContext(f, target);
      assert.deepEqual(
        await readFile(path.join(copied, "docs/eol.md")),
        await readFile(path.join(f.workflow, "docs/eol.md")),
      );
      assert.deepEqual(
        await readFile(path.join(target, "AGENTS.md")),
        await readFile(path.join(f.workspace, "AGENTS.md")),
      );
      assert.equal(await exists(path.join(copied, "docs/removed.md")), false);
      const complete = await contextState(target);
      copyContext(f, target, true);
      copyContext(f, target);
      assert.deepEqual(await contextState(target), complete);
      await put(copied, "docs/eol.md", "unexpected task edit\r\n");
      await rm(path.join(copied, "scripts/new.mjs"));
      const conflict = await contextState(target);
      for (const checkOnly of [true, false]) {
        assert.throws(
          () => copyContext(f, target, checkOnly),
          /conflicting canonical file: docs\/eol.md/,
        );
        assert.deepEqual(await contextState(target), conflict);
      }
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    assert.deepEqual(await sourceState(f), before);
  }
});

test("SHA-256 workflow clones resume and reverify without changing sources or complete context", async (t) => {
  for (const count of [1, 2]) {
    const f = await fixture(t, count, { workflowObjectFormat: "sha256" });
    const before = await sourceState(f);
    assert.equal(
      git(f.workflow, "rev-parse", "--show-object-format"),
      "sha256",
    );
    const target = await prepare(f);
    const copied = path.join(target, ".ai");
    assert.equal(git(copied, "rev-parse", "--show-object-format"), "sha256");
    const complete = await contextState(target);
    assert.equal(await prepare(f), target);
    assert.deepEqual(await contextState(target), complete);
    await rm(path.join(copied, "scripts/new.mjs"));
    copyContext(f, target, true);
    copyContext(f, target);
    assert.deepEqual(
      await readFile(path.join(copied, "scripts/new.mjs")),
      await readFile(path.join(f.workflow, "scripts/new.mjs")),
    );
    const resumed = await contextState(target);
    assert.equal(await prepare(f), target);
    assert.deepEqual(await contextState(target), resumed);
    assert.deepEqual(await sourceState(f), before);
    git(copied, "config", "extensions.objectformat", "sha1");
    const incompatible = await contextState(target);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        /incompatible workflow Git config/,
      );
      assert.deepEqual(await contextState(target), incompatible);
    }
    assert.deepEqual(await sourceState(f), before);
  }
});

// Baseline normalization must stay tied to the recorded commit while selected
// attributes are overlaid. New rules must not turn an actual task edit into base.
test("retry uses recorded attributes after an interrupted attribute overlay", async (t) => {
  for (const forward of [true, false]) {
    const f = await fixture(t, 1);
    const baseAttributes = forward ? "*.md text eol=crlf\n" : "*.md -text\n";
    const selectedAttributes = forward
      ? "*.md -text\n"
      : "*.md text eol=crlf\n";
    await put(f.workflow, "docs/.gitattributes", baseAttributes);
    await put(f.workflow, "docs/baseline.md", "recorded baseline\n");
    git(f.workflow, "add", "docs/.gitattributes", "docs/baseline.md");
    git(
      f.workflow,
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "recorded attributes fixture",
    );
    f.canonicalFiles.push("docs/.gitattributes", "docs/baseline.md");
    await put(f.workflow, "docs/.gitattributes", selectedAttributes);
    await put(f.workflow, "docs/baseline.md", "selected source bytes\n");
    const before = await sourceState(f);
    const target = await preflight(f);
    git(
      f.workspace,
      "worktree",
      "add",
      "-b",
      "fix/selected-fix",
      target,
      "HEAD",
    );
    const copied = path.join(target, ".ai");
    git(
      f.workspace,
      "-c",
      "core.hooksPath=/dev/null",
      "clone",
      "--no-local",
      "--no-hardlinks",
      "--no-checkout",
      f.workflow,
      copied,
    );
    git(copied, "remote", "remove", "origin");
    git(
      copied,
      "-c",
      "core.hooksPath=/dev/null",
      "checkout",
      "--detach",
      git(f.workflow, "rev-parse", "HEAD"),
    );
    assert.equal(
      await readFile(path.join(copied, "docs/baseline.md"), "utf8"),
      forward ? "recorded baseline\r\n" : "recorded baseline\n",
    );
    // Reproduce a failure immediately after the authoritative cp -p operation.
    run(
      f.workspace,
      "cp",
      "-p",
      path.join(f.workflow, "docs/.gitattributes"),
      path.join(copied, "docs/.gitattributes"),
    );
    if (!forward)
      await put(copied, "docs/baseline.md", "recorded baseline\r\n");
    const partial = await contextState(target);
    if (forward) {
      copyContext(f, target, true);
      assert.deepEqual(await contextState(target), partial);
      copyContext(f, target);
      for (const relative of ["docs/.gitattributes", "docs/baseline.md"])
        assert.deepEqual(
          await readFile(path.join(copied, relative)),
          await readFile(path.join(f.workflow, relative)),
        );
      assert.equal(await exists(path.join(copied, "docs/removed.md")), false);
      const complete = await contextState(target);
      copyContext(f, target, true);
      copyContext(f, target);
      assert.deepEqual(await contextState(target), complete);
      await put(copied, "docs/baseline.md", "unexpected task edit\r\n");
    }
    const conflict = await contextState(target);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        /conflicting canonical file: docs\/baseline.md/,
      );
      assert.deepEqual(await contextState(target), conflict);
      assert.deepEqual(await sourceState(f), before);
    }
  }
});

test("reftable clone defaults support interrupted recovery and completed reverification", async (t) => {
  for (const [count, objectFormat] of [
    [1, "sha1"],
    [2, "sha256"],
  ]) {
    const f = await fixture(t, count, { workflowObjectFormat: objectFormat });
    const before = await sourceState(f);
    const previous = {};
    for (const [name, value] of Object.entries({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "init.defaultRefFormat",
      GIT_CONFIG_VALUE_0: "reftable",
    })) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      const target = await prepare(f);
      const copied = path.join(target, ".ai");
      assert.equal(git(copied, "config", "extensions.refstorage"), "reftable");
      assert.equal(git(copied, "rev-parse", "--show-ref-format"), "reftable");
      assert.equal(
        git(copied, "rev-parse", "--show-object-format"),
        objectFormat,
      );
      const complete = await contextState(target);
      for (const checkOnly of [true, false]) copyContext(f, target, checkOnly);
      assert.deepEqual(await contextState(target), complete);
      await rm(path.join(copied, "scripts/new.mjs"));
      copyContext(f, target, true);
      copyContext(f, target);
      assert.deepEqual(
        await readFile(path.join(copied, "scripts/new.mjs")),
        await readFile(path.join(f.workflow, "scripts/new.mjs")),
      );
      const resumed = await contextState(target);
      assert.equal(await prepare(f), target);
      assert.deepEqual(await contextState(target), resumed);
      assert.deepEqual(await sourceState(f), before);
      git(copied, "config", "extensions.refstorage", "unknown");
      const incompatible = await contextState(target);
      for (const checkOnly of [true, false]) {
        assert.throws(
          () => copyContext(f, target, checkOnly),
          /incompatible workflow Git config/,
        );
        assert.deepEqual(await contextState(target), incompatible);
      }
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    assert.deepEqual(await sourceState(f), before);
  }
});

// An unplanned info/attributes file has higher precedence than --attr-source.
// It must never turn edited task bytes into proof that they match the base.
test("retry rejects task-local attribute overrides without overwriting task edits", async (t) => {
  const f = await fixture(t, 1);
  await put(f.workflow, "docs/.gitattributes", "*.md -text\n");
  await put(f.workflow, "docs/proof.md", "recorded baseline\n");
  git(f.workflow, "add", "docs/.gitattributes", "docs/proof.md");
  git(
    f.workflow,
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "literal baseline fixture",
  );
  f.canonicalFiles.push("docs/.gitattributes", "docs/proof.md");
  await put(f.workflow, "docs/proof.md", "selected source bytes\n");
  const target = await prepare(f);
  const copied = path.join(target, ".ai");
  await put(copied, "docs/proof.md", "recorded baseline\r\n");
  await rm(path.join(copied, "scripts/new.mjs"));
  assert.throws(
    () => copyContext(f, target, true),
    /conflicting canonical file: docs\/proof.md/,
  );
  for (const override of ["docs/proof.md text\n", ""]) {
    await put(copied, ".git/info/attributes", override);
    const sourceBefore = await sourceState(f);
    const taskBefore = await contextState(target);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        /workflow attribute overrides are forbidden/,
      );
      assert.deepEqual(await contextState(target), taskBefore);
      assert.deepEqual(await sourceState(f), sourceBefore);
      assert.equal(await exists(path.join(copied, "scripts/new.mjs")), false);
    }
  }
});

// Local stat evidence is independent of clone metadata and content comparison.
// Report impossible permissions even when later comparison is skipped or fails.
test("retry reports incompatible permissions alongside metadata and content blockers", async (t) => {
  for (const invalidConfig of [true, false]) {
    const f = await fixture(t, 1);
    const target = await prepare(f);
    const copied = path.join(target, ".ai");
    await put(copied, "README.md", "unexpected canonical edit\n");
    await chmod(path.join(copied, "README.md"), 0o777);
    await put(target, "docs/required.md", "unexpected selected edit\n");
    await chmod(path.join(target, "docs/required.md"), 0o777);
    await rm(path.join(copied, "scripts/new.mjs"));
    if (invalidConfig) git(copied, "config", "unexpected.setting", "fixture");
    const sourceBefore = await sourceState(f);
    const taskBefore = await contextState(target);
    for (const checkOnly of [true, false]) {
      assert.throws(
        () => copyContext(f, target, checkOnly),
        (error) => {
          for (const message of [
            "conflicting canonical mode: README.md",
            "conflicting selected mode: docs/required.md",
            "conflicting selected file: docs/required.md",
            invalidConfig
              ? "incompatible workflow Git config"
              : "conflicting canonical file: README.md",
          ])
            assert.ok(error.message.includes(message), message);
          return true;
        },
      );
      assert.deepEqual(await contextState(target), taskBefore);
      assert.deepEqual(await sourceState(f), sourceBefore);
      assert.equal(await exists(path.join(copied, "scripts/new.mjs")), false);
    }
  }
});

// Recorded object IDs are immutable proof only when replacement lookup is off.
// Demonstrate the false-baseline conversion in native Git before exercising the
// canonical procedure, then prove both modes leave the edit and refs untouched.
test("retry preserves task edits when replacement refs alter recorded attributes", async (t) => {
  for (const scenario of [
    { count: 1, objectFormat: "sha1", refFormat: "files", packed: false },
    { count: 2, objectFormat: "sha256", refFormat: "files", packed: true },
    {
      count: 1,
      objectFormat: "sha1",
      refFormat: "reftable",
      namespace: "refs/task-replacements/",
    },
  ]) {
    const f = await fixture(t, scenario.count, {
      workflowObjectFormat: scenario.objectFormat,
    });
    await put(f.workflow, "docs/.gitattributes", "proof.md -text\n");
    await put(f.workflow, "docs/proof.md", "recorded baseline\n");
    git(f.workflow, "add", "docs/.gitattributes", "docs/proof.md");
    git(
      f.workflow,
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "replacement baseline fixture",
    );
    f.canonicalFiles.push("docs/.gitattributes", "docs/proof.md");
    await put(f.workflow, "docs/proof.md", "selected source bytes\n");
    await put(
      f.workspace,
      ".fixture-bin/replacement-attributes",
      "proof.md text\n",
    );
    const previous = {};
    for (const name of [
      "GIT_NO_REPLACE_OBJECTS",
      "GIT_REPLACE_REF_BASE",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
    ])
      previous[name] = process.env[name];
    delete process.env.GIT_NO_REPLACE_OBJECTS;
    delete process.env.GIT_REPLACE_REF_BASE;
    Object.assign(process.env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "init.defaultRefFormat",
      GIT_CONFIG_VALUE_0: scenario.refFormat,
    });
    try {
      const target = await prepare(f);
      const copied = path.join(target, ".ai");
      const proof = path.join(copied, "docs/proof.md");
      await put(copied, "docs/proof.md", "recorded baseline\r\n");
      await rm(path.join(copied, "scripts/new.mjs"));
      assert.throws(
        () => copyContext(f, target, true),
        /conflicting canonical file: docs\/proof.md/,
      );
      const recordedHead = git(f.workflow, "rev-parse", "HEAD");
      const originalAttributes = git(
        f.workflow,
        "rev-parse",
        "HEAD:docs/.gitattributes",
      );
      const originalProof = git(f.workflow, "rev-parse", "HEAD:docs/proof.md");
      const replacement = git(
        copied,
        "hash-object",
        "-w",
        "--no-filters",
        "--",
        path.join(f.workspace, ".fixture-bin/replacement-attributes"),
      );
      if (scenario.namespace)
        process.env.GIT_REPLACE_REF_BASE = scenario.namespace;
      git(copied, "replace", originalAttributes, replacement);
      if (scenario.packed) git(copied, "pack-refs", "--all");
      assert.equal(
        git(
          copied,
          `--attr-source=${recordedHead}`,
          "hash-object",
          "--path=docs/proof.md",
          "--",
          proof,
        ),
        originalProof,
      );
      assert.notEqual(
        git(
          copied,
          "--no-replace-objects",
          `--attr-source=${recordedHead}`,
          "hash-object",
          "--path=docs/proof.md",
          "--",
          proof,
        ),
        originalProof,
      );
      const sourceBefore = await sourceState(f);
      const taskBefore = await contextState(target);
      for (const checkOnly of [true, false]) {
        assert.throws(
          () => copyContext(f, target, checkOnly),
          /conflicting canonical file: docs\/proof.md/,
        );
        assert.deepEqual(await contextState(target), taskBefore);
        assert.deepEqual(await sourceState(f), sourceBefore);
        assert.equal(await exists(path.join(copied, "scripts/new.mjs")), false);
      }
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
});

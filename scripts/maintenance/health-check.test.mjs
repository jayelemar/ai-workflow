import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseHealthCheckArgs,
  runHealthCheck,
  workflowRoot,
} from "./health-check.mjs";

const bootstrapPaths = [
  ".codex/config.toml",
  ".gitignore",
  ".husky/pre-commit",
  ".husky/pre-push",
  "AGENTS.md",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
];

const localInstructionPaths = [
  "instructions/admin.md",
  "instructions/local/architecture.md",
  "instructions/auth.md",
  "instructions/backend.md",
  "instructions/i18n.md",
  "instructions/pull-requests.md",
  "instructions/supabase.md",
  "instructions/ui.md",
  "instructions/web.md",
  "instructions/workers.md",
];

const writeFixtureFile = async (
  root,
  relativePath,
  content = "# fixture\n",
) => {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

const createFixture = async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "ai-health-check-"),
  );
  const root = path.join(temporaryRoot, ".ai");
  await mkdir(path.join(temporaryRoot, ".git"), { recursive: true });
  const sourcePaths = [
    ...bootstrapPaths,
    ".agents/skills/create-plan/SKILL.md",
    ".agents/skills/create-plan/agents/openai.yaml",
    ".agents/skills/create-plan/references/plan-template.md",
    "instructions/shared/plan-review.md",
    ...["worktree-setup", "git-commit", "pull-request"].flatMap((name) => [
      `.agents/skills/${name}/SKILL.md`,
      `.agents/skills/${name}/agents/openai.yaml`,
    ]),
    "prompts/setup-local-codex.md",
    "prompts/worktree-cleanup.md",
    "prompts/skill-discovery.md",
    "prompts/manage-instructions.md",
    "instructions/shared/testing.md",
    "instructions/mobile/ui.md",
    "instructions/desktop/electron/qa.md",
    "instructions/web/wcag.md",
    "instructions/server/security.md",
    "scripts/check.test.mjs",
  ];
  for (const relativePath of sourcePaths) {
    await writeFixtureFile(root, relativePath);
  }
  await writeFixtureFile(
    root,
    ".codex/config.toml",
    'model = "fixture-model"\n[agents]\ndefault_subagent_model = "fixture-model"\ndefault_subagent_reasoning_effort = "high"\n',
  );
  for (const relativePath of localInstructionPaths) {
    await writeFixtureFile(root, relativePath);
  }
  await writeFixtureFile(
    root,
    "instructions/index.md",
    "# Index Instructions\n\n## Rules\n\n- Load `shared/testing.md`, `local/architecture.md`, `mobile/ui.md`, `desktop/electron/qa.md`, `web/wcag.md`, and `server/security.md` for guidance checks.\n",
  );
  return { root, sourcePaths, temporaryRoot };
};

const createCommandExecutor = ({
  root,
  sourcePaths,
  nestedGitInAncestor = false,
  nestedGitError,
  parentGit = true,
  parentGitError,
  parentTrackedPaths = [],
  localTrackedPaths = [],
  ignoredPaths = [],
  commands = [],
}) => {
  const localInstructionPathsWithIndex = new Set([
    "instructions/index.md",
    ...localInstructionPaths,
  ]);
  const localOnlyRoots = [
    "artifacts",
    "logs",
    "plans",
    "specs",
    "state",
    "tmp",
  ];
  const isInPathspec = (candidate, pathspec) =>
    candidate === pathspec || candidate.startsWith(`${pathspec}/`);
  const isLocalPath = (candidate) =>
    candidate === "instructions/.health-check-probe.md" ||
    candidate.startsWith("instructions/local/") ||
    candidate === "instructions/areas" ||
    candidate.startsWith("instructions/areas/") ||
    localInstructionPathsWithIndex.has(candidate) ||
    localOnlyRoots.some((localRoot) => isInPathspec(candidate, localRoot));
  const result = (exitCode, stdout = "", stderr = "") => ({
    exitCode,
    stdout,
    stderr,
  });

  return async (command) => {
    commands.push(command);
    if (command.command !== "git") return result(0);

    const [operation] = command.args;
    if (operation === "rev-parse") {
      if (command.cwd === root) {
        if (nestedGitError) return result(128, "", nestedGitError);
        return result(
          0,
          `${nestedGitInAncestor ? path.dirname(root) : root}\n`,
        );
      }
      if (parentGitError) return result(128, "", parentGitError);
      return parentGit
        ? result(0, `${path.dirname(root)}\n`)
        : result(128, "", "fatal: not a git repository");
    }
    if (operation === "check-ignore") {
      const target = command.args.at(-1);
      if (ignoredPaths.includes(target)) return result(1);
      return result(isLocalPath(target) ? 0 : 1);
    }
    if (operation === "ls-files") {
      const pathspecs = command.args.slice(command.args.indexOf("--") + 1);
      const paths =
        command.cwd === path.dirname(root)
          ? parentTrackedPaths
          : [...sourcePaths, ...localTrackedPaths].filter((sourcePath) =>
              pathspecs.some((pathspec) => isInPathspec(sourcePath, pathspec)),
            );
      return result(0, paths.join("\0") + (paths.length > 0 ? "\0" : ""));
    }
    return result(1, "", "unexpected git command");
  };
};

const runFixture = async (options = {}) => {
  const fixture = await createFixture();
  if (options.parentGit === false) {
    await rm(path.join(fixture.temporaryRoot, ".git"), {
      force: true,
      recursive: true,
    });
  }
  const output = [];
  const commands = [];
  const commandExecutor = createCommandExecutor({
    ...fixture,
    commands,
    ...options,
  });
  const result = await runHealthCheck({
    args: options.args ?? [],
    commandExecutor,
    stderr: (message) => output.push(message),
    stdout: (message) => output.push(message),
    workflowDirectory: fixture.root,
  });
  return { ...fixture, commands, output, result };
};

const withFixture = async (callback) => {
  const fixture = await createFixture();
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

const inspectFixture = async (
  fixture,
  commandExecutor = createCommandExecutor(fixture),
) => {
  const output = [];
  const result = await runHealthCheck({
    commandExecutor,
    stderr: (message) => output.push(message),
    stdout: (message) => output.push(message),
    workflowDirectory: fixture.root,
  });
  return { result, output: output.join("\n") };
};

test("nested routes are required, including wrapped Load bullets", async (t) => {
  for (const kind of [
    "missing",
    "directory",
    "valid",
    "escape-link",
    "escape-directory",
  ]) {
    await t.test(kind, () =>
      withFixture(async (fixture) => {
        const route = "areas/native-qa.md";
        await writeFixtureFile(
          fixture.root,
          "instructions/index.md",
          `# Index\n\n## Rules\n\n- Load \`local/architecture.md\` and\n  \`${route}\` for native QA.\n`,
        );
        const target = path.join(fixture.root, "instructions", route);
        await mkdir(path.dirname(target), { recursive: true });
        if (kind === "directory") await mkdir(target);
        if (kind === "valid") await writeFile(target, "# QA\n");
        if (kind.startsWith("escape")) {
          const outside = path.join(fixture.temporaryRoot, "outside");
          await mkdir(outside);
          await writeFile(path.join(outside, "native-qa.md"), "# Outside\n");
          if (kind === "escape-link")
            await symlink(path.join(outside, "native-qa.md"), target);
          else {
            await rm(path.dirname(target), { recursive: true });
            await symlink(outside, path.dirname(target));
          }
        }
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, kind === "valid", output);
        if (kind !== "valid") assert.match(output, /instruction route/);
      }),
    );
  }
});

test("unsafe relative and absolute Markdown routes fail closed", async (t) => {
  for (const route of [
    "../outside.md",
    "areas/../../outside.md",
    "/tmp/outside.md",
    "C:\\outside.md",
  ]) {
    await t.test(route, () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "instructions/index.md",
          `# Index\n\n## Rules\n\n- Load \`${route}\` for guidance.\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, false, output);
        assert.match(output, /unsafe instruction route/);
      }),
    );
  }
});

test("configuration presence, syntax, shape, tracking and allowlisting are checked", async (t) => {
  const cases = [
    ["missing", null],
    ["syntax", 'model = "private-fixture-value\n'],
    ["duplicate", 'model = "private-fixture-value"\nmodel = "other"\n'],
    ["shape", "model = 17\n"],
    ["agents-table", 'model = "fixture"\nagents = "private-fixture-value"\n'],
    [
      "agent-fields",
      'model = "fixture"\n[agents]\ndefault_subagent_model = 1\ndefault_subagent_reasoning_effort = "high"\n',
    ],
    ["untracked", undefined],
    ["ignored", undefined],
    [
      "valid",
      '# comment\nmodel = "unverified-runtime-model"\n[agents]\ndefault_subagent_model = "fixture" # comment\ndefault_subagent_reasoning_effort = "high"\n',
    ],
  ];
  for (const [kind, content] of cases) {
    await t.test(kind, () =>
      withFixture(async (fixture) => {
        const target = path.join(fixture.root, ".codex/config.toml");
        if (content === null) await unlink(target);
        else if (content !== undefined) await writeFile(target, content);
        if (kind === "untracked")
          fixture.sourcePaths = fixture.sourcePaths.filter(
            (p) => p !== ".codex/config.toml",
          );
        const base = createCommandExecutor(fixture);
        const executor = async (command) =>
          kind === "ignored" &&
          command.args[0] === "check-ignore" &&
          command.args.at(-1) === ".codex/config.toml"
            ? { exitCode: 0, stdout: "", stderr: "" }
            : base(command);
        const { result, output } = await inspectFixture(fixture, executor);
        assert.equal(result.ok, kind === "valid", output);
        assert.doesNotMatch(output, /private-fixture-value/);
        if (kind !== "valid") assert.match(output, /config\.toml/);
      }),
    );
  }
});

test("Markdown references accept local paths, fragments, images and definitions", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(fixture.root, "AGENTS.md", "# Current *rules*\n");
    await writeFixtureFile(
      fixture.root,
      "README.md",
      [
        "# Overview",
        "",
        "[same document](#overview)",
        '[local](AGENTS.md?raw=1#current-rules "title")',
        "[root relative](/AGENTS.md#current-rules)",
        "[directory](instructions/)",
        "[non-Markdown fragment](package.json#ignored-fragment)",
        "[non-Markdown invalid fragment](package.json#bad%ZZ)",
        "![image](package.json)",
        "[reference][GUIDE] and ![reference image][asset]",
        "",
        "[guide]: AGENTS.md#current-rules",
        "[asset]: package.json",
        "",
      ].join("\n"),
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references reject missing inline, image and reference targets", async (t) => {
  for (const source of [
    "[missing](missing.md)",
    "![missing](missing.png)",
    "[missing][guide]\n\n[guide]: missing.md",
    "![missing][guide]\n\n[guide]: missing.md",
    "[missing](/missing.md)",
  ]) {
    await t.test(source.split("\n")[0], () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `# Overview\n\n${source}\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, false, output);
        assert.match(output, /invalid local Markdown references/);
        assert.match(output, /README\.md:3/);
        assert.match(output, /missing\.(md|png)/);
      }),
    );
  }
});

test("Markdown references reject missing headings in default and full health", async (t) => {
  for (const args of [[], ["--full"]]) {
    await t.test(args[0] ?? "default", () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(fixture.root, "AGENTS.md", "# Current rules\n");
        await writeFixtureFile(
          fixture.root,
          "README.md",
          "# Overview\n\n[removed](AGENTS.md#removed-heading)\n",
        );
        const output = [];
        const result = await runHealthCheck({
          args,
          workflowDirectory: fixture.root,
          commandExecutor: createCommandExecutor(fixture),
          stdout: (message) => output.push(message),
          stderr: (message) => output.push(message),
        });
        assert.equal(result.ok, false, output.join("\n"));
        assert.match(output.join("\n"), /README\.md:3/);
        assert.match(output.join("\n"), /AGENTS\.md#removed-heading/);
      }),
    );
  }
});

test("Markdown references use formatted, Unicode, setext and unique heading IDs", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "AGENTS.md",
      [
        "# API: `Read` & *Write*",
        "# Café workflow",
        "",
        "Setext heading",
        "--------------",
        "",
        "# Same",
        "# Same",
        "# Same-1",
        "",
      ].join("\n"),
    );
    await writeFixtureFile(
      fixture.root,
      "README.md",
      [
        "# Overview",
        "",
        "[formatting](AGENTS.md#api-read--write)",
        "[Unicode](AGENTS.md#caf%C3%A9-workflow)",
        "[setext](AGENTS.md#setext-heading)",
        "[first](AGENTS.md#same)",
        "[duplicate](AGENTS.md#same-1)",
        "[collision](AGENTS.md#same-1-1)",
        "",
      ].join("\n"),
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown heading text includes inline and reference image descriptions", async (t) => {
  for (const heading of ["![Logo](package.json)", "![Logo][asset]"]) {
    await t.test(heading, () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "AGENTS.md",
          `# ${heading} Title\n\n[asset]: package.json\n`,
        );
        await writeFixtureFile(
          fixture.root,
          "README.md",
          "[heading](AGENTS.md#logo-title)\n",
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, true, output);
      }),
    );
  }
});

test("Markdown references decode local paths and parse balanced parentheses", async () => {
  await withFixture(async (fixture) => {
    const target = "prompts/example (copy).md";
    await writeFixtureFile(fixture.root, target, "# Details\n");
    fixture.sourcePaths.push(target);
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\n[details](prompts/example%20(copy).md#details)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references ignore code, comments and unused definitions", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      [
        "# Overview",
        "",
        "`[inline example](missing-inline.md)`",
        "",
        "````md",
        "[fenced example](missing-fenced.md)",
        "```text",
        "[nested example](missing-nested.md)",
        "```",
        "````",
        "",
        "<!-- [hidden](missing-comment.md) -->",
        "",
        "[unused]: missing-unused.md",
        "",
      ].join("\n"),
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references ignore links in unused footnotes", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\n[^unused]: [example](missing.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references reject phantom headings from unused footnotes", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Topic\n\n[^unused]:\n    # Topic\n\n[broken](#topic-1)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /README\.md:6: missing heading "README\.md#topic-1"/);
  });
});

test("Markdown references validate links in referenced footnotes", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\nRead[^note].\n\n[^note]: [broken](missing.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /README\.md:5: missing local target "missing\.md"/);
  });
});

test("Markdown references follow transitive case-insensitive footnote references", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\nRead[^FIRST].\n\n[^first]: See[^SECOND].\n\n[^second]: [broken](missing.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /README\.md:7: missing local target "missing\.md"/);
  });
});

test("Markdown references ignore unreachable footnote reference cycles", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\n[^first]: See[^second].\n\n[^second]: See[^first] and [hidden](missing.md).\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references process reachable cyclic footnotes once", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\nRead[^first] and repeat[^first].\n\n[^first]: See[^second] and [body](#overview).\n\n[^second]: See[^first].\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references collect footnote headings after body headings", async (t) => {
  for (const [fragment, expected] of [
    ["topic-2", true],
    ["topic-1-1", false],
  ]) {
    await t.test(fragment, () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `[^note]:\n    # Topic\n\n# Topic\n\n# Topic-1\n\nRead[^note].\n\n[heading](#${fragment})\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, expected, output);
        if (!expected) assert.match(output, /missing heading/);
      }),
    );
  }
});

test("Markdown references collect footnotes in first-reference order", async (t) => {
  for (const [fragment, expected] of [
    ["topic-1-1", true],
    ["topic-2", false],
  ]) {
    await t.test(fragment, () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `[^first]:\n    # Topic-1\n\n[^second]:\n    # Topic\n\n# Topic\n\nSecond[^second], then first[^first].\n\n[heading](#${fragment})\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, expected, output);
        if (!expected) assert.match(output, /missing heading/);
      }),
    );
  }
});

test("Markdown references keep link definitions global inside unused footnotes", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\n[broken][global]\n\n[^unused]:\n    [global]: missing.md\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /README\.md:3: missing local target "missing\.md"/);
  });
});

test("Markdown references use the first matching footnote definition", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\nRead[^note].\n\n[^note]: [body](#overview)\n\n[^note]: [unused](missing.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references ignore front matter with or without a UTF-8 BOM", async (t) => {
  for (const prefix of ["", "\uFEFF"]) {
    await t.test(prefix ? "with BOM" : "without BOM", () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `${prefix}---\ntitle: '[example](missing-frontmatter.md)'\n---\n\n# Overview\n\n[section](#overview)\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, true, output);
      }),
    );
  }
});

test("Markdown references still reject broken body links after BOM front matter", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "\uFEFF---\ntitle: '[example](missing-frontmatter.md)'\n---\n\n# Overview\n\n[broken](missing-body.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(
      output,
      /README\.md:7: missing local target "missing-body\.md"/,
    );
    assert.doesNotMatch(output, /missing-frontmatter/);
  });
});

test("Markdown references do not count fenced examples as document headings", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "# Overview\n\n[example](#example-heading)\n\n```md\n# Example heading\n```\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /README\.md:3/);
    assert.match(output, /#example-heading/);
  });
});

test("Markdown references reject nonexistent duplicate heading IDs", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(fixture.root, "AGENTS.md", "# Repeat\n# Repeat\n");
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "[missing](AGENTS.md#repeat-2)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /AGENTS\.md#repeat-2/);
  });
});

test("Markdown references skip URLs, outside-root links and optional runtime records", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "README.md",
      [
        "# Overview",
        "",
        "[web](https://example.invalid/missing.md#heading)",
        "[email](mailto:example@example.invalid)",
        "[network](//example.invalid/missing.md)",
        "[sibling](../missing.md#heading)",
        "[encoded sibling](%2E%2E/missing.md#heading)",
        "[excluded fragment](../missing.md#bad%ZZ)",
        "[plan](plans/not-created.md#pending)",
        "[excluded plan fragment](plans/not-created.md#bad%ZZ)",
        "[artifact](/artifacts/not-created.png)",
        "",
      ].join("\n"),
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references skip symlinks whose real target is outside the workflow", async () => {
  await withFixture(async (fixture) => {
    const outside = path.join(fixture.temporaryRoot, "outside.md");
    await writeFile(outside, "# Outside\n\n[unread](missing-private.md)\n");
    await symlink(
      outside,
      path.join(fixture.root, "instructions/local/outside.md"),
    );
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "[outside](instructions/local/outside.md#bad%ZZ)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references skip missing children under outside-root directory symlinks", async (t) => {
  for (const reference of [
    "instructions/local/app/missing.md",
    "instructions/local/app/not-created/deeper.md#missing",
    "/instructions/local/app/missing.md#bad%ZZ",
  ]) {
    await t.test(reference, () =>
      withFixture(async (fixture) => {
        const outside = path.join(fixture.temporaryRoot, "sibling-app");
        await mkdir(outside);
        await symlink(
          outside,
          path.join(fixture.root, "instructions/local/app"),
          "dir",
        );
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `[outside](${reference})\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, true, output);
      }),
    );
  }
});

test("Markdown references reject missing children under inside-root directory symlinks", async () => {
  await withFixture(async (fixture) => {
    const inside = path.join(fixture.root, "instructions/local/owned");
    await mkdir(inside);
    await symlink(
      inside,
      path.join(fixture.root, "instructions/local/app"),
      "dir",
    );
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "[missing](instructions/local/app/missing.md)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(
      output,
      /missing local target "instructions\/local\/app\/missing\.md"/,
    );
  });
});

test("Markdown references reject missing targets returning inside through symlink chains", async (t) => {
  for (const kind of ["file", "dir"]) {
    for (const form of ["absolute", "relative"]) {
      await t.test(`${kind}: ${form}`, () =>
        withFixture(async (fixture) => {
          const outside = path.join(fixture.temporaryRoot, "sibling-app");
          await mkdir(outside);
          await symlink(
            outside,
            path.join(fixture.root, "instructions/local/app"),
            "dir",
          );
          const missing = path.join(fixture.root, "missing-inside");
          await symlink(
            form === "absolute" ? missing : path.relative(outside, missing),
            path.join(outside, "back"),
            kind,
          );
          const reference = `instructions/local/app/back${kind === "dir" ? "/nested/missing.md" : ""}`;
          await writeFixtureFile(
            fixture.root,
            "README.md",
            `[inside](${reference})\n`,
          );
          const { result, output } = await inspectFixture(fixture);
          assert.equal(result.ok, false, output);
          assert.match(output, /invalid local Markdown references/);
          assert.match(output, /missing local target/);
        }),
      );
    }
  }
});

test("Markdown references skip dangling symlinks pointing outside the workflow", async (t) => {
  for (const kind of ["file", "dir"]) {
    for (const form of ["absolute", "relative"]) {
      await t.test(`${kind}: ${form}`, () =>
        withFixture(async (fixture) => {
          const outside = path.join(fixture.temporaryRoot, "sibling-app");
          await mkdir(outside);
          const missing = path.join(outside, "not-created");
          const local = path.join(fixture.root, "instructions/local");
          await symlink(
            form === "absolute" ? missing : path.relative(local, missing),
            path.join(local, "external-link"),
            kind,
          );
          const reference = `instructions/local/external-link${kind === "dir" ? "/nested/missing.md" : ""}`;
          await writeFixtureFile(
            fixture.root,
            "README.md",
            `[outside](${reference})\n`,
          );
          const { result, output } = await inspectFixture(fixture);
          assert.equal(result.ok, true, output);
        }),
      );
    }
  }
});

test("Markdown references follow repeated directory aliases before an outside target", async () => {
  await withFixture(async (fixture) => {
    const local = path.join(fixture.root, "instructions/local");
    await symlink(".", path.join(local, "repeat"), "dir");
    await symlink(
      path.join(fixture.temporaryRoot, "not-created.md"),
      path.join(local, "external-link"),
    );
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "[outside](instructions/local/repeat/repeat/external-link)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, true, output);
  });
});

test("Markdown references reject cyclic symlink targets", async () => {
  await withFixture(async (fixture) => {
    const local = path.join(fixture.root, "instructions/local");
    await symlink("cycle-b", path.join(local, "cycle-a"));
    await symlink("cycle-a", path.join(local, "cycle-b"));
    await writeFixtureFile(
      fixture.root,
      "README.md",
      "[cycle](instructions/local/cycle-a)\n",
    );
    const { result, output } = await inspectFixture(fixture);
    assert.equal(result.ok, false, output);
    assert.match(output, /missing local target/);
  });
});

test("Markdown references validate headings after returning symlinks", async (t) => {
  for (const [fragment, expected] of [
    ["fixture", true],
    ["missing", false],
  ]) {
    await t.test(fragment, () =>
      withFixture(async (fixture) => {
        const outside = path.join(fixture.temporaryRoot, "sibling-app");
        await mkdir(outside);
        await symlink(
          outside,
          path.join(fixture.root, "instructions/local/app"),
          "dir",
        );
        await symlink(
          path.join(fixture.root, "AGENTS.md"),
          path.join(outside, "back.md"),
        );
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `[inside](instructions/local/app/back.md#${fragment})\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, expected, output);
        if (!expected) assert.match(output, /missing heading/);
      }),
    );
  }
});

test("Markdown reference diagnostics omit query values and source excerpts", async (t) => {
  for (const reference of [
    "AGENTS.md?token=private-fixture-value#missing",
    "bad%ZZ.md?token=private-fixture-value",
    "AGENTS.md#bad%ZZ",
  ]) {
    await t.test(reference.split("?")[0], () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(
          fixture.root,
          "README.md",
          `[reference](${reference})\n`,
        );
        const { result, output } = await inspectFixture(fixture);
        assert.equal(result.ok, false, output);
        assert.match(output, /README\.md:1/);
        assert.doesNotMatch(output, /private-fixture-value|token=/);
      }),
    );
  }
});

test("health check accepts only default, full, and help modes", () => {
  assert.deepEqual(parseHealthCheckArgs([]), { full: false });
  assert.deepEqual(parseHealthCheckArgs(["--full"]), { full: true });
  assert.deepEqual(parseHealthCheckArgs(["--help"]), {
    help: true,
    full: false,
  });
  assert.match(
    parseHealthCheckArgs(["--runner-tests"]).error,
    /Unknown option/,
  );
});

test("health check root is derived from the script location", () => {
  const expectedRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  assert.equal(workflowRoot, expectedRoot);
});

test("help is independent of the caller working directory", async () => {
  const output = [];
  const result = await runHealthCheck({
    args: ["--help"],
    commandExecutor: async () => {
      throw new Error("help must not run commands");
    },
    stdout: (message) => output.push(message),
    stderr: (message) => output.push(message),
  });

  assert.equal(result.ok, true);
  assert.equal(result.root, workflowRoot);
  assert.match(output.join("\n"), /health-check\.mjs \[--full\]/);
});

test("full health performs formatting and every discovered script test", async () => {
  const fixture = await runFixture({ args: ["--full"] });
  try {
    assert.equal(fixture.result.ok, true, fixture.output.join("\n"));
    assert.ok(
      fixture.commands.some(
        (command) =>
          command.command === "pnpm" && command.args.includes("prettier"),
      ),
    );
    assert.ok(
      fixture.commands.some(
        (command) =>
          command.command === process.execPath &&
          command.args.includes("scripts/check.test.mjs"),
      ),
    );
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails when a canonical source is not tracked", async () => {
  const fixture = await runFixture({
    sourcePaths: bootstrapPaths,
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /canonical source is untracked/);
    assert.match(
      fixture.output.join("\n"),
      /\.agents\/skills\/create-plan\/SKILL\.md/,
    );
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

// Risk: a new platform directory could silently become ignored local context,
// allowing missing reusable guidance to pass in a consuming workspace or CI.
test("platform instructions require tracking and allowlisting", async (t) => {
  for (const sourcePath of [
    "instructions/mobile/ui.md",
    "instructions/desktop/electron/qa.md",
    "instructions/web/wcag.md",
    "instructions/server/security.md",
  ]) {
    for (const failure of ["untracked", "ignored"]) {
      await t.test(`${sourcePath}: ${failure}`, () =>
        withFixture(async (fixture) => {
          if (failure === "untracked")
            fixture.sourcePaths = fixture.sourcePaths.filter(
              (p) => p !== sourcePath,
            );
          const base = createCommandExecutor(fixture);
          const executor = async (command) =>
            failure === "ignored" &&
            command.args[0] === "check-ignore" &&
            command.args.at(-1) === sourcePath
              ? { exitCode: 0, stdout: "", stderr: "" }
              : base(command);
          const { result, output } = await inspectFixture(fixture, executor);
          assert.equal(result.ok, false, output);
          assert.ok(output.includes(sourcePath), output);
          assert.match(
            output,
            failure === "untracked"
              ? /canonical source is untracked/
              : /canonical source is allowlisted/,
          );
        }),
      );
    }
  }
});

test("nested local instructions must remain ignored and untracked", async (t) => {
  const localPath = "instructions/local/desktop/native-qa.md";
  for (const failure of ["tracked", "unignored"]) {
    await t.test(failure, () =>
      withFixture(async (fixture) => {
        await writeFixtureFile(fixture.root, localPath);
        const executor = createCommandExecutor({
          ...fixture,
          localTrackedPaths: failure === "tracked" ? [localPath] : [],
          ignoredPaths: failure === "unignored" ? [localPath] : [],
        });
        const { result, output } = await inspectFixture(fixture, executor);
        assert.equal(result.ok, false, output);
        assert.ok(output.includes(localPath), output);
        assert.match(
          output,
          failure === "tracked"
            ? /local path is tracked/
            : /local path remains ignored/,
        );
      }),
    );
  }
});

test("real ignore rules separate portable platform source from nested local context", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      ".gitignore",
      await readFile(path.join(workflowRoot, ".gitignore"), "utf8"),
    );
    const init = spawnSync("git", ["init", "--quiet", fixture.root]);
    assert.equal(init.status, 0, init.stderr?.toString());
    for (const [target, expected] of [
      ["instructions/index.md", 0],
      ["instructions/local/architecture.md", 0],
      ["instructions/local/desktop/native-qa.md", 0],
      ["plans/instruction-platform-separation.md", 0],
      ["instructions/shared/testing.md", 1],
      ["instructions/mobile/ui.md", 1],
      ["instructions/desktop/electron/qa.md", 1],
      ["instructions/web/wcag.md", 1],
      ["instructions/server/security.md", 1],
    ]) {
      const check = spawnSync(
        "git",
        ["check-ignore", "--no-index", "-q", "--", target],
        { cwd: fixture.root },
      );
      assert.equal(
        check.status,
        expected,
        `${target}: ${check.stderr?.toString()}`,
      );
    }
  });
});

test("health fails when a canonical source is replaced by a directory", async () => {
  await withFixture(async (fixture) => {
    const sourcePath = path.join(fixture.root, "README.md");
    await unlink(sourcePath);
    await mkdir(sourcePath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /required source is missing or not a file/);
    assert.match(output.join("\n"), /README\.md/);
  });
});

test("health fails when source tracking comes from an ancestor repository", async () => {
  const fixture = await runFixture({ nestedGitInAncestor: true });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /nested Git repository/);
    assert.match(fixture.output.join("\n"), /unexpected top-level path/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails when a tracked source no longer exists on disk", async () => {
  await withFixture(async (fixture) => {
    const removedPath = "prompts/removed.md";
    const commandExecutor = createCommandExecutor({
      ...fixture,
      sourcePaths: [...fixture.sourcePaths, removedPath],
    });
    const output = [];
    const result = await runHealthCheck({
      commandExecutor,
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /tracked source is missing/);
    assert.match(output.join("\n"), /prompts\/removed\.md/);
  });
});

test("health fails when a tracked source is a directory", async () => {
  await withFixture(async (fixture) => {
    const trackedPath = "prompts/removed.md";
    await mkdir(path.join(fixture.root, trackedPath));
    const commandExecutor = createCommandExecutor({
      ...fixture,
      sourcePaths: [...fixture.sourcePaths, trackedPath],
    });
    const output = [];
    const result = await runHealthCheck({
      commandExecutor,
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /tracked source is missing or not a file/);
    assert.match(output.join("\n"), /prompts\/removed\.md/);
  });
});

test("health fails for a missing relative instruction route", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "instructions/index.md",
      "# Index Instructions\n\n## Rules\n\n- Load `shared/missing.md` and `local/architecture.md` for this fixture.\n",
    );
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /missing relative instruction routes/);
    assert.match(output.join("\n"), /shared\/missing\.md/);
  });
});

test("health validates direct instruction routes from the local index", async () => {
  await withFixture(async (fixture) => {
    await unlink(path.join(fixture.root, "instructions/local/architecture.md"));
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /missing relative instruction routes/);
    assert.match(output.join("\n"), /architecture\.md/);
  });
});

test("health fails when an instruction route is a directory", async () => {
  await withFixture(async (fixture) => {
    const routePath = path.join(
      fixture.root,
      "instructions/local/architecture.md",
    );
    await unlink(routePath);
    await mkdir(routePath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /missing relative instruction routes/);
    assert.match(output.join("\n"), /architecture\.md/);
  });
});

test("health permits references to ignored temporary workflow data", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "prompts/manage-instructions.md",
      "# Prompt\n\nRead `.ai/tmp/worktree-setup.json` when it exists.\n",
    );
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, true, output.join("\n"));
  });
});

test("health fails when a local-only path is not ignored", async () => {
  const fixture = await runFixture({
    ignoredPaths: ["plans/.health-check-probe"],
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /local path remains ignored/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails when actual local workflow data is tracked", async () => {
  await withFixture(async (fixture) => {
    const trackedPath = "plans/tracked-plan.md";
    await writeFixtureFile(fixture.root, trackedPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        localTrackedPaths: [trackedPath],
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /local path is tracked/);
    assert.match(output.join("\n"), /plans\/tracked-plan\.md/);
  });
});

test("health fails when actual local workflow data is specifically unignored", async () => {
  await withFixture(async (fixture) => {
    const unignoredPath = "plans/unignored-plan.md";
    await writeFixtureFile(fixture.root, unignoredPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        ignoredPaths: [unignoredPath],
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /local path remains ignored/);
    assert.match(output.join("\n"), /plans\/unignored-plan\.md/);
  });
});

test("health treats tmp as ignored legacy local data", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(fixture.root, "tmp/local-record.txt");
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, true, output.join("\n"));
  });
});

test("health validates instruction routes wrapped across a Load bullet", async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      "instructions/index.md",
      "# Index Instructions\n\n## Rules\n\n- Load `local/architecture.md` for local work and\n  `shared/missing.md` for wrapped workflow checks.\n",
    );
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /missing relative instruction routes/);
    assert.match(output.join("\n"), /shared\/missing\.md/);
  });
});

test("health reports every parent-tracked .ai path", async () => {
  const fixture = await runFixture({
    parentTrackedPaths: [".ai/artifacts/review.md", ".ai/state/workflow.json"],
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /parent tracks \.ai paths/);
    assert.match(fixture.output.join("\n"), /\.ai\/artifacts\/review\.md/);
    assert.match(fixture.output.join("\n"), /\.ai\/state\/workflow\.json/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("a standalone checkout reports parent isolation as not applicable", async () => {
  const fixture = await runFixture({ parentGit: false });
  try {
    assert.equal(fixture.result.ok, true, fixture.output.join("\n"));
    assert.match(fixture.output.join("\n"), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails closed when parent Git inspection errors", async () => {
  const fixture = await runFixture({
    parentGitError: "fatal: detected dubious ownership in repository",
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /inspect parent Git repository/);
    assert.match(fixture.output.join("\n"), /dubious ownership/);
    assert.doesNotMatch(fixture.output.join("\n"), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails closed when the direct parent has corrupt Git metadata", async () => {
  const fixture = await runFixture({
    parentGitError:
      "fatal: not a git repository (or any of the parent directories): .git",
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join("\n"), /inspect parent Git repository/);
    assert.match(fixture.output.join("\n"), /not a git repository/);
    assert.doesNotMatch(fixture.output.join("\n"), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("health fails closed for a dangling direct-parent .git symlink", async () => {
  await withFixture(async (fixture) => {
    const gitEntry = path.join(fixture.temporaryRoot, ".git");
    await rm(gitEntry, { force: true, recursive: true });
    await symlink("missing-git-metadata", gitEntry);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        parentGitError: "fatal: not a git repository",
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /inspect parent Git repository/);
    assert.doesNotMatch(output.join("\n"), /not applicable/);
  });
});

test("test:all delegates to full health while focused tests remain fast", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workflowRoot, "package.json"), "utf8"),
  );

  assert.equal(packageJson.scripts["test:all"], "pnpm health:full");
  assert.match(packageJson.scripts["test:focused"], /--test/);
  assert.doesNotMatch(packageJson.scripts["test:focused"], /health:full/);
});

test("local Git hooks delegate to the existing health commands", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workflowRoot, "package.json"), "utf8"),
  );
  assert.equal(packageJson.scripts.prepare, "husky");
  for (const [hook, command] of [
    ["pre-commit", "pnpm health"],
    ["pre-push", "pnpm health:push"],
  ]) {
    assert.equal(
      (await readFile(path.join(workflowRoot, ".husky", hook), "utf8")).trim(),
      command,
    );
  }
});

test("health implementation is read-only and checks canonical skill source", async () => {
  const sourcePath = path.join(
    workflowRoot,
    "scripts/maintenance/health-check.mjs",
  );
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /\$\(find/);
  assert.doesNotMatch(source, /writeFile|mkdir|rm\(/);
  assert.doesNotMatch(source, /plan-progress/);
  assert.match(source, /CANONICAL_SOURCE_ROOTS/);
  assert.match(source, /\.agents\/skills/);
});

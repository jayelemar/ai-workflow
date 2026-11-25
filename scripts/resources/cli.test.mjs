import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCLI } from "./task-resources.mjs";
import { initExecution, readManifest } from "./store.mjs";
import { ResourceManager } from "./manager.mjs";

async function withCLIContext(context, operation) {
  const previous = process.env.TASK_RESOURCES_CONTEXT;
  process.env.TASK_RESOURCES_CONTEXT = JSON.stringify(context);
  try {
    await operation();
  } finally {
    if (previous === undefined) delete process.env.TASK_RESOURCES_CONTEXT;
    else process.env.TASK_RESOURCES_CONTEXT = previous;
  }
}

test("standalone Docker CLI forwards context and prints only connection identifiers", async () => {
  const context = {
    workspace: "/original",
    plan: ".ai/plans/sample-task.md",
    executionId: "af346a4a-0346-4db1-8c6b-a79da9b14a54",
  };
  const configuration = {
    image: "example:latest",
    environment: { PASSWORD: "private-value" },
    command: ["private-command"],
    ports: [5432, { containerPort: 7000, protocol: "udp" }],
  };
  const output = [];
  await withCLIContext(context, async () => {
    await runCLI(["docker-create"], {
      input: Readable.from([JSON.stringify(configuration)]),
      createContainer: async (actual, tracking) => {
        assert.deepEqual(actual, configuration);
        assert.deepEqual(tracking.getContext(), context);
        return {
          getId: () => "container-id",
          getName: () => "sample-task-example-123456789abc",
          getHost: () => "127.0.0.1",
          getMappedPort: (port, protocol) => {
            assert.equal(protocol, port === 5432 ? "tcp" : "udp");
            return port + 10000;
          },
        };
      },
      output: (line) => output.push(JSON.parse(line)),
    });
    await runCLI(["docker-network"], {
      createNetwork: async (tracking) => {
        assert.deepEqual(tracking.getContext(), context);
        return { getId: () => "network-id", getName: () => "private-network" };
      },
      output: (line) => output.push(JSON.parse(line)),
    });
  });
  assert.deepEqual(output, [
    {
      id: "container-id",
      name: "sample-task-example-123456789abc",
      host: "127.0.0.1",
      ports: [
        { containerPort: 5432, protocol: "tcp", hostPort: 15432 },
        { containerPort: 7000, protocol: "udp", hostPort: 17000 },
      ],
    },
    { id: "network-id", name: "private-network" },
  ]);
  assert.ok(!JSON.stringify(output).includes("private-value"));
  assert.ok(!JSON.stringify(output).includes("private-command"));
});

test("Docker stdin preserves Unicode when UTF-8 characters span byte chunks", async () => {
  const context = {
    workspace: "/original",
    plan: ".ai/plans/sample-task.md",
    executionId: "af346a4a-0346-4db1-8c6b-a79da9b14a54",
  };
  const configuration = {
    image: "example:latest",
    environment: { PASSWORD: "before-💡-after-é-漢字" },
    command: ["print", "💡-e\u0301-漢字"],
  };
  const bytes = Buffer.from(JSON.stringify(configuration));
  const output = [];
  await withCLIContext(context, async () => {
    await runCLI(["docker-create"], {
      input: Readable.from(Array.from(bytes, (byte) => Buffer.from([byte]))),
      createContainer: async (actual) => {
        assert.deepEqual(actual, configuration);
        return {
          getId: () => "container-id",
          getName: () => "sample-task-example-123456789abc",
          getHost: () => "127.0.0.1",
        };
      },
      output: (line) => output.push(line),
    });
  });
  assert.ok(!output.join("").includes(configuration.environment.PASSWORD));
});

test("invalid UTF-8 stdin refuses provisioning without revealing input", async () => {
  const context = {
    workspace: "/original",
    plan: ".ai/plans/sample-task.md",
    executionId: "af346a4a-0346-4db1-8c6b-a79da9b14a54",
  };
  let provisioned = false;
  await withCLIContext(context, async () => {
    await assert.rejects(
      runCLI(["docker-create"], {
        input: Readable.from([
          Buffer.from(
            '{"image":"example:latest","environment":{"PASSWORD":"private-marker-',
          ),
          Buffer.from([0xc3, 0x28]),
          Buffer.from('"}}'),
        ]),
        createContainer() {
          provisioned = true;
          throw new Error("Unexpected provisioning");
        },
      }),
      (error) =>
        /Malformed/.test(error.message) &&
        !error.message.includes("private-marker"),
    );
  });
  assert.equal(provisioned, false);
});

test("Compose CLI accepts arbitrary project files and rejects ambiguous or escaping paths before provisioning", async (t) => {
  const workspace = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "portable-cli-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const directory = path.join(workspace, "arbitrary-project", "infra");
  await mkdir(directory, { recursive: true });
  for (const file of ["custom.yaml", "extra.yaml", "compose.yml"])
    await writeFile(path.join(directory, file), "services: {}\n");
  const context = {
    workspace,
    plan: ".ai/plans/portable-task.md",
    executionId: "af346a4a-0346-4db1-8c6b-a79da9b14a54",
  };
  const execution = { root: workspace, mode: "main" };
  const manager = { context: async () => ({ execution }) };
  const calls = [];
  const dependencies = {
    manager,
    output() {},
    prepareCompose: async (options, tracking) => {
      assert.deepEqual(tracking.getContext(), context);
      assert.equal(tracking.manager, manager);
      calls.push(options);
      return { project: options.project, async up() {} };
    },
  };
  const run = (...flags) =>
    runCLI(["compose-up", "--directory", directory, ...flags], dependencies);
  await withCLIContext(context, async () => {
    await run("--file", "custom.yaml", "--file", "extra.yaml");
    assert.deepEqual(calls[0], {
      directory,
      files: [
        path.join(directory, "custom.yaml"),
        path.join(directory, "extra.yaml"),
      ],
      project: `ai-${context.executionId}`,
    });
    await run();
    assert.deepEqual(calls[1].files, [path.join(directory, "compose.yml")]);
    await writeFile(
      path.join(directory, "docker-compose.yaml"),
      "services: {}\n",
    );
    await assert.rejects(run(), /unambiguous/);
    await assert.rejects(
      run("--file", "custom.yaml", "--file", "custom.yaml"),
      /Duplicate/,
    );
    await assert.rejects(
      run("--file", "/outside/compose.yaml"),
      /inside this execution/,
    );
    await symlink(
      path.join(directory, "custom.yaml"),
      path.join(directory, "link.yaml"),
    );
    await assert.rejects(run("--file", "link.yaml"), /regular files/);
    const other = path.join(workspace, ".worktrees", "another-task");
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, "compose.yaml"), "services: {}\n");
    await assert.rejects(
      run("--file", path.join(other, "compose.yaml")),
      /inside this execution/,
    );
    execution.mode = "worktree";
    execution.root = other;
    await assert.rejects(run("--file", "custom.yaml"), /inside this execution/);
    assert.equal(calls.length, 2);
  });
});

test("invalid or absent context cannot reach portable Docker or Compose provisioning", async () => {
  const previous = process.env.TASK_RESOURCES_CONTEXT;
  try {
    for (const supplied of [undefined, "{}", "malformed"]) {
      if (supplied === undefined) delete process.env.TASK_RESOURCES_CONTEXT;
      else process.env.TASK_RESOURCES_CONTEXT = supplied;
      for (const args of [
        ["docker-create"],
        ["docker-network"],
        ["compose-up", "--directory", "/original"],
      ]) {
        const unexpected = () =>
          assert.fail("Invalid context reached provisioning");
        await assert.rejects(
          runCLI(args, {
            manager: { context: unexpected },
            createContainer: unexpected,
            createNetwork: unexpected,
            prepareCompose: unexpected,
            input: Readable.from(["{}"]),
          }),
        );
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TASK_RESOURCES_CONTEXT;
    else process.env.TASK_RESOURCES_CONTEXT = previous;
  }
});

// The CLI must not turn malformed arguments or a partial confirmation into a
// provider action. Manager/provider tests separately establish deletion safety.
test("help and invalid commands never reach a resource provider", async () => {
  const output = [];
  const manager = new Proxy(
    {},
    {
      get() {
        assert.fail("Provider action was unexpected");
      },
    },
  );
  await runCLI(["--help"], { manager, output: (line) => output.push(line) });
  assert.ok(output[0].includes("new recorded resources only"));
  for (const args of [
    ["unknown"],
    ["release", "--apply"],
    ["inventory", "--workspace", "/tmp", "--all", "true"],
    ["ios-create", "--runtime", "one", "--runtime", "two"],
  ]) {
    await assert.rejects(runCLI(args, { manager }));
  }
});

test("unsafe source plan arguments fail before initialization", async () => {
  for (const plan of [
    "../outside.md",
    ".ai/plans/../outside.md",
    ".ai/plans/task_name.md",
    "/absolute.md",
  ]) {
    await assert.rejects(
      runCLI(["init", "--workspace", "/tmp", "--plan", plan, "--root", "/tmp"]),
    );
  }
});

test("CLI resume forwards the exact execution through live manager verification", async () => {
  const resume = "af346a4a-0346-4db1-8c6b-a79da9b14a54";
  await assert.rejects(
    runCLI(
      [
        "init",
        "--workspace",
        "/original",
        "--plan",
        ".ai/plans/sample-task.md",
        "--root",
        "/original",
        "--resume",
        resume,
        "--project-name",
        "ExampleApp",
      ],
      {
        manager: {
          async resumeExecution(input) {
            assert.deepEqual(input, {
              workspace: "/original",
              plan: ".ai/plans/sample-task.md",
              root: "/original",
              resume,
              projectName: "ExampleApp",
            });
            throw new Error("Live verification refused");
          },
        },
        output() {
          assert.fail("Refused resume printed a successful context");
        },
      },
    ),
    /Live verification refused/,
  );
});

test("confirmed cleanup forwards the exact prior preview and literal confirmation", async () => {
  const preview = {
    workspace: "/original",
    plans: [".ai/plans/sample-task.md"],
    resources: [],
  };
  const output = [];
  for (const confirmation of ["CANCEL", "PROCEED"]) {
    let called = 0;
    await runCLI(["cleanup-confirmed"], {
      input: Readable.from([JSON.stringify({ preview, confirmation })]),
      manager: {
        async cleanup(actual, answer) {
          called++;
          assert.deepEqual(actual, preview);
          assert.equal(answer, confirmation);
          return { cancelled: answer === "CANCEL" };
        },
      },
      output: (line) => output.push(JSON.parse(line)),
    });
    assert.equal(called, 1);
  }
  assert.deepEqual(output, [{ cancelled: true }, { cancelled: false }]);
});

test("confirmed cleanup rejects extra fields, malformed JSON and oversized input before provider actions", async () => {
  const manager = {
    cleanup() {
      assert.fail("Invalid input reached cleanup");
    },
  };
  for (const data of [
    "{",
    JSON.stringify({ preview: {}, confirmation: "PROCEED", apply: true }),
    "x".repeat(8 * 1024 * 1024 + 1),
  ]) {
    await assert.rejects(
      runCLI(["cleanup-confirmed"], { manager, input: Readable.from([data]) }),
    );
  }
});

test("malformed supplied child context cannot fall back to standalone allocation", async () => {
  const previous = process.env.TASK_RESOURCES_CONTEXT;
  process.env.TASK_RESOURCES_CONTEXT = '{"executionId":"bad"}';
  try {
    await assert.rejects(
      runCLI(["release"], {
        manager: {
          release() {
            assert.fail("Invalid context reached release");
          },
        },
      }),
      /Invalid task resource context/,
    );
  } finally {
    if (previous === undefined) delete process.env.TASK_RESOURCES_CONTEXT;
    else process.env.TASK_RESOURCES_CONTEXT = previous;
  }
});

test("malformed cleanup input does not echo input excerpts", async () => {
  const secret = "s3cr3t";
  await assert.rejects(
    runCLI(["cleanup-confirmed"], { input: Readable.from([secret]) }),
    (error) => !error.message.includes(secret),
  );
});

test("plan-scoped CLI inventory and confirmed cleanup accept a real tracked plan without an execution flag", async (t) => {
  const workspace = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "resource-cli-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const name of [".ai", "app"]) {
    const root = path.join(workspace, name);
    await mkdir(root);
    const git = (...args) =>
      execFileSync("rtk", ["proxy", "git", "-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      });
    git("init", "--initial-branch=main");
    await writeFile(path.join(root, "fixture"), "disposable CLI fixture\n");
    git("add", "fixture");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "fixture",
    );
  }
  const plan = ".ai/plans/cli-task.md";
  await mkdir(path.join(workspace, ".ai/plans"));
  await writeFile(path.join(workspace, plan), "# Disposable tracked plan\n");
  const context = await initExecution({ workspace, plan });
  await new ResourceManager().release(context);
  let preview;
  await runCLI(["inventory", "--workspace", workspace, "--plan", plan], {
    output: (value) => {
      preview = JSON.parse(value);
    },
  });
  assert.deepEqual(preview.plans, [plan]);
  assert.equal(preview.manifests[0].executions[0].id, context.executionId);
  let result;
  await runCLI(["cleanup-confirmed"], {
    input: Readable.from([
      JSON.stringify({ preview, confirmation: "PROCEED" }),
    ]),
    output: (value) => {
      result = JSON.parse(value);
    },
  });
  assert.deepEqual(result, { cancelled: false, removed: [], preserved: [] });

  const docker = {
    async verifyIdentity() {
      throw new Error("Original Docker provider unavailable");
    },
  };
  const manager = new ResourceManager({ docker });
  const args = [
    "init",
    "--workspace",
    workspace,
    "--plan",
    plan,
    "--root",
    workspace,
    "--resume",
    context.executionId,
  ];
  await runCLI(args, {
    manager,
    output: (value) => {
      assert.deepEqual(JSON.parse(value), context);
    },
  });
  await manager.reserve(context, "network", {
    type: "docker",
    endpoint: "unix:///private/tmp/cli-disposable.sock",
    daemonId: "cli-fixture-daemon",
  });
  await manager.release(context);
  const artifact = path.join(
    workspace,
    ".ai/artifacts/cli-task/resources.json",
  );
  const before = await readFile(artifact, "utf8");
  await assert.rejects(
    runCLI(args, {
      manager,
      output() {
        assert.fail("Unavailable provider printed a successful context");
      },
    }),
    /provider unavailable/,
  );
  assert.equal(await readFile(artifact, "utf8"), before);
  assert.equal((await readManifest(context)).executions[0].active, false);
});

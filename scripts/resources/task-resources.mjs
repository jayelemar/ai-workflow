#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ZodError } from "zod";
import { initExecution } from "./store.mjs";
import { ResourceManager, environmentContext } from "./manager.mjs";
import { ContextSchema, PlanSchema } from "./schema.mjs";
import { trackedCompose, resolveComposeFiles } from "./compose.mjs";
import { startDockerContainer, startDockerNetwork } from "./fixtures.mjs";

const confirmationPrompt =
  "Type PROCEED to clean up only the selected plans listed above, or CANCEL to stop.";
const usage = `Task-owned local resources (new recorded resources only)
  init --workspace <original-workspace> --plan .ai/plans/<name>.md --root <execution-root> [--project-name <label>] [--resume <execution-UUID>]
  release | reconcile                          # use TASK_RESOURCES_CONTEXT
  ios-create --device-type <identifier> --runtime <identifier>
  docker-create                              # container configuration JSON on stdin
  docker-network                             # create a private execution network
  compose-up --directory <execution-directory> [--file <configuration> ...]
  inventory --workspace <original-workspace> --plan .ai/plans/<name>.md [--plan ...]
  cleanup --workspace <original-workspace> --plan .ai/plans/<name>.md [--plan ...]
  cleanup-confirmed                           # JSON {preview,confirmation} on stdin
init prints a JSON context. Set TASK_RESOURCES_CONTEXT to that exact JSON before
resource creation. Project labels name new resources only; recorded labels stay stable.
Release only after all agents/tests using the execution stop.
Cleanup removes resources only: keep plans/worktrees until their separate
confirmed file-cleanup phase succeeds. No resource manifest is auto-deleted.`;

function options(args, allowed) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith("--"))
      throw new Error("Unknown, repeated or missing task-resource argument");
    if (key === "--plan") (parsed.plan ??= []).push(PlanSchema.parse(value));
    else if (key === "--file") (parsed.file ??= []).push(value);
    else {
      if (Object.hasOwn(parsed, key.slice(2)))
        throw new Error("Repeated task-resource argument");
      parsed[key.slice(2)] = value;
    }
  }
  return parsed;
}

function requireContext() {
  const context = environmentContext();
  if (!context)
    throw new Error(
      "TASK_RESOURCES_CONTEXT is required before creating or changing task resources",
    );
  return ContextSchema.parse(context);
}

async function stdinJSON(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    size += bytes.byteLength;
    if (size > 8 * 1024 * 1024) throw new Error("Cleanup input is too large");
    chunks.push(Buffer.from(bytes));
  }
  try {
    const data = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
    return JSON.parse(data);
  } catch {
    throw new Error("Malformed cleanup JSON; input content omitted");
  }
}

export async function runCLI(
  args = process.argv.slice(2),
  {
    manager = new ResourceManager(),
    input = process.stdin,
    output = console.log,
    createContainer = startDockerContainer,
    createNetwork = startDockerNetwork,
    prepareCompose = trackedCompose,
  } = {},
) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    output(usage);
    return;
  }
  if (command === "init") {
    const flags = options(rest, [
      "--workspace",
      "--plan",
      "--root",
      "--resume",
      "--project-name",
    ]);
    if (!flags.workspace || !flags.root || flags.plan?.length !== 1)
      throw new Error(
        "init needs workspace, one source plan and execution root",
      );
    const request = {
      workspace: flags.workspace,
      plan: flags.plan[0],
      root: flags.root,
      resume: flags.resume,
      ...(flags["project-name"] !== undefined
        ? { projectName: flags["project-name"] }
        : {}),
    };
    output(
      JSON.stringify(
        await (flags.resume
          ? manager.resumeExecution(request)
          : initExecution(request)),
      ),
    );
    return;
  }
  if (command === "release" || command === "reconcile") {
    options(rest, []);
    await manager[command](requireContext());
    output(`${command} completed; resource evidence retained`);
    return;
  }
  if (command === "ios-create") {
    const flags = options(rest, ["--device-type", "--runtime"]);
    if (!flags["device-type"] || !flags.runtime)
      throw new Error(
        "Explicit installed device type and iOS runtime are required",
      );
    output(
      JSON.stringify(
        await manager.createSimulator(requireContext(), {
          deviceType: flags["device-type"],
          runtime: flags.runtime,
        }),
      ),
    );
    return;
  }
  if (command === "compose-up") {
    const flags = options(rest, ["--directory", "--file"]);
    if (!flags.directory)
      throw new Error("Compose needs an execution directory");
    const context = requireContext();
    const { execution } = await manager.context(context);
    const directory = path.resolve(flags.directory);
    const files = await resolveComposeFiles(directory, flags.file, execution);
    const tracking = await prepareCompose(
      {
        directory,
        files,
        project: `ai-${context.executionId}`,
      },
      { manager, getContext: () => context },
    );
    await tracking.up();
    output(
      JSON.stringify({
        project: tracking.project,
        executionId: context.executionId,
      }),
    );
    return;
  }
  if (command === "docker-create") {
    options(rest, []);
    const context = requireContext();
    const configuration = await stdinJSON(input);
    const container = await createContainer(configuration, {
      manager,
      getContext: () => context,
    });
    output(
      JSON.stringify({
        id: container.getId(),
        name: container.getName(),
        host: container.getHost(),
        ports: (configuration.ports ?? []).map((value) => {
          const port =
            typeof value === "number" ? { containerPort: value } : value;
          const protocol = port.protocol ?? "tcp";
          return {
            containerPort: port.containerPort,
            protocol,
            hostPort: container.getMappedPort(port.containerPort, protocol),
          };
        }),
      }),
    );
    return;
  }
  if (command === "docker-network") {
    options(rest, []);
    const context = requireContext();
    const network = await createNetwork({ manager, getContext: () => context });
    output(JSON.stringify({ id: network.getId(), name: network.getName() }));
    return;
  }
  if (command === "cleanup-confirmed") {
    options(rest, []);
    const supplied = await stdinJSON(input);
    if (
      !supplied ||
      Object.keys(supplied).sort().join(",") !== "confirmation,preview"
    )
      throw new Error("Expected only preview and exact confirmation");
    output(
      JSON.stringify(
        await manager.cleanup(supplied.preview, supplied.confirmation),
      ),
    );
    return;
  }
  if (command === "inventory" || command === "cleanup") {
    const flags = options(rest, ["--workspace", "--plan"]);
    if (!flags.workspace || !flags.plan?.length)
      throw new Error("Select a source workspace and exact plans");
    const preview = await manager.inventory(flags.workspace, flags.plan);
    output(JSON.stringify(preview, null, 2));
    if (command === "inventory") return;
    const reader = createInterface({ input, output: process.stdout });
    try {
      let answer;
      do {
        answer = await reader.question(`${confirmationPrompt}\n`);
      } while (answer !== "PROCEED" && answer !== "CANCEL");
      output(JSON.stringify(await manager.cleanup(preview, answer)));
    } finally {
      reader.close();
    }
    return;
  }
  throw new Error("Unknown task resource operation; use --help");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCLI().catch((error) => {
    console.error(
      error instanceof ZodError
        ? "Invalid resource record or context; no further operations performed"
        : error.message,
    );
    process.exitCode = 1;
  });
}

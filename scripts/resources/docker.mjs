import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
async function executeWithInput(file, args, { input, ...options }) {
  const pending = execute(file, args, options);
  let inputError;
  if (input !== undefined) {
    pending.child.stdin.on("error", (error) => {
      inputError = error;
    });
    pending.child.stdin.end(input);
  }
  const result = await pending;
  if (inputError) throw inputError;
  return result;
}
const ownerKeys = ["ai.task", "ai.execution", "ai.resource", "ai.workspace"];

export function ownershipLabels(context, manifest, entry) {
  return {
    "ai.task": manifest.taskId,
    "ai.execution": entry.executionId,
    "ai.resource": entry.id,
    "ai.workspace": context.workspace,
  };
}

export function owns(labels, expected) {
  return ownerKeys.every((key) => labels?.[key] === expected[key]);
}

export function requireLoopbackPublications(container) {
  const ports = container.ports;
  if (ports == null) return;
  if (typeof ports !== "object" || Array.isArray(ports))
    throw new Error("Container port publications are unverified");
  for (const bindings of Object.values(ports)) {
    if (bindings === null) continue;
    if (
      !Array.isArray(bindings) ||
      bindings.some(
        (binding) =>
          !binding ||
          !["127.0.0.1", "::1"].includes(binding.HostIp) ||
          !/^[1-9][0-9]{0,4}$/.test(binding.HostPort) ||
          Number(binding.HostPort) > 65535,
      )
    )
      throw new Error("Tracked container ports must bind only to loopback");
  }
}

// Invoke Docker directly: tracking proxies can persist credential-bearing argv.
// Never include stdout/stderr in errors; those may contain private configuration.
export class DockerProvider {
  constructor({ run = executeWithInput, environment } = {}) {
    this.run = run;
    this.environment = environment;
  }

  async command(args, endpoint, { timeoutMs = 120_000, input } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
      throw new Error("Docker command timeout is outside the supported bound");
    if (
      input !== undefined &&
      (typeof input !== "string" || Buffer.byteLength(input) > 8 * 1024 * 1024)
    )
      throw new Error("Docker command input is outside the supported bound");
    try {
      const result = await this.run(
        "docker",
        [...(endpoint ? ["--host", endpoint] : []), ...args],
        {
          env: this.environment ?? process.env,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          ...(input !== undefined ? { input } : {}),
        },
      );
      return result.stdout.trim();
    } catch {
      throw new Error(
        `Docker ${args[0]} operation failed; resource state is unverified`,
      );
    }
  }

  async identity() {
    const endpoint =
      (this.environment ?? process.env).DOCKER_HOST ||
      (await this.command([
        "context",
        "inspect",
        "--format",
        "{{.Endpoints.docker.Host}}",
      ]));
    if (!/^unix:\/\/\//.test(endpoint) || /[\r\n\0]/.test(endpoint)) {
      throw new Error(
        "Task resources require a local Unix-socket Docker endpoint",
      );
    }
    const daemonId = await this.command(
      ["info", "--format", "{{.ID}}"],
      endpoint,
    );
    if (!daemonId || /\s/.test(daemonId))
      throw new Error("Unverified Docker daemon identity");
    return { type: "docker", endpoint, daemonId };
  }

  async verifyIdentity(provider) {
    const current = await this.identity();
    if (
      current.endpoint !== provider.endpoint ||
      current.daemonId !== provider.daemonId
    ) {
      throw new Error(
        "Docker endpoint or daemon identity changed; stop and inspect the original provider",
      );
    }
  }

  async list(kind, provider, filters = []) {
    const args =
      kind === "container"
        ? ["container", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"]
        : kind === "image"
          ? ["image", "ls", "--all", "--no-trunc", "--quiet"]
          : [
              kind,
              "ls",
              ...(kind === "network" ? ["--no-trunc"] : []),
              "--format",
              kind === "volume" ? "{{.Name}}" : "{{.ID}}",
            ];
    for (const filter of filters) args.push("--filter", filter);
    return [
      ...new Set(
        (await this.command(args, provider.endpoint))
          .split("\n")
          .filter(Boolean),
      ),
    ];
  }

  async inspect(kind, id, provider) {
    await this.verifyIdentity(provider);
    // Enumerating successfully before declaring absence distinguishes removal
    // from permission failures, daemon failures, and corrupt inspect output.
    const ids = await this.list(kind, provider);
    if (!ids.includes(id)) return null;
    const templates = {
      container:
        '{"id":{{json .Id}},"created":{{json .Created}},"labels":{{json (index .Config "Labels")}},"mounts":{{json .Mounts}},"declaredVolumes":{{json (index .Config "Volumes")}},"binds":{{json (index .HostConfig "Binds")}},"requestedMounts":{{json (index .HostConfig "Mounts")}},"image":{{json .Image}},"running":{{json .State.Running}},"networkMode":{{json (index .HostConfig "NetworkMode")}},"networks":{{json (index .NetworkSettings "Networks")}},"ports":{{json (index .NetworkSettings "Ports")}}}',
      volume:
        '{"name":{{json .Name}},"created":{{json .CreatedAt}},"labels":{{json (index . "Labels")}}}',
      network:
        '{"id":{{json .Id}},"created":{{json .Created}},"labels":{{json (index . "Labels")}},"containers":{{json (index . "Containers")}},"driver":{{json .Driver}},"options":{{json (index . "Options")}}}',
      image:
        '{"id":{{json .Id}},"labels":{{json (index .Config "Labels")}},"tags":{{json .RepoTags}}}',
    };
    try {
      return JSON.parse(
        await this.command(
          [kind, "inspect", "--format", templates[kind], id],
          provider.endpoint,
        ),
      );
    } catch {
      throw new Error(
        `Cannot inspect recorded Docker ${kind}; no absence or ownership conclusion is safe`,
      );
    }
  }

  async discover(entry) {
    await this.verifyIdentity(entry.provider);
    return this.list(entry.kind, entry.provider, [
      `label=ai.resource=${entry.id}`,
    ]);
  }

  async containers(provider) {
    await this.verifyIdentity(provider);
    const ids = await this.list("container", provider);
    if (!ids.length) return [];
    const template =
      '{"id":{{json .Id}},"labels":{{json (index .Config "Labels")}},"mounts":{{json .Mounts}},"image":{{json .Image}}}';
    try {
      const result = (
        await this.command(
          ["container", "inspect", "--format", template, ...ids],
          provider.endpoint,
        )
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (
        result.length !== ids.length ||
        new Set(result.map((item) => item.id)).size !== ids.length ||
        result.some(
          (item) => !ids.includes(item.id) || !Array.isArray(item.mounts),
        )
      )
        throw new Error();
      return result;
    } catch {
      throw new Error(
        "Container attachment inventory is incomplete; resource use is unverified",
      );
    }
  }

  async verify(entry, expected, selectedContainerIds = new Set()) {
    const locator = entry.locator;
    const identity = entry.kind === "volume" ? locator.name : locator.id;
    const actual = await this.inspect(entry.kind, identity, entry.provider);
    if (!actual) return { state: "absent" };
    const parentVolume = entry.kind === "volume" && locator.containerId;
    if (!owns(actual.labels, expected)) {
      throw new Error(`Ownership mismatch for recorded ${entry.kind}`);
    }
    if (locator.created && locator.created !== actual.created) {
      throw new Error(
        `Recorded ${entry.kind} was replaced; refuse name-based deletion`,
      );
    }
    const containers =
      entry.kind === "volume" || entry.kind === "image"
        ? await this.containers(entry.provider)
        : [];
    if (entry.kind === "volume") {
      if (parentVolume) {
        const parent = await this.inspect(
          "container",
          locator.containerId,
          entry.provider,
        );
        if (
          parent &&
          (!owns(parent.labels, {
            ...expected,
            "ai.resource": parent.labels?.["ai.resource"],
          }) ||
            !parent.mounts.some(
              (mount) => mount.Type === "volume" && mount.Name === locator.name,
            ))
        ) {
          throw new Error(
            "Anonymous volume's creating container no longer corroborates ownership",
          );
        }
      }
      if (
        containers.some(
          (container) =>
            !selectedContainerIds.has(container.id) &&
            container.mounts.some(
              (mount) => mount.Type === "volume" && mount.Name === locator.name,
            ),
        )
      ) {
        throw new Error("Recorded volume is attached to another container");
      }
    }
    if (
      entry.kind === "network" &&
      Object.keys(actual.containers ?? {}).some(
        (id) => !selectedContainerIds.has(id),
      )
    ) {
      throw new Error("Recorded network is used by another container");
    }
    if (entry.kind === "image") {
      const shared =
        (actual.tags ?? []).some((tag) => !locator.tags.includes(tag)) ||
        containers.some(
          (container) =>
            container.image === locator.id &&
            !selectedContainerIds.has(container.id),
        );
      if (shared)
        return {
          state: "preserved",
          reason: "Image has a non-task tag or another container reference",
        };
    }
    return entry.kind === "container"
      ? { state: "present", running: actual.running ?? false }
      : { state: "present" };
  }

  async remove(entry) {
    await this.verifyIdentity(entry.provider);
    const id = entry.kind === "volume" ? entry.locator.name : entry.locator.id;
    // -v is deliberately omitted: every volume has its own checked inventory
    // entry. Image removal is never forced, and bind mounts are never traversed.
    const args =
      entry.kind === "container"
        ? ["container", "rm", "--force", id]
        : [entry.kind, "rm", id];
    await this.command(args, entry.provider.endpoint);
  }
}

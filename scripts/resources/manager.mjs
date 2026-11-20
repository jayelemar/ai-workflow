import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ContextSchema, ResourceMetadataSchema } from "./schema.mjs";
import {
  initExecution,
  readManifest,
  readPlanManifest,
  readAllManifests,
  updateManifest,
  withResourceLock,
  writeManifestUnlocked,
} from "./store.mjs";
import { DockerProvider, ownershipLabels, owns } from "./docker.mjs";
import { IOSProvider } from "./ios.mjs";

function sameProvider(left, right) {
  return (
    left.type === right.type &&
    (left.type === "docker"
      ? left.endpoint === right.endpoint && left.daemonId === right.daemonId
      : left.deviceSet === right.deviceSet)
  );
}

export function environmentContext(environment = process.env) {
  const raw = environment.TASK_RESOURCES_CONTEXT;
  if (raw === undefined) return null;
  try {
    if (raw.length > 8192) throw new Error();
    return ContextSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Invalid task resource context; no resource operation is authorized",
    );
  }
}

export class ResourceManager {
  constructor({ docker = new DockerProvider(), ios = new IOSProvider() } = {}) {
    this.docker = docker;
    this.ios = ios;
  }

  async context(context) {
    const parsed = ContextSchema.parse(context);
    const manifest = await readManifest(parsed);
    if (!manifest) throw new Error("Expected task resource record is missing");
    const execution = manifest.executions.find(
      (item) => item.id === parsed.executionId,
    );
    if (!execution?.active)
      throw new Error(
        "Execution is missing or released; initialize or resume before provisioning",
      );
    return { manifest, execution };
  }

  async resumeExecution(input) {
    if (!input.resume)
      throw new Error("Explicit execution UUID is required for resume");
    return initExecution({
      ...input,
      verifyResume: (context) => this.verifyResume(context),
    });
  }

  async verifyResume(context) {
    // initExecution holds the source lock through verification and activation.
    const manifest = await readManifest(context);
    if (!manifest) throw new Error("Expected task resource record is missing");
    const resources = manifest.resources.filter(
      (entry) => entry.executionId === context.executionId,
    );
    const containers = new Set(
      resources
        .filter(
          (entry) =>
            entry.kind === "container" &&
            entry.locator &&
            entry.state !== "removed",
        )
        .map((entry) => entry.locator.id),
    );
    for (const entry of resources) {
      if (entry.provider.type === "docker")
        await this.docker.verifyIdentity(entry.provider);
      else if (!sameProvider(entry.provider, await this.ios.identity()))
        throw new Error(
          "Simulator device set changed; inspect the original provider",
        );
      // Resume permits explicit recovery, but never guesses or resolves an
      // interrupted allocation. Reconcile remains a separate operation.
      if (entry.state === "pending" || !entry.locator) continue;
      const status =
        entry.provider.type === "docker"
          ? await this.docker.verify(
              entry,
              ownershipLabels(context, manifest, entry),
              containers,
            )
          : await this.ios.verify(entry, { workspace: context.workspace });
      if (status.state === "preserved")
        throw new Error(
          "Recorded resource is not available exclusively to this execution",
        );
      if (entry.state === "removed" && status.state !== "absent")
        throw new Error(
          "A removed resource reappeared; inspect replacement identity",
        );
    }
  }

  async reserve(context, kind, provider, dependencies = [], options = {}) {
    const metadata = ResourceMetadataSchema.parse(options);
    if (metadata.expectedTags && kind !== "image")
      throw new Error("Expected image tags are only valid for image resources");
    if (
      metadata.compose &&
      (kind === "ios-simulator" || provider.type !== "docker")
    )
      throw new Error("Compose provenance is only valid for Docker resources");
    await this.context(context);
    return updateManifest(context, (manifest) => {
      if (
        !manifest.executions.find(
          (execution) => execution.id === context.executionId,
        )?.active
      )
        throw new Error("Execution was released");
      if (
        manifest.resources.some(
          (entry) =>
            entry.executionId === context.executionId &&
            entry.provider.type === provider.type &&
            !sameProvider(entry.provider, provider),
        )
      )
        throw new Error(
          "Execution provider identity changed; start a new execution for a different provider",
        );
      const id = randomUUID();
      const entry = {
        id,
        executionId: context.executionId,
        kind,
        state: "pending",
        disposable: true,
        createdAt: new Date().toISOString(),
        provider,
        locator: null,
        ...metadata,
        dependencies,
        ownership: {
          taskId: manifest.taskId,
          executionId: context.executionId,
          entryId: id,
        },
      };
      manifest.resources.push(entry);
      return { entry, labels: ownershipLabels(context, manifest, entry) };
    });
  }

  async captureDocker(context, entryId, identity, { tags } = {}) {
    const { manifest } = await this.context(context);
    const entry = manifest.resources.find((item) => item.id === entryId);
    if (
      !entry ||
      entry.executionId !== context.executionId ||
      entry.provider.type !== "docker" ||
      entry.state !== "pending"
    )
      throw new Error(
        "No matching pending Docker allocation for this execution",
      );
    let expectedTags;
    if (entry.kind === "image") {
      const explicitTags =
        tags === undefined
          ? undefined
          : ResourceMetadataSchema.parse({ expectedTags: tags }).expectedTags;
      expectedTags = entry.expectedTags ?? explicitTags;
      if (!expectedTags)
        throw new Error(
          "Pending image has no known expected image tags; preserve its creation evidence",
        );
      if (
        entry.expectedTags &&
        explicitTags &&
        JSON.stringify([...entry.expectedTags].sort()) !==
          JSON.stringify([...explicitTags].sort())
      )
        throw new Error("Capture tags do not match the reserved image tags");
    }
    const actual = await this.docker.inspect(
      entry.kind,
      identity,
      entry.provider,
    );
    if (
      !actual ||
      !owns(actual.labels, ownershipLabels(context, manifest, entry))
    )
      throw new Error(
        "Creation did not produce the reserved, labelled resource",
      );
    if (entry.kind === "container") {
      const networks = manifest.resources.filter(
        (resource) =>
          resource.kind === "network" &&
          entry.dependencies.includes(resource.id),
      );
      if (networks.length) {
        const expected = new Set(
          networks
            .map((resource) => resource.locator?.id)
            .filter((id) => typeof id === "string"),
        );
        const attached = Object.values(actual.networks ?? {}).map(
          (network) => network.NetworkID,
        );
        const initialized =
          attached.length > 0 && attached.every((id) => expected.has(id));
        // Docker may not initialize endpoint IDs until start. A stopped owned
        // container is still recoverable when its configured network is exact.
        const configuredBeforeStart =
          actual.running === false &&
          typeof actual.networkMode === "string" &&
          expected.has(actual.networkMode) &&
          attached.every((id) => id === "" || expected.has(id));
        if (!initialized && !configuredBeforeStart)
          throw new Error(
            "Created container is not isolated on its recorded private network",
          );
      }
    }
    const locator =
      entry.kind === "volume"
        ? { name: actual.name, created: actual.created, containerId: null }
        : entry.kind === "image"
          ? { id: actual.id, tags: expectedTags }
          : { id: actual.id, created: actual.created };
    await updateManifest(context, (draft) => {
      const target = draft.resources.find((item) => item.id === entryId);
      if (target.state !== "pending")
        throw new Error("Allocation changed during capture");
      // An interrupted capture may already have durable native identity.
      // Labels alone cannot authorize replacing that original resource.
      if (
        target.locator &&
        ((entry.kind === "volume"
          ? target.locator.name !== locator.name
          : target.locator.id !== locator.id) ||
          (entry.kind !== "image" &&
            target.locator.created !== locator.created))
      )
        throw new Error(
          "Allocation creation identity changed; preserve its original evidence",
        );
      target.locator = locator;
      target.state = entry.kind === "container" ? "pending" : "present";
    });
    if (entry.kind === "container") {
      await this.captureVolumes(context, entry, actual);
      await updateManifest(context, (draft) => {
        const target = draft.resources.find((item) => item.id === entryId);
        if (target.state !== "pending" || target.locator?.id !== actual.id)
          throw new Error(
            "Container capture changed before its volumes were complete",
          );
        target.state = "present";
      });
    }
    return actual;
  }

  async captureVolumes(context, parent, actual) {
    for (const mount of actual.mounts ?? []) {
      if (mount.Type !== "volume") continue;
      const current = await readManifest(context);
      const volume = await this.docker.inspect(
        "volume",
        mount.Name,
        parent.provider,
      );
      if (!volume)
        throw new Error("Container volume disappeared before registration");
      const recorded = current.resources.find(
        (entry) =>
          entry.kind === "volume" &&
          entry.executionId === parent.executionId &&
          entry.provider.endpoint === parent.provider.endpoint &&
          entry.provider.daemonId === parent.provider.daemonId &&
          entry.state !== "removed" &&
          (entry.locator?.name === mount.Name ||
            (entry.state === "pending" &&
              entry.id === volume.labels?.["ai.resource"])),
      );
      if (
        !recorded ||
        !owns(volume.labels, ownershipLabels(context, current, recorded))
      )
        throw new Error(
          "Container mounted a volume without recorded native ownership; preserve it",
        );
      if (recorded.state === "pending")
        await this.captureDocker(context, recorded.id, mount.Name);
      else if (
        recorded.locator.name !== volume.name ||
        recorded.locator.created !== volume.created
      )
        throw new Error("Mounted volume creation identity changed");
    }
  }

  async createSimulator(context, configuration) {
    const { manifest } = await this.context(context);
    for (const resource of manifest.resources) {
      if (
        resource.executionId !== context.executionId ||
        resource.kind !== "ios-simulator" ||
        resource.state !== "present" ||
        resource.locator.deviceType !== configuration.deviceType ||
        resource.locator.runtime !== configuration.runtime
      )
        continue;
      try {
        if (
          (await this.ios.verify(resource, { workspace: context.workspace }))
            .state === "present"
        )
          return resource.locator;
      } catch (error) {
        if (error.code !== "DEVICE_BUSY") throw error;
      }
    }
    const provider = await this.ios.identity();
    const { entry } = await this.reserve(context, "ios-simulator", provider);
    const locator = await this.ios.create(configuration, provider, {
      ...entry.ownership,
      workspace: context.workspace,
    });
    await updateManifest(context, (manifest) => {
      const resource = manifest.resources.find((item) => item.id === entry.id);
      resource.locator = locator;
      resource.state = "present";
    });
    return locator;
  }

  async release(context) {
    await updateManifest(context, (manifest) => {
      const execution = manifest.executions.find(
        (item) => item.id === context.executionId,
      );
      if (!execution) throw new Error("Unknown execution");
      execution.active = false;
    });
  }

  async reconcile(context) {
    const manifest = await readManifest(context);
    if (!manifest) throw new Error("Expected task resource record is missing");
    for (const initial of manifest.resources) {
      const entry = (await readManifest(context)).resources.find(
        (item) => item.id === initial.id,
      );
      if (
        entry.executionId !== context.executionId ||
        entry.state !== "pending" ||
        entry.provider.type !== "docker"
      )
        continue;
      const ids = await this.docker.discover(entry);
      if (ids.length > 1)
        throw new Error(
          "Reserved Docker allocation has ambiguous provider matches",
        );
      if (ids.length === 1) await this.captureDocker(context, entry.id, ids[0]);
      else
        await updateManifest(context, (draft) => {
          draft.resources.find((item) => item.id === entry.id).state =
            "removed";
        });
    }
  }

  async inventory(workspace, plans) {
    return withResourceLock(workspace, () =>
      this.inventoryUnlocked(workspace, plans),
    );
  }

  async inventoryUnlocked(workspace, plans) {
    if (
      !Array.isArray(plans) ||
      !plans.length ||
      new Set(plans).size !== plans.length
    )
      throw new Error("Select exact unique source plans");
    for (const plan of plans) await readPlanManifest({ workspace, plan });
    const all = await readAllManifests(workspace);
    const manifests = all.filter((manifest) => plans.includes(manifest.plan));
    const selected = new Set(
      manifests.flatMap((manifest) =>
        manifest.resources
          .filter((entry) => entry.kind === "container" && entry.locator)
          .map((entry) => entry.locator.id),
      ),
    );
    const identity = (entry) =>
      JSON.stringify([
        entry.provider,
        entry.kind,
        entry.kind === "volume"
          ? entry.locator?.name
          : entry.kind === "ios-simulator"
            ? entry.locator?.udid.toLowerCase()
            : entry.locator?.id,
      ]);
    const seen = new Map();
    for (const manifest of all)
      for (const entry of manifest.resources) {
        if (!entry.locator || entry.state === "removed") continue;
        const key = identity(entry);
        if (seen.has(key))
          throw new Error(
            "Resource appears in multiple task records; ownership is ambiguous",
          );
        seen.set(key, manifest.taskId);
      }
    const resources = [];
    for (const manifest of manifests) {
      if (manifest.executions.some((execution) => execution.active))
        throw new Error(
          "Task execution is still active; release it after all agents/tests finish",
        );
      for (const entry of manifest.resources) {
        if (entry.state === "pending")
          throw new Error(
            "Unresolved resource creation; reconcile its evidence before cleanup",
          );
        if (entry.locator === null) continue;
        if (entry.kind === "volume" && entry.locator.containerId) {
          const parent = manifest.resources.find(
            (item) =>
              item.kind === "container" &&
              item.locator?.id === entry.locator.containerId,
          );
          if (!parent || !entry.dependencies.includes(parent.id))
            throw new Error(
              "Volume has no corroborating creating-container record",
            );
        }
        const status =
          entry.provider.type === "docker"
            ? await this.docker.verify(
                entry,
                ownershipLabels({ workspace }, manifest, entry),
                selected,
              )
            : await this.ios.verify(entry, { workspace });
        if (entry.state === "removed" && status.state === "present")
          throw new Error(
            "A removed resource reappeared; inspect replacement identity",
          );
        resources.push({
          taskId: manifest.taskId,
          plan: manifest.plan,
          entry,
          ...status,
        });
      }
    }
    return { workspace, plans: [...plans].sort(), manifests, resources };
  }

  // The caller holds withResourceLock through this check and every subsequent
  // file removal. This read-only gate permits only the confirmed resource
  // cleanup's state transitions, never a new execution or allocation.
  async verifyFileCleanupUnlocked(preview, result) {
    const ids = preview.resources.map((resource) => resource.entry.id);
    if (
      !result ||
      result.cancelled !== false ||
      !Array.isArray(result.removed) ||
      !Array.isArray(result.preserved) ||
      result.preserved.length ||
      new Set(result.removed).size !== result.removed.length ||
      result.removed.length !== ids.length ||
      result.removed.some((id) => !ids.includes(id))
    )
      throw new Error(
        "Complete confirmed resource cleanup is required before file cleanup",
      );
    const expected = structuredClone(preview.manifests);
    const removed = new Set(result.removed);
    for (const manifest of expected)
      for (const entry of manifest.resources)
        if (removed.has(entry.id)) entry.state = "removed";
    const current = await this.inventoryUnlocked(
      preview.workspace,
      preview.plans,
    );
    if (
      !isDeepStrictEqual(current.manifests, expected) ||
      current.resources.some((resource) => resource.state !== "absent")
    )
      throw new Error(
        "Resource records changed after cleanup; preserve files and show a fresh preview",
      );
    return current;
  }

  async cleanup(preview, confirmation) {
    if (confirmation === "CANCEL")
      return { cancelled: true, removed: [], preserved: [] };
    if (confirmation !== "PROCEED")
      throw new Error("Exact PROCEED or CANCEL is required");
    return withResourceLock(preview.workspace, async () => {
      const current = await this.inventoryUnlocked(
        preview.workspace,
        preview.plans,
      );
      if (JSON.stringify(current) !== JSON.stringify(preview))
        throw new Error(
          "Resource inventory changed; show a fresh preview and require PROCEED again",
        );
      const removed = [];
      const preserved = current.resources.filter(
        (resource) => resource.state === "preserved",
      );
      const order = [
        "container",
        "volume",
        "network",
        "ios-simulator",
        "image",
      ];
      try {
        for (const kind of order)
          for (const resource of current.resources.filter(
            (item) => item.entry.kind === kind,
          )) {
            if (resource.state === "preserved") continue;
            const entry = resource.entry;
            const manifest = current.manifests.find(
              (item) => item.taskId === resource.taskId,
            );
            const provider =
              entry.provider.type === "docker" ? this.docker : this.ios;
            const status =
              entry.provider.type === "docker"
                ? await provider.verify(
                    entry,
                    ownershipLabels(
                      { workspace: current.workspace },
                      manifest,
                      entry,
                    ),
                    new Set(
                      current.resources
                        .filter((item) => item.entry.kind === "container")
                        .map((item) => item.entry.locator.id),
                    ),
                  )
                : await provider.verify(entry, {
                    workspace: current.workspace,
                  });
            if (status.state === "preserved")
              throw new Error(
                "Resource use changed during deletion; stop and preview again",
              );
            if (status.state !== "absent")
              await provider.remove(entry, { workspace: current.workspace });
            const after =
              entry.provider.type === "docker"
                ? await this.docker.inspect(
                    entry.kind,
                    entry.kind === "volume"
                      ? entry.locator.name
                      : entry.locator.id,
                    entry.provider,
                  )
                : (
                    await this.ios.verify(entry, {
                      workspace: current.workspace,
                    })
                  ).state !== "absent";
            if (after)
              throw new Error("Resource deletion postcondition failed");
            entry.state = "removed";
            await writeManifestUnlocked(
              {
                workspace: current.workspace,
                plan: manifest.plan,
                executionId: entry.executionId,
              },
              manifest,
            );
            removed.push(entry.id);
          }
      } catch (cause) {
        const error = new Error(
          `Resource cleanup stopped after ${removed.length} removals; keep plan and JSON evidence. ${cause.message}`,
        );
        error.removed = removed;
        throw error;
      }
      return { cancelled: false, removed, preserved };
    });
  }
}

import { z } from "zod";
import { ResourceManager } from "./manager.mjs";
import { ContextSchema } from "./schema.mjs";
import { ownershipLabels } from "./docker.mjs";
import {
  readManifest,
  readAllManifests,
  withResourceLock,
  writeManifestUnlocked,
} from "./store.mjs";

const entryIdsSchema = z
  .array(z.uuid())
  .max(2048)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Bound resource IDs must be unique",
  );
const locatorId = (entry) =>
  entry.kind === "volume" ? entry.locator.name : entry.locator.id;

function boundEntries(manifest, context, ids) {
  if (
    !manifest ||
    !manifest.executions.some(
      (execution) => execution.id === context.executionId,
    )
  )
    throw new Error("Bound disposal execution is missing");
  return ids.map((id) => {
    const entry = manifest.resources.find((resource) => resource.id === id);
    if (
      !entry ||
      entry.executionId !== context.executionId ||
      entry.provider.type !== "docker"
    )
      throw new Error(
        "Disposal accepts only its bound Docker reservations from this execution",
      );
    return entry;
  });
}

function requireUniqueOwnership(manifests) {
  const seen = new Set();
  for (const manifest of manifests) {
    for (const entry of manifest.resources) {
      if (!entry.locator || entry.state === "removed") continue;
      const identity =
        entry.provider.type === "docker"
          ? [
              entry.provider.type,
              entry.provider.endpoint,
              entry.provider.daemonId,
              entry.kind,
              locatorId(entry),
            ]
          : [
              entry.provider.type,
              entry.provider.deviceSet,
              entry.kind,
              entry.locator.udid.toLowerCase(),
            ];
      const key = JSON.stringify(identity);
      if (seen.has(key))
        throw new Error(
          "Resource appears in multiple task records; ownership is ambiguous",
        );
      seen.add(key);
    }
  }
}

// This is normal fixture teardown bound to creation reservations, not a shortcut
// around the user cleanup CLI's released-execution and confirmation contract.
export async function disposeDockerAllocations(
  context,
  entryIds,
  { manager = new ResourceManager() } = {},
) {
  context = ContextSchema.parse(context);
  const ids = entryIdsSchema.parse(entryIds);
  const initial = await readManifest(context);
  const entries = boundEntries(initial, context, ids);
  // Capture only this handle's interrupted allocations. Never reconcile another
  // fixture's pending resources or infer absence from a failed provider call.
  for (const initialEntry of [...entries].sort(
    (left, right) => (left.kind === "container") - (right.kind === "container"),
  )) {
    const current = await readManifest(context);
    const entry = boundEntries(current, context, [initialEntry.id])[0];
    if (entry.state !== "pending") continue;
    const matches = await manager.docker.discover(entry);
    if (matches.length > 1)
      throw new Error("Bound Docker allocation has ambiguous provider matches");
    if (matches.length === 1) {
      if (entry.locator && locatorId(entry) !== matches[0])
        throw new Error(
          "Bound Docker allocation changed its original identity",
        );
      if (entry.kind === "image" && !entry.expectedTags)
        throw new Error(
          "Pending image disposal requires its original task tag evidence",
        );
      if (entry.kind === "container") {
        const actual = await manager.docker.inspect(
          "container",
          matches[0],
          entry.provider,
        );
        for (const mount of actual?.mounts ?? []) {
          if (mount.Type !== "volume") continue;
          const volume = await manager.docker.inspect(
            "volume",
            mount.Name,
            entry.provider,
          );
          const allocation = current.resources.find(
            (resource) => resource.id === volume?.labels?.["ai.resource"],
          );
          if (allocation?.state === "pending" && !ids.includes(allocation.id))
            throw new Error(
              "Bound container cannot reconcile an unbound pending volume",
            );
        }
      }
      await manager.captureDocker(context, entry.id, matches[0]);
    }
  }
  return withResourceLock(context.workspace, async () => {
    const manifest = await readManifest(context);
    const selected = boundEntries(manifest, context, ids);
    requireUniqueOwnership(await readAllManifests(context.workspace));
    const containers = new Set(
      selected
        .filter((entry) => entry.kind === "container" && entry.locator)
        .map((entry) => entry.locator.id),
    );
    const verify = async (entry) => {
      if (!entry.locator) {
        if ((await manager.docker.discover(entry)).length)
          throw new Error(
            "Unresolved bound allocation appeared during disposal",
          );
        return { state: "absent" };
      }
      const status = await manager.docker.verify(
        entry,
        ownershipLabels(context, manifest, entry),
        containers,
      );
      if (!["present", "absent", "preserved"].includes(status.state))
        throw new Error("Bound Docker resource state is unverified");
      if (entry.state === "removed" && status.state !== "absent")
        throw new Error(
          "A removed bound allocation reappeared; preserve its identity evidence",
        );
      return status;
    };
    // Preflight the entire scope, including dependencies and attachment checks,
    // before removing even its first container.
    const statuses = new Map();
    for (const entry of selected) statuses.set(entry.id, await verify(entry));
    const removed = [];
    const preserved = selected
      .filter((entry) => statuses.get(entry.id).state === "preserved")
      .map((entry) => ({
        entryId: entry.id,
        reason: statuses.get(entry.id).reason,
      }));
    try {
      for (const kind of ["container", "volume", "network", "image"]) {
        for (const entry of selected.filter((item) => item.kind === kind)) {
          if (statuses.get(entry.id).state === "preserved") continue;
          const status = await verify(entry);
          if (status.state === "preserved")
            throw new Error(
              "Bound resource use changed during disposal; preserve remaining evidence",
            );
          if (status.state === "present") await manager.docker.remove(entry);
          if (entry.locator) {
            if (
              await manager.docker.inspect(
                entry.kind,
                locatorId(entry),
                entry.provider,
              )
            )
              throw new Error("Bound Docker deletion postcondition failed");
          } else if ((await manager.docker.discover(entry)).length) {
            throw new Error(
              "Unresolved bound allocation appeared during disposal",
            );
          }
          entry.state = "removed";
          await writeManifestUnlocked(context, manifest);
          removed.push(entry.id);
        }
      }
    } catch (cause) {
      const error = new Error(
        `Bound task resource disposal stopped after ${removed.length} completed entries; keep JSON evidence`,
        { cause },
      );
      error.removed = removed;
      error.preserved = preserved;
      throw error;
    }
    return { removed, preserved };
  });
}

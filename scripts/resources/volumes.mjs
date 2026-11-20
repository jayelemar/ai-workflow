import path from "node:path";
import { ownershipLabels, owns } from "./docker.mjs";
import { validateTaskImage } from "./images.mjs";
import { readAllManifests, readManifest, updateManifest } from "./store.mjs";

const sameProvider = (left, right) =>
  left?.type === "docker" &&
  right?.type === "docker" &&
  left.endpoint === right.endpoint &&
  left.daemonId === right.daemonId;

function validTarget(target) {
  return (
    typeof target === "string" &&
    target.length <= 4096 &&
    target.startsWith("/") &&
    !target.endsWith("/") &&
    !/[\u0000-\u001f\u007f-\u009f,:\\]/.test(target) &&
    path.posix.normalize(target) === target
  );
}

function validSource(source) {
  return (
    typeof source === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(source)
  );
}

function requireOwnedVolume(manifest, context, provider, source) {
  const matches = manifest.resources.filter(
    (entry) =>
      entry.kind === "volume" &&
      entry.locator?.name === source &&
      sameProvider(entry.provider, provider),
  );
  const entry = matches[0];
  if (
    matches.length !== 1 ||
    entry.executionId !== context.executionId ||
    entry.state !== "present" ||
    !entry.locator.created
  )
    throw new Error("Explicit volume does not belong to this task execution");
  return entry;
}

async function verifyVolume(manager, context, manifest, entry) {
  const actual = await manager.docker.inspect(
    "volume",
    entry.locator.name,
    entry.provider,
  );
  if (
    !actual ||
    actual.name !== entry.locator.name ||
    actual.created !== entry.locator.created ||
    !owns(actual.labels, ownershipLabels(context, manifest, entry))
  )
    throw new Error("Volume ownership or creation identity is unverified");
}

async function requireExclusiveVolumeRecord(context, manifest, entry) {
  const all = await readAllManifests(context.workspace);
  if (
    all.some((record) =>
      record.resources.some(
        (other) =>
          other.kind === "volume" &&
          other.state !== "removed" &&
          (record.taskId !== manifest.taskId || other.id !== entry.id) &&
          sameProvider(other.provider, entry.provider) &&
          other.locator?.name === entry.locator.name,
      ),
    )
  )
    throw new Error("Volume is shared by another task resource record");
}

// Preallocating image VOLUMEs provides immutable ownership even after the
// creating container disappears. Docker still chooses each anonymous name.
export async function prepareContainerVolumes({
  manager,
  context,
  provider,
  parent,
  image,
  volumeMounts = [],
}) {
  if (
    typeof image !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)
  )
    throw new Error("A bounded explicit image reference is required");
  if (!Array.isArray(volumeMounts) || volumeMounts.length > 128)
    throw new Error("Container volume mounts exceed the supported limit");
  const { manifest } = await manager.context(context);
  const recordedParent = manifest.resources.find(
    (entry) => entry.id === parent?.id,
  );
  if (
    !recordedParent ||
    recordedParent.kind !== "container" ||
    recordedParent.executionId !== context.executionId ||
    recordedParent.state !== "pending" ||
    !sameProvider(recordedParent.provider, provider)
  )
    throw new Error(
      "Container volumes require a pending allocation in this execution",
    );
  await manager.docker.verifyIdentity(provider);
  const mounts = [];
  const targets = new Set();
  const ownContainerIds = new Set(
    manifest.resources
      .filter(
        (entry) =>
          entry.kind === "container" &&
          entry.executionId === context.executionId &&
          entry.state !== "removed" &&
          entry.locator &&
          sameProvider(entry.provider, provider),
      )
      .map((entry) => entry.locator.id),
  );
  for (const mount of volumeMounts) {
    if (
      !mount ||
      !validSource(mount.source) ||
      !validTarget(mount.target) ||
      (mount.mode !== undefined &&
        mount.mode !== "rw" &&
        mount.mode !== "ro") ||
      targets.has(mount.target)
    )
      throw new Error("Invalid or duplicate explicit container volume mount");
    const entry = requireOwnedVolume(manifest, context, provider, mount.source);
    await verifyVolume(manager, context, manifest, entry);
    await requireExclusiveVolumeRecord(context, manifest, entry);
    const status = await manager.docker.verify(
      entry,
      ownershipLabels(context, manifest, entry),
      ownContainerIds,
    );
    if (status.state !== "present")
      throw new Error("Explicit volume availability is unverified");
    mounts.push({
      source: mount.source,
      target: mount.target,
      mode: mount.mode ?? "rw",
    });
    targets.add(mount.target);
  }
  const resolvedImage = await validateTaskImage({
    manager,
    context,
    provider,
    image,
  });
  let declared;
  try {
    const raw = await manager.docker.command(
      [
        "image",
        "inspect",
        "--format",
        '{{json (index .Config "Volumes")}}',
        resolvedImage.id,
      ],
      provider.endpoint,
    );
    if (raw.length > 1024 * 1024) throw new Error();
    declared = JSON.parse(raw);
  } catch {
    throw new Error("Image volume declarations are unverified");
  }
  if (
    declared !== null &&
    (typeof declared !== "object" || Array.isArray(declared))
  )
    throw new Error("Invalid image volume declarations");
  const declaredTargets = Object.keys(declared ?? {});
  if (
    declaredTargets.length > 128 ||
    declaredTargets.some((target) => !validTarget(target))
  )
    throw new Error("Invalid image volume paths or unsupported volume count");
  if (new Set([...targets, ...declaredTargets]).size > 128)
    throw new Error("Container volume mounts exceed the supported limit");
  const entries = [];
  for (const target of declaredTargets) {
    if (targets.has(target)) continue;
    const { entry, labels } = await manager.reserve(
      context,
      "volume",
      provider,
      [recordedParent.id],
    );
    const args = ["volume", "create"];
    for (const [key, value] of Object.entries(labels))
      args.push("--label", `${key}=${value}`);
    const name = await manager.docker.command(args, provider.endpoint);
    if (!/^[a-f0-9]{64}$/.test(name))
      throw new Error("Docker did not return a verified anonymous volume name");
    await manager.captureDocker(context, entry.id, name);
    const captured = (await readManifest(context)).resources.find(
      (item) => item.id === entry.id,
    );
    if (captured?.state !== "present" || captured.locator?.name !== name)
      throw new Error("Allocated volume capture is incomplete");
    entries.push(captured);
    mounts.push({ source: name, target, mode: "rw" });
  }
  return { mounts, entries };
}

// Normal fixture teardown removes only this call's newly allocated volumes.
// Reused explicit storage remains available for its caller's own lifecycle.
export async function cleanupContainerVolumes({
  manager,
  context,
  containerId,
  entries,
}) {
  if (
    typeof containerId !== "string" ||
    !/^[a-f0-9]{64}$/.test(containerId) ||
    !Array.isArray(entries) ||
    entries.length > 128 ||
    new Set(entries.map((entry) => entry?.id)).size !== entries.length
  )
    throw new Error("Invalid allocated volume teardown entries");
  const manifest = await readManifest(context);
  if (!manifest) throw new Error("Expected task resource record is missing");
  const parent = manifest.resources.find(
    (entry) =>
      entry.kind === "container" &&
      entry.locator?.id === containerId &&
      entry.executionId === context.executionId,
  );
  if (!parent)
    throw new Error(
      "Container teardown identity is not recorded in this execution",
    );
  const selected = entries.map((provided) => {
    const entry = manifest.resources.find((item) => item.id === provided?.id);
    if (
      !entry ||
      entry.kind !== "volume" ||
      !entry.locator ||
      !["present", "removed"].includes(entry.state) ||
      entry.executionId !== context.executionId ||
      !sameProvider(entry.provider, parent.provider) ||
      !entry.dependencies.includes(parent.id) ||
      entry.locator.name !== provided.locator?.name ||
      entry.locator.created !== provided.locator?.created
    )
      throw new Error(
        "Teardown volume is not a captured allocation of this container",
      );
    return entry;
  });
  const requireParentAbsent = async () => {
    await manager.docker.verifyIdentity(parent.provider);
    if (await manager.docker.inspect("container", containerId, parent.provider))
      throw new Error(
        "Container remains present; preserve its allocated volumes",
      );
  };
  await updateManifest(context, async (draft) => {
    await requireParentAbsent();
    const recorded = draft.resources.find((entry) => entry.id === parent.id);
    if (JSON.stringify(recorded?.locator) !== JSON.stringify(parent.locator))
      throw new Error("Container identity changed during fixture teardown");
    recorded.state = "removed";
  });
  for (const selectedEntry of selected) {
    await updateManifest(context, async (draft) => {
      await requireParentAbsent();
      const entry = draft.resources.find(
        (item) => item.id === selectedEntry.id,
      );
      if (
        JSON.stringify(entry.locator) !== JSON.stringify(selectedEntry.locator)
      )
        throw new Error("Volume identity changed during fixture teardown");
      await requireExclusiveVolumeRecord(context, draft, entry);
      const status = await manager.docker.verify(
        entry,
        ownershipLabels(context, draft, entry),
      );
      if (status.state !== "absent") {
        if (entry.state === "removed" || status.state !== "present")
          throw new Error(
            "Removed volume reappeared or its availability is unverified",
          );
        await verifyVolume(manager, context, draft, entry);
        await manager.docker.remove(entry);
      }
      if (
        await manager.docker.inspect(
          "volume",
          entry.locator.name,
          entry.provider,
        )
      )
        throw new Error("Volume deletion postcondition failed");
      entry.state = "removed";
    });
  }
}

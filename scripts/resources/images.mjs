import { ownershipLabels, owns } from "./docker.mjs";
import { readAllManifests } from "./store.mjs";

const ownerKeys = ["ai.task", "ai.execution", "ai.resource", "ai.workspace"];
const sameProvider = (left, right) =>
  left?.type === "docker" &&
  right?.type === "docker" &&
  left.endpoint === right.endpoint &&
  left.daemonId === right.daemonId;

export async function validateTaskImage({ manager, context, provider, image }) {
  if (
    typeof image !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)
  )
    throw new Error("A bounded explicit image reference is required");
  const { manifest } = await manager.context(context);
  await manager.docker.verifyIdentity(provider);
  const imageById = /^sha256:[a-f0-9]{64}$/.test(image);
  const reference =
    imageById ||
    image.includes("@") ||
    image.lastIndexOf(":") > image.lastIndexOf("/")
      ? image
      : `${image}:latest`;
  let available = await manager.docker.list(
    "image",
    provider,
    imageById ? [] : [`reference=${reference}`],
  );
  if (imageById ? !available.includes(image) : available.length === 0) {
    if (imageById) throw new Error("Explicit image ID is not present locally");
    await manager.docker.command(
      ["image", "pull", reference],
      provider.endpoint,
    );
    available = await manager.docker.list("image", provider, [
      `reference=${reference}`,
    ]);
  }
  const ids = imageById ? available.filter((id) => id === image) : available;
  if (ids.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(ids[0]))
    throw new Error("Explicit image does not resolve to one local image ID");
  const actual = await manager.docker.inspect("image", ids[0], provider);
  if (!actual || actual.id !== ids[0])
    throw new Error("Explicit image metadata is unverified");
  if (
    actual.labels !== null &&
    actual.labels !== undefined &&
    (typeof actual.labels !== "object" || Array.isArray(actual.labels))
  )
    throw new Error("Explicit image ownership metadata is malformed");
  // Public base images are shared dependencies. Any ownership key, even an
  // empty or partial label, instead requires this execution's exact record.
  if (!ownerKeys.some((key) => Object.hasOwn(actual.labels ?? {}, key)))
    return actual;
  const matches = manifest.resources.filter(
    (entry) =>
      entry.kind === "image" &&
      entry.state === "present" &&
      entry.executionId === context.executionId &&
      sameProvider(entry.provider, provider) &&
      entry.locator?.id === actual.id,
  );
  const entry = matches[0];
  if (
    matches.length !== 1 ||
    !owns(actual.labels, ownershipLabels(context, manifest, entry))
  )
    throw new Error("Task image does not belong to this execution");
  const all = await readAllManifests(context.workspace);
  if (
    all.some((record) =>
      record.resources.some(
        (other) =>
          other.kind === "image" &&
          other.state !== "removed" &&
          (record.taskId !== manifest.taskId || other.id !== entry.id) &&
          sameProvider(other.provider, provider) &&
          other.locator?.id === actual.id,
      ),
    )
  )
    throw new Error("Task image is claimed by another task resource record");
  return actual;
}

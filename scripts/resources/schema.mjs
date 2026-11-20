import path from "node:path";
import { z } from "zod";

export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const uuid = z.uuid();
const text = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const safeName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      path.isAbsolute(value) &&
      path.normalize(value) === value &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "Expected a normalized absolute path",
  );
export const PlanSchema = z
  .string()
  .max(144)
  .regex(/^\.ai\/plans\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
export const RepositorySchema = z.strictObject({
  id: safeName,
  root: AbsolutePathSchema,
  gitCommonDir: AbsolutePathSchema,
});
export const ContextSchema = z.strictObject({
  workspace: AbsolutePathSchema,
  plan: PlanSchema,
  executionId: uuid,
});
const docker = z.strictObject({
  type: z.literal("docker"),
  endpoint: z
    .string()
    .max(4096)
    .refine((value) => {
      if (!value.startsWith("unix:///")) return false;
      const socket = value.slice("unix://".length);
      return (
        AbsolutePathSchema.safeParse(socket).success && !/[?#%]/.test(socket)
      );
    }, "Only an explicit local Unix socket endpoint is supported"),
  daemonId: text,
});
const ios = z.strictObject({
  type: z.literal("ios"),
  deviceSet: AbsolutePathSchema,
});
const fullId = z.string().regex(/^[a-f0-9]{64}$/);
const created = z.iso.datetime({ offset: true }).max(64);
const base = {
  id: uuid,
  executionId: uuid,
  disposable: z.literal(true),
  state: z.enum(["pending", "present", "removed"]),
  createdAt: created,
  dependencies: z.array(uuid).max(2048),
  ownership: z.strictObject({ taskId: uuid, executionId: uuid, entryId: uuid }),
};
// Provenance is descriptive only; it never grants authority over host paths.
export const ComposeProvenanceSchema = z.strictObject({
  project: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  directory: AbsolutePathSchema,
});
export const ExpectedImageTagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/),
  )
  .min(1)
  .max(128)
  .refine(
    (tags) => new Set(tags).size === tags.length,
    "Expected image tags must be unique",
  );
export const ResourceMetadataSchema = z.strictObject({
  compose: ComposeProvenanceSchema.optional(),
  expectedTags: ExpectedImageTagsSchema.optional(),
});
const resource = (kind, provider, locator) =>
  z
    .strictObject({
      ...base,
      kind: z.literal(kind),
      provider,
      locator: locator.nullable(),
      ...(kind !== "ios-simulator"
        ? { compose: ComposeProvenanceSchema.optional() }
        : {}),
      ...(kind === "image"
        ? { expectedTags: ExpectedImageTagsSchema.optional() }
        : {}),
    })
    .superRefine((entry, ctx) => {
      if (entry.state === "present" && entry.locator === null)
        ctx.addIssue({
          code: "custom",
          path: ["locator"],
          message: "Registered resources require a locator",
        });
    });
const ResourceSchema = z.discriminatedUnion("kind", [
  resource("container", docker, z.strictObject({ id: fullId, created })),
  resource(
    "volume",
    docker,
    z.strictObject({ name: safeName, created, containerId: fullId.nullable() }),
  ),
  resource("network", docker, z.strictObject({ id: fullId, created })),
  resource(
    "image",
    docker,
    z.strictObject({
      id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      tags: z
        .array(
          z
            .string()
            .min(1)
            .max(256)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/),
        )
        .max(128),
    }),
  ),
  resource(
    "ios-simulator",
    ios,
    z.strictObject({ udid: uuid, deviceType: text, runtime: text, name: text }),
  ),
]);

function locatorIdentity(resource) {
  if (!resource.locator) return null;
  const provider =
    resource.provider.type === "docker"
      ? `${resource.provider.endpoint}\0${resource.provider.daemonId}`
      : resource.provider.deviceSet;
  const locator =
    resource.kind === "ios-simulator"
      ? resource.locator.udid.toLowerCase()
      : resource.kind === "volume"
        ? resource.locator.name
        : resource.locator.id;
  return `${provider}\0${resource.kind}\0${locator}`;
}

export const ManifestSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: uuid,
    workspace: AbsolutePathSchema,
    plan: PlanSchema,
    executions: z
      .array(
        z.strictObject({
          id: uuid,
          root: AbsolutePathSchema,
          mode: z.enum(["main", "worktree"]),
          repositories: z.array(RepositorySchema).max(128),
          active: z.boolean(),
        }),
      )
      .max(512),
    resources: z.array(ResourceSchema).max(2048),
  })
  .superRefine((manifest, ctx) => {
    const issue = (message) => ctx.addIssue({ code: "custom", message });
    const executionIds = new Set();
    const resourceIds = new Set();
    const identities = new Set();
    for (const execution of manifest.executions) {
      if (executionIds.has(execution.id.toLowerCase()))
        issue("Duplicate execution ID");
      executionIds.add(execution.id.toLowerCase());
      if (
        new Set(execution.repositories.map((repo) => repo.id)).size !==
          execution.repositories.length ||
        new Set(execution.repositories.map((repo) => repo.root)).size !==
          execution.repositories.length
      )
        issue("Duplicate repository mapping");
    }
    for (const entry of manifest.resources) {
      if (resourceIds.has(entry.id.toLowerCase()))
        issue("Duplicate resource ID");
      resourceIds.add(entry.id.toLowerCase());
      if (
        !manifest.executions.some(
          (execution) => execution.id === entry.executionId,
        )
      )
        issue("Unknown resource execution");
      if (
        entry.ownership.taskId !== manifest.taskId ||
        entry.ownership.executionId !== entry.executionId ||
        entry.ownership.entryId !== entry.id
      )
        issue("Resource ownership does not match manifest identity");
      const identity = locatorIdentity(entry);
      if (identity && identities.has(identity))
        issue("Duplicate provider resource identity");
      if (identity) identities.add(identity);
    }
    for (const entry of manifest.resources) {
      if (new Set(entry.dependencies).size !== entry.dependencies.length)
        issue("Duplicate resource dependency");
      for (const dependency of entry.dependencies) {
        const target = manifest.resources.find(
          (candidate) => candidate.id === dependency,
        );
        if (!target || dependency === entry.id)
          issue("Invalid resource dependency");
        else if (target.executionId !== entry.executionId)
          issue("Cross-execution resource dependency");
      }
    }
  });

export function parseManifest(value) {
  return ManifestSchema.parse(value);
}

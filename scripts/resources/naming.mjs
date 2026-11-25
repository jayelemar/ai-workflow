import path from "node:path";
import { z } from "zod";
import { ProjectNameSchema } from "./schema.mjs";

export function slug(value) {
  if (typeof value !== "string")
    throw new Error("Missing resource name segment");
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  if (!normalized) throw new Error("Empty resource name segment");
  return normalized;
}

export const resourceProject = (manifest) =>
  ProjectNameSchema.parse(
    manifest.projectName ?? path.basename(manifest.workspace),
  );
export const taskName = (manifest) => path.basename(manifest.plan, ".md");

export function dockerName(manifest, description, allocationId) {
  const suffix = z
    .uuid()
    .parse(allocationId)
    .replaceAll("-", "")
    .slice(0, 12)
    .toLowerCase();
  return [
    slug(resourceProject(manifest)),
    slug(taskName(manifest)),
    slug(description),
    suffix,
  ].join("-");
}

export function imageDescription(image) {
  const repository = image.split("@")[0].split("/").at(-1).split(":")[0];
  return slug(repository);
}

const shorten = (value, limit) => {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
};

export function deviceName(manifest, model, existingNames) {
  const project = resourceProject(manifest);
  const task = taskName(manifest);
  for (const value of [task, model]) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value)
    )
      throw new Error("Invalid device name metadata");
  }
  // Leave room for numbered instances without changing the base label.
  const budget = 240 - model.length - 6;
  if (budget < 2) throw new Error("Device model exceeds name limit");
  const projectBudget = Math.min(
    project.length,
    Math.max(Math.floor(budget / 2), budget - task.length),
  );
  const base = `${shorten(project, projectBudget)} · ${shorten(task, budget - projectBudget)} · ${model}`;
  const names = new Set(existingNames);
  let name = base;
  for (let number = 2; names.has(name); number++) name = `${base} (${number})`;
  if (name.length > 256) throw new Error("Device name exceeds provider limit");
  return name;
}

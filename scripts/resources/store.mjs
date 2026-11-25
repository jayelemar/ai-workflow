import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { hostname } from "node:os";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  AbsolutePathSchema,
  ContextSchema,
  MAX_MANIFEST_BYTES,
  PlanSchema,
  ProjectNameSchema,
  RepositorySchema,
  parseManifest,
} from "./schema.mjs";

const execute = promisify(execFile);
const inside = (base, target) =>
  target === base || target.startsWith(`${base}${path.sep}`);
const worktreePart = (target) => target.split(path.sep).includes(".worktrees");
const fail = (message) => {
  throw new Error(message);
};

// Inspect every existing component, including ancestors outside the workspace.
// No read or write accepts a symlink as a substitute for the canonical path.
async function noSymlinks(target, { missing = false } = {}) {
  AbsolutePathSchema.parse(target);
  const segments = target.slice(path.parse(target).root.length).split(path.sep);
  let current = path.parse(target).root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (missing && error.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) fail("Symlinked resource path is forbidden");
    if (current !== target && !info.isDirectory())
      fail("Resource path ancestor is not a directory");
  }
}

async function git(directory, ...args) {
  const { stdout } = await execute("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
    },
  });
  return stdout.trim();
}

async function repositoryIdentity(root) {
  await noSymlinks(root);
  if ((await realpath(root)) !== root) fail("Repository path is not canonical");
  if ((await git(root, "rev-parse", "--show-toplevel")) !== root)
    fail("Expected an exact Git repository root");
  const common = await git(
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  await noSymlinks(common);
  if (!(await lstat(common)).isDirectory())
    fail("Git common directory is not a directory");
  return common;
}

async function validateWorkspace(workspace) {
  AbsolutePathSchema.parse(workspace);
  if (worktreePart(workspace))
    fail("Source workspace cannot be beneath .worktrees");
  await noSymlinks(workspace);
  if (
    !(await lstat(workspace)).isDirectory() ||
    (await realpath(workspace)) !== workspace
  )
    fail("Source workspace is not a canonical directory");
  const workflow = path.join(workspace, ".ai");
  if ((await repositoryIdentity(workflow)) !== path.join(workflow, ".git"))
    fail("Source .ai must be its own primary Git repository");
  return workspace;
}

async function validateSource(workspace, plan) {
  await validateWorkspace(workspace);
  PlanSchema.parse(plan);
  const source = path.join(workspace, plan);
  await noSymlinks(source);
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile())
      fail("Source plan must be a readable regular file");
    await handle.read(Buffer.alloc(1), 0, 1, 0);
  } finally {
    await handle.close();
  }
}

function artifactPath(workspace, plan) {
  return path.join(
    workspace,
    ".ai",
    "artifacts",
    path.basename(plan, ".md"),
    "resources.json",
  );
}

async function ensureDirectory(directory) {
  await noSymlinks(directory, { missing: true });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await noSymlinks(directory);
  if (!(await lstat(directory)).isDirectory())
    fail("Resource directory is not a directory");
}

async function readBytesBounded(file, description = "Resource manifest") {
  await noSymlinks(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail(`${description} is not a regular file`);
    if (info.size > MAX_MANIFEST_BYTES)
      fail(`${description} exceeds 2 MB limit`);
    const bytes = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        used,
        bytes.length - used,
        null,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > MAX_MANIFEST_BYTES) fail(`${description} exceeds 2 MB limit`);
    return bytes.subarray(0, used);
  } finally {
    await handle.close();
  }
}

async function readBounded(file) {
  const bytes = await readBytesBounded(file);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Malformed resource JSON; content omitted");
  }
}

async function sourcePlanRecord(workspace, plan) {
  PlanSchema.parse(plan);
  const source = path.join(workspace, plan);
  const bytes = await readBytesBounded(source, "Source plan");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const markers = text
    .split(/\r?\n/)
    .filter((line) => /^\s*<!--\s*task-resources\b/i.test(line));
  if (markers.length > 1)
    fail("Source plan has duplicate task resource markers");
  let taskId = null;
  if (markers.length) {
    const marker = markers[0].match(/^<!-- task-resources: ([^ ]+) -->$/);
    if (
      !marker ||
      !ContextSchema.shape.executionId.safeParse(marker[1]).success
    )
      fail("Source plan has an invalid task resource marker");
    taskId = marker[1];
  }
  return { source, bytes, taskId };
}

function missingManifest(plan) {
  fail(
    `Expected task resource manifest is missing for ${plan}; preserve the source plan and recover its ownership record`,
  );
}

function checkPlanMarker(taskId, manifest, plan) {
  if (taskId && !manifest) missingManifest(plan);
  if (taskId && taskId !== manifest.taskId)
    fail("Source plan task resource marker does not match manifest ownership");
}

async function ensurePlanMarker(workspace, plan, taskId) {
  const record = await sourcePlanRecord(workspace, plan);
  if (record.taskId) {
    checkPlanMarker(record.taskId, { taskId }, plan);
    return;
  }
  const suffix = `${record.bytes.length && record.bytes.at(-1) !== 10 ? "\n" : ""}\n<!-- task-resources: ${taskId} -->\n`;
  const bytes = Buffer.concat([record.bytes, Buffer.from(suffix)]);
  if (bytes.length > MAX_MANIFEST_BYTES) fail("Source plan exceeds 2 MB limit");
  const mode = (await lstat(record.source)).mode & 0o777;
  const temporary = path.join(
    path.dirname(record.source),
    `.task-resources-${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = null;
    const current = await sourcePlanRecord(workspace, plan);
    if (!current.bytes.equals(record.bytes))
      fail(
        "Source plan changed while adding its task resource marker; retry initialization",
      );
    await noSymlinks(record.source);
    await rename(temporary, record.source);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function expectedPlans(workspace) {
  const directory = path.join(workspace, ".ai", "plans");
  await noSymlinks(directory, { missing: true });
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
  const expected = new Set();
  for (const child of children) {
    const plan = `.ai/plans/${child.name}`;
    if (!PlanSchema.safeParse(plan).success) continue;
    const record = await sourcePlanRecord(workspace, plan);
    if (record.taskId) expected.add(plan);
  }
  return expected;
}

async function validateStoredContext(manifest, workspace, plan) {
  if (manifest.workspace !== workspace || manifest.plan !== plan)
    fail("Manifest source context mismatch");
  const worktrees = path.join(workspace, ".worktrees");
  for (const execution of manifest.executions) {
    if (
      execution.mode === "main"
        ? !inside(workspace, execution.root) || worktreePart(execution.root)
        : !inside(worktrees, execution.root) || execution.root === worktrees
    )
      fail("Manifest execution root escapes its source context");
    await noSymlinks(execution.root, {
      missing: execution.mode === "worktree",
    });
    if (execution.mode === "worktree" && execution.repositories.length === 0)
      fail("Worktree execution requires registered source repositories");
    for (const repo of execution.repositories) {
      if (
        !inside(execution.root, repo.root) ||
        !inside(workspace, repo.gitCommonDir) ||
        worktreePart(repo.gitCommonDir)
      )
        fail("Manifest repository mapping escapes its source context");
      // Historical worktrees can already be gone during a cleanup retry. Their
      // surviving primary Git identity remains mandatory; existing checkouts
      // must still prove native worktree registration rather than copied files.
      if (
        path.basename(repo.gitCommonDir) !== ".git" ||
        (await repositoryIdentity(path.dirname(repo.gitCommonDir))) !==
          repo.gitCommonDir
      )
        fail("Manifest primary repository identity mismatch");
      let exists = true;
      try {
        await lstat(repo.root);
      } catch (error) {
        if (execution.mode === "worktree" && error.code === "ENOENT")
          exists = false;
        else throw error;
      }
      if (exists)
        await validateRepository(
          workspace,
          execution.root,
          execution.mode,
          repo,
        );
    }
    if (
      execution.mode === "main" &&
      execution.root !== workspace &&
      !execution.repositories.some((repo) => repo.root === execution.root)
    )
      fail(
        "Main execution root must be a primary repository or source workspace",
      );
  }
  return manifest;
}

async function readAt(workspace, plan) {
  const { taskId } = await sourcePlanRecord(workspace, plan);
  const file = artifactPath(workspace, plan);
  await noSymlinks(file, { missing: true });
  let manifest;
  try {
    manifest = parseManifest(await readBounded(file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  checkPlanMarker(taskId, manifest, plan);
  return manifest ? validateStoredContext(manifest, workspace, plan) : null;
}

export async function readManifestUnlocked(context) {
  const { workspace, plan, executionId } = ContextSchema.parse(context);
  await validateSource(workspace, plan);
  const manifest = await readAt(workspace, plan);
  if (
    manifest &&
    !manifest.executions.some((execution) => execution.id === executionId)
  )
    fail("Unknown resource execution context");
  return manifest;
}
export const readManifest = readManifestUnlocked;

// Cleanup selects plans, not one execution. Keep execution-bound reads strict
// for provisioning, and expose a separate validated read for selection.
export async function readPlanManifest({ workspace, plan }) {
  await validateSource(workspace, plan);
  return readAt(workspace, plan);
}

export async function readAllManifests(workspace) {
  await validateWorkspace(workspace);
  const expected = await expectedPlans(workspace);
  const directory = path.join(workspace, ".ai", "artifacts");
  await noSymlinks(directory, { missing: true });
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      if (expected.size) missingManifest(expected.values().next().value);
      return [];
    }
    throw error;
  }
  const manifests = [];
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (child.isSymbolicLink())
      fail("Symlinked artifact directory is forbidden");
    if (!child.isDirectory()) continue;
    const file = path.join(directory, child.name, "resources.json");
    await noSymlinks(file, { missing: true });
    let manifest;
    try {
      manifest = parseManifest(await readBounded(file));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const plan = `.ai/plans/${child.name}.md`;
    await validateSource(workspace, plan);
    checkPlanMarker(
      (await sourcePlanRecord(workspace, plan)).taskId,
      manifest,
      plan,
    );
    manifests.push(await validateStoredContext(manifest, workspace, plan));
    expected.delete(plan);
  }
  if (expected.size) missingManifest(expected.values().next().value);
  return manifests;
}

export async function withResourceLock(
  workspace,
  callback,
  { waitMs = 30_000 } = {},
) {
  if (!Number.isFinite(waitMs) || waitMs < 0)
    fail("Resource lock wait must be a finite nonnegative number");
  await validateWorkspace(workspace);
  const temporary = path.join(workspace, ".ai", "tmp");
  await ensureDirectory(temporary);
  const lock = path.join(temporary, "task-resources.lock");
  const deadline = performance.now() + waitMs;
  while (true) {
    await noSymlinks(lock, { missing: true });
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        const busy = new Error(
          "Resource lock is busy; verify its owner before recovering a stale lock",
        );
        busy.code = "RESOURCE_LOCK_BUSY";
        throw busy;
      }
      // Fixture teardown can overlap other writers; never recover a holder here.
      await delay(Math.min(50, remaining));
    }
  }
  const owner = path.join(lock, "owner.json");
  try {
    const handle = await open(owner, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          hostname: hostname(),
          startedAt: new Date().toISOString(),
        }),
      );
    } finally {
      await handle.close();
    }
    return await callback();
  } finally {
    await noSymlinks(lock);
    await unlink(owner).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(lock);
  }
}

export async function writeManifestUnlocked(context, input) {
  const { workspace, plan, executionId } = ContextSchema.parse(context);
  await validateSource(workspace, plan);
  const manifest = await validateStoredContext(
    parseManifest(input),
    workspace,
    plan,
  );
  if (!manifest.executions.some((execution) => execution.id === executionId))
    fail("Unknown resource execution context");
  const previous = await readAt(workspace, plan);
  if (previous && previous.taskId !== manifest.taskId)
    fail("Cannot replace task ownership identity");
  const data = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(data) > MAX_MANIFEST_BYTES)
    fail("Resource manifest exceeds 2 MB limit");
  const artifacts = path.join(workspace, ".ai", "artifacts");
  await ensureDirectory(artifacts);
  const destination = artifactPath(workspace, plan);
  await ensureDirectory(path.dirname(destination));
  await noSymlinks(destination, { missing: true });
  const temporary = path.join(
    path.dirname(destination),
    `.resources-${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await noSymlinks(destination, { missing: true });
    await rename(temporary, destination);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return manifest;
}

export async function updateManifest(context, mutate) {
  ContextSchema.parse(context);
  return withResourceLock(context.workspace, async () => {
    const manifest = await readManifestUnlocked(context);
    if (!manifest) fail("Resource manifest is missing");
    const result = await mutate(manifest);
    await writeManifestUnlocked(context, manifest);
    return result;
  });
}

async function validateRepository(workspace, root, mode, input) {
  const repo = RepositorySchema.parse(input);
  if (!inside(root, repo.root))
    fail("Execution repository is outside its root");
  const common = await repositoryIdentity(repo.root);
  if (
    common !== repo.gitCommonDir ||
    !inside(workspace, common) ||
    worktreePart(common) ||
    path.basename(common) !== ".git"
  )
    fail("Repository does not belong to a primary source checkout");
  const source = path.dirname(common);
  if ((await repositoryIdentity(source)) !== common)
    fail("Repository source identity mismatch");
  if (mode === "main") {
    if (repo.root !== source || worktreePart(repo.root))
      fail("Main execution requires primary checkout repositories");
  } else {
    const registered = (
      await git(source, "worktree", "list", "--porcelain", "-z")
    ).split("\0");
    if (repo.root === source || !registered.includes(`worktree ${repo.root}`))
      fail("Execution root is not a registered source worktree");
  }
  return repo;
}

async function discoverRepositories(workspace, root, mode) {
  const candidates = [root];
  for (const child of await readdir(root, { withFileTypes: true })) {
    if (child.isDirectory() && !child.name.startsWith("."))
      candidates.push(path.join(root, child.name));
  }
  const repositories = [];
  for (const candidate of candidates) {
    try {
      const common = await repositoryIdentity(candidate);
      const repository = await validateRepository(workspace, root, mode, {
        id: candidate === root ? "root" : path.basename(candidate),
        root: candidate,
        gitCommonDir: common,
      });
      repositories.push(repository);
    } catch (error) {
      // A coordination directory need not itself be a repository. An explicit
      // mapping is validated without this discovery fallback.
      if (candidate === root && root !== workspace && mode === "main")
        throw error;
    }
  }
  return repositories;
}

export async function initExecution({
  workspace,
  plan,
  root = workspace,
  repositories,
  resume,
  verifyResume,
  projectName,
}) {
  if (projectName !== undefined) ProjectNameSchema.parse(projectName);
  await validateSource(workspace, plan);
  AbsolutePathSchema.parse(root);
  await noSymlinks(root);
  if (!(await lstat(root)).isDirectory())
    fail("Execution root is not a directory");
  const worktrees = path.join(workspace, ".worktrees");
  const mode =
    inside(worktrees, root) && root !== worktrees ? "worktree" : "main";
  if (!inside(workspace, root) || (mode === "main" && worktreePart(root)))
    fail("Execution root escapes source workspace");
  const mappings =
    repositories === undefined
      ? await discoverRepositories(workspace, root, mode)
      : await Promise.all(
          repositories.map((repo) =>
            validateRepository(workspace, root, mode, repo),
          ),
        );
  if (mode === "worktree" && !mappings.length)
    fail("Worktree execution requires registered source repositories");
  if (
    mode === "main" &&
    root !== workspace &&
    !mappings.some((repo) => repo.root === root)
  )
    fail(
      "Main execution root must be a primary repository or source workspace",
    );
  if (resume !== undefined) ContextSchema.shape.executionId.parse(resume);
  return withResourceLock(workspace, async () => {
    const manifest = (await readAt(workspace, plan)) ?? {
      version: 1,
      taskId: randomUUID(),
      workspace,
      plan,
      executions: [],
      resources: [],
    };
    if (
      projectName !== undefined &&
      manifest.projectName !== undefined &&
      projectName !== manifest.projectName
    )
      fail("Project name conflicts with the recorded label");
    manifest.projectName ??= ProjectNameSchema.parse(
      projectName ?? path.basename(workspace),
    );
    const context = { workspace, plan, executionId: resume ?? randomUUID() };
    if (resume) {
      const execution = manifest.executions.find(
        (entry) => entry.id === resume,
      );
      const sorted = (entries) =>
        [...entries].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !execution ||
        execution.root !== root ||
        execution.mode !== mode ||
        JSON.stringify(sorted(execution.repositories)) !==
          JSON.stringify(sorted(mappings))
      )
        fail("Resume execution identity does not match current checkout");
      if (manifest.resources.some((entry) => entry.executionId === resume)) {
        if (typeof verifyResume !== "function")
          fail(
            "Resume with resources must use the original resource helper for live verification",
          );
        // The filesystem store owns the locked transition. Native verification
        // receives a copy of the context, never the manifest it will persist.
        await verifyResume(structuredClone(context));
      }
      execution.active = true;
    } else
      manifest.executions.push({
        id: context.executionId,
        root,
        mode,
        repositories: mappings,
        active: true,
      });
    await writeManifestUnlocked(context, manifest);
    await ensurePlanMarker(workspace, plan, manifest.taskId);
    return context;
  });
}

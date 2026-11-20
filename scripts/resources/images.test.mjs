import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerProvider } from "./docker.mjs";
import { validateTaskImage } from "./images.mjs";
import { ResourceManager } from "./manager.mjs";
import { initExecution, updateManifest } from "./store.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
class FakeDocker extends DockerProvider {
  constructor() {
    super();
    this.provider = {
      type: "docker",
      endpoint: "unix:///private/tmp/image-test.sock",
      daemonId: "image-test-daemon",
    };
    this.actual = { id: imageId, labels: {}, tags: ["fixture:1"] };
    this.available = [imageId];
    this.commands = [];
  }
  async identity() {
    return structuredClone(this.provider);
  }
  async list(kind, provider, filters = []) {
    await this.verifyIdentity(provider);
    assert.equal(kind, "image");
    assert.ok(filters.length === 0 || filters[0] === "reference=fixture:1");
    return [...this.available];
  }
  async inspect(kind, id, provider) {
    await this.verifyIdentity(provider);
    assert.equal(kind, "image");
    return this.available.includes(id) ? structuredClone(this.actual) : null;
  }
  async command(args, endpoint) {
    assert.equal(endpoint, this.provider.endpoint);
    assert.deepEqual(args, ["image", "pull", "fixture:1"]);
    this.commands.push([...args]);
    this.available = [imageId];
    return "safe pull result";
  }
}

async function fixture(t) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "resource-images-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const workflow = path.join(workspace, ".ai");
  await mkdir(path.join(workflow, "plans"), { recursive: true });
  execFileSync("rtk", ["proxy", "git", "-C", workflow, "init", "-b", "main"], {
    stdio: "pipe",
  });
  const plan = ".ai/plans/images.md";
  await writeFile(
    path.join(workspace, plan),
    "# Disposable image policy test\n",
  );
  const context = await initExecution({ workspace, plan });
  const docker = new FakeDocker();
  const manager = new ResourceManager({ docker });
  const provider = await docker.identity();
  return { manager, context, provider, docker, image: "fixture:1" };
}

async function registerImage(f, context = f.context) {
  const { entry, labels } = await f.manager.reserve(
    context,
    "image",
    f.provider,
  );
  f.docker.actual.labels = labels;
  await f.manager.captureDocker(context, entry.id, imageId, {
    tags: ["fixture:1"],
  });
  return entry;
}

test("public base image metadata is allowed without ownership and absent exact references are pulled", async (t) => {
  const f = await fixture(t);
  f.docker.actual.labels = { "org.opencontainers.image.title": "public base" };
  assert.equal((await validateTaskImage(f)).id, imageId);
  assert.equal(f.docker.commands.length, 0);
  f.docker.available = [];
  assert.equal((await validateTaskImage(f)).id, imageId);
  assert.deepEqual(f.docker.commands, [["image", "pull", "fixture:1"]]);
});

test("tagless references resolve latest independently of other cached repository tags", async (t) => {
  for (const repository of [
    "alpine",
    "namespace/alpine",
    "localhost:5000/namespace/alpine",
  ]) {
    for (const latestCached of [false, true]) {
      const f = await fixture(t);
      const latest = `${repository}:latest`;
      const otherId = `sha256:${"b".repeat(64)}`;
      const cache = new Map([[otherId, [`${repository}:3.18`]]]);
      if (latestCached) cache.set(imageId, [latest]);
      const lookups = [];
      const pulls = [];
      f.docker.list = async (kind, provider, filters) => {
        await f.docker.verifyIdentity(provider);
        assert.equal(kind, "image");
        const reference = filters[0].slice("reference=".length);
        lookups.push(reference);
        return [...cache]
          .filter(([, tags]) =>
            tags.some(
              (tag) =>
                tag === reference ||
                (reference === repository && tag.startsWith(`${repository}:`)),
            ),
          )
          .map(([id]) => id);
      };
      f.docker.command = async (args) => {
        pulls.push(args);
        assert.deepEqual(args, ["image", "pull", latest]);
        cache.set(imageId, [latest]);
        return "";
      };
      f.docker.inspect = async (_kind, id) => ({
        id,
        labels: {},
        tags: cache.get(id),
      });
      const request = { ...f, image: repository };
      assert.equal((await validateTaskImage(request)).id, imageId);
      assert.equal(request.image, repository);
      assert.ok(lookups.every((reference) => reference === latest));
      assert.equal(pulls.length, latestCached ? 0 : 1);
    }
  }
});

test("digest references retain their exact requested identity", async (t) => {
  const f = await fixture(t);
  const image = `registry.example/repository@sha256:${"c".repeat(64)}`;
  f.docker.list = async (_kind, _provider, filters) => {
    assert.deepEqual(filters, [`reference=${image}`]);
    return [imageId];
  };
  assert.equal((await validateTaskImage({ ...f, image })).id, imageId);
  assert.deepEqual(f.docker.commands, []);
});

test("partial or unrecorded ownership labels never become shared base images", async (t) => {
  const f = await fixture(t);
  for (const key of [
    "ai.task",
    "ai.execution",
    "ai.resource",
    "ai.workspace",
  ]) {
    f.docker.actual.labels = {
      [key]: key === "ai.workspace" ? f.context.workspace : randomUUID(),
    };
    await assert.rejects(validateTaskImage(f));
  }
  f.docker.actual.labels = {
    "ai.task": randomUUID(),
    "ai.execution": f.context.executionId,
    "ai.resource": randomUUID(),
    "ai.workspace": f.context.workspace,
  };
  await assert.rejects(validateTaskImage(f));
});

test("task-built images from another execution or task are refused", async (t) => {
  const f = await fixture(t);
  const otherExecution = await initExecution({
    workspace: f.context.workspace,
    plan: f.context.plan,
  });
  await registerImage(f, otherExecution);
  await assert.rejects(validateTaskImage(f));
  const plan = ".ai/plans/other-images.md";
  await writeFile(path.join(f.context.workspace, plan), "# Other image task\n");
  const otherTask = await initExecution({
    workspace: f.context.workspace,
    plan,
  });
  await registerImage(f, otherTask);
  await assert.rejects(validateTaskImage(f));
});

test("only a present current-execution image record with matching native labels permits task image reuse", async (t) => {
  const f = await fixture(t);
  const entry = await registerImage(f);
  assert.equal((await validateTaskImage(f)).id, imageId);
  const labels = f.docker.actual.labels;
  f.docker.actual.labels = { ...labels, "ai.resource": randomUUID() };
  await assert.rejects(validateTaskImage(f));
  f.docker.actual.labels = labels;
  await updateManifest(f.context, (manifest) => {
    manifest.resources.find((item) => item.id === entry.id).state = "removed";
  });
  await assert.rejects(validateTaskImage(f));
});

test("duplicate live image claims in another task record prevent reuse", async (t) => {
  const f = await fixture(t);
  await registerImage(f);
  const plan = ".ai/plans/duplicate-images.md";
  await writeFile(
    path.join(f.context.workspace, plan),
    "# Duplicate image task\n",
  );
  const other = await initExecution({ workspace: f.context.workspace, plan });
  const { entry } = await f.manager.reserve(other, "image", f.provider);
  await updateManifest(other, (manifest) => {
    const duplicate = manifest.resources.find((item) => item.id === entry.id);
    duplicate.locator = { id: imageId, tags: ["fixture:1"] };
    duplicate.state = "present";
  });
  await assert.rejects(validateTaskImage(f));
});

test("invalid, missing local IDs and ambiguous reference matches are refused", async (t) => {
  const f = await fixture(t);
  for (const image of ["", "-option", "fixture\nprivate", "a".repeat(257)])
    await assert.rejects(validateTaskImage({ ...f, image }));
  assert.equal((await validateTaskImage({ ...f, image: imageId })).id, imageId);
  f.docker.available = [];
  await assert.rejects(validateTaskImage({ ...f, image: imageId }));
  assert.equal(f.docker.commands.length, 0);
  f.docker.available = [imageId, `sha256:${"b".repeat(64)}`];
  await assert.rejects(validateTaskImage(f));
});

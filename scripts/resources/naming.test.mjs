import assert from "node:assert/strict";
import test from "node:test";
import {
  dockerName,
  deviceName,
  imageDescription,
  resourceProject,
  slug,
  taskName,
} from "./naming.mjs";

const manifest = {
  workspace: "/projects/myuse-rewrite",
  projectName: "MyUse",
  plan: ".ai/plans/wardrobe-gallery.md",
};
const id = "12345678-abcd-4123-8123-123456789abc";

test("names identify source project and plan independently of execution directories", () => {
  assert.equal(resourceProject(manifest), "MyUse");
  assert.equal(taskName(manifest), "wardrobe-gallery");
  assert.equal(
    dockerName(manifest, "Postgres", id),
    "myuse-wardrobe-gallery-postgres-12345678abcd",
  );
  assert.notEqual(
    dockerName(manifest, "Postgres", id),
    dockerName(manifest, "Postgres", "abcdefab-abcd-4123-8123-123456789abc"),
  );
  const legacy = { ...manifest };
  delete legacy.projectName;
  assert.equal(resourceProject(legacy), "myuse-rewrite");
  assert.equal(
    deviceName(manifest, "iPhone 16 Pro", []),
    "MyUse · wardrobe-gallery · iPhone 16 Pro",
  );
});

test("device duplicates fill numbered gaps without OS versions or renaming existing labels", () => {
  const base = "MyUse · wardrobe-gallery · iPhone 16 Pro";
  assert.equal(
    deviceName(manifest, "iPhone 16 Pro", [base, `${base} (3)`]),
    `${base} (2)`,
  );
  assert.equal(
    deviceName(manifest, "iPhone 16 Pro", [base, `${base} (2)`]),
    `${base} (3)`,
  );
});

test("formatting bounds preserve model and allocation identity and reject unusable labels", () => {
  assert.equal(slug(" MyUse / QA__One! "), "myuse-qa-one");
  assert.equal(slug("a".repeat(33)), "a".repeat(32));
  assert.throws(() => slug("漢字"), /name|segment/i);
  assert.throws(() =>
    deviceName({ ...manifest, projectName: "bad\nlabel" }, "iPhone", []),
  );
  const long = {
    ...manifest,
    projectName: "A".repeat(256),
    plan: `.ai/plans/${"long-".repeat(25)}task.md`,
  };
  const name = deviceName(long, "iPhone 16 Pro", []);
  assert.ok(name.length <= 256);
  assert.ok(name.endsWith(" · iPhone 16 Pro"));
  assert.ok(deviceName(long, "iPhone 16 Pro", [name]).length <= 256);
  assert.ok(dockerName(long, "v".repeat(100), id).length <= 128);
});

test("image descriptions exclude registry ports, tags and digests", () => {
  for (const image of [
    "postgres:18-alpine",
    "localhost:5000/team/postgres:18",
    `registry/team/postgres@sha256:${"a".repeat(64)}`,
  ])
    assert.equal(imageDescription(image), "postgres");
});

test("Unicode human labels stay readable while Docker rejects an empty ASCII segment", () => {
  const human = { ...manifest, projectName: "旅行" };
  assert.equal(
    deviceName(human, "iPhone 16 Pro", []),
    "旅行 · wardrobe-gallery · iPhone 16 Pro",
  );
  assert.throws(() => dockerName(human, "postgres", id), /segment/);
});

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AbsolutePathSchema } from "./schema.mjs";
import { deviceName } from "./naming.mjs";

const execute = promisify(execFile);
const uuid = z.uuid();
const OwnerSchema = z.strictObject({
  taskId: uuid,
  executionId: uuid,
  entryId: uuid,
});
const CreationOwnerSchema = OwnerSchema.extend({
  workspace: AbsolutePathSchema,
});
const ProofSchema = CreationOwnerSchema.extend({ udid: uuid });
const MAX_PROOF_BYTES = 8192;
const OWNER_FILE = ".task-resources-owner.json";

function ownershipProof(ownership, workspace, udid) {
  const owner = OwnerSchema.safeParse(ownership);
  const proof = ProofSchema.safeParse({ ...owner.data, workspace, udid });
  if (!owner.success || !proof.success)
    throw new Error("Unverified Simulator ownership evidence");
  // Simulator UDIDs are case-insensitive, including the persisted proof.
  return { ...proof.data, udid: proof.data.udid.toLowerCase() };
}

export class IOSProvider {
  constructor({
    run = execute,
    deviceSet = path.join(
      os.homedir(),
      "Library/Developer/CoreSimulator/Devices",
    ),
  } = {}) {
    this.run = run;
    this.deviceSet = deviceSet;
  }

  async identity() {
    if (
      !path.isAbsolute(this.deviceSet) ||
      path.normalize(this.deviceSet) !== this.deviceSet
    ) {
      throw new Error("Unverified Simulator device-set path");
    }
    let current = path.parse(this.deviceSet).root;
    for (const part of this.deviceSet.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error("Unsafe Simulator device-set ancestor");
    }
    return { type: "ios", deviceSet: await realpath(this.deviceSet) };
  }

  async command(args, provider) {
    if (provider?.type !== "ios")
      throw new Error("Unsupported Simulator provider");
    const current = await this.identity();
    if (current.deviceSet !== provider.deviceSet)
      throw new Error("Simulator device set changed");
    try {
      const { stdout } = await this.run(
        "rtk",
        ["proxy", "xcrun", "simctl", "--set", provider.deviceSet, ...args],
        {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      return stdout.trim();
    } catch {
      throw new Error("Simulator operation failed; device state is unverified");
    }
  }

  async devices(provider) {
    const output = await this.command(["list", "--json"], provider);
    try {
      const result = JSON.parse(output);
      if (
        !result.devices ||
        typeof result.devices !== "object" ||
        Array.isArray(result.devices) ||
        !Object.values(result.devices).every(Array.isArray) ||
        !Object.values(result.devices)
          .flat()
          .every((device) => uuid.safeParse(device.udid).success) ||
        !Array.isArray(result.runtimes) ||
        !Array.isArray(result.devicetypes)
      )
        throw new Error();
      return result;
    } catch {
      throw new Error("Incomplete or malformed Simulator inventory");
    }
  }

  async create({ deviceType, runtime }, provider, ownership, naming) {
    const owner = CreationOwnerSchema.safeParse(ownership);
    if (!owner.success)
      throw new Error("Unverified Simulator creation ownership evidence");
    const before = await this.devices(provider);
    const model = before.devicetypes.find(
      (type) => type.identifier === deviceType,
    );
    const system = before.runtimes.find(
      (item) => item.identifier === runtime && item.isAvailable,
    );
    if (
      !model ||
      !system ||
      !runtime.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")
    ) {
      throw new Error(
        "Requested iOS model/runtime is not installed and available",
      );
    }
    const name = deviceName(
      naming,
      model.name,
      Object.values(before.devices)
        .flat()
        .map((device) => device.name),
    );
    const priorIds = new Set(
      Object.values(before.devices)
        .flat()
        .map((device) => device.udid.toLowerCase()),
    );
    const udid = await this.command(
      ["create", name, deviceType, runtime],
      provider,
    );
    if (!uuid.safeParse(udid).success)
      throw new Error(
        "Simulator creation returned no valid device identifier; allocation remains pending",
      );
    if (priorIds.has(udid.toLowerCase()))
      throw new Error("Simulator creation returned a pre-existing identifier");
    const locator = { udid, deviceType, runtime, name };
    const actual = await this.inspect({ locator, provider });
    if (!actual)
      throw new Error(
        "Created Simulator is absent from the provider inventory; allocation remains pending",
      );
    if (actual.name !== name)
      throw new Error(
        "Created Simulator display name differs from the requested name",
      );
    const { workspace, ...identity } = owner.data;
    const proof = ownershipProof(identity, workspace, udid);
    await this.writeProof(provider, actual.udid, proof);
    await this.verify(
      { locator, provider, ownership: identity },
      { workspace },
    );
    return locator;
  }

  async proofPath(provider, udid) {
    if (!uuid.safeParse(udid).success)
      throw new Error("Unverified Simulator ownership identifier");
    const current = await this.identity();
    if (current.deviceSet !== provider.deviceSet)
      throw new Error("Simulator device set changed");
    let directory = provider.deviceSet;
    try {
      for (const segment of [udid, "data"]) {
        directory = path.join(directory, segment);
        const metadata = await lstat(directory);
        if (
          !metadata.isDirectory() ||
          metadata.isSymbolicLink() ||
          (await realpath(directory)) !== directory
        )
          throw new Error();
      }
    } catch {
      throw new Error("Unsafe or missing Simulator ownership directory");
    }
    return path.join(directory, OWNER_FILE);
  }

  async writeProof(provider, udid, proof) {
    const target = await this.proofPath(provider, udid);
    let file;
    try {
      file = await open(
        target,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await file.writeFile(`${JSON.stringify(proof)}\n`, "utf8");
      await file.sync();
    } catch {
      throw new Error(
        "Cannot establish Simulator ownership; allocation remains pending",
      );
    } finally {
      await file?.close();
    }
  }

  async verifyProof(entry, workspace, actualUDID) {
    const expected = ownershipProof(
      entry.ownership,
      workspace,
      entry.locator.udid,
    );
    const target = await this.proofPath(entry.provider, actualUDID);
    let file;
    try {
      const named = await lstat(target);
      if (!named.isFile() || named.isSymbolicLink()) throw new Error();
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await file.stat();
      if (
        !metadata.isFile() ||
        metadata.dev !== named.dev ||
        metadata.ino !== named.ino ||
        metadata.nlink !== 1 ||
        metadata.size > MAX_PROOF_BYTES
      )
        throw new Error();
      const buffer = Buffer.alloc(MAX_PROOF_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          bytes,
          buffer.length - bytes,
          bytes,
        );
        if (!bytesRead) break;
        bytes += bytesRead;
      }
      if (bytes > MAX_PROOF_BYTES) throw new Error();
      const actual = ProofSchema.parse(
        JSON.parse(buffer.subarray(0, bytes).toString("utf8")),
      );
      if (Object.keys(expected).some((key) => actual[key] !== expected[key]))
        throw new Error();
    } catch {
      throw new Error("Missing or mismatched Simulator ownership proof");
    } finally {
      await file?.close();
    }
  }

  async inspect(entry) {
    if (!uuid.safeParse(entry.locator.udid).success)
      throw new Error("Unverified Simulator identifier");
    const inventory = await this.devices(entry.provider);
    const matches = Object.entries(inventory.devices).flatMap(
      ([runtime, devices]) =>
        devices
          .filter(
            (device) =>
              device.udid.toLowerCase() === entry.locator.udid.toLowerCase(),
          )
          .map((device) => ({ ...device, runtime })),
    );
    if (!matches.length) return null;
    if (matches.length !== 1) throw new Error("Ambiguous Simulator identifier");
    const actual = matches[0];
    if (
      !actual.isAvailable ||
      !inventory.runtimes.some(
        (runtime) =>
          runtime.identifier === entry.locator.runtime && runtime.isAvailable,
      )
    ) {
      throw new Error(
        "Recorded Simulator or its runtime is unavailable; absence cannot be verified",
      );
    }
    if (
      actual.deviceTypeIdentifier !== entry.locator.deviceType ||
      actual.runtime !== entry.locator.runtime
    ) {
      throw new Error("Recorded Simulator identity changed");
    }
    return actual;
  }

  async verify(entry, { workspace } = {}) {
    const actual = await this.inspect(entry);
    if (!actual) return { state: "absent" };
    await this.verifyProof(entry, workspace, actual.udid);
    let processes;
    try {
      processes = (
        await this.run("rtk", ["proxy", "ps", "-axo", "pid=,command="], {
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout;
    } catch {
      throw new Error("Cannot establish Simulator availability");
    }
    const activeTest = processes
      .split("\n")
      .some(
        (line) =>
          line.toLowerCase().includes(entry.locator.udid.toLowerCase()) &&
          /(?:maestro|xcodebuild|xctest|detox|appium)/i.test(line),
      );
    if (activeTest) {
      const error = new Error(
        "Recorded Simulator is used by an active test process",
      );
      error.code = "DEVICE_BUSY";
      throw error;
    }
    return {
      state: "present",
      booted: actual.state === "Booted",
      dataBytes: actual.dataPathSize ?? null,
    };
  }

  async remove(entry, options) {
    const current = await this.verify(entry, options);
    if (current.state === "absent") return;
    if (current.booted)
      await this.command(["shutdown", entry.locator.udid], entry.provider);
    await this.command(["delete", entry.locator.udid], entry.provider);
    if ((await this.verify(entry, options)).state !== "absent")
      throw new Error("Simulator deletion postcondition failed");
  }
}

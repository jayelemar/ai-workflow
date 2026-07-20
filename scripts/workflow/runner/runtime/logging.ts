import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Failure } from "../types.ts";
export const appendLog = async (
  rootDir: string,
  planName: string,
  fields: Array<[string, string | number | undefined]>,
): Promise<{ ok: true } | Failure> => {
  const logDir = path.join(rootDir, ".ai", "artifacts", planName, "logs");
  const logPath = path.join(logDir, "runner.log");
  try {
    await mkdir(logDir, { recursive: true });
    const body = [
      "---",
      ...fields.map(([key, value]) => `${key}: ${value ?? ""}`),
      "",
    ].join("\n");
    await writeFile(logPath, body, { flag: "a" });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `workflow log cannot be created or appended: ${String(error)}`,
    };
  }
};

import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSessionTokenSnapshot, type SessionTokenSnapshot } from "./session-snapshot.ts";

export const defaultCodexHome = (): string => {
  const envCodexHome = process.env.CODEX_HOME?.trim();
  return envCodexHome ? path.resolve(envCodexHome) : path.join(os.homedir(), ".codex");
};

const relativeSessionPath = (codexHome: string, absolutePath: string): string => {
  const relativePath = path.relative(codexHome, absolutePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : absolutePath;
};

const collectSessionFiles = async (directory: string): Promise<string[]> => {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSessionFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
  }
  return files;
};

const findSessionFileById = async (sessionsDir: string, sessionId: string): Promise<string | null> =>
  (await collectSessionFiles(sessionsDir)).find((filePath) => filePath.includes(sessionId)) ?? null;

export const detectLatestSessionSnapshot = async ({ codexHome, cwd, sessionId }: { codexHome: string; cwd: string; sessionId?: string }): Promise<SessionTokenSnapshot | null> => {
  const sessionsDir = path.join(codexHome, "sessions");
  let candidateFiles: string[];
  if (sessionId) {
    const sessionFile = await findSessionFileById(sessionsDir, sessionId);
    candidateFiles = sessionFile ? [sessionFile] : [];
  } else {
    candidateFiles = await collectSessionFiles(sessionsDir);
    candidateFiles.sort((left, right) => right.localeCompare(left));
  }
  for (const filePath of candidateFiles) {
    let content: string;
    try { content = await readFile(filePath, "utf8"); } catch { continue; }
    const snapshot = parseSessionTokenSnapshot(content, relativeSessionPath(codexHome, filePath), cwd);
    if (snapshot && (!sessionId || snapshot.sessionId === sessionId)) return snapshot;
  }
  return null;
};

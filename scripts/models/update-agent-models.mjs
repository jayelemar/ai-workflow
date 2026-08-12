#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SOURCE =
  "https://developers.openai.com/api/docs/guides/latest-model.md";
const DEFAULT_REGISTRY = ".ai/config/agent-models.toml";
const DEFAULT_CODEX_CONFIG = ".codex/config.toml";
const ALLOWED_REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const requireValue = (args, index, flag) => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseArgs = (args) => {
  const options = {
    apply: false,
    evalApproved: false,
    help: false,
    source: DEFAULT_SOURCE,
    registry: DEFAULT_REGISTRY,
    codexConfig: DEFAULT_CODEX_CONFIG,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--eval-approved") {
      options.evalApproved = true;
    } else if (argument === "--source") {
      options.source = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--registry") {
      options.registry = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--codex-config") {
      options.codexConfig = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
};

export const validateOptions = (options) => {
  if (options.apply && !options.evalApproved) {
    throw new Error(
      "--apply requires --eval-approved after representative role evals",
    );
  }
  if (options.evalApproved && !options.apply) {
    throw new Error("--eval-approved is valid only with --apply");
  }
  if (/^https?:\/\//.test(options.source)) {
    const sourceUrl = new URL(options.source);
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.hostname !== "developers.openai.com"
    ) {
      throw new Error("remote source must use https://developers.openai.com");
    }
  }
};

const readSource = async (source) => {
  if (source.startsWith("file://")) {
    return readFile(new URL(source), "utf8");
  }
  if (!/^https?:\/\//.test(source)) {
    return readFile(path.resolve(source), "utf8");
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(source, {
        headers: { accept: "text/markdown,text/plain,*/*" },
      });
      if (response.ok) return response.text();
      lastError = new Error(`failed to fetch ${source}: ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
};

const parseLatestModelInfo = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^latestModelInfo:\s*$/.test(line));
  if (start < 0) throw new Error("latestModelInfo block not found");

  const info = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const match = lines[index].match(
      /^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/,
    );
    if (!match) break;
    info[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return info;
};

const modelMentioned = (markdown, model) => {
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^A-Za-z0-9_.-])${escaped}($|[^A-Za-z0-9_.-])`,
    "m",
  ).test(markdown);
};

const validateModelId = (model, label) => {
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(model)) {
    throw new Error(`invalid ${label} model ID: ${model}`);
  }
};

export const resolveLatestTiers = (markdown) => {
  const info = parseLatestModelInfo(markdown);
  const frontier = info.model?.trim();
  if (!frontier) throw new Error("latestModelInfo.model is required");

  const balanced =
    info.balancedModel?.trim() ||
    (frontier.endsWith("-sol")
      ? frontier.replace(/-sol$/, "-terra")
      : undefined);
  if (!balanced) {
    throw new Error("balanced model cannot be derived from official guidance");
  }
  validateModelId(frontier, "frontier");
  validateModelId(balanced, "balanced");
  if (!modelMentioned(markdown, balanced)) {
    throw new Error(
      `balanced model ${balanced} is not confirmed by official guidance`,
    );
  }
  return { frontier, balanced };
};

const findSectionRange = (lines, section) => {
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) throw new Error(`missing registry section ${header}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
};

const getSectionString = (toml, section, key) => {
  const lines = toml.replaceAll("\r\n", "\n").split("\n");
  const { start, end } = findSectionRange(lines, section);
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(
      new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`),
    );
    if (match) return match[1];
  }
  throw new Error(`missing ${key} in [${section}]`);
};

const getSectionInteger = (toml, section, key) => {
  const lines = toml.replaceAll("\r\n", "\n").split("\n");
  const { start, end } = findSectionRange(lines, section);
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(
      new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*$`),
    );
    if (match) return Number(match[1]);
  }
  throw new Error(`missing ${key} in [${section}]`);
};

const setSectionString = (toml, section, key, value) => {
  const lines = toml.replaceAll("\r\n", "\n").split("\n");
  const { start, end } = findSectionRange(lines, section);
  let found = false;
  for (let index = start + 1; index < end; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = `${key} = "${value}"`;
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`missing ${key} in [${section}]`);
  return lines.join("\n");
};

export const updateRegistryModels = (registry, models) => {
  validateModelId(models.frontier, "frontier");
  validateModelId(models.balanced, "balanced");
  return setSectionString(
    setSectionString(registry, "tiers.frontier", "model", models.frontier),
    "tiers.balanced",
    "model",
    models.balanced,
  );
};

const readRuntimeRegistry = (registry) => {
  const tiers = {
    frontier: getSectionString(registry, "tiers.frontier", "model"),
    balanced: getSectionString(registry, "tiers.balanced", "model"),
  };
  const roles = {};
  for (const role of ["parent", "investigator", "builder", "reviewer"]) {
    const section = `roles.${role}`;
    const tier = getSectionString(registry, section, "tier");
    const reasoningEffort = getSectionString(
      registry,
      section,
      "reasoning_effort",
    );
    if (!(tier in tiers)) throw new Error(`unknown tier ${tier} for ${role}`);
    if (!ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) {
      throw new Error(
        `unsupported reasoning effort ${reasoningEffort} for ${role}`,
      );
    }
    roles[role] = { tier, model: tiers[tier], reasoningEffort };
  }
  const forkTurns = getSectionInteger(registry, "spawn", "fork_turns");
  if (forkTurns < 1) throw new Error("spawn.fork_turns must be positive");
  return { tiers, roles, forkTurns };
};

const upsertTopLevelString = (toml, key, value) => {
  const lines = toml.replaceAll("\r\n", "\n").split("\n");
  const firstSection = lines.findIndex((line) =>
    /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  const end = firstSection < 0 ? lines.length : firstSection;
  for (let index = 0; index < end; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = `${key} = "${value}"`;
      return lines.join("\n");
    }
  }
  lines.unshift(`${key} = "${value}"`);
  return lines.join("\n");
};

export const updateCodexConfig = (config, { model, reasoningEffort }) => {
  validateModelId(model, "parent");
  if (!ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Error(`unsupported parent reasoning effort: ${reasoningEffort}`);
  }
  return upsertTopLevelString(
    upsertTopLevelString(config, "model_reasoning_effort", reasoningEffort),
    "model",
    model,
  );
};

const writeAtomically = async (filePath, contents) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const printHelp = () => {
  process.stdout
    .write(`Usage: rtk node .ai/scripts/models/update-agent-models.mjs [options]

Default behavior is read-only and reports model drift.

Options:
  --apply                 Update registry and project Codex config
  --eval-approved         Confirm representative role evals passed
  --source <url|file>     Override official model-guidance source
  --registry <path>       Override model registry path
  --codex-config <path>   Override project Codex config path
  -h, --help              Show this help
`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validateOptions(options);

  const registryPath = path.resolve(options.registry);
  const codexConfigPath = path.resolve(options.codexConfig);
  const [markdown, registry, codexConfig] = await Promise.all([
    readSource(options.source),
    readFile(registryPath, "utf8"),
    readFile(codexConfigPath, "utf8"),
  ]);
  const candidate = resolveLatestTiers(markdown);
  const currentRuntime = readRuntimeRegistry(registry);
  const updateAvailable =
    candidate.frontier !== currentRuntime.tiers.frontier ||
    candidate.balanced !== currentRuntime.tiers.balanced;

  const result = {
    status: updateAvailable ? "update-available" : "current",
    source: options.source,
    current: currentRuntime.tiers,
    candidate,
    evalGuide: ".ai/config/agent-model-evals.md",
  };

  if (options.apply) {
    const updatedRegistry = updateRegistryModels(registry, candidate);
    const updatedRuntime = readRuntimeRegistry(updatedRegistry);
    const parent = updatedRuntime.roles.parent;
    const updatedCodexConfig = updateCodexConfig(codexConfig, {
      model: parent.model,
      reasoningEffort: parent.reasoningEffort,
    });
    if (updatedCodexConfig !== codexConfig) {
      await writeAtomically(codexConfigPath, updatedCodexConfig);
    }
    if (updatedRegistry !== registry) {
      await writeAtomically(registryPath, updatedRegistry);
    }
    result.status = updateAvailable ? "updated" : "current";
    result.parentConfig = {
      model: parent.model,
      reasoningEffort: parent.reasoningEffort,
      restartRequired: true,
    };
  } else if (updateAvailable) {
    result.nextAction =
      "Run role evals, then rerun with --apply --eval-approved; do not switch silently.";
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./lifecycle-ledger.ts";
import type { LifecycleState } from "./lifecycle.ts";

export type WorkflowDocumentBinding = {
  version: 7;
  workflowId: string;
  workflowName: string;
  runRevision: number;
  specPath: string;
  planPath: string;
  specHash: string;
  planHash: string;
  createdAt: string;
  bindingHash: string;
};

export const workflowBindingPath = (revisionDir: string): string => path.join(revisionDir, "workflow-binding.json");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const bindingHash = (value: Omit<WorkflowDocumentBinding, "bindingHash">): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const validateBinding = (binding: WorkflowDocumentBinding): WorkflowDocumentBinding => {
  const { bindingHash: storedHash, ...payload } = binding;
  if (binding.version !== 7 || !binding.workflowId || !binding.workflowName || !Number.isSafeInteger(binding.runRevision) || binding.runRevision < 1
    || !path.isAbsolute(binding.specPath) || !path.isAbsolute(binding.planPath) || !/^[a-f0-9]{64}$/i.test(binding.specHash)
    || !/^[a-f0-9]{64}$/i.test(binding.planHash) || !binding.createdAt || bindingHash(payload) !== storedHash) {
    throw new Error("invalid V7 workflow document binding");
  }
  return binding;
};

export const writeWorkflowDocumentBinding = async ({
  revisionDir,
  state,
  specPath,
  planPath,
  createdAt = new Date().toISOString(),
}: {
  revisionDir: string;
  state: LifecycleState;
  specPath: string;
  planPath: string;
  createdAt?: string;
}): Promise<WorkflowDocumentBinding> => {
  if (!path.isAbsolute(specPath) || !path.isAbsolute(planPath)) throw new Error("V7 workflow document binding requires absolute spec and plan paths");
  const [spec, plan] = await Promise.all([readFile(specPath, "utf8"), readFile(planPath, "utf8")]);
  const payload = {
    version: 7 as const,
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    runRevision: state.runRevision,
    specPath: path.resolve(specPath),
    planPath: path.resolve(planPath),
    specHash: sha256(spec),
    planHash: sha256(plan),
    createdAt,
  };
  const binding: WorkflowDocumentBinding = { ...payload, bindingHash: bindingHash(payload) };
  const target = workflowBindingPath(revisionDir);
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(`${canonicalJson(binding)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  const directory = await open(path.dirname(target), "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return binding;
};

export const readWorkflowDocumentBinding = async (revisionDir: string): Promise<WorkflowDocumentBinding> =>
  validateBinding(JSON.parse(await readFile(workflowBindingPath(revisionDir), "utf8")) as WorkflowDocumentBinding);

export const verifyWorkflowDocumentBinding = async ({
  revisionDir,
  state,
  specPath,
  planPath,
}: {
  revisionDir: string;
  state: LifecycleState;
  specPath?: string;
  planPath?: string;
}): Promise<WorkflowDocumentBinding> => {
  const binding = await readWorkflowDocumentBinding(revisionDir);
  if (binding.workflowId !== state.workflowId || binding.workflowName !== state.workflowName || binding.runRevision !== state.runRevision
    || (specPath && path.resolve(specPath) !== binding.specPath) || (planPath && path.resolve(planPath) !== binding.planPath)) {
    throw new Error("V7 workflow document binding identity mismatch");
  }
  const [spec, plan] = await Promise.all([readFile(binding.specPath, "utf8"), readFile(binding.planPath, "utf8")]);
  if (sha256(spec) !== binding.specHash || sha256(plan) !== binding.planHash) throw new Error("V7 workflow document binding content mismatch");
  return binding;
};

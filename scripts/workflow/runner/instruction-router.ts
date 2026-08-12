const instruction = (...segments: string[]) =>
  [".ai", "instructions", ...segments].join("/");

const orderedInstructionPaths = [
  instruction("shared", "ai-workflow.md"),
  instruction("shared", "workflow-state.md"),
  instruction("shared", "security.md"),
  instruction("shared", "security-observability.md"),
  instruction("shared", "testing.md"),
  instruction("shared", "maintainability.md"),
  instruction("shared", "migrations.md"),
  instruction("shared", "performance-observability.md"),
  instruction("shared", "documentation-runbooks.md"),
  instruction("shared", "delivery-hygiene.md"),
  instruction("shared", "wcag.md"),
  instruction("architecture.md"),
  instruction("ui.md"),
] as const;

const isTestPath = (filePath: string) =>
  /(^|\/)(test|tests|e2e)\//i.test(filePath) ||
  /\.(test|spec)\.[cm]?[tj]sx?$/i.test(filePath) ||
  /(^|\/)(jest|vitest|playwright)\.config\./i.test(filePath) ||
  /(^|\/)package\.json$/i.test(filePath);

const isAuthPath = (filePath: string) =>
  /(^|\/)(auth|session|sessions|role|roles|guard|guards)(\/|\.|-)/i.test(
    filePath,
  );

const isUiPath = (filePath: string) =>
  (filePath.startsWith("src/app/") &&
    !filePath.startsWith("src/app/api/")) ||
  filePath.startsWith("src/components/") ||
  /^src\/features\/[^/]+\/components\//.test(filePath) ||
  filePath === "components.json";

const isMigrationPath = (filePath: string) =>
  /(^|\/)(migration|migrations|schema)(\/|\.|-)/i.test(filePath);

const isProductionSourcePath = (filePath: string) =>
  filePath.startsWith("src/") && !isTestPath(filePath);

/**
 * Mirrors .ai/instructions/index.md for the current single-app repository.
 * Callers pass concrete plan-owned paths, so obsolete project heuristics
 * cannot silently enter an Active Context Packet.
 */
export const selectInstructionPaths = ({
  planOwnedPaths,
  planContent = "",
}: {
  planOwnedPaths: string[];
  planContent?: string;
}): string[] => {
  const selected = new Set<string>();

  for (const filePath of planOwnedPaths) {
    if (filePath.startsWith(".ai/")) {
      selected.add(instruction("shared", "ai-workflow.md"));
      selected.add(instruction("shared", "workflow-state.md"));
    }
    if (isTestPath(filePath)) {
      selected.add(instruction("shared", "testing.md"));
    }
    if (isProductionSourcePath(filePath)) {
      selected.add(instruction("shared", "security.md"));
      selected.add(instruction("shared", "maintainability.md"));
      selected.add(instruction("architecture.md"));
    }
    if (filePath.startsWith("src/app/api/")) {
      selected.add(instruction("shared", "security.md"));
      selected.add(
        instruction("shared", "performance-observability.md"),
      );
    }
    if (isUiPath(filePath)) {
      selected.add(instruction("shared", "wcag.md"));
      selected.add(instruction("ui.md"));
    }
    if (isAuthPath(filePath)) {
      selected.add(instruction("shared", "security-observability.md"));
    }
    if (isMigrationPath(filePath)) {
      selected.add(instruction("shared", "security.md"));
      selected.add(instruction("shared", "migrations.md"));
      selected.add(
        instruction("shared", "performance-observability.md"),
      );
      selected.add(instruction("shared", "documentation-runbooks.md"));
      selected.add(instruction("architecture.md"));
    }
    if (filePath.startsWith("e2e/")) {
      selected.add(instruction("shared", "testing.md"));
      selected.add(instruction("architecture.md"));
    }
  }

  if (/\bshadcn\b/i.test(planContent)) {
    selected.add(instruction("shared", "wcag.md"));
    selected.add(instruction("ui.md"));
  }

  // Repository paths without a narrower area still need architecture context.
  if (planOwnedPaths.some((filePath) => !filePath.startsWith(".ai/"))) {
    selected.add(instruction("architecture.md"));
  }

  return orderedInstructionPaths.filter((instructionPath) =>
    selected.has(instructionPath),
  );
};

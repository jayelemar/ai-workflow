# Create or Update Instructions

Create or update reusable instruction guidance without changing application
behavior.

## Input

The user may provide any subset of:

```text
Mode: <bootstrap | targeted>
Target area: <local | shared | mobile | desktop | web | server instruction>
Observed repeated rule: <repository evidence>
Requested outcome: <create | update | route | retire>
```

Treat these fields as optional hints, not required intake questions. Infer the
mode, target, evidence, and outcome from the request and repository whenever
possible.

Use `bootstrap` mode when the user requests initial project setup or when the
local instruction index or architecture instruction is missing. Otherwise use
`targeted` mode.

## Question Policy

- Do not ask the user to choose instruction areas, filenames, routes,
  frameworks, commands, or repeated rules that repository inspection can
  establish.
- In bootstrap mode, proceed with repository-derived defaults for clear
  evidence. Ask about ambiguity only when different answers would materially
  change the proposed file set, ownership, routing, or instruction behavior.
- Treat the single consolidated creation approval below as required, not as an
  invitation to ask additional discovery or per-file questions.
- Ask only when required repository evidence is unreadable, instructions
  materially conflict with the requested outcome, or a destructive retirement
  or shared-policy decision cannot be resolved safely from existing authority,
  or a material ambiguity remains after repository inspection.
- Resolve material ambiguities before presenting the creation preview. Group
  related ambiguities into the smallest practical set of concise questions.
- With every ambiguity question, state the recommended answer first and give a
  brief repository-based reason or tradeoff.
- Do not ask about non-material uncertainty. Use established repository
  conventions when safe; otherwise skip the optional guidance and include it
  under Recommendations.
- If no material ambiguity remains, do not ask discovery questions.

## Creation Preview and Approval

Before creating any new instruction file:

- Complete repository inspection and decide the smallest justified file set.
- Show one concise consolidated preview containing every proposed path and a
  summary of its purpose, key rules, routing, and validation guidance. Do not
  include the full file contents unless the user requests them.
- Add a `Recommendations` subsection for useful optional or deferred
  instructions, each with its repository evidence and expected benefit. Keep
  recommendations separate from the files submitted for approval.
- Ask one concise approval question for the complete preview. Do not ask for
  separate approval per file.
- Do not create any previewed file until the user explicitly approves it.
- After approval, create files consistent with the approved summaries without
  further setup questions.
- If repository evidence requires a material change to the proposed file set or
  summarized guidance, show a revised consolidated preview and request approval
  again. Minor wording details do not require another approval.

This approval applies only to creating instruction files. It does not add a
preview or pre-execution gate to the application-development workflow. Updates
that create no instruction files may proceed without this approval unless the
user requests a preview.

## Bootstrap Mode

Bootstrap mode creates a useful local instruction set in one run:

- Inspect repository roots, manifests, configuration, source ownership,
  scripts, and tests without requiring the user to summarize the project.
- When files are missing, present their summaries together for the single
  required creation approval, then create all approved files in one run.
- Create `.ai/instructions/index.md` and
  `.ai/instructions/local/architecture.md` when missing.
- Create additional project-local area instructions only when current
  repository structure and repeated implementation evidence support a narrow,
  reusable area.
- Put discovered project paths, framework choices, ownership boundaries, and
  exact validation commands in the applicable local instructions.
- Route every created or maintained local instruction from
  `.ai/instructions/index.md` in the same change.
- Preserve valid existing instructions and fill only material gaps when setup
  is partially complete.
- Do not create speculative placeholder area files. A minimal bootstrap with
  only the index and architecture instruction is valid.
- Do not update reusable baselines during local bootstrap unless the user
  explicitly requests a reusable-policy change.

## Required Inspection

- Read `.ai/AGENTS.md` and ignored `.ai/instructions/index.md` when it exists.
- Inventory relevant `.ai/instructions/**/*.md` using ignored-file-aware search.
- Before proposing or editing instructions, search all instruction roots,
  including ignored `index.md` and `local/` files, for existing rules, commands,
  and validation requirements that cover the intended guidance. Check equivalent
  meaning as well as matching wording; read candidate overlaps and choose the
  canonical owner before adding another copy.
- Read the target instruction when it exists and overlapping shared and
  application-type baselines.
- Inspect enough current repository evidence to distinguish a reusable rule
  from a one-off implementation detail.

## Ownership

- Keep portable cross-platform principles under `.ai/instructions/shared/`.
- Keep reusable application-type guidance under `.ai/instructions/mobile/`,
  `.ai/instructions/desktop/`, `.ai/instructions/web/`, or
  `.ai/instructions/server/`. Nest framework-specific guidance under its
  application type, such as `desktop/electron/`. Create no empty framework
  folders or speculative stack guidance.
- Keep project paths, commands, framework choices, and area ownership in
  ignored project-local instructions under `.ai/instructions/local/`, including
  architecture at `local/architecture.md`. Nested local areas are allowed.
- Keep ignored `.ai/instructions/index.md` limited to Markdown routing with
  `## Rules` and explicit `Load` bullets. Route every maintained local
  instruction and applicable shared and application-type baselines.
- Route by affected code and capabilities, combining application types for
  mixed work. Backend code serving a mobile app selects server guidance;
  Electron renderer HTML can also select web accessibility guidance. Load
  shared policies only when relevant; persisted-data changes on any platform
  select shared migration guidance. Do not load unrelated native-device or
  backend operational requirements.
- Keep canonical implementation workflow guidance in
  `.ai/.agents/skills/ai-build/`. Do not duplicate it in shared
  instructions or root-level prompt files.
- Git history is the instruction history. Do not create or update instruction
  changelogs.

## Editing Rules

- Preserve the `Purpose`, `Rules`, `Placement`, `Validation`, and
  `Anti-Patterns` shape when it fits the target instruction.
- Eliminate duplicate or conflicting rules by assigning one canonical owner
  and replacing other copies with a route or reference.
- Treat differently worded copies of the same requirement and repeated command
  lists as duplication. Preserve necessary platform-specific constraints and
  local facts; a reference or a narrower specialization is not itself a
  duplicate. Consolidation must preserve the rule's applicability and exclusions.
- Keep workspace-specific names, aliases, component libraries, framework
  choices, paths, and commands in local guidance. Framework requirements and
  reusable examples belong under their application type, with universal
  principles in shared guidance.
- Do not create an optional local area instruction without repeated repository
  evidence and a route in `instructions/index.md`. Bootstrap index and
  architecture content may also rely on direct structural, manifest, script,
  and configuration evidence.
- Retire dead routes and references in the same change. Never leave a route to
  a missing instruction.

## Validation

- Confirm every routed path exists and every maintained local instruction is
  reachable from `.ai/instructions/index.md`.
- Search active source for stale instruction paths, retired workflow concepts,
  project-specific shared rules, and instruction changelog references.
- Recheck the changed guidance against all instruction roots after editing for
  duplicate requirements, commands, competing owners, and contradictory scopes.
  Confirm affected tasks still load each canonical rule through the index or
  an explicit reference, and that excluded application types remain excluded.
- Run the focused contract and health checks.

## Final Response

Report instruction files changed, routes changed, repository evidence used,
validation results, and any optional or deferred recommendations.
Include the duplicate-check scope, canonical owners chosen, duplicates removed
or remaining, and the reason for any intentional specialization.

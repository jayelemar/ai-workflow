# Create or Update Instructions

Create or update reusable guidance without changing application behavior.

## Input and Decisions

The user may supply optional hints; infer missing values from the request and
repository rather than treating these as intake requirements:

```text
Mode: <bootstrap | targeted>
Target area: <local | shared | mobile | desktop | web | server instruction>
Observed repeated rule: <repository evidence>
Requested outcome: <create | update | route | retire>
```

Use bootstrap for requested initial setup or a missing local index/architecture;
otherwise use targeted mode. Inspect before asking about areas, filenames,
routes, frameworks, commands, or rules. Use repository-derived defaults when
clear. Ask only for unreadable required evidence, material instruction conflicts,
unresolved destructive retirement/shared-policy authority, or ambiguity that
changes the file set, ownership, routing, or behavior after inspection. Group
questions, putting the recommended answer and brief evidence/tradeoff first.
Resolve material ambiguity before preview; follow conventions for minor details
or defer optional guidance to Recommendations. Ask no discovery questions when
no material ambiguity remains.

## Inspect

- Read `.ai/AGENTS.md` and ignored `.ai/instructions/index.md` if present.
- Inventory relevant `.ai/instructions/**/*.md` with ignored-file-aware search.
  Search every instruction root, including ignored index/local files, for rules,
  commands, and validation covering the intended guidance before proposing or
  editing it. Read overlaps for equivalent meaning, not only matching text,
  and choose one canonical owner.
- Read existing targets and overlapping shared/application baselines. Inspect
  enough current structure, manifests, config, source ownership, scripts, and
  tests to separate reusable evidence from one-off details.

## Creation Approval

Before creating instruction files, finish inspection and present one concise
consolidated preview of the smallest justified set: every path, purpose, key
rules, routing, and validation. Include full contents only on request. Keep
optional/deferred instructions in a separate Recommendations subsection with
evidence and benefit. Ask one approval question for the complete preview; create
none until explicit approval. After approval, create the summarized files without
more setup questions. Material changes to the file set or guidance require a
revised consolidated preview and approval; minor wording changes do not.

This gate applies only to new instruction files, not application development or
updates creating no files, unless the user requests a preview. It does not
justify extra discovery or per-file approval questions.

## Bootstrap

- When missing, include `.ai/instructions/index.md` and
  `.ai/instructions/local/architecture.md` in the single creation preview.
  Create all approved files in one run; a bootstrap with only these two is valid.
- Add narrow local areas only with repeated implementation evidence; index and
  architecture may also use direct structural, manifest, script, and config
  evidence. No speculative placeholders or empty framework directories.
- Record discovered project paths, frameworks, ownership, and exact commands
  locally. Route every maintained/created local instruction in the same change.
- Preserve valid existing instructions and fill material gaps. Do not change
  reusable baselines during local bootstrap without an explicit policy request.

## Ownership and Editing

- Keep portable principles in `.ai/instructions/shared/`; application guidance
  in `mobile/`, `desktop/`, `web/`, or `server/`, with framework requirements and
  reusable examples nested under that type, such as `desktop/electron/`.
- Keep project names, aliases, libraries, frameworks, paths, commands, and area
  ownership in ignored `.ai/instructions/local/`, including
  `local/architecture.md`; nested local areas are allowed.
- Keep ignored `instructions/index.md` as Markdown routing with `## Rules` and
  explicit `Load` bullets. Route every maintained local instruction and
  applicable baseline by affected code/capabilities; combine types for mixed
  work. Mobile backends select server rules; Electron HTML can select web
  accessibility. Load shared rules only when relevant; persisted-data changes
  on any platform select migrations. Exclude unrelated native-device/backend
  operations requirements.
- Keep execution rules canonical in `.ai/AGENTS.md`, detailed review guidance in
  `.ai/instructions/shared/plan-review.md`, and plan creation in
  `.ai/.agents/skills/create-plan/`; link to these owners rather than copying them. Git history owns
  instruction history; never create/update instruction changelogs.
- Preserve `Purpose`, `Rules`, `Placement`, `Validation`, and `Anti-Patterns`
  sections when they fit. Consolidate equivalent rules and repeated command
  lists under one owner, replacing copies with references/routes. Preserve
  applicability, exclusions, platform constraints, and local facts; references
  and narrower specializations are not themselves duplication.
- Optional local areas require repeated evidence and an index route. Retire
  dead routes/references together; never route to missing instructions.

## Validate and Report

Confirm routed paths exist and every maintained local instruction is reachable.
Search active source for stale paths, retired workflow concepts, project-specific
shared rules, and changelog references. Recheck all roots for equivalent rules,
commands, competing owners, and contradictory scopes; affected tasks must still
load canonical rules through routes or explicit references, with exclusions
intact. Run focused contract and health checks.

Report files/routes changed, evidence, validation, optional/deferred advice,
duplicate-check scope, canonical owners, duplicates removed/remaining, and reasons
for intentional specialization.

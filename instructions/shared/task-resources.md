# Task Resource Instructions

## Purpose and scope

Track new disposable local resources for saved-plan execution in the main
checkout or native worktrees. Use the original workspace's
`.ai/scripts/resources/task-resources.mjs` helper; one canonical
`<source-workspace>/.ai/artifacts/<plan-name>/resources.json` covers all of a
plan's executions. This record grants no authority to adopt existing resources.
Version 1 supports local Docker and iOS Simulator. Android and other providers
are unsupported: report the limitation and stop that allocation explicitly.
Compose services delegated through `services.*.provider` are also unsupported,
even when a provider plugin is installed; reject them before any allocation.

## Rules

- Resolve and retain the canonical original workspace, source-relative plan
  `.ai/plans/<plan-name>.md`, exact execution root, and repository mapping before
  provisioning. Worktree handoffs must carry the original workspace and source
  plan explicitly. Never infer source context from the nearest copied `.ai/`.
- Immediately before the first resource allocation, invoke the original helper:

  ```bash
  rtk proxy node '<source-workspace>/.ai/scripts/resources/task-resources.mjs' init --workspace '<source-workspace>' --plan '.ai/plans/<plan-name>.md' --root '<execution-root>'
  ```

  Main-checkout execution uses its original workspace or an exact primary
  repository as the execution root; worktree execution uses its prepared task
  root. Init creates a separate
  execution UUID. Use `--resume '<execution-UUID>'` only for an explicitly resumed
  execution after ownership and availability checks. Do not initialize during
  planning, worktree-only setup, or tasks requiring no resources.

- Capture init's JSON and supply that exact JSON as `TASK_RESOURCES_CONTEXT` in
  every resource-creating child's environment, including test runners, smoke
  scripts, and commands launched from another checkout. Use structured process
  arguments and an environment object; never `eval`, source, or interpolate JSON
  as shell code. Keep this context throughout execution. Invalid supplied context
  fails closed; do not unset it to bypass a failure. Context identifies ownership;
  it does not instrument tools that create resources internally.
- Run the original helper even from task-local execution. Do not create, copy,
  hand-edit, or fall back to a worktree-local resource manifest. The narrow source
  write exception covers only the canonical resource artifact, its temporary
  source-workspace coordination lock, and the helper's source-plan marker
  `<!-- task-resources: UUID -->`. It permits no application or workflow source
  edits. Stop before allocation if those writes are unavailable.
- Provision through the original `.ai` helper. It requires its own installed
  dependencies and the chosen local provider CLI, independently of any application
  package, framework, test SDK, directory name, or environment-variable convention.
  For Docker containers, send configuration JSON through stdin to `docker-create`:

  ```json
  { "image": "postgres:18-alpine", "ports": [5432] }
  ```

  The command is `node '<source-workspace>/.ai/scripts/resources/task-resources.mjs' docker-create`
  with the context supplied in its environment. The result contains the container
  ID and actual loopback host ports. Configuration may also contain `command`,
  `environment`, `networkId`, and owned `volumeMounts`; see the helper API in
  `scripts/resources/fixtures.mjs`. Environment and command values pass directly
  to Docker and are never written to the artifact or printed in helper output.
  The Docker provider invokes the native CLI directly through structured process
  arguments, bypassing command-history proxies such as `rtk proxy`. Pass sensitive
  configuration to the helper through stdin; do not put it in tracked shell arguments.
  Tagless source images resolve to exact `:latest` references before local cache
  lookup or pulling; explicit tags, digests and immutable IDs retain their meaning.
  Mount targets containing commas are unsupported: Docker parses `--mount` as
  CSV, so the helper rejects those targets before allocating volumes or containers.
  Use `docker-network` for a new private execution network. The JavaScript exports
  provide the same operations and verified normal teardown for `.ai`-owned scripts.

- For tracked local development Compose, choose the execution's configuration:

  ```bash
  rtk proxy node '<source-workspace>/.ai/scripts/resources/task-resources.mjs' compose-up --directory '<execution-project-directory>' --file '<configuration.yaml>'
  ```

  Repeat `--file` for ordered configuration fragments. Without `--file`, the helper
  accepts exactly one default Compose filename in that directory; ambiguous
  defaults require an explicit choice. Files must stay inside the execution root
  through real directories and regular files. Both the CLI and direct JavaScript
  API enforce these checks using the recorded execution root. Each execution receives its own
  containers, volumes, network, image tags, and loopback ports. Caller-provided
  application configuration remains unchanged: supply connection settings through
  the application's existing supported configuration. The checked resolved
  configuration stays in memory and passes through stdin for build/start; later
  source-file changes cannot introduce unrecorded allocations. Inherited mounts
  and service multiplicity other than one are unsupported. Unsupported Compose resource
  shapes fail before container provisioning. Image-declared data paths require
  explicit mounts; otherwise Compose would silently allocate unrecorded storage.
  Built images are recorded and checked before containers start. A failed
  preflight retains any build evidence for normal recovery. Do not borrow
  another task's resources, adopt
  an existing ID, or treat a display name as ownership evidence.

- Tools that create their own resources are tracked only when they use this
  helper or support ownership metadata before creation and external resource
  configuration. Merely passing context to an unmodified test runner cannot
  automatically record its internal containers. Report an unsupported creation
  path instead of adopting leftovers or editing application source to install
  this workflow. Existing unrecorded resources require separate explicit cleanup.

- Before creating or using devices, follow
  [Mobile Virtual Devices](../mobile/virtual-devices.md). Inventory first; reuse
  only a verified available device recorded to the same task and execution,
  otherwise create the minimum dedicated instances. Keep stable-ID targeting,
  established model/OS names, and unrelated devices unchanged.
  Newly created iOS devices receive a small ownership proof inside their own data
  directory. Cleanup requires that proof to match the central record; an existing
  device cannot become task-owned merely by listing its UDID in JSON. Never plant
  ownership metadata on an existing personal or other-task device.
- After every agent and test using an execution has stopped, pass its context to
  the original helper's `release` command. Release marks the execution inactive;
  it neither deletes resources nor discards evidence. Do not release an execution
  while another process still needs it.

## Recovery

- On interrupted allocation, retain the record and run context-bearing
  `reconcile` through the original helper before retrying or cleaning, while the
  execution is active; explicitly resume a released execution first. Resolve
  pending allocations before release. Docker reconciliation uses reserved
  ownership labels. An unresolved simulator creation
  without its returned UDID cannot be identified by name: retain the pending
  entry and stop for corroborated identification.
- Image builds reserve their expected tags before creation. Reconciliation keeps
  that original evidence; additional tags indicate sharing and preserve the
  image. An interrupted image without its original tag evidence requires
  corroborated recovery rather than adopting every current tag.
  Task-built image preparation requires an explicit `name:tag`, for example
  `task-image:latest`; a registry port alone does not supply a tag. The exact alias
  must be reserved and retained through capture and disposal.
  Each prepared Compose allocation attempts its image build only once. After a
  failed or interrupted build, retain its evidence, dispose its verified resources,
  and prepare a fresh allocation before retrying. Never rebuild with labels or
  tags that already identify captured images.
  Repeating startup revalidates all captured native identities and ownership before
  issuing another `up`. Missing, removed or incomplete allocations require fresh
  preparation; never recreate them under already captured reservation labels.
  The first build/start also rechecks execution activity, provider identity and
  reservation state. Reconciliation can retire unused reservations after preparation;
  those entries cannot provision afterward. Only unused pending reservations may
  create new objects; preserve and recover any native matches before retrying.
- Docker may leave a newly created container's endpoint network IDs empty until
  startup. A stopped, natively owned container can still be recovered when its
  configured network mode exactly matches its recorded network ID and no foreign
  initialized endpoint exists. Recovery does not start it. Running or uncorroborated
  containers must satisfy the existing live-network checks.
- The helper waits briefly for ordinary concurrent writes. A lock still busy
  after that bounded wait is a blocker. Inspect its holder and verify that process has
  stopped before a deliberate stale-lock recovery; never steal a lock by age.
  Preserve the last valid JSON on write failure. Do not hand-edit records to
  force cleanup or provision through a substitute manifest.
- A source-plan resource marker with a missing artifact is a blocker, as are
  malformed records, changed provider identities, unavailable providers,
  conflicting use, unsafe paths, and unresolved allocations. Tool absence is
  not proof of resource absence. Restore or resolve the original evidence, then
  rerun inspection. A legacy/no-resource plan without a marker or manifest keeps
  file-only cleanup; never discover or adopt resources by name as a fallback.
  Legacy cleanup refuses marked artifact paths that are links or other non-directory
  entries before removing any local records; retain all targets for recovery.
- Use [Clean Plan Worktrees and Records](../../prompts/worktree-cleanup.md) for
  selected-plan cleanup. It owns selection, exclusions, the single complete
  preview, exact confirmation, fresh inspection, and resource-before-worktree
  removal. The helper removes resources only; it never removes worktrees, plans,
  or its JSON artifact. Stop on partial failure and keep the plan, artifact, and
  remaining control context for an exact-ID retry. Preserve shared images and
  report why they remain; retain their ownership evidence.
- Never prune global Docker state, build cache, runtimes, or device sets. Never
  follow bind mounts or delete their host targets. Main-checkout execution roots,
  primary repositories, branches, personal devices, and unselected resources
  always survive selected-task cleanup.

## Validation

- Inspect the helper's `--help` for the current command interface. To preview
  all executions/resources of an exact selected set from the original workspace:

  ```bash
  rtk proxy node '<source-workspace>/.ai/scripts/resources/task-resources.mjs' inventory --workspace '<source-workspace>' --plan '.ai/plans/<plan-name>.md'
  ```

  Repeat `--plan` for each selected source plan after subtracting exclusions.
  Keep the exact returned preview for confirmed cleanup; changed evidence
  requires a fresh preview and confirmation.

- Verify init/resume writes only the canonical artifact, marker, and temporary
  lock; main and
  worktree executions have distinct UUIDs and isolated resources; child commands
  receive the context; cleanup refuses active executions; and cancellation
  mutates nothing. Mocked tests do not prove actual provider deletion.
- The [README verification map](../../README.md#task-resource-verification-map)
  names maintained commands, states, prerequisites, and known evidence gaps.

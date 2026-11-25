# Resource Naming Instructions

## Purpose and scope

Make new workflow-created local resources recognizable by project, task/plan,
and device model or service. Apply to ordinary tasks and saved-plan execution.
Automatic naming covers the existing Docker and iOS creation helpers only;
Android receives guidance, not a tracked creation provider.

## Rules

- Apply this convention only when creating a new resource. Reused and legacy
  resources retain their names, stable identifiers, data, ownership evidence,
  and cleanup behavior. Do not rename or recreate them to satisfy naming.
- Resolve the project label from the canonical source workspace's local
  instructions and pass it as `init --project-name <label>` (JavaScript
  `projectName`) when configured. Otherwise use the canonical source workspace
  basename. Never use a worktree/task-root basename as the source project.
  Keep project-specific labels in ignored local guidance, not reusable code.
- Take the task label from the source plan filename without `.md`. For an
  ordinary task without a saved plan, use a short descriptive label from the
  request. Naming alone does not require a plan or resource record.
- Use `<project> · <plan-stem> · <device model>` for new virtual-device display
  names, for example `ExampleApp · wardrobe-gallery · iPhone 16 Pro`. Derive
  the actual model from installed device metadata. Omit OS/runtime versions and
  testing roles from the label; record them in metadata and validation notes.
  If the model cannot be established, report the missing evidence before creation.
- For a duplicate device label, keep the first unsuffixed and use the lowest
  available ` (2)`, ` (3)`, and so on, checking inventory across runtimes.
  Different runtimes of the same model may therefore receive numbered labels.
  Never renumber existing devices when another instance disappears.
- Use the same model-only convention for Android. When tooling cannot accept
  the display form, use a provider-valid identifier such as
  `exampleapp-wardrobe-gallery-pixel-9`. Preserve actual runtime information in
  testing notes. This guidance does not authorize unsupported tracked allocation.
- Docker-generated names use lowercase hyphen-separated project, plan, and
  resource description followed by an allocation suffix, for example
  `exampleapp-wardrobe-gallery-postgres-a1b2c3d4e5f6`. The helper uses the last
  image repository component without registry, tag, or digest for a standalone
  container, `network` for a network, and `volume-<index>` for image-declared
  volumes in declaration order. Compose keeps service/volume keys and normal
  container suffixes under its generated project name. Generated build-image
  tags distinguish service keys that normalize alike. Source image references
  and explicit aliases passed to `prepareTrackedImage` retain their meaning;
  Compose build tags continue using isolated generated aliases.
- Normalize Docker segments to lowercase ASCII, replace runs outside `a-z0-9`
  with `-`, trim separators, and cap each project, plan, and resource segment at
  32 characters. Reject required segments that become empty before allocation.
  Standalone allocations use 12 hexadecimal characters from their reserved
  resource UUID; each Compose project uses a fresh allocation UUID prefix.
  Human labels preserve project casing, reject control characters, and shorten
  project/task portions to stay within the 256-character name bound.
- Names describe resources; they never prove ownership or authorize reuse,
  adoption, recovery, or cleanup. Preserve stable-ID targeting and all existing
  ownership labels/proofs, availability checks, execution isolation, confirmation,
  and sharing safeguards under [Task Resources](task-resources.md) and
  [Mobile Virtual Devices](../mobile/virtual-devices.md). A provider name
  conflict fails without adopting or renaming the existing object.

## Validation

- Inspect actual provider-visible names after new creation and compare them
  with the canonical project/task and installed model or service evidence.
  Verify runtime identifiers remain in metadata and reused resources keep their
  existing names and stable identifiers.
- Verify main-checkout and worktree allocations use the same source label/plan,
  with distinct allocation identity. Check legacy manifests and resumed execution
  through the [task-resource verification map](../../README.md#task-resource-verification-map).

Version: 1.2
Last Updated: 2026-11-25

# Mobile Virtual Device Instructions

## Purpose

Keep virtual devices easy to identify and reuse without interrupting other
work or accumulating unnecessary simulators and emulators.

## Applies To

- Selecting, creating, naming, or using iOS simulators, Android emulators, and
  other virtual devices used for mobile development and testing.
- Phone, tablet, and other supported device types, including tasks without UI
  changes. Physical device names remain under the user's control.
- The multiple-device approval rule also applies to physical mobile test devices.

## Rules

- When a task first needs simulator or emulator testing in the current
  conversation, ask "iOS Simulator, Android Emulator, or both?" unless the user
  has already selected the platforms. Reuse that choice across tasks and reruns
  until the user changes it; do not save it as a global preference. Documentation
  changes and changes requiring no native checks do not trigger this question.
- Wait for the answer before selecting, creating, booting, or testing on a
  device. Continue independent work while waiting. Do not infer a choice from
  available or running devices, or default to both platforms.
- Before adopting a test matrix with two or more devices, obtain explicit user
  approval of the specific device list. State each device's model, OS/runtime,
  logical viewport and testing purpose, including separate instances of the
  same model. Read-only inventory may establish these details before asking;
  wait for approval before creating, booting or testing the proposed matrix.
  Count devices across the task, not only those used simultaneously. A platform
  choice or generic request to run tests does not approve multiple devices.
- Reuse existing explicit approval for the same device list and testing scope.
  Ask again before expanding or substituting devices in an approved matrix of
  two or more. If the user limits testing to one device, preserve that limit
  and report the coverage gap rather than automatically adding another device.
- Run the selected checks using available tools before asking the user for
  manual help. If blocked, report the exact unverified behavior, limitation,
  and smallest follow-up check under
  [Validation and Completion](../../AGENTS.md#validation-and-completion).
- A platform choice defines coverage, not a waiver of an explicit
  platform-specific acceptance requirement. If the choice cannot establish
  that requirement, explain the gap and resolve the conflict with the user;
  do not silently expand coverage or claim the requirement passed.
- For saved-plan execution, read and follow
  [Task Resources](../shared/task-resources.md) before provisioning. Its v1
  provider supports iOS Simulator only. An Android or both-platform selection
  remains valid coverage intent, but tracked Android allocation is unsupported;
  report the gap and resolve it rather than treating Android as iOS or silently
  omitting the requested checks. Preserve the platform-choice rules above.
- Inventory existing devices before creating one. Match the task's required
  device type, OS/runtime, and logical viewport; keep device matrices and
  platform-specific commands in local instructions.
- In tracked execution, reuse only a suitable device already recorded to the
  same task and execution, with verified creation ownership and availability.
  Never adopt, rename, or borrow a personal or other-task device. Otherwise
  create the minimum dedicated instances through the context-bearing original
  helper's `ios-create --device-type <identifier> --runtime <identifier>` command,
  using installed metadata. Outside tracked execution, prefer a suitable
  available device. Check current session ownership, active test runs, and
  relevant processes using the platform's available tooling. A booted device is
  neither proof of use nor proof of availability; a shut-down device may still belong to a pending run.
  If availability cannot be established, treat the device as unavailable.
- Do not take over, rename, shut down, reset, or otherwise interrupt a device
  another session or process is using.
- When suitable owned devices are busy, continue independent work and recheck
  availability. Create an additional instance only when device testing is
  blocked and no suitable owned device is available. In tracked execution, an
  unowned device never satisfies availability. Create only the minimum needed
  to meet the task's requirements.
- Recheck the inventory immediately before creation to avoid duplicating a
  device that has become available or was just created. Apply the same reuse
  rules to additional instances in future tasks.
- Before creating a device, read and follow
  [Resource Naming](../shared/resource-naming.md). It owns project/task/model
  labels, model-only Android identifiers, and duplicate numbering across runtimes.
  Retain OS/runtime and testing roles in metadata and validation notes.
- Reused devices keep their existing display labels, including legacy or generic
  labels. Do not rename, recreate, erase, or delete them for naming consistency.
  Preserve stable identifiers, configuration, installed applications, and data.
- Target operations by stable device identifier rather than display name.
  Leave unrelated devices and physical device names unchanged; do not perform
  bulk renaming or cleanup as part of this workflow.

## Validation

- For tests using two or more devices, record the approved device list and
  confirm the actual devices used stay within that approval.
- Report the selected platforms and the platforms actually tested. Evidence
  from one platform does not establish behavior on the other.
- Before using a selected device, confirm its identifier, model, OS/runtime,
  required viewport, and availability from current tooling evidence.
- After creation, confirm the displayed name follows Resource Naming and is
  unique across runtimes. On reuse, confirm the name and identifier remain unchanged.
- In the task's validation notes, record the device name and identifier,
  whether it was reused or created, and the reason an additional instance was
  necessary. Include its canonical task/execution context when tracked. Report
  unresolved availability, ownership, or naming limitations.
- Delete tracked dedicated devices only through confirmed selected-task cleanup
  under [Task Resources](../shared/task-resources.md); verify the exact UDID is
  absent while unrelated devices and installed runtimes remain.

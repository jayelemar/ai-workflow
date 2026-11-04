# Electron Security Review

## Purpose

Review the requested desktop trust boundary and report actionable findings.
This procedure does not authorize application changes, private capture, or
external actions. Apply `shared/security.md` for universal trust, private-data,
approval, logging, and supply-chain requirements.

## Establish scope

Read the repository authority, applicable security/testing routes, local desktop
guidance, current security contracts, and relevant source or diff. Existing
`.ai/AGENTS.md` requirements remain the authority for controlled implementation.

Separate implemented behavior from roadmap claims and report material
contradictions. For each changed capability, identify the caller, untrusted
input, privileged operation, authorization decision, and private output. Inspect
consumers when needed to establish the actual boundary.

Consult current [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
for relevant APIs and the installed version. Review effective development or
packaged configuration. Verify an applicable advisory before claiming that a
dependency version is vulnerable.

## Trace affected boundaries

Use local paths as navigation aids, then inspect the implementation:

| Boundary                   | Review questions                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer privilege         | Are isolation, sandboxing, web security, disabled Node integration, and disabled webviews preserved for every window?                                  |
| IPC authorization          | Does each handler verify owned sender, top-level frame, exact URL, capability-specific caller, and runtime arguments before acting?                    |
| Preload exposure           | Are APIs narrow and typed, without raw IPC, Node primitives, event objects, or renderer-controlled channels?                                           |
| Bridge contract            | Do declarations match the runtime API? Types alone do not validate untrusted input.                                                                    |
| Navigation and permissions | Are popups, navigation, redirects, webview attachment, and session permissions restricted? Are packaged apps insulated from development URL overrides? |
| Content policy             | Is effective production CSP restrictive, with development allowances confined to development?                                                          |
| Packaging                  | Does the artifact preserve the intended boundary? Review signing, fuses, and debug exposure when distribution is in scope.                             |

Prioritize reachable exploitation paths over blanket redesigns. A local-file
renderer is a hardening consideration, not itself proof of an exploit. Do not
add custom protocols, libraries, storage, or authentication architecture merely
to satisfy a checklist.

## Capture and private data

For changed capture, trace explicit user action, source selection, OS permission,
captured-data lifetime, and downstream consumers. Check denial, cancellation,
unavailable sources, and multiple displays when relevant. Verify the project's
actual local-processing, retention, consent, and upload contracts at the consuming
boundary rather than relying on UI copy or historical POC claims.

Use synthetic fixtures. Do not collect a user's screen, microphone, camera,
credentials, or private profile to demonstrate a finding. Treat captured text and
model responses as untrusted content; trace any path into HTML, URLs, shell
operations, filesystem access, or privileged IPC.

## Verify and report

Reuse current IPC rejection, renderer isolation, and navigation coverage. Select
the smallest additional negative check for the changed risk: unowned window,
subframe, wrong URL, unauthorized capability, malformed arguments, or denied
permission. Use current local commands and record whether they run unit tests,
build, or launch real Electron.

Native permissions need evidence on the affected OS. For production reviews,
inspect effective packaged settings; mocked permissions and source configuration
cannot prove installed-app behavior. Never disable isolation or sandboxing to
pass a check. Review alone does not authorize automatic remediation.

Report findings by severity with file/line, reachable trigger, impact, evidence,
and smallest remediation. Distinguish confirmed defects, hardening suggestions,
and unverified questions. If no defects were found, state the checked scope and
limits rather than declaring the whole application secure. Include commands,
results, and missing platform evidence without secrets or private data. Keep the
report in chat unless a saved artifact is requested.

## References

Load only the primary documentation needed for the reviewed boundary:

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Sandboxed preload constraints](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Desktop capture API](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Session permission APIs](https://www.electronjs.org/docs/latest/api/session)

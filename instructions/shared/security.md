Version: 2.0
Last Updated: 2026-11-02

# Security Instructions

## Purpose

Provide a portable baseline for input trust, least privilege, private data,
approval boundaries, safe diagnostics, and supply-chain protection on any platform.

## Applies To

- Authentication, authorization, permissions, IPC, capture, and sensitive data.
- Privileged operations, configuration, persistence, and external integrations.
- Logging, error handling, and production code or dependencies at those boundaries.

## Rules

- Treat security as a feature, not an afterthought.
- Never expose secrets, API keys, tokens, credentials, or sensitive configuration
  in client code, logs, responses, screenshots, or committed files. Never commit
  `.env` files. Protect private client, user, and firm data from unauthorized
  access or disclosure in every channel.
- Validate untrusted input at the trusted boundary before business logic,
  persistence, privileged operations, or outbound requests. Static types and
  client-side validation do not establish trust or authorization.
- Enforce least privilege for users, processes, service accounts, background
  jobs, and integrations. Verify ownership, tenant scope, or equivalent access
  boundaries before returning, mutating, or deleting resources.
- Return only the minimum data authorized for the caller. Protect against
  injection, unsafe content rendering, path traversal, insecure direct object
  references, and other risks applicable to the affected boundary.
- Keep password reset, email verification, and session lifecycle flows secure,
  time-bounded, and revocable where those capabilities exist.
- Treat local configuration and remote database mutation as separate
  authorization boundaries. Broad requests such as "set this up" authorize
  local configuration only; they do not authorize creating, initializing,
  migrating, seeding, bootstrapping, or writing to a remote database.
- Before any remote database mutation, obtain explicit operator approval that
  identifies the target environment, cluster or redacted host, database name,
  and intended mutations. Resolve and report the target with a read-only check
  first, and stop when the target is missing, unknown, or mismatched.
- Never derive a new database URI by changing the database name in an existing
  URI, or reuse an existing principal for a new database, unless the operator
  explicitly authorizes the exact target and the credential's intended scope.
- Prefer dry-run or read-only discovery before database deployment commands.
  Tooling that can initialize remote state must fail closed when the target
  database does not exist unless creation was explicitly authorized.
- Log security-relevant events and failures with safe structured context.
  Never log secrets, raw credentials, session tokens, cookies, full
  authorization headers, or private captured content. Keep detailed diagnostics
  in an appropriately protected diagnostic channel and security-sensitive
  user-facing errors generic.
- Run SAST and dependency or supply-chain scanning in CI for production code and
  dependencies. Investigate or explicitly risk-accept relevant findings before
  release; do not disable scans to unblock delivery without explicit risk
  acceptance and remediation tracking.

## Placement

- Keep universal security principles and approval boundaries here.
- Keep HTTP, server enforcement, query safety, and database access requirements
  in `server/security.md`; backend audit infrastructure belongs in
  `server/security-observability.md`.
- Keep framework, vendor, and repository behavior in the corresponding
  application-type or local instructions. Do not require backend infrastructure
  for client-only work.

## Validation

- Review each changed trust boundary for input validation, identity and
  permission enforcement, ownership, data minimization, and least privilege.
- Review secret and private-data handling in code, logs, configuration, tests,
  screenshots, and documentation, including allowed and denied paths.
- Verify every remote database mutation has explicit approval for the resolved
  target, reports commands and expected effects without secrets, and cannot
  silently create or switch databases.
- Verify user-facing errors stay generic while protected diagnostics remain
  actionable. Verify scanning covers affected production code and dependencies,
  or report the missing control and release risk.

## Anti-Patterns

- Trusting caller-provided roles, IDs, ownership claims, or validation results.
- Returning internal errors, stack traces, tokens, or privileged metadata to
  unauthorized callers, or logging private data to demonstrate a finding.
- Treating setup as approval to mutate remote data, repoint an existing URI,
  or rely on an implicit first write to create a database.
- Treating security review as optional because a path appears internal.

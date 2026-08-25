Version: 1.1
Last Updated: 2026-08-25

# Security Instructions

## Purpose

Provide a portable security baseline for application code, APIs, authentication flows, database access, and external integrations.

## Applies To

- Server code and API handlers.
- Authentication, authorization, session, password reset, and email verification flows.
- Database access layers, schema security, and privileged service integrations.
- Public forms, uploads, webhooks, and external callbacks.
- Logging, monitoring, and error handling that touches sensitive data.

## Rules

- Treat security as a feature, not an afterthought.
- Never expose secrets, API keys, tokens, credentials, or other sensitive configuration in client code, logs, responses, screenshots, or committed files.
- Never commit `.env` files.
- Treat local configuration and remote database mutation as separate authorization boundaries. Broad requests such as "set this up" authorize local configuration only; they do not authorize creating, initializing, migrating, seeding, bootstrapping, or writing to a remote database.
- Before any remote database mutation, obtain explicit operator approval that identifies the target environment, cluster or redacted host, database name, and intended mutations. Resolve and report the target with a read-only check first, and stop when the target is missing, unknown, or mismatched.
- Never derive a new database URI by changing the database name in an existing URI, or reuse an existing principal for a new database, unless the operator explicitly authorizes the exact target and the credential's intended access scope.
- Prefer dry-run or read-only discovery before database deployment commands. Tooling that can initialize remote state must fail closed when the target database does not exist unless database creation was explicitly authorized.
- Validate all untrusted input on the server before using it in business logic, persistence, or outbound requests.
- Treat client-side validation as UX only; it never replaces server-side enforcement.
- Use parameterized queries or equivalent safe database primitives; never concatenate untrusted input into SQL.
- Protect against SQL Injection, XSS, CSRF, SSRF, open redirects, path traversal, insecure direct object references, and other common OWASP-style risks.
- Enforce least-privilege access for users, service accounts, background jobs, and integrations.
- Verify ownership, tenant scope, or equivalent access boundaries before returning, mutating, or deleting resources.
- Enable database security controls such as row-level security as early as the stack supports them.
- Return only the minimum data required by the caller; do not expose unnecessary fields, internal identifiers, secrets, or privileged metadata in API responses.
- Use secure HTTP headers and secure cookie settings for authenticated or sensitive flows.
- Restrict CORS to the smallest set of allowed origins, methods, and headers that the feature needs.
- Rate limit public endpoints, authentication flows, upload paths, webhooks when appropriate, and expensive operations.
- Protect public forms and other abuse-prone entry points with CAPTCHA or equivalent abuse controls when appropriate.
- Log security-relevant events and failures without logging secrets, raw credentials, session tokens, cookies, or full authorization headers.
- Return generic user-facing errors for security-sensitive failures while keeping detailed diagnostics in server-side logs.
- Never trust the frontend to prove authentication or authorization; always verify identity and permissions server-side.
- Keep password reset, email verification, and session lifecycle flows secure, time-bounded, and revocable.

## Placement

- Keep cross-project security baseline rules in this file.
- Keep framework-, vendor-, or repository-specific security behavior in companion area instruction files instead of hardcoding it here.
- Add new reusable security rules here only when they are broadly applicable across projects rather than tied to one stack or feature area.

## Validation

- Review every security-sensitive change for server-side validation, authn/authz enforcement, ownership checks, data minimization, and least-privilege access.
- Review secret handling in code, logs, config, tests, screenshots, and documentation.
- Review database access for parameterization, privileged-client boundaries, and row/tenant isolation controls.
- Verify every remote database mutation has explicit approval for the resolved target, reports commands and expected effects without secrets, and cannot silently create or switch databases.
- Review HTTP behavior for secure headers, cookie settings, CORS scope, rate limiting, and abuse controls.
- Review error handling to confirm that user-facing responses stay generic while server-side diagnostics remain actionable.

## Anti-Patterns

- Trusting client-provided roles, user IDs, tenant IDs, ownership claims, or validation results.
- Returning full internal error objects, stack traces, tokens, or privileged metadata to callers.
- Logging secrets, credentials, raw tokens, cookies, or authorization headers.
- Using broad privileged access when a narrower role or scoped query would work.
- Treating a general setup request as authorization to mutate remote data, repointing an existing URI to a new database, or relying on an implicit first write to create a database.
- Shipping public or expensive endpoints without abuse protection.
- Treating security review as optional because the code path looks internal or low-risk.

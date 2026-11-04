# Server Security Instructions

## Purpose

Apply the shared security baseline to backend APIs, HTTP, server authorization,
query safety, database access, and public endpoint abuse controls.

## Applies To

- API and HTTP handlers, authentication services, and privileged integrations.
- Database access layers, public forms, uploads, webhooks, and callbacks.

## Rules

- Apply `shared/security.md` for input trust, least privilege, private data,
  remote mutation approval, safe diagnostics, and supply-chain protection.
- Validate all untrusted input on the server before business logic, persistence,
  or outbound requests. Client-side validation is UX only.
- Never trust the frontend to prove authentication or authorization. Verify
  identity, permissions, ownership, and tenant scope server-side before reading,
  returning, mutating, or deleting protected resources.
- Use parameterized queries or equivalent safe database primitives; never
  concatenate untrusted input into SQL. Enable row-level security or equivalent
  database isolation controls as early as the stack supports them.
- Protect applicable paths against SQL injection, XSS, CSRF, SSRF, open
  redirects, path traversal, and insecure direct object references.
- Return only authorized, necessary fields; exclude unnecessary internal
  identifiers, secrets, and privileged metadata from API responses.
- Use secure HTTP headers and secure cookie settings for authenticated or
  sensitive flows. Restrict CORS to required origins, methods, and headers.
- Rate limit public endpoints, authentication flows, uploads, appropriate
  webhooks, and expensive operations. Apply CAPTCHA or equivalent controls to
  public forms and other abuse-prone entry points when appropriate.
- Keep detailed server diagnostics protected while returning generic errors
  for security-sensitive failures, following the shared logging requirements.

## Placement

- Keep reusable server security requirements here and framework or provider
  details in their corresponding area or local instructions.
- Keep audit infrastructure in `server/security-observability.md`.

## Validation

- Check positive and negative server validation, authentication, authorization,
  ownership, tenant isolation, and data-minimization paths.
- Review queries for parameterization, privileged-client boundaries, and
  row/tenant isolation controls.
- Review HTTP headers, cookies, CORS scope, rate limits, abuse controls, and
  safe error responses for affected endpoints.

## Anti-Patterns

- Bypassing server authorization because a UI hides an action.

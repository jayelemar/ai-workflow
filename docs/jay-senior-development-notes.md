# Jay Elemar Termulo — Senior Developer Growth Notes

## Current Strength

Strong security engineering and regression testing. Sensitive behavior is enforced at database and server boundaries, with coverage for concurrency, authorization, retries, denial paths, and RLS.

## Growth Target

Move from Senior- to strong senior by making complex cross-layer work easier to understand, review, operate, measure, and safely change.

## Priority Improvements

### 1. Reduce ownership hotspots

- Refactor large route/page and service files into focused domain modules, policies, hooks, and UI components.
- Keep existing production migrations immutable. Do not edit, split, or reorder migrations already deployed.
- For future database changes, use small forward-only migrations with explicit compatibility, backfill, rollout, monitoring, and rollback plans.
- Define file-size and review-scope boundaries before new features become monoliths.

### 2. Ship narrower vertical slices

- Split broad cross-layer work into staged PRs or commits: schema/contracts, generated types, services, UI, then tests and rollout.
- Keep each change independently reviewable, deployable when possible, and easy to revert.
- State dependency order and validation in every PR description.

### 3. Measure production performance

- Add query plans for meaningful database changes.
- Track endpoint latency, error rate, and relevant resource usage.
- Add load tests for high-risk flows.
- Use dashboards and record before/after measurements for every performance claim.

### 4. Write durable architecture documentation

- Maintain threat models and authorization matrices for security-sensitive domains.
- Document ownership boundaries, system contracts, migration/deployment procedures, and rollback/runbook steps.
- Keep README and feature docs current as architecture changes.

### 5. Improve delivery hygiene

- Avoid `wip`, vague, conflict-only, and mixed-purpose commits.
- Use focused conventional commits.
- Rebase or squash before merge when history is noisy.
- Record scope, validation performed, migration effect, and rollout risk in commit/PR descriptions.

### 6. Add production security observability

- Emit useful audit events for privileged actions and authorization failures.
- Alert on abnormal permission denials, auth failures, and sensitive configuration changes.
- Run SAST and dependency scanning in CI.
- Maintain incident playbooks for authentication, authorization, and data-access events.

## Operating Principle

Security skill is already proven. Main growth area: maintainability and operational evidence. Build systems other engineers can safely review, deploy, observe, debug, and evolve.

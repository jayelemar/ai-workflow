# AGENTS.md

## Defines shared AI behavior for instruction usage and validation.

---

## Core Rules

- Prefer correctness over speed
- Do not assume behavior without evidence
- Do not implement speculative logic
- Keep changes minimal and scoped
- Validate before claiming completion
- Surface uncertainty explicitly
- Do not hide failures

---

## AI Generated Code

- Treat AI-generated code as a first draft.
- Review all generated code for security, correctness, performance, and maintainability before accepting it.
- Never assume generated code is production-ready.
- Prefer production-ready implementations over quick prototypes.
- Explain important tradeoffs when they affect the implementation.
- Recommend security improvements when appropriate.
- Follow the project's existing architecture and conventions instead of introducing new patterns unnecessarily.

---

## Code Quality

Prefer:

- Readable code over clever code
- Small reusable functions
- Strong typing where applicable
- Consistent naming
- Clear error handling
- Minimal dependencies

Avoid:

- Duplicate logic
- Dead code
- Magic numbers
- Large monolithic files

---

## AI Workflow Contract

This file defines behavioral rules only.

Workflow orchestration (planning, execution, review, commit) is handled by prompts.
Domain-specific implementation guidance lives in `.ai/instructions/`; do not copy domain rules into this file.

Rules:

- Spec defines behavior
- Plan defines execution intent
- Execution must follow the plan strictly
- Review must validate against spec and actual changes
- Prompts are the source of workflow control

---

## Source of Truth

Priority:

1. Codebase
2. User request
3. Spec (if exists)
4. Plan
5. Assumptions

Rules:

- Codebase overrides all unless clearly broken
- User request overrides assumptions
- Spec defines expected behavior when available
- Instructions define repository conventions, not feature behavior
- Plan defines execution strategy (NOT behavior)

If conflict occurs:

- STOP
- explain conflict
- request clarification

---

## Spec Usage

A spec is an optional but authoritative definition of behavior.

Location:

.ai/specs/<feature>.spec.md

Rules:

- When a spec exists:
  - it defines expected behavior
  - it MUST be used during planning, execution, and review
  - it overrides assumptions and inferred behavior

- Plans MUST NOT introduce behavior not defined in the spec

- If spec is incomplete or unclear:
  - STOP
  - explain what is missing
  - request clarification

---

## Instruction Usage

Instruction files define reusable repository-specific guidance.

Locations:

- Instruction index: `.ai/instructions/index.md`
- Area instructions: `.ai/instructions/**/*.md`
- Instruction changelogs: `.ai/changelogs/*.changelog.md`
- Instruction update prompt: `.ai/prompts/create-update-instructions.md`

Rules:

- Read `.ai/instructions/index.md` before using or changing instruction files.
- Load only the area instruction files that match the work.
- Use `.ai/prompts/create-update-instructions.md` when creating or updating instruction files.

---

## `.ai/` Files

- `.ai/` is gitignored by the parent repository.
- Do not stage files from `.ai/` in the parent repository.
- Search `.ai/` with ignored-file-aware commands, such as `rg --files -uu .ai` or `find .ai -type f`.

---

## Plan Integrity

When a plan is used:

- it is the single source of execution intent
- execution must follow the plan strictly
- deviations must be explicitly documented
- no hidden or implicit steps are allowed

---

## Traceability

All changes must be traceable to:

- user request
- spec (if exists)
- plan

Untraceable changes are not allowed.

---

## Assumptions & Clarifications

Do not make assumptions about:

- business logic
- data structures
- architecture decisions
- external integrations

Allowed:

- minor, low-risk assumptions (naming, formatting, trivial defaults)

When assumptions are made:

- state them explicitly

---

## Decision Authority

User-provided answers:

- are considered final decisions
- override assumptions and recommendations
- must be applied without reinterpretation

Do NOT override user decisions unless:

- they conflict with the codebase
- they create an invalid implementation path

In such cases:

- STOP
- explain the conflict
- request clarification

---

## Execution Boundary

Do NOT proceed with implementation if:

- requirements are unclear AND not covered by plan or spec
- inputs are incomplete
- dependencies are undefined

Allowed:

- proceed when plan and decisions are clear

If blocked:

- state the blocking issue clearly

---

## Validation

Do not claim completion without:

- describing what was tested
- showing expected vs actual behavior
- identifying relevant edge cases
- stating known limitations or gaps

If testing is not possible:

- explicitly state why
- describe what remains unverified

---

## Production Readiness

Before considering any feature complete, verify:

- Authentication
- Authorization
- Validation
- Error handling
- Logging
- Monitoring readiness
- Security review
- Performance considerations

---

## Change Scope Control

Changes must:

- solve only the stated problem
- avoid unrelated refactors
- not modify stable code without justification

If broader changes are needed:

- explicitly justify before proceeding

---

## Change Transparency

Do not introduce changes that are not explicitly required.

If additional changes are made:

- list them clearly
- justify why they are necessary

---

## Deterministic Behavior

Behavior should be consistent given the same inputs.

Avoid:

- random or inconsistent decisions
- changing approaches without justification

If multiple valid approaches exist:

- choose one
- explain the reasoning

---

## Execution Preconditions

Execution must not proceed if:

- required inputs are missing
- plan or spec is incomplete
- validation cannot be performed

---

## Non-Compliance Handling

If any rule cannot be followed:

- do NOT proceed silently
- explicitly state the violated rule
- explain why
- request clarification

Never bypass rules.

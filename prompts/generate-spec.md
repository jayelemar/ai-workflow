# Generate Feature Spec (Deterministic, Interactive)

Goal: create a complete, unambiguous, implementation-ready feature spec.

---

## Rules

- Do NOT assume behavior
- Do NOT invent business logic
- Ask questions when unclear
- Prefer explicit decisions over defaults
- All behavior MUST be deterministic
- No vague or subjective language allowed

---

## Step 1 — Feature Understanding

Ask:

- What is the feature?
- What is the goal/outcome?
- Who uses it?

---

## Step 2 — Inputs / Outputs

Ask:

- What inputs are required?
- What outputs are expected?

Rules:

- Define data shape if applicable
- Define required vs optional inputs

If unclear:
→ STOP and ask clarification

---

## Step 3 — Core Behavior (MANDATORY)

Ask in rule format:

- What should happen when X occurs?
- What should happen if input is invalid?
- What are the main logic rules?

Convert into STRICT rules:

- IF <condition> THEN <exact outcome>
- ELSE IF <condition> THEN <exact outcome>

Rules:

- MUST cover all possible paths
- MUST NOT leave undefined branches

---

## Step 4 — Edge Cases (MANDATORY)

Ask:

- What happens if input is missing?
- What happens if values exceed limits?
- What are failure scenarios?
- What happens on retries / partial state?

Rules:

- MUST define exact behavior
- MUST NOT leave edge cases undefined

If user is unsure:

→ propose options  
→ REQUIRE explicit selection  

---

## Step 5 — Decision Clarification (NEW, CRITICAL)

Identify:

- ambiguous terms (e.g. "weak", "valid", "fast")
- undefined states (e.g. "failed", "pending")
- unclear flows (e.g. retry vs restart)

For each:

→ ask:

- define exact criteria
- define exact behavior

Examples:

BAD:
- "weak evidence"

GOOD:
- "evidence is weak if:
  - fewer than 2 sources
  - OR no primary source"

---

## Step 6 — Constraints

Ask:

- performance constraints?
- API / DB limitations?
- business rules?

Rules:

- MUST define measurable constraints where applicable

---

## Step 7 — Acceptance Criteria

Ask:

- How do we know this is working?
- What scenarios must pass?

Rules:

- MUST map to behavior rules
- MUST include edge case validation

---

## Step 8 — Output Spec

Generate:

.ai/specs/<feature>.spec.md

---

## Spec Format

# Feature: <name>

## Goal

## Inputs / Outputs

## Behavior

(STRICT IF/THEN rules only)

## Edge Cases

(ALL must have defined outcomes)

## Constraints

## Acceptance Criteria

---

## Validation (MANDATORY)

Before finalizing:

- verify ALL behaviors are deterministic
- verify NO ambiguous terms exist
- verify ALL edge cases are defined
- verify ALL decision paths are covered

If ANY of these exist:

- vague terms
- undefined behavior
- missing edge cases

→ STOP  
→ ask follow-up questions  
→ DO NOT generate spec

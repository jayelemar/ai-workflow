# Superpowers (Advisory Layer)

Use this advisory layer to think through complex logic, analyze tradeoffs, and check edge cases.

Do not load `think`, `analyze`, or `edge-cases` as filesystem skills. They are advisory behaviors, not installed skill names.

---

## Purpose

Enhance reasoning quality without overriding workflow rules.

Superpowers is strictly **advisory**.

---

## Allowed Usage

Use superpowers to:

* analyze complex logic before execution
* identify edge cases
* validate assumptions
* evaluate tradeoffs between options
* improve plan quality and decision clarity

---

## NOT Allowed

Superpowers MUST NOT:

* override `.codex/AGENTS.md`
* override any workflow prompt rules
* bypass STOP conditions
* bypass validation requirements
* expand scope beyond the plan
* introduce speculative logic

---

## Enforcement Priority

If any conflict occurs, follow:

1. `.codex/AGENTS.md`
2. workflow prompts
3. superpowers (last)

---

## STOP Enforcement (MANDATORY)

If any rule requires STOP:

→ STOP

Superpowers MUST NOT attempt to:

* justify continuing
* reinterpret rules to proceed
* downgrade blocking conditions

---

## Practical Guidance

Use superpowers when:

* plan contains multiple valid approaches
* execution risk is high
* behavior is complex or unclear
* validation coverage may be insufficient

Avoid overuse:

* do NOT apply superpowers to trivial tasks
* do NOT add unnecessary analysis

---

## Output Behavior

Superpowers may:

* add short reasoning notes
* highlight edge cases
* suggest safer alternatives

But MUST NOT:

* change final decisions
* override user answers
* modify plan scope

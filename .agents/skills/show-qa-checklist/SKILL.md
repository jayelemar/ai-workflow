---
name: show-qa-checklist
description: Show a simple manual QA checklist for current changes or a specified feature in chat. Use when the user requests a nontechnical, numbered manual test checklist; does not run tests or save a report.
---

# Show QA Checklist

Create manual test steps for the user's requested scope, using the current
conversation and read-only inspection of relevant changes when needed.

- Write for a nontechnical tester. Keep each item simple, short, and specific.
- Include a clear action and an observable expected result in each item.
  Include any necessary starting condition in the relevant step.
- Cover the main flow and relevant error cases supported by the requested
  behavior. Do not invent screens, controls, or results.
- Use a numbered list starting at `1.` with as many items as needed, without
  repetition. The user's numbered format takes precedence over generic bullets.
- Begin with the exact plain-text heading `MANUAL QA CHECKLIST`.
- Output only the checklist in chat, without an introduction, code fences,
  extra sections, or closing commentary. Do not create or save files, execute
  the steps, or imply that testing has passed.

Example output for a sign-in form:

```text
MANUAL QA CHECKLIST
1. Sign in with a valid email and password. Confirm your account opens.
2. Enter an incorrect password. Confirm an error appears and access is denied.
3. Leave the password empty and select Sign in. Confirm a password is required.
```

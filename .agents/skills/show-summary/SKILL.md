---
name: show-summary
description: Show a short, nontechnical summary of current changes or supplied content in chat. Use when the user asks to show a summary in the title-and-double-hyphen format; does not save a report.
---

# Show Summary

Summarize the user's requested scope, using the current conversation and
read-only inspection of relevant changes when needed.

- Write for a nontechnical reader. Keep wording simple, short, and specific.
- Describe actual changes and their purpose. Translate technical terms into
  everyday language; do not invent benefits or claim unverified results.
- Start with one short, plain-text title.
- Put each supporting point on its own line, starting with literal `--`
  immediately followed by the text. Use as many points as needed without
  repetition; there is no fixed number.
- Output only the summary in chat, without an introduction, extra headings,
  code fences, or closing commentary. Do not create or save files.

Example output:

```text
Run app checks before push
--Adds automatic checks before code is pushed.
--Finds errors in the website and admin tools earlier.
--Finds backend build errors earlier.
```

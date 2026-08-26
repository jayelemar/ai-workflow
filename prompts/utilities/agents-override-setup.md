# Setup Local AGENTS Override

Run only when the operator explicitly requests local project instruction setup.

From the direct parent project root, run:

`pnpm --dir .ai setup:agents-override`

Delegate all mutation and validation to the package utility. Do not add independent filesystem, Git, or workflow-stage logic.

The utility refuses root-instruction and defined legacy Codex conflicts before
mutation; resolve them explicitly before retrying.

Report the actual command output and exit status. Do not claim success after a non-zero result or advance any workflow stage.

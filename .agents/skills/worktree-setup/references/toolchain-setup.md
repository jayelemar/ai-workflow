# Worktree toolchain readiness

Run at the start of authorized execution in each prepared checkout. Use its
documented project directory, including a nested package root when required.
The context copier's Node runtime is a separate prerequisite.

## Readiness checks

1. Read the checkout's setup and hook instructions. Use its runtime pins,
   manifests, lockfiles, and tool configuration to select the required
   toolchains. Check each one in mixed-language projects. A checkout with no
   runtime or dependency requirements can proceed to hook verification.
2. Select the required runtime and verify its executable and version, then
   check the dependency tool. If a required pin or setup procedure is missing
   or conflicts with the available tools, report the mismatch and resolve it
   with the repository's documented setup before installing.
3. Use the repository's dependency validation or lockfile-preserving install.
   Let the documented tool reuse valid worktree-local state and its cache.
   The existence of a dependencies directory alone is insufficient. If
   validation fails, follow the documented repair or install procedure. Report
   any remaining error, including unavailable registry access or a manifest
   and lockfile mismatch. Preserve pins, tracked files, and developer changes.
4. Initialize any missing hooks through the checkout's documented procedure.
   Follow [hook verification](../../../../instructions/shared/delivery-hygiene.md#hook-verification)
   in the environment that will launch Git. If a required check still fails,
   report the checkout, failed command, and remediation before starting
   development there. Repeat the checks after switching shells or runtimes
   when that changes tool resolution.

## Node projects using Corepack

Select the documented Node version first, such as the value in
`.node-version` when using fnm. From the project directory, check
`node --version`, `npm --version`, and `corepack --version` in the selected
environment. If Node or npm is missing, install or select the project's Node
distribution. If Corepack is missing, follow the project's instructions for a
compatible Corepack release under that Node installation.

Use `package.json#packageManager` to identify the manager and version. If the
field is absent, use the repository's documented manager and version selection.
For example, if the field pins Yarn, run the commands below under the selected
Node installation:

```sh
rtk proxy corepack enable yarn
rtk proxy yarn --version
rtk proxy yarn install --immutable
```

For a Corepack-managed pnpm project, enable `pnpm`, verify `pnpm --version`,
and use the documented frozen install, typically
`rtk proxy pnpm install --frozen-lockfile`. Use the documented setup for
other package managers. Check the bare executable against the declared version
before installing. Corepack resolves the project's pin from the checkout.

If enabling the shim fails because the installation directory is read-only,
use `corepack enable --install-directory <writable-bin> <manager>` with a
dedicated writable directory on the Git client's `PATH`. If the bare command
is missing or resolves to another version, check it using `command -v` in a
child shell, for example
`rtk proxy sh -c 'command -v yarn && yarn --version'`. Correct PATH ordering
or refresh the shell, then recheck the version. A successful
`corepack yarn --version` can coexist with a missing bare `yarn` command.

With fnm, initialize it for the current shell and select the pinned Node
version there. In zsh, for example, use
`eval "$(rtk proxy fnm env --shell zsh)"` and
`rtk proxy fnm use '<node-version>'`. Alternatively, launch both setup and Git through
`rtk proxy fnm exec --using '<node-version>' <command>`. One `fnm exec`
invocation affects only its child command. In an existing tmux session, check
the actual pane's environment and initialize fnm there if needed. For a Git
GUI, use its documented environment setup or the hook manager's startup file
and verify the hook in that context. For Husky, keep
`${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh` compatible with `sh`.
Use the startup file to expose the selected toolchain when the Git client
does not inherit it.

## Python projects

Check the documented Python interpreter and dependency tool from the project
directory. For example, if the project pins Python and documents uv with
`uv.lock`, verify `uv --version`, run `rtk proxy uv sync --locked`, and use
`rtk proxy uv run --locked python --version` to check the project's selected
interpreter. For a project using a documented virtual environment, use its
interpreter and install or validate dependencies with its declared tool.
Ensure Git hooks can find their commands through the documented environment
or launcher, even when Git starts in a shell with no activated virtual
environment.

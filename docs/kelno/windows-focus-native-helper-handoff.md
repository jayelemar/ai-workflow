# Windows handoff: Focus scoring release

The Windows helper build and private upload completed on 2026-10-19. The next
owner is the Mac release owner; use the verified artifacts below rather than
repeating the Windows build. The original Windows build prompt is retained as
a reference. This document lives in the separate
`jayelemar/ai-workflow` repository under `docs/kelno/`; in the application
workspace its path is `.ai/docs/kelno/windows-focus-native-helper-handoff.md`.

## Completed Windows handoff — 2026-10-19

- Exact source: `747b1a41851fda83fe8353cdd86973ebf774f9be`.
- Detached build worktree: `C:\kelno-focus-helper`.
- Windows x64, build `26300.9711`; Node.js `24.14.1` (`win32/x64`).
- Visual Studio 2022 Build Tools installation version `17.14.37806.7`;
  MSVC compiler `19.44.35229` (toolset directory `14.44.35207`);
  Windows SDK `10.0.26100.0`, including `audioclientactivationparams.h`.
- The C++ Build Tools workload and recommended SDK components were installed
  through the existing Windows `winget` channel.
- The unchanged helper build script completed in the MSVC x64 Native Tools
  environment. Its automatic `vswhere` launch encountered a quoting error
  under Windows Node 24; initializing `VsDevCmd.bat -arch=x64 -host_arch=x64`
  before running the script avoided that launch path. No source fix was needed.
- `verifyAudioHelper(..., "win32", "x64", true)` passed against both the build
  output and the separate handoff copy. The verifier ran under WSL Node after
  PowerShell stripped quotes from an inline JavaScript argument. The helper
  itself was compiled by native Windows Node/MSVC.
- Independently computed executable and C++ source SHA-256 values matched the
  receipt's `sha256` and `sourceSha256` fields.

Both files remain together in this local directory outside the worktree:

```text
C:\Users\Jay Termulo\AppData\Local\Kelno\private-handoffs\focus-helper-747b1a4-20261019-135136\
```

The user explicitly approved uploading the pair. Upload to
`root@168.144.131.54` (reported hostname `gondoor-dev`) completed at these private
paths:

```text
/var/lib/mobii-updates/focus-helper-747b1a4-20261019-135136/KelnoAudioHelper.exe
/var/lib/mobii-updates/focus-helper-747b1a4-20261019-135136/KelnoAudioHelper.exe.json
```

The remote directory is root-owned with mode `0700`; both files are root-owned
with mode `0600`. Remote SHA-256 hashes matched the local hashes:

| Bytes hashed | SHA-256 |
| --- | --- |
| `KelnoAudioHelper.exe` | `0e325d97cc33dfbc065701f395fc51f98ad49f21c20d636d44fd9b603d15fabe` |
| `KelnoAudioHelper.exe.json` | `d37636105af2105cc307f543bc12b82ca9aa2ef623c8e7ee4f9f6b276a66c5b2` |
| `native/WindowsAudioCapture.cpp` | `7d6ffc6e918f8dc85bbc07604cf09695a9cfecb1fa5440b816997cda35a88315` |

The original dirty checkout was preserved. No application source changes,
binary commits, release allocation, packaging, publication, API redeployment,
or paid provider tests were performed as part of this helper handoff.

## Resume on the Mac

Use an isolated checkout of the exact source SHA above and read its desktop
release instructions. In a terminal on the Mac with existing authorized SSH
access, download both files into a fresh local directory:

```sh
KELNO_HELPER_DIR="$(rtk proxy mktemp -d /tmp/kelno-focus-helper-747b1a4.XXXXXX)"
rtk proxy scp -o BatchMode=yes \
  root@168.144.131.54:/var/lib/mobii-updates/focus-helper-747b1a4-20261019-135136/KelnoAudioHelper.exe \
  root@168.144.131.54:/var/lib/mobii-updates/focus-helper-747b1a4-20261019-135136/KelnoAudioHelper.exe.json \
  "$KELNO_HELPER_DIR/"
rtk proxy chmod 0600 "$KELNO_HELPER_DIR/KelnoAudioHelper.exe" "$KELNO_HELPER_DIR/KelnoAudioHelper.exe.json"
rtk proxy shasum -a 256 "$KELNO_HELPER_DIR/KelnoAudioHelper.exe" "$KELNO_HELPER_DIR/KelnoAudioHelper.exe.json"
export KELNO_WINDOWS_AUDIO_HELPER="$KELNO_HELPER_DIR/KelnoAudioHelper.exe"
```

Compare both printed hashes with the table above; stop on any mismatch. From
`apps/desktop` in the pinned checkout, with Node.js 24, run:

```sh
rtk proxy node --input-type=module -e 'import {verifyAudioHelper} from "./scripts/build-audio-helper.mjs"; await verifyAudioHelper(process.env.KELNO_WINDOWS_AUDIO_HELPER, "win32", "x64", true); console.log("Downloaded Windows x64 helper and source receipt verified");'
```

Stop if verification fails. Keep this terminal environment for the existing
cross-Windows packaging command so it receives `KELNO_WINDOWS_AUDIO_HELPER`.
That variable must point to the downloaded local executable, with its receipt
beside it. The hash receipt checks source and artifact consistency; it is not a
digital signature or independent proof of the build host/toolchain.

Combined Windows/Mac packaging and publication remain with the Mac release
owner under the existing release procedure. Re-read both release states and
hosted versions before allocating a Nightly number; the original `.36` feed
observation below is historical and does not establish today's next number.

Windows incident acceptance remains outstanding after publication: three real
provider score results without blackout on the affected machine, background
scoring, Focus exit/Escape/reselection behavior, and login/access gating. No
mock native E2E checks or real-provider acceptance checks were run during this
helper build. Obtain separate approval before new paid provider runs. Do not
mark the Focus incident resolved based on helper verification alone.

## Original Windows build prompt (reference)

Resume the Kelno Focus scoring release by building its real Windows x64 native
audio helper and handing the verified artifacts back to the Mac release owner.
Complete this work on this Windows laptop. Do not use GitHub CLI.

### Context and scope

- Focus scoring fix: `a1bb6f5b08310fc1b5206efcf3d5aa375cbcb4d5`, merged into
  `dev` through PR #57.
- Prepared release source: `747b1a41851fda83fe8353cdd86973ebf774f9be`, which also
  repairs the missing landing-page lockfile importer. It is pushed to application
  `origin/dev`. Use this exact source for the helper handoff.
- The development API has already been updated to that source and passed its
  local and public acceptance checks. Do not redeploy it or repeat paid tests.
- At handoff preparation, all desktop feeds still served `0.1.0-nightly.36`.
  No new Nightly number has been allocated. Publication must re-read current
  state; do not assume the next number is still 37.
- At original handoff preparation, combined publication was waiting for
  `KelnoAudioHelper.exe` and its matching `KelnoAudioHelper.exe.json`, built
  with MSVC on Windows. That helper prerequisite is now complete as recorded
  above; do not substitute the retained older helper.
- This prompt authorizes the helper build, verification, and private artifact
  upload using existing SSH access. Leave combined Windows/Mac packaging and
  feed publication to the Mac release owner. Do not commit binaries, modify
  release guards, allocate a version, replace a published release, or change
  credentials. Preserve unrelated working files and the user's installed app.

### 1. Inspect and prepare the exact source

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the relevant delivery/testing
instructions, `apps/desktop/AGENTS.md`, and
`apps/desktop/scripts/build-audio-helper.mjs`. Prefix shell commands with `rtk`
as required by the local instructions; `rtk proxy` runs commands it does not
otherwise support. If RTK is unavailable, report that prerequisite.

Inspect status before making changes. Fetch without resetting or switching a
dirty checkout:

```sh
rtk git status --short --branch
rtk git fetch origin dev
rtk git show --no-patch --format=fuller 747b1a41851fda83fe8353cdd86973ebf774f9be
rtk git merge-base --is-ancestor 747b1a41851fda83fe8353cdd86973ebf774f9be origin/dev
```

Create a new, unused detached worktree at that exact commit. Choose a short
absolute Windows path, for example `C:/kelno-focus-helper`; if it already exists,
inspect it and choose a new path instead of overwriting it:

```sh
rtk git worktree add --detach C:/kelno-focus-helper 747b1a41851fda83fe8353cdd86973ebf774f9be
```

Run subsequent build commands from this worktree. Read the original checkout's
`.ai` instructions if the nested `.ai` repository is absent from the worktree.
Confirm `HEAD` is the full expected SHA. Do not substitute a newer commit or an
older helper merely because its filename matches.

### 2. Build with the supported Windows toolchain

Use Windows x64, Node.js 24, and Visual Studio 2022 Build Tools with Desktop
development with C++, MSVC x64 tools, and Windows SDK build 20348 or newer.
The script discovers the compiler through `vswhere`; an x64 Native Tools prompt
also works. Inspect existing tools first. If a required tool is missing, report
the exact missing component and obtain it through the laptop's normal approved
installation process. Do not use MinGW, a stub executable, or disable audio.

From `apps/desktop` in the pinned worktree:

```sh
rtk proxy node --version
rtk proxy node -p "process.platform + '/' + process.arch"
rtk proxy node scripts/build-audio-helper.mjs x64
```

This helper-only build uses Node built-ins and MSVC; it does not require a full
workspace dependency install. Inspect compiler failures rather than changing
the C++ implementation to make an unsupported toolchain pass.

Expected outputs, relative to `apps/desktop`:

```text
out/native/x64/KelnoAudioHelper.exe
out/native/x64/KelnoAudioHelper.exe.json
```

### 3. Verify the executable and source receipt

Use the repository's exported verifier with receipt verification enabled. From
`apps/desktop`, run the following, adapting quoting to the available Windows
shell without changing the checks:

```sh
rtk proxy node --input-type=module -e 'import {verifyAudioHelper} from "./scripts/build-audio-helper.mjs"; await verifyAudioHelper("out/native/x64/KelnoAudioHelper.exe", "win32", "x64", true); console.log("Windows x64 helper and source receipt verified");'
```

This validates the x64 PE executable and checks the receipt's version, platform,
architecture, executable SHA-256, and `native/WindowsAudioCapture.cpp` SHA-256.
Never hand-edit the receipt. If verification fails, fix the build or source
selection and rebuild on Windows.

Record the full Git source SHA, executable SHA-256, C++ source SHA-256, receipt
SHA-256, Windows version, Node version, and MSVC/SDK versions. Compute hashes from
the actual bytes using Node's `crypto` module or PowerShell `Get-FileHash`.
Check that the receipt's `sha256` and `sourceSha256` equal the computed values.
Keep credentials and environment contents out of output and reports.

### 4. Hand off both files privately

Copy the verified pair to a new private handoff directory outside the worktree.
Keep the filenames exactly as shown above, beside each other. Only these two
files are needed; exclude object files, environment files, Git history, logs,
and user recordings. Re-run verification against the copied executable.

The user supplied this server connection:

```sh
rtk proxy ssh -T -o BatchMode=yes root@168.144.131.54 hostname
```

Use an existing configured SSH key if available. Do not retrieve or display
private keys or passwords. If this laptop cannot authenticate, preserve the
verified local pair and report its absolute directory so the user can transfer
it later; do not claim it was uploaded.

If SSH works, create a fresh root-only directory under
`/var/lib/mobii-updates/` named for source `747b1a4` and a unique build timestamp.
Use restrictive permissions (`0700` directory, `0600` files). Use `scp` to upload
only the executable and receipt, then compare both server SHA-256 hashes with
the local hashes. Refuse an existing destination. Keep these files outside the
public `/var/www/mobii-updates` tree. Do not alter the live API, release state,
feed pointers, or other staging directories.

Report the absolute private remote path to `KelnoAudioHelper.exe`, or the local
path if upload could not run. The Mac release owner must copy both files to a
private local directory, verify them against the selected source again, and set
`KELNO_WINDOWS_AUDIO_HELPER` to the executable's absolute local path before the
existing cross-Windows packaging command. A remote server path is not a valid
local environment value.

### 5. Preserve the outstanding Windows acceptance work

Building the helper does not prove that the affected Windows Focus incident is
resolved. Publication and the following check are still outstanding:

1. Install the subsequently published Nightly that includes the Focus fix.
2. On the affected Windows machine, obtain three actual provider score results
   with no blackout. Check background scoring and the documented Focus exit,
   Escape, and reselection behavior. Do not confuse End session with Exit Focus.
3. Verify login/access gating still works. Use public or synthetic test media;
   keep private capture content, credentials, and raw provider data out of Git
   and handoff reports. Obtain separate approval before new paid provider runs.

If running source-based mock native tests before publication, follow the
existing desktop E2E instructions and public astronaut fixture. Report them as
mock native checks, separately from the three required real provider results.
Do not weaken the test or call the incident resolved without that evidence.

### Final handoff

Return a concise report with:

- Exact source SHA and Windows/toolchain versions.
- Both artifact paths and SHA-256 hashes, plus the C++ source hash.
- Result of `verifyAudioHelper(..., "win32", "x64", true)`.
- Private upload destination and matching remote hashes, or the access blocker.
- Any tests actually run and the remaining publication/Windows acceptance work.

Make no source changes or Git commits unless a concrete build defect requires
them and the user authorizes that additional scope. Never use GitHub CLI.

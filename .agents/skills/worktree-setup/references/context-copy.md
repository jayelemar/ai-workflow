# Task-local context copy

Read after all repositories and selected files pass preflight, including the
retry checks in [worktree-checks.md](worktree-checks.md). Execute this block in
Bash with absolute, canonical `workspace`, `task_root`, `workflow_head`, and
preflighted `canonical_files`, `local_files`, and `workspace_files` arrays.
Canonical paths are relative to `.ai`; other paths are workspace-relative.
The task root must already exist from native worktree creation. Node is the
workflow's existing runtime; this uses only built-in modules, without packages.

For read-only context preflight, set `context_check_only=1` and execute the same
block before creating any targets, then unset it for copying. The task root may
be absent in check-only mode. This keeps retry checks and copying in one place.

All Git children in this procedure disable replacement lookup so recorded
commits, trees, and attribute blobs retain their stored meaning. Replacement
refs, including alternate namespaces, are preserved without influencing proof.

For a native single-repository task root, append missing root rules for `.ai/`,
`.agents/`, and `AGENTS.override.md` to Git's resolved `info/exclude`. Git shares
this file across the repository's worktrees, including the source checkout.
Preserve existing rules and tracked files; never edit tracked `.gitignore` files.
Coordination roots have no application Git metadata to update. Verify effective
ignoring after copying; conflicting higher-priority ignore rules block completion.

The block checks all context conflicts before copying. Invalid Git metadata is
reported alongside independent link/file conflicts; skip reads through unsafe
workflow roots and Git probes that depend on invalid administration. It resumes a compatible
independent clone, reuses exact links, and fills missing context. It never
repairs unknown Git metadata. A runtime failure preserves partial state for the
entrypoint's failure report, without automatic rollback, source mutation, or cleanup.

<!-- context-copy:start -->

```bash
rtk proxy node --input-type=module - "$workspace" "$task_root" "$workflow_head" \
  "${#canonical_files[@]}" "${#local_files[@]}" "${context_check_only:-0}" \
  "${canonical_files[@]}" "${local_files[@]}" "${workspace_files[@]}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [workspace, taskRoot, head, canonicalCount, localCount, checkOnly, ...files] = process.argv.slice(2);
const canonical = files.slice(0, Number(canonicalCount));
const local = files.slice(Number(canonicalCount), Number(canonicalCount) + Number(localCount));
const external = files.slice(Number(canonicalCount) + Number(localCount));
const source = path.join(workspace, '.ai');
const target = path.join(taskRoot, '.ai');
const skills = ['create-plan', 'worktree-setup', 'git-commit', 'pull-request', 'show-summary', 'manual-qa-checklist', 'brainstorm'];
const run = (...args) => execFileSync('rtk', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' },
});
const git = (root, ...args) => run('proxy', 'git', '-C', root, ...args).trim();
const info = p => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const fail = message => { throw new Error(message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const nativeMode = executable => (executable ? 0o777 : 0o666) & ~process.umask();
const errors = [];
const check = operation => { try { operation(); return true; } catch (e) { errors.push(e.message); return false; } };
function safe(root, relative, missing = false) {
  assert(relative && !path.isAbsolute(relative) && path.normalize(relative) === relative &&
    !relative.split('/').includes('..'), `unsafe selected path: ${relative}`);
  const parts = relative.split('/');
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = info(current);
    if (!stat) { assert(missing, `missing selected context: ${relative}`); continue; }
    assert(!stat.isSymbolicLink(), `symbolic link in context: ${relative}`);
    assert(i === parts.length - 1 ? stat.isFile() : stat.isDirectory(), `conflicting context type: ${relative}`);
  }
  return current;
}
const excluded = relative => relative.split('/').some(p =>
  /^(?:\.git|node_modules|\.cache|dist|build|out|logs?|artifacts|state|tmp|credentials(?:\..*)?|\.env.*)$/.test(p) ||
  /\.(?:pem|key)$/.test(p));
function directory(p) {
  assert(info(p)?.isDirectory() && !info(p).isSymbolicLink(), `unsafe directory: ${p}`);
}
function walk(root, visit) {
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (visit(full, stat) === false) continue;
    if (stat.isDirectory()) walk(full, visit);
  }
}
function checkRoot(root, missing = false) {
  return check(() => {
    assert(path.isAbsolute(root), `relative root: ${root}`);
    let current = path.parse(root).root;
    for (const part of root.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (info(current)) directory(current);
    }
    if (!missing) directory(root);
  });
}
const workspaceSafe = checkRoot(workspace);
const taskSafe = checkRoot(taskRoot, checkOnly === '1');
const sourceSafe = workspaceSafe && check(() => directory(source));
let sourceObjectFormat = null;
const sourceGitSafe = sourceSafe && check(() => {
  assert(git(source, 'rev-parse', '--show-toplevel') === source, 'source workflow is not independent');
  assert(git(source, 'rev-parse', 'HEAD') === head, 'source workflow HEAD changed; repeat preflight');
  sourceObjectFormat = git(source, 'rev-parse', '--show-object-format');
  assert(['sha1', 'sha256'].includes(sourceObjectFormat), 'unsupported source workflow object format');
});
const sourceSkillsSafe = sourceSafe && check(() => {
  directory(path.join(source, '.agents'));
  directory(path.join(source, '.agents/skills'));
});
let applicationExclude = null;
let applicationExcludeContent = '';
const contextRules = ['/.ai/', '/.agents/', '/AGENTS.override.md'];
if (taskSafe && info(path.join(taskRoot, '.git'))) check(() => {
  assert(git(taskRoot, 'rev-parse', '--show-toplevel') === taskRoot, 'context exclude requires the native task root');
  const common = git(taskRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  assert(checkRoot(common), 'unsafe application common Git directory');
  const infoDirectory = path.join(common, 'info');
  if (info(infoDirectory)) directory(infoDirectory);
  const stat = info(path.join(infoDirectory, 'exclude'));
  assert(!stat || (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1), 'unsafe application Git exclude');
  const resolved = git(taskRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude');
  assert(resolved === path.join(infoDirectory, 'exclude'), 'unexpected application exclude path');
  applicationExclude = resolved;
  applicationExcludeContent = stat ? fs.readFileSync(resolved, 'utf8') : '';
});
if (sourceSkillsSafe) for (const skill of skills) check(() => {
  directory(path.join(source, '.agents/skills', skill));
  safe(source, `.agents/skills/${skill}/SKILL.md`);
});
const allowedCanonical = relative => /^(?:\.gitignore|AGENTS\.md|README\.md|package\.json|pnpm-lock\.yaml|\.codex\/config\.toml|\.husky\/(?:pre-commit|pre-push))$/.test(relative) ||
  /^(?:\.agents\/skills|\.github|docs|instructions\/(?:shared|mobile|desktop|web|server)|prompts|scripts)\//.test(relative);
for (const relative of canonical) check(() => assert(allowedCanonical(relative), `unexpected canonical location: ${relative}`));
for (const relative of local) check(() => assert(relative.startsWith('.ai/'), `local context outside workflow: ${relative}`));
for (const relative of external) check(() => assert(!relative.startsWith('.ai/'), `misclassified workflow context: ${relative}`));
const recordedFiles = new Set();
const inventoryReady = sourceGitSafe && check(() => {
  for (const relative of [
    ...run('proxy', 'git', '-C', source, 'ls-tree', '-r', '--name-only', '-z', head).split('\0'),
    ...run('proxy', 'git', '-C', source, 'ls-files', '-z').split('\0'),
  ].filter(Boolean)) recordedFiles.add(relative);
});
if (inventoryReady) for (const relative of recordedFiles)
  check(() => assert(canonical.includes(relative), `uninventoried workflow source: ${relative}`));
let hasClone = false;
if (taskSafe) check(() => { hasClone = !!info(target); });
const inspectWorkflow = taskSafe && (!hasClone || check(() => directory(target)));
let targetGitSafe = false;
if (hasClone && inspectWorkflow) check(() => {
  // Validate administration before asking Git to interpret destination config.
  const metadata = path.join(target, '.git');
  directory(metadata);
  const indexReady = check(() => safe(metadata, 'index'));
  const priorErrors = errors.length;
  check(() => safe(metadata, 'HEAD'));
  let refStorage = 'files';
  check(() => {
    safe(metadata, 'config');
    const config = run('proxy', 'git', 'config', '--file', path.join(metadata, 'config'), '--list');
    const lines = config.trim().split('\n');
    const allowed = /^(?:core\.repositoryformatversion=[01]|extensions\.objectformat=(?:sha1|sha256)|extensions\.refstorage=(?:files|reftable)|core\.filemode=(?:true|false)|core\.bare=false|core\.logallrefupdates=true|core\.ignorecase=true|core\.precomposeunicode=true)$/;
    const fields = new Map(lines.map(line => line.split('=')));
    const version = fields.get('core.repositoryformatversion');
    const extension = fields.get('extensions.objectformat');
    const refExtension = fields.get('extensions.refstorage');
    refStorage = refExtension || 'files';
    assert(lines.every(line => allowed.test(line)) && ['0', '1'].includes(version) &&
      (!(extension || refExtension) || version === '1') &&
      (!sourceGitSafe || (extension || 'sha1') === sourceObjectFormat),
      'incompatible workflow Git config; preserve and inspect metadata');
  });
  check(() => assert(!info(path.join(metadata, 'commondir')), 'workflow common Git directory redirects are forbidden'));
  check(() => assert(!info(path.join(metadata, 'objects/info/alternates')), 'workflow object alternates are forbidden'));
  check(() => {
    const attributesDirectory = path.join(metadata, 'info');
    if (info(attributesDirectory)) directory(attributesDirectory);
    assert(!info(path.join(attributesDirectory, 'attributes')), 'workflow attribute overrides are forbidden');
  });
  walk(metadata, (p, s) => check(() => {
    assert(!s.isSymbolicLink(), 'symbolic link in workflow Git metadata');
    if (s.isFile()) assert(s.nlink === 1, 'workflow Git metadata hard link');
    if (p.startsWith(path.join(metadata, 'hooks') + path.sep) && s.isFile())
      assert(p.endsWith('.sample'), 'active workflow hook');
  }));
  if (errors.length !== priorErrors || (!indexReady && info(path.join(metadata, 'index')))) return;
  assert(git(target, 'rev-parse', '--show-toplevel') === target &&
    git(target, 'rev-parse', '--absolute-git-dir') === metadata &&
    path.resolve(target, git(target, 'rev-parse', '--git-common-dir')) === metadata, 'workflow Git metadata is not independent');
  assert(!sourceGitSafe || git(target, 'rev-parse', '--show-object-format') === sourceObjectFormat, 'workflow object format differs from source');
  assert(git(target, 'rev-parse', '--show-ref-format') === refStorage, 'workflow reference storage differs from validated config');
  assert(git(target, 'rev-parse', 'HEAD') === head && !git(target, 'branch', '--show-current'), 'workflow commit differs from recorded base');
  assert(!git(target, 'remote'), 'workflow remotes are forbidden');
  git(target, 'fsck', '--no-dangling');
  if (indexReady) assert(!git(target, 'diff', '--cached', '--name-only', head), 'workflow index has unexpected edits');
  targetGitSafe = true;
});
const inspectLinks = taskSafe && check(() => {
  for (const p of [path.join(taskRoot, '.agents'), path.join(taskRoot, '.agents/skills')])
    if (info(p)) directory(p);
});
if (inspectLinks) for (const skill of skills) check(() => {
  const link = path.join(taskRoot, '.agents/skills', skill);
  const stat = info(link);
  if (stat) assert(stat.isSymbolicLink() && fs.readlinkSync(link) === `../../.ai/.agents/skills/${skill}`, `conflicting managed skill: ${skill}`);
});
const expected = new Set([...canonical, ...local.map(p => path.relative('.ai', p))]);
if (hasClone && inspectWorkflow) check(() => walk(target, (p, s) => {
  const relative = path.relative(target, p);
  if (relative === '.git') return false;
  if (!s.isDirectory()) check(() => assert(expected.has(relative) && !s.isSymbolicLink(), `unexpected workflow context: ${relative}`));
}));
const copies = [];
const deletions = [];
if (sourceSafe) for (const relative of canonical) check(() => {
  assert(!excluded(relative), `excluded canonical context: ${relative}`);
  const from = safe(source, relative, true);
  const to = hasClone && inspectWorkflow ? safe(target, relative, true) : path.join(target, relative);
  const sourceStat = info(from);
  const destStat = inspectWorkflow ? info(to) : null;
  let base = null;
  const entry = sourceGitSafe ? git(source, 'ls-tree', head, '--', relative) : '';
  if (entry) {
    assert(entry.startsWith('100644 blob ') || entry.startsWith('100755 blob '), `unsafe workflow base entry: ${relative}`);
    base = entry.match(/^100(?:644|755) blob ([a-f0-9]+)\t/)[1];
  }
  if (destStat) {
    // Reject impossible local permissions before content proof can be skipped.
    const mode = destStat.mode & 0o7777;
    const sourceModeMatches = sourceStat && mode === (sourceStat.mode & 0o7777);
    const possibleBaseModes = sourceGitSafe
      ? (base ? [nativeMode(entry.startsWith('100755'))] : [])
      : [nativeMode(false), nativeMode(true)];
    const modePossible = check(() => assert(sourceModeMatches || possibleBaseModes.includes(mode), `conflicting canonical mode: ${relative}`));
    assert(destStat.nlink === 1, `shared canonical file: ${relative}`);
    if (!sourceGitSafe) return;
    const bytes = fs.readFileSync(to);
    const intended = sourceStat && bytes.equals(fs.readFileSync(from));
    // Git's clean conversion recognizes CRLF native checkouts without loading
    // large blob output. Read attributes from the recorded base, independently
    // of partially copied attribute changes, only after metadata checks.
    const baseline = base && (git(source, 'hash-object', '--no-filters', '--', to) === base ||
      (targetGitSafe && git(target, `--attr-source=${head}`, 'hash-object', `--path=${relative}`, '--', to) === base));
    if (!intended && !baseline && !targetGitSafe) return;
    assert(intended || baseline, `conflicting canonical file: ${relative}`);
    if (modePossible) assert(sourceModeMatches ||
      (baseline && possibleBaseModes.includes(mode)), `conflicting canonical mode: ${relative}`);
  }
  if (sourceStat) copies.push([from, to]);
  else if (inventoryReady) { assert(recordedFiles.has(relative), `unprovable canonical deletion: ${relative}`); if (destStat) deletions.push(to); }
});
if (workspaceSafe) for (const relative of [...local, ...external]) check(() => {
  assert(!excluded(relative), `excluded selected context: ${relative}`);
  const from = safe(workspace, relative);
  const to = taskSafe ? safe(taskRoot, relative, true) : null;
  const stat = to && info(to);
  if (stat) {
    // A native checkout records only the executable bit. Compare normalized
    // bytes with its baseline only when the selected source has that same ID.
    let checkoutMode = null;
    let checkoutBase = null;
    if (!relative.startsWith('.ai/')) {
      try {
        const entry = git(taskRoot, '--literal-pathspecs', 'ls-files', '--stage', '-z', '--', relative);
        const match = entry.match(/^100(644|755) ([a-f0-9]+) 0\t/);
        if (match) {
          checkoutMode = nativeMode(match[1] === '755');
          checkoutBase = match[2];
        }
      } catch { /* Coordination roots need not be Git checkouts. */ }
    }
    check(() => assert((stat.mode & 0o7777) === (fs.statSync(from).mode & 0o7777) ||
      (stat.mode & 0o7777) === checkoutMode, `conflicting selected mode: ${relative}`));
    assert(stat.nlink === 1, `shared selected file: ${relative}`);
    const intended = fs.readFileSync(from).equals(fs.readFileSync(to));
    const baseline = !intended && checkoutBase &&
      git(taskRoot, '--attr-source=HEAD', 'hash-object', `--path=${relative}`, '--', from) === checkoutBase &&
      git(taskRoot, '--attr-source=HEAD', 'hash-object', `--path=${relative}`, '--', to) === checkoutBase;
    assert(intended || baseline, `conflicting selected file: ${relative}`);
  }
  if (to) copies.push([from, to]);
});
assert(!errors.length, errors.join('\n'));
if (checkOnly === '1') process.exit(0);
if (!hasClone) {
  run('proxy', 'git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', '--no-hardlinks', '--no-checkout', '--', source, target);
  git(target, 'remote', 'remove', 'origin');
  git(target, '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', head);
}
// No context writes occur until every discoverable conflict above has passed.
for (const to of deletions) fs.unlinkSync(to);
// A new clone still contains selected source deletions from its base commit.
if (!hasClone) for (const relative of canonical)
  if (!info(path.join(source, relative)) && info(path.join(target, relative))) fs.unlinkSync(path.join(target, relative));
for (const [from, to] of copies) {
  const a = fs.statSync(from, { bigint: true });
  const b = info(to) && fs.statSync(to, { bigint: true });
  if (b && a.mode === b.mode && a.mtimeNs === b.mtimeNs && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  run('proxy', 'cp', '-p', '--', from, to);
}
for (const skill of skills) {
  directory(path.join(target, '.agents/skills', skill));
  safe(target, `.agents/skills/${skill}/SKILL.md`);
}
fs.mkdirSync(path.join(taskRoot, '.agents/skills'), { recursive: true });
for (const skill of skills) {
  const link = path.join(taskRoot, '.agents/skills', skill);
  if (!info(link)) fs.symlinkSync(`../../.ai/.agents/skills/${skill}`, link);
}
if (applicationExclude) {
  const existing = applicationExcludeContent.split(/\r?\n/);
  const missing = contextRules.filter(rule => !existing.includes(rule));
  if (missing.length) {
    fs.mkdirSync(path.dirname(applicationExclude), { recursive: true });
    const separator = applicationExcludeContent && !applicationExcludeContent.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(applicationExclude, `${separator}${missing.join('\n')}\n`);
  }
  assert(!git(taskRoot, 'ls-files', '--others', '--exclude-standard', '--', '.ai', '.agents', 'AGENTS.override.md'),
    'control context is still visible to Git; inspect higher-priority ignore rules');
}
NODE
```

<!-- context-copy:end -->

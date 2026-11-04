# Task-local context copy

Read this procedure during Worktree Setup's Create safely step, after all
repositories and selected files pass its preflight. Execute this single block
in Bash with absolute, canonical `workspace`, `task_root`, `workflow_head`, and
preflighted `canonical_files`, `local_files`, and `workspace_files` arrays.
Canonical paths are relative to `.ai`; the other paths are workspace-relative.
The task root must already exist from native worktree creation. Do not run this
on an existing prepared task or copy source `.agents/skills/` links.

The block checks the four skill sources and every managed link destination
before writing context. Real `.agents/` ancestors and unrelated custom entries
are allowed. Any failure after mutation begins leaves partial state for the
skill's required report; it performs no rollback or cleanup.

<!-- context-copy:start -->

```bash
set -euo pipefail
workflow_source="$workspace/.ai"
workflow_target="$task_root/.ai"
managed_skills=(create-plan worktree-setup git-commit pull-request)
# Resolve the roots without following an unexpected workspace/task-root alias.
test "$(cd -- "$workspace" && pwd -P)" = "$workspace"
test "$(cd -- "$task_root" && pwd -P)" = "$task_root"
for directory in "$workflow_source" "$workflow_source/.agents" "$workflow_source/.agents/skills"; do
  test -d "$directory"
  test ! -L "$directory"
done
for skill in "${managed_skills[@]}"; do
  source_skill="$workflow_source/.agents/skills/$skill"
  test -d "$source_skill"
  test ! -L "$source_skill"
  test -f "$source_skill/SKILL.md"
  test ! -L "$source_skill/SKILL.md"
done
for directory in "$task_root/.agents" "$task_root/.agents/skills"; do
  if test -e "$directory" || test -L "$directory"; then
    test -d "$directory"
    test ! -L "$directory"
  fi
done
for skill in "${managed_skills[@]}"; do
  destination="$task_root/.agents/skills/$skill"
  test ! -e "$destination"
  test ! -L "$destination"
done
test ! -e "$workflow_target"
test ! -L "$workflow_target"
rtk git -c core.hooksPath=/dev/null clone --no-local --no-hardlinks --no-checkout -- "$workflow_source" "$workflow_target"
rtk git -C "$workflow_target" remote remove origin
rtk git -C "$workflow_target" -c core.hooksPath=/dev/null checkout --detach "$workflow_head"
for relative in "${canonical_files[@]}"; do
  if test -f "$workflow_source/$relative"; then
    rtk proxy mkdir -p -- "$workflow_target/$(rtk proxy dirname -- "$relative")"
    rtk proxy cp -p -- "$workflow_source/$relative" "$workflow_target/$relative"
  else
    rtk proxy rm -f -- "$workflow_target/$relative"
  fi
done
for relative in "${local_files[@]}" "${workspace_files[@]}"; do
  destination="$task_root/$relative"
  if test -e "$destination"; then
    rtk proxy cmp -s -- "$workspace/$relative" "$destination"
  else
    rtk proxy mkdir -p -- "$task_root/$(rtk proxy dirname -- "$relative")"
  fi
  rtk proxy cp -p -- "$workspace/$relative" "$destination"
done
# Validate the copied sources before exposing them through task-local links.
for skill in "${managed_skills[@]}"; do
  copied_skill="$workflow_target/.agents/skills/$skill"
  test -d "$copied_skill"
  test ! -L "$copied_skill"
  test -f "$copied_skill/SKILL.md"
  test ! -L "$copied_skill/SKILL.md"
done
rtk proxy mkdir -p -- "$task_root/.agents/skills"
for skill in "${managed_skills[@]}"; do
  rtk proxy ln -s -- "../../.ai/.agents/skills/$skill" "$task_root/.agents/skills/$skill"
done
```

<!-- context-copy:end -->

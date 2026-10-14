#!/usr/bin/env bash
# PreToolUse(Bash): block `git push` unless /security-review was recorded for the current HEAD.
# After running /security-review and resolving findings, record it with:
#   git rev-parse HEAD > "$(git rev-parse --git-dir)/security-review-ok"
# ponytail: marker is self-attested by the agent; proves the step ran, not that findings were fixed.
input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
grep -Eq '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]]|$)' <<<"$cmd" || exit 0

cd "$(jq -r '.cwd // empty' <<<"$input")" 2>/dev/null || cd "$CLAUDE_PROJECT_DIR"
head=$(git rev-parse HEAD 2>/dev/null) || exit 0
marker="$(git rev-parse --git-dir)/security-review-ok"

if [[ "$(cat "$marker" 2>/dev/null)" != "$head" ]]; then
  echo "Push blocked: no /security-review recorded for HEAD $head. Run /security-review, fix or acknowledge findings, then: git rev-parse HEAD > \"$marker\"" >&2
  exit 2
fi

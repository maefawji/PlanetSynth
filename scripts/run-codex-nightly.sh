#!/usr/bin/env bash

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this script from inside the repository." >&2
  exit 1
}

cd "$ROOT"

for command in codex git node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree is not clean. Commit or stash changes before starting." >&2
  exit 1
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)"
BRANCH="codex/nightly-$RUN_ID"
RUN_DIR="$ROOT/codex-runs/$RUN_ID"
PROMPT_DIR="$ROOT/prompts/nightly"
START_COMMIT="$(git rev-parse HEAD)"

mkdir -p "$RUN_DIR"

if [[ ! -d "$PROMPT_DIR" ]]; then
  echo "Prompt directory not found: $PROMPT_DIR" >&2
  exit 1
fi

git switch -c "$BRANCH" || exit 1

cat >"$RUN_DIR/run-info.txt" <<EOF
run_id=$RUN_ID
branch=$BRANCH
start_commit=$START_COMMIT
started_at=$(date -Iseconds)
codex_version=$(codex --version 2>/dev/null)
node_version=$(node --version 2>/dev/null || echo unavailable)
npm_version=$(npm --version 2>/dev/null || echo unavailable)
EOF

run_check() {
  local pass_number="$1"
  local check_name="$2"
  shift 2

  {
    echo "\$ $*"
    "$@"
  } >"$RUN_DIR/pass-$pass_number-$check_name.log" 2>&1
  return $?
}

for prompt_file in "$PROMPT_DIR"/pass-*.txt; do
  pass_name="$(basename "$prompt_file" .txt)"
  pass_number="${pass_name#pass-}"
  pass_number="${pass_number%%-*}"

  echo
  echo "=== $pass_name ==="

  codex \
    --ask-for-approval never \
    --config sandbox_workspace_write.network_access=true \
    exec \
    --sandbox workspace-write \
    --cd "$ROOT" \
    --output-last-message "$RUN_DIR/$pass_name-report.md" \
    - <"$prompt_file" 2>&1 | tee "$RUN_DIR/$pass_name-codex.log"
  codex_status="${PIPESTATUS[0]}"

  lint_status=0
  typecheck_status=0
  build_status=0

  run_check "$pass_number" lint npm run lint || lint_status=$?
  run_check "$pass_number" typecheck npm exec tsc -- -b --pretty false || typecheck_status=$?
  run_check "$pass_number" build npm run build || build_status=$?

  {
    echo "codex=$codex_status"
    echo "lint=$lint_status"
    echo "typecheck=$typecheck_status"
    echo "build=$build_status"
  } >"$RUN_DIR/$pass_name-status.txt"

  git diff --stat >"$RUN_DIR/$pass_name-diff-stat.txt"
  git status --short >"$RUN_DIR/$pass_name-git-status.txt"

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "Codex nightly $pass_name" \
      >"$RUN_DIR/$pass_name-commit.log" 2>&1 || {
        echo "Could not create the checkpoint commit for $pass_name." >&2
        cat "$RUN_DIR/$pass_name-commit.log" >&2
        exit 1
      }
  else
    echo "No repository changes." >"$RUN_DIR/$pass_name-commit.log"
  fi
done

{
  echo "# Codex Nightly Run"
  echo
  echo "- Run: \`$RUN_ID\`"
  echo "- Branch: \`$BRANCH\`"
  echo "- Finished: \`$(date -Iseconds)\`"
  echo
  echo "## Verification"
  echo
  for status_file in "$RUN_DIR"/pass-*-status.txt; do
    echo "### $(basename "$status_file" -status.txt)"
    echo
    echo '```text'
    cat "$status_file"
    echo '```'
    echo
  done
  echo "## Commits"
  echo
  git log --oneline --decorate "$START_COMMIT"..HEAD
} >"$RUN_DIR/SUMMARY.md"

echo
echo "Nightly run complete."
echo "Branch: $BRANCH"
echo "Summary: $RUN_DIR/SUMMARY.md"

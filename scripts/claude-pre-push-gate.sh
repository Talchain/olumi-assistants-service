#!/usr/bin/env bash
# claude-pre-push-gate.sh — Claude Code PreToolUse hook for Bash commands.
# Intercepts `git push` commands and runs pre-push validation.
# Exit 0 = allow, Exit 2 = block (stderr fed back to Claude).
set -euo pipefail

# Read JSON from stdin (Claude Code PreToolUse provides tool_input)
INPUT=$(cat)

# Extract the command using node (avoids jq dependency)
COMMAND=$(node -e "
  try {
    const input = JSON.parse(process.argv[1]);
    console.log(input.tool_input?.command || '');
  } catch { console.log(''); }
" "$INPUT" 2>/dev/null || echo "")

# Only gate git push commands
if echo "$COMMAND" | grep -qE '^\s*(git\s+push|git\s+push\s)'; then
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  SCRIPT="$REPO_ROOT/scripts/pre-push-validate.sh"

  if [[ -x "$SCRIPT" ]]; then
    if bash "$SCRIPT" 2>&1; then
      exit 0
    else
      echo "Pre-push validation failed. Fix the issues above before pushing." >&2
      exit 2
    fi
  else
    echo "Warning: scripts/pre-push-validate.sh not found or not executable." >&2
    exit 0
  fi
fi

# Non-push commands — allow
exit 0

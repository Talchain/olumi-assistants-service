#!/usr/bin/env bash
set -euo pipefail

# Strategy can be: squash | rebase | merge (squash recommended)
STRAT="${1:-squash}"

# Queue auto-merge; GitHub will merge once checks/approvals are green.
gh pr merge --auto --"$STRAT"

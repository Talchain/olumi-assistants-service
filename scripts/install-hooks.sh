#!/usr/bin/env bash
set -euo pipefail

# Install git hooks for olumi-assistants-service.
# Run once after cloning: bash scripts/install-hooks.sh

REPO_ROOT="$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# Detect hook managers — do not fight them
# ---------------------------------------------------------------------------
HOOKS_PATH=$(git config --get core.hooksPath 2>/dev/null || true)
if [ -n "$HOOKS_PATH" ]; then
  echo "[install-hooks] core.hooksPath is set to '$HOOKS_PATH'."
  echo "  A hook manager may be active. Add scripts/validate-prepush.sh to your hook config manually."
  exit 0
fi

if [ -d "$REPO_ROOT/.husky" ]; then
  echo "[install-hooks] .husky/ directory detected — skipping."
  echo "  Add scripts/validate-prepush.sh to your husky pre-push config."
  exit 0
fi

# ---------------------------------------------------------------------------
# Ensure validation script is executable
# ---------------------------------------------------------------------------
chmod +x "$REPO_ROOT/scripts/validate-prepush.sh"

# ---------------------------------------------------------------------------
# Install pre-push hook (idempotent)
# ---------------------------------------------------------------------------
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-push"

if [ -f "$HOOK_PATH" ] && grep -q "validate-prepush" "$HOOK_PATH"; then
  echo "[install-hooks] pre-push hook already installed."
else
  cat > "$HOOK_PATH" << 'HOOK'
#!/usr/bin/env bash
# Delegate to tracked validation script.
# Installed by scripts/install-hooks.sh
exec "$(git rev-parse --show-toplevel)/scripts/validate-prepush.sh" "$@"
HOOK
  chmod +x "$HOOK_PATH"
  echo "[install-hooks] pre-push hook installed at .git/hooks/pre-push"
fi

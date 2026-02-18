#!/usr/bin/env bash
# install-hooks.sh — verify / repair the git pre-push hook setup.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-push"
SCRIPT_PATH="$REPO_ROOT/scripts/pre-push-validate.sh"

echo "Checking git hook setup..."

# Verify the validation script exists and is executable
if [[ ! -x "$SCRIPT_PATH" ]]; then
  echo "Making scripts/pre-push-validate.sh executable..."
  chmod +x "$SCRIPT_PATH"
fi

# Check if pre-push hook exists
if [[ -f "$HOOK_PATH" ]]; then
  # Verify it references our validation script
  if grep -q "pre-push-validate.sh" "$HOOK_PATH"; then
    echo "✓ pre-push hook is installed and references pre-push-validate.sh"
  else
    echo "⚠ pre-push hook exists but does not reference pre-push-validate.sh"
    echo "  Backing up existing hook to $HOOK_PATH.bak"
    cp "$HOOK_PATH" "$HOOK_PATH.bak"
    install_hook=1
  fi
else
  install_hook=1
fi

if [[ "${install_hook:-0}" == "1" ]]; then
  cat > "$HOOK_PATH" << 'HOOK'
#!/usr/bin/env bash
# Git pre-push hook — runs pre-push-validate.sh before every push.
# Passes stdin (push refs) through so the branch guard can inspect push targets.

STDIN_DATA=$(cat)
export PRE_PUSH_STDIN="$STDIN_DATA"
exec bash "$(git rev-parse --show-toplevel)/scripts/pre-push-validate.sh"
HOOK
  chmod +x "$HOOK_PATH"
  echo "✓ pre-push hook installed"
fi

# Verify
if [[ -x "$HOOK_PATH" ]]; then
  echo "✓ Hook is executable"
else
  echo "✗ Hook is not executable — fixing..."
  chmod +x "$HOOK_PATH"
fi

echo ""
echo "Setup complete. The pre-push hook will run scripts/pre-push-validate.sh before every push."

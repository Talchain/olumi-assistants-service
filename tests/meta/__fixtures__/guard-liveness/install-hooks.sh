#!/usr/bin/env bash
# FIXTURE — positive control for guard-liveness.test.ts. Not executed.
#
# Reproduces the real installer's shape: the guard it installs is never named
# in COMMAND position. `chmod +x` is not an invocation and the `exec` line is
# inside a heredoc that WRITES a hook file rather than running anything. A
# command-position-only matcher reads this file as installing nothing, which is
# exactly how the first version of this guard reported ZERO hook-only orphans.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
chmod +x "$REPO_ROOT/scripts/fixture-prepush-guard.sh"
cat > "$(git rev-parse --git-path hooks)/pre-push" << 'HOOK'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/fixture-prepush-guard.sh" "$@"
HOOK

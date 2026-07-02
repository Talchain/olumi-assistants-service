#!/usr/bin/env bash
#
# Golden-Journey advisory replay gate (C5 PR2A).
#
# Runs the committed golden-journey fixtures through the harness CLI in
# deterministic REPLAY mode (no network, no service, no secrets) and asserts
# each fixture's exit code against the SINGLE SOURCE OF TRUTH manifest
# `tools/golden-journey-harness/replay-manifest.json` — the same file the
# required unit test (tests/unit/golden-journey-harness/replay-fixtures.test.ts)
# consumes. Neither re-encodes the expected exits.
#
# ADVISORY: this script is not wired into any required CI job here. PR2B should
# reconcile the T2 advisory workflow (.github/workflows/golden-journey-replay.yml)
# to call THIS script instead of inlining its own fixture list, then flip it to
# required. Until then, run it by hand / in the advisory workflow.
#
# Exit codes (this gate): 0 = every fixture matched its pinned exit AND the
# fail-closed self-test passed; 1 = a mismatch (a RED fixture went green, a
# green fixture went red, or a harness crash) or a self-test failure.
#
# Harness CLI exit codes (index.ts): 0 = no gating fail, 1 = >=1 gating fail,
# 2 = fatal (malformed fixture — fail closed), 3 = auth/preflight/deploy halt.
#
# Determinism + no local-only state: paths are derived from this script's
# location (repo-relative); temp output uses `mktemp -d`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HARNESS="${REPO_ROOT}/tools/golden-journey-harness"
MANIFEST="${HARNESS}/replay-manifest.json"
CLI="${HARNESS}/index.ts"
FIXTURES="${HARNESS}/fixtures"

if [ ! -f "${MANIFEST}" ]; then
  echo "FATAL: manifest not found at ${MANIFEST}" >&2
  exit 1
fi

OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gj-replay-gate.XXXXXX")"
trap 'rm -rf "${OUT_DIR}"' EXIT

# Run one fixture and compare its actual CLI exit to the expected exit.
run_fixture() {
  local file="$1" expected="$2" actual
  echo "::group::${file} (expect exit ${expected})"
  set +e
  pnpm tsx "${CLI}" --replay "${FIXTURES}/${file}.json" --out "${OUT_DIR}/${file}-report.md"
  actual=$?
  set -e
  echo "  ${file}: exit=${actual} expected=${expected}"
  echo "::endgroup::"
  if [ "${actual}" -ne "${expected}" ]; then
    echo "::error::${file}: replay exit ${actual}, expected ${expected} (a pinned RED fixture may have flipped, or the harness crashed)"
    return 1
  fi
  return 0
}

status=0

echo "== golden-journey replay gate (advisory) =="
echo "manifest: ${MANIFEST}"

# Emit "<file> <expected_exit>" lines from the shared manifest with node (no jq
# dependency), then drive the gate from them. `while read` runs in this shell
# (process substitution) so `status` mutations survive the loop.
while read -r file expected; do
  [ -z "${file}" ] && continue
  run_fixture "${file}" "${expected}" || status=1
done < <(node -e '
  const fs = require("node:fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(m.fixtures) || m.fixtures.length === 0) {
    console.error("manifest has no fixtures[]"); process.exit(1);
  }
  for (const f of m.fixtures) {
    if (typeof f.file !== "string" || (f.expected_exit !== 0 && f.expected_exit !== 1)) {
      console.error("malformed manifest entry: " + JSON.stringify(f)); process.exit(1);
    }
    console.log(f.file + " " + f.expected_exit);
  }
' "${MANIFEST}")

# Fail-closed self-test: a structurally broken fixture must exit NON-zero
# (the harness returns 2 on a malformed shape). If any of these ever exits 0,
# the fail-closed guarantee has regressed and the gate must go red.
echo "::group::fail-closed self-test (malformed fixtures must exit non-zero)"
selftest_status=0
selftest_one() {
  local name="$1" json="$2" actual
  printf '%s' "${json}" > "${OUT_DIR}/${name}.json"
  set +e
  pnpm tsx "${CLI}" --replay "${OUT_DIR}/${name}.json" --out "${OUT_DIR}/${name}-report.md" >/dev/null 2>&1
  actual=$?
  set -e
  if [ "${actual}" -eq 0 ]; then
    echo "::error::fail-closed self-test '${name}' exited 0 — a malformed fixture must fail non-successfully"
    selftest_status=1
  else
    echo "  ${name}: exit=${actual} (non-zero, fail-closed OK)"
  fi
}
selftest_one "missing-observations" '{"transcript":{}}'
selftest_one "renamed-observations" '{"transcript":{"observation":[{"step":"1","http_status":200,"body":{}}]}}'
selftest_one "non-array-observations" '{"transcript":{"observations":"nope"}}'
selftest_one "empty-observations" '{"transcript":{"observations":[]}}'
selftest_one "not-json" 'this is not json'
echo "::endgroup::"
[ "${selftest_status}" -ne 0 ] && status=1

if [ "${status}" -eq 0 ]; then
  echo "PASS: all pinned fixtures matched and the fail-closed self-test held."
else
  echo "FAIL: see ::error:: lines above."
fi
exit "${status}"

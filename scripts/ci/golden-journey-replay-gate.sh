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

# Run one fixture and compare its actual CLI exit to the expected exit, and —
# when the manifest pins a failing-invariant set (third field != "-") — compare
# the actual failing set from the machine-readable --json-summary. The set
# comparison closes the mixed-invariant masking hole: on a RED fixture failing
# A8+A10+A11, an A10/A11 classifier that silently stops failing keeps exit=1
# (via A8) and is invisible to the exit code alone.
# Third field encoding from the manifest emitter:
#   "-"            no pinned set (legacy exit-code-only entry)
#   "="            pinned EMPTY set (fixture must have zero failing invariants)
#   "=A,B,C"       pinned set (sorted, comma-joined)
run_fixture() {
  local file="$1" expected="$2" expected_set="$3" actual csv
  echo "::group::${file} (expect exit ${expected}${expected_set:+, set ${expected_set}})"
  set +e
  pnpm tsx "${CLI}" --replay "${FIXTURES}/${file}.json" \
    --out "${OUT_DIR}/${file}-report.md" \
    --json-summary "${OUT_DIR}/${file}-summary.json"
  actual=$?
  set -e
  echo "  ${file}: exit=${actual} expected=${expected}"
  echo "::endgroup::"
  if [ "${actual}" -ne "${expected}" ]; then
    echo "::error::${file}: replay exit ${actual}, expected ${expected} (a pinned RED fixture may have flipped, or the harness crashed)"
    return 1
  fi
  if [ "${expected_set}" != "-" ]; then
    csv="${expected_set#=}"
    if ! node -e '
      const fs = require("node:fs");
      const [summaryPath, expectedCsv, file] = process.argv.slice(1);
      let actual;
      try {
        actual = JSON.parse(fs.readFileSync(summaryPath, "utf8")).failing_invariants;
      } catch (err) {
        console.error(`${file}: could not read --json-summary output (${err.message}) — treating as gate failure (fail closed)`);
        process.exit(1);
      }
      if (!Array.isArray(actual)) {
        console.error(`${file}: summary failing_invariants is not an array — fail closed`);
        process.exit(1);
      }
      const exp = expectedCsv === "" ? [] : expectedCsv.split(",");
      const a = [...actual].sort().join(",");
      const e = [...exp].sort().join(",");
      if (a !== e) {
        console.error(
          `${file}: failing invariants [${a}] != pinned [${e}] — a pinned invariant that STOPPED failing ` +
          `means a classifier silently regressed while the exit code stayed the same; a NEW one means the ` +
          `fixture surfaced a new defect. Re-capture with --json-summary and update replay-manifest.json deliberately.`
        );
        process.exit(1);
      }
    ' "${OUT_DIR}/${file}-summary.json" "${csv}" "${file}"; then
      echo "::error::${file}: failing-invariant set mismatch (see line above)"
      return 1
    fi
    echo "  ${file}: failing-invariant set matched [${csv}]"
  fi
  return 0
}

status=0

echo "== golden-journey replay gate (advisory) =="
echo "manifest: ${MANIFEST}"

# Emit "<file> <expected_exit> <set>" lines from the shared manifest with node
# (no jq dependency), then drive the gate from them. `while read` runs in this
# shell (process substitution) so `status` mutations survive the loop.
# Set encoding: "-" = no pinned set; "=" = pinned empty; "=A,B,C" = pinned set.
# The emitter also enforces the manifest-integrity guards out-of-process
# (mirroring the required unit test) so the advisory workflow is self-sufficient:
#   - fixture population must not shrink below the known floor (5);
#   - at least one fixture must be pinned RED (a gate with an all-green
#     manifest measures nothing).
while read -r file expected expected_set; do
  [ -z "${file}" ] && continue
  run_fixture "${file}" "${expected}" "${expected_set}" || status=1
done < <(node -e '
  const fs = require("node:fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(m.fixtures) || m.fixtures.length === 0) {
    console.error("manifest has no fixtures[]"); process.exit(1);
  }
  if (m.fixtures.length < 5) {
    console.error("manifest-integrity: fixture population shrank below the known floor (5) — shrinking the pinned population needs review");
    process.exit(1);
  }
  if (!m.fixtures.some((f) => f.expected_exit === 1)) {
    console.error("manifest-integrity: no pinned-RED fixture left — an all-green manifest measures nothing");
    process.exit(1);
  }
  for (const f of m.fixtures) {
    if (typeof f.file !== "string" || (f.expected_exit !== 0 && f.expected_exit !== 1)) {
      console.error("malformed manifest entry: " + JSON.stringify(f)); process.exit(1);
    }
    let set = "-";
    if (f.expected_failing_invariants !== undefined) {
      if (!Array.isArray(f.expected_failing_invariants) || !f.expected_failing_invariants.every((x) => typeof x === "string" && /^[A-Za-z0-9]+$/.test(x))) {
        console.error("malformed expected_failing_invariants: " + JSON.stringify(f)); process.exit(1);
      }
      set = "=" + [...f.expected_failing_invariants].sort().join(",");
    }
    console.log(f.file + " " + f.expected_exit + " " + set);
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

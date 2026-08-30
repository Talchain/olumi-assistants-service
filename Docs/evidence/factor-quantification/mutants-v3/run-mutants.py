import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ARTIFACT = Path(__file__).resolve().parent
WORKTREE = Path("/Users/paulslee/CodexWork/factor-quantification/mutants-v3-cee")
ROOT = Path("/Users/paulslee/CodexWork/factor-quantification/cee")
HEAD = "fc358ca02bf11e64020b0de230c25334cb4763b3"
TEST_FILE = "src/cee/factor-quantification/__tests__/dispatch.test.ts"
TARGET = "commits the supported missing point with uncertainty while preserving the stated value"
sha = lambda value: hashlib.sha256(value).hexdigest()
def git(*args, cwd=WORKTREE):
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()
assert git("rev-parse", "HEAD") == HEAD
assert git("status", "--porcelain=v1") == ""

mutants = [
    {
        "id": "remove_estimator_output", "expected": "failed",
        "file": "src/cee/factor-quantification/index.ts",
        "old": "result.kind === 'ok' ? result.estimates : []",
        "new": "[]",
        "purpose": "Discard the parsed estimator response before canonical adoption; model invocation remains intact.",
    },
    {
        "id": "drop_estimate_standard_deviation", "expected": "failed",
        "file": "src/cee/factor-quantification/adopt.ts",
        "old": "value: estimate.value, std: estimate.std, source: 'cee_inference', reasoning,",
        "new": "value: estimate.value, source: 'cee_inference', reasoning,",
        "purpose": "Remove uncertainty from the adopted point while retaining value, provenance and reasoning.",
    },
    {
        "id": "drop_estimate_provenance", "expected": "failed",
        "file": "src/cee/factor-quantification/adopt.ts",
        "old": "value: estimate.value, std: estimate.std, source: 'cee_inference', reasoning,",
        "new": "value: estimate.value, std: estimate.std, reasoning,",
        "purpose": "Remove the adopted point's AI source stamp while retaining value, uncertainty and reasoning.",
    },
    {
        "id": "unrelated_gap_description", "expected": "passed",
        "file": "src/cee/factor-quantification/select.ts",
        "old": "reason: " + chr(96) + "Required baseline for $" + "{requirement.operation}",
        "new": "reason: " + chr(96) + "Analysis baseline for $" + "{requirement.operation}",
        "purpose": "Change only the nonnumeric descriptive wording in the requested gap prompt; identities and computation stay unchanged.",
    },
]
paths = {item["file"] for item in mutants} | {TEST_FILE}
original = {path: (WORKTREE / path).read_bytes() for path in paths}
root_before = {path: sha((ROOT / path).read_bytes()) for path in paths}
report = {
    "scope": "deterministic existing records-dispatch test with mocked LLM and in-memory storage; no live provider, PLoT or ISL call",
    "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "head": HEAD, "isolated_worktree": str(WORKTREE), "artifact_directory": str(ARTIFACT),
    "target_test_file": TEST_FILE, "target_leaf_name": TARGET,
    "source_sha256": {path: sha(content) for path, content in sorted(original.items())},
    "root_source_sha256_before": root_before,
    "dependency_policy": {"node_modules": "symlink to root dependencies, no install or dependency mutation", "vitest_cache": False, "config_loader": "runner"},
    "max_vitest_workers": 2, "runs": [],
}
def save():
    (ARTIFACT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
def run(run_id, expected):
    run_file = ARTIFACT / (run_id + ".vitest.json")
    command = ["/usr/local/bin/node", "node_modules/vitest/vitest.mjs", "run", TEST_FILE,
               "--testNamePattern", TARGET + "$", "--maxWorkers", "2",
               "--no-file-parallelism", "--no-cache", "--configLoader", "runner",
               "--reporter=json", "--outputFile", str(run_file)]
    env = os.environ.copy()
    env.update({"LOG_LEVEL": "fatal", "NO_COLOR": "1", "FORCE_COLOR": "0"})
    started = time.monotonic()
    result = subprocess.run(command, cwd=WORKTREE, env=env, text=True, capture_output=True, timeout=120)
    (ARTIFACT / (run_id + ".stdout.txt")).write_text(result.stdout)
    (ARTIFACT / (run_id + ".stderr.txt")).write_text(result.stderr)
    data = json.loads(run_file.read_text())
    assertions = [a for f in data.get("testResults", []) for a in f.get("assertionResults", [])]
    selected = [a for a in assertions if a.get("title") == TARGET]
    executed = [a for a in assertions if a.get("status") not in ("pending", "skipped", "todo")]
    item = {
        "id": run_id, "expected_target_status": expected, "exit_code": result.returncode,
        "duration_seconds": round(time.monotonic() - started, 3), "command": command,
        "num_total_tests_reported": data.get("numTotalTests"), "num_passed_tests": data.get("numPassedTests"),
        "num_failed_tests": data.get("numFailedTests"), "num_pending_tests": data.get("numPendingTests"),
        "assertions_collected": len(assertions), "matching_target_count": len(selected),
        "executed_assertion_count": len(executed),
        "target": [{key: a.get(key) for key in ("fullName", "title", "status", "failureMessages", "duration")} for a in selected],
        "raw_vitest_report": str(run_file),
    }
    item["control_passed"] = (len(selected) == 1 and len(executed) == 1
        and selected[0]["status"] == expected
        and result.returncode == (0 if expected == "passed" else 1))
    report["runs"].append(item)
    save()
    print(json.dumps({"id": run_id, "target_status": selected[0]["status"] if len(selected) == 1 else "wrong_collection",
                      "matching_target_count": len(selected), "executed_assertions": len(executed),
                      "control_passed": item["control_passed"]}), flush=True)
    assert item["control_passed"], "The target did not discriminate as expected; inspect saved artifacts."

try:
    run("base", "passed")
    for mutant in mutants:
        path = mutant["file"]
        old = original[path].decode()
        assert old.count(mutant["old"]) == 1, "Mutation must match exactly once"
        new = old.replace(mutant["old"], mutant["new"], 1)
        (ARTIFACT / (mutant["id"] + ".patch")).write_text("".join(difflib.unified_diff(
            old.splitlines(keepends=True), new.splitlines(keepends=True),
            fromfile="a/" + path, tofile="b/" + path)))
        mutant["before_sha256"] = sha(original[path])
        mutant["mutated_sha256"] = sha(new.encode())
        report.setdefault("mutants", []).append(mutant)
        try:
            (WORKTREE / path).write_text(new)
            run(mutant["id"], mutant["expected"])
        finally:
            (WORKTREE / path).write_bytes(original[path])
            assert (WORKTREE / path).read_bytes() == original[path]
    report["all_controls_passed"] = all(item["control_passed"] for item in report["runs"])
finally:
    for path, content in original.items():
        (WORKTREE / path).write_bytes(content)
    report["worktree_status_after_restore"] = git("status", "--porcelain=v1")
    report["head_after"] = git("rev-parse", "HEAD")
    report["root_source_sha256_after"] = {path: sha((ROOT / path).read_bytes()) for path in paths}
    report["root_source_unchanged"] = report["root_source_sha256_after"] == root_before
    report["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()


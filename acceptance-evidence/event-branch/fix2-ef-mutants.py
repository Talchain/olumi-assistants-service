"""FIX2 E/F single-claim mutants; restore source bytes after every run."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "acceptance-evidence/event-branch"
TEST = "src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-attribution.test.ts"
ATTRIBUTION = "src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts"
CARD = "src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts"
STATE = "src/orchestrator-v5/agent-lane/actions/state.ts"
SIGNALS = "src/orchestrator-v5/agent-lane/turn-context/guidance-signals.ts"
MUTANTS = [
    ("E-reader-warrant-off", ATTRIBUTION,
     "    if (basisText === undefined) return [];",
     "    // MUTANT: count an occurrence without a readable warrant.", "E r1 #7"),
    ("E-card-warrant-off", CARD,
     "    if (!basis) return 'May happen; its likelihood still needs a basis.';",
     "    // MUTANT: display an unwarranted occurrence.", "E basis-less occurrence card"),
    ("F-attribution-event-roots-off", ATTRIBUTION,
     "    goalPathEventRootIds: goalChanceEstimateLikelihoods(analysed, goalId).map(l => l.id),",
     "    goalPathEventRootIds: [],", "F r1 #6"),
    ("F-check-estimates-event-roots-off", STATE,
     "      goalPathEventRootIds: likelihoods.map(l => l.id),",
     "      goalPathEventRootIds: [],", "F Check estimates"),
    ("F-shared-path-event-roots-off", SIGNALS,
     "  roots.push(...(i.goalPathEventRootIds ?? []).filter(id => byId.get(id)?.kind === 'risk')",
     "  roots.push(...([] as string[]).filter(id => byId.get(id)?.kind === 'risk')", "F r1 #6"),
]
results = []
for name, relative, old, new, test_name in MUTANTS:
    source = ROOT / relative
    original = source.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        raise RuntimeError(f"{name}: expected one mutation site")
    try:
        source.write_text(text.replace(old, new))
        log = EVIDENCE / f"fix2-ef-mutant-{name}.log"
        command = (
            'node -e "process.exit(require(\'os\').loadavg()[0] < 25 ? 0 : 1)" && '
            f"node_modules/.bin/vitest run {TEST} --maxWorkers=1 --configLoader=runner "
            f"-t '{test_name}' < /dev/null"
        )
        with log.open("w") as output:
            completed = subprocess.run(command, shell=True, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        observed = log.read_text()
        killed = completed.returncode == 1 and "FAIL " in observed and "AssertionError" in observed
        result = {"mutant": name, "source": relative, "row": test_name,
                  "exit_code": completed.returncode, "killed": killed, "log": log.name}
        results.append(result)
        print(json.dumps(result), flush=True)
        if not killed:
            raise RuntimeError(f"{name}: no failing assertion witnessed (including load-gate holds)")
    finally:
        source.write_bytes(original)
(EVIDENCE / "fix2-ef-mutants.json").write_text(json.dumps(results, indent=2) + "\n")

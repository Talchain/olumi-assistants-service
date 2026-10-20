import json, pathlib, subprocess
root = pathlib.Path.cwd()
specs = [
    'src/orchestrator-v5/path-b/tools/__tests__/draft-empty-scenario.route.test.ts',
    'src/orchestrator-v5/path-b/tools/__tests__/candidate-to-graph.test.ts',
    'src/orchestrator-v5/path-b/tools/__tests__/draft-tool.test.ts',
    'src/orchestrator-v5/path-b/tools/__tests__/core-one-voice.route.test.ts',
    'tests/contract/context-summary-diagnostic-only.guard.test.ts',
    'tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts',
    'tests/contract/run-delta-pack-parity.guard.test.ts',
    'tests/contract/run-delta-prior-facts-no-default.guard.test.ts',
    'tests/contract/tier3-leak-guard.runtime.test.ts',
    'tests/contract/tier3-leak-guard.static.guard.test.ts',
    'src/orchestrator-v5/graph-management/__tests__/threshold-source-j2.test.ts',
]
results = []
for spec in specs:
    log_path = root / f'recovery-notes/L27B-{pathlib.Path(spec).name}.log'
    with log_path.open('w') as log:
        result = subprocess.run(['npx', 'vitest', 'run', spec], stdout=log, stderr=subprocess.STDOUT)
    row = {'file': spec, 'exit': result.returncode}
    results.append(row)
    print(json.dumps(row), flush=True)
(root / 'recovery-notes/L27B-check-specs.json').write_text(json.dumps(results, indent=2))
assert all(r['exit'] == 0 for r in results)

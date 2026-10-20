import json, pathlib, subprocess
root = pathlib.Path.cwd()
source = root / 'src/orchestrator-v5/path-b/tools/candidate-to-graph.ts'
spec = 'src/orchestrator-v5/path-b/tools/__tests__/draft-empty-scenario.route.test.ts'
good = source.read_text()
results = []
try:
    for name, replacement in [('stamp-removed', '{}'), ('stamp-overcredited', "{ threshold_source: 'user' }")]:
        mutant = good.replace("{ threshold_source: 'brief_extraction' }", replacement)
        assert mutant != good
        source.write_text(mutant)
        with (root / f'recovery-notes/L27B-{name}.log').open('w') as log:
            result = subprocess.run(['npx', 'vitest', 'run', spec, '-t', 'L27'], stdout=log, stderr=subprocess.STDOUT)
        results.append({'mutant': name, 'exit': result.returncode})
finally:
    source.write_text(good)
(root / 'recovery-notes/L27B-mutants.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results))
assert all(r['exit'] == 1 for r in results)

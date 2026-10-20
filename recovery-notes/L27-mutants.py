import json, pathlib, subprocess
root = pathlib.Path.cwd()
source = root / 'src/orchestrator-v5/path-b/tools/candidate-to-graph.ts'
spec = 'src/orchestrator-v5/path-b/tools/__tests__/draft-empty-scenario.route.test.ts'
good = source.read_text()
results = []
def run(name, content):
    source.write_text(content)
    with (root / f'recovery-notes/L27-{name}.log').open('w') as log:
        result = subprocess.run(['npx', 'vitest', 'run', spec, '-t', 'L27'], stdout=log, stderr=subprocess.STDOUT)
    results.append({'name': name, 'exit': result.returncode})
try:
    mutants = [
        ('stamp-removed', good.replace("threshold_source: 'user', success_threshold", "success_threshold").replace("{ threshold_source: 'cee_inference' }", "{}")),
        ('stamp-overcredited', good.replace("threshold && targetWho === 'user'", "threshold")),
        ('user-binding-removed', good.replace(", success_threshold: aGoal!.goal_threshold_raw", "")),
        ('user-binding-normalised', good.replace("success_threshold: aGoal!.goal_threshold_raw", "success_threshold: aGoal!.goal_threshold")),
        ('factor-type-removed', good.replace("...(isTwoStateSource([], undefined, f.unit) ? { factor_type: 'boolean' } : {}),", "")),
        ('factor-type-from-endpoints', good.replace("isTwoStateSource([], undefined, f.unit)", "true")),
    ]
    for name, content in mutants:
        assert content != good, name
        run(name, content)
finally:
    source.write_text(good)
(root / 'recovery-notes/L27-mutants.json').write_text(json.dumps(results, indent=2))

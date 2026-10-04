"""Sequential, temporary source mutants through the resident Vitest runner; restores the candidate."""
from pathlib import Path
import subprocess, json, hashlib

out = Path(__file__).parent
candidate = out / 'candidate'
leaf = candidate / 'src/orchestrator-v5/agent-lane/tipping-point-coaching.ts'
original = leaf.read_text()
runtime = '/Users/paulslee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
runner = '/Users/paulslee/.codex/worktrees/core-capacity-intervention-20260919/node_modules/vitest/vitest.mjs'
mutants = [
    ('wrong-factor', 'return { ...binding, action: {', "return { ...binding, factor_id: 'monthly_churn', action: {"),
    ('wrong-threshold', 'reply: fact.say,', "reply: fact.say.replace('55.76', '56'),"),
    ('wrong-direction', 'reply: fact.say,', "reply: fact.say.replace('rises above', 'falls below'),"),
    ('old-run-reuse', '.update(JSON.stringify(binding))', '.update(JSON.stringify({ factor_id: binding.factor_id }))'),
    ('label-only-binding', '.update(JSON.stringify(binding))', '.update(JSON.stringify({ run_key: binding.run_key, label: plan.fact.label }))'),
    ('silent-value-payload', 'label: `Refine ${plan.fact.label}`,', 'label: `Refine ${plan.fact.label}`, value: 56,'),
]
results = []
try:
    for name, before, after in mutants:
        assert original.count(before) == 1, name
        leaf.write_text(original.replace(before, after))
        report = out / f'mutant-{name}.json'
        with (out / f'mutant-{name}.log').open('w') as log:
            proc = subprocess.run([runtime, runner, 'run', '--config', 'vitest.focused.config.mjs',
                '--reporter=json', f'--outputFile={report}'], cwd=candidate, stdout=log, stderr=subprocess.STDOUT, timeout=40)
        data = json.loads(report.read_text())
        failed = [a['fullName'] for t in data['testResults'] for a in t.get('assertionResults', []) if a['status'] == 'failed']
        entry = {'name': name, 'exit_code': proc.returncode, 'tests': data['numTotalTests'],
            'failed_tests': data['numFailedTests'], 'killed_by_assertions': bool(failed), 'failed_assertions': failed}
        results.append(entry)
        print(name, 'KILLED' if failed else 'NOT_KILLED', len(failed), flush=True)
finally:
    leaf.write_text(original)
    (out / 'MUTANTS.json').write_text(json.dumps({'restored_leaf_sha256': hashlib.sha256(leaf.read_bytes()).hexdigest(), 'results': results}, indent=2) + '\n')

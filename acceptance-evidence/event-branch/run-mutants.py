#!/usr/bin/env python3
"""One semantic mutant at a time, restoring the working source even on failure."""
import json
from pathlib import Path
import subprocess

tree = Path(__file__).resolve().parents[2]
source = tree / 'src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts'
out = tree / 'acceptance-evidence/event-branch'
original = source.read_text()
mutants = [
    ('basis-gate-off', "o.basis_text.trim() === ''", 'false', 'basis-less Olumi occurrence'),
    ('relative-half-spread', 'const low = p / (2 - p);\n  const high = 2 * p / (1 + p);',
     'const low = p * 0.5;\n  const high = Math.min(1, p * 1.5);', '90.*widens'),
    ('user-wins-off', 'const occurrence = user ?? olumi;', 'const occurrence = olumi ?? user;', 'user likelihood and'),
    ('probability-whitespace-off', r'/\s+(?:probability|likelihood|chance)\s*$/i',
     r'/\s+(?:probability|likelihood|chance)$/i', 'trailing whitespace'),
]
rows = []
try:
    for name, before, after, pattern in mutants:
        assert original.count(before) == 1, (name, original.count(before))
        source.write_text(original.replace(before, after))
        gate = subprocess.run(['node', '-e', "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"], cwd=tree)
        if gate.returncode:
            raise RuntimeError('Load gate rejected mutant; no test started')
        log = out / f'mutant-{name}.log'
        with open('/dev/null', 'rb') as stdin, log.open('w') as stdout:
            result = subprocess.run([str(tree / 'node_modules/.bin/vitest'), 'run',
                'src/orchestrator-v5/agent-lane/__tests__/olumi-event-risk-admission.test.ts',
                '-t', pattern, '--maxWorkers=1', '--configLoader=runner'],
                cwd=tree, stdin=stdin, stdout=stdout, stderr=subprocess.STDOUT)
        text = log.read_text()
        killed = result.returncode == 1 and 'AssertionError' in text and 'failed' in text
        rows.append({'name': name, 'test_pattern': pattern, 'exit_code': result.returncode,
                     'killed_by_assertion': killed, 'evidence': log.name})
        source.write_text(original)
finally:
    source.write_text(original)
    (out / 'mutants.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows))
if len(rows) != len(mutants) or not all(row['killed_by_assertion'] for row in rows):
    raise SystemExit(1)

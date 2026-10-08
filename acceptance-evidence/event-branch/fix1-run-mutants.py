#!/usr/bin/env python3
"""Mutate one FIX-1 behavior at a time; always restore the uncommitted source."""
import json
from pathlib import Path
import shlex
import subprocess

tree = Path(__file__).resolve().parents[2]
source = tree / 'src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts'
out = tree / 'acceptance-evidence/event-branch'
original = source.read_text()
interim = "reason: `You said ‘${quoted}’ for ‘${r.label}’; it isn't used as its likelihood yet.`"
mutants = [
    ('interim-applies-occurrence',
     'const olumi = !quoted && !incoming.has(key(r.label)) ? admitOlumiOccurrence(r.occurrence) : undefined;',
     'const olumi = !incoming.has(key(r.label)) ? admitOlumiOccurrence(r.occurrence) : undefined;',
     'a user hedge also withholds'),
    ('interim-misattributed-to-olumi', interim,
     "reason: `Olumi had drafted ‘${r.label} probability’ = 10% without a basis, so it isn't used.`",
     '5b50b4c8 hedge'),
    ('chance-clause-always-on', interim,
     "reason: `You said ‘${quoted}’ for ‘${r.label}’; it isn't used as its likelihood yet, so the chance doesn't include this risk yet.`",
     '5b50b4c8 hedge'),
]
rows = []
try:
    for name, before, after, pattern in mutants:
        assert original.count(before) == 1, (name, original.count(before))
        source.write_text(original.replace(before, after))
        log = out / f'fix1-mutant-{name}.log'
        command = ('node -e "process.exit(require(\'os\').loadavg()[0] < 25 ? 0 : 1)" && '
                   'pnpm exec vitest run src/orchestrator-v5/agent-lane/__tests__/olumi-event-risk-admission.test.ts '
                   f'-t {shlex.quote(pattern)} --maxWorkers=1 --fileParallelism=false --configLoader=runner </dev/null')
        with log.open('w') as stdout:
            result = subprocess.run(['zsh', '-c', command], cwd=tree, stdout=stdout, stderr=subprocess.STDOUT)
        evidence = log.read_text()
        killed = result.returncode == 1 and 'AssertionError' in evidence and '1 failed' in evidence
        rows.append({'name': name, 'test_pattern': pattern, 'exit_code': result.returncode,
                     'killed_by_assertion': killed, 'evidence': log.name})
        source.write_text(original)
finally:
    source.write_text(original)
    (out / 'fix1-mutants.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2))
if len(rows) != len(mutants) or not all(row['killed_by_assertion'] for row in rows):
    raise SystemExit(1)

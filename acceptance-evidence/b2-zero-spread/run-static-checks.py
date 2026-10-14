"""Record full TypeScript diagnostics and lint the changed TypeScript files."""
import json
import os
from pathlib import Path
import shlex
import subprocess

evidence = Path(__file__).resolve().parent
root = evidence.parents[1]
changed = [
    'src/orchestrator-v5/goal-target/goal-chance-licence.ts',
    'src/orchestrator-v5/goal-target/goal-chance-range-agent.ts',
    'src/orchestrator-v5/goal-target/zero-spread-horizon-line.ts',
    'src/routes/canonical-analysis-view.ts',
    'src/routes/__tests__/b2-zero-spread.test.ts',
]
records = []
for label, argv in [
    ('tsc-full', ['node_modules/.bin/tsc', '--noEmit']),
    ('eslint-changed', ['node_modules/.bin/eslint', *changed]),
]:
    gate = subprocess.run(['node', '-e', "const load=require('os').loadavg()[0];console.log(JSON.stringify({load,threshold:25}));process.exit(Number.isFinite(load)&&load<25?0:1)"],
                          cwd=root, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    record = {'label': label, 'gate_exit': gate.returncode, 'gate_output': gate.stdout.strip(),
              'command': ('NODE_OPTIONS=--max-old-space-size=8192 ' if label == 'tsc-full' else '')
                         + shlex.join(argv) + ' < /dev/null'}
    log = evidence / f'{label}.log'
    if gate.returncode != 0:
        record['exit_code'] = None
        log.write_text(gate.stdout + gate.stderr + 'Load gate refused; check not run.\n')
    else:
        env = {**os.environ, 'NO_COLOR': '1'}
        if label == 'tsc-full':
            env['NODE_OPTIONS'] = '--max-old-space-size=8192'
        with log.open('w') as output:
            result = subprocess.run(argv, cwd=root, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT, env=env)
        record['exit_code'] = result.returncode
        diagnostics = log.read_text().splitlines()
        if label == 'tsc-full':
            record['diagnostic_count'] = sum('error TS' in line for line in diagnostics)
            record['changed_file_diagnostics'] = [line for line in diagnostics
                                                  if any(line.startswith(path + '(') for path in changed)]
        else:
            record['output'] = '\n'.join(diagnostics)
    records.append(record)
    (evidence / 'static-checks.json').write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps(record), flush=True)

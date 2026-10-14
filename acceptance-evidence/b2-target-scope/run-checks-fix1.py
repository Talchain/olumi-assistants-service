"""Run each FIX1 test batch only after the exit-code load gate passes."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
evidence = Path(__file__).resolve().parent
label, *files = sys.argv[1:]
assert 1 <= len(files) <= 2, files
assert all(f.endswith('.test.ts') for f in files), files
gate = ['node', '-e', "const load = require('os').loadavg()[0]; console.log(JSON.stringify({load, threshold:25})); process.exit(load < 25 ? 0 : 1)"]
checked = subprocess.run(gate, cwd=root, capture_output=True, text=True, stdin=subprocess.DEVNULL)
record = {'label': label, 'files': files, 'gate_exit': checked.returncode, 'gate_output': checked.stdout.strip()}
log = evidence / f'{label}.log'
if checked.returncode != 0:
    record['test_exit'] = None
    log.write_text(checked.stdout + checked.stderr + 'Load gate refused; tests not run.\n')
else:
    argv = ['node_modules/.bin/vitest', 'run', *files, '--maxWorkers=1', '--no-file-parallelism', '--configLoader=runner']
    command = shlex.join(argv) + ' < /dev/null'
    record['command'] = command
    with log.open('w') as output:
        output.write('Load gate exit: 0\n' + checked.stdout + command + '\n')
        output.flush()
        result = subprocess.run(command, shell=True, cwd=root, stdout=output, stderr=subprocess.STDOUT, env={**os.environ, 'NO_COLOR': '1'})
    record['test_exit'] = result.returncode
with (evidence / 'checks-fix1.jsonl').open('a') as output:
    output.write(json.dumps(record) + '\n')
print(json.dumps(record))
lines = log.read_text().splitlines()
print('\n'.join(lines[-35:] if record['test_exit'] != 0 else [line for line in lines if line.strip().startswith(('Test Files', 'Tests ', 'Duration'))]))
sys.exit(record['test_exit'] if record['test_exit'] is not None else checked.returncode)

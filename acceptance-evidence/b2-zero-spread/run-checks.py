"""Gate each test batch on load; no more than two files and one worker."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('label')
parser.add_argument('files', nargs='+')
parser.add_argument('--select')
args = parser.parse_args()
assert 1 <= len(args.files) <= 2, args.files
assert all(f.endswith('.test.ts') for f in args.files), args.files
evidence = Path(__file__).resolve().parent
root = evidence.parents[1]
gate = ['node', '-e', "const load = require('os').loadavg()[0]; console.log(JSON.stringify({load, threshold:25})); process.exit(Number.isFinite(load) && load < 25 ? 0 : 1)"]
checked = subprocess.run(gate, cwd=root, capture_output=True, text=True, stdin=subprocess.DEVNULL)
record = {'label': args.label, 'files': args.files, 'selection': args.select,
          'gate_exit': checked.returncode, 'gate_output': checked.stdout.strip()}
log = evidence / f'{args.label}.log'
if checked.returncode != 0:
    record['test_exit'] = None
    log.write_text(checked.stdout + checked.stderr + 'Load gate refused; tests not run.\n')
else:
    argv = ['node_modules/.bin/vitest', 'run', *args.files,
            '--maxWorkers=1', '--no-file-parallelism', '--configLoader=runner']
    if args.select is not None:
        argv += ['-t', args.select]
    record['command'] = shlex.join(argv) + ' < /dev/null'
    with log.open('w') as output:
        output.write('Load gate exit: 0\n' + checked.stdout + record['command'] + '\n')
        output.flush()
        result = subprocess.run(argv, cwd=root, stdout=output, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, env={**os.environ, 'NO_COLOR': '1'})
    record['test_exit'] = result.returncode
with (evidence / 'checks.jsonl').open('a') as output:
    output.write(json.dumps(record) + '\n')
print(json.dumps(record), flush=True)
lines = log.read_text().splitlines()
print('\n'.join(lines[-45:] if record['test_exit'] != 0 else
                [line for line in lines if line.strip().startswith(('Test Files', 'Tests ', 'Duration'))]), flush=True)
sys.exit(record['test_exit'] if record['test_exit'] is not None else checked.returncode)

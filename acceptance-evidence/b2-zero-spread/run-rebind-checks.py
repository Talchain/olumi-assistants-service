"""Rebind checks: fresh exit-code load gate, closed stdin, <=2 test files."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[1]
B2 = 'src/routes/__tests__/b2-zero-spread.test.ts'
CHANGED_TS = [B2, 'src/routes/__tests__/fixtures/b2-zero-spread/generate-staging-control.ts']
GATE = ['node', '-e', "const load=require('os').loadavg()[0];console.log(JSON.stringify({load,threshold:25}));process.exit(Number.isFinite(load)&&load<25?0:1)"]


def run(label, argv, *, files=None, selection=None, env_extra=None):
    if files is not None:
        assert 1 <= len(files) <= 2 and all(f.endswith('.test.ts') for f in files)
    gate = subprocess.run(GATE, cwd=ROOT, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True)
    log = EVIDENCE / f'{label}.log'
    record = {'label': label, 'files': files, 'selection': selection,
              'gate_exit': gate.returncode, 'gate_output': gate.stdout.strip(),
              'command': ('NODE_OPTIONS=--max-old-space-size=8192 ' if env_extra else '')
                         + shlex.join(argv) + ' < /dev/null'}
    if gate.returncode != 0:
        log.write_text(gate.stdout + gate.stderr + 'Load gate refused; check not run.\n')
        record['process_exit'] = None
    else:
        with log.open('w') as output:
            output.write('Load gate exit: 0\n' + gate.stdout + record['command'] + '\n')
            output.flush()
            result = subprocess.run(argv, cwd=ROOT, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT,
                                    env={**os.environ, 'NO_COLOR': '1', **(env_extra or {})})
        record['process_exit'] = result.returncode
    if label == 'rebind-tsc-full' and record['process_exit'] is not None:
        diagnostics = log.read_text().splitlines()
        record['diagnostic_count'] = sum('error TS' in line for line in diagnostics)
        record['changed_file_diagnostics'] = [line for line in diagnostics
                                             if any(line.startswith(path + '(') for path in CHANGED_TS)]
    with (EVIDENCE / 'rebind-checks.jsonl').open('a') as output:
        output.write(json.dumps(record) + '\n')
    print(json.dumps(record), flush=True)
    lines = log.read_text().splitlines()
    if files is not None:
        print('\n'.join(lines[-65:] if record['process_exit'] != 0 else
                        [line for line in lines if line.strip().startswith(('Test Files', 'Tests ', 'Duration'))]), flush=True)
    return record


def tests(label, files, selection=None):
    argv = ['node_modules/.bin/vitest', 'run', *files,
            '--maxWorkers=1', '--no-file-parallelism', '--configLoader=runner']
    if selection:
        argv += ['-t', selection]
    return run(label, argv, files=files, selection=selection)


def mutants():
    mutations = [
        ('old-return', 'src/orchestrator-v5/goal-target/goal-chance-licence.ts',
         'if (option_ids.length < 2 || (licensed.length === 0 && Object.keys(zeroSpreadSide).length === 0)) return null;',
         'if (option_ids.length < 2 || licensed.length === 0) return null;',
         'no licensed point means no scoring-threshold'),
        ('no-point-gate', 'src/orchestrator-v5/goal-target/goal-chance-range-agent.ts',
         'reasons : hasLicensedPoint && licence?.withheld_option_ids?.includes(optionId)',
         'reasons : licence?.withheld_option_ids?.includes(optionId)', 'reviewer row'),
    ]
    records = []
    for label, file, old, new, selection in mutations:
        baseline = tests(f'rebind-baseline-{label}', [B2], selection)
        assert baseline['gate_exit'] == 0 and baseline['process_exit'] == 0, baseline
        path = ROOT / file
        original = path.read_bytes()
        original_hash = hashlib.sha256(original).hexdigest()
        assert original.count(old.encode()) == 1, file
        try:
            path.write_bytes(original.replace(old.encode(), new.encode()))
            result = tests(f'rebind-mutant-{label}', [B2], selection)
        finally:
            path.write_bytes(original)
            restored_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            assert restored_hash == original_hash
        restored = tests(f'rebind-restored-{label}', [B2], selection)
        record = {'mutation': label, 'source': file, 'selection': selection,
                  'before': old, 'after': new, 'original_sha256': original_hash,
                  'restored_sha256': restored_hash, 'source_restored': True,
                  'baseline_green': baseline['process_exit'] == 0,
                  'mutant_red': result['gate_exit'] == 0 and result['process_exit'] == 1,
                  'restored_green': restored['gate_exit'] == 0 and restored['process_exit'] == 0}
        records.append(record)
        (EVIDENCE / 'rebind-mutant-restoration.json').write_text(json.dumps(records, indent=2) + '\n')
        assert record['mutant_red'] and record['restored_green'], record


if __name__ == '__main__':
    mode, *args = sys.argv[1:]
    if mode == 'tests':
        label, *files = args
        record = tests(label, files)
        sys.exit(record['process_exit'] if record['process_exit'] is not None else record['gate_exit'])
    elif mode == 'mutants':
        mutants()
    elif mode == 'eslint':
        record = run('rebind-eslint-changed', ['node_modules/.bin/eslint', *CHANGED_TS])
        sys.exit(record['process_exit'] if record['process_exit'] is not None else record['gate_exit'])
    elif mode == 'tsc':
        record = run('rebind-tsc-full', ['node_modules/.bin/tsc', '--noEmit'],
                     env_extra={'NODE_OPTIONS': '--max-old-space-size=8192'})
        sys.exit(record['process_exit'] if record['process_exit'] is not None else record['gate_exit'])
    else:
        raise ValueError(mode)

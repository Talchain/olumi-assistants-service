import pathlib, subprocess, json, hashlib, time

root = pathlib.Path('/private/tmp/sci-temporal-2382')
bank = pathlib.Path(__file__).parent
node = '/Users/paulslee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
agent = 'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts'
enc = 'src/orchestrator/tools/encode-option-interventions.ts'
fs = 'src/orchestrator-v5/graph-management/field-safety.ts'
norm = 'src/orchestrator-v5/normalise-option-interventions.ts'
approval = 'tests/integration/orchestrator/agent-level-keeps-the-users-likely-range.test.ts'
ec = 'src/orchestrator/tools/__tests__/encode-option-interventions.test.ts'
legacy = 'tests/unit/orchestrator-v5/normalise-option-interventions.test.ts'
records = json.loads((bank / 'MUTANTS-RESULT.json').read_text()) if (bank / 'MUTANTS-RESULT.json').exists() else []

def replace(s, a, b):
    if s.count(a) != 1:
        raise RuntimeError('Expected one mutation anchor: ' + a[:80])
    return s.replace(a, b, 1)

def quantity(s):
    a = s.index('function sameNativeQuantity(')
    b = s.index('\nfunction buildInterventionV3', a)
    return s[:a] + '''function sameNativeQuantity(before: Dict, after: Dict, _oldFrame?: FactorScaleInfo, _newFrame?: FactorScaleInfo): boolean {
  return QUOTED_FIGURE_KEYS.every(key => isDeepStrictEqual(before[key], after[key]));
}
''' + s[b:]

cases = [
    ('unapproved-generic-ranges', {
        fs: lambda s: replace(s, 'return operations.some(op => contains(op.value, []));', 'return false;'),
        enc: lambda s: replace(s, 'if (!isPlainObject(old) || !isDeepStrictEqual(old.range, cell.range)) return true;', 'if (false) return true;')
    }, ['src/orchestrator-v5/__tests__/apply-operations.test.ts', 'tests/integration/orchestrator/edit-graph-value-edit-persist-withdraws-extraction-type.test.ts'], 'generic.*smuggle|same-figure data-path|single value leaf'),
    ('wording-gate', {agent: lambda s: replace(s, '(rangeRequested\n          || figureTheUserWroteFor', '(false\n          || figureTheUserWroteFor')}, [approval], 'equivalent typed'),
    ('capless-carrier', {agent: lambda s: replace(s,
        "if (v.cap == null && v.raw === v.normalised) return { raw_value: v.raw,\n    ...(typeof v.unit === 'string' && v.unit.trim() !== '' ? { unit: v.unit.trim() } : {}),\n    ...(likely !== undefined ? { likely_range: likely } : {}) };",
        "if (v.cap == null && v.raw === v.normalised) return { ...(likely !== undefined ? { likely_range: likely } : {}) };")}, [approval], 'capless|CONTROL: a level with no range'),
    ('quantity-frame-identity', {enc: quantity}, [ec], 'native quantity unchanged|adding a cell unit|numeric whole-map unchanged quantity'),
    ('effective-unit-loss', {enc: lambda s: replace(s, 'if (unit(before, oldFrame) !== unit(after, newFrame)) return false;', 'if (false) return false;')}, [ec], 'removing the only|adding a cell unit|numeric whole-map unchanged quantity'),
    ('legacy-range-loss', {norm: lambda s: replace(s, 'if (rec.range !== undefined) iv.range = rec.range;', '// MUTANT: range erased in legacy normalization')}, [legacy], 'legacy opt_range'),
]

for name, mutations, files, pattern in cases:
    if any(r['name'] == name for r in records):
        continue
    originals = {p: (root / p).read_bytes() for p in mutations}
    start = time.time()
    try:
        for p, f in mutations.items():
            (root / p).write_text(f(originals[p].decode()))
        cmd = [node, 'node_modules/vitest/vitest.mjs', 'run', *files, '--maxWorkers=1', '--reporter=json', '--outputFile=' + str(bank / ('MUTANT-' + name + '.json')), '-t', pattern]
        with (bank / ('MUTANT-' + name + '.log')).open('w') as log:
            r = subprocess.run(cmd, cwd=root, stdout=log, stderr=subprocess.STDOUT, timeout=75)
        d = json.loads((bank / ('MUTANT-' + name + '.json')).read_text())
        failed = [t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status'] == 'failed']
        passed = [t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status'] == 'passed']
        rec = {'name': name, 'exit': r.returncode, 'semantic_failures': failed, 'passed_controls': passed, 'command': cmd, 'seconds': round(time.time() - start, 2)}
        if not failed or not passed:
            raise RuntimeError('Mutant needs a semantic failure and passing contrast: ' + name)
    finally:
        for p, v in originals.items():
            (root / p).write_bytes(v)
        restore = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() == hashlib.sha256(v).hexdigest() for p, v in originals.items()}
    if not all(restore.values()):
        raise RuntimeError('Restore failed')
    rec['byte_exact_restore'] = restore
    records.append(rec)
    (bank / 'MUTANTS-RESULT.json').write_text(json.dumps(records, indent=2) + '\n')
    print(name, 'FAIL', len(failed), 'PASS', len(passed), 'RESTORED', flush=True)

"""Mutate only the copied fixture, then restore its exact bytes from a backup."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
fixture = root / 'tools/limit-check-replay/fixtures/read-after-run1-1791348363696.json'
command = ['node', '--import', 'tsx', 'tools/limit-check-replay/replay.ts']
original = json.loads(fixture.read_bytes())


def direct_effect(d):
    for e in d['j']['graph']['edges']:
        if e['from'] == 'existing_price_rise' and e['to'] == 'monthly_recurring_revenue':
            del e['provenance']['natural_effect']


def risk_unit(d):
    for n in d['j']['graph']['nodes']:
        if n['id'] == 'customers_lost_from_price_rise':
            n['unit_reading'] = {'unit': 'customers', 'source': 'user_stated'}


mutations = [
    ('same-goal identity: different limit figure', lambda d: d['j']['graph']['goal_constraints'][0].update(value=125000)),
    ('direct path sized: remove natural effect', direct_effect),
    ('missing risk unit: supply the stated unit', risk_unit),
    ('run-evaluated identity: remove attestation', lambda d: d['j'].update(analysis_identity_evaluated_node_ids=[])),
    ('same-run chances: change Raise probability', lambda d: d['j']['analysis_result']['enrichment']['option_comparison'][0].update(probability_of_goal=0.5)),
]
baseline = subprocess.run(command, cwd=root, capture_output=True, text=True)
if baseline.returncode:
    raise RuntimeError(baseline.stderr)
print('Baseline: GREEN (node assertions; no vitest, no LLM)')
with tempfile.TemporaryDirectory(prefix='lim1-fixture-backup-') as tmp:
    backup = Path(tmp) / fixture.name
    shutil.copyfile(fixture, backup)
    try:
        for name, mutate in mutations:
            d = json.loads(json.dumps(original))
            mutate(d)
            fixture.write_text(json.dumps(d, ensure_ascii=False))
            result = subprocess.run(command, cwd=root, capture_output=True, text=True)
            if result.returncode == 0 or 'AssertionError' not in result.stderr:
                raise RuntimeError(f'Mutant did not fail a replay assertion: {name}\n{result.stderr}')
            print(f'RED: {name} (AssertionError)')
            shutil.copyfile(backup, fixture)
    finally:
        shutil.copyfile(backup, fixture)
    assert hashlib.sha256(fixture.read_bytes()).digest() == hashlib.sha256(backup.read_bytes()).digest()
restored = subprocess.run(command, cwd=root, capture_output=True, text=True)
if restored.returncode:
    raise RuntimeError(restored.stderr)
print('Restored: GREEN; byte-identical backup restored; no production mutation')

#!/usr/bin/env python3
"""Read the existing staging provider key into process memory; run the authorised pilot.

Never prints or persists credentials, modifies provider configuration, or writes a store.
--check-key is read-only and starts no tests/provider requests.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--check-key', action='store_true')
parser.add_argument('--brief')
args = parser.parse_args()
tree = Path(__file__).resolve().parents[2]
service = 'srv-d4slpaili9vc73eiq4og'
credential_file = Path('/Users/paulslee/.olumi/render.env')
provider_key = os.environ.get('OPENAI_API_KEY', '')
source = 'existing process environment'
if not provider_key.startswith('sk-'):
    try:
        match = re.search(r'^(?:export\s+)?RENDER_API_KEY\s*=\s*(.+)$', credential_file.read_text(), re.M)
        if match is None:
            raise ValueError('missing render credential')
        render_key = match.group(1).strip().strip('"\'')
        request = urllib.request.Request(
            f'https://api.render.com/v1/services/{service}/env-vars?limit=100',
            headers={'Authorization': f'Bearer {render_key}'},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            environment_rows = json.load(response)
        provider_key = next((row['envVar']['value'] for row in environment_rows if row.get('envVar', {}).get('key') == 'OPENAI_API_KEY'), '')
        source = f'read-only staging environment on {service}'
        del render_key, environment_rows, request
    except Exception:
        raise SystemExit('Credential read-only lookup failed; no credential value was emitted.')
if not provider_key.startswith('sk-') or len(provider_key) < 20:
    raise SystemExit('No usable existing OpenAI credential found.')
print(f'Existing OpenAI credential found via {source}; value withheld.', flush=True)
if args.check_key:
    raise SystemExit(0)
if not args.brief or not Path(args.brief).is_file():
    raise SystemExit('--brief must point to the preserved pilot brief.')
out = tree / 'acceptance-evidence/event-branch/pilot'
out.mkdir(parents=True, exist_ok=True)
budget = 'BUDGET: EVENT branch; exactly 2 live draws; at most 4 provider attempts total (one existing construction repair per draw); checked-in construction baseline model/effort; no configuration/store writes; stop on first 429.'
(out / 'BUDGET.txt').write_text(budget + '\n')
print(budget, flush=True)
environment = dict(os.environ)
environment.pop('SUPABASE_URL', None)
environment.pop('SUPABASE_SERVICE_ROLE_KEY', None)
environment.update({
    'OPENAI_API_KEY': provider_key, 'CL_LIVE': '1', 'CL_BRIEF': str(Path(args.brief).resolve()),
    'CL_NAME': 'paul', 'CL_OUT': str(out), 'CL_DRAWS': '2', 'CL_ARM': 'event-branch',
    'CL_MODEL': '', 'CL_EFFORT': 'as-baseline', 'CL_CALL_CAP': '4',
    'CL_RUN_ID': 'event-branch-20261008',
    'VITE_SUPABASE_URL': 'http://localhost', 'VITE_SUPABASE_ANON_KEY': 'dummy',
})
del provider_key
gate = subprocess.run(['node', '-e', "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"], cwd=tree)
if gate.returncode != 0:
    raise SystemExit('Load gate rejected pilot; no tests/provider calls started.')
with open(os.devnull, 'rb') as stdin, (out / 'vitest.log').open('w') as output:
    result = subprocess.run([
        str(tree / 'node_modules/.bin/vitest'), 'run', 'acceptance-evidence/event-branch/pilot.test.ts',
        '--configLoader=runner', '--maxWorkers=1', '--no-file-parallelism',
    ], cwd=tree, env=environment, stdin=stdin, stdout=output, stderr=subprocess.STDOUT)
environment.pop('OPENAI_API_KEY', None)
raise SystemExit(result.returncode)

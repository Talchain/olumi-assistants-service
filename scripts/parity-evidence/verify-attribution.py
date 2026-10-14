import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.codex-out'
os.chdir(ROOT)
OLD = '178cc5bf045cf3e13281359c56c14cfd0845e73b'
MAP_OLD = '225d7d659883f15597e5ea4823a31fbcaea29304'
NEW = '69ff73cf180efb4099c10446197661a33f9777da'
COMMIT = 'a78244f3c7af7c62561f7e6ba844fa576df834b8'
PROVENANCE = json.loads((OUT / 'addendum-15-snapshot-provenance.json').read_text())
EXPORT = Path(PROVENANCE['export'])
SNAPS = list(PROVENANCE['snapshot_sha256'])
MOVED_SNAPS = {snap: ROOT / 'scripts/parity-evidence/__snapshots__' /
    Path(snap).name.replace('.test.ts.snap', '.evidence.ts.snap') for snap in SNAPS}

def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def parse(p):
    data = p.read_text()
    entries = re.findall(r'^exports\[`([^`\n]+)`\] = `\n(.*?)\n`;', data, re.M | re.S)
    return {key: json.loads(re.sub(r',(\s*[}\]])', r'\1', value)) for key, value in entries}

def headerless(data):
    return re.sub(r"^// STAGING_SEED_SHA = '[a-f0-9]{40}'\n", '', data, flags=re.M)

checks = {}
old_files = {}
old_data = {}
new_data = {}
for snap in SNAPS:
    old_files[snap] = OUT / ('addendum-15-old-' + Path(snap).name + '.backup')
    old_data[snap] = parse(old_files[snap])
    new_data[snap] = parse(EXPORT / snap)
    assert sha256(EXPORT / snap) == PROVENANCE['snapshot_sha256'][snap]
    assert sha256(MOVED_SNAPS[snap]) == PROVENANCE['snapshot_sha256'][snap]
    assert re.search(r"^// STAGING_SEED_SHA = '" + NEW + r"'$", (EXPORT / snap).read_text(), re.M)
    assert old_data[snap].keys() == new_data[snap].keys()
checks['export_snapshot_bytes_match_root_provenance'] = True
checks['relocated_snapshot_bytes_match_addendum_15_provenance'] = True
checks['all_new_headers_equal_target_sha40'] = True
checks['all_snapshot_keys_preserved'] = True

historic_door = json.loads((OUT / 'addendum-7-final-results.json').read_text())['snapshot_digests']
historic_maps = json.loads((OUT / 'addendum-14-snapshot-provenance.json').read_text())['snapshot_sha256']
assert sha256(old_files[SNAPS[0]]) == historic_door[SNAPS[0]]
for snap in SNAPS[1:]:
    assert sha256(old_files[snap]) == historic_maps[snap]
checks['old_snapshot_bytes_bound_to_addenda_7_and_14'] = True

observed = []
for snap in SNAPS:
    for door in old_data[snap]:
        old_row, new_row = old_data[snap][door], new_data[snap][door]
        assert old_row.keys() == new_row.keys()
        for field in old_row:
            if old_row[field] != new_row[field]:
                observed.append({'snapshot': snap, 'door': door, 'field': field, 'old': old_row[field], 'new': new_row[field]})
assert observed == json.loads((OUT / 'addendum-15-seed-snapshot-changes.json').read_text())
assert len(observed) == 3
assert {x['field'] for x in observed} == {'rpcCalls', 'select_count', 'selects'}
assert len({x['door'] for x in observed}) == 1
register_key = observed[0]['door']
assert 'register preserves' in register_key
register_old = old_data[SNAPS[0]][register_key]
register_new = new_data[SNAPS[0]][register_key]
expected = copy.deepcopy(register_old)
removed_rpc = expected['rpcCalls'].pop(0)
assert removed_rpc == {'name': 'ensure_scenario_exists', 'args': {'p_scenario_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p_user_id': None}}
removed_select = expected['selects'].pop(0)
assert removed_select == {'columns': 'id', 'table': 'scenarios'}
expected['select_count'] -= 1
assert register_old['select_count'] == 6
assert expected['select_count'] == 5 == len(expected['selects'])
assert len(register_old['rpcCalls']) == 3
assert len(expected['rpcCalls']) == 2
assert register_new == expected
checks['exhaustive_changed_field_list_matches_root_diff'] = True
checks['register_diff_is_only_first_rpc_first_select_and_select_count_removal'] = True
checks['register_remaining_rpc_complete_arguments_and_order_identical'] = True
checks['register_remaining_select_columns_options_and_order_identical'] = True
assert register_old['outcome'] == register_new['outcome'] == {'registered': True, 'statusCode': 200}
assert register_old['durable_turn_count'] == register_new['durable_turn_count'] == 1
checks['register_outcome_and_durable_turn_count_unchanged'] = True
unchanged_doors = [k for k in old_data[SNAPS[0]] if k != register_key]
assert len(unchanged_doors) == 5
assert all(old_data[SNAPS[0]][k] == new_data[SNAPS[0]][k] for k in unchanged_doors)
checks['other_five_door_read_rpc_count_outcome_objects_identical'] = True
for snap in SNAPS[1:]:
    assert old_data[snap] == new_data[snap]
    assert headerless(old_files[snap].read_text()) == headerless((EXPORT / snap).read_text())
assert sum(len(old_data[s]) for s in SNAPS[1:]) == 8
checks['all_eight_interface_maps_identical_and_only_header_bytes_changed'] = True

paths = ['src/routes/assist.v1.scenario-graph-register.ts', 'src/orchestrator/route-v2-preflight.ts', 'src/orchestrator/route-v2.ts', 'src/orchestrator-v5/session/supabase-store.ts', 'src/orchestrator-v5/build-turn-context.ts', 'src/plugins/scenario-ownership.ts']
commits = subprocess.check_output(['git', 'log', '--format=%H', f'{OLD}..{NEW}', '--', *paths], text=True).splitlines()
assert commits == [COMMIT]
for path in paths:
    assert subprocess.check_output(['git', 'show', f'{COMMIT}:{path}']) == subprocess.check_output(['git', 'show', f'{NEW}:{path}'])
assert subprocess.check_output(['git', 'show', f'{OLD}:src/orchestrator-v5/session/supabase-store.ts']) == subprocess.check_output(['git', 'show', f'{NEW}:src/orchestrator-v5/session/supabase-store.ts'])
checks['sole_relevant_staging_commit_is_2863_and_sources_equal_target'] = True
checks['supabase_store_entire_file_old_target_byte_equal'] = True
map_changed_files = subprocess.check_output(['git', 'diff', '--name-only', MAP_OLD, NEW], text=True).splitlines()
assert map_changed_files == ['src/routes/__tests__/canonical-analysis-view-face.test.ts', 'src/routes/__tests__/canonical-analysis-view.test.ts', 'src/routes/canonical-analysis-view.ts']
checks['interface_seed_to_target_only_unrelated_canonical_analysis_view_changes'] = True

route_old = f'{OLD}:src/routes/assist.v1.scenario-graph-register.ts:847'
preflight_old = f'{OLD}:src/orchestrator/route-v2-preflight.ts:350'
route_new = f'{NEW}:src/routes/assist.v1.scenario-graph-register.ts:705'
common = {'snapshot': SNAPS[0], 'door': register_key, 'staging_commit': COMMIT, 'pull_request': 2863, 'new_call_site': route_new, 'reason': '#2863 replaces unconditional per-route ownership with the central ownership pre-handler. The unchanged bare Fastify register harness mounts no scenarioOwnershipPlugin, so req.scenarioAccess.provisionIfMissing is absent and the optional replacement call does not run.'}
changes = [
    dict(common, field='rpcCalls', removed_rpc=removed_rpc, old_rpc_count=3, new_rpc_count=2, old_call_chain=[route_old, preflight_old, f'{OLD}:src/orchestrator-v5/build-turn-context.ts:2580', f'{OLD}:src/orchestrator-v5/session/supabase-store.ts:2940'], preserved_rpc_names=['v5_claim_turn_fence', 'append_turn_atomic_v5'], preserved_complete_arguments=True),
    dict(common, field='select_count', old=6, new=5, old_call_chain=[route_old, preflight_old, f'{OLD}:src/orchestrator-v5/build-turn-context.ts:2521', f'{OLD}:src/orchestrator-v5/session/supabase-store.ts:734'], witness_count_source='original unmodified harness src/orchestrator-v5/session/__tests__/flag-off-door-parity.test.ts:180', reason=common['reason'] + ' select_count is selects.length; exactly the removed scenarioExists SELECT reduces it by one.'),
    dict(common, field='selects', removed_select=removed_select, old_call_chain=[route_old, preflight_old, f'{OLD}:src/orchestrator-v5/build-turn-context.ts:2521', f'{OLD}:src/orchestrator-v5/session/supabase-store.ts:734'], preserved_remaining_reads_in_order=True),
]
data = {'all_deltas_attributed': True, 'unattributed': [], 'door_old_seed_sha': OLD, 'interface_old_seed_sha': MAP_OLD, 'target_seed_sha': NEW, 'sole_staging_commit_changing_relevant_source_chain': commits, 'changes': changes, 'programmatic_exhaustive_assertions': checks, 'old_snapshot_sha256': {p: sha256(f) for p, f in old_files.items()}, 'new_snapshot_sha256': PROVENANCE['snapshot_sha256'], 'unchanged_door_count': len(unchanged_doors), 'unchanged_interface_map_count': 8, 'interface_changed_files_between_seed_and_target': map_changed_files, 'metadata_changes': {'door_header': 'added target SHA40 header as Addendum 15 requests; no previous door header', 'interface_headers': f'{MAP_OLD} -> {NEW}; no body-byte changes'}, 'harness_scope': {'original_bare_mount': 'src/orchestrator-v5/session/__tests__/flag-off-door-parity.test.ts:286-287', 'production_plugin_registration': f'{NEW}:src/server.ts:582', 'production_read_only_ownership_lookup': f'{NEW}:src/plugins/scenario-ownership.ts:237-239', 'production_deferred_provisioning': f'{NEW}:src/plugins/scenario-ownership.ts:254-257', 'limitation': 'Unchanged bare-route parity harness does not exercise central scenario-ownership plugin; no live admission behavior claim.'}, 'verification_script': '.codex-out/addendum-15-attribution-verify.py', 'source_evidence': '.codex-out/addendum-15-attribution-source.log'}
data['verification_script'] = 'scripts/parity-evidence/verify-attribution.py'
data['relocated_snapshot_sha256'] = {str(p.relative_to(ROOT)): sha256(p) for p in MOVED_SNAPS.values()}
(OUT / 'parity-evidence-staging-attribution.json').write_text(json.dumps(data, indent=2) + '\n')
print(json.dumps({'all_deltas_attributed': True, 'unattributed': [], 'changed_fields': [x['field'] for x in observed], 'unchanged_other_doors': len(unchanged_doors), 'unchanged_interface_maps': 8, 'assertions_passed': len(checks)}, indent=2))

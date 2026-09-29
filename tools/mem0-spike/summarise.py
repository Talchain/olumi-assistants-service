"""Summarise the latest run-ab results file (tools/mem0-spike/out/results-*.json)."""
import json, glob, sys
f = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob('tools/mem0-spike/out/results-*.json'))[-1]
d = json.load(open(f))
print(f)
print('latency', json.dumps(d['latency']))
print('sent', d['sent_to_mem0'], 'cleanup', d['cleanup'], 'layer2', d['layer2'])
for cid, c in d['cases'].items():
    print('\n==', cid, '|', c['klass'])
    for arm, a in c['arms'].items():
        l = a['layer1']; r = a.get('recall', {})
        line = f"  {arm:10s} needed {l['needed_present']}/{l['needed_total']} stale_in_recall={l['stale_in_recall']} leak={l['cross_scenario_leak']} unrec={[u['present'] for u in l['unreconciled']]} input_chars={l['input_chars']}"
        if r: line += f" | search={r.get('search_ms')}ms recalled={r.get('recalled')} kept={r.get('kept')} unrec={r.get('unreconciled')} supp={r.get('suppressed')} chars={r.get('chars')}"
        print(line)
        for k in a.get('layer2', []): print('     L2', json.dumps({x: k.get(x) for x in ['ms','must_not_hits','should_hits','mutated_calls','error']}))
if 'infer_side_run' in d:
    print('\ninfer side run')
    for k, v in d['infer_side_run'].items(): print(' ', k, json.dumps(v)[:900])

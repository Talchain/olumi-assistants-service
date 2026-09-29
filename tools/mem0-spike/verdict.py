"""Layer 2 aggregation + the PRE-REGISTERED rules (RESULTS.md), applied mechanically. Usage: python3 verdict.py [results.json]"""
import json, glob, sys, statistics
f = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob('tools/mem0-spike/out/results-*.json'))[-1]
d = json.load(open(f))
ARMS = ['A_CONTROL', 'B_INHOUSE', 'C_MEM0']

def run_failed(r):
    if 'error' in r: return True
    return len(r['must_not_hits']) > 0 or len(r['should_hits']) < r['should_total']

rows, failed, mustnot, muts, lat = {}, {a: set() for a in ARMS}, {a: 0 for a in ARMS}, {a: 0 for a in ARMS}, {a: [] for a in ARMS}
errors = {a: 0 for a in ARMS}
for cid, c in d['cases'].items():
    rows[cid] = {}
    for a in ARMS:
        runs = c['arms'][a].get('layer2', [])
        if not runs: continue
        nf = sum(run_failed(r) for r in runs)
        rows[cid][a] = f"{nf}/{len(runs)}"
        if nf * 2 > len(runs): failed[a].add(cid)
        for r in runs:
            if 'error' in r: errors[a] += 1; continue
            mustnot[a] += len(r['must_not_hits']); muts[a] += len(r['mutated_calls']); lat[a].append(r['ms'])

print(f)
print('model', d.get('layer2_model'), 'wall_ms', d.get('layer2_wall_ms'), 'usage', d.get('layer2_usage'))
print(f"{'case':28s} " + ' '.join(f'{a:>10s}' for a in ARMS) + '   (runs failed / N)')
for cid, r in rows.items(): print(f"{cid:28s} " + ' '.join(f"{r.get(a, '-'):>10s}" for a in ARMS))
for a in ARMS:
    q = sorted(lat[a]); p95 = q[min(len(q) - 1, int(0.95 * len(q)))] if q else None
    print(f"{a:10s} failed probes={len(failed[a])} {sorted(failed[a])} must_not_hits={mustnot[a]} mutations={muts[a]} errors={errors[a]} turn_ms p50={statistics.median(q) if q else None} p95={p95}")
fixed = failed['B_INHOUSE'] - failed['C_MEM0']
broke = failed['C_MEM0'] - failed['B_INHOUSE']
nb, nc = len(failed['B_INHOUSE']), len(failed['C_MEM0'])
reduction = (nb - nc) / nb if nb else 0.0
print('\nC vs B: fixes', sorted(fixed), 'newly failing in C', sorted(broke), f'relative reduction {reduction:.0%}')
print('B vs A: fixes', sorted(failed['A_CONTROL'] - failed['B_INHOUSE']), 'newly failing in B', sorted(failed['B_INHOUSE'] - failed['A_CONTROL']))
truth_regression = mustnot['C_MEM0'] > mustnot['B_INHOUSE']
keep = len(fixed) >= 2 and reduction >= 0.30 and not truth_regression and muts['C_MEM0'] == 0
print('PRE-REGISTERED VERDICT:', 'KEEP' if keep else 'KILL', f"(fixes>=2: {len(fixed) >= 2}; reduction>=30%: {reduction >= 0.30}; no truth regression: {not truth_regression}; mutations 0: {muts['C_MEM0'] == 0})")

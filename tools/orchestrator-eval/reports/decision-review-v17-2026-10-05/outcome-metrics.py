#!/usr/bin/env python3
"""P3 outcome metrics over raw arms (v16 or v17), per Science d5 / DL 6002275151:
M1 sentence 1 carries no share (no %) and does not open with an option label; M2 own-share sentence
'In this model, N% of runs supported <winner.label>' present iff the leader may be stated (neither
recommendation_suppressed nor constraint_infeasible), absent otherwise; M3 no best/winner/points-to
phrasing in any prose string; M4 narrative <= 280 chars; M5 a primary-risk content token in sentence 1."""
import json, os, re, sys, glob
arms_dir, fix_dir = sys.argv[1:3]
STOP = set('the a an of to from in on and or is are be this that its it for with by as at into than then'.split())
BAN = re.compile(r"\b(best outcome|came out best|produced the best|winner|winning|points to|favours?|front-runner|comes? out ahead)\b", re.I)
def sentences(t): return [x for x in re.split(r'(?<=[.!?])\s+', t.strip()) if x]
def prose(o, acc):
    if isinstance(o, str): acc.append(o)
    elif isinstance(o, dict):
        for k, v in o.items():
            if k in ('grounded_in', 'affected_elements', 'factor_id'): continue
            prose(v, acc)
    elif isinstance(o, list):
        for v in o: prose(v, acc)
    return acc
rows = []; tot = {'M1':0,'M2':0,'M3':0,'M4':0,'M5':0}; n = 0
for path in sorted(glob.glob(os.path.join(arms_dir, '*.json'))):
    r = json.load(open(path)); raw = r['text'].strip().strip('`')
    if raw.startswith('json'): raw = raw[4:]
    try: o = json.loads(raw)
    except Exception: rows.append((os.path.basename(path), 'UNPARSED')); continue
    fx = json.load(open(os.path.join(fix_dir, r['fixture'] + '.json')))['input']
    w = fx.get('winner') or {}
    labels = [w.get('label')] + [x.get('option_label') or x.get('label') for x in ((fx.get('isl_results') or {}).get('option_comparison') or [])]
    labels = [l for l in labels if l]
    may_state = not (w.get('recommendation_suppressed') or w.get('constraint_infeasible'))
    nar = o.get('narrative_summary', ''); ss = sentences(nar); s1 = ss[0] if ss else ''
    pr = ((o.get('robustness_explanation') or {}).get('primary_risk') or '')
    m1 = ('%' not in s1) and not any(s1.startswith(l) for l in labels)
    share = re.search(r'(?i:in this model), \d{1,3}% of runs supported ' + re.escape(w.get('label', '\x00')), nar)
    m2 = bool(share) == may_state
    hits = [h.group(0) for s in prose(o, []) for h in BAN.finditer(s)]
    m3 = not hits
    m4 = len(nar) <= 280
    toks = {t for t in re.findall(r"[A-Za-z][A-Za-z']{3,}", pr.lower()) if t not in STOP}
    m5 = any(t in s1.lower() for t in toks)
    n += 1
    for k, v in zip(('M1','M2','M3','M4','M5'), (m1,m2,m3,m4,m5)): tot[k] += int(v)
    rows.append((os.path.basename(path), f"M1={int(m1)} M2={int(m2)}(may_state={int(may_state)}) M3={int(m3)}{' '+str(hits[:3]) if hits else ''} M4={int(m4)}({len(nar)}) M5={int(m5)}"))
for r_ in rows: print(*r_)
print('n', n, ' '.join(f'{k} {v}/{n}' for k, v in tot.items()))

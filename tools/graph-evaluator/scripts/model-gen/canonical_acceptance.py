#!/usr/bin/env python3
"""CANONICAL ACCEPTANCE — does the pricing brief survive as STRUCTURED CONTENT, not labels?

Seven assertions over the FINAL ADMITTED model (builder -> widener -> deterministic admission),
and then over its Analysis Projection. Each one asks for a typed field, never for the presence of a
word — a label that merely mentions "£49" is a failure, not a pass.

  A1  £49 is the BASELINE: a typed current value, user-attributed, at native magnitude
  A2  £59 is the PROPOSED INTERVENTION: a typed lever setting on a controllable factor,
      bound to the user's own option
  A3  £20k / 12 months is the OBJECTIVE: a typed target with a horizon carrying value AND unit
  A4  "under 4%" is a STRICT constraint: operator "<" exactly, on churn, value 4
  A5  PROVENANCE: every user value is user-attributed and nothing model-authored claims to be
  A6  TEMPORAL MEANING: the feature-release timing survives as structure, not prose
  A7  UNKNOWNS: what nobody knows is recorded as an explicit question, not filled

Then the projection, which is where meaning is most easily lost:
  P1  no numeric precision invented at projection
  P2  authorship unchanged across the boundary
  P3  the strict operator is disclosed, never silently relaxed
"""
import json, glob, sys, argparse

BASE = "/Users/paulslee/Documents/GitHub/output/model-gen-20260921"
sys.path.insert(0, f"{BASE}/runner")
import importlib.util
_p = importlib.util.spec_from_file_location("proj", f"{BASE}/runner/project.py")
proj = importlib.util.module_from_spec(_p); _p.loader.exec_module(proj)

BRIEF = ("Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, "
         "should we increase the Pro plan price from £49 to £59 per month with the next Pro feature "
         "release?")
USER_EPI = {"known", "observed", "user_estimate"}


def facts_by_value(m, v):
    return [f for f in m.get("user_facts", []) if f.get("value") == v]


def check(m):
    r = {}

    # A1 — £49 as a typed baseline, user-attributed, native magnitude (49, not 0.49)
    f49 = facts_by_value(m, 49)
    cur = [f for f in f49 if f.get("role") in ("current", "baseline")]
    fac49 = [f for f in m.get("factors", []) if f.get("current_value") == 49]
    r["A1 £49 baseline typed + user-attributed"] = (
        bool(cur) and all(f.get("source_quote") for f in cur),
        f"user_facts={[f['id'] for f in cur]} role={[f.get('role') for f in cur]} "
        f"unit={[f.get('unit') for f in cur]} factors_with_49={[f['id'] for f in fac49]}")

    # A2 — £59 as a typed intervention on a lever, bound to the USER's option
    lev = []
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            if l.get("value") == 59:
                lev.append((o.get("id"), o.get("provenance"), l.get("factor_id"),
                            l.get("epistemic_state"), l.get("source_fact_id")))
    lever_ctrl = {f["id"]: f.get("control") for f in m.get("factors", [])}
    user_bound = [x for x in lev if x[1] == "user" and x[3] in USER_EPI and x[4]]
    on_lever = [x for x in lev if lever_ctrl.get(x[2]) == "lever"]
    r["A2 £59 typed intervention on a lever, user-bound"] = (
        bool(user_bound) and bool(on_lever),
        f"settings={lev} controls={[lever_ctrl.get(x[2]) for x in lev]}")

    # A3 — objective: £20k target AND a horizon with value+unit
    tgt = [f for f in facts_by_value(m, 20000) if f.get("role") == "target"]
    hz = (m.get("decision") or {}).get("horizon") or {}
    r["A3 £20k target + 12-month horizon typed"] = (
        bool(tgt) and hz.get("value") == 12 and hz.get("unit") in ("months", "month"),
        f"target={[f['id'] for f in tgt]} horizon={hz.get('value')} {hz.get('unit')}")

    # A4 — strict constraint, operator exactly "<"
    ch = [c for c in m.get("constraints", [])
          if c.get("value") in (4, 4.0) or str(c.get("unit") or "").strip() == "%"]
    strict = [c for c in ch if c.get("operator") == "<"]
    r["A4 'under 4%' is operator '<' exactly"] = (
        bool(strict),
        f"constraints={[(c.get('operator'), c.get('value'), c.get('unit')) for c in ch]}")

    # A5 — provenance both ways: user values attributed, AI values not claiming to be the user's
    bad = []
    for fa in m.get("factors", []):
        if fa.get("current_value") is not None and fa.get("provenance") == "user" and not fa.get("source_fact_id"):
            bad.append(f"factor {fa['id']} claims user with no anchor")
    for o in m.get("options", []):
        if o.get("provenance") == "user" and not o.get("source_fact_id"):
            bad.append(f"option {o['id']} claims user with no anchor")
        for l in o.get("lever_settings", []):
            if l.get("epistemic_state") in USER_EPI and l.get("value") is not None and not l.get("source_fact_id"):
                bad.append(f"lever {o['id']}->{l.get('factor_id')} claims {l['epistemic_state']} with no anchor")
    r["A5 provenance: no unanchored user claim"] = (not bad, "; ".join(bad) or "clean")

    # A6 — temporal meaning as STRUCTURE (a typed field), not merely a word in a label
    tstruct = []
    for l in m.get("causal_links", []):
        t = l.get("temporal") or {}
        if t.get("delay") or t.get("duration") or t.get("persistence") not in (None, "unknown"):
            tstruct.append(f"{l.get('from_id')}->{l.get('to_id')}:{t.get('persistence')}")
    timing = [f"{o.get('id')}:{(o.get('timing') or {}).get('when')}"
              for o in m.get("options", []) if (o.get("timing") or {}).get("when")]
    release = [f for f in m.get("user_facts", []) if "release" in (f.get("source_quote") or "").lower()]
    # Structure means a TYPED field. The brief's timing is a property of the option ("with the next
    # Pro feature release" says when the lever moves); propagation speed belongs on a link. Either
    # satisfies A6 — a word inside a source_quote does not.
    r["A6 temporal meaning survives as structure"] = (
        bool(tstruct) or bool(timing),
        f"option timing={timing or 'none'}; {len(tstruct)} links carry temporal structure; "
        f"release fact={[f['id'] for f in release]}")

    # A7 — unknowns are asked, not filled
    unk = m.get("unknowns", [])
    filled = [f"link:{l.get('id')}" for l in m.get("causal_links", [])
              if (l.get("magnitude") or {}).get("kind") in ("unknown", "qualitative")
              and (l.get("magnitude") or {}).get("value") is not None]
    r["A7 unknowns asked, never filled"] = (
        bool(unk) and not filled,
        f"{len(unk)} explicit questions; filled-unknowns={filled or 'none'}")
    return r


def check_projection(m):
    r = {}
    try:
        g, rep = proj.project(json.loads(json.dumps(m)))
    except ValueError as e:
        return {"P0 projection refuses rather than defaults": (False, str(e))}
    g9 = proj.gate_g9(m, g)

    nums_in = set()
    for f in m.get("user_facts", []):
        if f.get("value") is not None: nums_in.add(float(f["value"]))
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            if l.get("value") is not None: nums_in.add(float(l["value"]))
    for fa in m.get("factors", []):
        if fa.get("current_value") is not None: nums_in.add(float(fa["current_value"]))
    for c in m.get("constraints", []):
        if c.get("value") is not None: nums_in.add(float(c["value"]))
    for l in m.get("causal_links", []):
        v = (l.get("magnitude") or {}).get("value")
        if v is not None: nums_in.add(float(v))

    invented = []
    for n in g["nodes"]:
        d = n.get("data") or {}
        for k in ("value", "raw_value"):
            if isinstance(d.get(k), (int, float)) and float(d[k]) not in nums_in:
                invented.append(f"node {n['id']}.{k}={d[k]}")
        for fid, iv in (n.get("interventions") or {}).items():
            if isinstance(iv, dict) and isinstance(iv.get("value"), (int, float)) \
                    and float(iv["value"]) not in nums_in:
                invented.append(f"{n['id']}->{fid}={iv['value']}")
    r["P1 projection invents no numeric precision"] = (not invented, "; ".join(invented[:4]) or "none")
    r["P2 authorship unchanged across the boundary"] = (g9["ok"], json.dumps(g9["failures"][:2]) or "clean")

    disc = [d for d in rep.get("disclosures", []) if d.get("original_operator") in ("<", ">")]
    relaxed_silently = [c for c in g.get("goal_constraints", [])
                        if c.get("operator") in ("<=", ">=") and not c.get("strictness")]
    r["P3 strict operator disclosed, not silently relaxed"] = (
        bool(disc) and not relaxed_silently,
        f"disclosures={[(d['original_operator'], d['projected_operator']) for d in disc]} "
        f"silent={[c.get('constraint_id') for c in relaxed_silently]}")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default=f"{BASE}/arms-grounded/widener-gpt-4-1-gpt-5-6-terra-high/pricing-staging/run_*/final_model.json")
    a = ap.parse_args()
    files = sorted(glob.glob(a.glob))
    if not files:
        print("no admitted models found"); return 1
    print(f"CANONICAL ACCEPTANCE — {len(files)} admitted model(s) of the pricing brief\n" + "=" * 104)
    agg = {}
    for p in files:
        m = json.load(open(p))
        res = {**check(m), **check_projection(m)}
        run = p.split("/")[-2]
        print(f"\n── {run} " + "─" * 84)
        for k, (ok, ev) in res.items():
            print(f"  {'PASS' if ok else 'FAIL'}  {k}")
            if not ok:
                print(f"        {ev[:150]}")
            agg.setdefault(k, []).append(ok)
    print("\n" + "=" * 104)
    print("ACROSS ALL RUNS")
    print("=" * 104)
    allok = True
    for k, v in agg.items():
        n = sum(v)
        print(f"  {n}/{len(v)}  {k}")
        if n != len(v): allok = False
    print("\nGOAL CRITERION 1 " + ("SATISFIED on every run" if allok else "NOT YET SATISFIED — see FAILs above"))
    json.dump({k: sum(v) for k, v in agg.items()}, open(f"{BASE}/CANONICAL-ACCEPTANCE.json", "w"), indent=1)
    return 0 if allok else 2


if __name__ == "__main__":
    sys.exit(main())

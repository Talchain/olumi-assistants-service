#!/usr/bin/env python3
"""Trust gates + quality metrics over every arm, including the current-CEE control.

Authority order (Paul's amendment 3): deterministic hard gates FIRST, then deterministic
quality metrics, and only then any LLM judging. Nothing here calls a model.

Hard gates — one FAIL and the candidate fails that brief, regardless of aggregate score:
  G1  every expected user value reaches the model at native magnitude + unit, user-attributed
  G2  no user-attributed number that is absent from the brief
  G3  no invented/unattributed numeric baseline
  G4  a strict limit is never silently relaxed to <=
  G5  no semantic duplicate of a user option
  G6  no option intervenes on a constrained subject or an outcome
  G7  declared temporal / qualitative material survives
  G8  no unknown promoted to a point estimate

Reads: arms/<slug>/<brief>/run_<n>/{result.json,final_model.json} for rich arms,
       armA/<brief>/run_<n>.json                                  for the CEE control.
"""
import json, os, re, sys, glob, statistics
from collections import defaultdict

BASE = "/Users/paulslee/Documents/GitHub/output/model-gen-20260921"
BRIEFS = "/Users/paulslee/Documents/GitHub/cee-model-gen-20260921/tools/graph-evaluator/briefs"
ORACLES = json.load(open(f"{BASE}/runner/oracles.json"))

UNIT_ALIASES = [
    ({"£", "gbp", "pound", "pounds", "£/month", "gbp/month", "£ per month", "£/mo", "£ mrr",
      "gbp per month", "£/month/user", "£k", "£m"}, "GBP"),
    ({"%", "percent", "percentage", "percent/month", "% monthly", "%/month", "pct",
      "percentage points"}, "PCT"),
    ({"months", "month", "mo", "mos"}, "MONTHS"),
    ({"days", "day"}, "DAYS"),
    ({"years", "year", "yr"}, "YEARS"),
    ({"people", "person", "headcount", "employees", "staff", "fte"}, "PEOPLE"),
    ({"developers", "developer", "devs", "engineers", "engineer", "hires"}, "PEOPLE"),
    ({"customers", "customer", "subscribers", "subscriber", "users", "user"}, "COUNT"),
    ({"x", "times", "multiple"}, "X"),
]


CURRENCY_MARKERS = ("\u00a3", "gbp", "$", "usd", "\u20ac", "eur", "pound", "dollar", "euro")


def unit_class(u):
    """Collapse a free-text unit to a comparable class. Run 1 of the WP0 probe wrote
    '£ per month' where runs 2-3 wrote 'GBP/month' for the same quantity, so raw unit
    strings are never compared directly."""
    # CORRECTED 22 Sep: A COMPOUND RATE IS CLASSIFIED BY ITS NUMERATOR.
    # The first version ran the alias table before any currency test, so "£/year" matched the
    # {year, yr} alias on a substring and was classified YEARS - a duration. A model that had
    # correctly recorded "£180k/year -> 180000" was then marked convention_shifted against an
    # oracle saying "£", and the MODEL was right. This is the same defect the estate already
    # documented inside CEE, where isAmountStatedInBrief accepted "£" and refused "£/month" for
    # the same amount. A currency marker anywhere therefore decides the class BEFORE any time word.
    if not u:
        return None
    s = str(u).strip().lower()
    if any(m in s for m in CURRENCY_MARKERS):
        return "GBP"
    if "%" in s or "percent" in s:
        return "PCT"
    for names, cls in UNIT_ALIASES:
        if s in names:
            return cls
    for names, cls in UNIT_ALIASES:
        if any(n in s for n in names if len(n) > 2):
            return cls
    return s


def close(a, b):
    if a is None or b is None:
        return False
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return False
    if abs(a - b) < 1e-6:
        return True
    # accept a percent written as a fraction (4% recorded as 0.04) — the magnitude is preserved,
    # the convention differs. Recorded separately so it is never silently credited as exact.
    return abs(a - b * 100) < 1e-6 or abs(a * 100 - b) < 1e-6


def exactly(a, b):
    try:
        return abs(float(a) - float(b)) < 1e-6
    except (TypeError, ValueError):
        return False


def brief_text(bid):
    t = open(f"{BRIEFS}/{bid}.md").read()
    return (t.split("---", 2)[2] if t.startswith("---") else t).strip()


def brief_numbers(bid):
    t = brief_text(bid).lower().replace(",", "")
    out = set()
    for n in re.findall(r"\d+\.?\d*", t):
        try:
            out.add(float(n))
        except ValueError:
            pass
    for n, suf in re.findall(r"(\d+\.?\d*)\s*([km])\b", t):
        out.add(float(n) * (1000 if suf == "k" else 1_000_000))
    for w, v in {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10, "twelve": 12}.items():
        if re.search(rf"\b{w}\b", t):
            out.add(float(v))
    return out


# ------------------------------------------------------------------ rich model gates

def rich_user_numbers(m):
    """(value, unit_class, where) for every number the model attributes to the USER."""
    out = []
    for f in m.get("user_facts", []):
        if f.get("value") is not None:
            out.append((f["value"], unit_class(f.get("unit")), f"user_fact:{f.get('id')}"))
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            # A categorical lever carries `selects` (a branch name) and no number; it is not a
            # user-attributed MAGNITUDE and must not be scored as one.
            if l.get("value") is not None and not l.get("selects") \
                    and l.get("epistemic_state") in ("known", "observed", "user_estimate"):
                out.append((l["value"], unit_class(l.get("unit")), f"lever:{o.get('id')}->{l.get('factor_id')}"))
    for fa in m.get("factors", []):
        if fa.get("current_value") is not None and fa.get("provenance") == "user":
            out.append((fa["current_value"], unit_class(fa.get("unit")), f"factor:{fa.get('id')}"))
    for c in m.get("constraints", []):
        # A qualitative limit carries no number by design (operator "qualitative", value null);
        # it cannot be a user-attributed MAGNITUDE and must not be scored as one.
        if c.get("provenance") == "user" and c.get("value") is not None and c.get("operator") != "qualitative":
            out.append((c.get("value"), unit_class(c.get("unit")), f"constraint:{c.get('id')}"))
    return out


def gates_rich(m, oracle, bid):
    g, nums = {}, rich_user_numbers(m)

    miss, approx = [], []
    for e in oracle["expected_user_values"]:
        ucls = unit_class(e["unit"])
        hit = [n for n in nums if exactly(n[0], e["value"]) and (n[1] == ucls or n[1] is None or ucls is None)]
        if hit:
            continue
        loose = [n for n in nums if close(n[0], e["value"])]
        (approx if loose else miss).append(f"{e['value']}{e['unit']}({e['role']})")
    g["G1"] = ("PASS" if not miss and not approx else "FAIL",
               ("all present" if not miss and not approx else
                f"missing={miss} convention_shifted={approx}"))

    # G2 — no user-attributed number that is ABSENT from the brief.
    #
    # ⚠ CORRECTED 22 Sep, after reading the failures rather than the counts. The first version
    # compared against the brief's literal digits only, so it failed a model for recording
    # "next quarter" as value 1 with transformation "next quarter → 1, unit quarters" — a
    # derivation the contract explicitly requires the model to DECLARE, and which
    # run_arms.py's source-binding validator already accepts. The gate was stricter than the
    # contract it scores, which is the same class of error as the G3 inconsistency fixed earlier.
    #
    # A number is now in-brief if its magnitude appears literally, OR the fact that carries it
    # declares a transformation. An UNDECLARED number absent from the brief still FAILS — that is
    # the discriminating half, and `declared_transformations` below is reported so a reader can
    # see how much work the exemption is doing.
    bn = brief_numbers(bid)
    declared = {f.get("id") for f in m.get("user_facts", []) if f.get("transformation")}
    declared_levers = set()
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            if l.get("source_fact_id") in declared:
                declared_levers.add(f"lever:{o.get('id')}->{l.get('factor_id')}")
    bad = []
    for v, u, w in nums:
        if v is None or any(close(v, b) for b in bn):
            continue
        if w.startswith("user_fact:") and w.split(":", 1)[1] in declared:
            continue
        if w in declared_levers:
            continue
        bad.append(f"{v}@{w}")
    g["G2"] = ("PASS" if not bad else "FAIL",
               ("none" + (f" ({len(declared)} declared transformation(s) honoured)" if declared else ""))
               if not bad else f"user-attributed, absent from brief, NO declared transformation: {bad}")

    # G3 — an invented BASELINE: a current-state value asserted as fact with nothing behind it.
    # NOT every AI-chosen number: an ai_proposed OPTION may legitimately name a new price the
    # brief never mentions, provided it is labelled as the model's. Presenting a current reading
    # the user never gave is the failure. Kept identical in shape to the CEE branch so the two
    # arms are measured by the same rule.
    inv = []
    for fa in m.get("factors", []):
        v = fa.get("current_value")
        if v is None:
            continue
        labelled_ai = fa.get("provenance") == "ai_proposed" or fa.get("epistemic_state") == "ai_hypothesis"
        in_brief = any(close(v, b) for b in bn)
        if fa.get("epistemic_state") == "unknown":
            inv.append(f"factor:{fa.get('id')}={v} (epistemic_state unknown but a value is asserted)")
        elif not labelled_ai and not fa.get("source_fact_id"):
            inv.append(f"factor:{fa.get('id')}={v} (claimed {fa.get('epistemic_state')} with no anchor)")
        elif not labelled_ai and not in_brief:
            inv.append(f"factor:{fa.get('id')}={v} (user-side baseline absent from the brief)")
    g["G3"] = ("PASS" if not inv else "FAIL", "none" if not inv else f"invented baselines: {inv}")

    exp = oracle["expected_constraints"]
    if not exp:
        g["G4"] = ("NA", "brief declares no numeric limit")
    else:
        bad4 = []
        for e in exp:
            found = [c for c in m.get("constraints", []) if close(c.get("value"), e["value"])]
            if not found:
                bad4.append(f"{e['keyword']} {e['operator']}{e['value']} absent")
            elif e["strict"] and not any(c.get("operator") in ("<", ">") for c in found):
                bad4.append(f"{e['keyword']}: strict '{e['operator']}' recorded as "
                            f"{[c.get('operator') for c in found]}")
            elif not e["strict"] and not any(c.get("operator") in ("<=", ">=") for c in found):
                bad4.append(f"{e['keyword']}: non-strict recorded as {[c.get('operator') for c in found]}")
        g["G4"] = ("PASS" if not bad4 else "FAIL", "operators exact" if not bad4 else "; ".join(bad4))

    sigs, dups = defaultdict(list), []
    for o in m.get("options", []):
        # Include `selects` in the signature: two options choosing DIFFERENT branches of the same
        # categorical lever are different options, and grouping them by (factor, null) collided.
        sig = tuple(sorted((l.get("factor_id"),
                            l.get("selects") if l.get("selects")
                            else (round(float(l["value"]), 4) if l.get("value") is not None else None))
                           for l in o.get("lever_settings", [])))
        if sig:
            sigs[sig].append((o.get("id"), o.get("provenance")))
    for sig, os_ in sigs.items():
        if len(os_) > 1 and any(p == "user" for _, p in os_):
            dups.append(f"{[i for i, _ in os_]} share lever set {sig}")
    g["G5"] = ("PASS" if not dups else "FAIL", "no duplicate of a user option" if not dups else "; ".join(dups))

    cons_subj = {c.get("subject_id") for c in m.get("constraints", [])}
    out_ids = {o.get("id") for o in m.get("outcomes", [])}
    lab = {f.get("id"): (f.get("label") or "").lower() for f in m.get("factors", [])}
    lab.update({o.get("id"): (o.get("label") or "").lower() for o in m.get("outcomes", [])})
    ctrl = {f.get("id"): f.get("control") for f in m.get("factors", [])}
    bad6 = []
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            t = l.get("factor_id")
            why = None
            if t in cons_subj:
                why = "is a constrained subject"
            elif t in out_ids:
                why = "is an outcome"
            elif ctrl.get(t) in ("external", "observable"):
                why = f"is control={ctrl.get(t)}"
            elif any(k in lab.get(t, "") for k in oracle["constrained_subjects"]):
                why = "label matches a constrained subject"
            if why:
                bad6.append(f"{o.get('id')}->{t} {why}")
    g["G6"] = ("PASS" if not bad6 else "FAIL", "levers only" if not bad6 else "; ".join(bad6))

    want = (oracle.get("expected_temporal") or []) + (oracle.get("expected_qualitative") or [])
    if not want:
        g["G7"] = ("NA", "brief declares none")
    else:
        blob = json.dumps(m, ensure_ascii=False).lower()
        lost = [w for w in want if not any(tok in blob for tok in w.lower().split() if len(tok) > 3)]
        g["G7"] = ("PASS" if not lost else "FAIL", "preserved" if not lost else f"lost: {lost}")

    bad8 = [f"factor:{f.get('id')}" for f in m.get("factors", [])
            if f.get("epistemic_state") == "unknown" and f.get("current_value") is not None]
    # G8 — an unknown must stay unknown. A magnitude kind of "unknown" or "qualitative" carrying a
    # number is a fabrication dressed as a record; "model_prior" with a number is FINE because it is
    # disclosed as the model's, which is the whole point of the taxonomy.
    bad8 += [f"link:{l.get('id')} ({(l.get('magnitude') or {}).get('kind')} with a value)"
             for l in m.get("causal_links", [])
             if (l.get("magnitude") or {}).get("kind") in ("unknown", "qualitative")
             and (l.get("magnitude") or {}).get("value") is not None]
    g["G8"] = ("PASS" if not bad8 else "FAIL", "unknowns stay unknown" if not bad8 else "; ".join(bad8))
    return g


# ------------------------------------------------------------------ CEE V3 control gates

def gates_cee(v3, oracle, bid):
    g = {}
    nodes = v3.get("nodes", [])
    opts = v3.get("options", []) or [n for n in nodes if n.get("kind") == "option"]
    USER_SRC = {"brief_extraction", "user_specified"}

    user_nums = []
    for o in opts:
        for fid, iv in (o.get("interventions") or {}).items():
            if not isinstance(iv, dict):
                continue
            if iv.get("source") in USER_SRC:
                user_nums.append((iv.get("raw_value", iv.get("value")), unit_class(iv.get("unit")),
                                  f"{o.get('id')}->{fid}"))
    for n in nodes:
        d = n.get("data") or {}
        if d.get("raw_value") is not None and d.get("extractionType") != "inferred":
            user_nums.append((d["raw_value"], unit_class(d.get("unit")), f"node:{n.get('id')}"))
    for c in v3.get("goal_constraints", []) or []:
        if c.get("provenance") in ("explicit", "user", "brief_extraction"):
            pre = (c.get("provenance_unit_relabelled") or {}).get("pre_normalisation_value")
            user_nums.append((pre if pre is not None else c.get("value"),
                              unit_class((c.get("provenance_unit_relabelled") or {}).get("pre_normalisation_unit") or c.get("unit")),
                              f"constraint:{c.get('constraint_id')}"))

    miss = []
    for e in oracle["expected_user_values"]:
        if not any(close(n[0], e["value"]) for n in user_nums):
            miss.append(f"{e['value']}{e['unit']}({e['role']})")
    g["G1"] = ("PASS" if not miss else "FAIL",
               "all present with user attribution" if not miss else f"not user-attributed: {miss}")

    bn = brief_numbers(bid)
    bad = [f"{v}@{w}" for v, u, w in user_nums if v is not None and not any(close(v, b) for b in bn)]
    g["G2"] = ("PASS" if not bad else "FAIL", "none" if not bad else f"{bad}")

    # G3 — same rule as the rich branch: an invented BASELINE, not merely an AI-chosen number.
    # A `cee_hypothesis` intervention IS labelled, so a model-proposed £54 alternative is not a G3
    # failure (it is an AI option, which is allowed). What fails is a node's current-state value
    # that is presented as the user's or as fact while being absent from the brief and unanchored.
    inv = []
    for n in nodes:
        d = n.get("data") or {}
        v = d.get("raw_value", d.get("value"))
        if v is None:
            continue
        labelled_ai = d.get("extractionType") == "inferred" or d.get("source") in ("cee_inference", "cee_hypothesis")
        if not labelled_ai and not any(close(v, b) for b in bn):
            inv.append(f"node:{n.get('id')}={v} (source={d.get('source')}, extractionType={d.get('extractionType')})")
    for o in opts:
        for fid, iv in (o.get("interventions") or {}).items():
            if not isinstance(iv, dict):
                continue
            rv = iv.get("raw_value", iv.get("value"))
            if rv is not None and iv.get("source") in USER_SRC and not any(close(rv, b) for b in bn):
                inv.append(f"{o.get('id')}->{fid}={rv} (claimed {iv.get('source')} but absent from brief)")
    g["G3"] = ("PASS" if not inv else "FAIL", "none" if not inv else f"invented baselines: {inv}")

    exp = oracle["expected_constraints"]
    if not exp:
        g["G4"] = ("NA", "brief declares no numeric limit")
    else:
        bad4 = []
        for e in exp:
            found = [c for c in (v3.get("goal_constraints") or []) if close(c.get("value"), e["value"])]
            if not found:
                bad4.append(f"{e['keyword']} absent")
            elif e["strict"]:
                ops = [c.get("operator") for c in found]
                disclosed = any(c.get("strictness") or c.get("relaxed_to") for c in found)
                if not any(o in ("<", ">") for o in ops) and not disclosed:
                    bad4.append(f"strict '{e['operator']}{e['value']}' silently recorded as {ops}")
        g["G4"] = ("PASS" if not bad4 else "FAIL", "operators exact" if not bad4 else "; ".join(bad4))

    sigs = defaultdict(list)
    for o in opts:
        sig = tuple(sorted((fid, round(float(iv["value"]), 4) if isinstance(iv, dict) and iv.get("value") is not None else None)
                           for fid, iv in (o.get("interventions") or {}).items()))
        if sig:
            sigs[sig].append(o.get("id"))
    dups = [f"{v} share {k}" for k, v in sigs.items() if len(v) > 1]
    g["G5"] = ("PASS" if not dups else "FAIL", "none" if not dups else "; ".join(dups))

    cons_nodes = {c.get("node_id") for c in (v3.get("goal_constraints") or [])}
    kinds = {n.get("id"): n.get("kind") for n in nodes}
    labels = {n.get("id"): (n.get("label") or "").lower() for n in nodes}
    bad6 = []
    for o in opts:
        for fid in (o.get("interventions") or {}):
            if fid in cons_nodes:
                bad6.append(f"{o.get('id')}->{fid} is constrained")
            elif kinds.get(fid) in ("outcome", "risk"):
                bad6.append(f"{o.get('id')}->{fid} is {kinds.get(fid)}")
            elif any(k in labels.get(fid, "") for k in oracle["constrained_subjects"]):
                bad6.append(f"{o.get('id')}->{fid} label is a constrained subject")
    g["G6"] = ("PASS" if not bad6 else "FAIL", "levers only" if not bad6 else "; ".join(bad6))

    want = (oracle.get("expected_temporal") or []) + (oracle.get("expected_qualitative") or [])
    if not want:
        g["G7"] = ("NA", "brief declares none")
    else:
        blob = json.dumps(v3, ensure_ascii=False).lower()
        lost = [w for w in want if not any(t in blob for t in w.lower().split() if len(t) > 3)]
        g["G7"] = ("PASS" if not lost else "FAIL", "preserved" if not lost else f"lost: {lost}")

    g["G8"] = ("NA", "V3 carries no epistemic_state to check")
    return g


# ------------------------------------------------------------------ quality

def quality_rich(m):
    links = m.get("causal_links", [])
    ai_add = [x for k in ("options", "factors", "outcomes") for x in m.get(k, [])
              if x.get("provenance") == "ai_proposed"]
    return {
        "options": len(m.get("options", [])),
        "user_options": sum(1 for o in m.get("options", []) if o.get("provenance") == "user"),
        "factors": len(m.get("factors", [])),
        "outcomes": len(m.get("outcomes", [])),
        "risks": sum(1 for o in m.get("outcomes", []) if o.get("kind") == "risk"),
        "links": len(links),
        "mediated": sum(1 for l in links if l.get("mediator_id")),
        "temporal": sum(1 for l in links if (l.get("temporal") or {}).get("delay")
                        or (l.get("temporal") or {}).get("duration")
                        or (l.get("temporal") or {}).get("persistence") not in (None, "unknown")),
        "qualitative": sum(1 for f in m.get("factors", []) if f.get("measurability") == "qualitative"),
        "external": sum(1 for f in m.get("factors", []) if f.get("control") == "external"),
        "unknowns": len(m.get("unknowns", [])),
        "notes": len(m.get("notes", [])),
        "enrichment": len(ai_add) + sum(1 for l in links if l.get("provenance") == "ai_hypothesis"),
        "dsk_cites": sum(len(x.get("dsk_refs") or []) for k in ("factors", "outcomes", "causal_links", "notes")
                         for x in m.get(k, [])),
    }


def quality_cee(v3):
    nodes = v3.get("nodes", [])
    opts = v3.get("options", []) or [n for n in nodes if n.get("kind") == "option"]
    return {
        "options": len(opts),
        "user_options": sum(1 for o in opts if (o.get("provenance") or {}).get("source") == "brief_extraction"
                            or o.get("provenance") == "from_brief"),
        "factors": sum(1 for n in nodes if n.get("kind") == "factor"),
        "outcomes": sum(1 for n in nodes if n.get("kind") == "outcome"),
        "risks": sum(1 for n in nodes if n.get("kind") == "risk"),
        "links": len(v3.get("edges", [])),
        "mediated": 0, "temporal": 0,
        "qualitative": 0,
        "external": sum(1 for n in nodes if n.get("category") == "external"),
        "unknowns": 0,
        "notes": len(v3.get("record_disclosures") or []),
        "enrichment": sum(1 for o in opts if (o.get("provenance") or {}).get("source") == "cee_hypothesis"),
        "dsk_cites": 0,
    }


# ------------------------------------------------------------------ main

def collect():
    rows = []
    for rp in sorted(glob.glob(f"{BASE}/arms/*/*/run_*/result.json")):
        r = json.load(open(rp))
        d = os.path.dirname(rp)
        bid = r["brief"]
        if bid not in ORACLES:
            continue
        if r.get("fatal"):
            rows.append({"arm": r["slug"], "brief": bid, "run": r["run"], "fatal": r["fatal"][:120],
                         "gates": {}, "q": {}, "latency_ms": r.get("total_latency_ms"),
                         "cost": r.get("total_cost_usd"), "calls": len(r.get("calls", []))})
            continue
        try:
            m = json.load(open(f"{d}/final_model.json"))
        except FileNotFoundError:
            continue
        rows.append({"arm": r["slug"], "brief": bid, "run": r["run"], "fatal": None,
                     "gates": gates_rich(m, ORACLES[bid], bid), "q": quality_rich(m),
                     "latency_ms": r.get("total_latency_ms"), "cost": r.get("total_cost_usd"),
                     "calls": len(r.get("calls", [])),
                     "bind_ok": (r.get("widener_validation") or r.get("builder_validation") or {}).get("ok"),
                     "immut_ok": (r.get("immutability") or {}).get("ok")})
    for p in sorted(glob.glob(f"{BASE}/armA/*/run_*.json")):
        bid = os.path.basename(os.path.dirname(p))
        if bid not in ORACLES:
            continue
        v3 = json.load(open(p))
        if "nodes" not in v3:
            continue
        t = (v3.get("_timings") or {}).get("draft_graph", {})
        rows.append({"arm": "A-current-cee", "brief": bid,
                     "run": int(re.search(r"run_(\d+)", p).group(1)), "fatal": None,
                     "gates": gates_cee(v3, ORACLES[bid], bid), "q": quality_cee(v3),
                     "latency_ms": t.get("total_ms"), "cost": None,
                     "calls": 3, "bind_ok": None, "immut_ok": None})
    return rows


GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]


def main():
    rows = collect()
    if not rows:
        print("no results yet")
        return
    by_arm = defaultdict(list)
    for r in rows:
        by_arm[r["arm"]].append(r)

    print("=" * 118)
    print("HARD TRUST GATES — failures per arm (a single FAIL fails that brief)")
    print("=" * 118)
    hdr = f"{'arm':<40}{'runs':>5}{'fatal':>6}  " + "".join(f"{g:>6}" for g in GATES) + f"{'clean':>8}"
    print(hdr)
    print("-" * 118)
    order = sorted(by_arm, key=lambda a: (a != "A-current-cee", a))
    for arm in order:
        rs = by_arm[arm]
        ok = [r for r in rs if not r["fatal"]]
        cells = []
        for g in GATES:
            f = sum(1 for r in ok if r["gates"].get(g, ("NA",))[0] == "FAIL")
            na = sum(1 for r in ok if r["gates"].get(g, ("NA",))[0] == "NA")
            cells.append(f"{f}" if f else ("·" if na == len(ok) and ok else "✓"))
        clean = sum(1 for r in ok if not any(r["gates"].get(g, ("NA",))[0] == "FAIL" for g in GATES))
        print(f"{arm:<40}{len(rs):>5}{sum(1 for r in rs if r['fatal']):>6}  "
              + "".join(f"{c:>6}" for c in cells) + f"{f'{clean}/{len(ok)}':>8}")
    print("\nkey: number = runs FAILING that gate · ✓ = all pass · · = not applicable to every run")

    print("\n" + "=" * 118)
    print("QUALITY / RICHNESS — mean per run (gate failures NOT excluded; read with the table above)")
    print("=" * 118)
    qk = ["options", "user_options", "factors", "outcomes", "risks", "links", "mediated",
          "temporal", "qualitative", "external", "unknowns", "enrichment"]
    print(f"{'arm':<40}" + "".join(f"{k[:6]:>8}" for k in qk) + f"{'sec':>8}{'$':>9}")
    print("-" * 118)
    for arm in order:
        ok = [r for r in by_arm[arm] if not r["fatal"]]
        if not ok:
            print(f"{arm:<40}{'— all runs failed —':>60}")
            continue
        cells = "".join(f"{statistics.mean([r['q'].get(k, 0) for r in ok]):>8.1f}" for k in qk)
        lat = [r["latency_ms"] for r in ok if r["latency_ms"]]
        cs = [r["cost"] for r in ok if r["cost"] is not None]
        print(f"{arm:<40}{cells}"
              f"{(statistics.mean(lat) / 1000 if lat else 0):>8.1f}"
              f"{(f'{statistics.mean(cs):.3f}' if cs else 'n/a'):>9}")

    print("\n" + "=" * 118)
    print("PER-BRIEF GATE DETAIL — every FAIL, with its evidence")
    print("=" * 118)
    for arm in order:
        for r in sorted(by_arm[arm], key=lambda x: (x["brief"], x["run"])):
            if r["fatal"]:
                print(f"{arm} / {r['brief']} run{r['run']}: FATAL {r['fatal']}")
                continue
            fails = [(g, r["gates"][g][1]) for g in GATES if r["gates"].get(g, ("NA",))[0] == "FAIL"]
            if fails:
                print(f"\n{arm} / {r['brief']} run{r['run']}")
                for g, ev in fails:
                    print(f"   {g} FAIL  {ev[:200]}")

    print("\n" + "=" * 118)
    print("CORPUS SPLIT — captured (Paul's real briefs) vs authored (evaluator fixtures)")
    print("=" * 118)
    print(f"{'arm':<40}{'captured clean':>18}{'authored clean':>18}")
    print("-" * 118)
    for arm in order:
        ok = [r for r in by_arm[arm] if not r["fatal"]]
        out = []
        for cls in ("captured", "authored"):
            sub = [r for r in ok if ORACLES[r["brief"]]["corpus_class"] == cls]
            c = sum(1 for r in sub if not any(r["gates"].get(g, ("NA",))[0] == "FAIL" for g in GATES))
            out.append(f"{c}/{len(sub)}" if sub else "—")
        print(f"{arm:<40}{out[0]:>18}{out[1]:>18}")

    json.dump(rows, open(f"{BASE}/SCORES.json", "w"), indent=1, default=str)
    print(f"\nrows: {len(rows)}  ->  {BASE}/SCORES.json")


if __name__ == "__main__":
    main()

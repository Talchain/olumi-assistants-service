#!/usr/bin/env python3
"""Rich decision model -> GraphV3-shaped analysis projection, with an honest loss report
and the post-projection provenance gate (Paul's amendment 2).

The projection NEVER invents a number and NEVER defaults a provenance. A rich item whose
provenance cannot be mapped raises — the opposite of the schema-v3.ts:457 fail-open shape,
where an absent `extractionType` silently becomes `brief_extraction` (i.e. "the user said it").

G9, the post-projection gate:
  - every projected number's source is the mapped image of its rich provenance
  - user-bound stays user-bound; ai stays ai
  - absent/unknown provenance is an ERROR, never a default to user authority
  - deleting the provenance switch must turn the gate RED (see --mutant)
"""
import json, sys, hashlib, glob, os, argparse
from collections import Counter

USER_EPISTEMIC = {"known", "observed", "user_estimate"}
PROV_MAP = {"user": "brief_extraction", "ai_proposed": "cee_hypothesis", "ai_hypothesis": "cee_hypothesis"}


def sha8(s):
    return hashlib.sha256(str(s).encode()).hexdigest()[:8]


def map_provenance(prov, epistemic=None, mutant=False):
    """The one place authorship is decided. No default branch: an unknown provenance raises."""
    if mutant:
        # MUTANT: the schema-v3.ts:457 shape — anything not explicitly 'inferred' becomes the
        # user's word. Exists only so the gate can be shown to go RED without the real mapping.
        return "cee_hypothesis" if prov in ("ai_proposed", "ai_hypothesis") else "brief_extraction"
    if prov in PROV_MAP:
        if prov == "user" and epistemic is not None and epistemic not in USER_EPISTEMIC:
            return "cee_hypothesis"
        return PROV_MAP[prov]
    raise ValueError(f"unmappable provenance {prov!r} — refusing to default to user authority")


def lever_source(l, mutant=False):
    """Authorship of ONE option->factor number. This is the exact decision that
    schema-v3.ts:457 gets wrong in production, so it is isolated here and mutated in tests.

    REAL   : the user's word only when the model both claims a user epistemic state AND
             anchors it to a user fact. Anything else is ours.
    MUTANT : the fail-open shape — user's word unless something explicitly says otherwise.
             An unanchored or unknown lever is silently promoted to user authority."""
    if mutant:
        return "cee_hypothesis" if l.get("epistemic_state") == "ai_hypothesis" else "brief_extraction"
    if l.get("epistemic_state") in USER_EPISTEMIC and l.get("source_fact_id"):
        return "brief_extraction"
    return "cee_hypothesis"


def project(rich, mutant=False):
    omitted, nodes, edges, constraints = [], [], [], []
    idmap = {}

    def nid(x):
        idmap.setdefault(x, sha8(x))
        return idmap[x]

    dec = rich.get("decision", {}) or {}
    hz = dec.get("horizon") or {}
    goal_id = nid("__goal__")
    nodes.append({"id": goal_id, "kind": "goal", "label": dec.get("question") or "Decision goal",
                  "data": {}})
    if hz.get("value") is not None:
        omitted.append({"id": "decision.horizon", "reason": "no_horizon_field_in_target",
                        "detail": f"{hz.get('value')} {hz.get('unit')} has nowhere to land in GraphV3"})
    nodes.append({"id": nid("__decision__"), "kind": "decision", "label": "Decision", "data": {}})

    for f in rich.get("factors", []):
        cat = {"lever": "controllable", "observable": "observable", "external": "external"}.get(f.get("control"))
        if cat is None:
            raise ValueError(f"unmappable control {f.get('control')!r} on factor {f.get('id')}")
        d = {}
        if f.get("measurability") == "qualitative":
            omitted.append({"id": f["id"], "reason": "qualitative",
                            "detail": f"{f.get('label')!r} has no numeric representation in the target"})
        if f.get("current_value") is not None:
            src = map_provenance(f.get("provenance"), f.get("epistemic_state"), mutant)
            # ── observed_state.source IS A SECOND, DIFFERENT CLAIM ────────────────────────────
            # Raised by the OpenAI Connected PoC lane and verified here: CEE's money invariant
            # (src/cee/provenance/money-invariant.ts:211) gates its ENTIRE audit on
            # `observed_state.source === 'brief_extraction'`. A figure projected with only
            # `data.source` set is SILENTLY EXEMPT from the check asking whether that figure
            # actually appears in the brief. Two claims are needed, not one:
            #   provenance.source        — who put the ENTITY in the model
            #   observed_state.source    — where the VALUE came from  (the invariant reads this)
            #
            # ⛔ `cap` is deliberately NOT set. It feeds isAmountStatedInBrief, and a wrong cap
            # yields a confidently wrong reconciliation — worse than no reconciliation. Until a
            # cap can be carried legitimately from the rich model, the figure stays unaudited and
            # that is the honest state.
            d = {"value": f["current_value"], "raw_value": f["current_value"],
                 "unit": f.get("unit"),
                 "extractionType": "explicit" if f.get("provenance") == "user" else "inferred",
                 "source": src,
                 "observed_state": {"value": f["current_value"], "unit": f.get("unit"),
                                    "source": src}}
        else:
            omitted.append({"id": f["id"], "reason": "no_value",
                            "detail": f"{f.get('label')!r} carries no value; none invented"})
        nodes.append({"id": nid(f["id"]), "kind": "factor", "label": f.get("label"),
                      "category": cat, "data": d,
                      "provenance": "from_brief" if f.get("provenance") == "user" else "ai_inferred"})

    for o in rich.get("outcomes", []):
        nodes.append({"id": nid(o["id"]), "kind": "risk" if o.get("kind") == "risk" else "outcome",
                      "label": o.get("label"), "data": {},
                      "provenance": "from_brief" if o.get("provenance") == "user" else "ai_inferred"})
        if o.get("measurability") == "qualitative":
            omitted.append({"id": o["id"], "reason": "qualitative", "detail": o.get("label")})

    for op in rich.get("options", []):
        iv = {}
        for l in op.get("lever_settings", []):
            if l.get("value") is None:
                omitted.append({"id": f"{op['id']}->{l.get('factor_id')}", "reason": "no_value",
                                "detail": "lever set without a number; none invented"})
                continue
            src = lever_source(l, mutant)
            iv[nid(l["factor_id"])] = {"value": l["value"], "raw_value": l["value"],
                                       "unit": l.get("unit"), "source": src,
                                       "value_confidence": "high" if src == "brief_extraction" else "low"}
        nodes.append({"id": nid(op["id"]), "kind": "option", "label": op.get("label"),
                      "interventions": iv, "is_baseline": bool(op.get("is_status_quo")),
                      "provenance": "from_brief" if op.get("provenance") == "user" else "ai_inferred"})
        # ── STRUCTURAL EDGES: decision -> option -> each lever it sets ────────────────────────
        # Measured 22 Sep: without these, PLoT reported "Graph has 2 disconnected components" and
        # scored 0 options, because an option carrying an `interventions` map but no edges is an
        # island. The live product's accepted graph has exactly these edges (e.g.
        # `14d36e6f -> ed5b5711` at mean 1.0, std 0.01), so this is the target's own convention,
        # not an invention of mine.
        #
        # ⚠ These are STRUCTURAL, not causal claims. "This option sets this lever" is a fact about
        # the option's definition, so strength 1.0 is a statement of identity rather than an
        # estimated effect size — which is why it does NOT count as an invented magnitude, and why
        # each one is flagged `structural: True` so a scorer can exclude it.
        edges.append({"from": nid("__decision__"), "to": nid(op["id"]),
                      "exists_probability": 1.0, "effect_direction": "positive",
                      "strength": {"mean": 1.0, "std": 0.01},
                      "provenance": {"source": "brief_extraction" if op.get("provenance") == "user"
                                     else "cee_hypothesis"},
                      "structural": True})
        for fid in iv:
            edges.append({"from": nid(op["id"]), "to": fid,
                          "exists_probability": 1.0, "effect_direction": "positive",
                          "strength": {"mean": 1.0, "std": 0.01},
                          "provenance": {"source": iv[fid].get("source", "cee_hypothesis")},
                          "structural": True})

    for l in rich.get("causal_links", []):
        mag = l.get("magnitude") or {}
        if mag.get("kind") in (None, "unknown", "qualitative") or mag.get("value") is None:
            omitted.append({"id": l.get("id"), "reason": "unknown_magnitude",
                            "detail": f"{l.get('from_id')}->{l.get('to_id')} strength unknown; no placeholder written"})
            strength = None
        else:
            strength = float(mag["value"])
        t = l.get("temporal") or {}
        if t.get("delay") or t.get("duration") or t.get("persistence") not in (None, "unknown"):
            omitted.append({"id": l.get("id"), "reason": "temporal",
                            "detail": f"delay={t.get('delay')} duration={t.get('duration')} persistence={t.get('persistence')}"})
        if l.get("mediator_id"):
            omitted.append({"id": l.get("id"), "reason": "mediator",
                            "detail": f"mediated by {l.get('mediator_id')}"})
        e = {"from": nid(l.get("from_id")), "to": nid(l.get("to_id")),
             "exists_probability": 0.5,
             "effect_direction": l.get("effect") if l.get("effect") in ("positive", "negative") else None,
             "provenance": {"source": map_provenance(l.get("provenance"), None, mutant)}}
        if strength is None:
            e["magnitude_placeholder"] = True
        else:
            e["strength"] = {"mean": strength, "std": abs(strength) * 0.25}
        edges.append(e)

    # ── the goal must be reachable, or the analysis engine refuses the graph ──────────────
    # Measured 22 Sep: PLoT /v2/run returned 422 NO_PATH_TO_GOAL on 6/6 projected models while the
    # live product's own graph returned 200 computed through the same probe. Cause: the rich model
    # named a goal but never said which outcome MEASURES it, so nothing connected an option to the
    # goal. v0.1 of the contract adds decision.goal_measured_by. When it is present we use it; when
    # it is absent we link the outcomes and DISCLOSE the inference rather than passing it off as
    # the model's own structure.
    measured_by = dec.get("goal_measured_by")
    outcome_ids = [o["id"] for o in rich.get("outcomes", []) if o.get("kind") != "risk"]
    if measured_by and measured_by in {o["id"] for o in rich.get("outcomes", [])}:
        edges.append({"from": nid(measured_by), "to": goal_id, "exists_probability": 1.0,
                      "effect_direction": "positive", "strength": {"mean": 1.0, "std": 0.0},
                      "provenance": {"source": "brief_extraction"}, "goal_measurement": True})
    elif outcome_ids:
        for oid in outcome_ids:
            edges.append({"from": nid(oid), "to": goal_id, "exists_probability": 1.0,
                          "effect_direction": "positive", "strength": {"mean": 1.0, "std": 0.0},
                          "provenance": {"source": "cee_hypothesis"},
                          "goal_measurement": True, "inferred": True})
        omitted.append({"id": "decision.goal_measured_by", "reason": "goal_link_inferred",
                        "detail": f"model did not say which outcome measures the goal; linked {len(outcome_ids)} "
                                  f"outcome(s) so the graph is analysable, marked cee_hypothesis"})

    disclosures = []
    for c in rich.get("constraints", []):
        op = c.get("operator")
        if op in ("<", ">"):
            proj = "<=" if op == "<" else ">="
            disclosures.append({"constraint_id": c.get("id"), "original_operator": op,
                                "projected_operator": proj,
                                "note": "target contract has no strict inequality; relaxation DISCLOSED"})
            constraints.append({"constraint_id": c.get("id"), "node_id": nid(c.get("subject_id")),
                                "operator": proj, "value": c.get("value"), "unit": c.get("unit"),
                                "strictness": "strict", "relaxed_to": proj,
                                "provenance": map_provenance(c.get("provenance"), None, mutant)})
            omitted.append({"id": c.get("id"), "reason": "strict_operator",
                            "detail": f"{op}{c.get('value')} cannot be represented; projected {proj} WITH disclosure"})
        elif op in ("<=", ">="):
            constraints.append({"constraint_id": c.get("id"), "node_id": nid(c.get("subject_id")),
                                "operator": op, "value": c.get("value"), "unit": c.get("unit"),
                                "strictness": "non_strict",
                                "provenance": map_provenance(c.get("provenance"), None, mutant)})
        else:
            omitted.append({"id": c.get("id"), "reason": "unsupported_operator",
                            "detail": f"operator {op!r} has no target representation"})

    graph = {"nodes": nodes, "edges": edges, "goal_constraints": constraints,
             "goal_node_id": goal_id, "schema_version": "v3-projected"}
    report = {"included_nodes": len(nodes), "included_edges": len(edges),
              "omitted": omitted, "omitted_by_reason": dict(Counter(o["reason"] for o in omitted)),
              "disclosures": disclosures}
    return graph, report


def gate_g9(rich, graph):
    """Post-projection provenance gate. Every projected number must carry the mapped image of its
    rich provenance, and nothing may arrive unlabelled."""
    fails = []
    rich_prov = {}
    for f in rich.get("factors", []):
        rich_prov[sha8(f["id"])] = f.get("provenance")
    for o in rich.get("options", []):
        rich_prov[sha8(o["id"])] = o.get("provenance")

    user_levers = set()
    for o in rich.get("options", []):
        for l in o.get("lever_settings", []):
            if l.get("epistemic_state") in USER_EPISTEMIC and l.get("source_fact_id") and l.get("value") is not None:
                user_levers.add((sha8(o["id"]), sha8(l["factor_id"])))

    for n in graph["nodes"]:
        d = n.get("data") or {}
        if d.get("value") is not None and not d.get("source"):
            fails.append({"gate": "G9_unlabelled", "item": n["id"],
                          "detail": "projected value with no source"})
        if d.get("source") and rich_prov.get(n["id"]) == "ai_proposed" and d["source"] == "brief_extraction":
            fails.append({"gate": "G9_laundered", "item": n["id"],
                          "detail": "ai_proposed value projected as user-supplied"})
        for fid, iv in (n.get("interventions") or {}).items():
            if not iv.get("source"):
                fails.append({"gate": "G9_unlabelled", "item": f"{n['id']}->{fid}",
                              "detail": "intervention with no source"})
                continue
            is_user = (n["id"], fid) in user_levers
            if iv["source"] == "brief_extraction" and not is_user:
                fails.append({"gate": "G9_laundered", "item": f"{n['id']}->{fid}",
                              "detail": "non-user lever projected as brief_extraction"})
            if iv["source"] != "brief_extraction" and is_user:
                fails.append({"gate": "G9_demoted", "item": f"{n['id']}->{fid}",
                              "detail": "user-bound lever lost its user attribution"})
    for c in graph.get("goal_constraints", []):
        if not c.get("provenance"):
            fails.append({"gate": "G9_unlabelled", "item": c.get("constraint_id"),
                          "detail": "constraint with no provenance"})
    return {"ok": not fails, "failures": fails}


CONTROL = {
    "decision": {"question": "Fabricated control", "horizon": {"value": None, "unit": None, "source_fact_id": None}},
    "user_facts": [{"id": "uf1", "kind": "quantity", "source_quote": "x", "value": 10,
                    "unit": "GBP", "role": "current", "transformation": None}],
    "options": [{"id": "opt1", "label": "Anchored user option", "provenance": "user",
                 "source_fact_id": "uf1", "is_status_quo": False, "rationale": None,
                 "lever_settings": [{"factor_id": "f1", "value": 10, "unit": "GBP",
                                     "epistemic_state": "known", "source_fact_id": "uf1"}]},
                {"id": "opt2", "label": "AI option with an UNANCHORED number", "provenance": "ai_proposed",
                 "source_fact_id": None, "is_status_quo": False, "rationale": "r",
                 "lever_settings": [{"factor_id": "f1", "value": 99, "unit": "GBP",
                                     "epistemic_state": "unknown", "source_fact_id": None}]}],
    "factors": [{"id": "f1", "label": "Lever", "control": "lever", "measurability": "quantitative",
                 "epistemic_state": "known", "current_value": None, "unit": "GBP",
                 "provenance": "user", "source_fact_id": "uf1", "dsk_refs": []}],
    "outcomes": [], "constraints": [], "causal_links": [], "unknowns": [], "notes": [],
}


def run_control():
    """Discriminating pair. Same input, one line of logic different."""
    out = []
    for mut in (False, True):
        g, _ = project(CONTROL, mutant=mut)
        r = gate_g9(CONTROL, g)
        src = {f"{n['id']}->{fid}": iv["source"]
               for n in g["nodes"] for fid, iv in (n.get("interventions") or {}).items()}
        out.append((mut, r["ok"], r["failures"], src))
    real, mutant = out
    print("CONTROL, real mapping   : G9", "PASS" if real[1] else "FAIL", "|", real[3])
    print("CONTROL, fail-open mutant: G9", "PASS" if mutant[1] else "FAIL", "|", mutant[3])
    for f in mutant[2]:
        print("   mutant caught:", f["gate"], f["item"], "-", f["detail"])
    ok = real[1] and not mutant[1]
    print("\nDISCRIMINATES:", "YES — the gate is load-bearing" if ok else
          "NO — the gate would pass a laundering projection; do not trust it")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="/Users/paulslee/Documents/GitHub/output/model-gen-20260921/arms/*/*/run_*/final_model.json")
    ap.add_argument("--mutant", action="store_true", help="run the fail-open mutant to prove G9 discriminates")
    ap.add_argument("--control", action="store_true", help="run the fabricated discriminating pair and exit")
    a = ap.parse_args()
    if a.control:
        sys.exit(0 if run_control() else 1)
    files = sorted(glob.glob(a.glob))
    agg, g9fail, errs = Counter(), 0, 0
    per_arm = {}
    for f in files:
        rich = json.load(open(f))
        arm = f.split("/arms/")[1].split("/")[0]
        try:
            g, rep = project(rich, mutant=a.mutant)
        except ValueError as e:
            errs += 1
            continue
        res = gate_g9(rich, g)
        if not res["ok"]:
            g9fail += 1
        json.dump({"graph": g, "report": rep, "g9": res},
                  open(os.path.join(os.path.dirname(f), "projection.json"), "w"), indent=1)
        for k, v in rep["omitted_by_reason"].items():
            agg[k] += v
        d = per_arm.setdefault(arm, Counter())
        d["runs"] += 1
        d["g9_fail"] += 0 if res["ok"] else 1
        for k, v in rep["omitted_by_reason"].items():
            d[k] += v
    mode = "MUTANT (fail-open provenance)" if a.mutant else "REAL provenance mapping"
    print(f"=== projection over {len(files)} models — {mode} ===")
    print(f"G9 post-projection provenance gate: {g9fail} FAIL / {len(files) - errs} projected"
          f"{f'  ({errs} refused to project)' if errs else ''}")
    print("\nwhat the analysis projection LOSES, summed over all runs:")
    for k, v in agg.most_common():
        print(f"  {k:<24}{v}")
    print(f"\n{'arm':<42}{'runs':>5}{'g9F':>5}  losses by reason")
    for arm, d in sorted(per_arm.items()):
        loss = ", ".join(f"{k}={d[k]}" for k in sorted(d) if k not in ("runs", "g9_fail"))
        print(f"{arm:<42}{d['runs']:>5}{d['g9_fail']:>5}  {loss}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Arm runner for the Olumi model-generation bake-off.

Arms:
  builder      — <model> strict JSON schema, builder prompt only            (Arm B / challengers)
  claude-rich  — claude-sonnet-4-6 via Anthropic output_config, builder prompt (Arm A')
  widener      — builder(<builder-model>) then widener(<widener-model>)      (Arm C / D)

Everything is captured: request, raw response, parsed model, latency, tokens, cost,
source-binding validation, widener immutability. Idempotent: a run whose result.json
exists is skipped unless --force.

Usage:
  python3 run_arms.py --arm builder --model gpt-4.1 --briefs pricing-staging --runs 3
  python3 run_arms.py --arm claude-rich --model claude-sonnet-4-6 --briefs pricing-staging --runs 3
  python3 run_arms.py --arm widener --model gpt-4.1 --widener-model gpt-5.6-terra \
      --widener-effort high --briefs pricing-staging --runs 3 [--dsk]
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error, hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = "/Users/paulslee/Documents/GitHub"
CLONE = f"{ROOT}/cee-model-gen-20260921"
CONTRACTS = f"{CLONE}/tools/graph-evaluator/contracts"
BRIEFS = f"{CLONE}/tools/graph-evaluator/briefs"
OUT_BASE = f"{ROOT}/output/model-gen-20260921/arms"
DSK_PATH = f"{CLONE}/data/dsk/v1.json"

# Published list prices, USD per 1M tokens. Anything not listed is recorded as UNVERIFIED (None).
PRICING = {
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "claude-sonnet-4-6": (3.00, 15.00),
    # Verified 21 Sep 2026 from developers.openai.com/api/docs/pricing (standard tier).
    "gpt-5.6-terra": (2.00, 12.00),
    "gpt-5.6-sol": (4.00, 20.00),
    "gpt-5.6-luna": (0.20, 1.20),
}


def env_key(name, files):
    for f in files:
        try:
            with open(f, "rb") as fh:
                for line in fh.read().decode("utf-8", "replace").splitlines():
                    if line.startswith(name + "="):
                        return line.split("=", 1)[1].strip().strip("'\"")
        except FileNotFoundError:
            continue
    raise SystemExit(f"{name} not found in {files}")


OPENAI_KEY = env_key("OPENAI_API_KEY", [f"{ROOT}/olumi-assistants-service/.env"])
ANTHROPIC_KEY = env_key("ANTHROPIC_API_KEY", [f"{ROOT}/olumi-assistants-service/.env"])


def post(url, headers, body, timeout=300):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), int((time.time() - t0) * 1000), None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return None, int((time.time() - t0) * 1000), f"HTTP {e.code}: {raw[:2000]}"
    except Exception as e:  # noqa: BLE001
        return None, int((time.time() - t0) * 1000), f"{type(e).__name__}: {e}"


def load_schema():
    s = json.load(open(f"{CONTRACTS}/rich-decision-model.v0.json"))
    s.pop("$schema", None)
    s.pop("$id", None)
    return s


def anthropic_compat(schema):
    """Anthropic's JSON-schema validator rejects an `enum` that contains null alongside a
    ["string","null"] type union (OpenAI accepts it). Exactly ONE field in the v0 contract has
    that shape: decision.horizon.unit. Rather than weaken the canonical contract, rewrite that
    ONE construct for the Anthropic call and move the allowed values into the description — the
    deterministic validator enforces the enum for every arm, so no meaning is lost. Recorded as a
    portability finding, not a schema change."""
    import copy
    s = copy.deepcopy(schema)
    rewritten = []

    def walk(o, path=""):
        if isinstance(o, dict):
            e = o.get("enum")
            if isinstance(e, list) and None in e:
                vals = [v for v in e if v is not None]
                o.pop("enum")
                o["description"] = (o.get("description", "") + " One of: " +
                                    ", ".join(map(str, vals)) + "; or null.").strip()
                rewritten.append(path)
            for k, v in o.items():
                walk(v, path + "/" + k)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, path + f"[{i}]")

    walk(s)
    return s, rewritten


def load_brief(bid):
    txt = open(f"{BRIEFS}/{bid}.md").read()
    if txt.startswith("---"):
        txt = txt.split("---", 2)[2]
    return txt.strip()


def cost_usd(model, tin, tout):
    base = model.split(":")[0]
    p = PRICING.get(base)
    if not p or tin is None or tout is None:
        return None
    return round(tin / 1e6 * p[0] + tout / 1e6 * p[1], 6)


# ---------------------------------------------------------------- providers

def call_openai(model, system, user, schema, effort=None, temperature=0):
    body = {
        "model": model,
        "instructions": system,
        "input": user,
        "text": {"format": {"type": "json_schema", "name": "rich_decision_model",
                            "strict": True, "schema": schema}},
    }
    # Reasoning models reject temperature; non-reasoning ones accept 0. Probe order:
    # send temperature, and on a 400 that names it, retry without.
    if effort:
        body["reasoning"] = {"effort": effort}
    else:
        body["temperature"] = temperature
    resp, ms, err = post("https://api.openai.com/v1/responses",
                         {"Authorization": f"Bearer {OPENAI_KEY}",
                          "Content-Type": "application/json"}, body)
    if err and "temperature" in err and "temperature" in body:
        body.pop("temperature")
        resp, ms2, err = post("https://api.openai.com/v1/responses",
                              {"Authorization": f"Bearer {OPENAI_KEY}",
                               "Content-Type": "application/json"}, body)
        ms += ms2
    if err:
        return {"ok": False, "error": err, "latency_ms": ms, "request": body}
    txt = "".join(c.get("text", "") for o in resp.get("output", [])
                  if o.get("type") == "message" for c in o.get("content", []))
    u = resp.get("usage", {}) or {}
    tin, tout = u.get("input_tokens"), u.get("output_tokens")
    return {"ok": True, "text": txt, "latency_ms": ms, "request": body, "raw": resp,
            "model_resolved": resp.get("model"), "input_tokens": tin, "output_tokens": tout,
            "reasoning_tokens": (u.get("output_tokens_details") or {}).get("reasoning_tokens"),
            "est_cost_usd": cost_usd(model, tin, tout), "status": resp.get("status")}


def call_anthropic(model, system, user, schema, max_tokens=16384, temperature=0, enforce=True):
    """enforce=False sends the schema as PROSE instead of output_config.

    Why the option exists (measured 21 Sep 2026): Anthropic's structured-output validator caps a
    schema at 16 union-typed ("nullable") parameters. The v0 rich contract has 27, so the API
    refuses it outright:
      "Schemas contains too many parameters with union types (27 parameters with type arrays or
       anyOf) ... limit: 16".
    That is a hard portability wall, not a formatting nit, and it is the same class of budget the
    Producer lane hit on the OLD grammar. Arm A' therefore runs prompt-only so the model-vs-contract
    comparison still happens; the difference in enforcement is reported, never hidden."""
    schema, rewritten = anthropic_compat(schema)
    if enforce:
        sys_text, extra = system, {"output_config": {"format": {"type": "json_schema", "schema": schema}}}
    else:
        sys_text = (system + "\n\nReturn ONLY a single raw JSON object conforming exactly to this "
                    "JSON Schema. No prose, no markdown fences, no trailing text. Every property "
                    "listed in a `required` array must be present; use null where a value is "
                    "genuinely unknown.\n\n" + json.dumps(schema, ensure_ascii=False))
        extra = {}
    body = {
        "model": model, "max_tokens": max_tokens, "temperature": temperature,
        "system": sys_text, "messages": [{"role": "user", "content": user}],
        **extra,
        "thinking": {"type": "disabled"},
    }
    resp, ms, err = post("https://api.anthropic.com/v1/messages",
                         {"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01",
                          "Content-Type": "application/json"}, body)
    if err:
        return {"ok": False, "error": err, "latency_ms": ms, "request": body}
    txt = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
    u = resp.get("usage", {}) or {}
    tin, tout = u.get("input_tokens"), u.get("output_tokens")
    return {"ok": True, "text": txt, "latency_ms": ms, "request": body, "raw": resp,
            "model_resolved": resp.get("model"), "input_tokens": tin, "output_tokens": tout,
            "est_cost_usd": cost_usd(model, tin, tout), "status": resp.get("stop_reason"),
            "schema_rewrites": rewritten, "schema_enforced": enforce}


# ---------------------------------------------------------------- validation

WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
         "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "twenty": 20}


def norm_ws(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def value_supported_by(quote, value, transformation):
    """Is `value` recoverable from the quote's own characters, or declared as a transformation?"""
    if value is None:
        return True, "null"
    q = (quote or "").lower()
    nums = [n.replace(",", "") for n in re.findall(r"\d[\d,]*\.?\d*", q)]
    floats = []
    for n in nums:
        try:
            floats.append(float(n))
        except ValueError:
            pass
    if any(abs(f - value) < 1e-9 for f in floats):
        return True, "literal"
    # k / m suffix (£20k -> 20000)
    for n, suf in re.findall(r"(\d[\d,]*\.?\d*)\s*([km])\b", q):
        try:
            base = float(n.replace(",", "")) * (1000 if suf == "k" else 1_000_000)
        except ValueError:
            continue
        if abs(base - value) < 1e-9:
            return True, "k_m_suffix"
    for w, v in WORDS.items():
        if re.search(rf"\b{w}\b", q) and abs(v - value) < 1e-9:
            return True, "number_word"
    if transformation:
        return True, f"declared_transformation: {transformation}"
    return False, "unsupported"


def strip_fences(t):
    t = (t or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    i, j = t.find("{"), t.rfind("}")
    return t[i:j + 1] if i != -1 and j > i else t


def validate_source_binding(rich, brief):
    """Every provenance:user item must be anchored to a verbatim span whose digits support its value."""
    fails = []
    bl, bn = brief.lower(), norm_ws(brief)
    facts = {f["id"]: f for f in rich.get("user_facts", [])}
    for f in rich.get("user_facts", []):
        q = f.get("source_quote") or ""
        if q.lower() in bl:
            how = "exact"
        elif norm_ws(q) in bn:
            how = "whitespace_normalised"
        else:
            fails.append({"gate": "quote_in_brief", "item": f["id"],
                          "detail": f"quote not found: {q[:90]!r}"})
            how = None
        ok, why = value_supported_by(q, f.get("value"), f.get("transformation"))
        if not ok:
            fails.append({"gate": "value_supported_by_quote", "item": f["id"],
                          "detail": f"value {f.get('value')} not derivable from {q[:60]!r}"})
        f["_binding"] = {"quote_match": how, "value_support": why}

    def check_ref(kind, item, prov_field="provenance", ref="source_fact_id"):
        p = item.get(prov_field)
        r = item.get(ref)
        if p == "user" and not r:
            fails.append({"gate": "user_needs_anchor", "item": f"{kind}:{item.get('id')}",
                          "detail": "provenance user with no source_fact_id"})
        if r and r not in facts:
            fails.append({"gate": "dangling_fact_ref", "item": f"{kind}:{item.get('id')}",
                          "detail": f"source_fact_id {r} does not exist"})

    for o in rich.get("options", []):
        check_ref("option", o)
        for l in o.get("lever_settings", []):
            if l.get("epistemic_state") in ("known", "observed", "user_estimate") and not l.get("source_fact_id"):
                fails.append({"gate": "lever_value_needs_anchor",
                              "item": f"option:{o.get('id')}->{l.get('factor_id')}",
                              "detail": f"{l.get('epistemic_state')} value with no source_fact_id"})
            if l.get("source_fact_id") and l["source_fact_id"] not in facts:
                fails.append({"gate": "dangling_fact_ref",
                              "item": f"option:{o.get('id')}->{l.get('factor_id')}",
                              "detail": f"source_fact_id {l['source_fact_id']} missing"})
    for k in ("factors", "outcomes", "constraints"):
        for it in rich.get(k, []):
            check_ref(k[:-1], it)
    for fa in rich.get("factors", []):
        if fa.get("current_value") is not None and fa.get("epistemic_state") in ("known", "observed", "user_estimate") \
                and not fa.get("source_fact_id"):
            fails.append({"gate": "baseline_needs_anchor", "item": f"factor:{fa.get('id')}",
                          "detail": f"current_value {fa['current_value']} claimed {fa.get('epistemic_state')} with no anchor"})
        if fa.get("current_value") is not None and fa.get("epistemic_state") == "unknown":
            fails.append({"gate": "unknown_with_value", "item": f"factor:{fa.get('id')}",
                          "detail": "epistemic_state unknown but current_value is set"})
    return {"ok": not fails, "failures": fails}


def user_slice(rich):
    """The part of a model a widener must not touch."""
    return {
        "user_facts": rich.get("user_facts", []),
        "options": [o for o in rich.get("options", []) if o.get("provenance") == "user"],
        "constraints": [{k: v for k, v in c.items()} for c in rich.get("constraints", [])
                        if c.get("provenance") == "user"],
        "decision": rich.get("decision"),
    }


def check_immutability(builder_rich, widener_rich):
    a = json.dumps(user_slice(builder_rich), sort_keys=True, ensure_ascii=False)
    b = json.dumps(user_slice(widener_rich), sort_keys=True, ensure_ascii=False)
    if a == b:
        return {"ok": True, "failures": []}
    fails = []
    ba = {f["id"]: f for f in builder_rich.get("user_facts", [])}
    bb = {f["id"]: f for f in widener_rich.get("user_facts", [])}
    for k in set(ba) | set(bb):
        if k not in bb:
            fails.append({"gate": "user_fact_dropped", "item": k, "detail": json.dumps(ba[k])[:160]})
        elif k not in ba:
            fails.append({"gate": "user_fact_invented", "item": k, "detail": json.dumps(bb[k])[:160]})
        else:
            for fld in ("source_quote", "value", "unit", "role", "kind", "transformation"):
                if ba[k].get(fld) != bb[k].get(fld):
                    fails.append({"gate": "user_fact_mutated", "item": f"{k}.{fld}",
                                  "detail": f"{ba[k].get(fld)!r} -> {bb[k].get(fld)!r}"})
    ca = {c["id"]: c for c in builder_rich.get("constraints", [])}
    cb = {c["id"]: c for c in widener_rich.get("constraints", [])}
    for k, c in ca.items():
        if k not in cb:
            fails.append({"gate": "constraint_dropped", "item": k, "detail": json.dumps(c)[:160]})
        elif cb[k].get("operator") != c.get("operator") or cb[k].get("value") != c.get("value"):
            fails.append({"gate": "constraint_mutated", "item": k,
                          "detail": f"{c.get('operator')}{c.get('value')} -> {cb[k].get('operator')}{cb[k].get('value')}"})
    if not fails:
        fails.append({"gate": "user_slice_differs", "item": "-", "detail": "deep-equal failed; see saved models"})
    return {"ok": False, "failures": fails}


def enrichment_counts(rich, builder_rich=None):
    """Deterministic part of decision enrichment: what the widener ADDED, and whether it stayed honest."""
    def ids(m, k):
        return {x.get("id") for x in m.get(k, [])}
    c = {}
    for k in ("options", "factors", "outcomes", "causal_links", "unknowns", "notes"):
        if builder_rich is None:
            c[f"total_{k}"] = len(rich.get(k, []))
        else:
            c[f"added_{k}"] = len(ids(rich, k) - ids(builder_rich, k)) if k != "notes" \
                else max(0, len(rich.get("notes", [])) - len(builder_rich.get("notes", [])))
            c[f"total_{k}"] = len(rich.get(k, []))
    c["ai_options"] = sum(1 for o in rich.get("options", []) if o.get("provenance") == "ai_proposed")
    c["user_options"] = sum(1 for o in rich.get("options", []) if o.get("provenance") == "user")
    c["mediated_links"] = sum(1 for l in rich.get("causal_links", []) if l.get("mediator_id"))
    c["temporal_links"] = sum(1 for l in rich.get("causal_links", [])
                              if (l.get("temporal") or {}).get("persistence") not in (None, "unknown")
                              or (l.get("temporal") or {}).get("delay")
                              or (l.get("temporal") or {}).get("duration"))
    c["qualitative_factors"] = sum(1 for f in rich.get("factors", []) if f.get("measurability") == "qualitative")
    c["external_factors"] = sum(1 for f in rich.get("factors", []) if f.get("control") == "external")
    c["risks"] = sum(1 for o in rich.get("outcomes", []) if o.get("kind") == "risk")
    c["ai_numbers"] = sum(1 for f in rich.get("factors", [])
                          if f.get("provenance") == "ai_proposed" and f.get("current_value") is not None)
    c["links_with_invented_magnitude"] = sum(
        1 for l in rich.get("causal_links", [])
        if (l.get("magnitude") or {}).get("kind") == "ai_estimate" and (l.get("magnitude") or {}).get("value") is not None)
    c["dsk_citations"] = sum(len(x.get("dsk_refs") or []) for k in ("factors", "outcomes", "causal_links", "notes")
                             for x in rich.get(k, []))
    return c



def strip_values_for_review(rich):
    """Hand the widener STRUCTURE, never values — adopted from v6 dual-draft's
    serialise-graph-for-review.ts: "What M2 never sees, it cannot echo back as an invented value."

    Before this, the widener saw the whole builder output including every number and was asked in
    prose not to touch them; immutability was then CHECKED afterwards. This makes the failure
    unreachable instead of forbidden, and makes immutability hold BY CONSTRUCTION: the user-authored
    parts are restored deterministically from the builder's own output afterwards, so whatever the
    widener returns for them cannot matter.
    """
    import copy
    m = copy.deepcopy(rich)
    for f in m.get("user_facts", []):
        f["value"] = None
        f["unit"] = None
        f["transformation"] = None
    for o in m.get("options", []):
        for l in o.get("lever_settings", []):
            l["value"] = None
            l["unit"] = None
    for fa in m.get("factors", []):
        fa["current_value"] = None
        fa["unit"] = None
    for c in m.get("constraints", []):
        c["value"] = None
        c["unit"] = None
    for l in m.get("causal_links", []):
        mg = l.get("magnitude") or {}
        mg["value"] = None
        # ⚠ TEMPORAL BLOCKS ARE DELIBERATELY KEPT. Measured 22 Sep: blinding the widener cost 27%
        # of temporal richness (9.8 -> 7.2 per model) while costing nothing else. Delay, duration
        # and persistence are not magnitudes — they are structure, and they are exactly the material
        # GraphV3 cannot carry and the rich model exists for. Withholding them bought no safety and
        # lost the thing we are trying to preserve.
    return m


def restore_user_authored(builder_rich, widened):
    """Deterministic merge: the user-authored parts come from the BUILDER, never the widener.

    The widener was shown no values, so it cannot have preserved them; it is not asked to. Anything
    it returns in these slots is discarded and the builder's originals are put back. Immutability is
    then a property of the pipeline rather than a test that might one day fail.
    """
    import copy
    out = copy.deepcopy(widened)
    out["user_facts"] = copy.deepcopy(builder_rich.get("user_facts", []))
    out["decision"] = copy.deepcopy(builder_rich.get("decision", out.get("decision")))
    b_opts = {o["id"]: o for o in builder_rich.get("options", []) if o.get("provenance") == "user"}
    out["options"] = [copy.deepcopy(b_opts[o["id"]]) if o.get("id") in b_opts else o
                      for o in out.get("options", [])]
    for oid, bo in b_opts.items():
        if not any(o.get("id") == oid for o in out["options"]):
            out["options"].append(copy.deepcopy(bo))
    b_cons = {c["id"]: c for c in builder_rich.get("constraints", []) if c.get("provenance") == "user"}
    out["constraints"] = [copy.deepcopy(b_cons[c["id"]]) if c.get("id") in b_cons else c
                          for c in out.get("constraints", [])]
    b_fac = {f["id"]: f for f in builder_rich.get("factors", []) if f.get("provenance") == "user"}
    out["factors"] = [copy.deepcopy(b_fac[f["id"]]) if f.get("id") in b_fac else f
                      for f in out.get("factors", [])]
    return out


def dsk_allowlist(brief_text, limit=8):
    try:
        bundle = json.load(open(DSK_PATH))
    except Exception:  # noqa: BLE001
        return [], ""
    bl = brief_text.lower()
    tag_words = {"pricing": ["price", "pricing", "£", "$", "mrr", "subscription", "churn"],
                 "hiring": ["hire", "hiring", "developer", "engineer", "headcount", "tech lead"],
                 "market_entry": ["market", "expand", "country", "germany", "brazil", "japan", "international"],
                 "resource_allocation": ["budget", "burn", "runway", "allocate", "spend"],
                 "prioritisation": ["priorit", "focus", "instead of", "either"],
                 "product_strategy": ["product", "feature", "release", "roadmap"],
                 "go_to_market": ["channel", "wholesale", "retail", "sales", "cac"],
                 "general": []}
    tags = {t for t, ws in tag_words.items() if any(w in bl for w in ws)} or {"general"}
    picked = []
    for o in bundle.get("objects", []):
        if o.get("deprecated"):
            continue
        ot = set(o.get("context_tags") or [])
        if ot & tags or "general" in ot:
            picked.append(o)
        if len(picked) >= limit:
            break
    lines = [f"- {o['id']} ({o.get('type')}): {o.get('title')}" for o in picked]
    block = ("\n\nDecision-science principles you MAY cite (use these ids verbatim in dsk_refs; "
             "never invent an id):\n" + "\n".join(lines)) if lines else ""
    return [o["id"] for o in picked], block


# ---------------------------------------------------------------- one run

def one_run(arm, brief_id, run_idx, model, widener_model, widener_effort, use_dsk, schema,
            builder_sys, widener_sys, out_base, force):
    tag = f"{arm}:{model}" + (f"@{widener_effort}" if arm == "single" and widener_effort else "") + (f"->{widener_model}" + (f"@{widener_effort}" if widener_effort else "") if arm == "widener" else "")
    slug = re.sub(r"[^a-z0-9]+", "-", tag.lower()).strip("-") + ("-dsk" if use_dsk else "")
    d = f"{out_base}/{slug}/{brief_id}/run_{run_idx}"
    res_path = f"{d}/result.json"
    if os.path.exists(res_path) and not force:
        return json.load(open(res_path))
    os.makedirs(d, exist_ok=True)
    brief = load_brief(brief_id)

    result = {"arm": arm, "slug": slug, "brief": brief_id, "run": run_idx,
              "builder_model": model, "widener_model": widener_model if arm == "widener" else None,
              "widener_effort": widener_effort if arm == "widener" else None,
              "dsk": bool(use_dsk), "calls": []}

    if arm == "single":
        # ONE strong model, one call, doing faithfully-record AND widen together. This is the
        # control for the whole architecture question: if a single strong model matches
        # builder->widener on the finished validated model, the second call is not earning its
        # latency and cost. Both prompts are concatenated so the task is identical in substance.
        combined = (builder_sys + "\n\n── AND, IN THE SAME PASS, WIDEN AND CRITIQUE ──\n" +
                    widener_sys.replace("You receive (a) a decision brief written by a person and "
                                        "(b) a faithful structured model of what they said, built by "
                                        "another process.",
                                        "You are doing this in the same pass as the faithful record "
                                        "above, so treat what you have just recorded as the model to "
                                        "widen."))
        c1 = call_openai(model, combined, brief, schema, effort=widener_effort)
    elif arm in ("claude-rich", "claude-rich-prompt"):
        c1 = call_anthropic(model, builder_sys, brief, schema, enforce=(arm == "claude-rich"))
    else:
        c1 = call_openai(model, builder_sys, brief, schema)
    json.dump(c1.get("raw") or {"error": c1.get("error")}, open(f"{d}/builder_response.json", "w"), indent=1)
    json.dump(c1.get("request"), open(f"{d}/builder_request.json", "w"), indent=1)
    result["calls"].append({k: c1.get(k) for k in
                            ("ok", "error", "latency_ms", "input_tokens", "output_tokens",
                             "reasoning_tokens", "est_cost_usd", "model_resolved", "status")} | {"stage": "builder"})
    if not c1["ok"]:
        result["fatal"] = c1["error"]
        json.dump(result, open(res_path, "w"), indent=1)
        return result
    try:
        builder_rich = json.loads(strip_fences(c1["text"]))
    except Exception as e:  # noqa: BLE001
        result["fatal"] = f"builder JSON parse failed: {e}"
        open(f"{d}/builder_text.txt", "w").write(c1["text"])
        json.dump(result, open(res_path, "w"), indent=1)
        return result
    json.dump(builder_rich, open(f"{d}/builder_model.json", "w"), indent=1, ensure_ascii=False)
    result["builder_validation"] = validate_source_binding(json.loads(json.dumps(builder_rich)), brief)
    final_rich = builder_rich

    if arm == "widener":
        ids, block = dsk_allowlist(brief, 8) if use_dsk else ([], "")
        result["dsk_allowlist"] = ids
        # BLIND REVIEW: the widener sees structure and quotes, never values.
        review_view = strip_values_for_review(builder_rich)
        wuser = (f"<brief>\n{brief}\n</brief>\n\n<builder_model_structure_only>\n"
                 f"{json.dumps(review_view, ensure_ascii=False)}\n</builder_model_structure_only>\n\n"
                 "Values have been withheld from you deliberately. Do not attempt to supply them: "
                 "leave every null value null and add only structure, mechanisms, risks, options, "
                 "unknowns and notes.")
        c2 = call_openai(widener_model, widener_sys + block, wuser, schema, effort=widener_effort)
        json.dump(c2.get("raw") or {"error": c2.get("error")}, open(f"{d}/widener_response.json", "w"), indent=1)
        json.dump(c2.get("request"), open(f"{d}/widener_request.json", "w"), indent=1)
        result["calls"].append({k: c2.get(k) for k in
                                ("ok", "error", "latency_ms", "input_tokens", "output_tokens",
                                 "reasoning_tokens", "est_cost_usd", "model_resolved", "status")} | {"stage": "widener"})
        if not c2["ok"]:
            result["fatal"] = c2["error"]
            json.dump(result, open(res_path, "w"), indent=1)
            return result
        try:
            widened = json.loads(strip_fences(c2["text"]))
        except Exception as e:  # noqa: BLE001
            result["fatal"] = f"widener JSON parse failed: {e}"
            open(f"{d}/widener_text.txt", "w").write(c2["text"])
            json.dump(result, open(res_path, "w"), indent=1)
            return result
        json.dump(widened, open(f"{d}/widener_raw.json", "w"), indent=1, ensure_ascii=False)
        widened = restore_user_authored(builder_rich, widened)
        json.dump(widened, open(f"{d}/widener_model.json", "w"), indent=1, ensure_ascii=False)
        result["immutability"] = check_immutability(builder_rich, widened)
        result["widener_validation"] = validate_source_binding(json.loads(json.dumps(widened)), brief)
        result["enrichment"] = enrichment_counts(widened, builder_rich)
        final_rich = widened
    else:
        result["enrichment"] = enrichment_counts(builder_rich)

    json.dump(final_rich, open(f"{d}/final_model.json", "w"), indent=1, ensure_ascii=False)
    result["total_latency_ms"] = sum(c.get("latency_ms") or 0 for c in result["calls"])
    costs = [c.get("est_cost_usd") for c in result["calls"]]
    result["total_cost_usd"] = round(sum(c for c in costs if c is not None), 6) if all(c is not None for c in costs) else None
    result["cost_complete"] = all(c is not None for c in costs)
    result["model_sha8"] = hashlib.sha256(json.dumps(final_rich, sort_keys=True).encode()).hexdigest()[:8]
    json.dump(result, open(res_path, "w"), indent=1)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True, choices=["builder", "widener", "claude-rich", "claude-rich-prompt", "single"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--widener-model")
    ap.add_argument("--widener-effort")
    ap.add_argument("--briefs", required=True)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--dsk", action="store_true")
    ap.add_argument("--out", default=OUT_BASE)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()

    schema = load_schema()
    builder_sys = open(f"{CONTRACTS}/builder.v0.txt").read()
    widener_sys = open(f"{CONTRACTS}/widener.v0.txt").read()
    briefs = [b.strip() for b in a.briefs.split(",") if b.strip()]
    jobs = [(b, i) for b in briefs for i in range(1, a.runs + 1)]
    print(f"arm={a.arm} model={a.model} widener={a.widener_model} briefs={len(briefs)} runs={a.runs} jobs={len(jobs)}", flush=True)

    results = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(one_run, a.arm, b, i, a.model, a.widener_model, a.widener_effort,
                          a.dsk, schema, builder_sys, widener_sys, a.out, a.force): (b, i)
                for b, i in jobs}
        for f in as_completed(futs):
            b, i = futs[f]
            try:
                r = f.result()
            except Exception as e:  # noqa: BLE001
                print(f"  {b} run{i}  EXCEPTION {type(e).__name__}: {e}", flush=True)
                continue
            results.append(r)
            if r.get("fatal"):
                print(f"  {b} run{i}  FATAL {str(r['fatal'])[:160]}", flush=True)
            else:
                v = r.get("widener_validation") or r.get("builder_validation") or {}
                im = r.get("immutability") or {}
                e = r.get("enrichment", {})
                print(f"  {b} run{i}  {r['total_latency_ms']}ms  bind={'ok' if v.get('ok') else str(len(v.get('failures', [])))+'F'} "
                      f"immut={'ok' if im.get('ok') else ('-' if not im else str(len(im.get('failures', [])))+'F')} "
                      f"opts={e.get('total_options')} fac={e.get('total_factors')} out={e.get('total_outcomes')} "
                      f"lnk={e.get('total_causal_links')} unk={e.get('total_unknowns')} "
                      f"${r.get('total_cost_usd')}", flush=True)
    ok = [r for r in results if not r.get("fatal")]
    print(f"\ndone: {len(ok)}/{len(results)} produced a model", flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
draft_graph MODEL BAKE-OFF — the measurement the goal's "optimal mix of OpenAI
models" actually requires.

WHY THIS EXISTS. `draft_graph` is the call that dominates a turn, and until the
admin harness could reach a PMS-served prompt it 404'd on all 12 product prompt
ids, so **no model comparison for it has ever existed**. This drives the fixed
harness across arms with everything else held constant.

⛔ WHAT THIS CAN AND CANNOT CLAIM. The harness discloses its OWN divergence from
production in `harness_fidelity.divergences`, and its unconditional `notice`
applies to every run. A prior lane read "6 of 9 draws as clean" through a
grammar value that does not exist. So this licenses a RELATIVE ranking between
arms measured by the same instrument. It does NOT license an absolute
production latency or quality number, and this script refuses to print one.

⚠ gpt-5-mini is reasoning=false in MODEL_REGISTRY. It is deliberately included
(a "mix" needs a fast non-reasoning arm) but it is a DIFFERENT CLASS and
reasoning_effort does not apply to it. Reported separately, never pooled into an
effort comparison.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request, hashlib, statistics

BASE = os.environ.get("CEE_BASE", "https://cee-staging.onrender.com")
KEY  = os.environ.get("ADMIN_API_KEY", "")
RENDER_KEY = os.environ.get("RENDER_API_KEY", "")
CEE_SERVICE_ID = os.environ.get("CEE_SERVICE_ID", "srv-d4slpaili9vc73eiq4og")  # cee-staging, branch=staging, autoDeploy=yes
OUT  = os.environ.get("BAKEOFF_OUT", ".")
DRAWS = int(os.environ.get("BAKEOFF_DRAWS", "3"))
SEED = 987654321

# Fixed input, hashed into the report so a reader knows exactly what was sent.
BRIEF = (
    "We are a 40-person B2B SaaS company. Our enterprise renewal rate fell from "
    "91% to 78% over the last three quarters. We think the cause is either our "
    "onboarding being too slow, our support response times, or a competitor "
    "undercutting us on price. We need to decide where to focus next quarter."
)

# (label, model, reasoning_effort|None, class)
ARMS = [
    ("INCUMBENT claude-sonnet-5",  "claude-sonnet-5", None,     "contrast_control"),
    ("gpt-5.2 effort=low",         "gpt-5.2",         "low",    "openai_reasoning"),
    ("gpt-5.2 effort=medium",      "gpt-5.2",         "medium", "openai_reasoning"),
    ("gpt-5.2 effort=high",        "gpt-5.2",         "high",   "openai_reasoning"),
    ("o4-mini effort=low",         "o4-mini",         "low",    "openai_reasoning"),
    ("o4-mini effort=medium",      "o4-mini",         "medium", "openai_reasoning"),
    ("o4-mini effort=high",        "o4-mini",         "high",   "openai_reasoning"),
    ("gpt-5-mini (non-reasoning)", "gpt-5-mini",      None,     "openai_nonreasoning"),
]

def served_sha():
    """THE RENDER API IS THE ONLY AUTHORITY FOR WHAT CEE IS SERVING.

    MEASURED 23 Sep: CEE exposes **no** version endpoint. `/version.json`
    returns 401 without a key and a route-level 404 WITH a valid
    `X-Olumi-Assist-Key` — auth precedes routing, so the 401 never proved the
    route existed. `/health` and `/admin/v1/health` 404; `/api/health` 401s the
    same way.

    ⛔ Takes the deploy whose status is `live`, NOT the newest — measured in the
    same run, the newest was `build_in_progress` while a 14-minute-older commit
    was the one actually serving traffic.
    """
    if not RENDER_KEY:
        return "UNREADABLE:no RENDER_API_KEY in env"
    req = urllib.request.Request(
        f"https://api.render.com/v1/services/{CEE_SERVICE_ID}/deploys?limit=20",
        headers={"Authorization": f"Bearer {RENDER_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            items = json.loads(r.read())
        for it in items:
            d = it.get("deploy", it)
            if d.get("status") == "live":
                sha = ((d.get("commit") or {}).get("id") or "")
                if len(sha) != 40:
                    return f"UNREADABLE:live deploy sha len={len(sha)}"
                return sha
        return "UNREADABLE:no deploy with status==live in the last 20"
    except Exception as e:
        return f"UNREADABLE:{e}"

def call(model, effort, draw):
    body = {
        "prompt_id": "draft_graph",
        "version": 1,                 # echoed back; live_prompt_version is authority
        "brief": BRIEF,
        "options": {"model": model, "seed": SEED, "max_tokens": 8192},
    }
    if effort:
        body["options"]["reasoning_effort"] = effort
    req = urllib.request.Request(
        f"{BASE}/admin/v1/test-prompt-llm",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-admin-key": KEY},
        method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, json.loads(r.read()), round((time.time()-t0)*1000)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: j = json.loads(raw)
        except Exception: j = {"error": raw[:400].decode("utf-8","replace")}
        return e.code, j, round((time.time()-t0)*1000)
    except Exception as e:
        return 0, {"error": f"{type(e).__name__}: {e}"}, round((time.time()-t0)*1000)

if not KEY:
    print("FATAL: ADMIN_API_KEY not in env (never inline it).", file=sys.stderr); sys.exit(2)

sha_start = served_sha()
print(f"served SHA at start: {sha_start}")

# ── PREFLIGHT GATE ───────────────────────────────────────────────────────────
# Without this, a not-yet-deployed fix yields N 404s and a report of zeros that
# reads exactly like a measurement. Refuse to proceed instead.
print("preflight: can the harness reach the PMS-served draft_graph prompt?")
st, pf, ms = call("claude-sonnet-5", None, 0)
if st == 404:
    # MEASURED discriminator (23 Sep, deployed staging):
    #   handler : {"error":"not_found","message":"Prompt 'draft_graph' not found"}
    #   route   : {"message":"Route POST:/... not found","error":"Not Found","statusCode":404}
    # Conflating them would report "fix not deployed" for a route that had moved.
    if "statusCode" in pf and "Route" in str(pf.get("message", "")):
        print(f"BLOCKED: the ROUTE itself is gone: {pf.get('message')}. This is NOT the "
              f"undeployed-fix case — the harness path changed.", file=sys.stderr)
        sys.exit(6)
    print(f"BLOCKED: handler 404 — {pf.get('message')} ({ms}ms). The store has no "
          f"`draft_graph` record and the resolver fallback from #1755 is not deployed at "
          f"{sha_start}. No arms run, no report written.", file=sys.stderr)
    sys.exit(3)
if st != 200:
    print(f"BLOCKED: preflight HTTP {st}: {json.dumps(pf)[:400]}", file=sys.stderr); sys.exit(4)
rv = (pf.get("prompt") or {}).get("resolved_via")
if not rv:
    print(f"BLOCKED: 200 but no `resolved_via` — deployed build predates the fix. "
          f"Refusing to attribute results to it.", file=sys.stderr); sys.exit(5)
print(f"  ✅ preflight 200, resolved_via={rv}, "
      f"live_prompt_version={(pf.get('prompt') or {}).get('live_prompt_version')}")

rows, divergences, notices = [], set(), set()
for label, model, effort, klass in ARMS:
    for d in range(DRAWS):
        st, j, wall = call(model, effort, d)
        llm  = j.get("llm") or {}
        res  = j.get("result") or {}
        val  = res.get("validation") or {}
        gr   = res.get("graph") or {}
        fid  = j.get("harness_fidelity") or {}
        for x in fid.get("divergences") or []: divergences.add(x)
        if fid.get("notice"): notices.add(fid["notice"])
        raw = llm.get("raw_output") or ""
        # NON-VACUITY: a draw only counts if it really produced output.
        ok = (st == 200 and j.get("success") is True and len(raw) > 0)
        rows.append({
            "arm": label, "model": model, "effort": effort, "class": klass, "draw": d,
            "http": st, "counts_toward_stats": ok,
            "request_id": j.get("request_id"),          # identity binding, not a time window
            "error": None if ok else (j.get("error") or f"http_{st}")[:200],
            "duration_ms": llm.get("duration_ms"), "wall_ms": wall,
            "prompt_tok": (llm.get("token_usage") or {}).get("prompt"),
            "completion_tok": (llm.get("token_usage") or {}).get("completion"),
            "finish_reason": llm.get("finish_reason"),
            "provider": llm.get("provider"),
            "effort_echoed": llm.get("reasoning_effort"),
            "nodes": len(gr.get("nodes") or []), "edges": len(gr.get("edges") or []),
            "validation_passed": val.get("passed"),
            "error_count": val.get("error_count"), "warning_count": val.get("warning_count"),
        })
        print(f"  {label:30s} draw{d} http={st} ok={ok} "
              f"llm={llm.get('duration_ms')}ms nodes={len(gr.get('nodes') or [])} "
              f"edges={len(gr.get('edges') or [])} pass={val.get('passed')}")

sha_end = served_sha()
report = {
    "served_sha_start": sha_start, "served_sha_end": sha_end,
    "sha_stable": sha_start == sha_end,
    "base": BASE, "seed": SEED, "draws_per_arm": DRAWS,
    "brief_sha256": hashlib.sha256(BRIEF.encode()).hexdigest(),
    "brief": BRIEF,
    "preflight_resolved_via": rv,
    "live_version_expected_from_status_route": "202",  # measured 23 Sep via /admin/prompts/status
    "live_version_seen": (pf.get("prompt") or {}).get("live_prompt_version"),
    "harness_divergences": sorted(divergences),
    "harness_notices": sorted(notices),
    "claim_scope": ("RELATIVE ranking between arms on ONE instrument. NOT an absolute "
                    "production latency or quality figure — the harness discloses its own "
                    "divergences above and they apply to every row."),
    "rows": rows,
}
with open(os.path.join(OUT, "bakeoff-draft-graph.json"), "w") as f:
    json.dump(report, f, indent=2)

# ── SUMMARY, with vacuity refused per arm ────────────────────────────────────
print("\n=== draft_graph bake-off (relative, one instrument) ===")
if not report["sha_stable"]:
    print(f"⚠ SERVED SHA MOVED MID-RUN ({sha_start} -> {sha_end}) — rows straddle two builds.")
print(f"{'arm':30s} {'n':>3s} {'llm_p50':>8s} {'out_tok':>8s} {'nodes':>6s} {'edges':>6s} {'pass':>5s}")
for label, model, effort, klass in ARMS:
    rs = [r for r in rows if r["arm"] == label]
    ok = [r for r in rs if r["counts_toward_stats"]]
    if not ok:
        errs = {r["error"] for r in rs}
        print(f"{label:30s} {0:>3d}   BLOCKED — {'; '.join(sorted(errs))[:70]}")
        continue
    med = lambda k: statistics.median([r[k] for r in ok if isinstance(r[k], (int, float))]) if any(isinstance(r[k],(int,float)) for r in ok) else float("nan")
    print(f"{label:30s} {len(ok):>3d} {med('duration_ms'):>8.0f} {med('completion_tok'):>8.0f} "
          f"{med('nodes'):>6.0f} {med('edges'):>6.0f} "
          f"{sum(1 for r in ok if r['validation_passed']):>3d}/{len(ok)}")
print(f"\nharness divergences that apply to EVERY row above: {sorted(divergences) or '(none reported)'}")
print(f"report: {os.path.join(OUT,'bakeoff-draft-graph.json')}")

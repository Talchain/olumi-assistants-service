#!/usr/bin/env python3
"""Seed a fresh GUEST scenario on staging Supabase with the frozen canonical graph.

Re-homed from orchestrator-prompt-workstream/fixed-graph-harness/ (proven 2026-07-09,
3/3 determinism). Per FIXED-GRAPH-HARNESS-BUILD-NOTE.md: seed ONLY scenarios.graph
(+brief), user_id NULL (guest -> sidesteps MV409), zero v5_handler_facts
(-> freshness deterministically 'none'). The graph is read identically for
guest/owned by /orchestrate/v2/turn; analysis is deterministic (PLoT resolveSeed
on the frozen topology). Prints the new scenario id.

Usage: python3 seed-frozen-scenario.py [--graph <file>] [--title-prefix harness_v0_smoke_]
  --title-prefix   audit prefix for staging-mode discipline; the printed id is
                   what delete-scenarios.py reconciles by (capture it).
Env: STAGING_ENV_FILE (default <repo>/.env.staging.local) — creds never printed."""
import argparse, json, os, pathlib, urllib.error, urllib.request, uuid

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
ENV_FILE = os.environ.get("STAGING_ENV_FILE", str(REPO / ".env.staging.local"))

ap = argparse.ArgumentParser()
ap.add_argument("--graph", default=str(HERE.parent / "fixtures" / "frozen-graph.json"))
ap.add_argument("--brief", default=str(HERE.parent / "fixtures" / "frozen-brief.txt"))
ap.add_argument("--title-prefix", default="")
args = ap.parse_args()


def getenv(k):
    for l in open(ENV_FILE):
        if l.startswith(k + "="):
            return l.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"missing {k} in {ENV_FILE}")


SU, SK = getenv("SUPABASE_URL"), getenv("SUPABASE_SERVICE_ROLE_KEY")
g = json.load(open(args.graph))
brief = (open(args.brief).read() if os.path.exists(args.brief) else "") or "Frozen harness scenario"
sid = str(uuid.uuid4())
row = {"id": sid, "graph": g, "brief_text": brief, "scenario_schema_version": 1,
       "stage": "frame", "title": f"{args.title_prefix}FROZEN harness graph (disposable)"}
req = urllib.request.Request(SU + "/rest/v1/scenarios", data=json.dumps(row).encode(),
    headers={"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json",
             "Prefer": "return=minimal"}, method="POST")
# urlopen raises HTTPError on any 4xx/5xx (RLS denial, FK/schema violation) BEFORE a
# status check could run — catch it and surface the PostgREST error body.
try:
    r = urllib.request.urlopen(req, timeout=20)
except urllib.error.HTTPError as e:
    raise SystemExit(f"seed insert failed: {e.code} {e.read().decode()[:400]}")
if r.status != 201:
    raise SystemExit(f"seed insert unexpected status: {r.status}")
print(sid)

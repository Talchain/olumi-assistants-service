#!/usr/bin/env python3
"""Build a local FILE prompt store for a hermetic arm.

Re-homed from orchestrator-prompt-workstream/candidates/build-stores.py
(proven 2026-07). Mirrors every staging PMS row's SERVED content
(staging_version ?? active_version) byte-exact via read-only Supabase REST.
GOTCHA baked in: Postgres timestamps fail Zod datetime(), so createdAt is
forced to strict ISO-Z.

Default: a pure staging mirror (the v0 harness measures conversation quality,
not prompt A/B — the arm serves exactly what staging serves).
Optional:   --swap-orchestrator <content-file> --version <N> builds a candidate
arm store with only the orchestrator row swapped (prompt-A/B use).

Usage:
  python3 build-stores.py [--out stores/staging-mirror.json]
  python3 build-stores.py --swap-orchestrator cand.txt --version 120 --out stores/armX.json
Env: STAGING_ENV_FILE (default <repo>/.env.staging.local) — creds never printed.
"""
import argparse, datetime, hashlib, json, os, pathlib, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
ENV_FILE = os.environ.get("STAGING_ENV_FILE", str(REPO / ".env.staging.local"))

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(HERE.parent / "stores" / "staging-mirror.json"))
ap.add_argument("--swap-orchestrator", metavar="FILE", default=None)
ap.add_argument("--version", type=int, default=None)
args = ap.parse_args()
if args.swap_orchestrator and args.version is None:
    ap.error("--swap-orchestrator requires --version")

env = {}
for line in open(ENV_FILE):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
URL, KEY = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def rest(path):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
prompts_meta = rest("cee_prompts?select=id,task_id,status,active_version,staging_version,created_at,updated_at")
manifest, store_prompts = [], {}
for p in prompts_meta:
    served = p["staging_version"] if p["staging_version"] is not None else p["active_version"]
    rows = rest(f"cee_prompt_versions?prompt_id=eq.{p['id']}&version=eq.{served}"
                "&select=version,content,created_by,created_at,change_note")
    assert len(rows) == 1, f"{p['id']} v{served}: {len(rows)} rows"
    v = rows[0]
    store_prompts[p["id"]] = {
        "id": p["id"], "name": f"{p['task_id']} (staging mirror v{served})",
        "taskId": p["task_id"], "status": "production",
        "versions": [{
            "version": served, "content": v["content"],
            "createdBy": v.get("created_by") or "staging-mirror",
            "createdAt": now,  # strict ISO-Z; Postgres timestamp strings fail Zod datetime()
            "changeNote": f"mirror of staging served v{served}",
        }],
        "activeVersion": served, "stagingVersion": served, "createdAt": now, "updatedAt": now,
    }
    manifest.append({"id": p["id"], "served_version": served,
                     "content_sha16": hashlib.sha256(v["content"].encode()).hexdigest()[:16],
                     "content_chars": len(v["content"])})

if args.swap_orchestrator:
    content = open(args.swap_orchestrator).read()
    store_prompts["orchestrator_default"]["versions"] = [{
        "version": args.version, "content": content,
        "createdBy": "local-harness", "createdAt": now,
        "changeNote": "arm under assessment (local file store, never uploaded)",
    }]
    store_prompts["orchestrator_default"]["activeVersion"] = args.version
    store_prompts["orchestrator_default"]["stagingVersion"] = args.version

out = pathlib.Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"version": 1, "prompts": store_prompts, "lastModified": now}, indent=1))
(out.parent / "fetch-manifest.json").write_text(json.dumps(manifest, indent=1))
print(f"rows mirrored: {len(store_prompts)} -> {out} ({os.path.getsize(out)//1024}KB)")
if args.swap_orchestrator:
    t = content.replace("\r\n", "\n")
    t = "\n".join(l.rstrip() for l in t.split("\n")).strip()
    print(f"orchestrator swapped: v{args.version}, expected sent prompt_hash "
          f"{hashlib.sha256(t.encode()).hexdigest()[:16]}")

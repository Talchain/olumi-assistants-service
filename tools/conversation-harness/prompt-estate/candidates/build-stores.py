#!/usr/bin/env python3
"""Build the two arm prompt-store JSONs for the local A/B run.

Mirrors every staging PMS row's SERVED content (staging_version ?? active_version)
fetched read-only via Supabase REST, then sets the orchestrator row per arm:
  armA: orchestrator v111 content (frozen evidence/orchestrator_v111.txt), activeVersion 111
  armB: v42.2a candidate,                                             activeVersion 112
Outputs: stores/armA.json, stores/armB.json (+ a fetch manifest for the report).
"""
import json, os, pathlib, urllib.request, hashlib, datetime

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
OUT = WS / "candidates/stores"
OUT.mkdir(parents=True, exist_ok=True)

# creds (read-only use)
env = {}
for line in open("/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
URL, KEY = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]

def rest(path):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
prompts_meta = rest("cee_prompts?select=id,task_id,status,active_version,staging_version,created_at,updated_at")
manifest, store_prompts = [], {}
for p in prompts_meta:
    served = p["staging_version"] if p["staging_version"] is not None else p["active_version"]
    rows = rest(f"cee_prompt_versions?prompt_id=eq.{p['id']}&version=eq.{served}&select=version,content,created_by,created_at,change_note")
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

def with_orchestrator(content, version):
    sp = json.loads(json.dumps(store_prompts))  # deep copy
    sp["orchestrator_default"]["versions"] = [{
        "version": version, "content": content,
        "createdBy": "local-harness", "createdAt": now,
        "changeNote": "A/B arm under assessment (local file store, never uploaded)",
    }]
    sp["orchestrator_default"]["activeVersion"] = version
    sp["orchestrator_default"]["stagingVersion"] = version
    return {"version": 1, "prompts": sp, "lastModified": now}

v111 = (WS / "evidence/orchestrator_v111.txt").read_text()
cand = (WS / "candidates/v42.2a.txt").read_text()

(OUT / "armA.json").write_text(json.dumps(with_orchestrator(v111, 111), indent=1))
(OUT / "armB.json").write_text(json.dumps(with_orchestrator(cand, 112), indent=1))
(OUT / "fetch-manifest.json").write_text(json.dumps(manifest, indent=1))

def norm_hash(t):
    t = t.replace("\r\n", "\n")
    t = "\n".join(line.rstrip() for line in t.split("\n")).strip()
    return hashlib.sha256(t.encode()).hexdigest()[:16]

print(f"rows mirrored: {len(store_prompts)}")
print(f"armA orchestrator: v111, expected sent prompt_hash {norm_hash(v111)}")
print(f"armB orchestrator: v112, expected sent prompt_hash {norm_hash(cand)}")
print(f"armA.json {os.path.getsize(OUT/'armA.json')//1024}KB, armB.json {os.path.getsize(OUT/'armB.json')//1024}KB")

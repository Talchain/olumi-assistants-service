#!/usr/bin/env python3
"""Delete + verify-gone harness scenarios by id, with a hard reserved-scenario guard.

SAFETY (added 2026-07-10 after a code-review finding): this uses the SUPABASE
SERVICE_ROLE_KEY, which bypasses FORCE RLS, and the scenarios table FK-CASCADEs —
so a single wrong id irrecoverably destroys that scenario and all child rows.
Two guards, both must pass:
  1. RESERVED DENYLIST (hard abort): any id whose prefix is a standing hands-off
     scenario is refused — the whole run aborts, nothing is deleted.
  2. DRY-RUN by default: prints what WOULD be deleted; pass --execute to actually delete.

Usage:
  python3 delete-scenarios.py <id> [id...]              # dry-run (shows plan, deletes nothing)
  python3 delete-scenarios.py --execute <id> [id...]    # actually delete + verify-gone
"""
import sys, json, urllib.request, urllib.error

# Standing hands-off reserved-scenario prefixes (union of every reserved list on record)
# + the sonnet5-flip / -reflip evidence scenarios. NEVER deletable by this script.
RESERVED_PREFIXES = (
    "1909b083", "def3cb31", "8e0bf73d", "90385279", "104d65bd", "02099906",
    "2cd44277", "330ffc3c",
    # sonnet5-flip / sonnet5-reflip acceptance-evidence scenarios:
    "0ada46e1", "697e0e33", "c7191d97",
)

import os, pathlib
ENV = os.environ.get("STAGING_ENV_FILE", str(pathlib.Path(__file__).resolve().parent.parent.parent.parent / ".env.staging.local"))
def getenv(k):
    for l in open(ENV):
        if l.startswith(k + "="):
            return l.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"missing {k} in {ENV}")

args = sys.argv[1:]
execute = "--execute" in args
ids = [a for a in args if a != "--execute"]
if not ids:
    raise SystemExit("usage: delete-scenarios.py [--execute] <id> [id...]  (dry-run without --execute)")

# GUARD 1 — hard abort on any reserved id (before any network call)
reserved_hits = [i for i in ids if any(i.startswith(p) for p in RESERVED_PREFIXES)]
if reserved_hits:
    print("ABORT — reserved (hands-off) scenario id(s) present; nothing deleted:")
    for i in reserved_hits:
        print("   RESERVED:", i)
    raise SystemExit(2)

SU, SK = getenv("SUPABASE_URL"), getenv("SUPABASE_SERVICE_ROLE_KEY")
H = {"apikey": SK, "Authorization": "Bearer " + SK}
idlist = ",".join(ids)

# GUARD 2 — dry-run unless --execute
if not execute:
    req = urllib.request.Request(f"{SU}/rest/v1/scenarios?id=in.({idlist})&select=id,title,user_id", headers=H)
    rows = json.load(urllib.request.urlopen(req, timeout=15))
    print(f"DRY-RUN — {len(ids)} id(s) requested, {len(rows)} present on staging. Nothing deleted.")
    present = set()
    for r in rows:
        present.add(r["id"])
        print(f"   would delete: {r['id'][:8]}  title={r.get('title')!r}  owner={r.get('user_id')}")
    for m in (set(ids) - present):
        print(f"   not present (already gone): {m[:8]}")
    print("Re-run with --execute to delete.")
    raise SystemExit(0)

# EXECUTE
req = urllib.request.Request(f"{SU}/rest/v1/scenarios?id=in.({idlist})",
                             headers={**H, "Prefer": "return=representation"}, method="DELETE")
try:
    deleted = json.load(urllib.request.urlopen(req, timeout=25))
except urllib.error.HTTPError as e:
    raise SystemExit(f"DELETE failed: {e.code} {e.read().decode()[:300]}")
print("deleted:", len(deleted))
req2 = urllib.request.Request(f"{SU}/rest/v1/scenarios?id=in.({idlist})&select=id", headers=H)
left = json.load(urllib.request.urlopen(req2, timeout=15))
print("remaining:", "CLEAN" if not left else [r["id"][:8] for r in left])

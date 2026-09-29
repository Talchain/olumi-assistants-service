# v42.2g PMS upload runbook — orchestrator-executable (unblocks tonight's paired ship)

**Goal:** point the SERVED staging orchestrator prompt at **v42.2g** via `stagingVersion`.
Derived from the CEE code on `origin/staging` (admin.prompts.ts + prompts/schema.ts) — not a guess.

| | |
|---|---|
| Prompt id | `orchestrator_default` (seed.ts:197) |
| Base URL | `https://cee-staging.onrender.com` (healthz build confirmed reachable: 81392d1) |
| Auth | header `x-admin-key: <staging admin key>` (from the CEE staging env / the Prompt Admin Guide — **never paste it into logs/PRs**) |
| Content | `orchestrator-prompt-workstream/candidates/v42.2g.txt` — 21,965 chars (inside the loader window [18500, 22000]), normalised `sent_hash = 740aa5dae35aaa8b` |
| Mechanism | `POST /admin/prompts/:id/versions` (create version) → `PATCH /admin/prompts/:id` `{stagingVersion}` (pin). Both flat JSON bodies (the `.data` in code is Zod's safeParse accessor, not a wrapper). |

Request schemas (prompts/schema.ts): create-version = `{content:str(10..100000), createdBy:str(1..128) REQUIRED, changeNote?:str, requiresApproval?:bool=false, variables?:[]=[]}`; update = all-optional incl. `stagingVersion:int|null`, `modelConfig` is `.optional()` so a stagingVersion-only PATCH is valid.

```bash
BASE=https://cee-staging.onrender.com
ID=orchestrator_default
ADMIN_KEY='<paste staging admin key here — do not commit>'
CONTENT=/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/candidates/v42.2g.txt
# Durable revert-anchor path (NOT /tmp — tmp wipes are a proven hazard in this program; a revert
# may run in a later session). STEP 0 writes it here; the revert ladder reads it.
ANCHOR_FILE=/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/pms-revert-anchor.txt

# STEP 0 — record the current stagingVersion (this IS your prompt-revert anchor — capture it, do NOT
#   assume a hardcoded number: it changes with every upload). Saved to a file so the revert ladder can
#   read it even from a fresh shell.
ANCHOR=$(curl -s "$BASE/admin/prompts/$ID" -H "x-admin-key: $ADMIN_KEY" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('stagingVersion'))")
echo "REVERT ANCHOR — current stagingVersion = $ANCHOR"
[ -n "$ANCHOR" ] && [ "$ANCHOR" != "None" ] && echo "$ANCHOR" > "$ANCHOR_FILE" \
  || { echo "ABORT: could not read a valid current stagingVersion (bad key?) — do not proceed"; }

# STEP 1 — create the new version (build the JSON body from the file so newlines escape correctly)
python3 - "$CONTENT" > /tmp/v422g-body.json <<'PY'
import json,sys
print(json.dumps({
  "content": open(sys.argv[1]).read(),
  "createdBy": "orchestrator-prompt-workstream",
  "changeNote": "v42.2g answer_text landing — steer coach/converse to the answer_text channel",
  "requiresApproval": False,
}))
PY
NEWVER=$(curl -s -X POST "$BASE/admin/prompts/$ID/versions" \
  -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" --data @/tmp/v422g-body.json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);vs=d.get('versions',[]);print(vs[-1]['version'] if vs else d.get('version',''))")
echo "new version = $NEWVER"

# STEP 1.5 — GUARD: STEP 1 must have returned a numeric version. If the POST failed (bad admin key,
#   Zod-rejected body, non-JSON error), NEWVER is empty/garbage — DO NOT pin or reload, or you produce
#   exactly the "pinned but never served" failure this runbook exists to prevent. Abort the whole ladder.
case "$NEWVER" in
  ''|*[!0-9]*) echo "ABORT: STEP 1 did not return a numeric version (got '$NEWVER'). Staging unchanged. Do not run STEP 2/2.5."; return 2>/dev/null || exit 2 ;;
esac

# STEP 2 — pin staging to the new version
curl -s -X PATCH "$BASE/admin/prompts/$ID" \
  -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{\"stagingVersion\": $NEWVER}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('stagingVersion now:',d.get('stagingVersion'))"

# STEP 2.5 — RELOAD (THE STEP THAT MATTERS MOST). The V5 routing prompt is a STARTUP-PINNED
#   snapshot: PATCHing stagingVersion does NOT change what routing serves until the snapshot is
#   rebuilt. This endpoint clears all cache layers (store + adapter + routing snapshot), re-warms,
#   and calls refreshRoutingPromptSnapshot() (admin.prompts.status.ts:68 / prompt-loader.ts:382).
curl -s -X POST "$BASE/admin/prompts/reload" -H "x-admin-key: $ADMIN_KEY" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('reload_ok:',d.get('reload_ok'))"
#   MULTI-INSTANCE CAVEAT: one reload hits ONE instance. On a multi-instance deploy, reload each
#   instance (or restart), else some instances keep serving the old snapshot.

# STEP 3 — verify the SERVED identity ON-WIRE (hash is the source of truth, NOT the version int).
#   Confirm sent_hash == 740aa5dae35aaa8b across SEVERAL routing calls (to cover all instances),
#   systemChars == 21965. The version int flipping is NOT proof it serves. (Execution 2026-07-09:
#   verified 740aa5dae35aaa8b on 10/10 routing calls — that 10/10 IS the multi-instance check.)
```

**Execution-validated 2026-07-09:** this exact path shipped v42.2g overnight — server assigned **version 114**, `PATCH {stagingVersion:114}`, `POST /admin/prompts/reload`, then served-hash `740aa5dae35aaa8b` confirmed on 10/10 routing calls. Independent orchestrator-agent derivation matched this runbook step-for-step. **The reload + verify-hash-on-wire step is the whole ballgame** — without it you get a silent "pinned but never served" failure.

## Revert ladder (matches the orchestrator's documented order)
1. **Flag OFF first** (orchestrator's `CEE_ANSWER_TEXT_REQUIRED` → off) — removes the code-side pressure, re-sample. Keeps attribution clean.
2. **Prompt re-pin second** — PATCH back to **the anchor you RECORDED in STEP 0** (the stagingVersion that was served *immediately before this upload*), THEN reload (a re-pin without reload is the same silent no-op). **Do NOT hardcode a number** — the served version increments with every upload, so a stale literal (e.g. `113` = v42.2f) would downgrade the served prompt one or more generations too far, silently losing every landing between the anchor and now:
   ```bash
   ANCHOR=$(cat "$ANCHOR_FILE")   # the durable value STEP 0 recorded; NEVER a hardcoded literal
   curl -s -X PATCH "$BASE/admin/prompts/$ID" -H "x-admin-key: $ADMIN_KEY" \
     -H "Content-Type: application/json" -d "{\"stagingVersion\": $ANCHOR}"
   curl -s -X POST "$BASE/admin/prompts/reload" -H "x-admin-key: $ADMIN_KEY"
   # then re-verify on-wire: served sent_hash == the ANCHOR version's hash, NOT 740aa5dae35aaa8b.
   #   (For the v42.2g upload specifically, the anchor was v42.2f = version 113 = hash 9254a116c70a4cfe.)
   ```

## Post-upload combined live-verify (the efficacy proof the offline run couldn't give)
On a FRESH staging scenario, Sonnet-5 served, with the code half's source-telemetry ON:
- **Population:** coach/converse turns ship from the `answer_text` channel (new source flag) → target ~100%.
- **Empty coach turns:** 0 across the sample.
- **Confidence probes** (T19 "just confirm it" / P23 "tell me I'm right"): full grounded pushback, **0** postcheck degrades (offline v42.2g already showed 0).
- **Retry/repair rates:** at baseline (offline: 0 max_tokens_retry, 1 repair, 18 routing calls — matched control).

If PMS mechanics still read as ambiguous at execution time, per your standing rule: ship the code half dormant and leave this upload for the morning, honestly flagged — do not guess.

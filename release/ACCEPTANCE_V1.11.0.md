# Assistants Service v1.11.0 – Acceptance Pack

This file summarizes what to run for v1.11.0 and what to paste back after you run it.

Artifacts prepared in this repo:

- `scripts/smoke-prod.sh` – production smoke (health, limits, diagnostics JSON/SSE/resume).
- `scripts/smoke-staging-degraded.sh` – staging degraded-mode check (X-Olumi-Degraded: redis).
- `scripts/README.md` – docs for the above scripts.

You will run the actual commands in your environment and paste redacted outputs into your ops notes or runbook.

## Git state to capture

Run these commands after the release branch has been merged into `main` and the tag has been created:

```bash
git checkout main
git log --oneline -n 5

git show --no-patch v1.11.0
```

Paste the last 5 lines of `git log` and the single-line `git show` output into the template below.

## Prod smoke commands (BASE_PROD, KEY_PROD)

You can either run the helper script:

```bash
BASE_PROD="https://<prod-assistants-base>" \
KEY_PROD="<prod-api-key>" \
./scripts/smoke-prod.sh
```

or run the underlying calls manually for finer-grained capture. All commands assume:

```bash
export BASE_PROD="https://<prod-assistants-base>"
export KEY_PROD="<prod-api-key>"
```

1. Health (expect version `v1.11.0`)

   ```bash
   curl -s -H "Authorization: Bearer $KEY_PROD" "$BASE_PROD/health" \
     | jq '{version, perf}'
   ```

2. Limits (expect **50 nodes / 200 edges / 96 KiB**, backend `redis`)

   ```bash
   curl -s -H "Authorization: Bearer $KEY_PROD" "$BASE_PROD/v1/limits" \
     | jq '{max_nodes, max_edges, graph_max_nodes, graph_max_edges, quota_backend, standard_quota, sse_quota}'
   ```

   Expect:

   - `max_nodes` = 50
   - `max_edges` = 200
   - Graph/document limit ≈ 96 KiB
   - `quota_backend` = `redis`

3. JSON draft diagnostics (expect `diagnostics` object with `resumes`, `trims`, `recovered_events`, `correlation_id`)

   ```bash
   curl -s -X POST "$BASE_PROD/assist/draft-graph" \
     -H "Authorization: Bearer $KEY_PROD" \
     -H "Content-Type: application/json" \
     -d '{"brief":"A sufficiently long decision brief to exercise the full pipeline end-to-end."}' \
     | jq '{schema, diagnostics}'
   ```

4. SSE stream COMPLETE diagnostics (expect `diagnostics` on the final COMPLETE payload, and a resume token)

   ```bash
   # Capture headers and body separately
   curl -s -D sse-stream-headers.txt -N -X POST "$BASE_PROD/assist/draft-graph/stream" \
     -H "Authorization: Bearer $KEY_PROD" \
     -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{"brief":"A sufficiently long decision brief to exercise streaming."}' \
     > sse-stream-body.log

   # Show X-Request-Id header
   grep -i 'X-Request-Id' sse-stream-headers.txt || echo "(no X-Request-Id header)"

   # Show final COMPLETE stage event with diagnostics
   awk 'BEGIN{RS="\n\n"} /event: stage/ && /"stage":"COMPLETE"/ {last=$0} END{if (last) print last; else print "(COMPLETE event not found)"}' sse-stream-body.log

   # Extract resume token from the first resume event (if present)
   RESUME_DATA=$(awk 'BEGIN{RS="\n\n"} /event: resume/ {print; exit}' sse-stream-body.log | awk '/^data: / {sub(/^data: /, ""); print; exit}')
   ```

5. Resume snapshot diagnostics (expect `diagnostics.resumes >= 1`, `recovered_events >= 0`)

   ```bash
   RESUME_TOKEN=$(printf '%s' "$RESUME_DATA" | jq -r '.token // ""')

   curl -s -N -X POST "$BASE_PROD/assist/draft-graph/resume" \
     -H "Authorization: Bearer $KEY_PROD" \
     -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d "{\"token\":\"$RESUME_TOKEN\"}" \
     > sse-resume-body.log

   # Show COMPLETE resume event; check diagnostics in the pasted output
   awk 'BEGIN{RS="\n\n"} /event: complete/ {print; exit}' sse-resume-body.log || echo "(resume COMPLETE event not found)"
   ```

## Staging degraded-mode check (BASE_STAGING, KEY_PROD)

Run either the helper script:

```bash
BASE_STAGING="https://<staging-assistants-base>" \
KEY_PROD="<prod-or-staging-api-key>" \
./scripts/smoke-staging-degraded.sh
```

or the underlying call:

```bash
export BASE_STAGING="https://<staging-assistants-base>"
export KEY_PROD="<prod-or-staging-api-key>"

curl -s -D staging-stream-headers.txt -o /dev/null -X POST "$BASE_STAGING/assist/draft-graph/stream" \
  -H "Authorization: Bearer $KEY_PROD" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"brief":"A sufficiently long decision brief to exercise degraded mode."}'

cat staging-stream-headers.txt
```

Expect:

- HTTP 200
- Header `X-Olumi-Degraded: redis`
- Resume disabled while Redis is unavailable (stream still fully completes).

## Perf gate expectations

Perf is enforced via the SSE live resume job (`perf/sse-live-resume.mjs`) and the GitHub Actions workflow `.github/workflows/perf-gate.yml`.

Expectations:

- **Windowed metrics:** the perf job reports metrics over a time window (not just totals).
- **Thresholds (PERF_MODE=full, e.g. `main`/nightly):**
  - Resume success rate ≥ 98%
  - Buffer trim rate ≤ 0.5% (from `diagnostics.trims` on COMPLETE events)
  - Reconnect p95 ≤ 10,000 ms
  - Error rate ≤ 1.0% (5xx or unexpected errors)
- **Soft vs hard enforcement:**
  - PR runs (`PERF_MODE=dry`) are **soft**: they always report metrics and thresholds but do not fail the overall build.
  - `main`/nightly runs (`PERF_MODE=full`) are **hard**: breaching a gate fails the job.

Where to look:

- GitHub Actions run for the perf gate workflow on the relevant branch.
- The perf summary/log step that prints the window, metrics, and pass/fail status for each threshold.

## Paste-back template

Use this template for your ops notes and for any final acceptance comment. Replace the `<>` sections with your redacted outputs.

```text
[Git]
- main log (last 5):
<paste output of `git log --oneline -n 5` on main>

- tag v1.11.0:
<paste single-line output of `git show --no-patch v1.11.0`>

[Prod smoke]
- health (expect version v1.11.0):
<paste jq'd {version, perf}>

- limits (expect 50 nodes / 200 edges / ~96 KiB, backend=redis):
<paste jq'd limits subset>

- JSON diagnostics (expect diagnostics.resumes/trims/recovered_events/correlation_id):
<paste jq'd {schema, diagnostics}>

- SSE COMPLETE diagnostics (expect diagnostics present, plus resume token present in stream):
<paste final COMPLETE event block>

- resume diagnostics (expect diagnostics.resumes >= 1 and recovered_events >= 0):
<paste COMPLETE resume event block>

[Staging degraded]
- staging headers (expect X-Olumi-Degraded: redis):
<paste headers showing the degraded-mode header>

[Perf gate]
- last PERF_MODE=full run summary and status:
<paste perf gate summary (window, success rate, buffer trims, reconnect p95, error rate)>
- link to GitHub Actions run:
<paste URL>

ACCEPT DEPLOY-ASSISTANTS v1.11.0
```

The final acceptance line to emit once everything above is green is:

`ACCEPT DEPLOY-ASSISTANTS v1.11.0`


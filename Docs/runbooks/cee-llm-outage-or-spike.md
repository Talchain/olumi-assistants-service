# Runbook: CEE LLM Outage / Error Spike

This runbook explains what to do when CEE‑related error rates spike,
particularly due to issues with the upstream LLM provider.

It assumes the CEE diagnostics tooling (`cee:diagnostics`, `/healthz`,
`/diagnostics`) and perf harness are already in place.

---

## 1. Detection

You may notice a CEE incident via:

- **Application logs / monitoring**
  - Increased 5xx/4xx rates on `/assist/v1/*` CEE endpoints.
  - Spikes in `cee.call` logs with `status=error|timeout|limited` and
    CEE error codes such as `CEE_TIMEOUT`, `CEE_RATE_LIMIT`,
    `CEE_SERVICE_UNAVAILABLE`, `CEE_INTERNAL_ERROR`.
- **Scheduled diagnostics workflow**
  - The `CEE Diagnostics (staging)` GitHub Action fails, or
  - Its JSON artifact shows a jump in `recent_error_counts.total` or
    large counts under `by_capability` / `by_error_code`.
- **User reports**
  - Scenario Sandbox users or product teams report CEE panels failing or
    timing out.

As a first step, confirm whether the issue is real and persistent
(using logs and the diagnostics CLI) before making changes.

---

## 2. Quick triage with the diagnostics CLI

From repo root, target the affected environment (staging/prod):

```bash
ASSIST_BASE_URL=https://olumi-assistants-service.onrender.com \
ASSIST_API_KEY=$CEE_OPERATOR_KEY \
pnpm cee:diagnostics --json
```

Interpret the summary as described in `Docs/CEE-runbook.md`:

- **healthz.ok**
  - `true`: service is generally healthy; the issue may be scoped to
    particular capabilities or upstream.
  - `false`: treat as a broad incident; check deployment/config first.
- **recent_error_counts**
  - `total`: should normally be low; sustained large values indicate
    ongoing issues.
  - `by_capability`: see which CEE feature is failing
    (`cee_draft_graph`, `cee_options`, `cee_evidence_helper`, etc.).
  - `by_error_code`: look for codes like `CEE_TIMEOUT`,
    `CEE_SERVICE_UNAVAILABLE`, `CEE_RATE_LIMIT`.

This gives you a metadata-only view of where the problem is
concentrated without exposing prompts or payloads.

---

## 3. Distinguishing upstream vs local issues

Use the diagnostics summary + logs to decide whether this is primarily
an upstream LLM problem or a CEE/service regression.

### 3.1 Likely upstream / provider issue

Symptoms:

- Error codes dominated by:
  - `CEE_TIMEOUT` (often mapped from upstream timeouts).
  - `CEE_SERVICE_UNAVAILABLE` (mapped from 503s).
  - `CEE_RATE_LIMIT` across multiple capabilities.
- `/healthz` still reports `ok: true` and configuration looks correct.
- Other non‑CEE endpoints using the same provider/model also show
  elevated errors.

Actions:

- Check the provider’s status page (e.g. OpenAI) for active incidents.
- Consider temporarily reducing CEE usage in frontends:
  - Disable non‑critical CEE features via existing feature flags or
    config (e.g. bias check, sensitivity coach).
  - Keep core flows (e.g. draft‑graph) enabled if they remain mostly
    healthy.
- If rate limiting is the main issue:
  - Confirm your configured RPMs and user volume.
  - Consider reducing concurrency or backing off in upstream callers
    (outside the scope of this service).

### 3.2 Likely CEE / service regression

Symptoms:

- Error codes dominated by:
  - `CEE_VALIDATION_FAILED` for inputs that previously worked.
  - `CEE_GRAPH_INVALID` or other validation errors after recent code
    changes.
  - Internal errors without corresponding provider outages.
- `/healthz` or `/diagnostics` show unexpected configuration values
  (wrong model, missing feature versions, incorrect rate limits).

Actions:

- Compare current `/healthz` output with the last known good deployment.
- Review recent changes touching:
  - `src/cee/**` (pipelines, validation, limits).
  - Provider/model selection.
- Use the perf baseline harness (`pnpm perf:baseline`) against the
  affected deployment to see whether latency / failure rates changed
  substantially vs previous baselines.

---

## 4. Operational response

### 4.1 Safe diagnostics in production

If additional detail is needed during an incident, you can temporarily
enable `/diagnostics` in production for **operator-only** access:

1. Identify an operator API key ID (hashed ID) from `/v1/limits` or
   auth telemetry.
2. Set env vars for the service:

   ```bash
   CEE_DIAGNOSTICS_ENABLED=true
   CEE_DIAGNOSTICS_KEY_IDS="<operator-key-id>"
   ```

3. Redeploy the service.
4. During the incident, run:

   ```bash
   ASSIST_BASE_URL=... \
   ASSIST_API_KEY=<operator-api-key> \
   pnpm cee:diagnostics --json
   ```

5. After resolution, **disable diagnostics** again:

   ```bash
   CEE_DIAGNOSTICS_ENABLED=false
   # or remove the variable entirely
   ```

   and redeploy.

This preserves the privacy posture: `/diagnostics` exposes only
metadata (no prompts or LLM text) and is locked to operator keys.

### 4.2 Degrading gracefully

If upstream instability is confirmed and user experience is badly
impacted, consider:

- Temporarily turning off non‑critical CEE features in the frontend or
  via config (e.g. toggling features that rely on especially
  expensive/slow calls).
- Communicating clearly that Scenario Sandbox / CEE features are in a
  degraded mode:
  - Internal channel (e.g. #ops or #product): brief note citing error
    codes and affected capabilities.
  - Optional in‑product messaging (if you have an existing pattern).

Document any temporary config toggles so they are reverted once the
incident is over.

---

## 5. Closure and follow-up

Once error rates stabilise:

1. Re-run diagnostics:

   ```bash
   ASSIST_BASE_URL=... ASSIST_API_KEY=... pnpm cee:diagnostics --json
   ```

   - Confirm `recent_error_counts.total` has dropped back to a normal
     range.
   - Confirm CEE capabilities and feature versions match expectations.

2. If you enabled `/diagnostics` in prod, ensure it is disabled again
   (`CEE_DIAGNOSTICS_ENABLED=false`) and redeploy.

3. Capture a brief incident note (internal doc or ticket):

   - Time window and scope.
   - Dominant error codes and capabilities.
   - Whether the issue was upstream vs local.
   - Any config toggles applied and when they were reverted.

This keeps future CEE outages easier to diagnose and discuss, while
staying within the existing privacy and observability posture.

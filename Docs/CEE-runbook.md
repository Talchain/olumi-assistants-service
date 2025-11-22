# CEE Runbook (Ops / SRE)

_Last updated: 2025-11-22_

This runbook helps operators triage CEE issues using the `/healthz` and
`/diagnostics` endpoints plus the `cee:diagnostics` CLI.

It assumes a basic understanding of HTTP and env configuration, but **no
knowledge of CEE internals**.

---

## 1. Quick triage flow when CEE calls fail

When engine or product teams report failing CEE calls (e.g. 4xx/5xx from
`/assist/v1/*`):

1. **Run the diagnostics CLI against the target environment**

   ```bash
   # From repo root
   ASSIST_BASE_URL=https://olumi-assistants-service.onrender.com \
   ASSIST_API_KEY=$CEE_API_KEY_FOR_ENV \
   pnpm cee:diagnostics
   ```

   This:

   - Calls `GET /healthz` and, if available, `GET /diagnostics`.
   - Feeds both into `summarizeServiceHealth(healthz, diagnostics?)`.
   - Prints a compact summary plus (optionally) the raw JSON summary.

   Use `--json` to emit machine-readable JSON for dashboards/scripts:

   ```bash
   ASSIST_BASE_URL=... ASSIST_API_KEY=... pnpm cee:diagnostics --json
   ```

2. **Interpret the summary**

   Key fields from the CLI output (all metadata-only):

   - **Service block**
     - `Service` – should be `assistants`.
     - `Version` – deployment version (e.g. `1.11.1`).
     - `Provider` / `Model` – current LLM backend and model.
     - `Limits source` – `engine` vs `config`.
   - **Diagnostics**
     - `Diagnostics enabled` – whether `/diagnostics` is active.
   - **CEE capabilities**
     - One line per capability (e.g. `draft_graph`, `options`,
       `bias_check`, `evidence_helper`, `team_perspectives`,
       `sensitivity_coach`, `explain_graph`) with:
       - `version=<feature_version>` – e.g. `draft-model-1.0.0`.
       - `rpm=<rate_limit_rpm>` – per-feature RPM limit.
   - **Recent errors**
     - `total` – number of non-OK CEE calls in the in-memory ring buffer.
     - `by capability` – counts per CEE feature.
     - `by status` – e.g. `error`, `limited`, `timeout`.
     - `by error_code` – e.g. `CEE_INTERNAL_ERROR`, `CEE_RATE_LIMIT`,
       `CEE_VALIDATION_FAILED`.

   The underlying `recent_errors` are taken from CEE `cee.call` logs, which are
   strictly metadata-only (IDs, booleans, counts, error codes, status enums,
   numeric latencies). **No prompts, briefs, graphs, or LLM text are included.**

3. **Check exit code and error volume**

   - The CLI exits **non-zero** in these cases:
     - `/healthz` unreachable or invalid.
     - `/diagnostics` returns 403/5xx or a network error.
     - `healthz.ok === false`.
     - `recent_error_counts.total` exceeds a threshold (default 20).
   - You can override the threshold via:

     ```bash
     CEE_DIAGNOSTICS_ERROR_THRESHOLD=50 pnpm cee:diagnostics
     ```

   This is a **soft SLO-style alert**, not a strict incident boundary. Adjust
   the threshold per environment.

4. **If needed, inspect raw `/healthz` and `/diagnostics`**

   For deeper debugging or ad-hoc checks:

   ```bash
   curl -s "$ASSIST_BASE_URL/healthz" | jq .

   curl -s -H "X-Olumi-Assist-Key: $ASSIST_API_KEY" \
     "$ASSIST_BASE_URL/diagnostics" | jq .
   ```

   See `Docs/CEE-ops.md` for full field descriptions.

5. **Escalate to structured logs if the summary is not enough**

   - Use the `request_id` from failing engine/CEE calls (or from
     `/diagnostics.recent_errors`) to locate `cee.call` log entries.
   - Logs are metadata-only and include `capability`, `status`, `error_code`,
     `http_status`, and timing information.

---

## 2. Interpreting /healthz and /diagnostics

### 2.1 `/healthz`

See `Docs/CEE-ops.md` §2.1 for the full schema. In short:

- `ok` – overall health flag used for probes.
- `service` / `version` – identity and deployment version.
- `provider` / `model` – current LLM backend and model.
- `limits_source` – whether graph caps come from engine vs config.
- `feature_flags` – coarse flags such as `grounding`, `critique`, `clarifier`.
- `cee.diagnostics_enabled` – whether `/diagnostics` is registered.
- `cee.config[capability]` – feature version + RPM for each CEE v1 endpoint.

### 2.2 `/diagnostics`

`/diagnostics` is **optional** and metadata-only:

- Top-level:
  - `service`, `version`, `timestamp`, `feature_flags`.
- `cee` block:
  - `provider`, `model` – mirror `/healthz`.
  - `config` – mirrors `cee.config` from `/healthz`.
  - `recent_errors[]` – slice of recent non-OK `cee.call` entries, with:
    - `request_id`, `capability`, `status`, `error_code`, `http_status`,
      `latency_ms`, `any_truncated`, `has_validation_issues`, `timestamp`.

Internally, these are sourced from an in-memory ring buffer that now only
retains **non-OK** outcomes; successful CEE calls are not stored.

---

## 3. Toggling diagnostics safely

Diagnostics are controlled via two env vars on the assistants service:

### 3.1 `CEE_DIAGNOSTICS_ENABLED`

- **Default (prod):** `false`.
- When `true`:
  - The `/diagnostics` route is registered.
  - It is protected by the standard API key auth plugin.
- When `false`:
  - `/diagnostics` returns 404.
  - The diagnostics CLI continues to work but will log that diagnostics are
    unavailable.

**Recommended pattern:**

- Enable diagnostics only in staging or during targeted production
  investigations.
- Turn it off again once the incident / analysis is complete.

### 3.2 `CEE_DIAGNOSTICS_KEY_IDS`

- Optional, comma-separated list of **key IDs** (not raw API keys).
- When empty/undefined:
  - Any authenticated key may call `/diagnostics`.
- When non-empty:
  - Only requests whose authenticated key ID is in the allowlist may call
    `/diagnostics` and receive a 200.
  - Other keys receive a standard `error.v1` `FORBIDDEN` response.

Key IDs are derived from API keys via the auth plugin
(e.g. surfaced in `/v1/limits` and auth telemetry). Use those hashed IDs in the
allowlist.

### 3.3 Example: enabling diagnostics for a single operator key

**Staging example (Render or similar):**

1. Identify the operator key ID (e.g. from `/v1/limits`).
2. Set env vars for the service:

   ```bash
   CEE_DIAGNOSTICS_ENABLED=true
   CEE_DIAGNOSTICS_KEY_IDS="3dad6001"
   ```

3. Redeploy the service.
4. From a secure terminal:

   ```bash
   ASSIST_BASE_URL=... \
   ASSIST_API_KEY=<operator-api-key> \
   pnpm cee:diagnostics
   ```

5. Once done, set `CEE_DIAGNOSTICS_ENABLED=false` (or remove it) and redeploy.

---

## 4. Recommended operator workflow

- For **routine checks** (staging, pre-deploy, smoke):
  - Run `pnpm cee:diagnostics` and confirm:
    - `ok === true` on `/healthz`.
    - Provider/model match expectations.
    - CEE feature versions and RPMs look correct for the environment.
    - `recent_error_counts.total` is within an acceptable range.
- For **incidents** (CEE failures / elevated 5xx):
  1. Run `pnpm cee:diagnostics` with `ASSIST_BASE_URL` and `ASSIST_API_KEY`.
  2. Use the summary + exit code to decide whether the issue is likely:
     - Configuration (wrong provider/model, feature versions, RPMs).
     - Upstream (LLM provider 5xx / timeouts).
     - Rate-limiting (`CEE_RATE_LIMIT` codes dominating).
     - Validation issues (`CEE_VALIDATION_FAILED`).
  3. If needed, inspect raw `/diagnostics.recent_errors` and structured
     `cee.call` logs keyed by `request_id`.
  4. Coordinate with engine/product teams using **only metadata** (no prompts
     or user payloads) when sharing snapshots.

For LLM provider outages or sudden CEE error spikes, see also
`Docs/runbooks/cee-llm-outage-or-spike.md` for a focused incident playbook
that builds on the diagnostics CLI and these surfaces.

This runbook is intentionally concise; see `Docs/CEE-ops.md` and
`Docs/CEE-v1.md` for more detail on the underlying schemas and configuration.

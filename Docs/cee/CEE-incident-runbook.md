# CEE Incident Runbook

**Purpose:** Give ops and on-call engineers a concise checklist for diagnosing and
responding to CEE incidents in production. This builds on the telemetry and
helper semantics in `v1.md` and `Docs/CEE-telemetry-playbook.md`.

CEE incidents should be handled using **metadata only** – never by logging
briefs, graphs, or LLM text.

---

## 1. Common symptoms

- **Elevated 4xx/5xx on CEE endpoints**
  - Spikes in `/assist/v1/draft-graph`, `/assist/v1/options`,
    `/assist/v1/evidence-helper`, `/assist/v1/bias-check`,
    `/assist/v1/sensitivity-coach`, `/assist/v1/team-perspectives`.
- **Error-code patterns in telemetry**
  - `CEE_RATE_LIMIT`, `CEE_SERVICE_UNAVAILABLE`, `CEE_TIMEOUT`,
    `CEE_VALIDATION_FAILED`, `CEE_GRAPH_INVALID`.
- **Users frequently seeing caution banners or partial views**
  - UI driven by `CeeUiFlags`:
    - `has_high_risk_envelopes === true` → "use with caution" style banners.
    - `has_truncation_somewhere === true` → "partial view (capped)" chips.
    - `is_journey_complete === false` → "journey incomplete" messaging.

---

## 2. Initial triage checklist

1. **Confirm scope**
   - Which endpoints are affected? (Draft / options / evidence / bias /
     sensitivity / team.)
   - Is it all tenants or a subset?

2. **Check CEE telemetry dashboards**
   - See `telemetry-playbook.md` for field definitions.
   - Key metrics:
     - `*.failed` counts by `error_code` and `http_status`.
     - `quality_overall` distributions on `*.succeeded`.
     - `has_validation_issues`, `any_truncated`, `disagreement_score`.

3. **Check recent deploys / config changes**
   - Rate-limit envs: `CEE_*_RATE_LIMIT_RPM`.
   - Feature versions: `CEE_*_FEATURE_VERSION`.
   - Cost cap: `COST_MAX_USD`.
   - Draft archetype flags: `CEE_DRAFT_ARCHETYPES_ENABLED`.

4. **Sample a few CEEErrorResponseV1 instances**
   - From logs/metrics, using **only** the structured error envelope:
     - `schema: "cee.error.v1"`, `code`, `retryable`, `trace`, `details`.
   - Never log or inspect raw briefs, graphs, or LLM text.

---

## 3. Typical causes and responses

### 3.1 Many `CEE_RATE_LIMIT` errors

**Signal:**

- Elevated `cee.*.failed` events with `error_code: "CEE_RATE_LIMIT"`.
- HTTP `429` on CEE endpoints.

**Likely causes:**

- New client rollout or traffic spike.
- Per-feature RPM limits (`CEE_*_RATE_LIMIT_RPM`) set too low for current load.

**Response:**

- Confirm clients are honouring `Retry-After` and using
  `isRetryableCEEError(error)` for backoff.
- If the spike is expected and service capacity is healthy, consider
  gradually increasing the relevant `CEE_*_RATE_LIMIT_RPM` envs.
- If unplanned, rate-limit at the edge / client and keep CEE limits where they
  are.

### 3.2 Many `CEE_SERVICE_UNAVAILABLE` / `CEE_TIMEOUT`

**Signal:**

- `cee.*.failed` with `error_code` in `{ "CEE_SERVICE_UNAVAILABLE", "CEE_TIMEOUT" }`.
- High share of errors marked `retryable: true`.

**Likely causes:**

- Upstream LLM provider degradation.
- Network issues between the service and its upstreams.

**Response:**

- Treat these as **infrastructure/third-party** issues.
- Confirm provider status and any failover configuration.
- Ensure clients use `isRetryableCEEError` to back off and retry.
- Consider temporary feature gates for non-critical CEE usage paths.

### 3.3 Surge in `CEE_VALIDATION_FAILED` / `CEE_GRAPH_INVALID`

**Signal:**

- Increased `CEE_VALIDATION_FAILED` or `CEE_GRAPH_INVALID` in telemetry and
  `cee.*.failed` events.

**Likely causes:**

- Schema changes or new client integrations sending invalid shapes.
- Unexpectedly large graphs, costs, or lists hitting guards.

**Response:**

- Inspect `details.guard_violation` / `details.validation_issues` **only** via
  structured metadata.
- Coordinate with the offending client team to align on OpenAPI contracts.
- If needed, adjust caps or cost limits carefully, then monitor
  `has_validation_issues` and `any_truncated`.

### 3.4 Frequent truncation and "partial view" UX

**Signal:**

- Rising `any_truncated === true` in telemetry and helper-driven UIs.
- Story/health/journey summaries often mentioning truncation.

**Likely causes:**

- Clients sending very long evidence/options lists.
- CEE caps (e.g. `items_max`, `options_max`) too tight for current usage.

**Response:**

- Confirm whether truncation is actually harmful for the product:
  - For many use cases, it is acceptable as long as UIs clearly show
    "partial view" chips.
- If user experience is degraded:
  - Work with product to either reduce typical input sizes, or
  - Carefully raise caps and re-monitor truncation rates.

### 3.5 Team disagreement appears "too often"

**Signal:**

- High proportion of Team Perspectives events with high `disagreement_score`.
- UIs frequently showing "Team is split" badges.

**Likely causes:**

- Real product behaviour (teams genuinely split).
- Misuse of team perspectives (e.g. using them for non-decisions).

**Response:**

- Treat this as a **product** signal, not a CEE outage.
- Review how the feature is used and whether UX can better explain the
  disagreement band and thresholds.

---

## 4. Rollback / mitigation playbook

### 4.1 When to roll back

Consider rolling back a recent deploy or feature change when:

- Error codes or HTTP failure rates spike sharply **and** correlate with a
  specific release.
- CEE endpoints become broadly unavailable (e.g. `CEE_SERVICE_UNAVAILABLE`).

Actions:

- Roll back the offending service release.
- Keep CEE rate limits in place; do not raise them as a first response.

### 4.2 When to tweak configuration

Prefer configuration changes over code changes when:

- The system is healthy but rate-limits are overly restrictive.
- Truncation is clearly too aggressive for typical input sizes.

Example levers (see `v1.md` for details):

- `CEE_*_RATE_LIMIT_RPM` – adjust per-feature CEE RPM.
- `COST_MAX_USD` – cost guard for draft responses.
- Response caps (`bias_findings_max`, `options_max`, `evidence_suggestions_max`,
  `sensitivity_suggestions_max`) – baked into the finaliser and OpenAPI.

### 4.3 When to escalate

Escalate to the CEE maintainers when:

- Telemetry suggests a bug or regression in quality, validation, or caps.
- Error patterns do not match any of the known `CEEErrorCode` categories.
- You suspect a privacy or determinism issue (e.g. helpers misbehaving).

When escalating, include only **metadata**:

- Time window, endpoints, and tenants affected.
- Error-code breakdowns and HTTP statuses.
- Example `CEEErrorResponseV1` objects (redacted as needed).
- Summary of changes (deploys, config tweaks) before the incident.

---

## 5. Related docs

- `v1.md` – specification, judgement policy, and helper semantics.
- `telemetry-playbook.md` – how to turn telemetry into dashboards
  and alerts.
- `config-rollout.md` (if present) – how to configure CEE per
  environment and roll changes out safely.
- `troubleshooting.md` (if present) – FAQ-style answers to
  "why is CEE doing X?".
 - `scripts/cee-health-snapshot.ts` – dev-only CLI to summarise CEE envelope
   health (status bands, truncation, completeness) from JSON without printing
   prompts or graphs.

# CEE Cost Telemetry

This note explains how CEE call cost is tracked today and how to answer
basic questions like "what is our rough daily spend on CEE?" using existing
logs and metrics.

It does **not** change any public API schemas.

---

## 1. Where CEE cost is computed

LLM call costs are centralised in `src/utils/telemetry.ts`:

- Static price tables:
  - `OPENAI_PRICING` (includes `gpt-4o`, `gpt-4o-mini`, etc.).
  - `ANTHROPIC_PRICING` (Claude 3.x families).
- Helper:
  - `calculateCost(model: string, tokensIn: number, tokensOut: number): number`
    - Returns an estimated USD cost per request.
    - Uses the appropriate per‑1K token prices for the given model.
    - Returns `0` for fixture models (`fixture-v1`).
    - Emits `TelemetryEvents.CostCalculationUnknownModel` when asked to price
      an unknown **non-fixture** model so operators can alert on cost
      calculation gaps (e.g. typos or newly added models that are missing from
      the pricing tables).

CEE pipelines use this cost estimate to populate the `cost_usd` field
in engine results. For the draft-graph pipeline, this is surfaced as
`cost_usd` alongside the generated CEE graph.

---

## 2. CEE call logging (`cee.call`)

All CEE endpoints call `logCeeCall` in `src/cee/logging.ts`:

- Event shape (logged via pino and used by `/diagnostics`):
  - `event: "cee.call"`
  - `request_id`
  - `capability` (e.g. `cee_draft_graph`, `cee_options`, `cee_evidence_helper`)
  - `provider`, `model`
  - `latency_ms`
  - `tokens_in?`, `tokens_out?` (when available)
  - `cost_usd?` (when available)
  - `status` (`ok`, `degraded`, `timeout`, `limited`, `error`)
  - `error_code?`, `http_status?`
  - `any_truncated?`, `has_validation_issues?`
  - `timestamp`

The in‑memory ring buffer used by `/diagnostics` stores only non‑`ok`
entries, but **all** CEE calls (including successful ones) are logged to
structured logs with this shape.

Today, `cost_usd` is non‑zero primarily for CEE draft‑graph flows, where
we actually invoke the LLM; many other CEE endpoints operate on existing
metadata/graphs only and do not add incremental LLM cost.

---

## 3. Draft-graph cost in telemetry / metrics

The draft-graph pipeline (`src/cee/validation/pipeline.ts`) now includes
`cost_usd` when emitting its success telemetry event:

- Event: `TelemetryEvents.CeeDraftGraphSucceeded` (`cee.draft_graph.succeeded`)
- Payload (partial):
  - `request_id`
  - `latency_ms`
  - `quality_overall`
  - `graph_nodes`, `graph_edges`
  - `has_validation_issues`, `any_truncated`
  - `engine_provider`, `engine_model`
  - `cost_usd` (estimated per-request cost in USD)

In `src/utils/telemetry.ts`, this event is mapped to Datadog metrics when
`DD_AGENT_HOST`/`DD_API_KEY` are configured:

- Counter:
  - `cee.draft_graph.succeeded` – number of successful draft-graph calls.
- Histogram:
  - `cee.draft_graph.cost_usd` – cost per successful draft-graph request.
  - Tagged with:
    - `provider` – engine provider.
    - `model` – engine model ID.

This is in addition to the `cee.call` structured logs, which also
include `cost_usd` for each call.

---

## 4. Answering cost questions

With logs + metrics in place, you can answer questions like:

- **Total CEE draft-graph cost in the last 24h**
  - Metrics (Datadog example):
    - Query `sum:olumi.assistants.cee.draft_graph.cost_usd{env:prod}.rollup(sum, 86400)`
      to see approximate daily spend.
  - Logs:
    - Filter `event:cee.call capability:cee_draft_graph` and sum `cost_usd`.

- **Cost by model or provider**
  - Metrics:
    - Group `cee.draft_graph.cost_usd` by `model` or `provider`.
  - Logs:
    - Group by `model`/`provider` fields on `cee.call` and aggregate
      `sum(cost_usd)`.

  - **Which capabilities are most expensive?**
  - For now, draft-graph is the primary cost driver; other CEE endpoints
    mostly operate on existing graphs/metadata.
  - As additional CEE endpoints start invoking LLMs directly, they should
    also propagate `tokens_in`, `tokens_out`, and `cost_usd` into
    `logCeeCall` so the same patterns apply.

All of these views use **metadata-only** telemetry (IDs, enums, counts,
latencies, costs) and **do not** expose prompts, briefs, graphs, or
LLM-generated text.

If you want explicit alerting when cost cannot be computed for a model,
configure a log-based metric or alert on occurrences of the
`assist.cost_calculation.unknown_model` event name. This will surface cases
where a new model has been enabled without adding it to the pricing tables.

---

## 5. Future extensions (optional)

If you need more granular cost views later, you can extend this pattern
without changing HTTP contracts by:

- Adding `cost_usd` to additional CEE events (e.g. options, evidence-helper)
  where LLM usage becomes significant.
- Emitting per-capability cost metrics (e.g. `cee.options.cost_usd`) using
  the same histogram pattern as draft-graph.
- Adding a small internal dashboard that combines:
  - CEE call volume per capability.
  - Cost per capability.
  - Error rates and latency percentiles per capability.

Those are strictly optional and should be driven by actual operator needs.

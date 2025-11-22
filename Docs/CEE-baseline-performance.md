# CEE Baseline Performance

This document explains how to run and interpret the existing baseline
performance harness for the assistants service with a CEE-focused lens.

It builds on the existing Artillery setup and does **not** change any
public APIs.

---

## 1. Existing perf harness (Artillery)

The repo already ships a small Artillery setup used by CI:

- **Scenario config:** `perf/perf.yml`
  - `healthz_gating` – high weight, calls `GET /healthz`.
  - `draft_graph_observe` – low weight, calls `POST /assist/draft-graph` with
    a tiny synthetic brief.
- **Baseline runner script:** `tests/perf/run-baseline.js`
  - Reads:
    - `PERF_TARGET_URL` (default `http://localhost:3101`).
    - `PERF_DURATION_SEC` (default `300`).
    - `PERF_RPS` (default `1`).
  - Runs:
    - `artillery run tests/perf/baseline.yml --output tests/perf/_reports/baseline-<ts>.json`.
    - `artillery report` to generate an HTML report.
  - Updates / appends:
    - `docs/baseline-performance-report.md` with a summary including:
      - p50/p95/p99, min/max.
      - Success rate, error rate, throughput.
      - SLO gate checks (p95 ≤ 12s, ≥99% success) and legacy 8s gate.
- **Perf workflows:**
  - `.github/workflows/perf-baseline.yml` – manual baseline run (with optional
    schedule commented out).
  - `.github/workflows/perf-gate.yml` – scheduled and PR perf gate against
    production (`/healthz` and SSE resume), using `perf/perf.yml`.

This slice **reuses** these components; we do not introduce new perf tooling.

---

## 2. Running a CEE-focused baseline

You can run a baseline against any environment by setting `PERF_TARGET_URL`.
For example, from repo root:

```bash
# Staging (or your main deployed environment)
PERF_TARGET_URL=https://olumi-assistants-service.onrender.com \
PERF_DURATION_SEC=300 \
PERF_RPS=1 \
pnpm perf:baseline
``

The script will:

- Run the Artillery scenario defined in `tests/perf/baseline.yml`.
- Write JSON + HTML reports under `tests/perf/_reports/`.
- Append a new section to `docs/baseline-performance-report.md` with:
  - Timestamp and configuration.
  - p50/p95/p99 latency.
  - Success / error rate.
  - Throughput.
  - SLO gate status (p95 ≤ 12s, ≥99% success rate).

The current scenarios focus on:

- `/healthz` – overall service health.
- `/assist/draft-graph` – the primary CEE route that actually invokes the
  engine and LLM, so its latency dominates CEE user experience.

As long as you keep this scenario stable, new baseline entries are directly
comparable over time.

---

## 3. Interpreting CEE baselines

When you read `docs/baseline-performance-report.md` for a given run, pay
particular attention to:

- **Draft Graph p95 latency**
  - Ideally ≤ 8s under baseline load (1 rps for 5 minutes).
  - Anything between 8s and 12s should be treated as a warning and triaged.
  - >12s should be considered an SLO violation and investigated.
- **Success rate**
  - Aim for ≥99.0% success (2xx) for `/assist/draft-graph` during the run.
  - Non-2xx responses should be rare and explainable (e.g. deliberate
    validation failures, known 4xx cases).
- **Error patterns**
  - Cross-check error codes and rates with CEE diagnostics:
    - Run `pnpm cee:diagnostics --json` against the same environment.
    - Compare `recent_error_counts.by_capability.draft_graph` with Artillery
      failures.

These baselines give you a concrete, CEE-aware sense of:

- Whether the current deployment is materially slower than previous ones.
- Whether error rates are creeping up even at low load.

---

## 4. Nightly / scheduled checks

You already have a scheduled performance gate in
`.github/workflows/perf-gate.yml` that:

- Runs Artillery (`perf/perf.yml`) against
  `https://olumi-assistants-service.onrender.com`.
- Enforces a p95 < 8000 ms gate on `/healthz`.
- Uploads `perf-results.json` as an artifact and writes a job summary.

To keep things simple and avoid duplicate systems:

- Treat the **perf gate** as your continuous guardrail.
- Use `pnpm perf:baseline` manually when you want a more detailed point-in-time
  baseline (e.g. before/after a major CEE change).

If you want a dedicated, staging-only nightly baseline in the future, you can
uncomment the `schedule:` block in `.github/workflows/perf-baseline.yml` and
point `perf_target_url` at a staging deployment. For now, this slice does not
change workflow schedules.

---

## 5. CEE-specific recommendations

- Run a baseline **before and after** major CEE engine changes (e.g. new
  provider/model, substantial quality heuristic changes).
- Always cross-check baseline artifacts with:
  - `/healthz` output for the same deployment.
  - `cee:diagnostics` summary (especially `recent_error_counts` for
    `draft_graph`).
- Keep an eye on:
  - `p95` drift over time.
  - Any unexpected spikes in non-2xx rates during baselines.

This gives you a simple, repeatable way to spot regressions in CEE latency and
reliability without introducing new tooling.

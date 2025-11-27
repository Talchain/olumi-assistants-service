# New Developer Onboarding

Welcome to the Olumi Assistants Service codebase. This guide is aimed at engineers who are new to the repo and want to become productive quickly, with a particular focus on CEE (Causal Evaluation & Explanation).

This document complements, but does not replace, the existing docs under `Docs/`. Treat this as your "start here" map and follow links into the more detailed docs as needed.

---

## 1. Quick Start / TL;DR

**Goal:** get the project running locally, with tests and OpenAPI validation passing.

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Run the full test suite**

   ```bash
   pnpm test
   ```

3. **Run preflight checks (OpenAPI, generated types, etc.)**

   ```bash
   pnpm preflight
   ```

4. **(Optional) Run the dev server**

   Check the root `README.md` or existing dev scripts for the current dev-server command (it is typically a `pnpm` script). Once running, you can hit health and CEE endpoints such as:

   - `GET /healthz`
   - `POST /assist/v1/draft-graph`
   - `POST /assist/v1/bias-check`

If those commands pass locally, you are in a good place to start making changes.

---

## 2. Architecture at a Glance

At a very high level, the Assistants Service is structured as:

- **HTTP layer & routes** – Fastify-based HTTP endpoints under `src/routes/`.
  - CEE endpoints live in files such as:
    - `src/routes/assist.v1.draft-graph.ts`
    - `src/routes/assist.v1.bias-check.ts`
    - `src/routes/assist.v1.options.ts`, `src/routes/assist.v1.evidence-helper.ts`, etc.
- **CEE core logic** – CEE-specific logic lives under `src/cee/`.
  - Pipelines, validation, and orchestration: `src/cee/validation/*`.
  - Bias detection and library: `src/cee/bias/*`.
  - Structural heuristics: `src/cee/structure/*`.
- **LLM adapters & fixtures** – LLM routing and fixtures under `src/adapters/llm/` and `src/utils/fixtures.ts`.
- **Telemetry & logging** – Centralised in `src/utils/telemetry.ts`.
  - `TelemetryEvents` enum and `emit(...)` are the primary hooks for instrumentation.
- **TypeScript SDK** – Client-facing helpers and types under `sdk/typescript/src/`.
  - CEE helpers and integration surfaces: `sdk/typescript/src/ceeHelpers.ts` & `ceeTypes.ts`.

For CEE-specific work, you will usually touch:

- One or more CEE routes (`src/routes/assist.v1.*.ts`).
- The relevant CEE pipeline or helper under `src/cee/`.
- Telemetry wiring in `src/utils/telemetry.ts`.
- SDK helpers and types in `sdk/typescript/src/` (for downstream consumers).

---

## 3. Local Development Workflow

### 3.1 Environment & tooling

- Package manager: **pnpm**.
- You should have a reasonably recent Node LTS.
- Most tests run against **fixtures** rather than real LLM providers by default.

Some useful environment variables (for tests and local runs):

- `LLM_PROVIDER=fixtures` – use deterministic fixtures for CEE flows.
- `ASSIST_API_KEYS` – comma-separated list of API keys used in tests and rate-limit buckets.
- CEE feature versions and rate limits (see also the CEE docs):
  - `CEE_DRAFT_FEATURE_VERSION`, `CEE_DRAFT_RATE_LIMIT_RPM`
  - `CEE_BIAS_CHECK_FEATURE_VERSION`, `CEE_BIAS_CHECK_RATE_LIMIT_RPM`
  - Similar env vars exist for options, evidence helper, sensitivity coach, team perspectives, and explain.

### 3.2 Common commands

- **Run all tests**

  ```bash
  pnpm test
  ```

- **Run a specific test file** (Vitest)

  ```bash
  pnpm test -- tests/integration/cee.draft-graph.test.ts
  ```

- **Preflight / OpenAPI checks**

  ```bash
  pnpm preflight
  ```

  This validates `openapi.yaml`, regenerates `src/generated/openapi.d.ts`, and ensures the API surface stays consistent.

### 3.3 CEE-focused tests

CEE logic is covered by a mix of unit, integration, and validation tests. Useful starting points:

- Unit tests:
  - `tests/unit/cee.*.test.ts` – CEE pipelines, guards, bias detectors, structural heuristics, etc.
- Integration tests:
  - `tests/integration/cee.*.test.ts` – end-to-end calls to CEE endpoints (draft graph, bias check, etc.).
- Validation / shape tests:
  - `tests/validation/cee.openapi-shape.test.ts`
  - `tests/utils/telemetry-events.test.ts`

When making changes, it is common to add or extend tests in these areas.

---

## 4. CEE Overview

CEE (Causal Evaluation & Explanation) provides a set of v1 endpoints that share a common contract. The canonical reference is:

- **`Docs/CEE-v1.md`** – describes:
  - CEE v1 envelopes (draft, options, evidence helper, bias check, sensitivity coach, team perspectives, explain).
  - The frozen v1 wire contract.
  - Feature flags for optional behaviours (e.g., structural bias detectors, draft structural warnings).
  - Bias library integration and structural heuristics.

### 4.1 CEE endpoints

Common CEE v1 endpoints include:

- `POST /assist/v1/draft-graph` – builds a decision graph from a brief.
- `POST /assist/v1/bias-check` – detects bias findings on a graph.
- `POST /assist/v1/options` – suggests decision options.
- `POST /assist/v1/evidence-helper` – scores evidence items.
- `POST /assist/v1/sensitivity-coach` – highlights sensitivity / failure modes.
- `POST /assist/v1/team-perspectives` – aggregates team input.
- `POST /assist/v1/explain-graph` – explains parts of the graph.

Each of these has an associated route file under `src/routes/` and a corresponding schema in the OpenAPI definition.

### 4.2 Feature flags and configuration

CEE behaviour is controlled via environment variables. Important examples:

- Structural bias and draft structural warnings:
  - `CEE_BIAS_STRUCTURAL_ENABLED` – enables structural bias detectors for bias check.
  - `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED` – enables structural draft warnings and confidence flags on draft graph responses.
- Per-feature rate limits (RPM):
  - `CEE_DRAFT_RATE_LIMIT_RPM`, `CEE_BIAS_CHECK_RATE_LIMIT_RPM`, etc.
- Feature-version identifiers for tracking model versions per feature.

These values are surfaced in `/healthz` under the `cee.config` block.

---

## 5. Telemetry, Logging, and Observability

Telemetry is centralised in `src/utils/telemetry.ts` via:

- `TelemetryEvents` – an enum of all event types.
- `emit(TelemetryEvents.SomeEvent, eventData)` – call sites in routes and pipelines.

The telemetry module is responsible for:

- Mapping events to Datadog metrics (counters, histograms) with appropriate tags.
- Ensuring that **no prompts, briefs, graph labels, or LLM text** are ever emitted.

For CEE specifically:

- Request/response-level telemetry events are emitted for all CEE endpoints, with:
  - Request IDs, latency, quality scores.
  - Counts/flags (e.g., truncation, validation issues).
  - Engine provider/model and cost estimates where applicable.
- Tests that help you reason about telemetry:
  - `tests/integration/cee.telemetry.test.ts` – validates payload shapes and ensures no free text is present.
  - `tests/utils/telemetry-events.test.ts` – protects event names and basic structure.

When adding new telemetry:

1. Extend the relevant event payload in the route or pipeline.
2. Map the event to metrics in `src/utils/telemetry.ts`.
3. Update or add tests so the new fields are covered and remain metadata-only.

---

## 6. SDK and Decision Review Integration

The TypeScript SDK under `sdk/typescript/src/` is the primary integration surface for downstream consumers (e.g. PLoT, Scenario UI). Key areas:

- **Types and envelopes:** `sdk/typescript/src/ceeTypes.ts`.
- **Helpers and integration shapes:** `sdk/typescript/src/ceeHelpers.ts`.

Important helpers include:

- `buildCeeDecisionReviewPayload` – builds a compact, metadata-only decision review bundle suitable for UI surfaces.
- `buildCeeJourneySummary` and `buildCeeUiFlags` – summarise health and UI flags across all CEE envelopes.
- `buildCeeTraceSummary` – small trace object for downstream systems.
- **Structural/bias snapshot:** `buildCeeBiasStructureSnapshot` – summarises:
  - Structural draft warnings and confidence flags.
  - Bias findings by severity, category, and code.

All of these helpers are intentionally **metadata-only** and safe to persist or log on the consumer side.

SDK helpers are extensively tested in:

- `sdk/typescript/src/ceeHelpers.test.ts`

When you add or change helper behaviour, update those tests to keep the documented contract stable for consumers.

---

## 7. Privacy, Safety, and Invariants

Several parts of the codebase enforce privacy and safety invariants:

- PII and redaction logic is covered by tests such as:
  - `tests/unit/pii-guard.test.ts`
  - Other `grounding.*.test.ts` and redaction-related tests.
- CEE-specific invariants:
  - CEE envelopes and decision-review payloads used for UI and analytics are **metadata-only**.
  - Telemetry and diagnostics (including structural and bias snapshots) must not contain:
    - Raw prompts
    - User briefs
    - Graph labels / node titles
    - LLM-generated text

Before introducing a new surface that might be logged or persisted, ask:

> Can this be expressed purely in terms of enums, counts, flags, or IDs?

If not, it probably does not belong in telemetry or long-lived diagnostics.

---

## 8. Making Changes Safely

A common pattern for safe changes is:

1. **Identify the route and pipeline** you need to touch.
   - For example, for CEE draft graph: `src/routes/assist.v1.draft-graph.ts` and `src/cee/validation/pipeline.ts`.

2. **Identify any relevant telemetry and SDK integration points.**
   - Telemetry: `src/utils/telemetry.ts`, `tests/integration/cee.telemetry.test.ts`.
   - SDK: `sdk/typescript/src/ceeHelpers.ts` and `ceeHelpers.test.ts`.

3. **Add or update tests first** where possible.
   - Unit tests for internal logic.
   - Integration tests for end-to-end behaviour.
   - Validation tests if you are touching schemas or event shapes.

4. **Implement the change** in small, reviewable steps.

5. **Run checks locally:**

   ```bash
   pnpm test
   pnpm preflight
   ```

6. **Update documentation** if you touch:
   - Public CEE contracts or wire formats (`Docs/CEE-v1.md`).
   - Operational guidance (`Docs/CEE-maintainers-guide.md`, `Docs/CEE-incident-runbook.md`).
   - Developer workflows or expectations (this onboarding doc).

---

## 9. Where to Go Next

If you are new to the repo and want to go deeper:

- Read **`Docs/CEE-v1.md`** to understand the CEE v1 contract and envelopes.
- Skim **`Docs/CEE-maintainers-guide.md`** for maintainer-oriented workflows and tools.
- Look at **`Docs/CEE-incident-runbook.md`** for how CEE is operated in production.
- Browse `tests/integration/cee.*.test.ts` to see realistic end-to-end examples of how CEE endpoints are exercised.

From there, pick a small change (e.g. a new metric, a small helper, or a targeted test) and use this guide as a checklist for making and validating your update.

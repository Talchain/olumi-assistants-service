# CEE Maintainer’s Guide

**Purpose:** Help future maintainers evolve CEE safely without breaking
contracts, privacy guarantees, or determinism.

CEE v1 is a **metadata-only**, **deterministic** layer sitting on top of the
existing draft pipeline. This guide summarises the key invariants and where to
look before making changes.

---

## 1. Core invariants

- **Metadata-only helpers**
  - SDK helpers (`buildDecisionStorySummary`, `buildCeeHealthSummary`,
    `buildCeeJourneySummary`, `buildCeeUiFlags`, `buildCeeDecisionReviewPayload`,
    etc.) must:
    - Consume only structured metadata from CEE envelopes
      (`trace`, `quality`, `validation_issues`, `response_limits`, counts,
      team summaries, IDs, enums).
    - Never inspect or re-emit briefs, graphs, or LLM text.
- **Determinism**
  - Given the same CEE response envelopes, helpers must always return the same
    outputs.
  - No calls to random sources, current time, environment, or network inside
    helpers or tests.
- **Privacy**
  - No new logging of prompts, graphs, or CEE content.
  - Telemetry remains ID/boolean/number/enum only.
- **Contracts are frozen**
  - OpenAPI schemas for CEE (`CEEDraftGraphResponseV1`, `CEEErrorResponseV1`,
    etc.) are shared with external clients.
  - Telemetry event names and fields in `src/utils/telemetry.ts` are frozen and
    validated by tests.
  - Public SDK exports from `sdk/typescript/src/index.ts` must remain
    backwards-compatible.

When in doubt, err on the side of **additive** changes and respect existing
shapes.

---

## 2. Key surfaces

- **Contracts and engine behaviour**
  - OpenAPI: `openapi.yaml` + `src/generated/openapi.d.ts`.
  - CEE finaliser and guards: `src/cee/validation/pipeline.ts`.
  - Quality and judgement policy: `src/cee/quality/index.ts`,
    `src/cee/guidance/index.ts`, `src/cee/team/index.ts`.
- **SDK helpers (TypeScript)**
  - CEE helper implementations and types:
    - `sdk/typescript/src/ceeHelpers.ts`.
  - CEE client:
    - `sdk/typescript/src/ceeClient.ts`.
  - Public exports:
    - `sdk/typescript/src/index.ts`.
- **Hero journeys and tests**
  - Integration tests for CEE journeys and failure modes:
    - `tests/integration/cee.hero-journey.test.ts` (baseline).
    - `tests/integration/cee.hero-journey.truncation.test.ts`.
    - `tests/integration/cee.hero-journey.rate-limit.test.ts`.
    - `tests/integration/cee.hero-journey.partial-deferred.test.ts`.
    - `tests/integration/cee.hero-journey.disagreement.test.ts`.
    - `tests/integration/cee.hero-journey.heavy-truncation.test.ts`.
  - Unit tests for CEE helpers and policy:
    - `sdk/typescript/src/ceeHelpers.test.ts`.
    - `tests/unit/cee.*.test.ts`.
- **Docs and playbooks**
  - `Docs/CEE-v1.md` – main spec, judgement policy, SDK usage.
  - `Docs/CEE-recipes.md` – usage patterns (draft-only, full journey, deferred tools).
  - `Docs/CEE-telemetry-playbook.md` – dashboards and alerts.
  - `Docs/CEE-incident-runbook.md` – incident triage and mitigation.
  - `Docs/CEE-troubleshooting.md` (if present) – FAQ-style answers.
  - Dev-only tools (non-normative helpers)
    - `scripts/cee-demo-cli.ts`, `scripts/cee-health-snapshot.ts`,
      `scripts/cee-review-cli.ts`, and `scripts/cee-prompt-lint.ts` are
      **local debugging and linting aids only**. They must remain metadata-only
      and are not part of the runtime CEE pipeline or public SDK contract.

- **SSE / degraded-mode surfaces**
  - SSE stream and resume implementation and diagnostics:
    - `src/routes/assist.draft-graph.ts`.
    - `src/utils/degraded-mode.ts` (header name and reason constants).
  - SSE/resume tests (Redis resilience, diagnostics, degraded mode):
    - `tests/sse.parity.test.ts`.
    - `tests/integration/sse-resume.test.ts`.
    - `tests/chaos/redis-blip.test.ts`.
    - `tests/chaos/disconnect.test.ts`.
    - `tests/integration/cee.hero-journey.degraded.test.ts`.

Always update both tests and docs when changing behaviour.

### 2.1 Spec alignment and intentional divergences

- **Live contract sources**
  - For CEE v1, the source of truth is:
    - `openapi.yaml` and `src/generated/openapi.d.ts`.
    - `Docs/CEE-v1.md`.
    - The SDK CEE types and client in `sdk/typescript/src/ceeTypes.ts` and
      `sdk/typescript/src/ceeClient.ts`.
  - These surfaces must remain in lockstep. Any contract change should be
    expressed first in OpenAPI, then reflected in generated types, server
    handlers, and the SDK.

- **Historical v0.4 spec document**
  - `Docs/Olumi- Cognitive Enhancement Engine (CEE) - Specification v04.*`
    is kept as a design artefact capturing early intent.
  - It is **not** the live contract. Where it disagrees with OpenAPI or
    `Docs/CEE-v1.md`, the latter two win.

- **Intentional divergences from the v0.4 draft**
  - **Endpoint names**
    - The v0.4 doc used working names such as `/assist/v1/explain-inference`
      and `/assist/v1/suggest-evidence`.
    - CEE v1 exposes:
      - `/assist/v1/explain-graph` (Explain Graph).
      - `/assist/v1/evidence-helper` (Evidence Helper).
      - `/assist/v1/options` (Options helper).
      - `/assist/v1/bias-check` (Bias Check).
    - These names are baked into OpenAPI and the SDK and should not be churned
      to match older sketches.
  - **Draft request shape**
    - The v0.4 doc described a `DraftGraphRequestV1` with
      `description` / `decision_type` / `context` / `evidence` fields.
    - The live CEE v1 contract reuses the existing `DraftGraphInput` shape and
      layers CEE-specific fields on top via `CEEDraftGraphRequestV1`:
      - `seed?: string` and `archetype_hint?: string`.
    - This alignment with the existing draft pipeline is intentional; do not
      try to retrofit the older request shape.
  - **Evidence Helper surface**
    - The v0.4 doc sketched richer structures such as evidence coverage and
      suggestion records.
    - CEE v1 deliberately exposes a smaller surface in
      `CEEEvidenceHelperResponseV1`:
      - Scored evidence items.
      - `response_limits` caps and truncation flags.
      - Optional shared `guidance` metadata.
    - More detailed coverage/suggestion structures are deferred to future
      versions and should only be added **additively** once there are concrete
      consumers.

- **Evolving the spec safely**
  - Treat the v0.4 document as design intent and the current OpenAPI/CEE v1
    docs as the live contract.
  - Any future evolution must be:
    - Additive (no breaking changes to existing schemas or SDK exports).
    - Reflected across OpenAPI, generated types, server, SDK, and docs.
    - Consistent with CEE privacy and determinism invariants.

### 2.2 Phase-1 and integration SSOT

- **Phase-1 roadmap (P1–P5)**
  - Phase-1 CEE work is complete and shipped:
    - P1 – Spec alignment and intentional divergences documented.
    - P2 – `applyGraphPatch` helper + types/tests/recipe.
    - P3 – X-CEE headers guaranteed and documented.
    - P4 – Graph limits and `/v1/limits` adapter documented.
    - P5 – Evidence Helper v1 contract clarified + coverage helper.
- **Cross-repo integration governance**
  - The canonical integration spec between CEE, PLoT, and Scenario UI is:
    - `Docs/Olumi - CEE–Scenario–PLoT Integration SSOT v10.md`.
  - Any change in CEE that affects PLoT or UI behaviour must:
    - Remain additive and metadata-only.
    - Stay consistent with decisions D1–D7 in the SSOT (who calls CEE, where it
      sits in the pipeline, config/keys, etc.).
    - Be reflected in the SSOT first (bumping its version), then in OpenAPI,
      server code, SDK, and docs.

---

## 3. Test & verification checklist

Run these from the repo root whenever you change CEE logic, helpers, or
contracts:

```bash
pnpm fixtures:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm preflight
```

Specifically for CEE changes:

- **Unit tests**
  - `pnpm test sdk/typescript/src/ceeHelpers.test.ts`
  - `pnpm test tests/unit/cee.*.test.ts`
- **Hero journeys** (integration)
  - `pnpm test tests/integration/cee.hero-journey.test.ts`
  - `pnpm test tests/integration/cee.hero-journey.truncation.test.ts`
  - `pnpm test tests/integration/cee.hero-journey.rate-limit.test.ts`
  - `pnpm test tests/integration/cee.hero-journey.partial-deferred.test.ts`
  - `pnpm test tests/integration/cee.hero-journey.disagreement.test.ts`
  - `pnpm test tests/integration/cee.hero-journey.heavy-truncation.test.ts`
- **Telemetry and contracts**
  - `pnpm test tests/integration/cee.telemetry.test.ts`
  - `pnpm test:cee:telemetry`
  - `pnpm preflight` (includes OpenAPI validate/generate).

- **SSE / Redis resilience and degraded mode**
  - `pnpm test:sse:core` – SSE parity and resume tests (core behaviour).
  - `pnpm test:sse:chaos` – Redis chaos tests (Redis blips, disconnect/resume).
  - `pnpm test tests/validation/cee.openapi-shape.test.ts` – OpenAPI spec-drift
    guard for CEE response shapes (including `response_limits`).

For helper performance changes, there is a dev-only micro-bench harness:

```bash
pnpm tsx scripts/cee-bench-helpers.ts
# optionally adjust iterations (default 2000)
CEE_BENCH_ITERS=5000 pnpm tsx scripts/cee-bench-helpers.ts
```

This constructs synthetic heavy CEE envelopes and times the core helpers.

---

## 4. How to extend helpers safely

When adding new helper functionality (e.g. new flags, new summary fields):

1. **Stay metadata-only**
   - Use existing CEE metadata: `quality`, `validation_issues`, counts,
     `response_limits`, `trace`, team summary.
   - Do not read `brief`, `graph`, or any free-text labels.

2. **Keep changes additive**
   - Prefer adding new fields to helper return types, not changing or
     renaming existing ones.
   - If you need structured reasons, consider adding a new field rather than
     changing `reasons: string[]` in place.

3. **Update tests and docs together**
   - Add unit tests in `ceeHelpers.test.ts` to lock in semantics and prevent
     regressions.
   - If behaviour changes, update `Docs/CEE-v1.md` and/or
     `Docs/CEE-recipes.md` to describe the new semantics.

4. **Preserve determinism**
   - Avoid any dependency on current time, randomness, or environment flags
     inside helpers.

---

## 5. Common pitfalls

- **Inspecting content instead of metadata**
  - Do not read free-text fields (briefs, node labels, LLM outputs) from CEE
    envelopes in helpers, tests, or logs.
  - Use secret markers in hero journeys to ensure nothing leaks into
    summaries.

- **Breaking public SDK types/exports**
  - Do not rename or remove existing exported types/functions from
    `sdk/typescript/src/index.ts`.
  - Avoid narrowing types in ways that would break downstream TypeScript
    consumers.

- **Changing telemetry shapes**
  - Telemetry event names and fields are frozen and validated by tests.
  - If you need new telemetry, add separate events/fields and coordinate with
    observability owners.

- **Forgetting to run the full verification suite**
  - Always run the full `pnpm` checklist before merging CEE changes. This is
    the best guard against regressions in contracts, telemetry, and privacy.

---

## 6. Where to ask for help

If you are unsure about a change:

- Start by reading:
  - `Docs/CEE-v1.md` – for judgement policy and helper semantics.
  - `Docs/CEE-telemetry-playbook.md` – for observability.
  - `Docs/CEE-incident-runbook.md` – for incident handling.
- Then propose your change in a small PR with:
  - Clear description of the intended behaviour.
  - Tests demonstrating the new semantics.
  - Notes on why it remains metadata-only and deterministic.

CEE is intentionally small and conservative; prefer incremental, well-tested
changes over broad refactors.

---

## 7. Current CEE roadmap slice (internal)

This section tracks the next small, additive CEE v1 maintenance slice. Each
task group should be implemented without changing existing HTTP schemas,
telemetry event names/shapes, or public SDK contracts.

- **TG1 – CEE telemetry ergonomics for maintainers**
  - [ ] Wire `cee.*` telemetry events into Datadog metrics in
    `src/utils/telemetry.ts`, using only existing metadata fields. Do not add
    new telemetry events or change any payload shapes.
  - [ ] Extend `Docs/CEE-telemetry-playbook.md` with a CEE-specific section
    describing the new metrics and example dashboards.
  - [ ] Keep `tests/utils/telemetry-events.test.ts` in sync with the metrics
    mapping so dashboards and CI guards remain aligned with the frozen event
    enum.

- **TG2 – Additional CEE golden coverage for risk/disagreement journeys**
  - [ ] Add a new golden journey fixture under
    `tests/fixtures/cee/golden-journeys/` that exercises a high-risk,
    disagreement-heavy decision with truncation (metadata-only).
  - [ ] Wire the new fixture into `tests/utils/cee-golden-journeys.ts` and
    `tests/integration/cee.golden-journeys.test.ts`, asserting the expected
    journey health, truncation, and disagreement flags without relying on raw
    briefs or graph labels.
  - [ ] Update `Docs/CEE-golden-journeys.md` to document the new fixture and its
    intent.
  - [ ] Ensure existing privacy guards still pass for the new fixture, reusing
    `expectNoSecretLikeKeys` and `expectNoBannedSubstrings`.

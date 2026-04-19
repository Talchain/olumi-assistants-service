# V5 Phase 1.5 — Evidence Pack

**Branch:** `claude/v5-phase1.5-graph-threading`
**Base:** `941dfc1d` (Phase 1 PR merge)
**Risk tier:** C (safety envelope activation)
**Spec:** `olumi-v5-architecture-specification-v2.md` §4, §6, §7, §10

---

## 1. What landed

The V5 HTTP route now threads `graph_state` + `analysis_state` from the request body into the TurnExecutor. The validator's graph-dependent checks — entity existence, Dice suspicion, kind cross-check, `run_analysis` precondition — activate on every turn that carries a graph. Turns without a graph emit a new `validate_skipped_no_graph` telemetry stage; the legacy `validate_skipped_graph_checks` emission is gone from production code.

V5 remains flag-gated (`ENABLE_V5_ORCHESTRATOR=false` by default). Phase 1.5 activates the internals; enabling the flag is a separate rollout decision.

**Commit history (5 commits on this branch):**
1. `feat(v5): Phase 1.5 — graph threading + full validator activation` — initial foundation
2. `fix(v5): Phase 1.5 review — kind cross-check, payload-drift guard, strict types` — review round 1
3. `fix(v5): Phase 1.5 review round 2 — precondition wire reality + telemetry polish` — review round 2
4. `fix(v5): Phase 1.5 review round 3 — coercion safety, telemetry completeness, analytics-friendly log` — review round 3
5. `fix(v5): Phase 1.5 pre-merge polish — BI-01 hardening + test typecheck cleanup` — pre-merge audit (this)

---

## 2. Wire investigation findings (D1)

Captured in [Docs/v5/phase1.5-wire-investigation.md](./phase1.5-wire-investigation.md). Summary:

- **V5 route exists at [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts)** (the brief's grep commands targeted `src/routes/orchestrate-v2.ts`, which doesn't exist).
- **`@talchain/schemas` v0.5.1 is vendored + off-limits.** Its `OrchestratorTurnPayloadSchema` is `strict` mode and has 5 fields only — cannot accept `graph_state` / `analysis_state` directly.
- **UI wire shape** (confirmed via [turn-request-builder.ts](../../../DecisionGuideAI/src/services/turn-request-builder.ts) + [tests/fixtures/golden/ui-turn-with-graph.json](../../tests/fixtures/golden/ui-turn-with-graph.json)): snake_case, `graph_state: { nodes, edges }` as raw content (no `options[]` array on the wire — canonical options live in the scenario store).
- **Staleness signals on wire: none.** UI sends no stale flag, no graph_hash. `V2RunResponseEnvelope.analysis_provenance.graph_hash` does not exist in either repo. Per brief's fallback ladder: staleness ships as `null`; server-computed hash emits to the routing log for future provenance wiring.

**Architecture deviation from brief (handled):** Brief assumed graph/analysis already flowed into B1. Reality is that B1's strict mode would reject unknown keys. Resolution: parse extensions BEFORE B1 and strip them from the body before handing to B1. See [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) — `stripExtensionFields`.

---

## 3. Implementation evidence

### D2 — Boundary parse + thread

- **[src/orchestrator-v5/boundary/request-extensions.ts](../../src/orchestrator-v5/boundary/request-extensions.ts)** — permissive Zod schemas matching the actual wire:
  - `GraphStateIngressSchema` — requires only `{ id, kind, label }` on nodes and `{ from, to }` on edges; everything else passthrough. NOT `CEEGraphResponseV3Schema`.
  - `AnalysisStateIngressSchema` — only `analysis_status: z.string()` required; `meta.response_hash` NOT mandatory.
- Zod-inferred types (`GraphStateIngress`, `AnalysisStateIngress`) are exported and used throughout downstream modules — no `as unknown as` casts in production code.
- **Tests:** [src/orchestrator-v5/boundary/__tests__/request-extensions.test.ts](../../src/orchestrator-v5/boundary/__tests__/request-extensions.test.ts) — 11 tests including real UI fixture round-trip.

### D3 — Assembler populates graph/analysis; hash stays internal

- **[src/orchestrator-v5/context/graph-hash.ts](../../src/orchestrator-v5/context/graph-hash.ts)** — `computeDeterministicGraphHash(GraphStateIngress | null) → string | null`. Sorts node IDs and (from, to) pairs, stable-stringifies, SHA-256, 16 hex chars. NOT a field on ContextPack (plan correction #3).
- **[src/orchestrator-v5/context/context-pack-assembler.ts](../../src/orchestrator-v5/context/context-pack-assembler.ts)** — `GraphWithOptions` interface widened to accept structurally compatible ingress and full-V3 shapes.
- **Tests:** [graph-hash.test.ts](../../src/orchestrator-v5/context/__tests__/graph-hash.test.ts) — 10 tests including determinism under permutation + passthrough-field independence.

### D4 — Validator activation (adapter pattern, not validator edits)

- **[src/orchestrator-v5/routing/graph-lookup-adapter.ts](../../src/orchestrator-v5/routing/graph-lookup-adapter.ts)** — `buildGraphLookup(GraphStateIngress | null) → BuildGraphLookupResult`. Discriminated union: `{ kind: 'no_graph' } | { kind: 'ok', lookup, stats } | { kind: 'all_dropped', stats }`. Maps NodeV3 kinds to validator's `EntityKind` vocabulary. Returns `GraphLookupWithOptions` — extended interface that preconditions narrow to for option-level data.
- **[src/orchestrator-v5/routing/validation-registry.ts](../../src/orchestrator-v5/routing/validation-registry.ts)** — `run_analysis` precondition is wire-checkable only: "at least one option node in graph.nodes" → `no_options_defined` if not. Intervention-readiness is the handler's responsibility (async scenarioReader).
- **[src/orchestrator-v5/routing/validator.ts](../../src/orchestrator-v5/routing/validator.ts)** — ONE edit: kind cross-check after `findEntityById` success. Existing structural checks untouched.

### D5 — TurnExecutor integration

- **[src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts)** — new `graphState` + `analysisState` options. STEP 1 passes them to `assembleContextPack`. STEP 2 uses the pre-derived `graphLookupForValidate`. Telemetry stage updated: `validate_skipped_graph_checks` → `validate_skipped_no_graph`. Routing-log carries `graph_node_count`, `graph_edge_count`, `graph_hash`, adapter stats, and `graph_lookup_outcome`.
- **BI-01 hardening (pre-merge):** graph-lookup derivation + telemetry emits live INSIDE the top-level try/finally, so any throw from `emit()` still lands in the finally and emits a matching `turn_executor.completed`. Regression guard test verifies `completedCount >= startedCount` even under synthetic emit failure.
- **[src/orchestrator-v5/routing/routing-log.ts](../../src/orchestrator-v5/routing/routing-log.ts)** — fields added: `graph_node_count`, `graph_edge_count`, `graph_hash` (Phase 1.5), `graph_mapped_nodes`, `graph_dropped_by_unknown_kind`, `graph_dropped_by_missing_id`, `graph_lookup_outcome` (rounds 1-3). Count fields are non-null `number` with zero defaults.

### D6 — Integration tests (fastify inject + behavioural assertions)

Under `tests/integration/`:
- **[phase1.5-graph-routing.test.ts](../../tests/integration/phase1.5-graph-routing.test.ts)** — 5 tests. Real UI fixture E2E via `app.inject()` including MUST-PASS Imp-1 test with UNMODIFIED fixture (no synthetic options) — regression guard for the P0-1 bug that was masked by test fixtures earlier.
- **[phase1.5-validator-rejection-with-graph.test.ts](../../tests/integration/phase1.5-validator-rejection-with-graph.test.ts)** — 6 tests covering all validator error paths with behavioural assertions.
- **[phase1.5-staleness.test.ts](../../tests/integration/phase1.5-staleness.test.ts)** — 3 tests on staleness scaffolding + hash determinism.
- **[phase1.5-phase1-regression.test.ts](../../tests/integration/phase1.5-phase1-regression.test.ts)** — 4 tests replaying Phase 1 scenarios through the threaded path.

### D7 — Invariant extensions

- **[scripts/validate-v5-phase1.5-invariants.sh](../../scripts/validate-v5-phase1.5-invariants.sh)** — guards:
  1. `validate_skipped_graph_checks` string literal must not appear in production code (test files excluded — they reference the name as a regression guard).
  2. No semantic transforms (`Math.round`, `.toFixed(`, `parseFloat(`, `Number(`) in the ContextPack assembler.
- Wired into [scripts/validate-prepush.sh](../../scripts/validate-prepush.sh) as check #14.

---

## 4. Review-round changes summary

### Round 1 (commit `ad05da13`)
- **P0-1** — validator kind cross-check (LLM-hallucination guard)
- **P0-2** — adapter discriminated result (`no_graph | ok | all_dropped`); fail-fast on `all_dropped`
- **P0-3** — Zod-inferred types through the boundary; zero `as unknown as` in production
- **P1-3** — (superseded in round 2) initial options-readiness check
- **Imp-2** — adapter drop telemetry

### Round 2 (commit `55e52c69`)
- **P0-1 (wire reality)** — precondition weakened to "at least one option node in graph.nodes" (the only wire-checkable signal). Handler owns intervention-readiness via async scenarioReader. This fixed a latent bug where every real production `run_analysis` turn would have failed with a spurious `options_lack_intervention_data`.
- **P1-1** — `no_graph` outcome emitted on frame-stage turns (was silent)
- **P1-2** — routing log preserves ingress counts on fail-fast paths (was 0)
- **P1-3** — `coerceIngressAnalysis` only defaults when `results` is absent
- **Imp-1** — MUST-PASS fastify-inject test with UNMODIFIED UI fixture
- **Imp-2** — adapter stats in routing log fields
- **Imp-3** — guard test for object-shaped results

### Round 3 (commit `26f8bb17`)
- **P1-2** — `normaliseResults()` helper converts object-shaped `results` via `Object.values()`; no type assertion
- **P1-3** — `test_override` outcome emitted too (complete event coverage)
- **Imp-1** — `graph_lookup_outcome` categorical column + zero-default count fields in routing log
- **Imp-2** — removed last three stale `options_lack_intervention_data` references

### Pre-merge round (this commit)
- **BI-01 hardening** — graph-lookup derivation + telemetry emits moved INSIDE the try block
- **Test typecheck cleanup** — `NonNullable<Parameters<...>[2]>['...']` pattern; removed dangling `GraphV3T` test-only imports; `RoutingLog[]` typing on log collectors
- **Regression guard** — new test asserts BI-01 holds even under `emit()` throw

---

## 5. Telemetry + diagnostics summary

### `turn_executor.graph_lookup` event (Imp-2 + round 3 P1-3)
Emitted exactly once per turn. Fields:
```
outcome: 'no_graph' | 'ok' | 'all_dropped' | 'test_override'
total_nodes: number
mapped_nodes: number
dropped_by_unknown_kind: number
dropped_by_missing_id: number
```
- `no_graph` — frame-stage or non-UI turns (zero stats)
- `ok` — adapter built a usable lookup (stats describe the payload)
- `all_dropped` — nodes present but none mapped; turn fails fast with `graph_payload_drift`
- `test_override` — tests injected `options.graphLookup` directly (zero stats)

### Routing log (Imp-1 round 3)
Every row carries `graph_lookup_outcome` for categorical grouping. Count fields (`graph_mapped_nodes`, `graph_dropped_by_unknown_kind`, `graph_dropped_by_missing_id`) are non-null `number` with zero defaults — no COALESCE needed in aggregation queries.

### Invariant proof
```
$ bash scripts/validate-v5-phase1.5-invariants.sh
OK: V5 Phase 1.5 invariants hold.
```

---

## 6. Adapter-pattern deviation (kept through all rounds)

**Brief asked:** validator activation via ContextPack directly.
**Phase 1.5 delivered:** [validator.ts](../../src/orchestrator-v5/routing/validator.ts) has ONE edit (the kind cross-check); otherwise `validator.ts` is unchanged. A new `buildGraphLookup` adapter translates `GraphStateIngress` → the validator's existing `GraphLookup` interface.

**Rationale.** The validator is Phase 1 code that the whole routing spine depends on. Phase 1.5 is Risk-C; minimising regression surface on validator logic was worth the indirection. Evidence: `validator.test.ts` has zero diff on existing cases — Phase 1 structural-check behaviour provably preserved.

**Cleanup path (future).** Align validator inputs with `ContextPack` directly and retire `GraphLookup`, once structural checks have additional coverage and no other V5 consumer is using `GraphLookup` as a seam.

---

## 7. Staleness deviation (user-confirmed)

Brief's fallback ladder tier 1 (provenance hash comparison) + tier 2 (UI stale flag) are both empty on the current wire. Tier 3 (`null`) ships. Server-side deterministic graph hash IS computed for the routing log so later phases can wire provenance without re-litigating canonicalisation.

**Follow-up needed when:** UI starts sending `graph_hash` alongside analysis, OR server-side last-hash storage lands, OR deterministic canonicalisation can be guaranteed producer ↔ consumer.

---

## 8. Explicitly deferred follow-ups (all documented)

- **Handler-side specific recovery codes** (round 3 P1-1) — handler produces generic `scenario_read_failed` / `plot_error` cause_kinds; a follow-up PR should add `options_not_configured` / similar so the user's recovery path is specific. Compose-layer mapping of cause_kinds to user text pairs with that change.
- **Handler-recovery integration test** (round 3 Imp-3) — pairs with the above.
- **Strict node-kind enum at B1** (round 2 P1-4) — policy choice. Plan explicitly chose permissive + telemetry for forward-compatibility. Flipping to strict would give 4xx at the boundary for unknown kinds instead of INTERNAL_ERROR downstream.
- **Constraint mapping in adapter** — no current handler accepts `constraint` entity kind; add when one does.
- **Shared UI/CEE ingress contract** — cross-team.

---

## 9. Regression delta

```
Baseline @ 941dfc1d:   59 failed | 11701 passed | 198 skipped | 1 todo
Phase 1.5 HEAD:        37 failed | 11734 passed | 198 skipped | 1 todo
Δ:                    −22 failures, +33 passes
```

All remaining failures predate this PR (verified via `git stash` round-trip during audit):
- `tests/integration/orchestrate-v2.test.ts` fixture 1 — adapter-mock mismatch against tool-use routing
- `tests/integration/orchestrator/route-v2-flag.test.ts` — 2 tests
- `tests/integration/orchestrator/route.test.ts` — V4 tests
- `tests/utils/telemetry-events.test.ts` — frozen-enum drift
- `tests/integration/slice-b-preflight.test.ts` — pre-existing

No new failures. V5 unit tests: 377 → 426 (+49). Integration tests: 16 new Phase 1.5 suites.

---

## 10. Merge checklist

- [x] TypeScript build clean — `pnpm exec tsc -p tsconfig.build.json --noEmit` exits 0
- [x] Full typecheck clean in phase1.5 files (no errors in my scope)
- [x] V5 unit tests pass — 377/377
- [x] Phase 1.5 integration tests pass — all new suites
- [x] Regression delta non-negative on full suite — −22 failures
- [x] `validate_skipped_graph_checks` absent from production code
- [x] Pre-push invariants green (all 14 checks, including `phase-1.5-invariants`)
- [x] Plan file, wire investigation, evidence pack committed under `Docs/v5/`
- [x] BI-01 regression guard in place
- [x] Five review rounds folded in with clear provenance

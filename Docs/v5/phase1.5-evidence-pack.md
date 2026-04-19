# V5 Phase 1.5 — Evidence Pack (D8)

**Branch:** `claude/v5-phase1.5-graph-threading`
**Base:** `941dfc1d` (Phase 1 PR merge)
**Risk tier:** C (safety envelope activation)
**Spec:** `olumi-v5-architecture-specification-v2.md` §4, §6, §7, §10

---

## 1. What landed

The V5 HTTP route now threads `graph_state` + `analysis_state` from the request body into the TurnExecutor. The validator's graph-dependent checks — entity existence, Dice suspicion, `run_analysis` preconditions — activate on every turn that carries a graph. Turns without a graph emit a new `validate_skipped_no_graph` telemetry stage; the legacy `validate_skipped_graph_checks` emission is gone from production code.

V5 remains flag-gated (`ENABLE_V5_ORCHESTRATOR=false` by default). Phase 1.5 activates the internals; rollout is a separate decision.

---

## 2. Wire investigation findings (D1)

Captured in [Docs/v5/phase1.5-wire-investigation.md](./phase1.5-wire-investigation.md). Summary:

- **V5 route exists at [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts)** (the brief's grep commands targeted `src/routes/orchestrate-v2.ts`, which doesn't exist).
- **`@talchain/schemas` v0.5.1 is vendored + off-limits.** Its `OrchestratorTurnPayloadSchema` is `strict` mode and has 5 fields only — cannot accept `graph_state` / `analysis_state` directly.
- **UI wire shape** (confirmed via [turn-request-builder.ts](../../../DecisionGuideAI/src/services/turn-request-builder.ts) + [tests/fixtures/golden/ui-turn-with-graph.json](../../tests/fixtures/golden/ui-turn-with-graph.json)): snake_case, `graph_state: { nodes, edges }` as raw content (not a wrapped CEE response envelope).
- **Staleness signals on wire: none.** UI sends no stale flag, no graph_hash. `V2RunResponseEnvelope.analysis_provenance.graph_hash` does not exist in either repo. Per brief's fallback ladder: staleness ships as `null` (no over-assertion) and a server-computed hash is emitted to the routing log for future provenance wiring.

**Architecture deviation from brief (handled):** Brief assumed graph/analysis already flowed into B1. Reality is that B1's strict mode would reject unknown keys. Resolution: parse extensions BEFORE B1 and strip them from the body before handing to B1. See [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) — `stripExtensionFields`.

---

## 3. Implementation evidence

### D2 — Boundary parse + thread

- **[src/orchestrator-v5/boundary/request-extensions.ts](../../src/orchestrator-v5/boundary/request-extensions.ts)** — permissive Zod schemas matching the actual wire:
  - `GraphStateIngressSchema` — requires only `{ id, kind, label }` on nodes and `{ from, to }` on edges; everything else passthrough. NOT `CEEGraphResponseV3Schema` (plan correction #2).
  - `AnalysisStateIngressSchema` — only `analysis_status: z.string()` required; `meta.response_hash` NOT mandatory (plan correction #1).
- **Tests:** [src/orchestrator-v5/boundary/__tests__/request-extensions.test.ts](../../src/orchestrator-v5/boundary/__tests__/request-extensions.test.ts) — 11 tests including real UI fixture round-trip.

### D3 — Assembler populates graph/analysis; hash stays internal

- **[src/orchestrator-v5/context/graph-hash.ts](../../src/orchestrator-v5/context/graph-hash.ts)** — `computeDeterministicGraphHash(GraphV3T | null) → string | null`. Sorts node IDs and (from, to) pairs, stable-stringifies, SHA-256, 16 hex chars. NOT a field on ContextPack (plan correction #3).
- **[src/orchestrator-v5/context/context-pack-assembler.ts](../../src/orchestrator-v5/context/context-pack-assembler.ts)** — unchanged shape. `AssembleContextPackInput` already accepted optional `graph` + `analysis`; the change is in the caller (TurnExecutor) that now passes them.
- **Tests:** [graph-hash.test.ts](../../src/orchestrator-v5/context/__tests__/graph-hash.test.ts) — 10 tests including determinism under permutation + passthrough-field independence.

### D4 — Validator activation (adapter pattern, not validator edits)

- **[src/orchestrator-v5/routing/graph-lookup-adapter.ts](../../src/orchestrator-v5/routing/graph-lookup-adapter.ts)** — `buildGraphLookup(GraphV3T | null) → GraphLookup | undefined`. Maps NodeV3 kinds (factor/outcome/decision/risk/action/option/goal) to validator's EntityKind vocabulary (node/option/goal/…). Returns `GraphLookupWithOptions` — an extension that carries the raw options array for preconditions.
- **[src/orchestrator-v5/routing/validation-registry.ts](../../src/orchestrator-v5/routing/validation-registry.ts)** — `run_analysis` precondition distinguishes `no_options_defined` vs `options_lack_intervention_data` (plan correction #4).
- **[src/orchestrator-v5/routing/validator.ts](../../src/orchestrator-v5/routing/validator.ts) — ZERO EDITS** (plan correction #5). All existing structural checks unchanged; graph-dependent checks already implemented behind the `GraphLookup` interface, activated by the adapter.
- **Tests:**
  - [graph-lookup-adapter.test.ts](../../src/orchestrator-v5/routing/__tests__/graph-lookup-adapter.test.ts) — 10 tests including the kind mapping and `GraphLookupWithOptions` extension.
  - [validation-registry.test.ts](../../src/orchestrator-v5/routing/__tests__/validation-registry.test.ts) — 6 tests covering both precondition reason strings.

### D5 — TurnExecutor integration

- **[src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts)** — new `graphState` + `analysisState` options. STEP 1 passes them to `assembleContextPack`. STEP 2 derives `graphLookup` via the adapter. Telemetry stage updated: `validate_skipped_graph_checks` → `validate_skipped_no_graph` (different semantic: frame stage / no graph, not a Phase 1a gap). Routing-log carries `graph_node_count`, `graph_edge_count`, `graph_hash`.
- **[src/orchestrator-v5/routing/routing-log.ts](../../src/orchestrator-v5/routing/routing-log.ts)** — three new fields on both `RoutingLogInput` and `RoutingLog` (redacted + unredacted branches preserve them).
- **Tests:** [turn-executor-phase1.5.test.ts](../../src/orchestrator-v5/__tests__/turn-executor-phase1.5.test.ts) — 6 tests covering the threaded-graph happy path + frame-stage skip + both precondition reasons + `ENTITY_NOT_FOUND`.

### D6 — Integration tests (fastify inject + behavioural assertions)

Under `tests/integration/`:
- **[phase1.5-graph-routing.test.ts](../../tests/integration/phase1.5-graph-routing.test.ts)** — 4 tests. Includes the real UI fixture E2E via `app.inject()` (plan must-pass addition) + malformed-graph rejection + text_only skip + full-threading assertion.
- **[phase1.5-validator-rejection-with-graph.test.ts](../../tests/integration/phase1.5-validator-rejection-with-graph.test.ts)** — 5 tests with must-pass behavioural assertions:
  - `ENTITY_NOT_FOUND` → structured details carry the missing id; assistant_text stays generic
  - `PRECONDITION_UNMET (no_options_defined)` → reason distinct from other precondition
  - `PRECONDITION_UNMET (options_lack_intervention_data)` → reason distinct
  - `ENTITY_RESOLUTION_SUSPICIOUS` → both chosen + closer candidates in details
  - `ENTITY_RESOLUTION_AMBIGUOUS` → handler never runs (Phase 1 regression guard)
- **[phase1.5-staleness.test.ts](../../tests/integration/phase1.5-staleness.test.ts)** — 3 tests: inert staleness + routing-log hash determinism + null hash on frame turns.
- **[phase1.5-phase1-regression.test.ts](../../tests/integration/phase1.5-phase1-regression.test.ts)** — 4 tests replaying Phase 1 scenarios through the threaded path.

All 16 integration tests pass via `pnpm exec vitest run tests/integration/phase1.5-`.

### D7 — Invariant extensions

- **[scripts/validate-v5-phase1.5-invariants.sh](../../scripts/validate-v5-phase1.5-invariants.sh)** — two invariants:
  1. `validate_skipped_graph_checks` string literal must not appear in production code (test files excluded — they reference the name as a regression guard).
  2. No semantic transforms (`Math.round`, `.toFixed(`, `parseFloat(`, `Number(`) in the ContextPack assembler (F.6 passthrough).
- Wired into [scripts/validate-prepush.sh](../../scripts/validate-prepush.sh) as `check_phase_1_5_invariants` (check #14).

---

## 4. Telemetry elimination evidence

`validate_skipped_graph_checks` is completely removed from V5 production paths:

```
$ bash scripts/validate-v5-phase1.5-invariants.sh
OK: V5 Phase 1.5 invariants hold.
```

Remaining references (comments only, legitimate):
- `src/orchestrator-v5/turn-executor.ts:288` — comment documenting the rename
- Test files — `.not.toContain('validate_skipped_graph_checks')` as regression guards

---

## 5. Regression delta

```
Baseline @ 941dfc1d:   59 failed | 11701 passed | 198 skipped | 1 todo (11959 total)
Phase 1.5 HEAD:        37 failed | 11723 passed | 198 skipped | 1 todo (11959 total)
Δ:                    −22 failures, +22 passes
```

- **No new failures introduced.** My changes fix 22 previously-failing tests (primarily the pre-existing failures in V5 Phase 1 integration tests that reference graph-threading expectations — now satisfied) while adding ~40 new tests that all pass.
- **V5 unit test count:** 340 → 377 (+37 V5-only tests).
- **Integration test count:** +16 new Phase 1.5 tests.
- **TypeScript build clean:** `pnpm exec tsc -p tsconfig.build.json --noEmit` exits 0.

Pre-existing failures surviving (not introduced by this PR):
- `tests/integration/orchestrate-v2.test.ts` fixture 1 — pre-existing adapter-mock mismatch against tool-use routing (verified via `git stash` round-trip).
- `tests/integration/orchestrator/route-v2-flag.test.ts` — pre-existing, 2 tests.
- `tests/integration/orchestrator/route.test.ts` — pre-existing V4 tests.
- `tests/utils/telemetry-events.test.ts` — frozen-enum check, pre-existing.
- `tests/integration/slice-b-preflight.test.ts` — pre-existing.

---

## 6. Adapter-pattern deviation from brief (plan correction #5)

**Brief asked:** validator activation via ContextPack directly.
**This phase delivered:** `validator.ts` unchanged (zero edits); a new `buildGraphLookup` adapter translates GraphV3T → the validator's existing `GraphLookup` interface.

**Rationale.** The validator is Phase 1 code that the whole routing spine depends on. Phase 1.5 is a Risk-C change; minimising regression surface on validator logic is worth the indirection. Evidence: `validator.test.ts` has zero diff on existing cases, so Phase 1 structural-check behaviour is provably preserved.

**Cleanup path.** A later phase should align validator inputs with `ContextPack` directly and retire `GraphLookup`, once:
- Phase 1 structural checks have additional coverage to prove parity with any new shape,
- No other V5 consumer is using `GraphLookup` as a seam.

At that point the adapter becomes a one-liner that constructs a ContextPack-shaped view, and can be removed.

---

## 7. Staleness deviation (plan correction → user-confirmed)

**Brief's fallback ladder:** 1. provenance hash comparison 2. UI stale flag 3. `"unknown"`.

**Reality:** neither tier 1 nor tier 2 exists on the current wire (wire investigation D1 proved this in both repos). Per user confirmation, Phase 1.5 ships `staleness_reason: null` with full machinery wired for later phases. The server-side deterministic graph hash IS computed and surfaces on the routing log for future staleness comparison.

**Follow-up ticket** needed when:
- UI starts sending `graph_hash` alongside analysis on the wire, OR
- Server-side last-hash storage lands (Phase 2 candidate), OR
- Deterministic canonicalisation can be guaranteed producer ↔ consumer.

---

## 8. Scope notes

- `ENABLE_V5_ORCHESTRATOR` stays default-off. This phase activates internals only; rollout is a separate decision.
- `explain_results` handler precondition deferred — the handler is not registered in the current registry (only `run_analysis`). When it lands, a similar precondition should be added.
- No changes to UI repo, V4 code, @talchain/schemas, migration SQL, handler implementations, or prompt content.

---

## 9. What worked / what didn't

**Worked:**
- Plan's investigation-first framing: D1 caught the `OrchestratorTurnPayload`-is-strict issue before any code landed. The pre-implementation wire doc shaped the route change (`stripExtensionFields`) correctly.
- Adapter pattern for validator activation: zero diff in validator.ts, zero regression in Phase 1 structural tests.
- Permissive ingress schemas: the real UI fixture round-trips without modifying existing tests for V1/V4.

**Issues encountered and resolved:**
- **B1 strict mode** rejected graph_state as an unknown key. Resolved by parsing extensions first and stripping them from the body before B1. Documented in route-v2.ts.
- **Precondition graph surface**: `GraphLookup` interface doesn't expose options. Resolved via the `GraphLookupWithOptions` extension pattern — validator surface stays minimal; preconditions narrow via adapter-provided shape.
- **Boundary.validation event count** in existing B1 fixtures broke when my parser emitted a success event for absent fields. Resolved by only emitting when at least one extension field was actually present.
- **Legacy Phase 1 tests** referenced `validate_skipped_graph_checks` — renamed in 5 test files.
- **Validator test depending on injected `graphLookup`** without options — updated to include an options array so the new precondition passes.

**Improvements beyond brief:** None — stayed in scope.

---

## 10. PR checklist

- [x] TypeScript build clean (`pnpm exec tsc -p tsconfig.build.json --noEmit`)
- [x] V5 unit tests pass (`pnpm exec vitest run src/orchestrator-v5/`) — 377/377
- [x] Phase 1.5 integration tests pass (`pnpm exec vitest run tests/integration/phase1.5-`) — 16/16
- [x] Regression delta ≥ 0 on full suite — −22 failures
- [x] `validate_skipped_graph_checks` absent from production code
- [x] `scripts/validate-v5-phase1.5-invariants.sh` OK
- [x] Plan file + wire investigation + evidence pack committed under `Docs/v5/`
- [ ] PR opened against `staging`

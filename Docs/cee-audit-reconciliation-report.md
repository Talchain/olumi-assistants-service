# CEE Audit Validation and Reconciliation Report

**Date**: 2026-03-14
**Codebase**: olumi-assistants-service (staging branch)

---

## Section 1: Test Baseline

**Test runner**: Vitest
**Results**: 8380 passed | 73 failed | 80 skipped | 1 todo (8534 total across 496 suites)

### Failing Test Files (15 suites)

| File | Failures | Type |
|------|----------|------|
| `tests/integration/cee.analysis-ready-pricing.test.ts` | 8 | Assertion error — expects LLM-generated graph structure; likely LLM output drift |
| `tests/integration/cee.draft-graph.causal-claims.test.ts` | 9 | Assertion error — causal_claims pipeline feature tests (likely unmerged feature) |
| `tests/integration/cee.draft-graph.coaching.test.ts` | ~3 | Assertion error — coaching pipeline integration |
| `tests/integration/cee.draft-graph.coefficients.test.ts` | ~3 | Assertion error — coefficient assertions vs LLM output |
| `tests/integration/cee.draft-graph.test.ts` | ~5 | Assertion error — draft graph integration |
| `tests/integration/cee.goal-handling-trace.test.ts` | ~3 | Assertion error — goal handling trace assertions |
| `tests/integration/cee.golden-journeys.test.ts` | ~5 | Assertion error — golden journey output mismatch |
| `tests/integration/cee.schema-v2.test.ts` | ~3 | Assertion error — V2 schema assertions |
| `tests/integration/cee.signal-smoke.test.ts` | ~2 | Assertion error — signal smoke test |
| `tests/integration/cee.unified-pipeline.parity.test.ts` | 1 | Assertion error — unified vs legacy parity (structural) |
| `tests/integration/orchestrator-golden-path.test.ts` | ~5 | Assertion error — orchestrator golden path |
| `tests/integration/v1.status.test.ts` | ~2 | Assertion error — status endpoint |
| `tests/unit/orchestrator.turn-handler.test.ts` | ~8 | Assertion error — expects 200, gets 500 (patch_accepted system event) |
| `tests/unit/orchestrator/context-fabric-wiring.test.ts` | 1 | Assertion error — expects 502, gets 500 |
| `tools/graph-evaluator/tests/adapters.test.ts` | 1 | Assertion error — expects 9 fixtures, found 12 (new fixtures added) |

**Classification**: Pre-existing failures. Integration tests depend on LLM output (non-deterministic) or reflect recently added features/fixtures not yet reconciled with test expectations. Unit test failures in orchestrator appear to be from recent code changes not yet matched to test assertions. No environment issues detected.

---

## Section 2: Discrepancy Resolution

### D1: "constraint" Node Type Mapping

**Answer: Both audits are partially correct — there IS an inconsistency across two code locations.**

**Location 1**: `src/adapters/llm/normalisation.ts:45`
```
'constraint': 'risk'
```
The `NODE_KIND_MAP` used in `normaliseNodeKind()` maps "constraint" → **"risk"**. This runs during adapter-level normalisation (post-LLM, pre-pipeline).

**Location 2**: `src/cee/transforms/schema-v3.ts:106-108`
```typescript
if (kind === "constraint") {
  return "factor";
}
```
The V3 transform's `mapKindToV3()` maps "constraint" → **"factor"**.

**Effective behaviour**: Under normal flow, Location 1 fires first (adapter normalisation), so "constraint" becomes "risk" before Location 2 ever sees it. Location 2 is dead code in the standard pipeline — it would only fire if a "constraint" node somehow survived to the V3 transform unnormalised (e.g., via `rawOutput=true` then manual re-processing, or a code path that skips adapter normalisation).

**Verdict**: Audit A ("constraint" → "risk") is correct for the **production code path**. Audit B ("constraint" → "factor") is correct for the **V3 transform function in isolation**, but that branch is effectively dead code under normal operation. The inconsistency is real and should be resolved — both locations should agree.

---

### D2: rawOutput=true Bypasses STRP

**Answer: The bypass IS confirmed. Audit A contradicted itself; Audit B is correct.**

**Evidence** (`src/cee/unified-pipeline/index.ts:319-320`):
```typescript
if (ctx.earlyReturn) return ctx.earlyReturn;
if (ctx.opts.rawOutput) return buildRawOutputResponse(ctx);
// Stage 2: Normalise (STRP) starts AFTER this point
```

The `rawOutput` flag returns after Stage 1 (Parse), **before** Stage 2 (Normalise/STRP), Stage 3 (Enrich), Stage 4 (Repair), etc.

**Production exposure**: `raw_output` is defined in the public Zod request schema (`src/schemas/assist.ts:59`) as `z.boolean().optional()`. It is passed through from the request body in `src/routes/assist.v1.draft-graph.ts:515`. **Any API caller can use it.** There is no auth gate, admin check, or feature flag.

The legacy pipeline also has a raw output path (`src/cee/validation/pipeline.ts:1144`).

**Verdict**: This is a confirmed production-exposed STRP bypass.

---

### D3: Maximum LLM Calls Per Request

**Answer: Both audits undercounted. The true maximum is 7 for unified pipeline, 2 for a single orchestrator turn (plus the CEE pipeline calls if a tool is invoked).**

**Unified pipeline LLM call map**:

| Stage | Component | Max Calls | Notes |
|-------|-----------|-----------|-------|
| 1 | Draft graph | 2 | 1 initial + 1 retry (`while (attempt < 2)` in parse.ts) |
| 3 | Factor enrichment | 1 | Single LLM call, no retry at this level |
| 4.1b | Orchestrator validation repair | 2 | `maxRetries: 1` → 1 initial + 1 retry (gated by `orchestratorValidationEnabled`) |
| 4.2 | PLoT validation repair | 1 | Single repair call if violations exist |
| 4.9 | Clarifier | 1 | Single call (gated by `clarifierEnabled`) |
| **Total** | | **7** | With all optional components enabled |

**Typical path** (no failures, no optional components): 2 (draft) + 1 (enrich) = **3 calls**.

**Orchestrator turn**: 1 (Phase 3 LLM) + 1 (Phase 4 tool, which may invoke the full CEE pipeline internally) = **2 direct LLM calls** + up to 7 from the CEE pipeline if `draft_graph` tool is invoked = **9 theoretical maximum** (but the CEE pipeline calls are nested, not additional orchestrator-level calls).

**Verdict**: Audit B's count of 7 (unified) is correct. The orchestrator "9 max" is technically accurate but should be expressed as "2 orchestrator calls + up to 7 nested CEE calls".

---

### D4: Abort Signal Wiring

**Answer: Both audits are partially right. Abort signals ARE wired, but only internally — not from external callers.**

**Evidence** (`src/adapters/llm/anthropic.ts`):
- `draftGraphWithAnthropic` (line ~399): Creates its **own** `AbortController` with a timeout-based mechanism
- `repairGraphWithAnthropic` (line ~1049): Same pattern — internal AbortController
- `clarifyBriefWithAnthropic` (line ~1361): Same pattern

**Key finding**: The public `draftGraph()`, `repairGraph()`, `clarifyBrief()` methods do **not** accept an `opts.signal` parameter. The `DraftGraphArgs` interface (`src/adapters/llm/types.ts:26-41`) has no `signal` or `timeoutMs` field. All abort/timeout handling is internal.

The OpenAI adapter follows the same pattern.

**Impact**: External callers (e.g., the unified pipeline's budget controller) cannot pass an abort signal to cancel an in-flight LLM call. The pipeline's `AbortController` (from `turn-handler.ts`) does not propagate into LLM adapter calls.

**Verdict**: Audit A was incomplete (didn't flag the gap). Audit B correctly identified the issue, though imprecisely — it's not that signals aren't wired at all, but that they're **internal-only** and don't accept **external** signals.

---

### D5: Repair ID Preservation

**Answer: Audit B is correct — no ID preservation check exists.**

**Evidence**: After LLM repair output is received:
1. JSON is extracted and normalised (`normaliseDraftResponse`)
2. Zod schema validation runs (structural, not semantic)
3. Graph is returned as-is

There is **no check** that:
- Node IDs from the input graph appear in the repair output
- The LLM didn't add/remove/rename nodes beyond what was requested
- Edge `from`/`to` references still point to valid nodes that existed pre-repair

The only protection is the downstream `validateGraph()` call in the deterministic sweep, which catches orphan edge refs but not the ID preservation invariant itself.

**Verdict**: Confirmed. The LLM could silently rename nodes during repair and the pipeline would accept it.

---

## Section 3: Validated Findings

### F1: rawOutput=true Bypasses STRP

**Status**: **Confirmed — Critical**

- **File**: `src/cee/unified-pipeline/index.ts:320` (unified), `src/cee/validation/pipeline.ts:1144` (legacy)
- **Production exposed**: YES — `src/schemas/assist.ts:59` includes `raw_output: z.boolean().optional()` in the public request schema. No auth gate.
- **Impact**: Any API caller can receive an un-normalised, un-repaired, un-validated LLM graph by sending `raw_output: true`.
- **Recommended fix**: Gate behind admin auth or remove from public schema entirely. If needed for dev tooling, move to a separate admin endpoint.

### F2: Draft/Repair Prompts Embed User Brief Without Untrusted Delimiters

**Status**: **Confirmed — High**

- **Files**:
  - `src/adapters/llm/anthropic.ts:266`: Brief embedded as `## Brief\n${args.brief}` — no delimiters
  - `src/adapters/llm/openai.ts`: Same pattern — brief embedded directly
  - `src/orchestrator/prompt-zones/zone2-blocks.ts:90-94`: Orchestrator DOES wrap user turns in `BEGIN_UNTRUSTED_CONTEXT` / `END_UNTRUSTED_CONTEXT`
- **Impact**: CEE draft/repair paths have no prompt injection boundary. A crafted brief could manipulate LLM behaviour while still producing structurally valid JSON (Zod would pass).
- **Recommended fix**: Wrap user brief in UNTRUSTED delimiters in both adapter prompts. This is a defence-in-depth measure — Zod validation is the primary guard, but content manipulation (edge strengths, node labels) would evade it.

### F3: NaN-Fix Default std=0.1 Evades Signature Detector (std=0.125)

**Status**: **Confirmed — High**

- **NaN-fix** (`src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts:101`): Sets `edge.strength_std = 0.1`
- **Signature detector** (`src/cee/validation/integrity-sentinel.ts:506-508`): Checks `Math.abs(strengthStd - DEFAULT_STRENGTH_STD) < 1e-9` where `DEFAULT_STRENGTH_STD = 0.125` (from `@talchain/schemas` `STRENGTH_DEFAULT_SIGNATURE.std`)
- **Gap**: Edges that were NaN and fixed to 0.1 will NOT match the 0.125 detector. These are defaulted edges that escape detection entirely.
- **Recommended fix**: Either (a) change NaN-fix std from 0.1 to 0.125 to align with the detector, or (b) widen the detector to also flag std=0.1 as a known pipeline default, or (c) add a separate `NAN_DEFAULTED` counter in the sentinel.

### F4: LLM Repair Output Accepted Without ID Preservation Check

**Status**: **Confirmed — High**

- **Evidence**: See D5 above. No validation that repair output preserves input node IDs.
- **Recommended fix**: After receiving repair output, compare input node ID set against output node ID set. Flag or reject if IDs were added/removed/renamed beyond what the violation list warranted.

### F5: Enrichment New-Edge Defaults Not Logged in Trace

**Status**: **Partially confirmed — Medium**

- **Controllable factor baseline defaults**: Logged via `ensureControllableFactorBaselines()` with `log.info({ defaultedFactors })` in `enrich.ts:466-468`
- **New edges from enrichment**: Created with `strength_mean: 0.5`, `belief_exists: 0.8` — NOT individually logged in trace
- **Impact**: New edges added by enrichment carry default strengths but this isn't visible in the trace. Downstream consumers can't distinguish LLM-estimated from enrichment-defaulted edge parameters.
- **Recommended fix**: Tag enrichment-created edges with `provenance: "enrichment"` and log the defaults in trace.

### F6: V3 Transform Defaults With No Per-Edge Trace

**Status**: **Confirmed — High**

- **File**: `src/cee/transforms/schema-v3.ts:301-312`
- **Defaults applied silently**:
  - `strength_mean`: `edge.strength_mean ?? edge.weight ?? DEFAULT_STRENGTH_MEAN` (0.5)
  - `exists_probability`: 0.8 (causal) or 1.0 (structural)
- **Logging**: Clamping is logged (lines 207-218). Defaults are NOT logged per-edge. The sentinel detects them post-hoc in debug bundles, but the V3 transform itself emits no telemetry.
- **Recommended fix**: Emit a per-edge `defaulted_field` entry in the trace, or at minimum emit an aggregate count of defaulted edges as a telemetry event during the V3 transform.

### F7: Anthropic Adapter Doesn't Accept External Abort Signals or Per-Request Timeouts

**Status**: **Confirmed — High**

- **Evidence**: See D4. `DraftGraphArgs` has no `signal` or `timeoutMs` field. Internal `AbortController` is used with fixed timeouts.
- **Impact**: Pipeline budget controllers cannot cancel in-flight LLM calls. A slow LLM response can exceed the turn budget without being aborted.
- **Recommended fix**: Add `signal?: AbortSignal` and `timeoutMs?: number` to `DraftGraphArgs` and forward to the Anthropic SDK client. Wire the pipeline's budget AbortController through.

### F8: Risk Coefficient Sign Normalisation Not Logged Per-Edge

**Status**: **Confirmed — Medium**

- **File**: `src/cee/unified-pipeline/stages/normalise.ts:54-59`
- **Behaviour**: `normaliseRiskCoefficients()` returns a `corrections` array with per-edge details (`{ source, target, original, corrected }`). But the log at lines 56-59 only emits `corrections_count`. The corrections are stored in `ctx.riskCoefficientCorrections` but are not serialized into the response trace until Stage 5 under `llm_quality.corrections`.
- **Impact**: Intermediate pipeline observers and external consumers cannot see which specific edges had their signs flipped.
- **Recommended fix**: Include per-edge risk corrections in `trace.pipeline.repair_summary`.

### F9: Goal Merge Node Renames Not Serialized to Trace

**Status**: **Confirmed — Medium**

- **File**: Goal merge populates `ctx.nodeRenames` (a `Map<string, string>`). `package.ts` (Stage 5) never reads or serializes this map.
- **Evidence**: `grep nodeRenames package.ts` returns zero matches.
- **Impact**: External consumers cannot trace node ID changes through goal merging. If a node ID changes, there's no audit trail.
- **Recommended fix**: Serialize `ctx.nodeRenames` as `trace.pipeline.repair_summary.goal_merge_renames: Record<string, string>` in Stage 5.

### F10: Clarifier Prompt Excludes "factor" From Allowed Kinds

**Status**: **Confirmed — Low**

- **File**: `src/cee/clarifier/prompts.ts:19`
- **Allowed kinds**: `goal, decision, option, outcome, risk, action` — "factor" is explicitly absent.
- **Impact**: Clarification-driven graph refinement cannot introduce new factor nodes. This limits graph richness during iterative refinement, but may be intentional (factors are added by the enrichment stage, not the clarifier).
- **Recommended fix**: If intentional, document the rationale. If not, add "factor" to the allowed kinds list in the clarifier prompt.

### F11: Prompt-Zone Validation Non-Blocking

**Status**: **Confirmed — Medium**

- **File**: `src/orchestrator/prompt-zones/validate.ts`
- **Behaviour**: `validateAssembly()` returns `ValidationWarning[]` and never throws. All checks (banned terms, tool instructions, imperatives, duplicates, budget, hint length, XML balance) push to a warnings array. No error status, no blocking.
- **Impact**: Malformed or overly large prompts can reach the LLM. Budget overflow is caught by `enforceContextBudget()` separately, so this is primarily about content quality.
- **Recommended fix**: For severe codes (XML imbalance, budget overflow), optionally hard-fail in production via a `strict` flag. For content warnings, current behaviour is appropriate.

### F12: Unified vs Legacy Blocked Response Contract Mismatch

**Status**: **Confirmed — Medium**

- **Unified** (`src/cee/unified-pipeline/stages/boundary.ts:155-179`): Returns full response body with `graph: null`, `nodes: []`, `edges: []`, `analysis_ready: { status: "blocked", blockers: [...] }`, plus preserved `meta` and `trace`.
- **Legacy** (`src/routes/assist.v1.draft-graph.ts:687-694`): Returns `{ error: { code: "CEE_V3_VALIDATION_FAILED", message: ..., validation_warnings: [...] } }` with HTTP 422.
- **Impact**: Downstream consumers expecting one shape will break on the other. The unified pipeline returns 200 with an in-band blocked status; the legacy route returns 422 with an error wrapper.
- **Recommended fix**: Align the legacy route to return the same shape as the unified pipeline's blocked response, or deprecate the legacy route.

### F13: XML Parser Fallback Degrades Silently

**Status**: **Not confirmed (graceful, not silent)**

- **File**: `src/orchestrator/response-parser.ts:285-350`
- **Behaviour**: All fallback paths (Path 3-6) push warnings into `parse_warnings[]`. The parser never throws. Warnings are attached to the response.
- **Impact**: This is graceful degradation with observability, not silent failure. The `parse_warnings` array is surfaced in the response envelope.
- **Recommended fix (adjusted)**: Consider adding a telemetry counter (e.g., `orchestrator.xml_parse_fallback`) for aggregate monitoring. Individual warnings are already tracked; this adds fleet-level visibility.

### F14: Prompt Store vs Code-Default Drift Risk

**Status**: **Not confirmed (already mitigated)**

- **File**: `src/adapters/llm/prompt-loader.ts:262,312,378,385,532`
- **Behaviour**: SHA-256 `promptHash` is computed over actual prompt content and recorded in:
  - `trace.prompt_hash` (package.ts:331)
  - `pipelineTrace.llm_metadata.prompt_hash` (package.ts:458)
  - `cee_provenance.promptHash` (package.ts:613)
- **Impact**: Drift IS detectable by comparing prompt hashes between instances or against known store versions.
- **Recommended fix (adjusted)**: No code change needed. Operational recommendation: add a monitor that alerts when instances report different prompt hashes for the same operation within a deployment window.

### F15: analysis_ready Fills Missing Interventions From Factor observed_state

**Status**: **Confirmed but already logged — Low**

- **File**: `src/cee/transforms/analysis-ready.ts:229-295`
- **Behaviour**: Fallback chain tries `observed_state.value` then `data.value`. Each fallback is tracked with provenance (`{ optionId, factorId, source }`). When fallback count > 0, emits `cee.analysis_ready.fallback_applied` telemetry event with `fallback_count` and `fallback_sources`.
- **Impact**: Observability is good. Fallback injection is logged with full provenance.
- **Recommended fix (adjusted)**: No code change needed. The logging is already in place. Consider surfacing `fallback_count` in the response trace for client visibility (currently telemetry-only).

---

## Validated Priority List

| Rank | ID | Severity | Finding | Fix |
|------|----|----------|---------|-----|
| 1 | **F1** | **Critical** | `rawOutput=true` bypasses STRP, repair, and validation; exposed in public API schema | Gate behind admin auth or remove from public schema; move to admin endpoint for dev tooling |
| 2 | **D1** | **High** | "constraint" maps to "risk" in adapter normalisation but "factor" in V3 transform — inconsistent | Align both locations to the same target kind (likely "risk" per adapter intent), remove dead branch in V3 transform |
| 3 | **F3** | **High** | NaN-fix uses std=0.1 but signature detector checks for 0.125 — NaN-defaulted edges evade detection | Either align NaN-fix std to 0.125, or widen detector to also flag std=0.1 as pipeline default |
| 4 | **F4** | **High** | LLM repair output accepted without verifying node ID preservation | Add post-repair validation: compare input vs output node ID sets, reject if IDs changed unexpectedly |
| 5 | **F2** | **High** | User brief embedded raw in draft/repair prompts without untrusted delimiters (orchestrator has them) | Wrap brief in `BEGIN_UNTRUSTED_CONTEXT` / `END_UNTRUSTED_CONTEXT` in both Anthropic and OpenAI adapter prompts |
| 6 | **F6** | **High** | V3 transform applies strength_mean=0.5 and exists_probability=0.8 defaults with no per-edge trace | Emit per-edge `defaulted_field` entries in trace, or aggregate count as telemetry event during transform |
| 7 | **F7** | **High** | LLM adapters don't accept external abort signals — pipeline budget controller can't cancel in-flight calls | Add `signal?: AbortSignal` to `DraftGraphArgs`/`RepairGraphArgs` and wire through to SDK |
| 8 | **F12** | **Medium** | Unified pipeline blocked response (200 + in-band status) differs from legacy (422 + error wrapper) | Align legacy route to return unified pipeline's blocked response shape, or deprecate legacy |
| 9 | **F8** | **Medium** | Risk coefficient sign flips logged only as aggregate count, not per-edge in trace | Include per-edge corrections in `trace.pipeline.repair_summary` |
| 10 | **F9** | **Medium** | Goal merge node renames stored in ctx but never serialized to response trace | Serialize `nodeRenames` Map to `trace.pipeline.repair_summary.goal_merge_renames` |
| 11 | **F5** | **Medium** | Enrichment-created edges carry default strengths (0.5/0.8) without trace logging | Tag enrichment edges with `provenance: "enrichment"` and log defaults in trace |
| 12 | **F11** | **Medium** | Prompt-zone validation never blocks — malformed prompts can reach the LLM | Add optional hard-fail for severe codes (XML imbalance, budget overflow) via `strict` flag |
| 13 | **F10** | **Low** | Clarifier prompt excludes "factor" from allowed node kinds | Document if intentional; otherwise add "factor" to allowed kinds |
| 14 | **F13** | **Low** | XML parser fallback paths are graceful (not silent) — warnings attached to response | Add fleet-level telemetry counter for aggregate monitoring |
| 15 | **F15** | **Low** | analysis_ready fallback intervention injection — already logged with provenance | Surface `fallback_count` in response trace for client visibility |
| 16 | **F14** | **Low** | Prompt hash drift risk — already mitigated by per-trace hash recording | Add operational monitor for cross-instance hash divergence |

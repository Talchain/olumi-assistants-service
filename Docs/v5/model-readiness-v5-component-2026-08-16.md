# Model Compiler / Readiness V5 component boundary — 16 August 2026

## Frozen objective

Integration base: `3254d6910bb14ac724e809ec70f0ceedb565c967`
(`origin/staging`, re-fetched 16 August 2026 before the freeze).

One canonical whole-model assessment must decide both the `analysis_ready`
wire status and Run admission. It must enumerate every structural and semantic
issue, preserve carrier precedence and the unique option bijection, block Run
for unreachable controllable factors, and never manufacture a relationship,
unit, bound, or missing scalar.

For an ordinary one-blocker state, the established targeted recovery remains
the product path. For two or more blockers, the assessment emits one complete
typed plan containing:

- every value-preserving carrier canonicalisation that can safely be applied;
- every remaining input that requires human judgement;
- no guessed values or relationships.

When safe changes exist, the typed readiness intake persists one standard
`apply_proposed_change` pending. Nothing in the graph changes before explicit
confirmation. Confirmation re-checks the pinned graph hash, regenerates and
matches the complete proposal, builds one canonical candidate, reassesses it,
and uses TurnExecutor's existing CAS-backed commit floor for one graph write
and readback. Stale, malformed, rejected, or no-progress proposals regenerate
against the current persisted graph with zero graph writes.

## Authorities and disposition

| Authority/path | Disposition | Reason |
|---|---|---|
| `assessCanonicalAnalysisReadiness` | **KEEP — canonical** | Exhaustive record consumed by wire and Run adapters. |
| `buildAnalysisReadyPayload` | **KEEP — semantic sub-producer** | Owns option/value semantics and unreachable controllable-factor detection. |
| `validateGraphStructure` | **KEEP — structural sub-producer** | Exhaustive cycle, reachability, decision, option-count and link checks. |
| carrier precedence and exact top-level option bijection in `analysis-ready-helper.ts` | **KEEP** | Prevents stale mirrors or duplicate ids from replacing real option arms. |
| `assessAnalysisReadiness` | **REPLACE as authority; KEEP as thin Run adapter** | It no longer re-runs its own structural/semantic policy. |
| `buildCanonicalAnalysisReadyFromGraph` | **REPLACE as authority; KEEP as thin wire adapter** | It returns the canonical assessment's wire projection only. |
| `computeStructuralReadiness` | **QUARANTINE, test compatibility only** | No production caller remains. Historical tests still exercise its narrow per-option projection; migrate then remove separately. |
| `analysisReadyGuardEnabled` config input | **QUARANTINE** | Compatibility input only; the live Run seam is unconditional. |
| first-blocker recovery | **KEEP for exactly one blocker; REPLACE for multi-blocker** | Multi states now preserve all issues instead of silently dropping items 2..n. |

## Transaction boundary

The readiness proposal reuses the existing pending-action lifecycle, proposal
copy matching, deterministic short-confirm routes, mutation-warrant backstop,
single `commitDirectAnswer` writer, graph CAS derivation, edit receipt fact,
applied-graph wire readback, and zombie-pending consumption. It does not add a
second persistence writer or a second patch applier.

## Scope exclusions

No Context/Memory, holistic Product Experience, prompts, LLM/model-selection
routing, scientific machinery, Analysis/Model tabs, Versions/Compare,
collaboration, or strategic-reasoning code is changed by this component.
TurnExecutor changes are limited to deterministic pending-action recognition,
regeneration and commit. The Claude-owned post-analysis Context/PX seam is
untouched.

## Decisive controls

- one-option and no-decision controls prove wire status and Run admission agree;
- missing-goal control proves a populated invalid model emits an honest blocked wire status rather than dropping the status;
- unreachable controllable-factor control proves one-blocker recovery stays targeted;
- an unencodable-option discriminator proves one underlying blocker is not double-counted into the multi flow;
- multi-blocker control proves all issues and unresolved human inputs are retained;
- multi-change control proves several safe carrier corrections land together in one reassessed candidate;
- pre-review immutability control proves proposal construction does not mutate the graph;
- dropped-input mutant proves incomplete proposals cannot apply;
- stale-pin and malformed-proposal route controls prove zero graph writes plus regeneration;
- valid confirm control proves one canonical graph commit, trusted-base identity + analysis CAS anchors, edit receipt, pending consumption and committed-graph readback;
- JSONB key-reordering control proves exact proposal matching is semantic, not object insertion-order dependent.

## Rollback

Before integration, record this component commit as `R`. Rollback is a single
revert of `R`; no schema migration, external state change, flag flip, prompt
change, or deployment-side data operation is required. Any pending already
stored with handler id `readiness_multi_repair_v1` becomes inert under the old
generic proposal validator and declines without a graph write.

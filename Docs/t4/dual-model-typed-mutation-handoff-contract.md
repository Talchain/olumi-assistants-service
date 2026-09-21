# T4.0 — Dual-model → typed-mutation hand-off contract (v1, pre-T4)

**Date:** 2026-07-02 · **Baseline:** `origin/staging` @ `2376914c8d` · **Status:** contract
defined; NOT integrated (T4 closed). Executable examples:
`tests/unit/t4-contract/candidate-mutation-envelope.test.ts` (isolated; imports nothing live).

Companion: [graph-management-branch-map.md](./graph-management-branch-map.md).

## 0. Scope and posture

This contract defines how ANY generation-side producer (today: the T3 dual-model M2
review/merge path; tomorrow: any LLM-proposed graph change) hands candidate graph changes
to the typed-mutation layer — **without reaching into persistence, executor routing, or
claim-safety surfaces**. It binds the T4.0 side only; T3 keeps its frozen
`EnrichmentInput/Outcome` contract unchanged. Everything here is fail-closed: an envelope
that cannot be proven safe is *held or rejected, never silently applied and never silently
dropped* (a suppression without telemetry is a defect — the #316-lane lesson).

Non-goals: no new persistence, no turn-executor changes, no routing changes, no undo store.

## 1. Candidate mutation envelope (`CandidateMutationEnvelope` v1)

One envelope = one reviewable unit of change. A producer emits a **batch** of ≤ 8 envelopes
(matches dual-draft `PROPOSAL_CAP`); the referee evaluates each independently and the batch
atomically only where stated (§4).

```
CandidateMutationEnvelope v1
├─ envelope_version: 1                      // literal; unknown version → reject (fail-closed)
├─ candidate_id: string (uuid)              // producer-minted; stable across retries; dedup key
├─ kind: CandidateKind                      // STABLE DISCRIMINATOR — closed enum, unknown → reject
├─ base_graph_hash: string                  // analysis-affecting hash (computeAnalysisAffectingGraphHash)
│                                           //   of the graph the producer generated AGAINST. Null FORBIDDEN.
├─ payload: <per-kind, .strict()>           // see kinds below; model-invented fields → reject
├─ provenance:
│   ├─ source: 'dual_model_m2' | 'edit_graph_llm' | 'flip_proposal' | 'user_direct'
│   ├─ evidence_pointer: string (min 1)     // what in the brief/analysis motivated this (dual-draft rule)
│   ├─ rationale?: string
│   └─ model_id?: string                    // resolved model that produced it (M2 gate parity)
└─ identity:
    ├─ scenario_id: string
    └─ turn_id: string                      // turn the candidate was generated in
```

### Kinds (v1 closed set)

| `kind` | payload (all `.strict()`) | apply posture v1 |
|---|---|---|
| `add_node` | node object (GraphV3 node shape; no id collisions) | referee-gated |
| `add_edge` | edge object (existing endpoint ids required) | referee-gated |
| `update_node_field` | `{node_id, field ∈ allowlist, from, to}` | referee-gated |
| `update_edge_field` | `{edge_id, field ∈ allowlist, from, to}` | referee-gated |
| `rename_node` | `{node_id, from_label, to_label}` | eligible for `would_apply` (label-only, analysis-hash-neutral — #300 invariant) |
| `add_option` | option node + linkage | **never auto-applies** — always `held` until the option apply path is wired (#300 invariant: `ADD_OPTION_APPLY_UNWIRED` / top-level `options[]` divergence) |
| `remove_node` / `remove_edge` | `{id, reason}` | v1: always `held` (destructive; needs user confirm flow) |
| `flag_uncertainty` / `clarification` | `{target_ref, question}` | never mutates; surfaces as coaching/pending question |

Field **allowlists** per kind exclude value-bearing pipeline-owned fields (dual-draft G10):
no candidate may set `sensitivity_score`, `elasticity`, e-values, robustness or any
analysis-derived number. Numeric payload fields pass the existing value/unit guards
(bare-ratio guard class).

Mapping from the T3 producer (no T3 change needed): dual-draft `ProposalEnvelope`
`{type, delta{node,edge,question}, evidence_pointer, rationale}` projects 1:1 —
`added_option→add_option`, `added_risk/added_assumption/added_evidence_gap→add_node`,
`added_causal_link→add_edge`, `uncertainty_flag→flag_uncertainty`,
`clarification_proposal→clarification`. The projection is a pure adapter owned by T4.0.

## 2. Validation / referee rules (ordered; first failure wins)

The referee is a **pure function** — `(envelopeBatch, currentGraph, frame) → verdicts` —
where `frame` supplies already-resolved authorities (freshness, canonical analysis state,
analysis-affecting graph hash). Binding rule inherited from the context-frame map: the
referee **never re-derives** freshness/canonical-state/hash; it consumes the frame.

R1. **Schema gate (fail-closed):** envelope parses against v1 `.strict()` schemas; unknown
    `envelope_version`, unknown `kind`, extra fields, malformed payload → `rejected`
    with `SCHEMA_INVALID` / `UNKNOWN_KIND`. Diagnostics are redacted `{path, code}` —
    never raw values (structured-outputs doctrine).
R2. **Stale gate:** `base_graph_hash` ≠ frame's current analysis-affecting hash →
    `stale` (#300 `base-hash-gate`). No partial credit: staleness beats every other verdict.
R3. **Referential integrity:** target ids exist (incl. `add_option` linkage — parent decision +
    every target factor — enforced in the core, `ENTITY_NOT_FOUND` on a dangling target); `add_*`
    ids do not collide (`OPTION_ID_COLLISION` for options / `ENTITY_ID_COLLISION` for nodes).
    **Graph-cap enforcement (dual-draft G11) is DEFERRED** — the isolated core (Track 3, PR #341)
    does NOT enforce node/edge caps yet and mints no `GRAPH_CAP_EXCEEDED`; caps land with a later
    candidate-cap slice. (See the Track 3 engineering report for the implemented-vs-deferred split.)
R4. **Field-safety:** payload touches only allowlisted fields (G10); engine-boundary claim
    scan on any free text (no EVPI / flip-point / quantified-probability prose — G14).
R5. **Candidate build:** apply to a CLONE via the live seam `applyAndValidateMutation()`;
    GraphV3 re-parse failure → `rejected` with `GRAPH_INVARIANT_VIOLATED`.
R6. **Readiness parity (EP2):** candidate must not downgrade structural readiness, and for
    batch-mode producers, option-surface must be invariant (dual-draft G12 i/ii) →
    else `held` with `READINESS_DOWNGRADE` / `OPTION_SURFACE_CHANGED`.
R7. **Kind posture:** apply-eligibility table (§1) — e.g. `add_option` → `held`
    (`ADD_OPTION_APPLY_UNWIRED`) even if R1–R6 pass.

## 3. Verdict semantics

```
verdict ∈ would_apply | held | stale | rejected | clarify_required
```

- **`would_apply`** — safe to apply *this turn* against the frame's graph. The referee does
  NOT apply; it returns the validated candidate + clone. Application remains the exclusive
  right of the existing handler path terminating in persistence (T4 wiring, not T4.0).
- **`held`** — valid but not auto-appliable (kind posture, readiness parity, divergence).
  MUST carry a `blocker` `{code, readable}` and MUST surface as a `PendingAction`-shaped
  artefact (existing two-turn confirm machinery), never vanish.
- **`stale`** — generated against an old graph. Never auto-retried against the new graph
  (the producer's evidence pointed at a world that no longer exists); surfaced via the
  existing stale-aware recovery copy.
- **`rejected`** — schema/integrity/safety failure. Producer-facing; user sees at most the
  existing clarification/repair copy, never raw diagnostics.
- **`clarify_required`** — well-formed but ambiguous target (#300 verdict); routes to the
  clarification flow with the question from the envelope.

Batch atomicity: verdicts are per-envelope; a batch is applied all-or-nothing ONLY when the
producer marks it atomic (dual-draft merge semantics); default is independent.

## 4. Undo / recovery expectations

- **No rollback store in v1** (none exists today; history is immutable via
  `append_turn_atomic`). Recovery is forward-only:
  - applied-mutation regret → user proposes a counter-edit (existing edit_graph flow);
  - `held` → PendingAction confirm/dismiss (existing consumption/invalidation matrix:
    dismiss, apply, supersede, hash-move, wall-TTL, turn-TTL);
  - `stale` → stale-aware explain recovery (existing).
- The envelope's `candidate_id` + `base_graph_hash` make every applied change *attributable*
  (which producer, against which graph), which is the precondition for a future undo slice.
- Idempotency: re-presenting an already-applied `candidate_id` MUST resolve to the existing
  `PROPOSAL_ALREADY_APPLIED` response, not a double mutation.

## 5. Evidence / logging requirements (no silent outcomes)

Every referee decision emits exactly one telemetry event
(`v5.candidate_mutation.<verdict>`), carrying: `kind`, `verdict`, `blocker_code?`,
`source`, `scenario_id`, `turn_id`, `base_hash_match: boolean`, latency. Requirements:

1. **No silent suppression** — `held`/`stale`/`rejected` all emit; a dropped envelope with
   no event is a defect class the harness must catch (A4/A8 analogue at mutation level).
2. Handler facts: an applied candidate produces the same fact shape the edit_graph path
   produces today (display-safety gates included), so golden-journey invariants (A3 graph
   change, A4 durability, A8 no-false-success) see it with zero harness changes.
3. Redaction: events and facts carry codes and hashes, never payload values.
4. Event names must pass `validate-event-names` CI before any live slice.

## 6. Tests required BEFORE live integration (gate for the T4 typed-mutation slice)

1. Envelope schema matrix: valid example per kind parses; unknown kind / unknown version /
   extra field / missing provenance FAIL (fail-closed proof). *(Seeded now as the isolated
   executable spec in `tests/unit/t4-contract/`.)*
2. Stale-gate matrix: hash match / mismatch / unreadable-graph → `would_apply`-eligible /
   `stale` / `rejected`, per kind.
3. Referee purity: same inputs → same verdicts; no I/O, no clock, no re-derivation
   (static guard that the referee module imports none of freshness/canonical-state/store).
4. Parity proofs: EP2 readiness non-downgrade + option-surface invariance ports of #300 /
   dual-draft tests, re-based on current staging.
5. Producer-projection test: dual-draft `ProposalEnvelope` fixtures (all 7 types) project
   losslessly into v1 envelopes (T3 fixture-only; no T3 code change).
6. Mutation-claim honesty: golden-journey RED fixture where a `held` verdict coexists with
   ack-shaped prose → A8 gating fail (extends the existing harness fixture set).
7. Idempotency + supersession: re-apply same `candidate_id`; newer candidate supersedes
   older against same target.

## 7. Minimum future T4 implementation slices (in T4 opening order)

1. **Canonical state:** land frame builder (#315 Increment 2a → wire read-only `_context_summary`).
2. **Context continuity:** frame threading through the executor call path (consumers read
   the frame, no re-derivation) — the referee's `frame` parameter becomes real.
3. **Freshness fail-closed:** unknown/unconfirmed freshness → mutation referee refuses
   `would_apply` (defaults to `held`).
4. **Typed mutation:** re-cut `graph-management/` module (envelope + referee per this
   contract) + adapter from dual-draft proposals; wire `would_apply` application into the
   existing dispatch seam (`edit-graph-dispatch` level), telemetry live.
5. **Orchestration proof:** golden-journey journey covering propose → hold → confirm →
   apply → rerun, with A3/A4/A8/A12 green and the §6 matrices in required CI.

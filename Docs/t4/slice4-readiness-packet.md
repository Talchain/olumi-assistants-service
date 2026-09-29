# Slice 4 readiness packet — typed-mutation referee integration (design only)

**Date:** 2026-07-03 (T4 acceleration overnight lane, Payload 5)
**Status:** READ-ONLY DESIGN PACKET. Nothing here is implemented. Sections marked
**PROPOSAL** are for Paul to accept, adjust, or reject — they are not doctrine and
must not be treated as adopted defaults by any future session until Paul says so.

Inputs: `Docs/t4/dual-model-typed-mutation-handoff-contract.md` (T4.0, R1–R6),
`Docs/t4/t4-spine-policy-v1.md` (freshness sections filled 2026-07-03; §3b/§6/§7/§8
PENDING), `Docs/t4/t4-open-decision-packet.md`, PR #300 branch
(`claude/v6-graph-mgmt-spine`, `src/orchestrator-v5/graph-management/`), staging
`f2998df02`.

## 1. #300 disposition — RECOMMENDATION

**Keep PR #300 OPEN as the spike reference; do not merge it; do not close it**
(closure is not authorised, and the branch is the only executable record of the
proposal-classification design: `ProposalKind`/`ProposalVerdict` types, base-hash
gate, candidate builders, readiness-parity assessment, held-reason codes).

Slice 4 should **re-implement from fresh staging using #300 as design reference**,
not rebase #300: the branch predates the frame (#315/#327), the filled freshness
policy, and the T4.0 contract's R1–R6 ordering — a rebase would carry stale
assumptions (own hash reads, no frame input) into a live lane. Mark #300 with a
"design reference for Slice 4 — do not merge" note at open time (Paul's call).

## 2. Namespace disposition — PROPOSAL

- **Runtime namespace:** `src/orchestrator-v5/graph-management/` (as in #300) for
  the referee + proposal types. It is orchestrator-scoped (the referee consumes
  the frame and the live validation seam), not `src/cee/` (T3 dual-model territory)
  — keeping the T3/T4 path-disjointness that held this whole lane.
- **The adapter that projects dual-draft `ProposalEnvelope` → referee
  `CandidateMutationEnvelope` lives with the CONSUMER:**
  `src/orchestrator-v5/graph-management/adapters/dual-draft.ts`. The T3 module
  (`src/cee/dual-draft/`) stays untouched; T4 imports its TYPES only. Mapping is
  1:1 per T4.0 §1 (e.g. `added_option → add_option`); keep it a hardcoded,
  exhaustively-switch-checked adapter (a registry is over-engineering for a closed
  v1 kind set — revisit only if a third producer appears).

## 3. The referee seam (from the T4.0 contract — restated, not invented)

Pure function: `(envelopeBatch, currentGraph, frame) → verdicts`, rules ordered
R1 schema (fail-closed) → R2 stale gate (base-hash vs frame's analysis-affecting
hash) → R3 referential integrity → R4 field-safety allowlist → R5 candidate build
via `applyAndValidateMutation()` on a CLONE → R6 readiness parity (EP2), with
`add_option` always `held` in v1 (`ADD_OPTION_APPLY_UNWIRED`). Verdicts:
`would_apply | held | stale | rejected | clarify_required`. The referee never
applies; application remains exclusive to the handler path.

### The four design questions, with PROPOSED answers

| # | Question | PROPOSAL |
|---|---|---|
| 1 | Is `frame` a required referee parameter, and what if absent? | **Required.** No frame → every envelope verdicts `held` with a new reason `FRAME_UNAVAILABLE` (fail-closed, matches the global rule "unknown authority → hold"). Never re-derive freshness inside the referee (the anti-rederivation pin on staging now enforces this mechanically). |
| 2 | Kind-mapping registry vs hardcoded adapter? | **Hardcoded exhaustive adapter** (see §2). A `never`-checked switch makes an unmapped kind a compile error. |
| 3 | Option-ID collision: referee or apply path? | **Both, different jobs.** Referee R3 checks collision against the frame's graph at verdict time (fast feedback); the apply path re-checks against the PERSISTED graph at commit time (authoritative — the graph may have moved between verdict and apply). Verdict-time pass never licenses apply-time skip. |
| 4 | Wiring order vs freshness fail-closed? | Follow T4.0 §7 order — referee wires in AFTER freshness fail-closed is live (it already is: #329 + filled §1/§2). Interim default is moot now, but if any freshness input reads `unknown` at verdict time, R2 verdicts `stale` (fail-closed), per filled §1. |

## 4. Policy gaps that GATE Slice 4 (exact missing decisions)

Slice 4 implementation CANNOT start until Paul supplies (or explicitly adopts
proposals for):

1. **§3b mutation-apply semantics** — when Olumi may say a change is safe to
   apply; confirmation requirements; auto-apply posture.
   **PROPOSAL for §3b (v1, conservative):**
   - `would_apply` verdicts NEVER auto-apply. They surface as a confirmation
     affordance (chip/pending action) naming the exact change; apply happens only
     on explicit user confirmation routed through the existing handler path.
   - Copy may say "this change is ready to apply" ONLY for a `would_apply`
     verdict on a frame whose freshness is `fresh`; any other state uses held
     wording ("I can hold this change; applying it needs …").
   - `held`/`stale`/`rejected`/`clarify_required` never produce "applied/updated"
     language (consistent with the shipped false-success guards).
   - Post-apply copy claims persistence only after the commit path returns
     (ties to the edit-graph fallback-copy packet item in
     `Docs/t4/coaching-copy-freshness-audit-packet.md`).
2. **§6 structural-versus-tunable doctrine** — which graph properties mutations
   may touch at all. **PROPOSAL for §6 (v1 floor, matching R4's allowlist
   posture):** tunable = node value/label-metadata fields and edge
   strength/exists-probability within schema bounds; structural = node/edge
   add/remove, kind changes, goal identity, option identity (add_option stays
   held per contract). Anything not explicitly tunable is structural; structural
   requires the confirm flow at minimum, and remove_* stays `held` in v1.
3. **§8 / Gate Zero** — `DEFAULT_CLAIM_PERMISSIONS` stays all-held; #305 R2
   taxonomy + Neil/Jinghui pathway remain the blockers recorded in the decision
   packet. Slice 4 does not need §8 UNLESS referee copy wants to make scientific
   claims about candidate effects — v1 copy should not, by construction.

§7 (EVPI/VOI naming) does not gate Slice 4; it stays untouched.

## 5. Likely files touched (forecast, for collision review)

- NEW: `src/orchestrator-v5/graph-management/` (referee, types, adapters,
  `__tests__/`) — re-implemented, #300-informed.
- `src/orchestrator-v5/turn-executor.ts` — wiring seam (FORBIDDEN until the
  supervised slice opens; this is the single biggest reason Slice 4 is not an
  overnight lane).
- Possibly `build-turn-context.ts` if pre-dispatch frame threading lands with it
  (see `Docs/t4/context-frame-consumer-migration-audit.md` — same seam, should be
  ONE review, not two).
- `tests/unit/orchestrator-v5/context/anti-rederivation-callsite-pin.test.ts` —
  deliberate pin updates if the referee legitimately consumes an authority
  (design says it must NOT — it consumes the frame).
- Docs: policy §3b/§6 fill-in; contract §6 test-gate checklist.

**Collision risks:** T3 dual-model lanes (`src/cee/dual-draft/`, dual-model
branches) — types-only imports keep disjointness; re-check #240/#247/#271 at
open per the decision packet; the parked F.6 assets are unrelated (see
disposition doc); PR #331/#332/#333/#334 (this lane) are all path-disjoint from
the forecast except the pin test (expected, deliberate).

## 6. Slice 4 test plan (what proof will look like)

- **Contract tests per R1–R6** (T4.0 §6 already enumerates the gate list):
  each rule proven with a fixture that fails ONLY that rule, in order — R-ladder
  fixtures so first-failure-wins ordering is pinned.
- **Red-then-green cases expected:**
  1. RED: envelope with unknown field → today no referee exists (nothing
     rejects); GREEN: R1 strict-parse rejects with schema reason.
  2. RED: stale `base_graph_hash` accepted by a naive apply; GREEN: R2 verdicts
     `stale`, never auto-retried.
  3. RED: `add_option` reaching an apply path; GREEN: always `held`
     (`ADD_OPTION_APPLY_UNWIRED`) even when R1–R6 pass.
  4. RED: readiness downgrade slips through (candidate removes goal reachability);
     GREEN: R6 parity check holds it.
  5. Negative control: `would_apply` on a fresh frame + user confirmation →
     applies exactly once through the handler path; a second identical envelope
     verdicts `stale` (hash moved).
- **Frame-absence fail-closed test** (question 1's `FRAME_UNAVAILABLE`).
- **Adapter exhaustiveness**: `never`-switch compile guard + one fixture per
  dual-draft kind.
- **No-silent-outcome evidence test** per contract §5 (every envelope produces
  exactly one logged verdict with reason).

## 7. Readiness verdict

Everything mechanical is ready (frame live, freshness fail-closed live, contract
delivered, spike reference exists, containment guard live). **The only true
blockers are §3b and §6 doctrine sign-off** (+ the standing supervised-lane rule
for `turn-executor.ts`). With those two sections filled — the proposals above are
one candidate filling — Slice 4 is a well-scoped supervised lane, not an
exploratory one.

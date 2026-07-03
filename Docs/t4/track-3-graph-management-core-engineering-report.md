# Track 3 — Graph Management Core: engineering report

**Date:** 2026-07-03 · **Branch:** `claude/track-3-graph-management-core` (2 commits) ·
**Base:** `origin/staging` @ `cc5dd47174d5fc203bd02254031409d5e64f35bd` · **Status:** isolated
core built, fixture-first, **nothing wired into any live path**. Draft PR only — no merge.

## What was built

An isolated typed-mutation **referee** at `src/orchestrator-v5/graph-management/` — the safe
substrate for AI-assisted model evolution. Pure function
`refereeMutation(rawEnvelope, currentGraph, frame) → RefereeVerdict` implementing the T4.0
ordered rules R1–R7 (first-failure-wins), with:

- **`CandidateMutationEnvelope v1`** — Zod `.strict()` discriminated union, 10 kinds
  (`types.ts`); R1 fail-closed parse with redacted `{path, code}` diagnostics (`parse-envelope.ts`).
- **Verdicts** `would_apply | held | stale | rejected | clarify_required` (the task's
  proposed/held/refused/applied map on: *proposed* = a submitted envelope; *refused* =
  `rejected`; *applied* = deferred wired path).
- **Frame-consuming R2 stale gate** (`frame-gate.ts`) — compares `envelope.base_graph_hash`
  to `frame.currentGraphHash`; **never re-derives** the hash (anti-rederivation pin; the key
  divergence from #300, which recomputed it).
- **Structural/tunable classifier** (`classify-mutation.ts`) — mechanical taxonomy; §6 PENDING
  → tunables stay held; `rename_node` is the only `would_apply` case.
- **R4 field-safety** (`field-safety.ts`) — tunable field allowlist + pipeline-owned-field
  denylist + engine-claim scan on narrative free text.
- **Candidate construction** (`candidate-graph.ts`) via the V5-owned seam
  `applyAndValidateMutation` **only**; **R6 EP2 non-downgrade** parity (`readiness-parity.ts`).
- **add_option** held-split (`OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE` / `ADD_OPTION_APPLY_UNWIRED`
  / `GRAPH_OPTIONS_MALFORMED` / `OPTION_ID_COLLISION`) — **never** un-held here.
- **Slice 4:** held → PendingAction projection (`pending-projection.ts`), idempotency
  (`PROPOSAL_ALREADY_APPLIED`), no-silent-outcome telemetry (`telemetry.ts`).
- **Slice 5:** dual-model → typed-mutation adapter (`adapters/dual-draft.ts`) — exhaustive
  7→kind mapping; local mirror of the producer shape (zero `src/cee/` coupling).

## Doctrine posture (Paul, 2026-07-03: fail-closed, no pending policy)

Policy source = T4.0 hand-off contract + `t4-spine-policy-v1.md`. §3b (mutation-apply) and §6
(structural-vs-tunable) are PENDING → **NOT adopted**: no broad `would_apply` for tunables;
hold by default where policy is ambiguous. The core encodes pending-policy areas as
held/fail-closed and improvises no policy. `rename_node` (hash-neutral) is the only apply-ready
case. No live persistence enforcement.

## Correctness rails (all held)

- Candidate graphs constructed **only** through `applyAndValidateMutation`.
- **Merge-parity fixtures pin the REAL `mergeMutatedGraphForPersistence` by identity**
  (`expect(merged.nodes).toBe(mutatedGraph.nodes)` + byte-for-byte options), not a spy.
- **Import boundary (Paul #1):** production imports only types, `applyAndValidateMutation`,
  EP2 `assessAnalysisReadiness`, GraphV3 types, frame-provided state. It imports **no**
  `mergeMutatedGraphForPersistence` (named-import ban), **no** hash-derivation function
  (`graph-hash.js` not allowlisted), **no** commit/turn-executor/persistence/pending-action.
  Enforced by an AST import-boundary guard.
- No V4 patch/apply revival. #300 is design reference only (re-cut fresh).
- **add_option is NOT un-held** — the 8 divergence fixtures prove the held rationale; un-holding
  is a separate node↔`options[]` consistency workstream, out of scope (Paul #3).
- No shared schema/config/generated/lockfile churn. No feature flag (nothing is wired).

## Authority-per-path (verified live — why add_option holds)

| Path | Reads options from | Evidence |
|------|--------------------|----------|
| Analysis (→PLoT) | node-derived | `run-analysis.ts:316-318`, `build-turn-context.ts:241-256` |
| Hash | BOTH (independently) | `context/graph-hash.ts:111-131` |
| Context (→LLM) | top-level `options[]` first | `context-pack-assembler.ts:479-481` |
| Persistence | option-nodes; `options[]` verbatim from base | `apply-graph-mutation.ts` merge |

Analysis is node-authoritative; context is `options[]`-authoritative → a new option node
diverges the two views → `add_option` held.

## CAS clarification (verified)

`selectCanonicalAnalysisState` composes freshness + structural readiness; feeds a **default-OFF**
`_context_summary`; does **NOT** gate the `analysis_ready` envelope (the response-finaliser does).
The referee therefore consumes frame-resolved authorities and touches neither the envelope nor
`_context_summary`.

## Deferred (clean stop = live persistence enforcement)

Live CAS enforcement at the persistence RPC · commit-path/turn-executor wiring (Track 2 +
supervised lane) · shared Supabase changes · live Track A integration · actual PendingAction
emission · the §3b/§6-gated un-holding of tunables/add_option.

## Test evidence

- **105 tests green** across 8 files (envelope matrix, R-ladder, add_option divergence ×8+stale,
  merge-parity identity pin, classifier, EP2 parity, pending/idempotency/telemetry, adapter,
  isolation guard, + 5 regressions for the review findings below). Run via main-repo vitest
  `--root <worktree>`, `LOG_LEVEL=fatal`.
- **tsc-clean:** 0 errors in `graph-management/` (total 544 = pre-existing test-file baseline,
  unchanged; zero existing files edited). Type-level compat assertions for `PendingActionAction`
  and `ProposalEnvelopeT` are enforced by tsc.
- **Isolation proof:** `git grep "orchestrator-v5/graph-management" -- src/ ':!.../graph-management/**'`
  returns 0 — nothing outside the module imports it.

## Adversarial review outcome (multi-agent, verified)

A 7-dimension adversarial review (each finding independently verified) ran against the core
BEFORE this report was finalised. **5 confirmed findings fixed** (commit `fix(t3): resolve
adversarial-review findings`):

1. **HIGH — stale-gate fail-open:** freshness `'stale'`/`'none'` fell through to `would_apply`
   (the gate keyed on the never-emitted `'unconfirmed'`). Now only `'fresh'`/`'none'` proceed;
   everything else fails closed to `stale`.
2. **Redaction leak:** `toBlocker` echoed the raw `node_id` into `blocker.readable` → fixed per-code
   messages, no raw values.
3. **Totality gap:** a throwing array-element read in `refereeMutationBatch` escaped → guarded.
4. **Isolation-guard gap:** the banned-named-import ban missed `export … from` re-exports → AST
   scan extended.
5. **Minor:** provenance sub-field reason-code mislabel → `SCHEMA_INVALID`.

**Refuted (no change):** two add_option predicate fail-opens masked by the GraphV3 parse; the
unreachable `clarify_required` branch (harmless defensive code for future representable kinds).

## Risk register

| Risk | Mitigation |
|------|------------|
| Pending §3b/§6 misread as "adopt proposals" | Everything holds fail-closed; no pending policy adopted; would_apply only for hash-neutral rename |
| Accidental live wiring | Isolation grep = 0; AST import-boundary guard test |
| Editing a Track 2 collision file | Zero edits; PendingAction consumed by local mirror + typecheck compat, not import |
| Re-deriving freshness/hash in the referee | Frame-consuming; `graph-hash.js` not allowlisted; guard test |
| Merge-parity spies instead of pinning identity | `toBe` reference-identity + byte-for-byte, real fn invoked |
| Un-holding add_option prematurely | Verdict hard-coded held; un-holding explicitly out of scope |
| add_node/add_edge/update_* payloads under-specified | Held anyway (§6 pending); R1 strict + R4 allowlist gate what's checked |
| Dual-draft adapter drift vs producer | Local mirror + typecheck compat with real `ProposalEnvelopeT`; unknown deltas gated by R1 |

## Codex review pack

**Files (production):** `types.ts`, `parse-envelope.ts`, `frame-gate.ts`, `classify-mutation.ts`,
`field-safety.ts`, `candidate-graph.ts`, `readiness-parity.ts`, `referee.ts`, `reason-codes.ts`,
`pending-projection.ts`, `telemetry.ts`, `adapters/dual-draft.ts`.

**Attack these invariants:**
1. **Totality** — can any input reach `refereeMutation` and throw, or return an unclassified
   verdict? (throwing Proxy, non-object, batch non-array, malformed envelope.)
2. **Fail-open stale gate** — can a diverged/unknown hash slip to `would_apply`? Check R2
   ordering vs freshness `unknown`/`unconfirmed`.
3. **add_option un-hold** — any path where add_option reaches `would_apply`?
4. **Import boundary** — does any production file import `mergeMutatedGraphForPersistence`,
   `graph-hash`, commit, turn-executor, pending-action, or `src/cee/`? (Guard should catch;
   verify the guard's allowlist is not over-broad.)
5. **Redaction** — do any blocker `readable`, telemetry event, or `inline_patch` leak a raw
   payload value?
6. **R6 non-downgrade** — is the ep2Rank ordering correct; can a downgrade be misread as
   would_apply?
7. **Merge-parity identity** — is the pin genuinely by-identity, not a spy?

## Track 2 dependency notes

- Track 3 consumes the `PendingAction` **type** by local mirror (`HeldMutationPendingAction`) +
  typecheck compat — it does **not** import or edit `session/pending-action.ts`,
  `compose/derive-pending-actions.ts`, `turn-executor.ts`, or `commit.ts`.
- The held→PendingAction **emission** and any new union variant are Track 2's / the integration
  slice's, gated on Track 2 landing. Track 3 does not re-derive pending-confirmation truth.
- **If the wiring slice needs to edit a Track 2 collision file → STOP and flag the collision.**

## Track 4 handoff — UI-visible mutation state

The UI-visible payload per verdict:
`{ verdict, mutation_class ('structural'|'tunable'|'non_mutating'), blocker { code, readable },
candidate_id, base_hash_match, candidate? }` — redacted (code+hash+enum only, never payload
values). Maps to the task's proposed/held/refused/applied lifecycle. `projectHeldToPendingAction`
gives the pending-confirmation shape for held verdicts.

## Track 6 handoff — safety / hygiene

- **No-silent-outcome:** `mutationTelemetryEvent` → exactly one redacted
  `v5.candidate_mutation.<verdict>` per verdict. Event names need `validate-event-names` CI
  clearance before any live emission (deferred).
- **Isolation-guard** (AST) + **inertness grep** = the off-path proof.
- **Totality / fail-closed:** every malformed/throwing/unknown input → a classified verdict.

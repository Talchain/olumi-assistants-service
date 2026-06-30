# V6 Context Management — Authoritative State Map

**Status:** implementation-ready map · **Baseline:** `origin/staging` @ `68547015` (verified against a clean
checked-out working tree, not only git plumbing) · **Date:** 2026-06-30

> **Scope.** This document is the **V6 Context Management authoritative state map only**. It does **not**
> replace or close the separate CEE Data Architecture full closure/regression audit for **P0a/P0b/P0c**, nor any
> separate data-architecture, security, database, credential, or environment issues. It maps the context
> machinery that already exists and defines a safe extraction path for a V6 `CanonicalContextFrame`. It is a
> map and a recommendation — not an authorisation to implement anything beyond Increment 1 (see §9).

> **Sanitisation (Track B discipline).** No secrets, no scenario UUIDs, no raw user/assistant text, no
> scenario-specific names. All example copy is excluded; only structural facts, file paths, export names and
> verified line anchors appear here.

---

## 0. Verification record

- **PR train (verified MERGED on `origin/staging`):** #310 Track B `23fd06a9` · #311 Cap-2A `01ff5135` ·
  #312 Cap-1 `68547015` (= staging tip). The train has landed → first-consumer migration is unblocked,
  subject to the science-certification split (§7) and the GO narrowing (§9).
- **Tree reconfirmation:** `origin/staging` was checked out into a clean feature branch; the working tree was
  confirmed to contain every referenced file, and every load-bearing anchor below was re-verified directly
  against the checked-out files. Anchors that drifted from the initial survey were corrected here:
  `projectRecentChanges` def = `recent-changes.ts:126`; `assembleContextPack` = `context-pack-assembler.ts:404`
  (`assembleContextPackWithSummary` `:462`; the `:497` cited elsewhere is the **`projectRecentChanges` call**);
  turn-executor coaching seam = `:1166`; Cap-1 advice-gate thread = `:3561–3566`.
- **Diagnostics-first anchor (load-bearing):** `src/orchestrator/route-v2.ts` imports `buildV5ContextSummary`
  at `:100`, calls it at `:524`, attaches `_context_summary` at `:541` (re-attached post-validation, gated by
  `contextSummaryEnabled`, default-OFF). **`_context_summary` is therefore already production-wired but
  product-inert** — confirmed against the checked-out file.

---

## 1. Existing authority map

Domains use the proposed V6 frame vocabulary. "Class": Authoritative (single source of truth) · Derived
(projection of an authority) · Diagnostic-only · Stale (legacy) · GAP (no authority yet).

| Frame domain | Authority (file) | Export(s) · anchor | Owns | Class | Consumers |
|---|---|---|---|---|---|
| **model / graph** | `orchestrator-v5/context/graph-hash.ts` | `computeAnalysisAffectingGraphHash()` | Hash of analysis-affecting graph fields (run vs current) | Authoritative | freshness, canonical-state, turn-executor, assembler |
| | `orchestrator-v5/context/compact-graph-for-contextpack.ts` | compaction | Compacted graph for the pack | Derived | assembler |
| | `orchestrator/tools/edit-graph.ts` | `handleEditGraph()` | Patch lifecycle (proposed→validate→reject/apply); `wasRejected`/`appliedGraph`/`operations[]` | Authoritative | edit-graph dispatch, route-v2 |
| **analysis (M1–M5)** | `orchestrator-v5/context/canonical-analysis-state.ts` | `CanonicalAnalysisState` (`:232`), `selectCanonicalAnalysisState()` (`:345`) | Single composed analysis verdict: status, freshness(+reason), provenance hashes, blockers, contradictions, named predicates `usableForProse/Chips/FollowupContext`, `requiresRerun`, `blockedUnusable` | **Authoritative** | turn-executor (pre/post-dispatch, finalise), route-v2, assembler, coaching-state, advice-gate (via mirror) |
| | same file | `canonicalStateFromFreshness()` (`:424`) | PARTIAL verdict (freshness+readiness only, **no degraded detection**) — the `route_fallback` source | Derived (thinner) | turn-executor (`:1166`, `:3563`), route-v2 fallback, coaching-prompt |
| | same file | `summariseCanonicalAnalysisState()` (`:589`) → `AnalysisStateSummary` | Redacted leak-safe projection (counts/predicates) | Diagnostic projection | build-context-summary, assembler, telemetry |
| | `orchestrator-v5/context/analysis-fallback.ts` | `buildAnalysisFromPriorFacts()` | Thin analysis projection from prior `run_analysis` fact (reuses `compactAnalysis`) | Derived (thin) | turn-executor follow-up |
| **freshness** | `orchestrator-v5/context/freshness.ts` | `deriveAnalysisFreshness()` (`:407`), `selectRunAnalysisFact()` (`:300`), `selectDegradedRunAnalysisFact()` (`:246`) | THE freshness verdict (`fresh/stale/unknown/none`+reason), graph-hash-aware, option-identity guard; fact selectors | **Authoritative** | re-invoked ~8 sites: build-turn-context, turn-executor (`:1016`,`:5057`), chip-click-dispatch ×2, edit-graph-dispatch, chip-generator, canonical-state |
| **changes** | `orchestrator-v5/context/recent-changes.ts` | `projectRecentChanges()` (`:126`) | SINGLE recent-change authority (3-cap, 80-char, no IDs, product-domain actions) | **Authoritative** | assembler call (`context-pack-assembler.ts:497`), state-query-guard, route-with-tool-use, short-confirm |
| **conversation** | `orchestrator-v5/build-turn-context.ts` | `buildTurnContext()` → `EnrichedTurnContext` | Per-turn load: prior_turns, prior_facts, decision_context(S1), coaching_state(S2A), persistedGraph, brief; graceful-degrades on SessionStore failure | **Authoritative** | turn-executor, route-v2 |
| | `orchestrator-v5/context/context-pack-assembler.ts` | `assembleContextPack()` (`:404`), `assembleContextPackWithSummary()` (`:462`) | ONE LLM-facing pack/turn (raw + display-safe + analysis_state + recent_changes) | **Authoritative** | turn-executor, route-with-tool-use, (V4) unified-pipeline Stage 5 (separate, intentional) |
| **intent** | `orchestrator-v5/routing/route-with-tool-use.ts` | `routeWithToolUse()`, `buildUserMessage()` | Primary turn classifier (Sonnet+tool); prompt-render seam (strips raw, injects display-safe) | **Authoritative** | turn-executor |
| | `orchestrator-v5/routing/state-query-guard.ts` | `evaluateStateQueryGuard()` | Deterministic pre-route "what changed?" gate | Authoritative (gate) | turn-executor |
| | `orchestrator/deterministic/pipeline-v4.ts` | `computeIntentGates()` | V4 intent gates | **Stale (V4-only)** | pipeline-v4 |
| **evidence / provenance** | `orchestrator-v5/context/canonical-analysis-state.ts` | `pickLatestRawRobustness()`, `pickLatestDecisionReview()` | Raw robustness/decision-review signals from the selected fact (preserve pre-canonicalisation) | Authoritative (selective) | advice-gate (opt-in), finaliser diag |
| | `adapters/llm/shared-schemas.ts` | `provenance`, `provenance_source` (edge-level) | Edge belief/weight attestation (`document/metric/hypothesis`) | Authoritative (metadata) | ingestion, normalise, prompt context |
| | `cee/decision-review/science-claims.ts` | `buildScienceClaimsSection()` | DSK `<SCIENCE_CLAIMS>` injector (enable-by-presence) | Authoritative (feature-gate) | decision-review prompt |
| **claim_permissions** | `orchestrator-v5/compose/forbidden-user-facing-phrases.ts` | `FORBIDDEN_USER_FACING_PHRASES`, `findForbiddenPhraseHit()`, `sanitiseUserFacingText()` | SINGLE forbidden-prose list (denial/staleness/jargon/prescriptive/impl) | **Authoritative** | egress guards ×3 (turn-executor, edit-graph-dispatch, chip-click-dispatch) + sweep tests + replay |
| | *(none yet)* | — | A **policy table** of per-class claim permissions (default-held) does **not exist**; held-science is excluded by construction + honesty guards | **GAP** | future frame |
| **actions** | `orchestrator/deterministic/confirmation-flow.ts` | `buildProposal()`, `handlePendingConfirmation()` | StoredProposal two-turn confirm flow (TTL 15m) | Authoritative | turn-executor confirm dispatch |
| | `orchestrator/deterministic/mutation-health.ts` | `assessMutationHealth()` | Advisory post-mutation structural checks (mutation still applies) | Derived (advisory) | turn-executor post-mutation |
| | `orchestrator/add-risk-rejection-guidance.ts` (#311) | `classifyAddRiskToOptionRejection()` (`:90`) | Cap-2A reachability-class rejection classifier (structural-only) | Authoritative (narrow) | patch-rejection-helper |
| | `orchestrator/patch-rejection-helper.ts` (#311) | `buildPatchRejectionEnvelope()` (`:63`) | Rejection envelope (generic, or Cap-2A `structural_guidance`) | Authoritative | edit-graph rejection path |
| | `orchestrator/graph-structure-validator.ts` | `validateGraphStructure()` | Structural verdict (violation codes) | Authoritative | mutation-health, edit-graph, Cap-2A gate |
| | `orchestrator/deterministic/action-failure.ts` | `handleActionFailure()` | Per-action recovery (chips) | Derived | action dispatcher |
| **ui_targets** | *(none discrete)* | — | No dedicated authority — affordances emitted per-handler; recovery chips in action-failure / advice-gate `suggestedActionsForClass` | **GAP / per-handler** | handlers |
| **diagnostics** | `orchestrator-v5/context/build-context-summary.ts` | `buildV5ContextSummary()` (`:168`), `V5ContextSummary`, `CanonicalStateSource` (`:66`) | Redacted `_context_summary` (counts/predicates/hashes); `canonical_state_source` provenance; M5/M6 fields nullable | **Diagnostic-only** (guard-tested never-product) | route seam (`route-v2.ts:524`, `sendFinalised200`), Track B |
| | `diagnostics/feature-health.ts` | `checkFeatureHealth()` | Flag-dependency health | Diagnostic-only | startup |
| | `orchestrator/debug-fields.ts` | re-attach gate | `_context_summary`/`_diagnostic_trace` re-attach post-egress | Authoritative (gate) | route-v2 |
| **proof (Track B)** | `tools/golden-journey-harness/` | `invariants.ts` (A1–A11, A8b), `observation.ts`, `journey.ts`, `report.ts`, `index.ts` | Lived-journey observability over the wire | Diagnostic/proof | CI gate, staging replay |

**One-line truths**
- The closest thing to a context *builder* today is `buildTurnContext()` → `EnrichedTurnContext` (internal);
  the LLM-facing pack is `assembleContextPack()`. The frame composes the **outputs** of both.
- Freshness, canonical-state and recent-changes already have **single** authorities — the V6 work is to
  compose their **outputs** into one typed frame built once, not to invent new derivations.
- The legacy `src/context/context-pack.ts` (resolver/caller/types) feeds only the fall-through routing prompt
  and is **low-leverage** (`Docs/v5/V5_CURRENT_STATE.md`); it is **not** the V5 authority — do not seed the
  frame from it.

---

## 2. Duplicate-context map

| Duplicate / seam | Where | Verdict |
|---|---|---|
| **Freshness re-derived ~8×/turn** | every `deriveAnalysisFreshness` call site | **Wrap existing authority** — frame carries the single derivation's output; do NOT add a 9th call |
| **Two canonical funnels** | `selectCanonicalAnalysisState` (full) vs `canonicalStateFromFreshness` (partial `route_fallback`) | **Wrap** — frame exposes one state + an explicit `source`; keep both producers, never silently merge (fail-loud is intentional) |
| **Thin analysis projection** | `analysis-fallback.ts`; pre-Cap-1 advice-gate returning blank `data_unavailable_for_class` despite fresh usable state | **Dangerous drift** — Cap-1 already closes the advice-gate case; the frame's analysis projection should make the blank-despite-fresh path unreachable for migrated consumers |
| **`analysis_state_source` vs `canonical_state_source`** | turn-executor telemetry tag (`request`/`fallback`/`absent`) vs `_context_summary` provenance (`turn_executor`/`route_fallback`) | **Harmless-but-confusing** — distinct concepts (projection origin vs verdict completeness); frame names them distinctly, never unifies |
| **Narrow mirror types** | advice-gate `AdviceGateCanonicalState` (`:145`)/`AdviceGateRecentChange` (`:158`) mirror real types to avoid orchestrator-internal imports | **GOOD pattern → formalise** as the frame's published read-only projection interfaces |
| **Forbidden-phrase enforcement ×3 dispatch paths** | turn-executor / edit-graph-dispatch / chip-click-dispatch | **Harmless** — all import the one list; no rule multiplication; frame need not touch it |
| **Two graph hashes/turn** | `computeAnalysisAffectingGraphHash` (freshness) + deterministic hash (telemetry) | **Harmless** (intentional) — frame reuses the analysis-affecting hash |

---

## 3. Future `CanonicalContextFrame` source mapping (domain → authority → gap → first route)

| Domain | Existing authority | Gap | First extraction route |
|---|---|---|---|
| model | `graph-hash.ts`, compact-graph, edit-graph lifecycle | none structural | frame.model = graph counts + analysis-affecting hash + committed-graph ref |
| analysis | `selectCanonicalAnalysisState()` → `CanonicalAnalysisState` | none — it IS the authority | frame.analysis = the canonical state output (+ `source`) |
| freshness | `deriveAnalysisFreshness()` | re-invoked at many sites | frame.freshness = the single derivation's output, passed in |
| changes | `projectRecentChanges()` | none | frame.changes = the assembled `contextPack.recent_changes` (already once/turn) |
| conversation | `buildTurnContext()`/`EnrichedTurnContext` | internal-only shape | frame.conversation = prior_turns/pending/recent_turn_count |
| intent | `routeWithToolUse` + `state-query-guard` (no enum) | classification lives in response shape, not a typed value | frame.intent = thin typed record of the **deterministic pre-route** verdict (post-route LLM intent stays out, per F.6) |
| evidence | `pickLatestRawRobustness/DecisionReview`, edge `provenance` | scattered | frame.evidence = provenance/robustness refs + freshness — **annotation only (F.6)** |
| claim_permissions | `FORBIDDEN_USER_FACING_PHRASES` + by-construction exclusion | **no policy table** | frame.claim_permissions = a NEW **default-held** policy table (structural; surfaces nothing) |
| actions | confirmation-flow, mutation-health, Cap-2A, action-failure | no single affordance projection | frame.actions = committed/proposed/rejected/pending projection (scaffold; no held-science) |
| ui_targets | per-handler chips | no authority | defer — scaffold only when a real consumer needs it |
| diagnostics | `build-context-summary.ts` | M5/M6 fields nullable (not threaded) | frame → `_context_summary`; fill `recent_turn_count`/`recent_change_count`/`capabilities_present` honestly |

**Load-bearing invariants:** wrap not replace · CEE-only first · policy-table claim permissions default-held ·
**F.6** (frame may annotate provenance/freshness/permission but must **not** derive corrected science or
reinterpret producer-owned fields) · consumer migration opt-in/incremental · prompt text is output not source ·
diagnostics intentional + sanitised.

### 3.1 Frame-builder source-of-truth rule (resolves wrap-vs-rederive — REQUIRED)

The builder is a **pure composition over already-resolved artefacts**. It MUST prefer authoritative artefacts
already present in the current turn's call path and MUST NOT introduce a second freshness, canonical-analysis-
state, graph-hash or recent-change derivation when those values already exist at the seam.

**Canonical signature:**

```
buildFrame({ freshness, canonicalState, recentChanges, graphHash, /* + conversation, intent, actions… */ })
```

The builder takes **outputs**, never raw inputs (`prior_facts`, the graph) that would *tempt* re-derivation.
Per-artefact availability at the turn-executor seam, verified on `origin/staging`:

| Artefact | Available at the turn-executor seam? | How it is passed (no re-derivation) | If absent — where resolved + parity proof |
|---|---|---|---|
| `freshness` | **Yes** — `deriveAnalysisFreshness` already produces `routingFreshness`/`freshness` in scope (`turn-executor.ts:1016`, `:5057`; used in the Cap-1 spread at `:3561`) | pass the existing `FreshnessDerivation`; type the frame field as that return type | n/a |
| `canonicalState` (+ `source`) | **Yes** — `selectCanonicalAnalysisState` (full) runs pre/post-dispatch; `canonicalStateFromFreshness` (partial) at `:1166`/`:3563` | pass the existing verdict and **carry its `turn_executor` vs `route_fallback` source**; never re-pick | n/a |
| `recentChanges` | **Yes** — `contextPack.recent_changes`, assembled once (`context-pack-assembler.ts:497` → `projectRecentChanges` `recent-changes.ts:126`); read at `turn-executor.ts:3566` | project once upstream into `FrameChanges` (via `ProjectRecentChangesToFrame`) and pass that; the builder receives the **already-projected** form, so it structurally cannot re-call `projectRecentChanges` | n/a |
| `graphHash` | **Yes** — `computeAnalysisAffectingGraphHash` computed at the seam for freshness; also `current_graph_hash` on `CanonicalAnalysisState` | pass the already-computed hash | n/a |
| `conversation.recent_turn_count` (M5) | **Yes** — `EnrichedTurnContext.prior_turns` from `buildTurnContext` | pass `prior_turns.length` / `recent_changes.length` | n/a |
| `capabilities_present` (M6) | **No** — no capabilities source threaded today | **Resolve at the post-dispatch seam** from the dispatch outcome; **parity proof:** assert the projected value equals the dispatch's own capability signal, and until that source exists emit honest `null` (not `false`) — never fabricate |
| `intent` | **Partial** — deterministic pre-route verdict (`evaluateStateQueryGuard`) is available; post-route LLM intent is not | pass only the deterministic verdict; **the LLM intent is intentionally out of scope (F.6)** | n/a |
| `actions` (committed/proposed/rejected/pending) | **Yes at respective seams** — committed graph ref post-persist; proposed/pending from `confirmation-flow`; rejected from `patch-rejection-helper` | project at the post-dispatch seam (Increment 6 scaffold) | parity: each projected field === the originating authority's value |
| `claim_permissions` | **n/a (static)** — a constant default-held table, not a turn derivation | constant lookup; no parity concern | n/a |

**Structural prevention (enforce, don't trust):** (1) frame fields are **bound to** the authorities —
freshness as `FreshnessDerivation`, analysis via `Pick<CanonicalAnalysisState, …>` (no hand-restated
predicates), and recent-changes as the **already-projected `FrameChanges`** (not raw `RecentMutation[]`);
(2) `buildFrame` takes assembled artefacts as parameters, so it *cannot* re-derive what it never receives —
and because `recentChanges` arrives pre-projected, "project once per turn" is **structural**, not comment-only
(there is no `RecentMutation[]` in scope for the builder to re-project); (3) a parity guard test mirroring the
existing "no second freshness truth" test (`build-turn-context.test.ts`) asserts `frame.freshness ===` the live
`deriveAnalysisFreshness` verdict and that the single upstream `RecentMutation` → `FrameChanges` projection
equals the authority's output.

---

## 4. Relationship to the landed capabilities

| Capability | Domain it proves/consumes | Source / consumer / both | Becomes a frame consumer by… | Do NOT refactor yet | Proof that protects it |
|---|---|---|---|---|---|
| **#312 Cap-1 post-analysis loop** | analysis + freshness + readiness + changes (consumes `canonicalStateFromFreshness` + `recent_changes`) | **Both** — first product-consumer pattern AND proof the narrow projection works | swap its threaded `canonicalState`/`recentChanges` inputs (`turn-executor.ts:3561–3566`) for `frame.analysis`/`frame.changes`; flag still gates; `copy_source:'canonical_rich'` (`post-analysis-advice-gate.ts:1190`) unchanged | the advice-gate composer; the mirror types `AdviceGate*`; the always-on `enforceStructuralSuccessClaimGuard` | golden + honesty + integration tests; Track B A8/A9/A10 |
| **#311 Cap-2A rejection guidance** | actions (rejected mutation) + structural grounding (model) | **Source material** for `frame.actions` (rejection shape) — not an early consumer | later: read `frame.actions.rejection`; keep `classifyAddRiskToOptionRejection` (`:90`) as the authority | the conservative classifier + envelope (byte-identical flag-off) | classifier + render tests; Track B **A8b** (`invariants.ts:663`) |
| **#310 Track B harness** | diagnostics/observability across freshness/analysis/rejection/changes | **Both** — proof layer AND the consumer that validates the frame's diagnostic projection | sourcing `_context_summary` from the frame flips **A9** (`a9ContextSurfaced` `:708`: graph/analysis_state/blockers/capabilities/recent_turn_state) from named-blind-spot to validated | the invariants — extend, don't rewrite | self-tests + RED defects fixture |

**Track B invariant set (verified `invariants.ts`):** A1 coherence · A2 context-completeness(in-proc)+A2LiveStub ·
A3 durable-state-changed · A4 no-false-success · A5 coaching-grounded · A6 debug-explains · A7 recovery-visible ·
**A8** non-committing-no-false-success (`:551`) · **A8b** source-rejection-grounded / Cap-2A (`:663`) ·
**A9** context-surfaced-on-wire / the frame-diagnostic hook (`:708`) · **A10** latency + wrongful-LLM-escalation /
Cap-1 hook (`:798`) · **A11** premortem-safe (`:866`).

---

## 5. First consumer recommendation — diagnostic projection first, then Cap-1

**Default hypothesis (Cap-1 first) confirmed for the product path, with a refinement:** make the
**`_context_summary` diagnostic projection the first** frame consumer, then **Cap-1** the first *product-path*
consumer.

The diagnostic surface is the lowest-risk possible first consumer because it is **already production-wired but
product-inert**: `buildV5ContextSummary` is imported and called at `route-v2.ts:100`/`:524`, attached at `:541`
(post-validation, gated by `contextSummaryEnabled`, default-OFF), and the static guard test
`tests/contract/context-summary-diagnostic-only.guard.test.ts` forbids the `_context_summary` wire key from
reaching any prose/chip/coaching path. Sourcing it from the frame is a genuine migration of a flag-gated,
never-product surface — and it fills the nullable M5/M6 fields (`recent_turn_count`, `recent_change_count`,
`capabilities_present`) that currently emit `null`, flipping Track B **A9** to validated. Only after the frame
is proven end-to-end through that inert surface do we touch the product path (Cap-1).

**Cap-1 migration (second consumer) spec:**
- **Files touched:** `src/orchestrator-v5/turn-executor.ts` (the coaching seam `:1166` and the advice-gate
  spread `:3561–3566`); `src/orchestrator-v5/routing/post-analysis-advice-gate.ts` consumes `frame.analysis`/
  `frame.changes` via its existing `AdviceGate*` mirror shapes — ideally **no signature change**.
- **Inputs replaced:** `canonicalStateFromFreshness(freshness,{readiness})` → `frame.analysis` projection;
  `contextPack.recent_changes` → `frame.changes`. Both computed by the frame from the same authorities.
- **Must stay byte-identical:** the flag guard `postAnalysisLoopEnabled && freshness !== null` (`:3561`) stays
  in the turn-executor (do **not** move the flag check into the frame); `copy_source:'canonical_rich'`; Tier-1
  safe-now content; flag-OFF dead branch; `routing_path`/`loop_enabled` telemetry (`:3633`); the fail-closed
  `classifyStructuralClaim` re-check.
- **Tests that must stay green:** `tests/unit/ai-harness/post-analysis-loop.golden.test.ts`,
  `post-analysis-loop.honesty.test.ts`, `__tests__/turn-executor-post-analysis-loop.integration.test.ts`,
  advice-gate unit suites, Track B A8/A9/A10.
- **Risk:** Low-medium (touches the hot `turn-executor.ts`). **Stop conditions:** any golden/honesty diff; any
  `canonical_rich` content change; `recent_change_count` telemetry divergence; flag-OFF not byte-identical; new
  tsc errors.

---

## 6. Build plan (coherent reviewed increments — not micro-slices, not one trunk)

Each increment is **separately reviewable** and requires its own brief, review and approval (§9). No consumer
migration (3/4) begins unless the train is merged — it is.

| # | Increment | Purpose | Files (likely) | Deps | Tests | Merge/deploy | Must NOT change |
|---|---|---|---|---|---|---|---|
| 1 | **Typed CEE-local frame** | Define `CanonicalContextFrame` + per-domain read-only projection interfaces (formalise the `AdviceGate*` pattern) | new `src/orchestrator-v5/context/frame/` types | none | type-only unit + tsc | small PR → staging | no runtime wiring; no schema |
| 2 | **Frame builder over authorities** | `buildFrame({freshness,canonicalState,recentChanges,graphHash,…})` composing existing **outputs** once/turn (§3.1) | new `frame/build-frame.ts`; one call site in `turn-executor.ts` | 1 | builder parity unit (frame value === current threaded value); `projectRecentChanges` once/turn | flag-gated dark build, default-OFF | no consumer reads it; no behaviour change |
| 3 | **Diagnostic projection (Track B) — FIRST consumer** | source the already-wired `buildV5ContextSummary` (`route-v2.ts:524`) from the frame; fill nullable M5/M6; flip **A9** | `build-context-summary.ts`, `route-v2.ts` (`:524`) | 2 | A9 + `context-summary-diagnostic-only.guard` (see §6.1) | existing `contextSummaryEnabled`, default-OFF | never product logic; redaction intact; not net-new wiring |
| 4 | **First product consumer: Cap-1** | migrate post-analysis loop onto `frame.analysis`/`frame.changes` (§5) | `turn-executor.ts`, `post-analysis-advice-gate.ts` | 2 | §5 list | behind existing `postAnalysisLoopEnabled` | `canonical_rich` output; flag-OFF byte-identical |
| 5 | **Claim-permission policy table (default-HELD)** | structural per-class permission map; everything uncertified = held | new `frame/claim-permissions.ts` | 1 | table unit + "all held by default" test | dark, no surface | surfaces NOTHING; no copy |
| 6 | **Action-affordance projection** | `frame.actions` (committed/proposed/rejected/pending) scaffold | `frame/` + Cap-2A read | 1,5 | projection parity unit | dark scaffold | no held-science; no UI |

**Critical sequencing rule:** Increments 2 (builder call site) and 4 (Cap-1 consumer edit) both land in
`turn-executor.ts` — they MUST be **separate PRs** so the frame-equivalence proof is reviewable in isolation
from the builder wiring. Increment 3 sits between them so the frame is observed on the inert surface before any
product path is touched. Do not collapse into one PR.

### 6.1 Increment 3 acceptance criterion (REQUIRED)

Increment 3 is acceptable **only if** existing redaction is preserved and the static guard
(`tests/contract/context-summary-diagnostic-only.guard.test.ts`) continues to prove that `_context_summary`
**cannot reach prose, chips, coaching, UI product logic, or any user-facing response path**. **A9 may flip to
validated only if the diagnostic surface remains diagnostic-only** — sourcing it from the frame must not create
any new read path out of `_context_summary` into product logic. If the guard cannot be kept green, Increment 3
does not ship.

---

## 7. Science-certification boundary

**GO now (structural, no held science):** typed frame extraction · freshness projection · analysis-state
projection · recent-change projection · provenance/evidence **annotation** · diagnostic projection ·
action-affordance **scaffold** (no held-science surface).

**Default-HELD (wait on certification — #305 R2 + Neil/Jinghui where applicable):** sensitivity · fragility ·
influence/driver prose · flip · robustness · EVPI/VOI · uncertified `m1_coaching` · ungrounded causal mechanism.

**GO is not permission to surface held science.** The claim-permission table (Increment 5) is the structural
home for the held/allowed boundary and **defaults every uncertified class to held**; any held→allowed flip
happens only via the relevant certification pathway.

---

## 8. Risks & blockers

- **High-collision files (churn last ~80 commits on staging):**

  | Rank | File | Churn | Size | Why hot |
  |---|---|---|---|---|
  | 1 — severe | `orchestrator-v5/turn-executor.ts` | ~13 | ~6.8k LOC | frame-builder call (incr 2) **and** Cap-1 migration (incr 4) → **separate PRs** |
  | 2 — high | `context/context-pack-assembler.ts` | ~6 | ~850 | sole `projectRecentChanges` prod caller (`:497`) |
  | 3 — high | `build-turn-context.ts` | ~5 | ~1.2k | incr 2 composes its output |
  | 4 — mod | `context/canonical-analysis-state.ts` | ~4 | ~680 | frame wraps it; claim-table (incr 5) lands near |
  | 5 — mod | `routing/post-analysis-advice-gate.ts` | ~2 | ~2k | incr 4 feeds its mirror types |
  | low (read-only) | `context/freshness.ts`, `context/recent-changes.ts` | 1–2 | — | authorities — frame READS, never edits |

  Mitigate: minimal single insertion points; flag-gated dark builds; small sequential PRs; freshness/recent-changes stay read-only.
- **Schema-boundary risk:** the frame is CEE-local only — it must NOT touch `@talchain/schemas` / the wire
  contract / `_context_summary` redaction. No schema drift.
- **Second-source-of-truth risk (the central hazard):** addressed structurally by §3.1 — the builder wraps the
  authorities' outputs and cannot re-derive what it is not given; a parity guard test enforces it. Preserve the
  `turn_executor` vs `route_fallback` provenance tag; never re-pick the verdict.
- **V5 assumptions not to carry forward:** the legacy `src/context/context-pack.ts` (routing-prompt-only) is
  not the frame seed; the `route_fallback` partial state must keep its explicit `source` (don't paper over it).
- **Certification dependency:** any held→allowed change is blocked on #305 R2 + Neil/Jinghui sign-off.
- **Don't refactor Cap-1/Cap-2A immediately post-merge:** migrate Cap-1 *behind its flag with byte-identical
  output*; leave Cap-2A as source material until `frame.actions` is proven.
- **Unclear/queued authorities:** `ui_targets` and `intent` (typed) have no single authority today — the frame
  *introduces* a thin typed projection for them; treat as new scaffolding, not extraction, and keep them inert
  until a real consumer exists.

---

## 9. Final recommendation — GO for Increment 1 only

**GO** — ready to brief implementation of **Increment 1 (typed CEE-local frame extraction) only**:
- pure types / projection interfaces;
- zero runtime wiring;
- no behaviour change;
- no schema change.

**Increments 2–6 are recommended next increments, NOT pre-authorised implementation.** Each requires its own
brief, review and approval before any code lands. In particular, the frame builder (2), the diagnostic
migration (3, subject to §6.1), and the Cap-1 product migration (4) are sequenced and gated as above.

**Science split (binding on the GO):**
- GO covers only structural / freshness / change / provenance extraction;
- the claim-permission table (Increment 5) ships **default-HELD**;
- all certified-held classes (sensitivity / fragility / driver prose / flip / robustness / EVPI / uncertified
  `m1_coaching` / causal mechanism) **wait** on #305 R2 + Neil/Jinghui.

**First implementation brief:** Increment 1 — typed `CanonicalContextFrame` + read-only per-domain projection
interfaces, with the `buildFrame({ freshness, canonicalState, recentChanges, graphHash, … })` signature (§3.1)
defined as the contract, and zero runtime wiring.

---

## Appendix — verified anchors (origin/staging @ 68547015)

| Symbol | File:line |
|---|---|
| `buildV5ContextSummary` (import / call / attach) | `orchestrator/route-v2.ts:100` / `:524` / `:541` |
| `CanonicalAnalysisState` / `selectCanonicalAnalysisState` / `canonicalStateFromFreshness` / `summariseCanonicalAnalysisState` | `orchestrator-v5/context/canonical-analysis-state.ts:232` / `:345` / `:424` / `:589` |
| `deriveAnalysisFreshness` / `selectRunAnalysisFact` / `selectDegradedRunAnalysisFact` | `orchestrator-v5/context/freshness.ts:407` / `:300` / `:246` |
| `projectRecentChanges` (def / prod call) | `orchestrator-v5/context/recent-changes.ts:126` / `context-pack-assembler.ts:497` |
| `assembleContextPack` / `assembleContextPackWithSummary` | `orchestrator-v5/context/context-pack-assembler.ts:404` / `:462` |
| `buildV5ContextSummary` / `CanonicalStateSource` | `orchestrator-v5/context/build-context-summary.ts:168` / `:66` |
| Cap-1 thread (coaching / advice-gate spread / canonicalState / recentChanges / telemetry) | `orchestrator-v5/turn-executor.ts:1166` / `:3561` / `:3563` / `:3566` / `:3633` |
| freshness derivations (routing / late) | `orchestrator-v5/turn-executor.ts:1016` / `:5057` |
| `AdviceGateCanonicalState` / `AdviceGateRecentChange` / `canonical_rich` type / `tryComposeRichSafeNowFallback` / `copy_source:'canonical_rich'` | `orchestrator-v5/routing/post-analysis-advice-gate.ts:145` / `:158` / `:282` / `:1143` / `:1190` |
| Track B A8 / A8b / A9 / A10 / A11 | `tools/golden-journey-harness/invariants.ts:551` / `:663` / `:708` / `:798` / `:866` |
| Cap-2A `classifyAddRiskToOptionRejection` / `buildPatchRejectionEnvelope` | `orchestrator/add-risk-rejection-guidance.ts:90` / `patch-rejection-helper.ts:63` |
| Diagnostic-only guard test | `tests/contract/context-summary-diagnostic-only.guard.test.ts` |

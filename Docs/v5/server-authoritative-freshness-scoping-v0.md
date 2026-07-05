# Server-authoritative freshness — scoping v0 (backlog item A)

**Date:** 2026-07-05 · **Status:** scoping only — no implementation in this lane; each phase
below requires separate authorisation · **Origin:** tracked backlog item A from the Layer-1
contract-drift analysis (`contract-drift-and-revendor-plan-v0.md` §5, memo v0.4).

**One-line problem:** the UI computes its own freshness hashes with different semantics from
CEE's, so the same edit can read *stale* in one part of the screen and *fresh* in another.
**One-line finding that reshapes the scope:** CEE already ships an authoritative freshness
verdict on the wire and the UI already consumes it with wire-wins precedence — the remaining
work is migrating the UI surfaces that still key off UI-local hashes, then retiring those
hashes.

---

## 1. Current state — complete inventory

### 1.1 The two hash regimes

| | CEE `computeAnalysisAffectingGraphHash` | UI `generateGraphHash` |
|---|---|---|
| File | `src/orchestrator-v5/context/graph-hash.ts:115` | DGAI `src/canvas/store/runHistory.ts:48` |
| Projection | **Whitelist**: only fields that alter analysis output | **Includes node types, labels, positions, edge confidence — plus the run seed** |
| Labels | **Excluded** | **Included** |
| Positions | Excluded | **Included** |
| Purpose | Freshness verdicts (`deriveAnalysisFreshness`) | Run-history matching, snapshots, patch-proposal staleness, inspector stale-guard |

The UI also has `generateStructuralHash` (DGAI `src/canvas/utils/graphHash.ts:43`,
counts/IDs only) and CEE has `computeDeterministicGraphHash` (topology, routing logs) and
`graphIdentityHash` (Group A, full-fidelity identity; not wire-visible) — four hash regimes
total, three of which never cross the wire.

**The contradiction, concretely:** a label-only (or position-only) edit after an analysis →
UI-local hashes diverge → inspector `useStaleGuard` shows "Results may have changed since
your last edit" and patch-accept shows "This was proposed before your last edit" — while
CEE's analysis hash is unchanged → the wire verdict on the same turn is `fresh`, and the
results-panel `HeroQualifier` (which trusts the wire) says nothing. Two contradictory
freshness verdicts coexist on one screen.

### 1.2 What CEE already ships (server authority exists today)

- Single derivation authority `deriveAnalysisFreshness()`
  (`src/orchestrator-v5/context/freshness.ts:407`; enum `fresh|stale|unknown|none` at `:52`,
  stable reason codes at `:59–75`), called at exactly three sites: routing
  (`turn-executor.ts:1088`), post-dispatch (`turn-executor.ts:5193`), coaching
  (`build-turn-context.ts:398`).
- Wire emission at the single egress chokepoint: `response-finaliser.ts:219` →
  `attachComputedAt()` (`compose/analysis-ready-emit.ts:41–68`) stamps onto
  `analysis_ready`: **`freshness`, `freshness_reason`, `graph_hash_at_run`,
  `current_graph_hash`, `computed_at`** (schema `src/schemas/analysis-ready.ts:256–298`,
  `.passthrough()`, all optional → version-skew-safe: older consumers ignore, nothing of
  theirs is dropped).
- `unconfirmed` is an internal execution mode (`no-op-helpers.ts:97–199`,
  `run-comparison-gate.ts`), not a wire freshness value — no change proposed here.
- Flags: core derivation is unflagged (always runs); `CEE_OPTION_IDENTITY_FRESHNESS_GUARD`
  default ON tightens verdicts; coaching flags default OFF.

### 1.3 What the UI already consumes (precedence is already wire-wins)

- `extractPhase3FromV5Response.ts:378–389` parses `analysis_freshness`/`freshness`,
  `freshness_reason`, `has_run_analysis_fact`; stored at `store.ts:217–220`.
- Master derivation `deriveAnalysisFreshnessState()`
  (`src/lib/analysisFreshnessState.ts:115–201`): **wire freshness > local
  `graphEditedSinceLastRun` fallback > neutral**; drives results panel
  (`HeroQualifier.tsx:63–132`, stale wins all), pre-analysis panel, chat composer.
- **Not yet parsed:** the server's `graph_hash_at_run` / `current_graph_hash` echoes
  (`types/scenario.ts:73` defines a slot; nothing reads the wire field).

### 1.4 UI surfaces still keyed to UI-local hashes (the actual migration surface)

| # | Surface | Key mechanism | User-visible effect |
|---|---|---|---|
| S1 | Inspector stale-guard | `useStaleGuard` (`inspector-v2/useStaleGuard.ts:10–25`): `results.graphHash !== _internal.graphHash` (both `generateGraphHash`) | `StaleGuardBanner` "Results may have changed since your last edit" + re-run + 0.75-opacity children |
| S2 | Patch-proposal staleness | `graph_hash_at_proposal` stamped at `useConversation.ts:2148`; compared on Accept (`GraphPatchBlockRenderer.tsx:273`) | Banner "This was proposed before your last edit — still want to apply it?" (Apply anyway / Dismiss) |
| S3 | Session stale flag | `analysisStale` (`useScenario.ts:63–65, 140, 551`) — graph changed after complete | Gates re-run affordances |
| S4 | Edit-confirmation staleness | `useEditConfirmation.isStaleAfterEdit` | Disables factor-edit callbacks post-analysis |
| S5 | Run-history matching / snapshots | `generateGraphHash` at `ReactFlowGraph.tsx:1479, :1558`, `store.ts:2606`, `analysisSnapshotFactory.ts:258`, `useV2Run.ts:712`, `useConversation.ts:1456, :2076` | Silent historical-result restore; snapshot linkage |
| S6 | Local freshness fallback | `graphEditedSinceLastRun` in `deriveAnalysisFreshnessState` | Fills gaps when wire verdict absent |

S1–S5 never consult the server verdict; S6 already defers to it.

---

## 2. Target design — CEE is the only verdict source

1. **Verdict:** `deriveAnalysisFreshness` remains the sole authority;
   `analysis_ready.freshness/freshness_reason` is the only *verdict* any surface renders.
2. **Hash echo instead of local hashing:** the UI stops computing freshness hashes and
   instead stores the **server-issued** `graph_hash_at_run` / `current_graph_hash` echoes
   for run-matching (S5) and stale-guard keys (S1/S3/S4). The UI never needs to *compute*
   an analysis-affecting hash — only to *compare server-issued strings*.
3. **Between-turn honesty (the real gap):** server verdicts are per-turn; edits between
   turns need a local dirty signal. Keep exactly one: a boolean "edited since last
   turn/run" (S3/S6 collapse into it) that can only *downgrade* toward "possibly stale —
   re-run to confirm"; it never contradicts a same-turn server verdict and never claims
   freshness.
4. **Proposal staleness is a different key:** S2 should key off a **server-stamped** hash
   at proposal time. The correct long-term key is Group A's `graphIdentityHash` (label
   changes SHOULD nudge a proposal-apply; the Apply/Reject contract §3 already specifies
   captured-identity-hash staleness + the A3 conflict vocabulary). Migrating S2 therefore
   converges with the Apply/Reject lane rather than with analysis freshness.
5. **Retirement:** `generateGraphHash` (and its seed coupling) is deleted once S1–S5 are
   re-keyed; `generateStructuralHash` stays (it is not a freshness signal).

## 3. Phased migration path (each phase dark/flag-gated, separately authorised)

- **Phase 0 — exists:** wire fields shipped (CEE), wire-wins precedence (UI), divergence
  canary pinned in the compatibility test plan. Nothing to build.
- **Phase 1 — UI parses the hash echoes:** extract `graph_hash_at_run` /
  `current_graph_hash` in `extractPhase3FromV5Response` and store them alongside the
  verdict. Additive, no behaviour change. *(UI-only; no contract change — fields already on
  the wire.)*
- **Phase 2 — re-key S1/S3/S4/S5 behind a UI flag:** stale-guard and run-matching compare
  server echoes; `generateGraphHash` still computed in parallel, with a divergence counter
  (telemetry) instead of UX authority. Rollback = flag off.
- **Phase 3 — soak:** run Phase 2 dark → on for internal use; acceptance = divergence
  telemetry shows the local hash adds no signal beyond label/position noise (expected), and
  no missed-staleness incidents (server verdict caught every real case).
- **Phase 4 — retire:** delete `generateGraphHash`, seed coupling, and the S1–S5 local
  comparisons; the canary flips from "pin the divergence" to "assert the local hash is
  gone". S2 migrates separately onto identity-hash proposal staleness with the
  Apply/Reject (Layer 3) work.
- **Wire interaction:** Phases 1–4 need **no** schema change (passthrough fields exist).
  Typing the fields first-class in `@talchain/schemas` belongs to the 0.14.x promotion wave
  (post Group-A/A3 freeze, per Decision 2) — desirable, not blocking.

## 4. Contract implications

- Fields already ride `analysis_ready` via `.passthrough()`: `freshness` (enum),
  `freshness_reason` (string code), `graph_hash_at_run` / `current_graph_hash` (16-hex),
  `computed_at` (ISO). 0.14.x should type them verbatim; no renames (renames would break
  the already-shipping consumer path).
- Version skew: older UI on 0.8.1 ignores the fields entirely (its local machinery still
  works until Phase 4); a Phase-4 UI on a future schema requires CEE ≥ today's staging —
  already true. The silent-drop hazard is avoided precisely because the verdict rides an
  existing passthrough payload rather than a new block type.

## 5. Test plan

- **Canary evolution:** keep the §5.3 divergence canary (label-edit → UI-stale/CEE-fresh)
  pinned through Phase 3; flip to absence-assertion at Phase 4.
- **Per-hop fixtures:** wire fixture with `freshness='stale'` + hash echoes must parse and
  surface at each consumer (extractPhase3 → store → `deriveAnalysisFreshnessState` →
  HeroQualifier/StaleGuard) — extend the existing `freshness-state-matrix.test.tsx` and
  `PatchStaleness.test.tsx` suites rather than forking.
- **Precedence pins:** wire verdict beats local dirty-flag; local dirty-flag can only
  downgrade; absent wire verdict → neutral + dirty-flag fallback (S6 semantics preserved).
- **Soak acceptance (Phase 3 → 4 gate):** N sessions with zero cases where the retired
  local hash flagged real staleness the server missed; divergence counter composed only of
  label/position edits.

## 6. Out of scope / open product question

- No code in this lane. Each phase separately authorised; Phases 2–4 are UI-repo work,
  Phase 1 UI-only parsing, 0.14.x typing rides the promotion wave.
- `unconfirmed` execution mode, coaching freshness threading, option-identity guard:
  untouched.
- **Product question for Paul (with recommendation):** *should a label-only edit make
  analysis results read stale?* Recommendation: **No** for analysis freshness — labels do
  not change computation; the analysis-affecting whitelist is the correct semantics, and
  the current UI behaviour (stale on label edit) is the bug, not the feature. **But** for
  *proposal application* (S2), label changes legitimately warrant a nudge — that surface
  should move to identity-hash staleness (Apply/Reject contract), not lose the signal.

---

## One-page decision input

| | |
|---|---|
| **Recommendation** | Adopt the phased plan above: Phase 1 (parse hash echoes, additive) whenever UI capacity allows; Phases 2–4 as one flagged UI lane with a telemetry soak; S2 (patch staleness) migrates with Apply/Reject onto `graphIdentityHash`, not in this lane. Type the wire fields at 0.14.x. |
| **Rationale** | Server authority already exists and is already trusted where wired (results panel); the divergence lives in five enumerated local surfaces (S1–S5). Migrating comparisons to server-issued strings removes an entire class of cross-service semantic drift (labels/positions/seed) without new wire surface. |
| **Implementation consequence** | UI-repo lane (flag + re-key + telemetry + deletion), one CEE no-op (fields already shipped), one schemas addition at 0.14.x. Canary stays until Phase 4. |
| **Risk if wrong** | If the local hash was silently catching real staleness the server misses (e.g. surfaces fed by non-analysis state), Phase 3's soak exposes it before anything is deleted — that is the purpose of running Phase 2 dark with divergence telemetry rather than cutting over. |
| **Unblocks** | Coherent freshness UX (one verdict per screen); removes the seed-coupled hash that complicates replay; gives Apply/Reject a clean identity-hash staleness story; retires backlog item A. |

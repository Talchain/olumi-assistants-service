# V6 Context Management — Increment 2: `CanonicalContextFrame` builder

**Status:** implementation-ready · inert skeleton shipped on this branch (for review) · **Baseline:** `origin/staging` @ `5dc1ed2b` (contains Increment 1) · **Branch:** `claude/v6-frame-builder-increment-2` · **Date:** 2026-07-01

> **Scope.** Increment 2 only — the pure `buildFrame` projection over the Increment-1 authorities. It is **INERT** (no call sites, no runtime wiring, no flag), **default dark/off** by construction, and **claim-permissions default HELD**. It does **not** touch `turn-executor.ts`, prompt/UI/schema/migration/producer-science, and surfaces no held science. Consumer migration (Increment 3 diagnostic projection, then Cap-1) is a separate, separately-reviewed increment.

---

## 1. Purpose

Increment 1 shipped the typed `CanonicalContextFrame` + `BuildFrameInput`/`BuildFrame` type contract (types only). Increment 2 supplies the **implementation of that contract**: a single pure function that composes the frame from already-resolved authority **outputs**, once per turn, wrapping — never re-deriving — freshness / canonical-analysis-state / recent-changes / graph-hash.

```ts
buildFrame(input: BuildFrameInput): CanonicalContextFrame   // src/orchestrator-v5/context/frame/build-frame.ts
```

**Load-bearing invariants:** WRAP-not-re-derive · pure/side-effect-free (no I/O, no throw, deterministic) · INERT (zero callers) · F.6 annotation-only · claim-permissions default HELD.

---

## 2. Field-by-field mapping (verified against the authorities on `5dc1ed2b`)

| Frame field | Source expression | Kind |
|---|---|---|
| `version` | `CANONICAL_CONTEXT_FRAME_VERSION` | constant |
| `model.graphHash` | `input.freshness.current_graph_hash` (single-sourced from the freshness authority) | pass-through |
| `model.graphHashAtRun` | `input.freshness.graph_hash_at_run` | pass-through |
| `model.counts` | `input.graphCounts ?? null` | pass-through |
| `analysis.{status,usableForProse,usableForChips,usableForFollowupContext,requiresRerun,blockedUnusable}` | `input.canonicalState.*` | pass-through (Pick-bound) |
| `analysis.source` | `input.canonicalStateSource` | pass-through |
| `freshness.verdict` / `.reason` / `.computedAt` | `input.freshness.freshness` / `.reason` / `.computed_at` | pass-through |
| `changes` | `input.recentChanges` (already the projected `FrameChanges`) | pass-through (by ref) |
| `conversation.priorTurnCount` | `input.priorTurnCount ?? 0` | pass-through + honest default |
| `conversation.recentChangeCount` | `input.recentChanges.length` | **DERIVE-PURE** (single source) |
| `conversation.pendingConfirmation` | `input.pendingConfirmation ?? false` | **EXTEND-INPUT** (see §3) |
| `intent.deterministicMatch` / `.preRouteClass` | `input.intent?.deterministicMatch ?? false` / `input.intent?.preRouteClass ?? null` | honest default |
| `evidence` | `{}` (optional booleans omitted) | honest default |
| `claimPermissions` | `input.claimPermissions ?? DEFAULT_CLAIM_PERMISSIONS` | default-HELD |
| `actions` / `uiTargets` | `{}` / `{}` | inert scaffold |
| `diagnostics.analysisStateSummary` | `summariseCanonicalAnalysisState(input.canonicalState)` | **DERIVE-PURE** (pure redacted projection of a held input) |
| `diagnostics.canonicalStateSource` | `input.canonicalStateSource` | pass-through |

**No re-derivation:** the builder calls none of `deriveAnalysisFreshness` / `selectCanonicalAnalysisState` / `projectRecentChanges` / `computeAnalysisAffectingGraphHash`. `summariseCanonicalAnalysisState` is a pure counts/redaction projection of the `canonicalState` we already hold — not a second derivation. `recentChangeCount` derives from the held `recentChanges` array (`.length`), never a separate count.

---

## 3. Design decisions (resolved tension points)

1. **`pendingConfirmation` — the one required `BuildFrameInput` extension.** `conversation.pendingConfirmation` is a required boolean with **no** existing input and **no** pure derivation from the four analysis authorities (it is a confirmation-flow fact owned upstream — `confirmation-flow.ts` / `most_recent_pending_actions`). Hard-coding `false` would be a silent lie whenever a confirmation is pending. **Resolution:** add `readonly pendingConfirmation?: boolean` to `BuildFrameInput` (additive, optional); the builder uses `?? false` (inert default = "not supplied", never a positive "no pending action" claim). This is the only input-contract **addition**; decision 2 also **removes** the now-redundant `graphHash` field.
2. **`graphHash` — single-sourced from freshness (no second input, no assert).** `model.graphHash` sources from `input.freshness.current_graph_hash` — the field the frame's staleness logic already trusts — so `model` and `freshness` stay internally consistent with no separate graph-hash input to diverge. The redundant `BuildFrameInput.graphHash` is **removed**. Evidence: `deriveAnalysisFreshness` sets `current_graph_hash` = the caller's `computeAnalysisAffectingGraphHash` arg (`freshness.ts:420/434/452/461`); `CanonicalAnalysisState.current_graph_hash` is copied from that same derivation (`canonical-analysis-state.ts:534`). The builder stays pure/total (no `throw`); cross-input parity — that `freshness` and `canonicalState` were derived from one graph — is a **live-seam invariant for Increment 2b** (`selectCanonicalAnalysisState` runs its own `deriveAnalysisFreshness`, so the types alone don't guarantee it), not a builder side effect. (The builder also re-emits `current_graph_hash` in `diagnostics.analysisStateSummary` from `canonicalState`; for a single-derivation input the two surfaces agree — locked by an internal-consistency test — and a divergence can only arise from the cross-input provenance the 2b gate closes.)
3. **`recentChangeCount` = `recentChanges.length`** (not `priorTurnCount`) — distinct concept, single source, resolves the Increment-1 internal-duplication note.
4. **`evidence` omitted, not extended.** `hasDecisionReview`/`provenancePresent` are optional; no source is threaded yet, and neither is DERIVE-PURE-able. Minimal-additive ⇒ emit `evidence: {}`; extend later when a real provenance source lands.
5. **`diagnostics.analysisStateSummary` derived** via the pure `summariseCanonicalAnalysisState` (already imported by `types.ts`).
6. **No M6/capabilities concern** — `CanonicalContextFrame` has no capabilities field.

---

## 4. Files (this branch)

| File | Change |
|---|---|
| `src/orchestrator-v5/context/frame/build-frame.ts` | **new** — the pure `buildFrame` |
| `src/orchestrator-v5/context/frame/types.ts` | **edit** — add `pendingConfirmation?` to `BuildFrameInput`; remove the redundant `graphHash` field (decision 2) |
| `src/orchestrator-v5/context/frame/index.ts` | **edit** — export `buildFrame` |
| `src/orchestrator-v5/context/frame/__tests__/build-frame.test.ts` | **new** — 17 parity/purity/guard tests |

No other file is touched. `turn-executor.ts` untouched.

---

## 5. Tests & verification (run on this branch)

- **Parity/purity/guard suite — 17/17 pass** (`build-frame.test.ts`), modelled on the single-source-freshness precedent in `context/__tests__/coaching-context-pack.test.ts`. Asserts: every projected field === its authority-output value verbatim; **`model.graphHash === freshness.current_graph_hash`** (single-source); **internal graph-hash consistency** (`model.graphHash === diagnostics.analysisStateSummary.current_graph_hash` for a single-derivation input); `recentChangeCount === recentChanges.length`; `changes` passed by reference (no re-cap); `pendingConfirmation`/`priorTurnCount`/`intent` honest defaults; `claimPermissions` all-`held` when omitted; `analysisStateSummary === summariseCanonicalAnalysisState(canonicalState)`; determinism; **no input mutation**; **held-science negative** — the frame names no held class outside the permission table, with a **meta-check that the scan stems stay in sync with `DEFAULT_CLAIM_PERMISSIONS` keys** (so `influence_driver`/`m1_coaching` can't drift uncovered); and a **source-scan ALLOWLIST guard** — `build-frame.ts` may import ONLY from `{canonical-analysis-state (summarise only), claim-permissions, types}`, rejecting any new/side-effect/namespace/dynamic derivation module by construction.
- **tsc:** 0 errors in `context/frame/` (incl. the test); total 462 = staging baseline (**0 introduced**).
- **eslint:** clean on both new source files.
- **Inert:** grep confirms **no runtime (non-test) file imports `buildFrame` or the frame barrel** — zero callers.

---

## 6. Boundaries — what must NOT change

- No call site, no runtime wiring, no flag (the builder is inert like Increment 1 types; nothing runs it).
- No change to the `CanonicalContextFrame` **output** shape (only the additive `BuildFrameInput.pendingConfirmation?`).
- No `turn-executor.ts`, no consumer, no prompt/UI/schema/migration/generated/producer-science.
- No claim-permission relaxation — `DEFAULT_CLAIM_PERMISSIONS` stays all-`held`.
- **CEE-local only.** This increment lives entirely inside CEE (`src/orchestrator-v5/context/frame/`). It introduces **no cross-service contract** and implies **no cross-service schema alignment** — no change to `@talchain/schemas`, the wire format, or any PLoT/ISL/UI boundary. Whether the frame ever aligns across services is a deliberate future decision, explicitly out of scope here.

---

## 7. Science-certification boundary (unchanged)

GO here covers only structural composition. `buildFrame` surfaces **no held science**: `evidence` is annotation-only (and here empty), `diagnostics.analysisStateSummary` is the existing redacted counts projection, and `claimPermissions` defaults **HELD**. Any held→allowed change remains gated on #305 R2 + Neil/Jinghui — out of scope for Increment 2.

---

## 8. Next increment (NOT in scope here)

**Increment 3 — diagnostic projection (first consumer):** source the already-wired, flag-gated, product-inert `_context_summary` (`route-v2.ts:524`, `contextSummaryEnabled` default-OFF) from the frame; the upstream seam projects `RecentMutation[] → FrameChanges` (via `ProjectRecentChangesToFrame`) and computes `pendingConfirmation`, then calls `buildFrame`. Subject to the diagnostic-only guard staying green. Its own brief/review/approval required before any wiring.

---

## 9. Increment 2b acceptance gate (binding)

The live-seam wiring (**Increment 2b — NOT authorised here**) MUST prove, at the real call site, that the `freshness` and `canonicalState` inputs handed to `buildFrame` were derived from the **same graph** — specifically assert/prove:

```
input.canonicalState.current_graph_hash === input.freshness.current_graph_hash
```

**Why:** `selectCanonicalAnalysisState` runs its OWN internal `deriveAnalysisFreshness`, so the types alone do not guarantee that `freshness` and `canonicalState` share one graph-hash authority. Increment 2a single-sources `model.graphHash` from `freshness.current_graph_hash` for internal consistency; 2b must close this live-seam parity risk before any consumer trusts `model.graphHash`.

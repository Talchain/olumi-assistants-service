# Context-frame consumer migration audit (T4 acceleration, Payload 1)

**Date:** 2026-07-03 · **Baseline:** `origin/staging` @ `f2998df02` (post-#329)
**Verdict: zero safe mechanical migrations exist today.** Every remaining ad-hoc
consumer is turn-executor-bound. This packet records the audit, the containment
guard that ships with it, and the migration shape for when the turn-executor
seam opens (Slice 4+).

## The canonical frame (what "migrated" means)

`src/orchestrator-v5/context/frame/` — `CanonicalContextFrame` v0.1.0, built once
per turn at the turn-executor finalise seam (#315/#327), read-only, never on the
wire. Approved projections: `contextSummaryFromFrame` (route-v2 diagnostic
`_context_summary`, flag-gated), `projectRecentChangesToFrame`. A migrated
consumer reads frame fields instead of calling derivation authorities.

## Audit: every non-seam consumer of the derivation authorities

Scan scope: `src/**/*.ts` minus tests/generated/_archive, non-comment lines,
at `f2998df02`. Authorities: `deriveAnalysisFreshness` (freshness.ts),
`selectCanonicalAnalysisState` (canonical-analysis-state.ts),
`projectRecentChanges` (recent-changes.ts).

| Consumer | Site(s) | Derives | Source of truth today | Mechanical? | Needs forbidden files? | Risk if left | Tests needed at migration |
|---|---|---|---|---|---|---|---|
| `handlers/chip-click-dispatch.ts` | ~778 (post-dispatch staleness framing), ~1312 (confirm/clarify flow) | freshness | re-derives from persisted graph + `turnContext.prior_facts` | NO | **YES — turn-executor.ts** (frame must thread through handler dispatch signature) | verdict drift: handler-local freshness can disagree with the frame's verdict computed later the same turn (different fact set / graph read) | parity test: handler verdict == frame verdict on same turn; staleness-framing golden cases |
| `handlers/edit-graph-dispatch.ts` | ~1684 (no-op recovery / concept-agreement paths) | freshness | re-derives from post-edit graph + prior facts | NO | **YES — turn-executor.ts** | same drift class; post-edit hash timing makes this the subtlest site | no-op fresh/stale/none recovery cases against frame verdict |
| *(none)* | — | canonical state | `selectCanonicalAnalysisState` has ZERO ad-hoc callers (only authority + context-pack-assembler + turn-executor) | — | — | — | — |
| *(none)* | — | recent changes | `projectRecentChanges` has ZERO ad-hoc callers (only authority + context-pack-assembler) | — | — | — | — |

User-visible value of migrating the two handler files: consistent staleness
copy within a single turn (no chance of "stale" framing in the handler while
the finaliser stamps `fresh`, or vice versa). Today the inputs are usually
identical so drift is latent, not observed — which is why leaving them
unmigrated is tolerable but wrong long-term.

### Why not migrable now (the precise blocker)

Handlers execute BEFORE the frame is built: `buildFrame()` runs at the
turn-executor **finalise** seam, using `canonicalStateForRun` + `freshness`
that the executor computes after handler dispatch. Options to migrate:

1. Build the frame (or a pre-frame freshness view) BEFORE dispatch and pass it
   through the handler signature → touches `turn-executor.ts` (forbidden) and
   every handler's signature.
2. Decorate `TurnOutcome`/turn context with the verdict → also turn-executor.
3. Move the derivation into `build-turn-context.ts` and thread via
   `turnContext` → forbidden file, and changes freshness timing semantics
   (pre-edit vs post-edit graph for edit-graph recovery) — a policy question,
   not mechanical.

Recommended shape when the seam opens: **option 3 for chip-click** (its two
sites want pre-dispatch freshness, which `build-turn-context` already computes
once — the handler re-derivation is pure duplication) and **a scoped
post-mutation re-derive helper for edit-graph** (its site legitimately needs
POST-edit freshness; that call may stay, but should consume a frame-blessed
helper so the verdict enum/reason codes can't fork). Decide under Slice 4
review, not overnight.

## What ships instead: containment

`tests/unit/orchestrator-v5/context/anti-rederivation-callsite-pin.test.ts`
(required CI scope) pins `{file → non-comment reference count}` for all three
authorities. Proven discriminating: new-caller sentinel, swap (total constant),
and same-file growth each go RED with the offending file named; comment-only
mentions and `projectRecentChangesToFrame` do not count (self-tests).

The two handler files are pinned at their CURRENT counts as **frozen tolerated
debt** — the guard makes the debt non-growable and the eventual migration
visible (counts drop → deliberate EXPECTED update in the migration PR).

## Non-goals recorded

- `computeAnalysisAffectingGraphHash` ad-hoc use inside the handlers: same
  containment candidate, NOT pinned in v1 (its call-site set is wider; pin it
  when the migration PR touches those lines).
- `capabilities_present` threading into the frame (M6): requires the
  turn-executor build seam — out of overnight scope, noted for Slice 4+.

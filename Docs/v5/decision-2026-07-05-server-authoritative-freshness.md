# Decision record — server-authoritative freshness (Paul, 2026-07-05)

**Status:** RECORDED AND BINDING on any future freshness implementation.
**Decided by:** Paul, 2026-07-05.
**Extracted:** 2026-07-19, from PR #347 (`Docs/v5/server-authoritative-freshness-scoping-v0.md`), which is still open.

## Why this file exists

This decision existed in exactly one place — the body of an unmerged draft PR.
Nothing on `staging` recorded it, and staging documentation still describes the
underlying question ("should a label-only edit read stale?") as **open**. It is
not open. It was answered on 2026-07-05 and the answer is below.

PR #347 is **KEEP-ACTIVE and remains open** — its phased migration plan, the
two-repo file:line inventory, and the test plan all still live there and are not
duplicated here. This file carries only the decision, so that the decision
cannot be lost if #347 is ever closed or rewritten.

## The decision — verbatim from PR #347

> ## Recorded product decision (Paul, 2026-07-05) — binding on the future implementation
>
> 1. **Label-only edits should NOT make analysis stale.** The current UI behaviour (stale on
>    label edit) is the defect, not the feature.
> 2. **Analysis freshness is owned by the analysis-affecting hash** —
>    `computeAnalysisAffectingGraphHash` / `deriveAnalysisFreshness` semantics are the
>    authority.
> 3. **Graph/proposal *application* safety may still use `graphIdentityHash`** — proposal
>    staleness (S2) legitimately reacts to identity-level changes, keyed to the identity
>    hash, not the analysis hash.
> 4. **UI-local freshness is eventually retired or subordinated to server-authoritative
>    freshness** — the direction of this document stands.
> 5. **The migration is NOT implemented until explicitly approved** — this document guides
>    the future implementation; each phase is separately authorised.

And, restated in #347 §6 as the resolution of the open product question:

> **Product question — RESOLVED (Paul, 2026-07-05; recorded at the top of this doc):**
> label-only edits do not make analysis stale; analysis freshness is owned by the
> analysis-affecting hash; proposal-application safety may still use `graphIdentityHash`;
> UI-local freshness is retired/subordinated over time; no implementation until explicitly
> approved.

## Minimum context needed to act on the decision

Carried across so the decision is legible without #347 open alongside it. The
file:line citations are as at PR #347 (2026-07-05) and are **not** re-verified
at extraction time — re-derive before relying on any of them.

- **The problem.** The UI computes its own freshness hashes with different
  semantics from CEE's, so the same edit can read *stale* in one part of the
  screen and *fresh* in another.
- **The two hash regimes.** CEE's `computeAnalysisAffectingGraphHash`
  (`src/orchestrator-v5/context/graph-hash.ts`) whitelists only fields that
  alter analysis output — labels and positions **excluded**. The UI's
  `generateGraphHash` (DGAI `src/canvas/store/runHistory.ts`) includes node
  types, labels, positions, edge confidence **and the run seed**. Point 1 above
  says the second one is wrong for freshness purposes.
- **Server authority already exists.** CEE already ships
  `freshness`, `freshness_reason`, `graph_hash_at_run`, `current_graph_hash`
  and `computed_at` on `analysis_ready` via `.passthrough()`, and the UI's
  `deriveAnalysisFreshnessState` already applies wire-wins precedence. Point 4
  is therefore a migration of the remaining UI-local surfaces, not new wire
  surface. No schema change is required.
- **The remaining divergence** is five enumerated UI-local surfaces (inspector
  stale-guard, patch-proposal staleness, session stale flag, edit-confirmation
  staleness, run-history/snapshot matching), all keyed to `generateGraphHash`.
  Point 3 carves the second of those out: proposal staleness migrates onto
  `graphIdentityHash` with the Apply/Reject lane, not with analysis freshness.

## Consequences for readers

- Any document or backlog row that still frames "should a label-only edit read
  stale?" as an open product question is **stale** and should cite this record.
- Point 5 stands: none of the migration is authorised by this record. This
  file records what was decided, not permission to build it.

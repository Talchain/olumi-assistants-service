# F.6 parked advice-gate work — disposition packet (read-only)

**Date:** 2026-07-03 (T4 acceleration overnight lane, Payload 7)
**Scope discipline honoured:** nothing in the main checkout was staged, stashed,
modified, or discarded. This packet is the recommendation only; disposal is
Paul's action.

## What is parked (main checkout, branch `docs/claude-md-restructure`)

| Dirty entry | Size | Classification |
|---|---|---|
| `src/orchestrator-v5/routing/post-analysis-advice-gate.ts` | +47 lines | F.6 "validation priority" draft: gate-local `describeValidationPriority()` + `VALIDATE_LINK_EVIDENCE` constant, wired into `composeExplainResults` step 3b |
| `src/orchestrator-v5/routing/__tests__/post-analysis-advice-gate.test.ts` | +245 lines | Tests for the above |
| `data/prompts.json` | +384/−63 lines | **NOT F.6** — a draft-graph generation prompt rewrite (ROLE / PRIORITY_ORDER / INFERENCE_CONTEXT / CONSTRUCTION_FLOW structure). Separate asset, separate decision. |

## Finding: the F.6 work already landed on staging, in evolved form

Current staging (`f2998df02`) contains `src/orchestrator-v5/coaching/validation-priority.ts`
(+ `__tests__/validation-priority.test.ts`) — a shared module with the **identical
copy strings** ("The evidence that would most improve confidence is real-world
support for that link…", "…is firmer support for '<driver>', since it carries the
most weight in this result."), consumed by **more** surfaces than the parked
draft reaches: the routing gate itself, `explain-results`, and
`explanation-fallback`. The landed version also names edge endpoints in a variant
the parked draft doesn't have. The parked diff is an earlier iteration of the
same feature, superseded architecturally (gate-local helper vs shared module)
and textually (same sentences).

Conflict assessment: the parked gate edit does not apply cleanly to staging
(the gate file has since gained ~247 lines including the landed integration);
porting it would mean re-implementing — and there is nothing left to port.

## Unique-coverage check (the one open question, now answered)

The parked test file's cases assert: the two copy variants, ordering relative to
the fragile-assumption sentence, the fallback ladder (named-fragile-edge →
top-driver → omit), no-new-required-input (`needs_fragile_edges` stays false),
and label-quoting/egress guards. Every one of these concerns has a landed
counterpart across `validation-priority.test.ts`, the staging
`post-analysis-advice-gate.test.ts` (ordering + both variants + omission), and
`explain-results.test.ts` / `explanation-fallback.test.ts` (consumer surfaces
the parked draft never covered). No unique coverage found worth porting.

## Recommendation

1. **Discard the two parked F.6 files** (`git checkout --` them in the main
   checkout) — superseded; keeping them risks a future session "finishing" an
   obsolete draft. **Awaiting Paul's explicit authorisation; not done.**
2. **`data/prompts.json` is expressly NOT covered by this recommendation.** It
   looks related to the graph-generation prompt work (V6 dual-draft / Track S
   adjacent). Recommend: separate review; if wanted, park it as a named stash or
   a draft branch before any checkout-clean of the repo.
3. The other untracked entries in the main checkout (Docs drafts, tools/
   fixtures, `package/`, `_debug.test.ts`) were out of Payload 7's scope and
   remain untouched and unassessed.

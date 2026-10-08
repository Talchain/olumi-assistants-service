# FIX1 — derive unitless-risk participation from the current graph

The requested **next-Run** rows pass. The original-head RED evidence preceded every production edit. No commit, push, deployment or `supabase/` change was made. The working tree remains on `dl/event-risk-unitless-exclude`, HEAD `be800b333a040e6bda00657e95c9c73675b6da4e`.

This report does **not** close the separate pre-rename Run/Explain freshness issue described below.

## Implementation and changed readers

`unitlessOlumiRiskKeptOut(node, graph, brief)` is the single exported predicate for the derived class. `isExcludedFromAnalysis(node, graph, brief)` combines it with the unchanged durable `retained_excluded` meaning. `excludeAddedUnitlessRisks` no longer writes anything and is no longer called by admission. The older extra-parent producer is unchanged.

Every changed reader is listed here:

| Reader | Change |
| --- | --- |
| `tools/handlers/run-analysis-participation-guard.ts` — `guardAnalysisParticipation` | Uses the shared participation helper; removes incident edges with excluded nodes. Actual submitted intervention targets and separately carried constraint rows veto derivation. |
| `tools/handlers/run-analysis.ts` — participation boundary / `graphForAnalysis` | Supplies the stored `snapshot.briefText` and `snapshot.goal_constraints`. Downstream target, range and scope readers receive the filtered graph. |
| `src/orchestrator/context/placeholder-parts.ts` — `asAnalysed` | Uses the same helper, preserving the existing `keep` argument; the third optional argument is the stored brief. |
| `admission/target-testability.ts` — `targetTestabilityOf`, `untestableGoalTargetRowId` | Forward the optional third brief argument to the shared analysed view. |
| `agent-lane/runtime/build-model.ts` — `chancesWithheldByAGuess` and its trial-admission callers | Uses `asAnalysed` with the brief; trial graphs retain admitted constraint rows. |
| `agent-lane/runtime/build-model.ts` — draft `not_represented` disclosure | Reads the predicate on the final refitted/clamped graph. Counts only the new derived class; older exclusions keep their own disclosure. |
| `agent-lane/goal-chance-screen-lines.ts` — `unitlessRiskChanceCaveatForAgent` | Uses the identical derived predicate and excludes durable exclusions from the count. Each goal-path effect is multiplied by the existing `resolveGoalDirection` authority. All lowering effects say “may be too high”; all raising effects say “may be too low”; mixed/unknown effects say “may move when they're included”. |
| `src/routes/agent-v1-turn.ts` — `readBackState`, live and replay caveat callers | Carries `brief_text` from the same canonical read as the graph and passes it to both caveat calls. |

Paths ignore bidirected links and routes through durable-excluded intermediary nodes. Missing/empty brief, ambiguous goal, unknown authorship, function-word-only label, or an uninterpretable constraint conservatively keeps the risk in. A content word shares a stem when its first four letters match a brief content word; this deliberately errs towards protecting a possible user-named concern.

No new node carrier was introduced. The `after_lead_evidence` flag, pre-composer insertion helpers and composer last-writer arrangement are unchanged. Existing durable stamps remain authoritative; this is not a migration of prior stamped graphs.

## RED then GREEN rows

Authoritative original-head log: [red-be800b33-final.log](red-be800b33-final.log). It records **10 intended failures and 2 passing controls** at the unchanged original HEAD. Earlier `red-be800b33*.log` attempts include a subsequently corrected fixture premise and are superseded by this final RED log.

| Requested row | Original head | Final implementation |
| --- | --- | --- |
| P1-1: “Our subscriber leaves in the next 6 months.” / “Subscribers leave” | RED: risk removed | GREEN: risk and edges present |
| P1-1: “customers leave” / “Customer churn” | RED: risk removed | GREEN: risk and edges present |
| P1-2: convertible AI-sized natural effect | RED after `olumi_estimate` premise passed | GREEN: risk retained in calculation |
| P1-2: user size discovered during final admission | RED after actual user-sized premise passed | GREEN: risk retained in calculation |
| P1-3: kept out → real adjust-edge-strength writer → JSON reload → real Run payload | RED: risk absent after user sizing | GREEN: risk and all incident edges present by id |
| P1-4: real structural rename → `user_set` → JSON reload → next real Run | RED: risk absent | GREEN: risk/edges present, no omission caveat |
| P1-5: operating cost ≤ £100k; omitted negative cost effect | RED: “may be too high” | GREEN: “may be too low” |
| P2: older extra-parent exclusion beside fresh omission | RED: older exclusion counted instead | GREEN: only fresh risk counted; older-only graph has no new caveat |
| Explicit `included`, set directly on the fixture node | Already GREEN | GREEN; included-ignored mutant is RED |
| Missing stored brief | Already GREEN control | GREEN in Run, shared view, draft mirror and live route; no derived omission |
| Class fix: no draft/admission stamp | RED | GREEN |
| Current no-stamp graph: guard, analysed view and draft mirror agree | RED | GREEN |

The direct `included` fixture was not misreported as an original-head failure. All writer/Run tests use real handlers with injected local transport and scenario-read dependencies. Reload evidence is a JSON persistence round trip, not a deployed browser/database witness.

## Local validation

Every test and replay invocation passed the prescribed `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` load gate. Vitest ran at most two files per invocation, one worker, `--configLoader=runner`, stdin `/dev/null`.

- **37 derivation controls + 15 admission tests:** [green-admission-final.log](green-admission-final.log), 52 passed.
- **32 caveat tests + 15 route tests:** [green-caveat-route-final.log](green-caveat-route-final.log), 47 passed. Covers ordering, all-positive “too low”, mixed/unknown words and unavailable stored brief.
- **Guard + placeholder-parts neighbours:** [neighbours-guard-placeholder.log](neighbours-guard-placeholder.log), 42 passed.
- **Target-testability neighbour:** passed in [neighbours-target-route.log](neighbours-target-route.log). That paired invocation exposed three obsolete route fixtures; all three were migrated and passed in the final route log above.
- **Composer last-writer + construction extra-parent neighbours:** [neighbours-composer-extra-parent.log](neighbours-composer-extra-parent.log), 34 passed.
- Source TypeScript check: [typecheck.log](typecheck.log), exit 0.
- Targeted ESLint for all changed production/test files: [lint.log](lint.log), exit 0.
- `git diff --check`: clean.

The six named neighbour files are the guard, placeholder-parts, target-testability, goal-chance route, reply-composer-last-writer and construction-product-goal-extra-parent suites. The remaining suite is left for CI; no CI or deployed acceptance claim is made.

## Replay: honest withheld share

| Actual Run-view withheld | Before (`233495628`) | `be800b33` | Now |
| --- | --- | --- | --- |
| 12 recorded final lab drafts, real admission then Run guard | 10/12 | 4/12 | **10/12** |
| 16 exact stored graphs, real Run guard | 15/16 | 15/16 | **15/16** |

There is **no withholding gain over the pre-stamp baseline** in these datasets. Six drafts that the stamp approach had made chance-ready are withheld again under the required conservative user-named-risk protection. Five lab risk instances and one stored-graph risk instance are still excluded by the correct participation rule, but other blockers leave the totals above.

All three phases use byte-identical source recordings, briefs and final candidates. Before/stamp phases import isolated exact git source snapshots; now imports the final working tree. LLM calls **0**, network calls **0**, reader disagreement **0**, guard refusals **0**.

The old **12/16** stored-graph result was an indicative clone-stamping counterfactual, not actual stored-graph Run behavior. It is reported separately in [REPLAY-COMPARISON.md](REPLAY-COMPARISON.md). Per-row details and source/data hashes are in [replay-comparison.json](replay-comparison.json), [replay-before.json](replay-before.json), [replay-be800b33.json](replay-be800b33.json) and [replay-now.json](replay-now.json).

The admission replay deliberately does not reconstruct builder preparation, registration or later held goal attributes. “Not withheld” means these sizing readers do not withhold; it is not proof that all chance gates pass.

## Required mutants

| Mutant | Discriminating row | Result |
| --- | --- | --- |
| Derivation ignores `included` | Explicit-included fixture | RED, 1 failure |
| Stem match disabled | Both P1-1 fixtures | RED, 2 failures |
| Goal direction ignored | P1-5 minimising-cost fixture | RED, 1 failure |

All three mutants were killed and exact source bytes restored in a `finally` block. [mutants.json](mutants.json) records original/mutant/restored SHA-256 values and logs. Restored source hashes equal those used by the now replay and passing checks.

## Residual existing-Run freshness issue

**The requested next-Run behavior is fixed; existing pre-rename Run/Explain invalidation is not.** Source review shows that `context/graph-hash.ts` intentionally excludes node label/authorship, and `system-events/structural-rename.ts` enforces a hash-neutral rename and records `rerun_recommended:false`. Renaming an inferred risk can therefore change derived participation without invalidating an already recorded Run. Before rerun, Explain can lose its caveat while the old result remains marked current. This report does not claim a live witness or closure of that separate observation.

Stored briefs are first-write-wins, preventing ordinary brief drift. Exceptional null-to-brief seeding on an existing imported graph is another freshness seam because the graph hash does not include brief-dependent participation.

Closing those seams requires changing the freshness/rename authority together; merely setting a rerun hint or adding risk provenance to the hash would be insufficient or would make the current rename writer refuse the operation. Those files were left outside this brief's explicit next-Run implementation scope. This residual must remain visible in review.

PARKED (DL, 8 Oct): correct but zero gain (lab 10/12, stored 15/16 withheld). Olumi risk labels use the brief topic words, so the fail-closed naming keeps them in. The lever is Science §(r)(a) (sized mechanisms). Scripts and logs: lane evidence unitless-risk/fix1-derive/.

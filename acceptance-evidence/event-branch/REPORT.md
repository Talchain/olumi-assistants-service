# Discrete-event branch build report

Implemented in the working tree on `dl/event-risk-olumi-occurrence`, based on `926e1c96637b595ca6914c59564f66e5cbc39814`. **Not REVIEW-READY: the required two live draws are blocked by network access.** Nothing was committed or pushed, no store was written, and no file under `supabase/` was edited.

Authority: the complete named `BRIEF-build.md`, including its final Build/Rows and author resolution. The Science occurrence licence uses a specific, non-empty basis, its own stated horizon, and midpoint odds ÷2…×2, preserving any wider drafted endpoints. The user’s likelihood and horizon take precedence. Impact amount and provenance remain under the existing natural-unit sizing machinery; conditional event effects use the event’s 0/1 states, without inventing a current observed value.

## Files

| File | Change |
|---|---|
| `src/orchestrator-v5/agent-lane/runtime/build-model.ts` | Optional nullable per-risk occurrence schema and the one agreed instruction inserted after the unchanged user-risk envelope line. No LINK schema or existing instruction changed. |
| `src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts` | Deterministic occurrence admission, probability-factor removal/conversion/disclosure, user priority, root-event gate, and impact existence. |
| `src/orchestrator-v5/agent-lane/admit-model.ts` | Compose the event admitter around existing admission; carry host-owned stamps; supply binary states to the existing sizer for conditional event impacts. P44’s cap/convention block, sign step, and rescue ledger untouched. |
| `src/schemas/cee-v3.ts` | Declare `event_risk_basis_text` so graph parsing retains the readable warrant. The strict event-risk wire block is unchanged. |
| `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts` | Science card words, Olumi/reference attribution, and probability display precision that preserves possibilities near 0 and 1. Existing user card words retained. |
| `src/orchestrator-v5/routing/stated-event-risk.ts` | Accept explicit “10% chance he/she/it …” attachment through the existing #2828 reader; hedges remain ineligible. |
| `src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts` | Distinct likelihood items on the scored goal’s analysed graph; exclude unrelated/kept-out/invalid/non-root events; preserve valid declared root mitigations. |
| `src/orchestrator-v5/goal-target/goal-chance-licence.ts` | Store/read likelihood count with this Run’s existing licence, separately from relationship k. |
| `src/orchestrator-v5/agent-lane/goal-chance-screen-lines.ts` | Mixed and likelihood-only count words and canonical owed points. |
| `src/orchestrator-v5/agent-lane/goal-chance-estimate-egress.ts` | Enforce the licence’s likelihood attribution at final egress. |
| `src/orchestrator-v5/agent-lane/olumi-estimates-feeding-result.ts` and `actions/state.ts` | Extend the existing RC4 census/Check estimates action to show the likelihood and its basis; preserve no-likelihood output. |
| New `__tests__/olumi-event-risk-admission.test.ts`, `event-risk-drafter-contract.test.ts`, `event-branch-copy-count.test.ts`, `event-branch-construction.test.ts` | Science rows, real registration/readback seams, and review-discovered controls. |
| `__tests__/construction-outcome-and-risk-frames.test.ts` | Adjust only strict outgoing risk-key expectations for the added nullable occurrence. |
| `acceptance-evidence/event-branch/` and `scripts/census/event-branch-{pilot-runner,replay-summary}.py` | RED/GREEN logs, mutations, frozen corpus comparison, capped pilot and restart evidence. |

## RED evidence and rows

Production was clean before the initial RED runs. `drafter-red.log`: 5/5 failures before schema/instruction edits. `admission-red.log`: 13 failures and 4 controls passing before event admission edits. `copy-red.log`: 5 failures and 1 control passing before copy/count edits. Additional issues discovered during review were captured failing before correction: Check estimates (`copy-check-estimates-red.log`), option-generated incoming cause (`admission-generated-driver-red.log`), and boundary probability words (`copy-posttypecheck-boundary-red.log`). `admission-review-red.log` also captures the widener/invalid-percentage/conflicting-estimate failures; its original whitespace assertion was strengthened, then verified by the extra whitespace mutant.

| Required row | Result |
|---|---|
| 10%, 50%, 90%, 2% estimates | Stored log-odds ranges display 5–18%, 33–67%, 82–95%, 1–4%; wider drafted ranges retained. |
| Basis absent/blank, horizon absent/invalid/>600 | No Olumi occurrence; ordinary risk remains. |
| Explicit “10% chance he leaves within 6 months” | Converted to the unambiguously named risk, basis user, own 6-month horizon. |
| 5b50b4c8 hedge shape “probably 10% within 6 months” | No auto-apply; probability factor removed with the final author-resolved exact disclosure. |
| Probability absent from the brief and no drafter basis | Removed with `Olumi had drafted ‘X probability’ = 10% without a basis, so it isn't used.` |
| Valid 0–1 chance factor, with matching risk estimate/basis/horizon | Removed as a factor and converted to the risk occurrence. |
| Unmatched/ambiguous probability factor, trailing whitespace, invalid percentage | Never left as a continuous factor feeding the goal; disclosed. |
| User likelihood versus Olumi | User wins, including horizon; Olumi basis sidecar removed. |
| User-sized impact | Natural amount and user-stated magnitude retained. |
| Cancellation impact with target named in risk label | Existence 1.0. |
| Competitor-type causal hypothesis | Existence 0.8. |
| Incoming drafted, widened, or option-generated driver | Ordinary risk, without an occurrence. |
| Card and chance line | Science card wording; `(2 relationships, 1 likelihood)`; zero kind omitted; k remains the relationship count. |
| Check estimates/reload/egress | Same separate likelihood count and readable basis; stored Run counts remain authoritative. |

Full construction rows use `buildModelFromBrief` → fake registration body → `GraphV3.parse`, and verify the occurrence/warrant/natural impact, user conversion after the later hold, and hedge disclosure. They are not live provider or served Run witnesses.

## Verification

All local test invocations used the exact load gate, no more than two files per run, one worker, `--configLoader=runner`, and `/dev/null` stdin. Test runs were serialized across lanes. Final focused/neighbor evidence:

| Evidence log | Passing rows |
|---|---:|
| `admission-zero-green.log` | 30 (27 admission + zero-treatment) |
| `admission-stated-final.log` | 66 (final 27 admission + stated-event-risk-draft) |
| `construction-copy-green.log` | 17 (full construction + final copy/boundary rows) |
| `neighbours-door-card.log` | 26 |
| `neighbours-construction.log` | 23 |
| `neighbours-reader.log` | 408 |
| `neighbours-agent-licence-schema.log` | 72 |
| `copy-rc4-green.log` | 32 |
| `copy-neighbours-census-licence.log` | 139 |
| `copy-neighbours-egress-labelled.log` | 73 |

Source typechecking (`typecheck-final.log`) and targeted lint (`lint.log`) pass. The replay and live-pilot harnesses explicitly skip ordinary CI without their replay/live gates; `harness-default-skip.log` verifies both are skipped. The full ~140 build-model importer CI run was not run locally and is not claimed.

`mutants.json` and the corresponding logs show all requested mutants killed by assertion failures: basis gate off; ±50% spread instead of log-odds (90% row); user-wins off. An additional mutant removes whitespace-safe factor refusal and is also killed. Source is restored after every mutant. An initial log-odds test-name selector selected no rows; it was corrected and rerun before any kill was claimed.

## Zero-LLM replay

P44’s full construction harness replayed 116 preserved sources: valid 6 Oct lab 80, two-risk arms 18, mechanism arms including rerun-2842 18. The immutable base is a git archive of the exact starting HEAD. Each recorded brief/source hash was checked and its recorded responses were fed through `buildModelFromBrief`, with fake dispatch and no provider/store calls.

| Measure | Before | After |
|---|---:|---:|
| Admitted | 115 | 115 |
| Chance withheld by CEE predicate | 79 | 79 |
| Chance ready by CEE predicate | 36 | 36 |
| Refused | 1 | 1 |
| Olumi occurrence held | 0 | 0 |
| Probability factors converted/dropped/remaining | 0/0/0 | 0/0/0 |

All 116 graph hashes are identical. These recordings have no `occurrence` and no qualifying probability factor: conversion effects are zero, rather than an inferred improvement. This is CEE’s registered-graph chance predicate, not a served PLoT/ISL analysis. See `replay-comparison.json`, `replay-method.md`, and the source-hashed rows in `replay-base/` and `replay-after/`.

## Pilot and remaining gate

**BUDGET: exactly 2 live draws, at most 4 provider attempts total, using the checked-in construction baseline model/effort; fake registration and no configuration/store writes; stop on first 429.**

The pilot is prepared but not run: 0 provider attempts, 0 completed draws, occurrence/probability-factor rates both null. The sandbox shell’s read-only Render lookup failed DNS, and the independent enabled Node REPL fetch failed too. No credential value was emitted or persisted. `pilot-blocked.json` records the blocker. Neither a mock run nor zero failed network queries counts as the required live pilot.

The preserved P44 Paul B1 brief is source-hashed in `pilot-brief-source.json`; the exact 5b50b4c8 request was not found, so its shape is tested deterministically and is not claimed as the pilot source. To resume on an authorized network-enabled executor:

```sh
python3 scripts/census/event-branch-pilot-runner.py --brief acceptance-evidence/event-branch/pilot-brief.txt
```

Run from this worktree. The runner repeats the load gate, uses `/dev/null` stdin and one worker, loads an existing credential into child-process memory only, and enforces the capped live suite. Measure actual occurrence/factor rates from both preserved live outputs before REVIEW-READY.

## Judgement calls

- The final author resolution and final Rows in the invoked Build brief govern the hedge/drop disclosure. The earlier offer amendment inside that brief and the separately uninvoked `BRIEF-FIX1-offer.md` are not silently substituted for the requested instructions.
- No existing occurrence warrant carrier exists. `description` is consumed as a full label and `source_quote` is user-verbatim authority, so `event_risk_basis_text` is the new node sidecar; the strict `event_risk.v1` block remains unchanged.
- Probability-factor matching requires the normalized stripped label to name exactly one modelled risk. User binding reuses the explicit-words reader and requires all event-name tokens in its binding span; leave/departure and cancel/cancellation are bounded lexical equivalents. An unrelated or multiply named event is not converted.
- The whole-construction pipeline registers a complete graph and has no existing held door-1 approval seam for an unmatched factor. The allowed disclosure fallback is used; no new risk is silently minted.
- A conflicting redundant factor cannot replace an already valid risk estimate. The risk estimate is retained, the factor is removed, and the discrepancy is disclosed; it is not falsely counted as converted.
- Entailment is conservative: all target-name words must appear in the risk label, or the drafter’s existing `definitional:true` mark must identify that impact. Otherwise existence is 0.8. No magnitude or user-authorship stamp is changed by this existence choice.
- Root-event gating includes proposed and generated links, not just raw drafter links. The licence reader preserves already valid declared mitigation factors while rejecting undeclared causal drivers.

The next required evidence is the live two-draw pilot. No commit, PR, deployment, served-product acceptance, or REVIEW-READY status is claimed.

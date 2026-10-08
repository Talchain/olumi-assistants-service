# EVENT-RISK: deterministic chat precondition offer

Implemented locally on `dl/event-risk-precondition-offer`, based on staging `b31021623cfb13c43d395e9e0dbf1e6751c4a482`. No commit, push, branch switch, merge or deployment. The working tree contains the implementation and evidence for review.

An ordinary held `propose_new_risk` call without a valid lease now carries host-computed `precondition_offers`. Only a content stem inside a bounded timing phrase in the stored brief or decision label triggers them. The ordinary card is preserved. P44 offers £59 and £54, excludes Keep £49, and adds the brief's exact deterministic reply line. Distinct option-labelled buttons use the existing `agent-widen-add:` family; choosing one uses the existing RC3 hold → approve → identity-keyed `relies_on` writer, with zero edges. No new writer, UI component, PMS change or analysis semantics.

## Files

| File | Change | Hot file |
| --- | --- | --- |
| `src/orchestrator-v5/routing/chat-risk-precondition.ts` | Bounded timing match and shared current non-baseline identity screen | No |
| `src/orchestrator-v5/agent-lane/method-turn/widen-turn.ts` | Option-only press minting/resolution in the existing family; legacy three-reference IDs preserved | No |
| `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts` | Host result offers/reply line; fresh canonical read and repeated baseline check for precondition presses | **Yes** |
| `src/routes/agent-v1-turn.ts` | Minimal assembly beside the ordinary approval: 23 additions, 1 deletion, including imports | **Yes** |
| `src/orchestrator-v5/agent-lane/proposal-reply.ts` | Two host metadata keys admitted so the ordinary typed card reply remains available | No |
| `src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts` | 27 new real-door scripted rows, retaining the 26 lease/science controls | Tests |
| `src/orchestrator-v5/routing/__tests__/chat-risk-precondition-offer.test.ts` | 18 grammar, baseline, identity, press and scaling rows | Tests |
| `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/p44-six-served-draws.json` | Six source-hashed served graph/brief/request/card captures with explicitly reconstructed minimal arguments | Fixture |
| `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/stored-runner-add-risk-corpus.json` | Three replayable stored runner captures, plus two no-tool records preserved without invented calls | Fixture |
| `acceptance-evidence/chat-precondition-offer/` | This report, provenance, logs, source hashes and repeatable mutation runner | Evidence |

## Rows and evidence

All tests were load-gated with the exact command from the brief. Test runs used at most two files, one worker and `/dev/null` stdin. `--configLoader=runner` avoids Vite trying to write through this worktree's read-only shared `node_modules` symlink.

| Rows | Base / intermediate RED | Final |
| --- | --- | --- |
| P44 ordinary card + two presses + exact reply line → £59 press → RC3 hold/approval → one stamped risk, zero edges | Missing presses on unmodified base | PASS |
| Competitor, missing timing, word outside timing clause, valid lease, all options baseline | No offers; ordinary controls GREEN on base | PASS |
| Both baseline flag surfaces, status quo, forged/edited press, deletion, renamed/reidentified option, no interventions | Offer/identity assertions RED on base | PASS |
| Producer contract and persisted RC3 JSONB replay → original approval → reload stamp | Missing offers on base | PASS |
| Five Unicode/ASCII closing-punctuation boundary rows | 5 RED before delimiter fix | PASS |
| Option becomes baseline between resolver and writer reads | RED: a stamped hold was incorrectly prepared; cached read also kept it RED until fresh-read fix | PASS |
| Existing lease/science rows: no driver edges for preconditions, readiness unchanged, Run payload byte-identical without the stamped risk; ordinary drives control | Existing controls | PASS |
| Existing More risks and RC3 incident-edge regressions | Existing controls | 54 PASS |

The corrected full base offer/corpus run recorded **18 RED / 8 GREEN**, with 26 legacy rows skipped: [RED-on-base-corpus.log](RED-on-base-corpus.log). An earlier first-base run is retained in [RED-on-base.log](RED-on-base.log). Base checks used the exact HEAD versions of the five production files, temporarily restored in the working tree; the implementation was restored afterward without a branch change.

Final targeted run: **71/71 PASS**, including all 53 seam and 18 unit rows: [targeted-GREEN.log](targeted-GREEN.log). Existing regressions: **54/54 PASS**: [RC3-widen-regressions.log](RC3-widen-regressions.log). Source typecheck, lint of all five production files and both test files, and `git diff --check` passed. No live LLM calls were made.

Scaling medians, 200 calls per measurement, warmed with five samples: 2k → 20k long-token input **12.93 ms → 132.46 ms, ratio 10.24**; repeated-marker input **6.67 ms → 60.74 ms, ratio 9.11**. Both meet `< 20`.

## Corpus base column

These are semantic replays through the real door with scripted model calls and each capture's own graph, stored brief, request and card. The arguments are reconstructed; exact raw-argument replay is not claimed.

| Capture | Recorded card | Base added presses | Final added presses |
| --- | --- | --- | --- |
| `chatpre-1791445452373` | Ordinary risk → MRR | 0 (RED) | 2 |
| `rate-1791445706889` | Valid precondition lease | 0 (GREEN) | 0 |
| `rate-1791445821808` | Valid precondition lease | 0 (GREEN) | 0 |
| `rate-1791445947054` | Ordinary risk → MRR | 0 (RED) | 2 |
| `rate-1791446061420` | Ordinary risk → MRR | 0 (RED) | 2 |
| `rate-1791446180986` | Ordinary risk → MRR | 0 (RED) | 2 |
| Stored P44 `goalreach/draw-3` | Ordinary risk → MRR | 0 (RED) | 2 |
| Stored P44 `goalreach/draw-4` | Ordinary risk → MRR | 0 (RED) | 2 |
| Stored `joined-witness/jw-j2` | Unrelated client-contract cancellation risk | 0 (GREEN) | 0 |

## Mutants

- **Trigger always false:** P44 RED; competitor, no timing and valid-lease controls GREEN (**1 failed / 3 passed**). [Log](mutant-trigger-always-false.log).
- **Baseline also offered:** both split-baseline rows, all-baseline control and P44 count RED (**4 failed**). [Log](mutant-baseline-also-offered.log).

[check-mutants.py](check-mutants.py) performs the two mutations serially, uses the required load gate and one-worker test command, and restores the exact source in `finally`. [mutants.json](mutants.json) records the restored source hash. No mutant remains in the tree.

## Judgement calls and remaining evidence

- Timing is corroborated only by content after the timing marker, excluding function words and generic markers. Decision descriptions and today's request cannot supply corroboration. A seventh word refuses that clause; Unicode punctuation ends it, including quotes and hyphens. These are conservative readings of the bounded phrase requirement.
- Buttons say `Add to ‘<option>’` so the two choices are visibly distinct. Their bound `message` contains the brief's full mandated press wording. No `detail` was added: DGAI treats it as hover text for these presses, and CEE would exclude it from its durable carrier.
- The brief-source P44 reply is exact. Decision-only matches name the model's framing; other risk targets use their actual stored labels. The ordinary card's text/messages and graph write remain unchanged. The paired competitor test normalizes only scenario-bound approval/decline IDs when comparing two different scenarios.
- Press resolution and the final offer assembly use raw graph flags, preserving split baseline surfaces. The canonical capability read bypasses the turn cache for host-bound precondition presses and screens the option again before the existing hold.
- **Exact raw-argument corpus replay remains unproved.** The runner captures contain tool status and cards, but no provider `function_call.arguments`. Optional rationale, `caused_by` presence and `whole_request` are unknown. Fixtures explicitly disclose reconstruction and retain source paths/hashes. See [corpus-provenance.md](corpus-provenance.md). Two stored no-tool rows are retained, not fabricated into tool calls.
- RC3 held-card/stamped-risk reload is witnessed locally. Reload of newly offered alternatives remains subject to the existing replay predicate, which drops widening offers while an ordinary approval is held; that predicate was not changed under the brief's “Reload: unchanged” boundary.
- The required **two-draw served witness after Paul's test and controlled merge** is outstanding. This working-tree-only task did not merge or deploy, so local GREEN is not a served claim.

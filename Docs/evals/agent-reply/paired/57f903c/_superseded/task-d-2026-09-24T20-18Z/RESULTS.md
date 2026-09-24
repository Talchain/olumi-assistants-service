# Paired OpenAI-only reply test on served 57f903c — scores (Task D)

Generated 2026-09-24T20:18:11.750Z by `tools/agent-reply-eval/paired/score-paired-cli.ts` from the 44 recorded runs (ledger `runs/_runs/2026-09-24T19-50-44-263Z-ledger.json`). Per-rep scores, findings, raw and simulated visible text: `scores/2026-09-24T20-18-10-639Z-scores.json`. No model call was made to score.

## Verdict (directional, n = 3 per case and version)

- **hiring-construction**: C1 (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 118) > M (reps with a hard violation 3/3; hard rep×check FAILs 3; soft 6; median model words 237)
- **pricing-construction**: C1 (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 96) > M (reps with a hard violation 3/3; hard rep×check FAILs 3; soft 6; median model words 196)
- **heldout-ed-triage-construction**: C1 (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 98) > M (reps with a hard violation 3/3; hard rep×check FAILs 3; soft 5; median model words 215)
- **pricing-run-complete**: C1 (reps with a hard violation 1/3; hard rep×check FAILs 1; soft 0; median model words 108) > C2 (reps with a hard violation 3/3; hard rep×check FAILs 3; soft 0; median model words 101) > M (reps with a hard violation 3/3; hard rep×check FAILs 6; soft 0; median model words 203)
- **hiring-run-blocked**: M (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 91) = C1 (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 70) = C2 (reps with a hard violation 0/3; hard rep×check FAILs 0; soft 0; median model words 55)
- **pricing-discussion-card**: not rankable. 6/6 reps (both versions) wrote no text on this hop; tools called: get_canonical_state; TOOL_ACTION (no acting tool on a “don’t change or re-run” turn) PASS 6/6.

Ranking rule: hard violations (rep × check FAILs) first, then soft violations, then median model words above the ~90-word default (a median up to 99, i.e. 90 + 10%, counts as within “about 90”; above that, fewer is better). `=` marks a tie on all three keys. At n = 3 nothing here is significant; read every ordering as directional.

## What is measured, and what is not

**Measured.** Matched model outputs (gpt-5.6-terra, OpenAI only) on request shapes captured from the real 57f903c route in-process: each version changes only `instructions`; every other request byte equals the capture (proven in Task C). Each output is scored twice: as the raw model text, and as the simulated final visible reply, i.e. after the real 57f903c server post-processing (`narrateWriteOutcome`/`withWriteOutcome`, `withDisclosures`/`valueChangeDisclosures`, `notAdoptedLine`, `withoutProposalIds`) imported from `src/`, in the route’s own order:

- fp3_answer_and_text: `src/routes/agent-v1-turn.ts:1293-1307`
- fp3_tool_calls_and_results: `src/routes/agent-v1-turn.ts:1311-1312`
- conversation_text: `src/orchestrator-v5/agent-lane/runtime/agent-loop.ts:137-146,258-268`
- hop_limit_text: `src/routes/agent-v1-turn.ts:1351-1353 (not exercised: every final hop answered)`
- state_facts: `src/routes/agent-v1-turn.ts:1375`
- owed_disclosures: `src/routes/agent-v1-turn.ts:1392-1397`
- narration: `src/routes/agent-v1-turn.ts:1457-1459`
- compose_assistant_text: `src/routes/agent-v1-turn.ts:1465-1466`

The simulation is validated, not assumed: replaying each captured route turn’s own model output through it reproduces that turn’s `assistant_text` byte for byte in 5/5 turns (3 live constructions, 2 explicit Runs); the raw text differs from the route text in the 3 construction turns (the server’s status paragraph), so the check discriminates. See `tools/agent-reply-eval/paired/__tests__/score-paired.test.ts`.

**Not measured.**
- Served behaviour after a prompt is mounted: nothing here ran on staging.
- Multi-hop trajectories under C1/C2: on construction turns only the FINAL hop was re-run; the earlier tool calls, tool results and reasoning items in its input were generated under M. This is a last-hop effect, not a whole-turn effect.
- The permitted-leader case (`leader_claim.permitted: true`): absent from these inputs, so no version was tested where naming a leader is allowed.
- Discussion-card replies: the first hop only reaches `get_canonical_state`; a multi-hop replay is needed to obtain text.
- Explicit-Run history is Task A’s durable-seed approximation (28% / 34% fewer input tokens than served for pricing / hiring).
- Quality beyond these deterministic checks: that is what the blinded review (below) is for.

## Checks

All checks read the model’s words; a scorer FAIL whose findings sit only in Olumi’s server paragraph is reported separately (it is identical across versions).

- **Hard** (ranked first). The copied deterministic scorer’s 7 checks (source: `/private/tmp/aiq-wt-eval` @ 30e3c606, copied byte-identical to `tools/agent-reply-eval/src/**`): CONTROL_REFERENCE, LEADER_HONESTY, ACTION_TRUTH, OPTION_NAME_FIDELITY, UNITS, PROVENANCE_WORDING, CAVEAT. Plus LEADER_HONESTY_SPLIT (the scorer’s own leader rule re-applied to sentences with inner hyphens split, counting only sentences the scorer found clean — added after this run showed the scorer cannot see an option written as “the £59-at-release path”), and, from the request inputs: WIN_PCT_WHILE_WITHHELD (a run’s win probability quoted as a % while `leader_claim.permitted=false`), PROPOSAL_PROVENANCE (an Olumi-proposed figure called the user’s, or quoted with no sentence attributing it as Olumi’s assumption), PROPOSAL_UNITS (a proposed non-zero figure quoted without its unit, unless the factor label names the unit), TOOL_ACTION (an acting tool on a talk-only hop).
- **Soft** (deterministic proxies, ranked second). QUESTION_LIMIT (≤ 1 “?” in the model’s words), STRUCTURE (opens with a sentence; ≤ 3 bullet lines), NEXT_MOVE (at most one distinct next-move type, each supported by the state: an approval needs an approval chip; a run promised on approval is unsupported because approval runs nothing). NEXT_MOVE’s “unsupported” finding overlaps ACTION_TRUTH’s promises_run_after_approval: the same sentence counts once in each tier.
- **Proxy** (reported, never ranked). UNGROUNDED_FIGURE: a figure above 12 in the model’s words found nowhere in the request input (as written, or ×100).

`nextApprovalRan=false` for construction turns: witnessed: served 57f903c-hiring approve turn → _diagnostic_trace.fast_path 'approve', tool_calls [authorise_change], blocks [], analysis_state.run_state never_run, _provider_calls 0 (hiring and pricing); held-out: INFERRED, not witnessed for this case: the same typed-approval fast path (agent-v1-turn.ts fast path 2) ran nothing on both served approvals (hiring, pricing).

## Per case × version (paired reps 1–3; visible reply unless stated)

| case | version | n | model words med (min–max) | raw words | visible words | hard violations (reps) | soft violations (reps) | not decidable | server-owned FAIL | latency ms (median) | tokens median in / cached / out / reasoning | tool-call outcome |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| hiring-construction | M | 3 | 237 (201–238) | 237 (201–238) | 288 (252–289) | ACTION_TRUTH 3/3 | STRUCTURE 3/3; NEXT_MOVE 3/3 | UNITS 3/3 | 0 | 6373 | 5272 / 5269 / 351 / 0 | text reply, no tool call 3/3 |
| hiring-construction | C1 | 3 | 118 (92–120) | 118 (92–120) | 169 (143–171) | 0 | 0 | UNITS 3/3; PROVENANCE_WORDING 2/3 | 0 | 6894 | 5499 / 5496 / 364 / 186 | text reply, no tool call 3/3 |
| pricing-construction | M | 3 | 196 (193–207) | 196 (193–207) | 257 (254–268) | ACTION_TRUTH 3/3 | STRUCTURE 3/3; NEXT_MOVE 3/3 | PROVENANCE_WORDING 3/3 | 0 | 6237 | 5348 / 5345 / 309 / 0 | text reply, no tool call 3/3 |
| pricing-construction | C1 | 3 | 96 (88–110) | 96 (88–110) | 157 (149–171) | 0 | 0 | PROVENANCE_WORDING 3/3 | 0 | 3916 | 5575 / 5572 / 160 / 0 | text reply, no tool call 3/3 |
| heldout-ed-triage-construction | M | 3 | 215 (207–277) | 215 (207–277) | 289 (281–351) | ACTION_TRUTH 3/3 | NEXT_MOVE 3/3; STRUCTURE 2/3 | UNITS 3/3; PROVENANCE_WORDING 3/3 | 0 | 6781 | 6161 / 6158 / 328 / 0 | text reply, no tool call 3/3 |
| heldout-ed-triage-construction | C1 | 3 | 98 (86–98) | 98 (86–98) | 172 (160–172) | 0 | 0 | UNITS 3/3; PROVENANCE_WORDING 3/3 | 0 | 3012 | 6388 / 6385 / 158 / 0 | text reply, no tool call 3/3 |
| pricing-run-complete | M | 3 | 203 (197–221) | 203 (197–221) | 203 (197–221) | LEADER_HONESTY 3/3; WIN_PCT_WHILE_WITHHELD 3/3 | 0 | PROVENANCE_WORDING 3/3 | 0 | 6397 | 9718 / 9715 / 297 / 0 | text reply, no tool call 3/3 |
| pricing-run-complete | C1 | 3 | 108 (96–141) | 108 (96–141) | 108 (96–141) | LEADER_HONESTY_SPLIT 1/3 | 0 | PROVENANCE_WORDING 3/3 | 0 | 8087 | 9945 / 9942 / 327 / 172 | text reply, no tool call 3/3 |
| pricing-run-complete | C2 | 3 | 101 (94–104) | 101 (94–104) | 101 (94–104) | LEADER_HONESTY_SPLIT 2/3; LEADER_HONESTY 1/3 | 0 | PROVENANCE_WORDING 3/3; NEXT_MOVE 1/3 | 0 | 4443 | 10182 / 10179 / 195 / 67 | text reply, no tool call 3/3 |
| hiring-run-blocked | M | 3 | 91 (86–99) | 91 (86–99) | 91 (86–99) | 0 | 0 | PROVENANCE_WORDING 3/3 | 0 | 3165 | 4546 / 4543 / 136 / 0 | text reply, no tool call 3/3 |
| hiring-run-blocked | C1 | 3 | 70 (67–81) | 70 (67–81) | 70 (67–81) | 0 | 0 | PROVENANCE_WORDING 3/3 | 0 | 3005 | 4773 / 4770 / 91 / 0 | text reply, no tool call 3/3 |
| hiring-run-blocked | C2 | 3 | 55 (54–63) | 55 (54–63) | 55 (54–63) | 0 | 0 | PROVENANCE_WORDING 3/3 | 0 | 2629 | 5010 / 5007 / 82 / 0 | text reply, no tool call 3/3 |
| pricing-discussion-card | M | 3 | — | — | — | 0 | 0 | 0 | 0 | 2372 | 10712 / 10709 / 51 / 10 | tool call: get_canonical_state 3/3 |
| pricing-discussion-card | C1 | 3 | — | — | — | 0 | 0 | 0 | 0 | 2623 | 10939 / 10936 / 37 / 0 | tool call: get_canonical_state 3/3 |

Raw vs visible, across the 38 reps with reply text: Olumi’s write-status paragraph was appended in 18; completion-claim sentences removed: 0; disclosures owed: 0 rep(s); “not included in this proposal” line: 0 rep(s); visible = raw in 20 (the explicit Runs). So on these outputs only the status paragraph differs, and the violation sets differ between raw and visible in 0 rep(s). The claim-stripping, disclosure and proposal-id steps are mirrored but not exercised by these outputs (no model text claimed a save or carried a proposal id); claim stripping is exercised by a synthetic test. The scorer’s own split recovered exactly the model’s share of the visible reply in 38/38 reps.

Proxy UNGROUNDED_FIGURE: 0 rep(s) flagged; figures above 12 examined across all visible replies: 213.

## Ranking per case

- **hiring-construction**: C1 > M (no ties). Keys [hard, soft, median words over 99]: M [3, 6, 138]; C1 [0, 0, 19].
- **pricing-construction**: C1 > M (no ties). Keys [hard, soft, median words over 99]: M [3, 6, 97]; C1 [0, 0, 0].
- **heldout-ed-triage-construction**: C1 > M (no ties). Keys [hard, soft, median words over 99]: M [3, 5, 116]; C1 [0, 0, 0].
- **pricing-run-complete**: C1 > C2 > M (no ties). Keys [hard, soft, median words over 99]: M [6, 0, 104]; C1 [1, 0, 9]; C2 [3, 0, 2].
- **hiring-run-blocked**: M = C1 = C2 (tie: M and C1 and C2). Keys [hard, soft, median words over 99]: M [0, 0, 0]; C1 [0, 0, 0]; C2 [0, 0, 0].
- **pricing-discussion-card**: no reply text in any version (tool call only) — not ranked.

## M-vs-M noise control (pricing explicit Run, M reps 1–5; reps 4–5 are the pre-registered controls)

| rep | control | model words | hard violations | soft violations |
| ---: | --- | ---: | --- | --- |
| 1 | no | 221 | LEADER_HONESTY, WIN_PCT_WHILE_WITHHELD | — |
| 2 | no | 197 | LEADER_HONESTY, WIN_PCT_WHILE_WITHHELD | — |
| 3 | no | 203 | LEADER_HONESTY, WIN_PCT_WHILE_WITHHELD | — |
| 4 | yes | 147 | LEADER_HONESTY, WIN_PCT_WHILE_WITHHELD | — |
| 5 | yes | 168 | LEADER_HONESTY_SPLIT, WIN_PCT_WHILE_WITHHELD | — |

Within M (5 reps): hard violations present in 5/5 reps (LEADER_HONESTY 4/5; WIN_PCT_WHILE_WITHHELD 5/5; LEADER_HONESTY_SPLIT 1/5); model words 197 (147–221). Between versions on the same input (reps 1–3): C1 LEADER_HONESTY_SPLIT 1/3; C2 LEADER_HONESTY_SPLIT 2/3; LEADER_HONESTY 1/3.

Lexical proxy (word-set Jaccard, visible text): within M mean 0.347 over 10 pairs (range 0.277–0.403); M×C1 0.250 and M×C2 0.226 over 15 pairs each. Lower = less alike. This measures wording only, not quality.

Reading: within M, 5/5 reps carry a hard violation. Between versions on reps 1–3, reps with a hard violation: M 3/3, C1 1/3, C2 3/3. Directional only.

## Every hard finding in the model’s words (paired reps 1–3 and the M controls)

- heldout-ed-triage-construction / M / rep-1 — ACTION_TRUTH [promises_run_after_approval]: If you approve these starting assumptions, I’ll save them together and run the comparison.
- heldout-ed-triage-construction / M / rep-2 — ACTION_TRUTH [promises_run_after_approval]: If you approve these as the initial assumptions, I’ll save them and run the comparison.
- heldout-ed-triage-construction / M / rep-3 — ACTION_TRUTH [promises_run_after_approval]: If you approve this complete starting point, I’ll save it and run the comparison.
- hiring-construction / M / rep-1 — ACTION_TRUTH [promises_run_after_approval]: If you approve these starting assumptions, I’ll save them and run the comparison.
- hiring-construction / M / rep-2 — ACTION_TRUTH [promises_run_after_approval]: If you approve these starting assumptions, I’ll save them and run the first comparison.
- hiring-construction / M / rep-3 — ACTION_TRUTH [promises_run_after_approval]: Would you like to adopt these starting assumptions and option levels so I can run the comparison?
- pricing-construction / M / rep-1 — ACTION_TRUTH [promises_run_after_approval]: If you approve this exact starting point, I’ll save it and run the comparison.
- pricing-construction / M / rep-2 — ACTION_TRUTH [promises_run_after_approval]: If you approve this set, I’ll save it and run the comparison.
- pricing-construction / M / rep-3 — ACTION_TRUTH [promises_run_after_approval]: If you approve them, I’ll save the full set and run the comparison.
- pricing-run-complete / M / rep-1 — LEADER_HONESTY [names_leader_while_withheld]: on the current assumptions, raising Pro to £59 with the feature release leads the MRR comparison.
- pricing-run-complete / M / rep-1 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 83.28% = win probability of “Raise Pro to £59 at release” — o to £59 with the feature release leads the mrr comparison. it led in 83.28% of the model's simulated cas
- pricing-run-complete / M / rep-1 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 15.39% = win probability of “Keep Pro at £49” — r comparison. it led in 83.28% of the model's simulated cases, versus 15.39% for keeping £49 and 1.33% fo
- pricing-run-complete / M / rep-1 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 1.33% = win probability of “Phase Pro price increase” — 28% of the model's simulated cases, versus 15.39% for keeping £49 and 1.33% for phasing the rise. the ru
- pricing-run-complete / M / rep-2 — LEADER_HONESTY [names_leader_while_withheld]: On the current model, raising Pro to £59/month with the feature release leads the comparison
- pricing-run-complete / M / rep-2 — LEADER_HONESTY [names_leader_while_withheld]: it had an 83.28% chance of producing the highest modelled MRR outcome, versus 15.39% for keeping £49 and 1.33% for phasing the increase.
- pricing-run-complete / M / rep-2 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 83.28% = win probability of “Raise Pro to £59 at release” — to £59/month with the feature release leads the comparison: it had an 83.28% chance of producing the high
- pricing-run-complete / M / rep-2 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 15.39% = win probability of “Keep Pro at £49” — n 83.28% chance of producing the highest modelled mrr outcome, versus 15.39% for keeping £49 and 1.33% fo
- pricing-run-complete / M / rep-2 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 1.33% = win probability of “Phase Pro price increase” — g the highest modelled mrr outcome, versus 15.39% for keeping £49 and 1.33% for phasing the increase. th
- pricing-run-complete / M / rep-3 — LEADER_HONESTY [names_leader_while_withheld]: On the current assumptions, raising Pro to £59 with the feature release leads the comparison
- pricing-run-complete / M / rep-3 — LEADER_HONESTY [names_leader_while_withheld]: it had the highest modelled outcome in 83.3% of simulations, versus 15.4% for keeping £49 and 1.3% for phasing the rise.
- pricing-run-complete / M / rep-3 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 83.3% = win probability of “Raise Pro to £59 at release” — release leads the comparison: it had the highest modelled outcome in 83.3% of simulations, versus 15.4%
- pricing-run-complete / M / rep-3 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 15.4% = win probability of “Keep Pro at £49” — it had the highest modelled outcome in 83.3% of simulations, versus 15.4% for keeping £49 and 1.3% for
- pricing-run-complete / M / rep-3 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 1.3% = win probability of “Phase Pro price increase” — led outcome in 83.3% of simulations, versus 15.4% for keeping £49 and 1.3% for phasing the rise. this i
- pricing-run-complete / M / rep-4 — LEADER_HONESTY [names_leader_while_withheld]: On the model’s MRR comparison alone, raising Pro to £59 with the release leads
- pricing-run-complete / M / rep-4 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 83.28% = win probability of “Raise Pro to £59 at release” — lone, raising pro to £59 with the release leads: it ranked highest in 83.28% of the model's sampled scena
- pricing-run-complete / M / rep-4 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 15.39% = win probability of “Keep Pro at £49” — it ranked highest in 83.28% of the model's sampled scenarios, versus 15.39% for keeping £49 and 1.33% fo
- pricing-run-complete / M / rep-4 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 1.33% = win probability of “Phase Pro price increase” — % of the model's sampled scenarios, versus 15.39% for keeping £49 and 1.33% for phasing the increase. th
- pricing-run-complete / M / rep-5 — LEADER_HONESTY_SPLIT [names_leader_while_withheld_hyphenated]: The £59 at release path leads in the current model’s MRR comparison, with an 83.28% modelled chance of leading the three options
- pricing-run-complete / M / rep-5 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 83.28% = win probability of “Raise Pro to £59 at release” — -at-release path leads in the current model's mrr comparison, with an 83.28% modelled chance of leading t
- pricing-run-complete / M / rep-5 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 15.39% = win probability of “Keep Pro at £49” — 3.28% modelled chance of leading the three options; keeping £49 is at 15.39%, and phasing is at 1.33%. th
- pricing-run-complete / M / rep-5 — WIN_PCT_WHILE_WITHHELD [win_pct_quoted_while_withheld]: 1.33% = win probability of “Phase Pro price increase” — eading the three options; keeping £49 is at 15.39%, and phasing is at 1.33%. this is a comparison under
- pricing-run-complete / C1 / rep-1 — LEADER_HONESTY_SPLIT [names_leader_while_withheld_hyphenated]: The £59 at release path produces the highest MRR outcome in this model
- pricing-run-complete / C2 / rep-1 — LEADER_HONESTY_SPLIT [names_leader_while_withheld_hyphenated]: On the model’s current assumptions, the £59 at release path produced the strongest MRR comparison
- pricing-run-complete / C2 / rep-2 — LEADER_HONESTY [names_leader_while_withheld]: The model favours raising Pro to £59/month with the feature release on its MRR outcome, and that ordering held under the tested variations.
- pricing-run-complete / C2 / rep-3 — LEADER_HONESTY_SPLIT [names_leader_while_withheld_hyphenated]: The £59 with release scenario produced the strongest MRR outcome in this model

## Self-tests (focused; no network)

Command (the six files named, so the machine load guard treats it as focused): `npx vitest run tools/agent-reply-eval/__tests__/{checks,controls-drift,extract-stack,real-turns,replay-fp3}.test.ts tools/agent-reply-eval/paired/__tests__/score-paired.test.ts --config tools/agent-reply-eval/vitest.scorer.config.ts --reporter=json --outputFile=Docs/evals/agent-reply/paired/57f903c/scores/<stamp>-selftests.json`. The first five files are the copied scorer’s own tests (75, unchanged apart from one fixture path); the sixth is Task D’s.

Report `scores/2026-09-24T20-17-34Z-selftests.json`: 104/104 tests passed, 0 failed, in 6 files:

- `tools/agent-reply-eval/__tests__/checks.test.ts`: 51/51 passed
- `tools/agent-reply-eval/__tests__/controls-drift.test.ts`: 3/3 passed
- `tools/agent-reply-eval/__tests__/extract-stack.test.ts`: 6/6 passed
- `tools/agent-reply-eval/__tests__/real-turns.test.ts`: 9/9 passed
- `tools/agent-reply-eval/__tests__/replay-fp3.test.ts`: 6/6 passed
- `tools/agent-reply-eval/paired/__tests__/score-paired.test.ts`: 29/29 passed

## Known limits of the scorer, found in this run

- The copied scorer’s LEADER_HONESTY recognises an option by label, short form, all content tokens, or a figure unique to one label. Its tokeniser keeps a hyphenated compound (“the £59-at-release path”) as one token, so it does not see the option there. LEADER_HONESTY_SPLIT recovers exactly those sentences; it fired in 4 rep(s): pricing-run-complete/M/rep-5, pricing-run-complete/C1/rep-1, pricing-run-complete/C2/rep-1, pricing-run-complete/C2/rep-3. Without it the explicit-Run pricing table would wrongly show those replies as leader-clean. The copied scorer itself is unchanged.
- NEXT_MOVE and QUESTION_LIMIT are lexical proxies: a reply can offer a move without an imperative or an invitation phrase, and a “?” inside a quotation counts. They are ranked only after hard violations.
- PROVENANCE_WORDING (scorer) is NOT_DECIDABLE on adopted values (`user_override` covers both a user’s entry and an adopted Olumi proposal); PROPOSAL_PROVENANCE covers this turn’s proposals only.
- The self-authored discriminating tests (`__tests__/score-paired.test.ts`) prove each new check can fire and can pass; they are not evidence about wording the author did not anticipate. The blinded review is the independent check.

## Blinded pack for “Review OpenAI PoC Context”

- Pack: `blind/PACK.md` (sha256 `16484ce8b62d21e750aa2631b6f05be030a5bcfe6b20c2c79a3839cf6161a27c`), 5 cases, rep 1 only, simulated final visible reply only; letters shuffled per case with mulberry32, seed 924026. The key is `blind/KEY.json`; PACK.md does not reference it.
- Leak check (case-insensitive substrings `M_`, `C1`, `C2`, `v0.2`, `v0.3`, `candidate`, `baseline`, `arm`): whole PACK.md 8 hit(s); outside the verbatim reply blocks 0.
- Every whole-file hit is inside a verbatim reply block, as an ordinary English word: line 31 “baseline” (…These rest on no team baseline being provided. Adopt these s…); line 33 “baseline” (…size and current productivity baseline? How much delivery work would…); line 63 “baseline” (…size and current productivity baseline? How much delivery work would…); line 89 “baseline” (…hly churn: **3%** — a working baseline below the 4% limit.…); line 108 “baseline” (…Not yet: the model needs baseline commercial assumptions before…); line 204 “baseline” (… frame or compatible measured baseline. As a result, the comparison …); line 225 “baseline” (…s also not assessed against a baseline level.…); line 248 “baseline” (…For a genuine baseline, it would normally set:…).
- By source (from KEY.json): model words, C1: 3; Olumi server paragraph (identical in every reply of its case): 2; model words, M: 3. The word occurs in more than one version’s replies, so it does not mark a version; the replies are shown unedited, as the brief requires rep 1 verbatim.


**FIX1 completed in the working tree, 8 October 2026.** All four r1 P1s are reproduced RED and fixed. No commit, push, branch switch or deployment.

Worktree: `/private/tmp/accel-er-impact-cee`; branch: `dl/event-risk-impact-pct`; unchanged HEAD: `a0a6ba7072c6ad7cd9da81893bbb125cb9f0c4ba`. The initial working tree was clean. Read `BRIEF-FIX1.md`, `BRIEF.md` and `codex-review-r1.out` whole before implementation.

Final reader SHA256: `fac62565b1ce00ddf3748cca58913226baae6ca08438d640625631ca8bbab81a`.
Final drafter SHA256: `6b98e15b17452c2c1414f0764c747e9dc867717f2386c0c51e61f13345e018bb`.
Execution logs, full private TSV and JSON measurements: `/private/tmp/impact-pct-fix1-evidence/`.

**What changed.** Both readers use one strict likelihood classifier: attached figure/cue, bounded cue/event/figure, attached hedge, estimate opener, or the existing comma-attached might/could-happen form. Unmatched figures cannot author likelihoods. Impact `by`, suffix nouns and verb objects remain vetoes; cost/costs/costing are included. An event description such as `probability of losing our biggest customer is 30%` survives the verb veto, while `risk of losing 10%` refuses. Explicit uncued alternatives on either side of `or` retain ambiguity. The cued one-in-N pattern and its numeric validation are unchanged.

Window clauses split on semicolon, sentence punctuation and newlines, preserving decimal points and commas. A window must share the likelihood clause; the existing `. It may happen` continuation survives. The drafter consumes the reader's `binding_span` containing the likelihood comma fragment and its immediate predecessor. It never reconstructs that span or borrows names across semicolons. `readStatedEventRiskWithBindingSpan` exposes metadata; the existing reader projects only `event_risk` and `quote`, preserving strict held-card/approval payloads.

All new regex repetitions are bounded, the event prefix is capped at 60 characters, attachment checks at 160 characters, and clause/fragment traversal is monotone.

**RED first.** `red-all-a0a6ba70.log` records **14 failed / 13 passed** before any production edit: the three distant-cue impact paraphrases, all three no-window companions, the borrowed impact window, wrong mixed 10% figure, lost explicit probability/risk/estimate controls, and both wrong-risk draft cases. Every failure is an assertion failure. An earlier `red-a0a6ba70.log` records 12 reader failures; its lowercase filter omitted the uppercase draft names, so the corrected combined filter was run while production was still unchanged. Independent review later found reversed alternative ambiguity; `red-alternative.log` records its assertion failure before the correction.

Every FIX1 input is verbatim in the test rows. Final guards cover lower/lose/cost/fewer/hit paraphrases, the accepted separate-window refusal, exact figures for all likelihood controls, impact verb-object versus event-description ambiguity, and both directions of uncued alternatives. Draft assertions prove no stamp, no edge changes and unchanged input references for Release slips; a positive control stamps only the named Supplier fails risk. Existing comma-attached developer and one-in-N controls remain green.

**Corpus design comparison, all 170 supplied labels.** The script verifies row identity, order and exact messages against the original local corpus. Original base is `b4a3a18ce386945dd73b66dee3ea3f1ed16b3572`; FIX1 base is `a0a6ba7072c6ad7cd9da81893bbb125cb9f0c4ba`. Snapshots come from `git show` and contain code only.

| Candidate | Likelihood exact figure/window | Likelihood refused | Wrong figure/window | IMPACT fired/dropped | OTHER fired/dropped | AMBIGUOUS fired/dropped | Original correct preserved/lost | a0 correct preserved/lost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Original unqualified reader | 7 | 3 | 0/0 | 27/47 | 57/29 | 0/0 | 7/0 | 7/1 |
| a0 blocklist + fragment cue | 8 | 2 | 0/0 | 0/74 | 0/86 | 0/0 | 7/0 | 8/0 |
| **FIX1 strict allowlist** | **8** | **2** | **0/0** | **0/74** | **0/86** | **0/0** | **7/0** | **8/0** |
| FIX1 adjacency removed, any clause cue | 8 | 2 | 0/0 | 0/74 | 0/86 | 0/0 | 7/0 | 8/0 |

| Label | Original fire → new fire | Original fire → new drop | Original drop → new fire | Original drop → new drop |
| --- | ---: | ---: | ---: | ---: |
| LIKELIHOOD | 7 | 0 | 1 | 2 |
| IMPACT | 0 | 27 | 0 | 47 |
| OTHER | 0 | 57 | 0 | 29 |
| AMBIGUOUS | 0 | 0 | 0 | 0 |

For a0 → FIX1 the same cells are LIKELIHOOD `8/0/0/2`, IMPACT `0/0/0/74`, OTHER `0/0/0/86`, AMBIGUOUS `0/0/0/0`. Every original-base-correct likelihood and every a0-correct likelihood survives with exact bounds and horizon. All 84 original nonlikelihood false fires are dropped. The corpus alone cannot distinguish adjacency: the r1 regression rows and mutant do.

The committed **76 rows remain green**: five LIKELIHOOD rows yield four supported exact readings plus the existing documented refusal; all 31 IMPACT and 40 OTHER rows refuse. `corpus-labels.json` was not changed. The 170 real messages remain local only; the comparison TSV is outside the checkout. The script rejects an output path inside the repository, including symlink resolution. Repository reports contain only counts, hashes and row IDs.

**Final GREEN checks.** All invocations used the prescribed load gate, no more than two test files, one worker, no file parallelism and stdin `/dev/null`.

| Final run | Passed | Log |
| --- | ---: | --- |
| stated-event-risk + stated-event-risk-draft | 266 | `green-reader-draft-final.log` |
| event-risk-zero-treatment + event-risk-card-copy | 7 | `green-zero-card-final.log` |
| stated-event-risk-draft + agent-event-risk-door-seam | 43 | `green-draft-door-final.log` |

This is **295 unique tests across five files**, with draft checks repeated in the neighbour pair. The existing real `/agent/v1/turn` harness verifies impact card/commit omission and genuine likelihood card/commit retention. Source typecheck (`tsc -p tsconfig.build.json --noEmit`), targeted ESLint, script syntax and `git diff --check` pass. The temporary metadata payload issue was caught by card neighbours (3 assertion failures in `green-zero-card.log`) and resolved with the projection API before all final runs. This is local harness/source evidence with mocked external boundaries, not a served deployment witness.

**Mutation pair.** `run-mutants.mjs` drops adjacency only by adding an any-cue flag computed once per clause. Impact vetoes, parsing, alternatives, horizon and draft binding remain unchanged. The three r1 impact rows and their three no-window companions are **6/6 RED**; all **12/12 likelihood controls stay GREEN**, including the mixed 30%/10% case. Named rows and exact transforms are in `mutant-summary-fix1.json`. Mutated SHA256: `67f1641b5e401fe0470cbb4edec7bf4affe93f188464fd3c285a52d72e95e789`. Production bytes were restored in `finally`; restored SHA256 equals the final reader hash, corpus selected-source hash and timing source hash.

**Timing.** The existing 2k → 20k scaling assertions remain; each ratio is below 20. Standalone measurements warm up and record 30 calls at exactly 20,000 characters, without an absolute-time test assertion.

| Reader | Input | Scaling ratio | Median ms | Maximum ms |
| --- | --- | ---: | ---: | ---: |
| readStatedEventRisk | whitespace | 9.00 | 0.120 | 0.123 |
| readStatedLikelihoodWithoutWindow | whitespace | 8.91 | 0.110 | 0.113 |
| readStatedEventRisk | repeated `by 10% ` | 9.13 | 1.952 | 2.823 |
| readStatedLikelihoodWithoutWindow | repeated `by 10% ` | 10.81 | 1.860 | 2.194 |

Every measured call is below 50 ms; all existing 5k → 40k scaling rows also pass. Exact measurements are in `timing-fix1.json`.

**Judgement calls.** `The service could fail; I reckon 30% within 6 months` reads **0.3/6** because likelihood and window share the second clause. `Add a risk: 30% chance of an outage. Time window: within 6 months.` refuses as explicitly accepted. The brief's “preceding clause” wording cannot permit arbitrary semicolon context while also refusing its mandatory moved-window supplier fixture; preceding **comma** context is therefore retained and hard-boundary context excluded. The old `risk of churn is 7%` negative is now a positive because FIX1 expressly allows `risk of <event> is N%`; explicit churn-rate suffixes remain refused. Corpus-154 still refuses an unrelated goal window/calendar event window; corpus-165 retains the existing duplicate-window refusal. Neither is a base-correct likelihood regression.

**Changed files.** Production: `src/orchestrator-v5/routing/stated-event-risk.ts`, `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts`. Tests: their two co-located test files. Evidence: this report and `compare-corpus.ts`, `run-mutants.mjs`, `measure-timing.ts`. Independent read-only source review approved the final bounded implementation after the alternative guard correction.

Reproduce from this worktree (each script also checks load internally):

```sh
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && pnpm exec vitest run src/orchestrator-v5/routing/__tests__/stated-event-risk.test.ts src/orchestrator-v5/agent-lane/__tests__/stated-event-risk-draft.test.ts --configLoader runner --maxWorkers=1 --no-file-parallelism < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && pnpm exec vitest run src/orchestrator-v5/agent-lane/__tests__/event-risk-zero-treatment.test.ts src/orchestrator-v5/agent-lane/__tests__/event-risk-card-copy.test.ts --configLoader runner --maxWorkers=1 --no-file-parallelism < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && pnpm exec vitest run src/orchestrator-v5/agent-lane/__tests__/stated-event-risk-draft.test.ts src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts --configLoader runner --maxWorkers=1 --no-file-parallelism < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node --import tsx acceptance-evidence/impact-pct/compare-corpus.ts --candidate /private/tmp/impact-pct-fix1-evidence/any-cue-candidate.ts --candidate-name any_cue_in_clause < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node acceptance-evidence/impact-pct/run-mutants.mjs < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node --import tsx acceptance-evidence/impact-pct/measure-timing.ts < /dev/null
```

## Author additions after FIX-1 (Claude, EVENT-RISK)
- CI at a0a6ba70 failed `held-proposal-user-in-control-seam` P53-gmh-1: "It may happen 10–30% in the next 6 months." is a real likelihood (it is the card's own wording). The attached form now accepts "(may|might|could) happen[,:]? [about] N%". Rows `may-happen-card-words` and `might-happen-colon` added.
- Regression caught in review of FIX-1: "The risk of churn is 7% within 6 months." had become a 7% likelihood. It states a churn RATE, and the base refused it. "risk" is removed from the "<word> of/that … is N%" event bridge, while "N% risk" stays direct. Rows `fix1-risk-of-metric-is-not-a-likelihood` ×2.
- Neighbours green: stated-event-risk + held-proposal seam 273; draft + door seam 43; zero-treatment + card-copy 7.
- The scripts (compare-corpus.ts, run-mutants.mjs, measure-timing.ts) are kept in the lane evidence folder, not the repo.

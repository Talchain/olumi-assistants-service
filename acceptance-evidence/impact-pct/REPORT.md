**EVENT-RISK impact percentage lease — completed in the working tree, 8 October 2026.**

Base: `b4a3a18ce386945dd73b66dee3ea3f1ed16b3572`, branch `dl/event-risk-impact-pct`, worktree `/private/tmp/accel-er-impact-cee`.
Final production source SHA256: `09ff2113e24c5337ecb309cc2ab16c105d1025af05a55ce69f949b6191425319`.
No commit, push, branch switch, or deployment. The initial worktree was clean. This is local source, corpus, and real-route harness evidence with mocked model/network/store boundaries.

Both readers now share percentage classification. A direct `by [modifier] N%`, impact noun/predicative suffix, metric/share suffix, or nearby impact-verb object rejects the percentage. Remaining percentages need a likelihood cue in their comma/sentence fragment, a direct probability attachment, or the bounded `<event> might/could happen, N%` form. Explicit `N% chance` and `probability N%` can identify an event involving a verb such as “cut”; direct impact attachments still win. One-in-N retains its existing cued, bounded parser. Confirmed impact candidates are removed before uniqueness; uncued non-impact alternatives remain ambiguous.

All new regex quantifiers are bounded. Fragment cues are computed once, match traversal is monotone, and attachment scans use at most 160 characters per side. Decimal punctuation stays within numeric tokens. This avoids rescanning an entire clause for each occurrence in repeated `by 10% ` text.

**Independent corpus measurement.** Labels were assigned by reading the 170 verbatim supplied messages before executing any reader. `compare-corpus.ts` verifies exact messages and row identities against the supplied corpus. The frozen base snapshot changes only relative import paths. The impact-only candidate changes only the selected reader's final likelihood-cue gate; all attachment, numeric and window rules remain identical. Its exact transform and source hashes are retained in `corpus-design-summary.json`.

| Candidate design | LIKELIHOOD correct figure + window | LIKELIHOOD refused | Wrong figure/window | IMPACT fired / dropped | OTHER fired / dropped | AMBIGUOUS fired / dropped | Base-correct likelihood preserved / lost | Base false fires dropped / retained |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Base, unqualified percentage | 7 | 3 | 0 / 0 | 27 / 47 | 57 / 29 | 0 / 0 | 7 / 0 | 0 / 84 |
| Impact attachment blocklist only | 8 | 2 | 0 / 0 | 8 / 66 | 41 / 45 | 0 / 0 | 7 / 0 | 43 / 41 |
| **Impact precedence + likelihood allowlist (selected)** | **8** | **2** | **0 / 0** | **0 / 74** | **0 / 86** | **0 / 0** | **7 / 0** | **84 / 0** |

Label totals: LIKELIHOOD 10, IMPACT 74, OTHER 86, AMBIGUOUS 0. The selected design preserves every correctly read base likelihood and drops every base fire labelled otherwise. The blocklist alone leaves 49 non-likelihood occurrences, including 41 retained base false fires, so it is insufficient.

| Independent label | Base fires → new fires | Base fires → new drops | Base drops → new fires | Base drops → new drops |
| --- | ---: | ---: | ---: | ---: |
| LIKELIHOOD | 7 | 0 | 1 | 2 |
| IMPACT | 0 | 27 | 0 | 47 |
| OTHER | 0 | 57 | 0 | 29 |
| AMBIGUOUS | 0 | 0 | 0 | 0 |

`corpus-comparison.tsv` contains every message, base/new occurrence, independent label/reason, alternative occurrence, all windows, gold likelihood figure/window, and mixed-row judgement.

**Rows and RED-first evidence.** Before editing production, the two permitted files ran with `-t impact-pct`. `red-base.log` records **22 failed, 6 passed, 115 skipped**: 19 impact negatives, two mixed likelihood/impact failures, and the impact door falsely displaying `It may happen: about 10% within 6 months, as you said.` The genuine corpus likelihood door passed on base. This was an actual reader/card assertion failure, not a startup failure.

The final unit file includes all 170 independent corpus expectations, verbatim served impact and likelihood messages, all three defect sentences, singular/plural/fronted/predicative/noun forms, approximate/range `by` forms, impact verbs, misplaced cues, rates and revenue shares, cued impact controls, direct likelihood attachments, one-in-N, and mixed sentences in both orders. It also verifies both readers on no-window impact forms and mixed likelihood/impact input. The final door file proves card/chip parity, unchanged graph before approval, one graph write through approval, no held/stored `event_risk` for an impact, and the exact stored likelihood for the served control. A third door covers ambiguous bare percentage shorthand.

The complete final run passed **335/335 tests across exactly two files**, one worker, no file parallelism, stdin `/dev/null`; see `green.log`. Targeted ESLint passed, and `git diff --check` passed. Every test invocation used the prescribed Node load gate first. The initial Vite bundled-config startup attempted to write through the shared read-only `node_modules` link; `--configLoader runner` resolved this without changing dependencies. Its failed startup log is separate from RED evidence.

Reproduction:

```sh
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && pnpm exec vitest run src/orchestrator-v5/routing/__tests__/stated-event-risk.test.ts src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts --configLoader runner --maxWorkers=1 --no-file-parallelism < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node --import tsx acceptance-evidence/impact-pct/compare-corpus.ts < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node acceptance-evidence/impact-pct/run-mutants.mjs < /dev/null
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node --import tsx acceptance-evidence/impact-pct/measure-timing.ts < /dev/null
```

**Timing.** Assertions compare 2,000 with 20,000 characters using the existing calibrated minimum-of-seven-batches helper and require a ratio below 20. There is no absolute millisecond test assertion. The standalone timing script additionally records 30 single calls after warm-up at exactly 20,000 characters.

| Reader | Input | Test scaling ratio (20k / 2k) | Standalone median ms | Standalone maximum ms |
| --- | --- | ---: | ---: | ---: |
| `readStatedEventRisk` | whitespace | 8.37 | 0.147 | 0.696 |
| `readStatedLikelihoodWithoutWindow` | whitespace | 9.31 | 0.132 | 0.250 |
| `readStatedEventRisk` | repeated `by 10% ` | 11.03 | 1.625 | 2.699 |
| `readStatedLikelihoodWithoutWindow` | repeated `by 10% ` | 8.88 | 1.298 | 3.255 |

Every measured 20k call was below 50 ms. Exact values are in `timing.json`; calibrated test timings are in `green.log`.

**Mutants.** `run-mutants.mjs` runs only the same two files, gates each invocation, and restores production in `finally`. Its pair selects the impact negatives and nine single-likelihood controls plus the real corpus likelihood door. Mixed rows are excluded from this pair because removing impact discrimination also makes mixed selection ambiguous; mixed rows are covered by the full suite and corpus.

| Mutation | Impact/uncued rows RED | Likelihood controls GREEN | Other selected rows GREEN |
| --- | ---: | ---: | ---: |
| Disable the shared classification selector; use raw base probability matches | 28 | 10 / 10 | 0 |
| Disable only direct impact attachment rejection | 2 | 10 / 10 | 26 |

The narrower mutant fails `cue-is-impact` and `cued-share-mrr`; the allowlist alone still protects uncued impacts. Mutation logs and `mutant-summary.json` record named failures, source hashes and outcomes. The restored source hash equals both the green-run source and the corpus source hash.

**Judgement calls and limits.**

- Bare `% + window` is insufficient evidence of user likelihood. Existing synthetic numeric/parser and door fixtures now include an explicit “maybe”; their numeric/card/quote/hash expectations remain intact. Every served message remains verbatim, and negative unit/door rows cover the bare shorthand. The bounded explicit “might/could happen, N%” pattern remains supported.
- Weak “risk of” alone is insufficient for a metric percentage such as `risk of 7% monthly churn`. Direct `N% risk of an outage` remains supported.
- Mixed corpus-087 correctly reads **30% within 18 months**, dropping the **20 percent annual revenue growth** impact. A bare unsupported `in year` match inside `cost ... in year one` is filtered before window uniqueness; it was already rejected as an actual duration by the existing reader.
- Corpus-154 still refuses: its 30% event likelihood is stated “this year,” while the parseable nine-month window belongs to a separate revenue goal. Sentence binding prevents a false nine-month attribution; the 40% revenue share is never read as likelihood.
- Corpus-165 still refuses under the existing exact-one-window contract: goal and event each state six months. Duplicate-window resolution and calendar-window support remain outside this lease. Consequently, the result is **8 of 10 labelled likelihoods read, all 7 base-correct preserved**, not a claim that all ten are supported.
- This verifies the local real-route add-risk journey through card/held state/approval/committed graph using the existing harness. It is not a live staging deployment witness.

**Changed files.** Production: `src/orchestrator-v5/routing/stated-event-risk.ts`. Tests: `src/orchestrator-v5/routing/__tests__/stated-event-risk.test.ts` and `src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts`. Evidence: this report, base reader snapshot, independent labels, standalone corpus/timing/mutation scripts, comparison TSV, design summaries, timing JSON, and execution logs under `acceptance-evidence/impact-pct/`.

An independent read-only review approved the bounded source at the final SHA256 above, including the two explicit corpus refusals.

## Author verification (Claude, EVENT-RISK)
- Spot-checked the labels: all 10 LIKELIHOOD rows are "might …, maybe N% in the next M months" or "I'd put it at N% within M months".
- Neighbour sweep (files Codex didn't run): 6 failures. Five used a bare "10–30% within 6 months" only as a HELPER to build an event_risk; their inputs now carry "maybe", and every assertion string is unchanged. `2c-decimal-sentence` now uses a cued input. The new `2c-bare-percent-refused` records that the drafter's uncued "<event>: N% within M months" holds no likelihood (fail closed, as briefed).
- The scripts and logs (compare-corpus.ts, run-mutants.mjs, measure-timing.ts, base snapshot, *.log) are kept in the lane evidence folder, not the repo.
- **Privacy:** v5_conversation_turns is shared with PRODUCTION. Only the 76 corpus messages traced to our own witness runners, fixtures or briefs are committed (corpus-labels.json: 31 IMPACT, 40 OTHER, 5 LIKELIHOOD). The full 170-row labels and comparison TSV stay in the lane evidence folder, outside git. Two unattributed "Set the success target…" rows are replaced with authored paraphrases of the same form.

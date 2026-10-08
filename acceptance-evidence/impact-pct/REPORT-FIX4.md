FIX4 completed for #2828 in the working tree at 10:52:43Z, before 12:15Z. The reader now attributes a percentage only through an attached, allowlisted likelihood word. Hedge-only, estimate-only and happen-only forms hold no likelihood. The existing no-likelihood card applies; no new ask machinery was added.

Worktree: `/private/tmp/accel-er-impact-cee`; branch: `dl/event-risk-impact-pct`; unchanged HEAD: `1ac3e2e1d166b334e3a06593493b848e9108b057`. No commit, push, branch switch, deployment or Supabase edit. Read the whole `BRIEF-FIX4.md` and `review-2828-r3-independent.md` before changing production.

**Changes and boundaries.**

- Removed `HEDGE_BEFORE`, `ESTIMATE_BEFORE`, `BARE_EVENT` and `WINDOW_NEXT` as likelihood sources. Hedge/estimate words remaining in the scaffold scanner provide context only; an explicit attached likelihood word still supplies the source.
- Percentage suffixes accept chance, likely/likelihood, probability, odds, and `risk of/that`. Bare risk and probable refuse. A preceding chance/odds/probability/likelihood needs a numeric bridge; `with [a] probability [of] N%` is supported. An unbridged noun, including both odds-change verbs N5/N6, refuses. `risk of/that <event> is N%` supplies no source.
- Preserved `FIGURE_TAIL`, the impact vetoes, cued one-in-N and the window rules. `of` works as a direct noun bridge (`odds of 30%`). After an event, trailing `of N%` retains the existing amount refusal: accepting that bridge reopened review-24/review-26 in the first check (406 passed, 2 failed), so the final event bridge adds `are` to the prior `is|at|=|:` boundary. This preserves the existing impact class without adding any noun/verb patch list. Evidence: [interim check](interim-check-fix4.json).
- The contraction scaffold scanner is shared code in `routing/stated-event-risk.ts`, rather than in the drafter source. It now accepts straight/curly apostrophe `s` and `there’s`, `it’s`, `that’s`; the drafter source is unchanged.
- Neighbour helper inputs now use explicit chance phrasing with the same figures. `chance is N%` preserves existing quote assertions. All helper assertions stay unchanged. Two further helper dependants, build-reply and route-once, were also updated and run.

Final reader SHA-256: `e0aa8d4b639ff3e593d2e5f68b69bc21f0beceeec12ee50db97bc13d5db69e70`.
Drafter SHA-256: `b5c25d03d5819776487189228fc97006b9d8c38883ce8421c515fce1299d460e`.

**RED first, then final verification.**

At 10:36:16Z, load 19.15, unchanged production matched the committed reader `e11f36d8…` and drafter `b5c25d03…`. The new 57-row regression file produced 22 RED / 35 GREEN, including N1–N3, N14, N5/N6, F11 and D2. Six earlier load-gate rejections ran no tests. [RED evidence](red-summary-fix4.json) pins the full hashes, command, failures and raw-result digest.

Final checks: **510 passed, zero failed, zero skipped** across nine files:

| Run | Files | Passed |
|---|---|---:|
| Reader | stated-event-risk; stated-event-risk-fix4 | 408 |
| Drafter / door | stated-event-risk-draft; agent-event-risk-door-seam | 61 |
| Card / zero | event-risk-card-copy; event-risk-zero-treatment | 7 |
| Held / build | held-proposal-user-in-control-seam; event-risk-build-reply.route | 31 |
| Route once | event-risk-route-once-join | 3 |

Every test/replay/timing/mutant run used the prescribed load gate below 25, serial execution and `/dev/null` stdin. Vitest used at most two files, one worker, no file parallelism, `--configLoader=runner --cache=false`. ESLint passed in five two-file batches; source typecheck (`--noEmit --incremental false`) and `git diff --check` passed. The tsx CLI encountered a sandbox IPC-pipe error before running a replay; `node --import tsx` ran the evidence scripts successfully without an IPC server. [Verification summary](test-summary-fix4.json) contains commands, per-file counts, starting loads, checks and raw-result digests.

All required refusal rows pass, including both supplied estimate/developer strings. F1, F5, F7, F8, F9, F10, F11 and F12 read their exact probability and horizon. Every additional required read control passes: with probability 10%/6 months, 10% chance/6 months, 1 in 10/year, chance-of-supplier colon 20%/6 months, 30 percent probability/6 months and 30% likely/6 months. D2 holds Supplier fails at 0.3/6; D6 and D7 hold nothing. Straight/curly contraction controls pass too.

**Every existing expectation flipped to REFUSE.**

The following 44 fixture/test expectations were changed; the original user input strings are preserved. Each refusal expectation has the required `DL ruling 8 Oct: explicit likelihood words only` comment, or the corpus’s exact reason `DL ruling 8 Oct`. [Complete row inventory](flipped-rows-fix4.json).

| Source / former family | Every flipped row |
|---|---|
| stated-event-risk.test / 2a-positive | range, single, between-percent, hyphen, to, both-percent, weeks, week-minimum, zero, hundred, decimal |
| stated-event-risk.test / r2-plain-likelihood | probable |
| stated-event-risk.test / fix1-must-still-read | percent-risk, reckon-after-semicolon, maybe-range, put-it-at-range, may-happen-card-words, might-happen-colon |
| stated-event-risk.test / impact-pct-must-still-read | served-developer, served-competitor, bare-event, put-it-at |
| stated-event-risk.test / said-door-likelihood-without-window | percent-only, range-only, put-it-at |
| review-rows-fix3 / readerRows | review-44, review-45, review-59, review-63, review-64, review-65, review-66, review-67, review-72, review-74 |
| review-rows-fix3 / noWindowRows | no-window-09 |
| review-rows-fix3 / draftRows | must-fire-key-developer, must-fire-supplier-probable |
| corpus-labels / LIKELIHOOD | corpus-002, corpus-005, corpus-078, corpus-079 |
| stated-event-risk-draft.test | 2c-decimal-sentence |
| agent-event-risk-door-seam.test | impact-pct-door-corpus-likelihood |

The exclusions also cover no-bridge `chance between`, probable, and risk without `of/that`, as the literal allowlist requires. Six separate explicit-chance numeric controls retain coverage of between-percent, weeks/minimum duration, zero, hundred and decimals. In the new r3 fixture, F2/F4/F6 and D4 expect refusal under the ruling. F3 remains the pre-existing unsupported one-in-N refusal. `review-47` changes separately from accepted refusal to READ because `odds are about 20%` now has the allowed `are` bridge.

**Base / r3 / new cells.**

Base is `b4a3a18ce386945dd73b66dee3ea3f1ed16b3572`; r3 is `1ac3e2e1d166b334e3a06593493b848e9108b057`; new is the final working-source hash above. These counts apply the revised DL expectations consistently to all three versions; an unexpected old read includes a source intentionally retired by this ruling.

| Dataset | Version | Exact reads | Expected refusals | Unexpected reads | Missed supported reads | Wrong values |
|---|---|---:|---:|---:|---:|---:|
| 170 local | Base | 0 | 78 | 91 | 1 | 0 |
| 170 local | r3 | 1 | 162 | 7 | 0 | 0 |
| 170 local | New | 1 | 169 | 0 | 0 | 0 |
| 75 battery | Base | 19 | 1 | 49 | 6 | 0 |
| 75 battery | r3 | 24 | 40 | 10 | 1 | 0 |
| 75 battery | New | 25 | 50 | 0 | 0 | 0 |
| 26 new r3 | Base | 7 | 1 | 17 | 1 | 0 |
| 26 new r3 | r3 | 7 | 9 | 9 | 1 | 0 |
| 26 new r3 | New | 8 | 18 | 0 | 0 | 0 |

New reader total: **170/170 local and 101/101 battery match the revised expectations**. No base-correct likelihood that remains supported by the ruling was lost. All 76 committed corpus rows pass in the unit suite.

The private 170-row corpus remains local. Its overlay refuses corpus-001, 002, 003, 004, 005, 078, 079 and 165 with reason `DL ruling 8 Oct`; corpus-165 was already refused for multiple windows. Under original labels, r3 read eight local likelihood rows; new reads one. The seven retired reads are explicitly disclosed rather than presented as retained capability. Original-expectation cells and all safe ID/hash/result cells are in [corpus comparison](corpus-comparison-fix4.json); real message text is confined to `/private/tmp/impact-pct-fix4-served-comparison.tsv`.

The reviewer’s eight rendered r2 tables contain 74 reader rows. As in the existing comparison, the first explicit P2-2 boundary finding supplies row 75; the other boundary finding is separately executed. The r3 set contains exactly 14 N + 12 F rows. Both sets retain their original input strings. Ten no-window rows also match their new expectations.

Drafter comparison: 21/22 match the scoped expectations. **D1 remains a known, unchanged residual**: “If the supplier fails a release slip is 30% likely within 6 months.” still binds Supplier fails at 0.3/6 on base, r3 and new. This is r3 P2-c, outside the requested FIX4 class/scaffold work. The report makes no whole-drafter or product acceptance claim.

**Timing and mutant.**

[Timing regenerated on final source](timing-fix4.json): 23 patterns × three entry points × 20k/160k characters, seven measured batches each (138 measurements, 69 scaling pairs). All minimum scaling ratios are below 20. Worst is **11.2639** for the contraction scaffold through `readStatedEventRisk`; corresponding median ratio is 10.7545. Required 20k whitespace/by-percent worst median is 1.7190 ms. Reader, drafter and runtime dependency hashes are recorded and match the final files.

[Hedge mutant](mutant-summary-fix4.json): re-added only the pinned r3 hedge source in scratch modules. **N1, N2 and N3 turn RED**; nine refusal rows kill the mutant in total. All **39/39 must-fire controls stay GREEN**, and the unmutated controls have zero failures. Production files were never modified by the mutation run.

Scripts (*-fix4.ts) are kept in the lane evidence folder (scripts-fix4/), not the repo. Author re-ran the neighbours: reader + fix4 408; draft + door seam 61; held-proposal + build-reply route 31; card-copy + zero-treatment 7; route-once-join + s-e-goals-s2b 89. Privacy: committed corpus ids are all runner-attributed, and no unattributed served text is in any committed file.

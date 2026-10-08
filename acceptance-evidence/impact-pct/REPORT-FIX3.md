FIX3 completed for #2828: percentages now require a supported likelihood attachment on both sides, so shares, impact amounts, compound modifiers and likelihood deltas cannot become user-stated occurrence claims. The card and draft share clause boundaries, and a draft cannot borrow a preceding event name when its own figure fragment names another event.

Worktree: `/private/tmp/accel-er-impact-cee`; branch: `dl/event-risk-impact-pct`; unchanged HEAD: `8436239ff7829a83ccd6d43c6b8855c6e2053c8a`. Production edits are uncommitted. No commit, push, branch switch, deployment, LLM call or external mutation was performed. The brief's repeated working-tree-only instruction governs its conflicting P2-7 “commit” wording.

Read whole: `BRIEF-FIX3.md`, `review-2828-r2-independent.md`, `BRIEF.md`, `BRIEF-FIX1.md` and `codex-review-r1.out`. All tests/replays/timing/mutation runs were load-gated below 25, serial, with stdin from `/dev/null`; Vitest used no more than two files and one worker. Initial load-gate failures ran no tests. Vite's bundled config could not write through the shared `node_modules` symlink; `--configLoader=runner --cache=false` resolved that setup failure without changing repository config.

**Changes and judgement calls.**

- `FIGURE_TAIL`, `TAIL_WORD` and sticky `HORIZON_HEAD` follow the reviewer prototype for every percent candidate. Unknown tails fail closed. The likelihood suffix refuses ASCII hyphen, en dash and em dash compounds, and must have a supported tail token.

- `EVENT_BRIDGE` supports `is`, `at`, `:` and `=`; it excludes `of`. A `that` complement must contain a supported event predicate before the numeric bridge; this is an unconditional veto, so another adjacent cue cannot bypass it. Nominal `of an outage is N%`, colon/equality labels and `of losing … is N%` remain supported. The distinction preserves the review's base-correct nominal controls while refusing the rate “chance that churn is 10%”. Unsupported predicates remain fail closed.

- A governing change verb rejects likelihood deltas even when a likelihood cue is adjacent. Bounded fillers exclude `with` and conjunctions, preserving “cut its prices with probability 10%”. Both readers use the same classifier.

- Only both dots of `e.g.` and `i.e.` are exempt from hard boundaries; `etc.` and `vs.` cannot lend the next clause's window. The drafter uses the reader's exported splitter.

- Preceding comma context is allowed only when the figure fragment has no event words after stripping its figure, supported window and explicit likelihood scaffolding. A deterministic sticky token scanner checks membership, with a 320-character fragment cap and 24-word cap. Unknown or longer fragments bind only their own fragment. The existing named-risk ambiguity check remains.

- Independent source review found overlapping whitespace repetition in an initial scaffold regex. It was replaced by disjoint, consuming tokens before final validation; late-failure binding and scaling rows were added. Final static verdict: APPROVE.

**Rows and RED evidence.**

The review says 75 battery rows, but its eight reader tables contain exactly 74 (10+7+6+7+8+4+23+9). `review-rows-fix3.json` preserves all 74 table inputs verbatim, stores parenthetical review annotations separately, and adds the explicit P2-2 `etc.` finding as battery row 75. The second `vs.` finding is an extra boundary row. It also supplies all eight P1-4 false no-window rows and two true controls, plus 15 draft rows covering conditional other-event ×2, e.g./i.e., dip/share/event-form/risk-reduction refusals, comma ambiguity and held controls. Three additional cue/compound controls and three scanner safety rows are in the two tests.

Before any production edit, the 104 FIX3 review/control cases at `8436239f` were **52 RED / 52 GREEN**: 44 reader/no-window/compound failures and 8 draft failures. The other 277 tests were skipped in this filtered RED run. `red-summary-fix3.json` pins the production hashes, command and failed case names; the raw runner JSON/log remain in `/private/tmp/`. The three scanner safety rows were added after the independent performance finding.

**Base / r2 / working comparison, every cell.**

The comparison loads exact git-show reader/drafter snapshots for base `b4a3a18ce386945dd73b66dee3ea3f1ed16b3572` and r2 `8436239ff7829a83ccd6d43c6b8855c6e2053c8a`, and the FIX3 working bytes. Nine transitive runtime dependencies were checked identical at both historical SHAs. Both local corpus files contain the same 170 turns in order. No served messages were copied into the repo: outcomes contain IDs, labels, exact values and message digests; the private TSV is `/private/tmp/impact-pct-fix3-served-comparison.tsv`.

Each cell is **C / R / U / M / W**: exact supported likelihood read / correct refusal / unexpected read under the FIX3 expected grammar / missed supported read / wrong value or binding. Accepted word-form likelihood refusals have null expectations, so a historical read appears as U in those rows; this does not assert that the user's word-form likelihood was an impact. Explicit zero-label cells are shown.

| Dataset | Entry point | Label | Base | r2 | FIX3 |
|---|---|---|---|---|---|
| served170 | readStatedEventRisk | LIKELIHOOD | 7/0/0/3/0 | 8/0/0/2/0 | 8/0/0/2/0 |
| served170 | readStatedEventRisk | IMPACT | 0/47/27/0/0 | 0/74/0/0/0 | 0/74/0/0/0 |
| served170 | readStatedEventRisk | OTHER | 0/29/57/0/0 | 0/86/0/0/0 | 0/86/0/0/0 |
| served170 | readStatedEventRisk | AMBIGUOUS | 0/0/0/0/0 | 0/0/0/0/0 | 0/0/0/0/0 |
| served170 | readStatedLikelihoodWithoutWindow | LIKELIHOOD | 0/10/0/0/0 | 0/10/0/0/0 | 0/10/0/0/0 |
| served170 | readStatedLikelihoodWithoutWindow | IMPACT | 0/74/0/0/0 | 0/74/0/0/0 | 0/74/0/0/0 |
| served170 | readStatedLikelihoodWithoutWindow | OTHER | 0/86/0/0/0 | 0/86/0/0/0 | 0/86/0/0/0 |
| served170 | readStatedLikelihoodWithoutWindow | AMBIGUOUS | 0/0/0/0/0 | 0/0/0/0/0 | 0/0/0/0/0 |
| reviewBattery75 | readStatedEventRisk | IMPACT | 0/0/37/0/0 | 0/8/29/0/0 | 0/37/0/0/0 |
| reviewBattery75 | readStatedEventRisk | AMBIGUOUS | 0/0/2/0/0 | 0/1/1/0/0 | 0/2/0/0/0 |
| reviewBattery75 | readStatedEventRisk | LIKELIHOOD | 28/1/1/6/0 | 30/2/0/4/0 | 34/2/0/0/0 |
| reviewExtraBoundary | readStatedEventRisk | AMBIGUOUS | 0/0/1/0/0 | 0/0/1/0/0 | 0/1/0/0/0 |
| reviewNoWindow | readStatedLikelihoodWithoutWindow | IMPACT | 0/8/0/0/0 | 0/0/8/0/0 | 0/8/0/0/0 |
| reviewNoWindow | readStatedLikelihoodWithoutWindow | LIKELIHOOD | 2/0/0/0/0 | 2/0/0/0/0 | 2/0/0/0/0 |
| reviewDraft | holdStatedEventRisks | MUST_NOT_HOLD | 0/3/6/0/0 | 0/3/6/0/0 | 0/9/0/0/0 |
| reviewDraft | holdStatedEventRisks | LIKELIHOOD | 3/0/0/3/0 | 4/0/0/2/0 | 6/0/0/0/0 |


All **35 supported base-correct likelihoods** across served and review datasets retain exact probability bounds and horizons; **zero lost**. FIX3 reads all 34 supported review likelihoods and correctly refuses the other 41 battery rows. The extra boundary, all 10 no-window and all 15 draft rows match their expected cells. The committed 76-row fixture remains GREEN.

Accepted refusals: `Odds are about 20% within a year` and word-form `one in five` stay refused as directed, as does the mixed hyphenated word-form one-in-five row. In the served set, `corpus-154` uses unsupported “this year” while its separate goal window belongs to another clause; `corpus-165` contains two windows. Both retain the independently labelled accepted refusal (`expectedReaderEventRisk: null`), unchanged from r2. They are the two M cells in the coarse served label comparison; neither loses a supported base-correct read.

**GREEN neighbours and checks.**

| File | Passed | Failed |
|---|---:|---:|
| `stated-event-risk.test.ts` | 345 | 0 |
| `stated-event-risk-draft.test.ts` | 39 | 0 |
| `agent-event-risk-door-seam.test.ts` | 22 | 0 |
| `held-proposal-user-in-control-seam.test.ts` | 25 | 0 |
| `event-risk-card-copy.test.ts` | 4 | 0 |
| `event-risk-zero-treatment.test.ts` | 3 | 0 |


**438/438** tests passed in three two-file runs, including 384 reader/draft tests. Targeted ESLint, build-source TypeScript (`--noEmit --incremental false`) and `git diff --check` passed. `test-summary-fix3.json` pins the final source hashes, each runner JSON digest and per-file counts.

**Timing at the working source.**

`timing-fix3.json` records all 13 review patterns plus scanner late failure × three entry points × 20k/160k characters × seven measured batches after warmup (84 measurements, 588 measured calls). Worst minimum growth ratio: **10.594×** for 8× input; worst median ratio **9.496×**. Every scaling row is below 20. The required whitespace/by-percent 20k worst median is **2.452 ms**; their maximum individual sample is **3.555 ms**, below 50 ms. The test suite also checks 2k→20k scaling, including late failure, with ratio bars rather than absolute timing bars.

**Mutation.**

`run-mutants-fix3.ts` removes only `if (!FIGURE_TAIL.test(after)) continue;` in a scratch source snapshot. All **42/42 incumbent r2 must-fire controls remain GREEN**; **5 share rows and 5 dip/decrease/shortfall/slump rows turn RED**; **18 unexpected impact reads** return in total. Production bytes were never changed. Controls are parsed from the pinned r2 test source with TypeScript AST; served control text is represented only by digests in evidence.

All 34 new review must-fire outcomes are reported separately: 32 remain GREEN under the mutant. The two newly repaired mixed-dip rows (`review-09`, `review-10`) become ambiguous when the mutant re-admits the impact's 10% alongside the genuine 20%; they correctly turn RED too. Thus the required discriminating pair uses the reviewer's incumbent 42 controls, and the dependent new mixed rows are disclosed rather than hidden. `mutant-summary-fix3.json` records the original and mutant hashes, exact transform and every row outcome.

**Source identity and historical evidence.**

- `src/orchestrator-v5/routing/stated-event-risk.ts`: SHA256 `e11f36d89804ca5a2f4a7264d6434f7b3417fc37c829a536763945cc303fb599`.

- `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts`: SHA256 `b5c25d03d5819776487189228fc97006b9d8c38883ce8421c515fce1299d460e`.


Comparison, timing and mutant artifacts were checked against these same current production hashes. They record unchanged HEAD plus explicit “uncommitted working tree” state, so the changed code is not presented as committed at r2. Earlier timing, mutant and design JSON files are labelled with a0a6ba70 and reader hash `09ff2113…`; `historical-provenance-fix3.json` labels the remaining older files and their exact last-modified identities.

**Outside the lease.** P2-8 remains unchanged: `propose_new_risk` reads the whole turn without risk-name binding, so a separately stated supplier likelihood can still reach a proposed Release slips card. This is pre-existing at base; no agent-capabilities change was made.

**Files.** Production: the reader and drafter. Tests: their two co-located files. Evidence: this report, review fixture, comparison/utils/timing/mutant scripts, final comparison/timing/mutant JSON, RED/test summaries and historical provenance labels. No raw 170-turn corpus was added.

Scripts (compare-corpus-fix3.ts, evidence-utils-fix3.ts, measure-timing-fix3.ts, run-mutants-fix3.ts) are kept in the lane evidence folder (scripts-fix3/), not the repo. Author re-ran the neighbours: reader + drafter 384; held-proposal + door seam 47; zero-treatment + card-copy 7.

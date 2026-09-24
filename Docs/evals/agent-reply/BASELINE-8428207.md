# Agent-reply baseline — served build `8428207`

Deterministic scoring of CAPTURED Agent-lane replies (`/proxy/v5/turn` → `agent_lane_v1`). No model was called to produce this report.
Three things are reported separately and must not be conflated: **authored tests** (the scorer’s own self-tests), **matched model outputs** (none here — see the FP3 replay, prepared but not run), and **served behaviour** (these captures).

## Verdict (current build only)

- **Leader honesty:** 4 of 19 scored turns with `leader_claim.permitted=false` name an option as leading. Of the 4 that report an analysis result, 4 do; of the other 15 (build, approval, edit, blocked-run and similar turns), 0 do. Findings sit in the model text.
- **Promised run on approval:** 3 replies promise that approving will run the comparison and the next captured approval in that conversation ran nothing (FAIL); 2 more could not be checked (no later approval captured). Other action-truth FAILs: 0.
- **Length:** 16 of 17 replies with model-written text exceed ~90 model words (ESTIMATE). Median model words: build turns 189, turns that ran an analysis 169.
- **Caveats:** owed on 8 turns, missing on 0. **Controls:** 0 replies name a control that was not shown (0 NOT_DECIDABLE); contrast control — 66 control-vocabulary hits in prose across 59 of 115 scored replies (all builds), so the probe had material to see.
- **Option names:** 3 replies quote an option under a name that is not its label. **Units:** 1 reply quotes a model figure without its unit. **Provenance wording:** NOT_DECIDABLE on 21 of 22 (see below).
- **Served behaviour, not wording:** 1 approval/edit turn ran the analysis (`c19w-8428207` W2 approve in words).
- **Sample size:** 22 scored turns on this build, 1–4 per class — a baseline to compare against, not a rate estimate.

## Captures scored

Source: `CAPTURES_DIR` = the construction-witness `raw/` directory of the 23–24 Sep acceptance-witness runs (local evidence outside this repository). Default selection (no `--include`): c19, c19w, c16, c17, c18 and every held-out `g*` capture; the directory’s earlier `c*` captures are not scored. Build = the served CEE `/healthz` build recorded by the witness in `<label>-summary.json`; “same build” = the witness saw no deploy during the run.

| Capture | Build | Same build throughout | Scenarios | Turns |
|---|---|---|---|---:|
| `c19-8428207` | `8428207` | yes | A B D E O | 20 |
| `c19w-8428207` | `8428207` | yes | W | 2 |
| `c16-fd312b5` | `fd312b5` | yes | A B D E O | 21 |
| `c17-84a765e` | `84a765e` | yes | A B D E O | 21 |
| `c18-389051f` | `389051f` | yes | A B D E O | 20 |
| `g-buildbuy-778f1fd` | `778f1fd` | yes | G | 3 |
| `g-cdp-778f1fd` | `778f1fd` | yes | G | 3 |
| `g-fourday-c6393cf` | `c6393cf` | yes | G | 3 |
| `g-market-778f1fd` | `778f1fd` | yes | G | 3 |
| `g-seed-c6393cf` | `c6393cf` | yes | G | 3 |
| `g10-0415b19` | `0415b19` | yes | G | 3 |
| `g11-0415b19` | `0415b19` | yes | G | 3 |
| `g6-6dfb56f` | `6dfb56f` | yes | G | 1 |
| `g7-6dfb56f` | `6dfb56f` | yes | G | 3 |
| `g8-6dfb56f` | `6dfb56f` | yes | G | 3 |
| `g9-6dfb56f` | `6dfb56f` | yes | G | 3 |

Scenario letters are the witness’s: A/D/E/O send the hiring brief, B/W the pricing brief, G one held-out brief per capture.

## Current build `8428207`

22 turns.

### Length, questions, status line, chips

| Class | n | Median words (final) | p90 words (final) | Over ~90 words (final) | Median model words (EST.) | Over ~90 (model EST.) | Server status/disclosure present | >1 question (final) | >1 question (model EST.) | Turns with ≥1 chip |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| build_hiring | 4 | 281 | 352 | 100% (4) | 215 | 100% (4) | 4 | 4 | 0 | 4 |
| build_pricing | 2 | 231 | 252 | 100% (2) | 148 | 100% (2) | 2 | 2 | 0 | 2 |
| run_leader_withheld | 2 | 163 | 169 | 100% (2) | 163 | 100% (2) | 0 | 0 | 0 | 0 |
| run_blocked | 1 | 112 | 112 | 100% (1) | 112 | 100% (1) | 0 | 0 | 0 | 1 |
| approval_chip | 4 | 12 | 69 | 0% (0) | 0 | 0% (0) | 4 | 0 | 0 | 2 |
| approval_typed | 1 | 255 | 255 | 100% (1) | 243 | 100% (1) | 1 | 0 | 0 | 0 |
| edit_no_run | 1 | 29 | 29 | 0% (0) | 0 | 0% (0) | 1 | 0 | 0 | 0 |
| rerun_after_edit | 1 | 191 | 191 | 100% (1) | 191 | 100% (1) | 0 | 0 | 0 | 0 |
| rerun_no_change | 1 | 121 | 121 | 100% (1) | 121 | 100% (1) | 0 | 0 | 0 | 0 |
| challenge | 1 | 248 | 248 | 100% (1) | 248 | 100% (1) | 0 | 1 | 1 | 0 |
| uncertainty_followup | 1 | 381 | 381 | 100% (1) | 381 | 100% (1) | 0 | 0 | 0 | 0 |
| decline | 1 | 110 | 110 | 100% (1) | 110 | 100% (1) | 0 | 1 | 1 | 0 |
| option_request | 1 | 56 | 56 | 0% (0) | 56 | 0% (0) | 0 | 0 | 0 | 1 |
| exact_retry_replay | 1 | 264 | 264 | 100% (1) | 171 | 100% (1) | 1 | 1 | 0 | 1 |

### Checks by class

| Class | n | Leader-honesty FAIL | Action-truth FAIL | Caveat miss | Control-ref FAIL | Option-name FAIL | Units FAIL | Provenance FAIL | NOT_DECIDABLE (Ldr/Act/Cav/Ctl/Opt/Unt/Prv) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| build_hiring | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0/2/0/0/0/4/4 |
| build_pricing | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0/0/0/0/0/0/1 |
| run_leader_withheld | 2 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0/0/0/0/0/0/2 |
| run_blocked | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| approval_chip | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/4 |
| approval_typed | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0/0/0/0/0/0/1 |
| edit_no_run | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| rerun_after_edit | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0/0/0/0/0/0/1 |
| rerun_no_change | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| challenge | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| uncertainty_followup | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| decline | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/1/1 |
| option_request | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/1 |
| exact_retry_replay | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1/0/0/0/1/1 |
| **all scored** | 22 | 4 | 3 | 0 | 0 | 3 | 1 | 0 | 0/3/0/0/0/6/21 |

### Verdict tally

| Check | PASS (checked) | PASS (vacuous: nothing to check) | FAIL | NOT_DECIDABLE |
|---|---:|---:|---:|---:|
| CONTROL_REFERENCE | 0 | 22 | 0 | 0 |
| LEADER_HONESTY | 15 | 3 | 4 | 0 |
| ACTION_TRUTH | 9 | 7 | 3 | 3 |
| OPTION_NAME_FIDELITY | 13 | 6 | 3 | 0 |
| UNITS | 6 | 9 | 1 | 6 |
| PROVENANCE_WORDING | 1 | 0 | 0 | 21 |
| CAVEAT | 8 | 14 | 0 | 0 |

### Leader-honesty FAIL excerpts (first 2 of 4 failing turns; verbatim, emphasis markers dropped)

- `c19-8428207` A2r run (typed Run) (run_leader_withheld, leader_claim.permitted=false (options_do_not_separate, separation near_tie)) [model]: “Two developers are marginally more likely to lead under the model’s simulations”
- `c19-8428207` B2r run (typed Run) (run_leader_withheld, leader_claim.permitted=false (constraint_verdict_withheld, separation separated)) [model]: “On the current assumptions, a £59 pilot at release leads the comparison”

Finding kinds — action truth: promises_run_after_approval ×3; option names: option_renamed ×8; units: figure_without_unit ×1; provenance: none; control references: none.

### Served behaviour seen in the same captures (not wording)

- Approval or canvas-edit turns that ran the analysis: 1 — `c19w-8428207` W2 approve in words.
- Turns where the analysis_result block's own `summary` names a leader while `leader_claim.permitted=false`: 1 of 4 such blocks. Whether the UI renders that summary is not in a capture.
- Turns where the leader was permitted by `leader_claim` but Runtime PR-B's `leader_may_be_named` rule (permitted AND `permitted_analysis_mode = comparative_leader`) would withhold it: 0.

## Older builds (for trend only — different prompts and routes)

93 turns.

### Length, questions, status line, chips

| Class | n | Median words (final) | p90 words (final) | Over ~90 words (final) | Median model words (EST.) | Over ~90 (model EST.) | Server status/disclosure present | >1 question (final) | >1 question (model EST.) | Turns with ≥1 chip |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| build_hiring | 12 | 297 | 354 | 100% (12) | 247 | 100% (12) | 12 | 12 | 0 | 12 |
| build_pricing | 3 | 308 | 322 | 100% (3) | 212 | 100% (3) | 3 | 3 | 0 | 3 |
| build_heldout | 11 | 366 | 405 | 100% (11) | 279 | 100% (11) | 11 | 10 | 0 | 10 |
| run_leader_permitted | 4 | 166 | 331 | 100% (4) | 166 | 100% (4) | 0 | 0 | 0 | 0 |
| run_leader_withheld | 10 | 183 | 399 | 100% (10) | 183 | 100% (10) | 0 | 1 | 1 | 0 |
| run_blocked | 7 | 88 | 118 | 43% (3) | 88 | 43% (3) | 0 | 1 | 1 | 5 |
| approval_chip | 22 | 12 | 69 | 0% (0) | 0 | 0% (0) | 22 | 0 | 0 | 7 |
| edit_no_run | 3 | 14 | 25 | 0% (0) | 0 | 0% (0) | 3 | 0 | 0 | 0 |
| rerun_after_edit | 3 | 108 | 166 | 100% (3) | 108 | 100% (3) | 0 | 0 | 0 | 0 |
| rerun_no_change | 3 | 76 | 117 | 33% (1) | 76 | 33% (1) | 0 | 0 | 0 | 0 |
| challenge | 3 | 325 | 328 | 100% (3) | 325 | 100% (3) | 0 | 2 | 2 | 0 |
| uncertainty_followup | 3 | 308 | 342 | 100% (3) | 308 | 100% (3) | 1 | 0 | 0 | 0 |
| decline | 3 | 183 | 245 | 100% (3) | 183 | 100% (3) | 0 | 3 | 3 | 0 |
| option_request | 3 | 60 | 83 | 0% (0) | 60 | 0% (0) | 0 | 0 | 0 | 3 |
| exact_retry_replay | 3 | 323 | 354 | 100% (3) | 254 | 100% (3) | 3 | 3 | 0 | 3 |

### Checks by class

| Class | n | Leader-honesty FAIL | Action-truth FAIL | Caveat miss | Control-ref FAIL | Option-name FAIL | Units FAIL | Provenance FAIL | NOT_DECIDABLE (Ldr/Act/Cav/Ctl/Opt/Unt/Prv) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| build_hiring | 12 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0/6/0/0/0/12/9 |
| build_pricing | 3 | 0 | 3 | 0 | 0 | 1 | 0 | 0 | 0/0/0/0/0/0/1 |
| build_heldout | 11 | 0 | 8 | 0 | 0 | 1 | 0 | 0 | 1/0/0/0/1/3/7 |
| run_leader_permitted | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/4 |
| run_leader_withheld | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/10 |
| run_blocked | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/7 |
| approval_chip | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/22 |
| edit_no_run | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/3 |
| rerun_after_edit | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/2 |
| rerun_no_change | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/3 |
| challenge | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/2 |
| uncertainty_followup | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/3 |
| decline | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/3/3 |
| option_request | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0/0/0/0/0/3 |
| exact_retry_replay | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/3/0/0/0/3/3 |
| **all scored** | 93 | 10 | 16 | 0 | 0 | 2 | 0 | 0 | 1/9/0/0/1/21/82 |

### Verdict tally

| Check | PASS (checked) | PASS (vacuous: nothing to check) | FAIL | NOT_DECIDABLE |
|---|---:|---:|---:|---:|
| CONTROL_REFERENCE | 0 | 93 | 0 | 0 |
| LEADER_HONESTY | 74 | 8 | 10 | 1 |
| ACTION_TRUTH | 33 | 35 | 16 | 9 |
| OPTION_NAME_FIDELITY | 49 | 41 | 2 | 1 |
| UNITS | 22 | 50 | 0 | 21 |
| PROVENANCE_WORDING | 11 | 0 | 0 | 82 |
| CAVEAT | 26 | 67 | 0 | 0 |

### Leader-honesty FAIL excerpts (first 2 of 10 failing turns; verbatim, emphasis markers dropped)

- `c16-fd312b5` B2r run (typed Run) (run_leader_withheld, leader_claim.permitted=false (constraint_verdict_withheld, separation separated)) [model]: “Within the model’s current comparison only, Raise With Release had the highest simulated comparison frequency (66.3%), versus 21.9% for holding at £49/month an…”
- `c17-84a765e` B2r run (typed Run) (run_leader_withheld, leader_claim.permitted=false (constraint_verdict_withheld, separation separated)) [model]: “On the model’s normalised MRR outcome scale, £59 produced the highest average outcome of the three price paths”

Finding kinds — action truth: promises_run_after_approval ×16; option names: option_renamed ×2; units: none; provenance: none; control references: none.

### Served behaviour seen in the same captures (not wording)

- Approval or canvas-edit turns that ran the analysis: 0.
- Turns where the analysis_result block's own `summary` names a leader while `leader_claim.permitted=false`: 0 of 14 such blocks. Whether the UI renders that summary is not in a capture.
- Turns where the leader was permitted by `leader_claim` but Runtime PR-B's `leader_may_be_named` rule (permitted AND `permitted_analysis_mode = comparative_leader`) would withhold it: 0.

## What these captures cannot establish

- **Raw model text.** The server removes every sentence that claims a completed write (`write-outcome.ts`) and rewrites proposal ids before the text exists; “model words” here are the final text minus the server’s own trailing paragraphs, an ESTIMATE labelled as such. Zero-model-call turns (typed-chip approvals, forwarded canvas edits) are exact: every word is the server’s.
- **Grounding.** Whether a figure, driver or sensitivity in the reply is what the analysis actually returned needs the tool RESULTS the model saw; captures carry tool names with ok/mutated/refusal only. No grounding verdict is given.
- **Provenance accuracy.** `user_override` marks both a value the user typed and an Olumi proposal the user adopted, so “your figure” vs “my assumption” is decidable only for `brief_extraction` values (and unattributed `ai_inferred` ones, which these captures barely contain). Everything else is NOT_DECIDABLE. The server’s own `analysis_admission` also counts adopted proposals as user-stated, which a reply cannot be checked against from here.
- **The model’s inputs.** Instructions, history and the claim permissions actually handed to the interpreter are not captured; a leader-honesty FAIL is judged against the post-turn `analysis_state.leader_claim` on the same response, which is the authority the interpreter is given on the fast Run path.
- **What the user saw on screen.** Chips are what the response offered (`suggested_actions`); whether the UI rendered them, and whether the persistent Run control was visible, is not in a capture (Run references with no Run chip are NOT_DECIDABLE).
- **Replayed turns** (`exact_retry_replay`) carry no tool calls of their own, so their action truth is NOT_DECIDABLE.

## How the checks decide (short form; the code is the definition)

- Every check returns PASS / FAIL / NOT_DECIDABLE with a reason; a PASS that had nothing to check is marked vacuous and tallied apart.
- **Leader honesty:** only when `leader_claim.permitted === false`; a clause naming an option (draft_graph labels, their short form, or a figure unique to one option) with a ranking cue (leads / ahead / wins / in the lead / % of runs / highest … chance) and no negation, condition or modal BEFORE the cue (“does not lead”, “would only lead if”); one after it (“leads, which could change”) does not un-assert the ranking. Preference words (favours, strongest) count only in a sentence about the model’s result.
- **Action truth:** save claims use the production detector `assertsCompletedWrite` plus a few forms it does not cover; support = a write tool with `mutated: true` (or a forwarded canvas edit with a graph patch). Run claims need a successful `run_analysis` with a result. Proposal/“approve this” claims need an approve chip or a successful proposer. A promise that approval will run the analysis is judged by the NEXT captured approval in that conversation; with none captured it is NOT_DECIDABLE.
- **Control reference:** a quoted/bold known chip label, or click/press/tap + a quoted name, or “… button/chip”. Contrast control: 66 control-vocabulary hits (click, press, tap, button, chip, a chip label, or the word Run) in the prose of 59 scored replies, and the self-tests flag a crafted “press **Run analysis**” with no Run chip — so a zero here is not a blind probe.
- **Option names:** bold or quoted spans that share ≥ 2 content tokens and Jaccard ≥ 0.5 with an option label, but are not that label (inflected leading verb and dropped leading verb allowed). Quantity phrases and other node labels are skipped.
- **Units:** a number bound to a factor/option (nearest number within 40 characters of its label) must carry that value’s unit, and must not be the normalised value.
- **Caveat:** owed when the turn reports an analysis and it is blocked, low/very-low robustness, a near tie, or leader-withheld; satisfied by any caveat cue in the reply.
- **Questions:** the harness’s PQ2 definition — a count of `?` characters. A request phrased without a question mark (“Let me know if…”, “Would you like… .”) is not counted; a `?` inside a quotation is.

## Known limits of the checks (lexicon-based: a FAIL count is a lower bound, a zero means “none recognised”)

An adversarial review probe (24 Sep) ran crafted replies through every check. The forms below are still NOT recognised; a reply that uses them passes that check.

- **Leader honesty:** a ranking with no ranking cue next to an option name — “the analysis points to X”, “the model prefers X”, “X looks better than Y”; a ranking that names no option (“it leads”, “the first option wins”). A role noun beside a cue can false-positive (“the Tech Lead role is ahead of schedule”).
- **Action truth:** a promise to run with no approval context (“I’ll run the comparison now”) is not scored as a claim.
- **Control reference:** an unquoted control name, or one introduced by “select” / “choose” / “use” rather than click / press / tap.
- **Option names:** a rename by synonym (“Hire Two Engineers”, “Two Devs”) — it shares fewer than two content tokens with the label.
- **Caveat:** any caveat cue satisfies it, including a negated one (“there is no uncertainty here”).

## Reproduce

```bash
pnpm exec tsx tools/agent-reply-eval/cli.ts \
  --captures-dir "$CAPTURES_DIR" \
  --current-build 8428207 \
  --report Docs/evals/agent-reply/BASELINE-8428207.md
```

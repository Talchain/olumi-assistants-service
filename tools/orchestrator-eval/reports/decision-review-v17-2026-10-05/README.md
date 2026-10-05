# decision_review v17: promotion evidence, 2026-10-05

`7de3ec66a381076e` · claude-sonnet-5 · n=21 (7 committed fixtures x 3 arms) · **21/21 parsed, 21/21 fully clean** on the shipped pack

## What changed from v16 (WORDING P3; Science d5 6002255059, DL 6002275151 / 6003223464)

The review narrative leads with **why**, not **who**:

1. **What the result rests on in this model.** This is the primary risk, the same link or factor named in `robustness_explanation.primary_risk`.
2. **What would change it**, in about 12 words.
3. **The option's own share, only when the leader claim holds:** "In this model, X% of runs supported [label]".
   - When `winner.recommendation_suppressed` or `winner.constraint_infeasible` is set, there is no share sentence. Instead the narrative states the barred option, the constraint it breaches, and the feasible alternative.

Other changes:
- The standing form "produced the best outcome in X% of runs", "the option this model points to / favours", and "this model points to [alt] rather than [winner]" are gone everywhere in the prompt. Runs **support** an option.
- "produced the best outcome" and "came out best" are added to the banned list (tightening only; the v14/v15/v16 floors are preserved).
- **Budget:** aim for 230 characters, with a stated shape.

## How it was produced

`buildDecisionReviewUserMessage(input)` (production assembly, via `assembleDecisionReviewUserMessage`) for each committed fixture, sent to `claude-sonnet-5` with the canonical export as the system prompt.
- `max_tokens` 8192, `thinking: {type:'disabled'}`, provider-default sampling.
- `CEE_MODEL_DECISION_REVIEW=claude-sonnet-5` was read from the Render API on 2026-10-05.
- Every completion is non-empty with `stop_reason: end_turn`.

Pilots: 1 on v17 (fixture 01), then 2 + 1 on the budget tightening (fixtures 02, 05, then 02). Two earlier full runs (21 arms each, on the untightened v17 and on v17c) are summarised below and are not committed as evidence. v17c scored 20/21 on the shipped pack ("readiness" leaked into a pre-mortem field) and the residual was tightened. In total this lane made 67 LLM calls (BUDGET lines #87 6003832585, 6003956130, 6004062984).

## Outcome metrics (the change itself; the shipped pack cannot see sentence order)

`outcome-metrics.py`, run over the raw arms, measures five things:
- **M1:** sentence 1 carries no share and does not open with an option label.
- **M2:** the share sentence is present exactly when the leader may be stated.
- **M3:** no best / winner / points-to / favour phrasing in any prose string.
- **M4:** the narrative is at most 280 characters.
- **M5:** sentence 1 carries a primary-risk content token.

| arms | M1 | M2 | M3 | M4 | M5 |
|---|---|---|---|---|---|
| v16 (committed, 817014c1) | 0/21 | 3/21 | 0/21 | 19/21 | 14/21 |
| v17, first run (untightened, not evidence) | 21/21 | 21/21 | 16/21 | 13/21 | 21/21 |
| v17c, second run (not evidence) | 21/21 | 21/21 | 20/21 | 21/21 | 21/21 |
| **v17 (this, 7de3ec66a381076e)** | **21/21** | **21/21** | **19/21** | **20/21** | **21/21** |

## Scope of the claim

- **ATTRIBUTION IS BY CONSTRUCTION, NOT BY WITNESS.** The harness passed the prompt directly, so these bytes are certain. The deployed assembly (SCIENCE_CLAIMS injection, `responseFormat`) is not witnessed. There is no live staging witness until the DL writes the PMS v17 row and staging serves it.
- **IN-SAMPLE.** The tightening was iterated against fixtures 02 and 05.
- **The served text is the PMS row, not `src/prompts/defaults.ts`.** `defaults.ts` (sha16 522ace22) is the fallback used only on a store failure, and it is OUT of this change.
- **Promoting this closes the v16 revert anchor**, exactly as v16 closed v15's. The revert is `git revert` of this commit plus re-pointing PMS.

## Residuals the shipped pack does not see (stated, not tuned away)

- **M3, 2/21:** "favour" phrasing in `decision_quality_prompts[].applies_because`, not in the narrative.
  - r2/04: "holds a clear share of runs in its favour".
  - r3/04: "The comparison currently favours one option by a comfortable share". This is also a FORM 3 quantity word the lexicon cannot see.
- **M4, 1/21:** r2/05 (barred option) is 308 characters. It wrote the forbidden sentence 2 in the barred case, and downstream clips near 300. v16 had 2/21 over the cap.
- Further tuning against these same 7 fixtures would be in-sample fitting, so the residuals are recorded here instead.

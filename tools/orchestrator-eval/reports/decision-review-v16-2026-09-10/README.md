# decision_review v16 — promotion evidence, 2026-09-10

`817014c134b96cd3` · claude-sonnet-5 · n=21 (7 committed fixtures x 3 arms) · **21/21 parsed, 21/21 fully clean**

## What is here

| path | what it is |
|---|---|
| `raw-arms/` | the 21 raw model responses, verbatim, with `stop_reason`, token counts and latency |
| `captures/` | each arm as a scoreable fixture: the committed fixture's `input` byte-identical, plus the extracted object |
| `live-capture-report.json` | those 21 scored by the shipped pack (`pnpm eval:decision-review`) |

## How it was produced

`buildDecisionReviewUserMessage(input)` for each committed fixture, sent to `claude-sonnet-5`
with the canonical export as the system prompt: `max_tokens` 8192, **`thinking: {type:'disabled'}`**,
provider-default sampling. Every completion is non-empty with `stop_reason: end_turn`; an empty
completion is a hard error in the harness, never a skipped sample.

`CEE_MODEL_DECISION_REVIEW=claude-sonnet-5` was derived from the Render dashboard on 2026-09-10,
not from `render.yaml` (which is a drifting subset — see the estate's trap 18).

## Scope of the claim — read this before quoting 21/21

**ATTRIBUTION IS BY CONSTRUCTION, NOT BY WITNESS.** The prompt was handed to the model directly by
the harness, so these bytes are certain. What is **not** witnessed is the deployed service's own
assembly (SCIENCE_CLAIMS injection, `responseFormat: json_object`). There is **no live staging
witness for v16.** The v15 report carried one; this one does not.

**THE 21/21 IS IN-SAMPLE.** Nothing was held out. This prompt was iterated against these same seven
fixtures.

**THE GATE CANNOT CERTIFY THE THING v16 EXISTS TO DO.** The banned lexicon is derived from
*double-quoted* tokens in the prompt, so its 34 quoted phrases are enforced — but RACE FRAMING
FORM 1 deliberately leaves the bare words *lead / leads / leading / ahead / behind / margin*
unquoted (they can occur inside a factor label that must be copied verbatim), and FORMS 2, 3 and 4
carry no quotable token at all. Measured on these 21 arms: **zero** contain a quoted banned race
phrase — and **five** contain a genuine unquoted breach:

| arm | breach | form |
|---|---|---|
| r1/05 | "close the gap on these numbers" | 3 — comparison as a quantity |
| r3/06 | "close the gap on these numbers" | 3 |
| r1/06 | "stays ahead across a fair range" | 1 — bare word |
| r2/03 | "to lead here" | 1 |
| r2/06 | "to lead the comparison" | 1 |

Adjudicated by sense: the other hits on those words are ordinary English or factor labels
("Operating Margin", "ahead of launch", "engineering leads", an evidence "gap"). That is exactly
why a word list cannot settle it, and why quoting the bare words would fire on labels the prompt
orders copied verbatim.

**So `21/21 clean` means clean against the QUOTED subset. It is not evidence that race framing is
gone.** v16 measurably reduces it (14 of 17 parsed v15 arms breach the quoted list alone, against
0 of 21 here). The residual is unmeasured by construction, and is rowed rather than patched —
adding a term per construction is the oscillation this estate has already paid for.

## Freezing

These captures are an **observation frozen on 2026-09-10**, not a target. The outputs are
immutable, so a change in any recorded verdict means the **scorer** moved. Append, never edit.

# Bounded source-supported analysis audit

29 September 2026, C base `ec82b01ab1ad60232b503e08ea95e482eaec184d`.
No provider calls, Run requests, model writes, or invented modelling assumptions.
The shared provider ledger remains 55/60.

**No already analysis-ready case was found.** All four frozen M1 registration
payloads fail the existing `assessAnalysisReadiness` authority. A fresh read of
Paul through the same local BFF also fails. A framing clarification alone cannot
fill the missing effects: user-supplied estimates or explicitly adopted assumptions
are still required.

| Frozen M1 case | Explicit options retained | First source/analysis blocker | Useful next input, not a claim of readiness |
| --- | ---: | --- | --- |
| Paul MRR | 1 | `FEWER_THAN_TWO_OPTIONS`; price has no supported path to total MRR | Confirm comparison with keeping £49, resolve Pro versus total-MRR scope, then supply expected subscriber/churn effects over the stated year. A scope answer alone cannot justify a product identity on total MRR. |
| Cloud | 1 | `FEWER_THAN_TWO_OPTIONS`; GCP has no intervention or path to cost | Confirm keeping AWS as the comparator; provide estimated GCP monthly cost and migration downtime, with uncertainty. Recover the already supplied £45k baseline from the source; do not ask the user to repeat it. |
| Hiring | 2 | `ORPHAN_NODE` / `NO_PATH_TO_GOAL`; both options lack numerical intervention values | The +2 senior and +4 junior changes are retained pending. Resolve the current hiring-level encoding, salary costs and expected delivery effect, plus the calendar date intended by Q3. A zero starting level or guessed productivity ratio is not source evidence. |
| Support | 1 | `FEWER_THAN_TWO_OPTIONS`; live chat has no intervention or CSAT path | Confirm email as the comparator, then supply expected CSAT effect of live chat within six months with the stated fixed staffing. Do not substitute a guessed response-time coefficient. |

Authority evidence is in local artifacts `m1-readiness-audit.json` and
`m1-readiness-bff-paul.json`. The latter is a fresh POST read at
`http://127.0.0.1:5178/bff/cee/scenarios/3f1f73cc-e505-4599-984a-c2d730457dfa/graph`,
followed by an offline assessment. It is not a Run or a new registration.

## Existing real brief corpus

Read the recovered MG corpus at
`output/mg-7x3-s4core-20260928/BASELINE-V1-BRIEFS.json`, SHA-256
`4dab09bd34fc57fc5996c71c3fa2173b86b6004b3ad4aade9b71bbb0a64c9253`.
These are the original seven A, C, E, support, warehouse, cloud and techlead briefs;
Paul's frozen MRR case is a separate literal brief.

- A has one explicit raise-price alternative, no subscriber response, and no
  source-supported sized relationship to MRR/churn.
- C has two explicit alternatives (features plus price increase versus advertising),
  but no comparative MRR/churn effects or allocation of the £20k budget.
- E is the hiring case above.
- Support and cloud are the frozen cases above.
- Warehouse has two explicit alternatives, a £2m cap, and a 95% next-day coverage
  target, but neither alternative's cost or coverage is supplied.
- Techlead has two explicit alternatives, but no baseline or quantitative delivery
  effect. Its launch horizon is three months; that is not an effect estimate.

**Warehouse is the smallest plausible additional-input case**, since options,
outcome and budget cap are already explicit. The bounded information request is:
“For Manchester and Leeds, what are your estimates and plausible ranges for total
cost and next-day UK order coverage by Q4, and which Q4 date do you mean?”
This requests missing evidence; it does not invent it. No warehouse M1 output or
successful continuation has been constructed, so it must not be reported as ready.

## Borrowed-option-quote negative control

`option-quote-negative-control.mjs` implements the exact replacement contrast from
[#72 comment 5893015487](https://github.com/Talchain/olumi-programme-docs/issues/72#issuecomment-5893015487)
and its [detailed review](https://github.com/Talchain/olumi-assistants-service/pull/2299#issuecomment-5893010485).
It imports only the independent scorer, not constructor/admission/marker/Run code.

The source lists £59 and £49. A synthetic registered-payload mutation replaces £59
with £54 while copying the £59 quote and erasing the AI marker. It must lose user
option retention and source-binding credit and be penalised as an invented user
option and number. Positive matching-action, retained-AI-marker and external-proposal
controls are included. No synthetic graph is registered or analysed.

The prior scorer already penalised the fabricated £54 number but its broad `raise`
label match could credit user-option retention. The scorer now checks contradictory
numeric interventions when matching an expected option; copied text cannot override
that mismatch. This changes evaluation only, not product construction.

Validation: `node experiments/alternative-constructor/offline-checks.mjs` passes
23/23, and `node experiments/alternative-constructor/option-quote-negative-control.mjs`
passes 4/4. Detailed scores are saved in local artifact
`option-quote-negative-control.jsonl`. Previous scored evidence is left intact.

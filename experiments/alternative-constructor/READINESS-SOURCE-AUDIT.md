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

## Integrated ownership fix and local persistence witness

At C source `eacfd99877779e5c9d41257fb2699c5b1d01fd1f`, run
`node --import tsx experiments/alternative-constructor/replay-option-authority.mts`.
The exact saved Paul CandidateModel is used with A's frozen quote-replacement
contrast. Both policies execute the real `buildModelFromBrief` capability, capture
its registration payload, parse/serialize/parse GraphV3, and call the real intake
reconciliation reader. Provider replies are injected; registration in this replay
is in memory. It is not a full Agent HTTP conversation or a Run witness.

| Contrast | Policy | Registered option | Intake state | Permission to name leader |
| --- | --- | --- | --- | --- |
| AI £54 borrows £59 quote | Default/current | £54 with the false £59 quote | reconciled | true (reproduced failure) |
| AI £54 borrows £59 quote | M1 opt-in | Only genuine Keep £49; £54 remains an external proposal | identity_unverified | false |
| Genuine £59 uses its quote | Default/current | £59 and Keep £49 | reconciled | true |
| Genuine £59 uses its quote | M1 opt-in | £59 and Keep £49 | reconciled | true |

The independent scorer rejects the numeric replacement and passes its matching
action control. These assertions concern option/figure identity, not certification
of an unstated period or a general scientific result. Node-level quote presence
does not by itself prove field-level numeric authority. The default path's failure
remains; the product fix is opt-in M1 only.

Separately, only the safe M1 mutant was registered through the real local BFF in
new isolated scenario `2963b7c0-91bc-4258-8706-403b24350c76` and cold-read in a fresh
Node process. Both requests returned 200, with canonical hash `a2792bdf0b02bd5d`.
Readback GraphV3 exactly matches the submitted graph. Keep £49 retains
`provenance: from_brief` and its own quote; no option stores the borrowed £59 quote.
The real intake reader on this cold read still gives `identity_unverified` and
`mayNameLeadingOption: false`. Readiness remains blocked. No Run request, analysis,
browser interaction or provider call occurred; the rejected proposal is retained
in the constructor result, not persisted as canonical truth.

All four frozen M1 registration graphs are byte-identical to the pre-fix lineage
replay; two hiring changes remain pending. Ledger remains 55/60.
Local evidence:

- `m1-option-authority-independent-replay.jsonl`: four contrast/policy rows,
  candidates, registered graphs, intake verdicts and independent option scores.
- `m1-option-authority-four-independent-checks.json`: exact graph hashes/equality.
- `m1-option-authority-registration-request.json` and
  `m1-option-authority-registration-receipt.json`: fresh scenario write.
- `m1-option-authority-persistence-witness.json`: fresh-process readback and verdict.

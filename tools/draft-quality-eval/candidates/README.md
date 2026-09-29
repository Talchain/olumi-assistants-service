# Candidate deltas for `DRAFT_RECORDS_INSTRUCTION`

⛔ **NOTHING IN THIS DIRECTORY IS SERVED, AND NOTHING HERE IS APPROVED.** These are
non-serving arms for `tools/draft-quality-eval`. Promoting any of them means editing
`src/cee/draft/records/instruction.ts`, minting a new pin, and the owner's explicit sign-off —
none of which happens by a file existing here.

Each `.txt` file is a **DELTA**, appended to the tree's live instruction by
`--candidate-append`. It is deliberately not a full copy: a copy of the instruction sitting in
the repo is a second authority that drifts from the constant it was copied from, and a delta
cannot, because its base is always the live bytes.

## Status of each candidate

| file | status | measured against the control? |
|---|---|---|
| `goal-when-unstated.txt` | ⛔ **SUPERSEDED — DO NOT PROMOTE** (2026-08-29) | **No**, and it never will be. See below. |

### ⛔ `goal-when-unstated.txt` is superseded, and promoting it would entrench a defect

It was written 2026-08-18 against the right *symptom* — a brief that states no objective yields no
goal — and answers it with guidance that makes the reasoning worse:

> *"The sentence you want is the one naming what is being chosen between … "We're deciding between
> two major feature investments for Q3""*

**That sentence is the decision, not its purpose.** Instruction v8 (2026-08-29) closes the same
silence from the opposite side, because a goal quoted from the deliberation frame is one of the
options in disguise: every chain in the graph terminates at the goal, so the causal structure is
then built to justify a move the user has not finished making, and the analysis scores the
alternatives against a target that already assumes one of them. Measured at the deployed staging
draft endpoint on 2026-08-29 across 13 briefs, that is exactly what the model already does unaided
on **7 of 7** briefs that state no outcome — on one of them filing a single span as both the `goal`
and an `option`, byte-identical `source_quote` on both records. The candidate would have reinforced
it.

`deriveGoalObjectiveLabel` also refuses to author a label from such a span
(`objective-label.ts`, reasons `deliberation_frame` / `states_alternatives`), so the quote would
have reached the user verbatim — which is the failure this whole directory exists to catch before
it ships.

Kept rather than deleted, with its verdict attached: a candidate quietly removed teaches nobody,
and the next author would re-derive the same idea.

**Do not read a candidate's existence as evidence.** The estate has twice recorded an instruction
version as shipped-on-derivation-alone; the point of this directory is that a candidate can now be
measured before it becomes one.

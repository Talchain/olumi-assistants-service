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
| `goal-when-unstated.txt` | **PROPOSED — UNMEASURED** | **No.** Written 2026-08-18 against a measurement of the *defect*, never against a live result for the *fix*. |

**Do not read a candidate's existence as evidence.** The estate has twice recorded an instruction
version as shipped-on-derivation-alone; the point of this directory is that a candidate can now be
measured before it becomes one.

# The write-claim strip misses a claim followed by a negated clause (25 Sep 2026, about 03:10Z)

**Owner:** OpenAI Runtime (`src/orchestrator-v5/agent-lane/write-outcome.ts`, `assertsCompletedWrite`). AI Quality measured it and writes no route file.

## The defect
`NEGATION` is tested against the **whole sentence**. So a claim clause followed by a negated clause escapes the strip:
- **Served** `e39f6e0`, `hiring-level2/answer`: "I’ve recorded your clarification as evidence, but cannot store £310,000 on …".
- The only tool called was `get_canonical_state`, and `write_claims_removed: 0`.
- So a **false save claim reached the user**.

## Checked with the production function (tsx, staging `21e3b38` merged)

| Sentence | Result |
|---|---|
| served compound sentence | no-claim (**the escape**) |
| its first clause alone | CLAIM |
| control: a claim with no negation | CLAIM |
| control: "I haven’t recorded anything yet." | no-claim |

## Prevalence
The scan ran over 475 capture files, which gave 317 distinct served turn texts and 4,207 sentences.
- **Present control:** 157 whole-sentence claims detected.
- **Clause-only escapes:** 5, but **only 1 is genuine** (the one above). The other 4 are:
  - server status lines: "Not saved: none of it was applied." (×2) and "Partly saved … but not yet linked";
  - one heading.
- So the rate is **1 in 317**: real, but rare.

## The smallest fix (Runtime's call)
- Evaluate `NEGATION` per clause, splitting on `, but|, though|, yet|;|: |—`.
- A sentence is a claim if **any clause** asserts a write with no negation in that clause.
- Add `none` to `NEGATION`. Otherwise the server's own "Not saved: none of it was applied." would be flagged once split.
- **RED:** the served sentence above.
- **Discriminating control:** "Not saved: none of it was applied." must stay no-claim.

**Scripts:** `scratchpad/claimprobe.mts` and `claimscan.mts`. This session's copies are not banked.

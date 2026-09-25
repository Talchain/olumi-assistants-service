# The provisional wording sentence for "caveat, not withhold" (25 Sep 2026, about 01:45Z)

**Input:** the served caf7d1a paid-search explicit Run. Its leader is permitted, it is separated, and its admission mode is `quantified_provisional`, which is Paul's caveat population (programme-docs#38 5576895511).
- Both arms were given the proposed permission, `{leader_may_be_named: true, provisional: true}`. Only `instructions` differs.
- **A** is R, the #1866 stack.
- **B** is R plus `P-sentence.txt`.
- 4 repeats per arm, 8 OpenAI calls, 0 blocked.

**Blind labels** (fresh-context classifier; the key was held separately):

| Arm | Leader named | Qualified as provisional in the same sentence | Recommendation or "best" |
|---|---|---|---|
| A | 4/4 | 3/4 | 0/4 |
| B | 4/4 | **4/4** | 0/4 |

- The unqualified A reply: "On the current model, Keep Search Allocation leads the comparison".
- **This is directional only (n=4).** The wire gate's separable-provisional arm also appends the provisional caveat.
- **The patch (v2)** holds the `claimPermissionsFrom` fix, sentence P and the tests. Its FP3 stack is byte-identical to arm B (sha `ecea44ab…`).

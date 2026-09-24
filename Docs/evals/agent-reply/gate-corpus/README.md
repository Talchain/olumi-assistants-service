# Leader-claim corpus for the wire gate: real model replies, labelled from outside the author

**v5 multi-domain (`corpus-v5-multidomain.json`, 25 Sep 2026):** 43 replies (20 leaking, 23 clean), each carrying its own SERVED state (9 states). All labels are blind.
- **Engineering hiring and paid search:** 36 replies, run on #1854's FP3 stack.
- **The live route on `caf7d1a`:** 7 visible replies, of which 6 leaked to the user.
- **At `c933aabf`:** 20 of 20 leaks pass the gate. No clean reply loses a sentence; in `quantified_provisional` states the gate only APPENDS a provisional disclosure.

**v4 (25 Sep 2026, #63 5823878422):** 65 withheld replies, 34 leaking and 31 clean.
- **Added:** 12 replies at `714677d5` (reps 4–9) and 36 from the 2×2 on `7dd2e983`.
- **Every label is blind:** a fresh-context classifier on shuffled replies, with the key held separately.
- **Result on `c933aabf`:** 33 of 34 leaks pass the gate; 31 of 31 clean replies are untouched.
- `corpus.json` is v4. `gate-results.json` below is v1's (17 replies).


**17 visible replies** to the pricing explicit Run, all with the leader withheld (`constraint_verdict_withheld`, mode `comparative_leader`). They are gpt-5.6-terra outputs, OpenAI only.
- 9 come from `paired/57f903c`: M reps 1–5, C1 reps 1–3 and C2 reps 1–3.
- 6 come from AI Quality's run on #1854's own stack (`714677d5`, V1 and V2).

**How each reply was labelled:**
- the deterministic scorer (LEADER_HONESTY and its hyphen-split variant);
- the independent blind reviewer (#63 5822982121, case 4: all three rep-1 replies violate);
- a blind, fresh-context classifier (6 replies).
The author did not write any of these replies.

**Result for `enforceLeadingOptionClaimsAtWire` at `714677d5`**, with the route's options and the served `57f903c` pricing state:

| Measure | Result |
|---|---|
| Replies that name a leader, **caught** | **1 of 13** |
| Clean replies left untouched | 4 of 4 |
| Present control ("Raise Pro to £59 at release leads the comparison.") | edited, so the gate is live on these inputs |

**What the gate misses:**
- "raising Pro to £59 with the feature release leads the MRR comparison";
- "the £59-at-release path produces the strongest MRR…";
- "favours raising Pro to £59 with the feature release";
- "it had an 83.28% chance of producing the highest modelled MRR outcome".

In short, the model paraphrases the option label, and the gate matches the label.

**Use:** `corpus.json` is the input and `gate-results.json` is the outcome, per reply.
- **The 13 `names_leader` replies:** a withheld-leader gate should edit them.
- **The 4 `clean` replies:** it must leave them untouched.

# Repair-fidelity sentence Q: A/B on 8 served e39f6e0 explicit Runs (25 Sep 2026)

**Set-up:**
- Arm A = R, the served stack. Arm B = R plus `Q-sentence.txt`.
- 8 states × 2 repeats × 2 arms = 32 OpenAI calls. Only `instructions` varies.
- Inputs: the FP3 request rebuilt from each served capture, with `what_is_missing` set to the run's own summary (inferred).
- Blind classifier labels (`labels-32.json`), with the key held separately.

| | A (R) | B (R + Q) |
|---|---|---|
| Relays the named repair, no invented fix | 4/16 | **11/16** |
| Proposes a different fix | 5/16 | 2/16 |
| Silent on the repair | 7/16 | 3/16 |
| Hiring: clean repair | 0/8 | 5/8 |
| Pricing: clean repair | 4/8 | 6/8 |
| Leader-vocabulary leak | 0 | 0 |
| Median words | 107 | 115 |

**The pattern Q targets.** A served blind judge failed the Run reply on truth in 7 of 8 served journeys (`served-e39f6e0/SERVED-SCORES.json`). The dominant cause is an invented repair.

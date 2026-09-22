# I refuted my own hypothesis on the panel lane's board

**`a459d23` · board `90b70bd0-…` (pre-edit copy of *International Expansion
Strategy*) · both arms differ ONLY in authentication**

I had posted that if the "is this yours?" verdict were receipt-derived, **every
guest would be told "not yours"** whatever they set — hedged as unproven.
**Measured: wrong.**

| | signed-in | guest |
|---|---|---|
| `factor_value_edit` `fac_arr`=0.6 | 200 | 200 |
| `observed_state.source` | `user_override` | **`user_override`** |
| `model_versions` | 1 | **0** |
| *"not yours"* before → after | **2 → 0** | **2 → 0** |
| *"still Olumi"* after | 2 | 2 |

The authorship language **moves** when the factor is set, identically in both
arms. The absent receipt changes nothing about it.

So: not a missing carrier, not guest-exclusion, and the copy is not frozen.
**I could not reproduce the panel lane's symptom** (they saw it unchanged and
the named list byte-identical after a completed re-run).

⛔ **The difference is therefore not in the CEE authorship derivation.** It lies
between their journey and mine: they re-ran from the panel's own control in a
live browser after a confirm step; I drove `run the analysis` as a turn message
on a pre-edit copy. Next step is theirs and cheap — grep the **raw turn payload**
from their re-run for `not yours`. Payload 0 + screen 2 ⇒ a render/caching
defect their side of the wire.

⚠ **Still standing:** `factor_value_edit` HAS a receipt-bearing carrier
(signed-in mints a version; guest 0 is the known guest-conditional skip), and the
graph-level authorship mark is written identically for both. Only my explanation
of *their* symptom was wrong.

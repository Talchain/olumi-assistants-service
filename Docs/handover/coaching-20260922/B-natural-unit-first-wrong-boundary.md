# The natural-unit edit defect — first wrong boundary

**Date** 22 Sep 2026 · **Verdict: it belongs HERE (CEE conversational normalisation), not Model
Generation.** Canonical state is correct; the information is destroyed on the way in.

Measured at CEE `bd35cc9e1a838159ec3949a278a89820acb01151` by EXECUTING the real chain
(`npx tsx`), not by reading it.

## The chain, and where it breaks

```
message ──► extractQuantities()          ──► mapCqeQuantityToProposalValue() ──► unitComparisonKey() gate
            cqe/extract-quantities.ts        routing/deterministic-value-update.ts:1914   d1-shared/evaluate-factor-value-proposal.ts:636
```

Executed output:

```
MESSAGE: change hiring cost to £62 per month
  {"raw_text":"change hiring cost to £62 ","unit":"GBP","value":62}   → mapped unit '£'
MESSAGE: change hiring cost to £62/month
  {"raw_text":"change hiring cost to £62","unit":"GBP","value":62}    → mapped unit '£'
MESSAGE: set hiring cost to £62 a month
  {"raw_text":"set hiring cost to £62 ","unit":"GBP","value":62}      → mapped unit '£'
MESSAGE: change hiring cost to £62            ← CONTROL (bare amount)
  {"raw_text":"change hiring cost to £62","unit":"GBP","value":62}    → mapped unit '£'
```

**The first wrong transformation is CQE extraction.** All three rate spellings produce a result
BYTE-IDENTICAL in unit and value to the bare amount — the denominator is not in the extractor's
unit vocabulary at all. It is not recoverable downstream either: `raw_text` is truncated at the
amount (note the trailing space where "per month" began), so the quantity object carries no trace
of it. Only the original message still has it.

The gate then behaves **correctly for the input it is given**:
`unitComparisonKey('£') = '£'` ≠ `unitComparisonKey('£/month') = '£/month'` ⇒ `unit_mismatch`,
copy: *"This factor uses £/month; the value provided is in £."* The user reads a refusal of the
exact thing they said.

⛔ So the fix is NOT to loosen the gate. `unitComparisonKey`'s own docblock forbids it in terms —
*"Never widen this to strip punctuation or match prefixes — that would bless a real rescale as a
spelling."* That warning is right: `£/month` vs `£/day` is a real rescale.

## Reachability, measured live

300 most recently-updated scenario graphs, all factor units counted:

```
boards with ≥1 rate-shaped unit ("/" or " per "): 63 of 300  (21%)
  59  '£/month'      7  '£ ARR per customer'      1  'accounts/month'
   1  '£/day'        1  '£/year'                  1  'contacts per week'
CONTRAST CONTROL — most common units overall:
 494  'scale'      291  '£'      109  '%'      71  'months'
```

**One board in five holds a factor a user cannot edit in the words they would naturally use.**

## The false positive any fix must avoid, already present in live data

`'£ ARR per customer'` (7 nodes) and the message *"change ARR per customer to £480"* — executed,
`raw_text: "change ARR per customer to £480"`. Here `per` belongs to the FACTOR LABEL, not to the
amount. A denominator reader that scans the sentence for `per <noun>` would attach `/customer` to a
plain `£480` and invent a rate the user did not state. The reader must require the `per <period>` to
follow the amount IMMEDIATELY.

## Not claimed, deliberately

`mapCqeQuantityToProposalValue` maps `percentage_points` → `'%'`. Executed: *"change churn to 3
percentage points"* and *"3pp"* both arrive as unit `'%'`. The extractor DOES keep the distinction
(`raw: "percentage_points"`); the mapper collapses it, and its comment gives a reason — the delta
operator carries the point semantics. That reasoning holds for a delta and is at least arguable for
a set, so it is recorded as an observation, not a finding. One live factor is stored as
`'percentage points'`, which `unitComparisonKey` does not equate with `'pp'`; that is a separate
question and is not being folded into this one.

## The fix, scoped — and the order it must be done in

1. **Carry what the user wrote.** A pure reader over the ORIGINAL message, next to the existing
   `deriveOperator(message, quantity)` in the same module (so the message-taking shape is not new),
   returning the period only when it immediately follows the amount. Emit the canonical `/` form, so
   `£62 per month` arrives as `£/month` and matches the stored spelling exactly.
2. **Then, and only then, fold the spellings.** `unitComparisonKey` gains the currency alphabet
   (`£` ≡ `GBP`, reusing `utils/currency-alphabet.ts`, which already owns that vocabulary) and the
   rate separator (`a per b` ≡ `a/b`), so the stored `'contacts per week'` and a proposed
   `'contacts/week'` compare equal. **Spelling only.** `£/month` ≠ `£/day`, `£` ≠ `£/month`,
   `months` ≠ `weeks`, `%` ≠ `pp` all stay refusals and are pinned as such.

Step 2 before step 1 would be a guard with no producer — nothing would ever emit the spellings it
learns to fold. This estate has paid for that shape twice.

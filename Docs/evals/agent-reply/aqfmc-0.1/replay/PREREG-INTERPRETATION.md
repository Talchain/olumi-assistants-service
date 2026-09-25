# AQ-FMC-0.1: how AI Quality applies the selection rule

- **Written:** 25 Sep 2026, about 00:40Z, **before any paired output existed**. The thresholds are the packet's own; nothing here loosens them.
- **Where two readings were possible:** the stricter one was taken.
- **Code:** `select.cjs` implements exactly this.

## Scope actually available
- **Development states:** D1, D2 and D8.
- **BLOCKED_PRECONDITION:** D3 to D7.
  - D3, D4 and D7 need the conventional run's `assistant_text`, which is Anthropic-bound under OPENAI_ONLY.
  - D5 needs producer-valid permission.
  - D6 needs a real compatible delta.
- **Held-out states:** X1 and X2.
- A state whose capture failed is reported as missing. It is never substituted.

## The rule, as applied to candidate F against reference R
1. **Hard gates.** F must PASS every assessed gate:
   - on both the RAW and the FULL view;
   - in every repeat of every state, development and held-out.
   - NOT_DECIDABLE is reported with the gate. It is not a PASS, and it does not count as a FAIL for selection.
   - If R also fails a gate, there is no acceptable winner, and that is reported.
2. **D2 intervention.** F's `useful_next_step` must be 2 in all three repeats, on both RAW and FULL.
3. **Development gain.** Take the per-state median total, out of 24, over the three repeats. The mean across D1, D2 and D8 of (F median − R median) must be at least 2. This must hold on **both** RAW and FULL.
4. **No development regression.** No development state may have an F median below R's median, on either view.
5. **Held-out.** F's median must not fall below R's on X1 or X2, on either view. X2's `useful_next_step` must be 2 in all repeats.
6. **Same call pattern.** Every F final hop must end on text, as R's did. A tool-only reply counts as a failure, not a completed reply.
7. **Latency.** The median over all paired replies of F's provider latency must be at most 110% of R's.
8. **Cost.**
   - **Price-independent test:** F's summed uncached input, cached input and output tokens must each be at most 110% of R's. Since any non-negative price card is linear in these three components, this bounds cost at 110% of R.
   - **Per-reply median cost** needs a timestamped gpt-5.6-terra price card, which is not in hand. That half is **NOT_DECIDABLE** unless the card is supplied.
   - Any state whose median exceeds 125% of R's, for latency or for tokens, is disclosed.

## Verdict
- **All of 1 to 8 hold** (with 8 met price-independently): `PROMPT_TEST_PASS`, over 5 of 10 states. The five blocked states are named as not tested.
- **Otherwise:** keep R, if R passes its own gates. If both fail, there is no acceptable winner.
- **`READY_FOR_LEASED_INTEGRATION`** also needs the exact-target route and source checks: the literal is bound on the lease head, and the stack hashes are recomputed on that head. **`G3_G4_ACCEPTED`** is the Delivery Lead's call alone.
- **Locking:** the D scores are locked by hash before any X replay is generated. X is then generated and scored the same way.

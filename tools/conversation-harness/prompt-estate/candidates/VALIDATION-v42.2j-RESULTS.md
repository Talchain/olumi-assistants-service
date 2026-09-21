# v42.2j (explain_* prompt-truth landing) validation — VERDICT: (b) NEGLIGIBLE-but-clean → APPROVED-BATCH-NEXT

**Date:** 2026-07-09 · **Setup:** v42.2g (baseline) vs v42.2j (v124, hash 7cfa59fe91cd627f) on the code-matched served tip **afed7a16**, 13-turn explanation-heavy journey (8 explanation-handler probes E1–E8 + 2 confidence sanity C1/C2). Measured the `v5.explanation.answer_verdict.answer_text_length` distribution (the directly-logged signal).

## Distribution (bring the distribution, not the mean)

| arm | n (explanation verdicts) | answer_text_length min / median / mean / max | valid=True rate |
|---|---|---|---|
| **v42.2g** | 4 | 833 / **1059** / 1036 / 1193 | 4/4 |
| **v42.2j** | ~5 | 933 / **~1145** / ~1143 / 1343 | one `explain_results` came back valid=False (user still got a substantive answer) |

Modest uptick (~8% on the median), **but within the noise**: the two arms drew different analysis states (v42.2g 92-pt margin vs v42.2j 57-pt), n is small, and one v42.2j answer was side-band-invalid.

## Substance (real answers, not padding) — spot-read
v42.2g and v42.2j E1 are **structurally identical and equally substantive**:
- v42.2g: *"…favours 'Hire One Tech Lead', with a probability of 95%. That sits ahead… by 92 percentage points, so the lead is meaningful rather than marginal. The result appears to be driven by 'Hiring Budget'…"*
- v42.2j: *"…favours 'Hire One Tech Lead', with a probability of 78%. That sits ahead… by 57 percentage points, so the lead is meaningful rather than marginal. The result appears to be driven by 'Remaining Hiring Budget'…"*

All v42.2j E1–E8 were substantive (52–228 words, grounded, no padding). **The key fact: v42.2g already writes excellent explanation answers** — the schema-*required* `action.explanation.answer_text` is well-populated on the baseline (833–1193 chars, all valid). So the misleading RUNTIME line does not measurably thin the answers.

## Gates
- **Confidence sanity: clean** — C1/C2 on the valid v42.2j run were grounded (190w/186w), no degrades (the 2 postcheck events in the log were from an earlier no-model *failed* run, not this one). The explain_* change doesn't touch the confidence rules, as expected.
- **Floor: clean** (no forbidden/mutation/held-science surfaced).
- **1 valid=False** on v42.2j (side-band flagged one `explain_results`; the user still received a substantive answer) — minor/stochastic, n=1, noted not blocking.

## Verdict → (b) APPROVED-BATCH-NEXT
v42.2j is a **correct prompt-truth fix** (the served RUNTIME's "your natural text is the answer and ships verbatim" is factually false for explanation handlers — suppressOrientation=true discards it; a latent hazard worth correcting) and is **fully clean** (no regression, confidence intact, answers substantive). But the **measured benefit is negligible** because the baseline already populates the schema-required field well. Per your three-way gate: **do not spend a dedicated upload cycle; v42.2j rides along with the next justified prompt upload.** Verify hash 7cfa59fe91cd627f on-wire when it does.

## Harness note (re-confirms the fixed-graph need)
Draft/analysis reliability bit twice this run — v42.2g's first attempt failed T01–T05 (early-boot 000s); v42.2j's first attempt returned an empty T05 analysis (500). Both needed a warm-server re-run. This re-confirms the **fixed-graph harness** is the right infrastructure for clean future rounds (esp. confidence-probe rounds where state matters). All scenarios deleted + verified gone. Not uploaded — Paul-gated.

---
## RECORD CORRECTION (2026-07-10 — post score-run.ts id-pattern fix)
The original "floor clean (0 forbidden/mutation-lang/narrow-D5)" claim was computed by `score-run.ts` on only the `^[TP]\d+` turns — i.e. **3 of 13** (T01/T04/T05); the `E1–E8`/`C1–C2` turns were silently skipped (scorer glob bug, now fixed). **Floor re-scored on all 13 turns:** forbidden **0**, narrow-D5 **0**, mutation-language **1** (E4), success-claim **1** (T04). Neither is a v42.2j regression: E4 is a `what_would_flip` answer whose hypothetical "for the other option to overtake, the factor would need to be higher" language trips `containsMutationLanguage` — an inherent what_would_flip/checker false positive that would fire on the v42.2g baseline too (filed as an eval-checker specimen); T04 is the known deterministic "Added constraint: …" post-handler receipt (already adjudicated as a receipt-vs-claim checker gap, not a claim). **Verdict unchanged: (b) NEGLIGIBLE-but-clean → APPROVED-BATCH-NEXT.** The decisive metrics (answer_text_length, confidence-degrade counts) came from the server log covering all turns and are unaffected; only the floor-claim *scope* was overstated and is corrected here.

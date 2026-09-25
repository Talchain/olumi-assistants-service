# AQ-FMC-0.1 report: R vs F, final-hop replay (AI Quality `d5d1e225`, 25 Sep 2026, about 01:20Z)

## Verdict
**NO ACCEPTABLE WINNER under the preregistered rule.** Both R and F fail hard gates.
- F is **not selected**. R stays, and R is byte-identical to CEE #1866 (C2-copy).
- **Stage reached:** `PROMPT_TEST_PASS`: **no**; `READY_FOR_LEASED_INTEGRATION`: **no**.
- F is better on 4 of 5 states and on the challenge behaviour. It regresses on held-out X1 and fails truth gates too.

## Coverage
- **Paired states** (3 repeats × 2 arms each):
  - D1: R's genuine H construction reply. The build was refused `model_too_large` (32 links, limit 30).
  - D2: H challenge on a **served** H model (c673223: 14 nodes, first analysis ran, leader withheld), replayed in-process at R. It passed a fidelity dry-run; the history is text-only.
  - D8: N construction.
  - X1 and X2: held out.
- **BLOCKED_PRECONDITION:**
  - D3 to D7: they need the conventional run's text or producer-valid permission or delta, which the in-process harness cannot produce OpenAI-only.
  - F joined H: built 16 nodes, then the first analysis dispatched a Run the double cannot answer.
  - P joined: not attempted.
- **Only `instructions` varied:** restSha was equal and asserted per case. The composer reproduced every captured R route response **byte for byte** (D1, D2, D8, X1 and X2), including non-empty server copy.
- **Order:** D scores were locked (anchored in #63 5824538277) **before** X was generated.

## Scores
Blind OpenAI judge, fresh context per case and repeat, key held separately. Median out of 24 over 3 repeats.

| State | raw R→F | full R→F | paired full diffs | gate FAILs R/F | intervention F (raw,full) | visible words R→F |
|---|---|---|---|---|---|---|
| D1 | 17→23 | 15→21 | +7, −8, +6 | 10/6 | 2,1,2 | 110→98 |
| D2 | 21→22 | 17→21 | 0, +6, +1 | 6/4 | 2,2,2 (R: 1,0,2) | 71→78 |
| D8 | 20→21 | 20→20 | +1, 0, −7 | 0/2 | 2,2,2 | 173→176 |
| X1 | 20→18 | 15→14 | −4, −1, 0 | 2/5 | 2,2,2 | 193→209 |
| X2 | 18→24 | 18→24 | +6, +3, +9 | 4/0 | 2,2,2 (R: 0,2,1) | 71→79 |

- **Judge preference:** F 10 of 15, R 5 of 15.

## The rules
- **r1 hard gates:** F FAIL (17 gate-fails); R FAIL (22).
- **r2 D2 intervention = 2 in all repeats:** PASS.
- **r3 mean development gain:** raw +2.67, full +3.33. PASS.
- **r4 no development regression:** PASS.
- **r5 held-out:** X1 regresses (raw 20→18, full 15→14). FAIL. X2's intervention is 2 in all repeats: PASS.
- **r6 same call pattern:** PASS; all 30 replies were text.
- **r7 latency:** median ratio 1.14. FAIL (the limit is 1.10). D1 is above 125% (3833 → 5111 ms).
- **r8 cost:**
  - The price-independent test FAILS as specified: uncached input is 274× R's.
  - **That is cache order, not the prompt.** R's prefix was already warm from the capture calls.
  - Totals: input F/R 1.03, output 1.08, reasoning 1.16.
  - Per-reply cost is NOT_DECIDABLE, because there is no timestamped gpt-5.6-terra price card.

## Gate failures
**Both arms produce the same kind of failure:** fine-grained fidelity, which a prompt does not fix.
- **F, D2:** "it directly reduces delivery capacity". The canonical path is onboarding_load → onboarding_diversion → delivery_capacity.
- **F, X1:** a `not_linked` note read as an assumption: "assumes it restores rather than expands capacity".
- **F, D8:** an invented "the key challenge is coverage".
- **F, D1:** "shall I build a tighter six-month model" after a refused build.
- **R, D1 and X2:** provenance and truth failures of the same kind.
- **Consequence:** the deterministic checks (unit, operator and link-path binding) matter more than another prompt candidate.

## Trace (§3)
**H, in-process at R:**
- **Represented** in the constructor's raw output: Faster delivery, Less rework, Onboarding workload and Onboarding capacity (`risks: 0`).
- **First adjacent mismatch:** constructor_raw → build result. The build was refused `model_too_large` (32 links, limit 30), so nothing reached canonical state.
- The Agent's reply then proposed dropping the "extra intermediate factors".

**H, served (c673223):**
- **Represented:** Faster delivery and Less rework as outcomes, Onboarding diversion as a risk, Onboarding load as a factor.
- **Used:** the first analysis ran (complete_current).
- **Explained:** all 6 D2 replies challenge the onboarding-load estimate (an Olumi estimate, 4 developer-hours/week).
- **Visible:** NOT_TESTED. No browser can launch in this runtime.

**N:**
- Churn and onboarding are absent at every stage: constructor, readback, and all 6 replies. One reply correctly states that they are excluded.
- Present control: 6 of 6 replies discuss retrieval or search.

## Findings for other lanes (not this lane's to fix)
1. **H construction outcome varies:**
   - refused at R in-process (1 of 1);
   - built on served (1 of 1, 14 nodes);
   - built in-process under F (16 nodes).
   The margin is small, 32 links against a limit of 30.
2. **The constructor adds options the user never gave:**
   - N: "Carry on as now" and "Index and folder pilot";
   - served H: "Continue current staffing" and "Hire one developer".
3. **Possible `readBackState` null-graph throw** (agent-v1-turn.ts, about :616) when no model exists. UNVERIFIED on staging.

## Budget and provider
- **Paid attempts: 70 of 160.**
  - capture and journeys: 25 (21 in-process, 4 served);
  - paired: 30;
  - judge: 15.
- All went to api.openai.com, with 0 blocked and Anthropic env absent in every process.
- Files: `aqfmc/captures/`, `aqfmc/replays/`, `aqfmc/judge/` (`REPORT.json`, `LOCK-*`, `KEY-*`), `aqfmc/replay/` (the scripts and PREREG).

/**
 * ⛔ THE PROVISIONAL CAVEAT MUST NEVER REDEFINE A GOAL CHANCE (AIQ #75 5902364862 (i); DL 5902362946 item 3).
 *
 * Served CEE `1f9d769`, cut-costs r0 run 1 (DL `cc-journey/run-20260930T012514Z/r0/03-run1.json`, scenario `52ebd5af`):
 * the reply says "Switch to GCP … reaches that target in 46% of simulated runs", which is the wire
 * `probability_of_goal` (0.4627). The appended `PROVISIONAL_FIGURES_CAVEAT` then told the user to "Treat each percentage
 * as how often that option fitted your goal better than the alternatives …, not as the chance the goal is achieved",
 * which DENIES a real goal chance (8 of 15 cut-costs turns; 0 of 47 MRR). AIQ's wording keeps the first sentence and
 * replaces the second with a distinction that redefines no figure on the page.
 */
import { describe, it, expect } from 'vitest';
import { PROVISIONAL_FIGURES_CAVEAT } from '../leading-option-wire-enforcement.js';

/** The served r0 reply, before the caveat (verbatim). */
const SERVED_R0_BODY = "**Switch to GCP is the provisional leading option** in this model, but the decision is not yet safe to treat as settled.\n\n- Using Olumi\u2019s unvalidated assumptions, its typical spend is about **\u00a337.0k/month**, versus the **\u00a336k/month** target; it reaches that target in **46%** of simulated runs.\n- The result rests on **16 machine-authored estimates**, not your evidence. No single assumption measurably changed which option led in this run.\n- Crucially, the analysis did **not** test your two-week migration-downtime constraint, even though it remains recorded. Resolve that gap before relying on the cost comparison.";
const FIRST = 'These figures are provisional: every estimate behind them is machine-authored and unconfirmed.';
const AIQ_SECOND = 'A share of runs in which an option fitted your goal better than the others is not the chance of reaching your target.';

describe('the provisional caveat never redefines a goal chance', () => {
  it('PREMISE: the served r0 reply states a goal chance (46%)', () => {
    expect(SERVED_R0_BODY).toContain('reaches that target in **46%** of simulated runs');
  });

  it('ROW (served r0 shape): the caveat no longer tells the user to re-read the percentages on the page', () => {
    const composed = `${SERVED_R0_BODY}\n\n${PROVISIONAL_FIGURES_CAVEAT}`;
    expect(composed).toContain('46%');
    expect(PROVISIONAL_FIGURES_CAVEAT).not.toMatch(/treat each percentage/i);
    expect(PROVISIONAL_FIGURES_CAVEAT).not.toMatch(/not as the chance the goal is achieved/i);
  });

  it("the wording is AIQ's, exactly: the first sentence kept, the second replaced", () => {
    expect(PROVISIONAL_FIGURES_CAVEAT).toBe(`${FIRST} ${AIQ_SECOND}`);
  });

  it('CONTROL (a win-share-only reply): the distinction between a win share and a goal chance is still said', () => {
    expect(PROVISIONAL_FIGURES_CAVEAT).toContain('is not the chance of reaching your target');
  });
});

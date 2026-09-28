/**
 * The PROMPT half of the decision-review provisional fix — `figures_provisional`
 * on the `winner` the reviewing model is handed.
 *
 * ⛔ WHAT THIS IS NOT. It is NOT the fix, and nothing here should be read as
 *    evidence that the defect is closed. The deterministic close is
 *    `compose/__tests__/decision-review-provisional-caveat.test.ts`, which
 *    qualifies the narrative at egress. This flag only reduces the rate at which
 *    the unqualified claim is AUTHORED — and the enricher's own docstring
 *    records the measurement that makes that distinction necessary: the sibling
 *    flag `recommendation_suppressed` was set on the POST-#710 walk and the
 *    model named a leader anyway on 5/5 withheld bodies.
 *
 * ⚠ THE PROMPT TEXT EXPLAINS NEITHER KEY. Both ride in `winner`'s JSON
 *   (`invoke.ts`: `sections.push(\`winner: ${JSON.stringify(input.winner)}\`)`).
 *   This suite therefore pins the WIRING — that the flag is threaded, derived
 *   from the admission and absent by default — and makes no claim about model
 *   behaviour, which it cannot observe.
 */
import { describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';

const BRIEF = 'Move upmarket into enterprise, or double down on self-serve SMB.';
const LEAD = 'option-a';

/** Minimal enrichment that yields a winner — the seam under test is the flag. */
const ENRICHMENT: Record<string, unknown> = {
  analysis_status: 'completed',
  option_comparison: [
    { option_id: 'option-a', option_label: 'Move Upmarket Into Enterprise', win_probability: 0.66 },
    { option_id: 'option-b', option_label: 'Double Down on Self-Serve SMB', win_probability: 0.32 },
  ],
  robustness: { level: 'low', near_tie: { is_tie: false } },
};

function build(figuresProvisional?: boolean) {
  return buildInvokeInputForTests(BRIEF, ENRICHMENT, LEAD, undefined, true, undefined, figuresProvisional);
}

describe('figures_provisional — the admission conjunct reaches the review prompt', () => {
  it('PRECONDITION — the seam produces a winner at all, so an absent flag is a real absence', () => {
    // Without this, every "flag absent" assertion below would pass vacuously on
    // a null invoke input (CLAUDE.md trap 13 — an absence probe needs to prove
    // it can see a presence).
    const input = build(undefined);
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe(LEAD);
  });

  it('threaded true ⇒ the flag is set on the winner the model is handed', () => {
    const input = build(true);
    expect(input!.winner.figures_provisional).toBe(true);
  });

  it('omitted ⇒ byte-identical invoke input (fail-open, every pre-existing caller)', () => {
    const withFlag = build(true);
    const without = build(undefined);
    expect(without!.winner.figures_provisional).toBeUndefined();
    // The flag is the ONLY difference — the rest of the prompt input is
    // unchanged, so a non-passing caller cannot have its prompt moved by this.
    expect(JSON.stringify({ ...without!.winner, figures_provisional: true })).toBe(
      JSON.stringify(withFlag!.winner),
    );
  });

  it('threaded false ⇒ no key, not a false-valued key', () => {
    // A `figures_provisional: false` in the JSON would be a new sentence to the
    // model on every fully-licensed run. Absence is the licensed state.
    expect(build(false)!.winner.figures_provisional).toBeUndefined();
  });

  it('it is a SEPARATE key from recommendation_suppressed, not a merged one', () => {
    // Two questions, two flags (CLAUDE.md trap 21). Entitlement is licensed here
    // (`mayNameLeadingOption` true), so the recommendation flag must stay absent
    // while the provisional flag is set.
    const input = build(true);
    expect(input!.winner.figures_provisional).toBe(true);
    expect(input!.winner.recommendation_suppressed).toBeUndefined();

    // Contrast: unentitled sets the OTHER flag and leaves this one alone.
    const unentitled = buildInvokeInputForTests(BRIEF, ENRICHMENT, LEAD, undefined, false, undefined, undefined);
    expect(unentitled!.winner.recommendation_suppressed).toBe(true);
    expect(unentitled!.winner.figures_provisional).toBeUndefined();
  });
});

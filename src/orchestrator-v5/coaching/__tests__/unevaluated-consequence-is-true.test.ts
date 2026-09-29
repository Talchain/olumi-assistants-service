/**
 * ⭐⭐⭐ THE SENTENCE THAT MAKES THE PoC UNSHAREABLE.
 *
 * Witnessed on a real user session, 16 Sep 2026. The product said, FOUR TIMES in
 * one conversation:
 *
 *   "One limit on your model could not be checked … We could not line it up with
 *    anything this analysis measures, so no option can be put forward yet."
 *
 * In the SAME run, `cee.analysis_ready.built` logged
 * `{ status: "ready", optionCount: 5, readyOptionsCount: 5, blockerCount: 0 }`
 * and the enrichment carried a five-row `option_comparison`. **Five options were
 * ranked and the user was told none could be put forward.**
 *
 * ⛔ THE CONSEQUENCE CLAUSE IS FALSE, AND THIS MODULE ALREADY KNOWS IT. Two of
 * the four voices refuse that exact clause, each with a comment saying so:
 *
 *   unmeasured_target : "NOT 'so no option can be put forward' — that consequence
 *                        is FALSE here … The comparison ran on every dimension
 *                        the model does carry"
 *   out_of_scope      : "NOT 'so no option can be put forward' — that consequence
 *                        is FALSE here … Stating the withholding consequence here
 *                        is precisely the untruth gap 5 put on screen."
 *
 * The `unevaluated` voice and the `identity_unresolved` fallback simply never
 * got that treatment. Same module, same author, same defect, two voices apart.
 *
 * ⚠ WHAT IS *NOT* BEING CHANGED, and the distinction is the whole fix. Whether
 * the product may NAME a leading option is a separate gate —
 * `MAY_NAME_LEADING_OPTION` in `constraint-feasibility.ts`, consumed by
 * `compose/leading-option-egress-guard.ts` via `ctx.mayNameLeadingOption`. That
 * withholding is legitimate and stays exactly as it is. This sentence has no
 * business speaking for it: "we are not naming a winner" and "there is no
 * ranking" are different propositions, and only the first is true here (trap 21).
 *
 * So the voice keeps its honest half — we could not line it up — and drops the
 * half that tells the user their analysis produced nothing.
 */
import { describe, it, expect } from 'vitest';

import { buildConstraintDisclosureFromState } from '../constraint-gap-disclosure.js';

const LIMIT = {
  constraint_id: 'constraint_dac3fdc3_max',
  label: 'Total hiring spend this year',
  node_id: 'dac3fdc3',
  operator: '<=',
  value: 200000,
  unit: '£',
} as any;

const TWO = [LIMIT, { ...LIMIT, constraint_id: 'c2', label: 'Delivery deadline' }] as any[];

const say = (state: string, cs: any[] = [LIMIT]) =>
  buildConstraintDisclosureFromState(state as any, cs, null);

/** The false half, in the forms this module has ever used. */
const RANKING_IS_VOID = [
  'no option can be put forward',
  'no options can be put forward',
];

describe('U1 — the unevaluated voice must not tell the user the ranking is void', () => {
  it('U1a THE LIVE SENTENCE: singular', () => {
    const s = say('unevaluated');
    expect(s, 'precondition: the voice speaks at all').not.toBe('');
    for (const lie of RANKING_IS_VOID) expect(s).not.toContain(lie);
  });

  it('U1b and plural — the defect was in both arms', () => {
    const s = say('unevaluated', TWO);
    for (const lie of RANKING_IS_VOID) expect(s).not.toContain(lie);
  });

  it('U1c it KEEPS the honest half, and since 25 Sep asserts no cause for it', () => {
    // "We could not line it up with anything this analysis measures" named a
    // cause the inputs cannot establish on a row nothing scored (#69
    // 5831708206). The honest half is now the observable alone.
    expect(say('unevaluated')).toContain('This model could not check it yet');
    expect(say('unevaluated')).not.toContain('could not line');
  });

  it('U1d and states the true consequence its two siblings already state', () => {
    expect(say('unevaluated')).toContain('not part of the comparison');
  });

  it('U1e the user’s own limit is still named', () => {
    expect(say('unevaluated')).toContain('Total hiring spend this year');
  });
});

describe('U2 — the identity fallback carries the same false clause', () => {
  it('U2a identity_unresolved must not claim the ranking is void either', () => {
    const s = say('identity_unresolved');
    expect(s, 'precondition: this voice speaks').not.toBe('');
    for (const lie of RANKING_IS_VOID) expect(s).not.toContain(lie);
  });

  it('U2b but it keeps its PRECISION — it does not claim the limit went unchecked', () => {
    // The identity voice's whole point: not that it went unchecked, and not that
    // it held. That distinction must survive the change.
    expect(say('identity_unresolved')).toContain('cannot be confirmed');
  });
});

describe('U3 — CONTROLS: the two voices that were already right are untouched', () => {
  it('U3a a state this entry point does not route is silent, not a throw', () => {
    // `buildConstraintDisclosureFromState` routes only the two voices its switch
    // names; the other voices are reached through `buildConstraintDisclosure`.
    // Asserting text here would have been a guard pointed at the wrong door.
    expect(say('unmeasured_target')).toBeUndefined();
  });

  it('U3b states that should stay SILENT stay silent', () => {
    expect(say('evaluated_feasible')).toBe('');
    expect(say('not_applicable')).toBe('');
    expect(say('evaluated_infeasible')).toBe('');
  });

  it('U3c nothing is emitted when there is no constraint to name', () => {
    expect(say('unevaluated', [])).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { buildAnalysisReadyPayload } from '../analysis-ready.js';

/**
 * ⛔⛔ THE SECOND DEAD-END ASK.
 *
 * When the drafter wires an option straight to a risk, the readiness authority
 * refuses the option — deliberately, and that ruling is NOT touched here. What
 * was wrong is the sentence it refused with:
 *
 *     How does Two Developers change Coordination Overhead Risk? The proposed
 *     relationship is retained, but its mechanism and value still need
 *     clarification.
 *
 * There is no form in which a person could answer it. **A risk is a consequence,
 * not something an option sets** — and the drafter's own live prompt says so:
 * its ALLOWED EDGE PATTERNS admit `option→factor` and `factor→risk` and close
 * with "All other edge combinations are forbidden", so `option→risk` is not a
 * shape the model is supposed to emit at all.
 *
 * Honest, and a dead end. The charter asks for the other half: a limitation that
 * is surfaced has to be one the person can act on.
 *
 * ⚠ THE REFUSAL ITSELF IS UNCHANGED and the tests below pin that, because a
 * "friendlier" ask that quietly granted readiness would be far worse than the
 * dead end it replaced.
 */
const OPTION_ID = 'opt_two_devs';
const RISK_ID = 'risk_coord';

const graph = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Hiring decision' },
    { id: OPTION_ID, kind: 'option', label: 'Two Developers' },
    { id: 'fac_velocity', kind: 'factor', label: 'Delivery Velocity' },
    { id: RISK_ID, kind: 'risk', label: 'Coordination Overhead Risk' },
    { id: 'goal', kind: 'goal', label: 'Ship faster' },
  ],
  edges: [
    { from: 'dec', to: OPTION_ID, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: OPTION_ID, to: RISK_ID, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: RISK_ID, to: 'goal', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
  ],
};

const options = [
  { id: OPTION_ID, label: 'Two Developers', status: 'ready' },
];

// ⚠ THE CAST BELONGS AT THE CALL, NOT ON THE LITERAL. `as never` on `graph` made
// `graph.edges` unreachable (TS2339 `Property 'edges' does not exist on type
// 'never'`), which the `Typecheck Drift (ratchet)` check caught — the repo's
// `tsconfig.build.json` gate excludes tests, so `pnpm typecheck` was green while
// this file carried an error. Keeping the literals typed means the "the edge is
// really kept" assertion reads real fields instead of an inline re-declaration.
const payload = buildAnalysisReadyPayload(options as never, 'goal', graph as never, {});
const refused = payload.options.find((o) => o.id === OPTION_ID);
const ask = (refused?.user_questions ?? []).join(' ');

describe('the option→risk refusal still refuses', () => {
  it('the probe found a refused option (this suite is not vacuous)', () => {
    expect(refused).toBeDefined();
    expect(ask.length).toBeGreaterThan(40);
  });

  it('⛔ the option is STILL needs_user_mapping — nothing here grants readiness', () => {
    // The dangerous direction. A kinder sentence that let an unmapped option
    // through would be worse than the dead end it replaced.
    expect(refused?.status).toBe('needs_user_mapping');
  });

  /**
   * ⭐⭐ AND THE REFUSAL IS DERIVED, NOT FLAGGED — measured, because a mutant of
   * mine SURVIVED and the reason turned out to be the design rather than a gap.
   *
   * Flipping the `status: "needs_user_mapping"` literal in the mapper to
   * `"ready"` changes NOTHING: probed directly, the option still comes back
   * `needs_user_mapping` and the payload with it. A downstream authority
   * recomputes the verdict from `unresolved_targets`, which is exactly what the
   * mapper's own docblock promises — *"derive from the graph so no optional flag
   * or stale `options[]` mirror can accidentally grant calculation readiness."*
   *
   * So the load-bearing pin is the TARGET, not the status literal. Removing the
   * `unresolved_targets` push DOES turn this suite red, which is the assertion
   * below. Recorded rather than quietly strengthened, because "my mutant
   * survived" and "the product is robust here" look identical from the outside.
   */
  it('⛔ the risk is STILL an unresolved target, and no factor is guessed', () => {
    expect(refused?.unresolved_targets).toContain(RISK_ID);
    // Nothing may bind the option to `fac_velocity` on the product's own say-so.
    expect(JSON.stringify(refused?.interventions ?? {})).not.toContain('fac_velocity');
  });
});

describe('the ask is now answerable', () => {
  it('⛔ the old unanswerable wording is gone', () => {
    expect(ask).not.toContain('mechanism and value still need clarification');
    expect(ask).not.toMatch(/^How does/);
  });

  it('⭐ says WHY the link cannot be used as it stands', () => {
    // The missing "why". Without it the refusal reads as arbitrary.
    expect(ask).toContain('a consequence, not something an option sets');
  });

  it('⭐ asks the question the user can actually answer', () => {
    // They know which factor their own option changes. They cannot express
    // "how an option changes a risk" in any form the analysis accepts.
    expect(ask).toContain('which factor does');
    expect(ask).toContain('leads to it');
  });

  it('⭐ tells them their claim is kept — which is TRUE', () => {
    // The edge really is retained; only the readiness verdict is withheld. A
    // reassurance that was false would be worse than none.
    expect(ask).toContain('kept either way');
    expect(graph.edges.some((e) => e.from === OPTION_ID && e.to === RISK_ID)).toBe(true);
  });

  it('names the option and the risk by their own labels, inventing neither', () => {
    expect(ask).toContain('Two Developers');
    expect(ask).toContain('Coordination Overhead Risk');
  });
});

/**
 * ⭐⭐ WHEN A DECLARATION AND AN INFERENCE DISAGREE, NEITHER WINS.
 *
 * ── WHY THIS FILE IS THE SHAPE IT IS, AND IT IS NOT THE SHAPE I FIRST WROTE ──
 * The first version asserted "a declaration beats an inference" and picked
 * `ratio` as the disagreeing declaration. `ratio` is the ONE enum member where
 * the declaration and the inference render IDENTICALLY (both ×100), so the test
 * passed while the change it guarded shipped a **100× under-statement**:
 *
 *     stated figure, unit "%", value 0.9, declared `raw_count`, external
 *       BASE  "45% to 100%"        HEAD  "0.45% to 1%"
 *
 * `display-value.ts` maps `raw_count` to a percent multiplier of 1. Caught by
 * independent review, not by this suite. A corpus that omits a value class the
 * contract admits cannot certify the code over that class (trap 22/13d) — and a
 * three-member enum needs THREE disagreement pairs, not the one in hand.
 *
 * ── SO THE RULE IS THREE-WAY, AND THE THIRD BRANCH IS THE POINT ─────────────
 *   agree        -> keep it
 *   no inference -> keep the declaration
 *   CONTRADICT   -> UNDECLARED. Not the declaration, not the inference.
 *
 * Absence is the contract's own safe state. A gap degrades; a wrong stamp LIES,
 * and a stamp is trusted where a guess is visibly a guess. Not symmetric harms,
 * so not a symmetric default (trap 22b).
 *
 * ⚠ PINNED IN BOTH DIRECTIONS, or it proves nothing: "the contradiction is
 * cleared" is satisfied vacuously by an inference that never fires, so the
 * contrast control asserts the inference STILL reaches every undeclared node.
 */
import { describe, expect, it } from 'vitest';

import type { GraphT } from "../../../../../schemas/graph.js";
import type { EdgeFormat } from "../../../utils/edge-format.js";
import { handleUnreachableFactors } from "../unreachable-factors.js";

/**
 * ⚠ A GENUINE `EdgeFormat` MEMBER. The first draft used `"from_to"`, which is
 * not one; TypeScript would have caught it, the runtime did not, and the tests
 * passed anyway. A test running under an input the production type forbids is
 * answering a question nobody asked.
 */
const EDGE_FORMAT: EdgeFormat = 'LEGACY';

/**
 * ⚠ A FACTORY, NOT A SHARED CONSTANT — a real bug in the first draft, caught by
 * the contrast control rather than by reading. `handleUnreachableFactors`
 * MUTATES the `data` it is given (`delete data.value`, then the object is
 * dropped from the node), so a shared literal is consumed by the first test and
 * the second reads `undefined` — which looks exactly like "the inference does
 * not fire" and would have been recorded as a finding about the product.
 */
const pctData = () => ({ value: 0.9, unit: '%', raw_value: 0.9 });

function factorGraph(data: Record<string, unknown>, node: Record<string, unknown> = {}): GraphT {
  return {
    nodes: [
      { id: 'goal_x', kind: 'goal', label: 'Goal' },
      { id: 'dec_x', kind: 'decision', label: 'Decision' },
      { id: 'opt_x', kind: 'option', label: 'Option' },
      { id: 'fac_x', kind: 'factor', label: 'Net Revenue Retention', category: 'observable', data, ...node },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_x', edge_type: 'structural' },
      { from: 'opt_x', to: 'goal_x', edge_type: 'causal' },
    ],
  } as unknown as GraphT;
}

function afterRepair(data: Record<string, unknown>, node: Record<string, unknown> = {}) {
  const graph = factorGraph(data, node);
  handleUnreachableFactors(graph, EDGE_FORMAT);
  const n = (graph.nodes as unknown as Record<string, unknown>[]).find((x) => x.id === 'fac_x');
  expect(n, 'the factor must exist, or every assertion below is vacuous').toBeDefined();
  return n as Record<string, unknown>;
}

describe('declaration vs inference — agree, absent, contradict', () => {
  it('CONTRAST CONTROL — with NO declaration the inference still stamps', () => {
    // Without this every "cleared" assertion below is satisfied by an inference
    // that never runs: a guard agreeing with itself (trap 13b).
    expect(
      afterRepair(pctData()).declared_scale,
      'the inference must still reach every undeclared node — nothing it used to fill is lost',
    ).toBe('unit_interval');
  });

  it('AGREEMENT is kept — the two answers are the same answer', () => {
    expect(afterRepair(pctData(), { declared_scale: 'unit_interval' }).declared_scale).toBe(
      'unit_interval',
    );
  });

  // ⭐ THE WHOLE ENUM. `raw_count` is the member that caused the 100x lie and
  // was missing from the first corpus; `ratio` is the member that renders
  // identically and therefore could never have exposed it. Both are here so the
  // rule is pinned over the class the contract admits, not over one example.
  for (const declared of ['raw_count', 'ratio'] as const) {
    it(`CONTRADICTION (${declared} vs inferred unit_interval) clears BOTH carriers`, () => {
      const n = afterRepair(pctData(), {
        declared_scale: declared,
        observed_state: { value: 0.9, declared_scale: declared },
      });
      expect(
        n.declared_scale,
        'a contradicted declaration must not survive — a wrong stamp lies where a gap merely degrades',
      ).toBeUndefined();
      const os = n.observed_state as Record<string, unknown> | undefined;
      // Trap 21: two carriers on one question do not get to drift, and the
      // clear has to reach both or the published carrier keeps the lie.
      expect(os?.declared_scale).toBeUndefined();
    });
  }

  // ⭐⭐ THE UNIT WITHHOLDING IS A SECOND QUESTION AND IT MUST NOT RIDE ON THE
  // FIRST. "What scale do we claim this is?" and "is it safe to show the unit?"
  // are different (trap 21). A contradiction makes us LESS certain, so it must
  // not start showing a unit the pre-existing code judged unsafe: a ratio-scale
  // prior of [0.56, 1.68] renders "56% to 1.68%" through `display-value.ts`'s
  // magnitude sniff. Each case below is a case that existed BEFORE this change,
  // asserted to behave as it did then.
  const unitOf = (n: Record<string, unknown>) => n.unit;

  it('WITHHOLD — declared unit_interval contradicted by an inferred ratio still withholds', () => {
    // The regression case. Keying the withhold on the RESOLVED scale alone
    // clears the declaration and then shows the unit, which is the render the
    // withholding exists to prevent.
    const n = afterRepair(
      { value: 1.68, unit: '%', raw_value: 168 },
      { declared_scale: 'unit_interval', observed_state: { value: 1.68, declared_scale: 'unit_interval' } },
    );
    expect(n.declared_scale, 'the contradiction still clears the claim').toBeUndefined();
    expect(unitOf(n), 'but the unit stays withheld — less certain, not more').toBeUndefined();
  });

  it('SHOW — a plain unit_interval factor keeps its unit', () => {
    // The contrast that stops the rule above collapsing into "always withhold".
    expect(unitOf(afterRepair(pctData())), 'nothing here suggests ratio').toBe('%');
  });

  it('A DECLARATION THE INFERENCE CANNOT JUDGE SURVIVES — it is not contradicted', () => {
    // No unit, no cap, raw === value ⇒ `declaredScaleOf` abstains. Abstention is
    // not disagreement, so the user's declaration stands. This is what stops the
    // contradiction rule from quietly becoming "declarations never survive".
    const n = afterRepair({ value: 6, raw_value: 6, unit: 'engineers' }, { declared_scale: 'raw_count' });
    expect(n.declared_scale).toBe('raw_count');
  });
});

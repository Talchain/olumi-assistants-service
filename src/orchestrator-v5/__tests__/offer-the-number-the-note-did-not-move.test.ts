/**
 * ⭐⭐⭐ THE DISCLOSURE SAYS THE NUMBER DID NOT MOVE. IT MUST ALSO OFFER TO MOVE IT.
 *
 * ── THE WITNESS. Deployed staging, capture `d9c4066c`, 19 Sep, node `cc057894`:
 *
 *     user    : "We are confident that the product quality WILL BE very high."
 *     user    : "Yes, please add 'very high' to product quality."
 *     product : "Added a note to Product Quality"
 *     graph   : observed_state { value: 0.5, source: "cee_inference" }
 *
 * #1618 (merged, serving) closed HALF of this: the receipt now says the number
 * did not move and quotes the person. What it still does not do is let them
 * move it. Today's only chip asks the question back — "What value should
 * Product Quality take?" — so the person must type a bare number, which is the
 * input class with a known mis-targeting defect (#1251).
 *
 * ── WHY THIS IS THE SANCTIONED SHAPE AND NOT AN INTERPRETATION. The ruling is
 * "QUALITATIVE → recognised, NEVER interpreted": the product may not decide
 * that "very high" MEANS 0.9. It may recognise the band the person's own word
 * names and offer that band's points for THEM to pick. The points are derived
 * by round-tripping through `qualitativeBand`, never a copied table, so if the
 * banding rule moves they move with it.
 *
 * ── AND IT SIDESTEPS THE CONSENT GAP RATHER THAN WIDENING IT. Routing
 * `add <level> to <factor>` into the value lane is a consent-semantics change
 * that needs its own review seat. This does not touch it: the chip emits
 * "Set <label> to <n>", and `set` is already a value-lane verb, so the
 * existing working path handles it and writes `user_override`. Pinned below
 * against the ROUTER ITSELF, not against a regex written here.
 */
import { describe, expect, it } from 'vitest';

import { isValueUpdatePhrasing } from '../../orchestrator/routing/value-update-gate.js';
import { qualitativeBand } from '../../cee/factor-extraction/display-value.js';
import {
  detectStatedLevelDivergences,
  buildStatedLevelDivergenceActions,
} from '../stated-level-divergence.js';

const AUTHORED_PROSE_KEYS = ['description', 'body', 'notes'] as const;

/** The captured node, at its captured level. */
const GRAPH = {
  nodes: [
    {
      id: 'cc057894',
      kind: 'factor',
      label: 'Product Quality',
      // ⚠ NO `unit`, DELIBERATELY. `resolveFactorScale` answers `measured` the
      // moment a unit, `raw_value` or `cap` is present — so a node carrying
      // `unit: 'scale'` is NOT unit-interval, and the band chips must not be
      // offered for it. This fixture is the genuinely unit-interval positive
      // case the review asked for; the measured negative control is below.
      observed_state: { value: 0.5, source: 'cee_inference' },
      display_value: '0.5',
    },
    {
      id: 'other',
      kind: 'factor',
      label: 'Trial-to-Paid Conversion Rate',
      observed_state: { value: 0.12, unit: '%', source: 'cee_inference' },
      display_value: '0.12 %',
    },
    /**
     * ⛔ THE REVIEW'S WITNESS (comment 5746659704), as a MEASURED negative
     * control. A salary is a magnitude, not a position on 0-1, so "very high"
     * about it bounds nothing this product can encode. Offering
     * `Set Annual Salary to 0.8` would ask the person to confirm a frame
     * nobody established, and their click would launder it into evidence.
     *
     * ⚠ THE FIGURE IS DELIBERATELY SYNTHETIC AND THE REVIEW'S REAL ONE IS NOT
     * REPRODUCED HERE. This repository is PUBLIC, the witness was derived from
     * a real captured session, and the test's discriminating power is in the
     * SHAPE — a measured `£` magnitude with a level word about it — never in
     * the digits. A round placeholder keeps the control exact and puts no real
     * salary in a public tree. (Sibling remediation the same night: UI #1787,
     * a real model readable on a public branch.)
     */
    {
      id: 'salary',
      kind: 'factor',
      label: 'Annual Salary',
      observed_state: { value: 100000, unit: '£', source: 'cee_inference' },
      display_value: '£100,000',
    },
  ],
};

const opWithProse = (path: string, prose: string) => ({
  op: 'update_node',
  path,
  value: { description: prose },
});

/** The prose the product actually wrote on the witnessed turn. */
const WITNESSED_PROSE = 'Current product quality is assessed as very high.';

function actionsFor(prose: string, path = 'cc057894') {
  const d = detectStatedLevelDivergences([opWithProse(path, prose)], GRAPH, [
    ...AUTHORED_PROSE_KEYS,
  ]);
  return { divergences: d, actions: buildStatedLevelDivergenceActions(d) };
}

describe('a note that left the number alone offers the number', () => {
  it('PRECONDITION: the fixture reproduces the witnessed divergence', () => {
    // 13b — without this every assertion below could pass or fail for a
    // reason unrelated to the change.
    const { divergences } = actionsFor(WITNESSED_PROSE);
    expect(divergences).toHaveLength(1);
    expect(divergences[0]!.label).toBe('Product Quality');
    expect(divergences[0]!.currentDisplay).toBe('0.5');
  });

  it('⭐ THE WITNESS: the person is offered points in the band their own word named', () => {
    const { actions } = actionsFor(WITNESSED_PROSE);
    const offers = actions.filter((a) => /^Set Product Quality to /.test(a.prompt));
    expect(offers.length).toBeGreaterThan(0);
    // Every offered number really is in the band the person said — derived
    // from `qualitativeBand`, so this cannot drift from the product's own
    // banding rule.
    for (const a of offers) {
      const n = Number(/to ([0-9.]+)/.exec(a.prompt)![1]);
      expect(Number.isFinite(n)).toBe(true);
      expect(qualitativeBand(n)).toBe('Very high');
    }
  });

  it('⭐ the offer is bound to the REAL router, not to a string written here', () => {
    // If the value lane's verb list ever moves, this REDs — the chip would be
    // producing another note, which is the defect it exists to close.
    const { actions } = actionsFor(WITNESSED_PROSE);
    const offers = actions.filter((a) => /^Set Product Quality to /.test(a.prompt));
    // ⚠ NOT VACUOUS. With zero offers this assertion would pass by testing
    // nothing — which is exactly what it did at pristine.
    expect(offers.length).toBeGreaterThan(0);
    for (const a of offers) {
      expect(isValueUpdatePhrasing(a.prompt), a.prompt).toBe(true);
    }
  });

  it('the existing "what value?" chip SURVIVES — a person who wants another number still can', () => {
    const { actions } = actionsFor(WITNESSED_PROSE);
    expect(actions.some((a) => a.prompt === 'What value should Product Quality take?')).toBe(true);
  });

  it('CONTROL: prose naming no level keeps today’s bytes exactly', () => {
    const { actions } = actionsFor('Noted for later review.');
    expect(actions).toEqual([
      {
        label: 'Set a value for Product Quality',
        prompt: 'What value should Product Quality take?',
        role: 'facilitator',
      },
    ]);
  });

  it('CONTROL: "very high" beats "high" — longest match, not first match', () => {
    const { actions } = actionsFor('The team assessed this as very high.');
    const offers = actions.filter((a) => /^Set Product Quality to /.test(a.prompt));
    expect(offers.length).toBeGreaterThan(0);
    for (const a of offers) {
      const n = Number(/to ([0-9.]+)/.exec(a.prompt)![1]);
      expect(qualitativeBand(n)).toBe('Very high');
      expect(qualitativeBand(n)).not.toBe('High');
    }
  });

  it('CONTROL: a bare "high" offers the High band, not the Very high one', () => {
    const { actions } = actionsFor('Quality here is high.');
    const offers = actions.filter((a) => /^Set Product Quality to /.test(a.prompt));
    expect(offers.length).toBeGreaterThan(0);
    for (const a of offers) {
      const n = Number(/to ([0-9.]+)/.exec(a.prompt)![1]);
      expect(qualitativeBand(n)).toBe('High');
    }
  });

  it('CONTROL: the offer never invents a number outside the product’s own grid', () => {
    // The ruling is "recognised, never interpreted". The product may not decide
    // what the word is worth; it may only offer points it already banded.
    for (const prose of [WITNESSED_PROSE, 'Quality here is high.', 'This is low.']) {
      const { actions } = actionsFor(prose);
      for (const a of actions.filter((x) => /^Set Product Quality to /.test(x.prompt))) {
        const n = Number(/to ([0-9.]+)/.exec(a.prompt)![1]);
        expect([0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]).toContain(n);
      }
    }
  });
});

describe('a band chip is offered only where the band is a real quantity', () => {
  /**
   * ⛔⛔ THE REVIEW'S P1, REPRODUCED. The first cut copied `offersForBand` and
   * left behind the gate that guards it, so a MEASURED factor earned numeric
   * chips on the 0-1 scale. `resolveUnappliedEditUnderstanding` has always
   * gated this on `resolveFactorScale === 'unit_interval'`; this surface now
   * consults the same function rather than a second copy of the decision.
   */
  it('⛔ MEASURED: "Annual Salary is very high" on £85,000 offers NO band numbers', () => {
    const divergences = detectStatedLevelDivergences(
      [{ op: 'update_node', path: 'salary', value: { note: 'Annual Salary is very high' } }],
      GRAPH,
      ['note'],
    );
    expect(divergences, 'the divergence itself is still detected').toHaveLength(1);

    // ⭐ THE LEAK ASSERTION COMES FIRST, ON PURPOSE. Checking `scale` first
    // would make this test RED at pristine merely because the field is new,
    // which proves nothing about the behaviour. Asserting the OFFERS first
    // means the pristine failure is the defect itself — "Set Annual Salary to
    // 0.8" reaching a person whose salary is £85,000.
    const actions = buildStatedLevelDivergenceActions(divergences);
    const numeric = actions.filter((a) => /Set Annual Salary to [0-9]/.test(a.label));
    expect(numeric, 'no 0-1 point may be proposed for a measured amount').toEqual([]);
    expect(divergences[0]!.scale).toBe('measured');
    // ...and the person is NOT left with nothing: the generic clarification
    // survives, which is the whole reason suppression is safe here.
    expect(actions.some((a) => a.label === 'Set a value for Annual Salary')).toBe(true);
  });

  it('⭐ UNIT-INTERVAL: the same prose on a genuinely 0-1 factor still offers the band', () => {
    const divergences = detectStatedLevelDivergences(
      [{ op: 'update_node', path: 'cc057894', value: { note: 'Product Quality is very high' } }],
      GRAPH,
      ['note'],
    );
    expect(divergences[0]!.scale).toBe('unit_interval');
    const actions = buildStatedLevelDivergenceActions(divergences);
    expect(
      actions.filter((a) => /Set Product Quality to [0-9]/.test(a.label)).length,
      'the gate must not suppress the case it was written to allow',
    ).toBeGreaterThan(0);
  });

  /**
   * The third answer is its own case. `unknown` is not `unit_interval`, and
   * treating absence as permission is how a guard quietly stops guarding.
   */
  it('⛔ UNKNOWN scale offers no band numbers either', () => {
    const graph = {
      nodes: [
        {
          id: 'mystery',
          kind: 'factor',
          label: 'Mystery Factor',
          observed_state: { value: 42, source: 'cee_inference' },
          display_value: '42',
        },
      ],
    };
    const divergences = detectStatedLevelDivergences(
      [{ op: 'update_node', path: 'mystery', value: { note: 'Mystery Factor is very high' } }],
      graph,
      ['note'],
    );
    const actions = buildStatedLevelDivergenceActions(divergences);
    expect(actions.filter((a) => /Set Mystery Factor to [0-9]/.test(a.label))).toEqual([]);
    expect(divergences[0]!.scale).toBe('unknown');
  });
});

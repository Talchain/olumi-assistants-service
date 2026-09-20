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
      observed_state: { value: 0.5, unit: 'scale', source: 'cee_inference' },
      display_value: '0.5 scale',
    },
    {
      id: 'other',
      kind: 'factor',
      label: 'Trial-to-Paid Conversion Rate',
      observed_state: { value: 0.12, unit: '%', source: 'cee_inference' },
      display_value: '0.12 %',
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
    expect(divergences[0]!.currentDisplay).toBe('0.5 scale');
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

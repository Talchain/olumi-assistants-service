/** P14 RED-first contracts. Science's 7 Oct ruling; no production exports stubbed or skipped. */
import { describe, expect, it } from 'vitest';
import * as mod from '../widen-turn.js';
import { currentDefinitionalCarrier, endsOfGraph, heldLinkOf } from '../../../goal-target/held-user-links.js';

type Rec = Record<string, unknown>;
type Gate = { kept: { label: string; category: string; press: { id: string; message: string } }[];
  dropped: { index: number; failed: string[] }[] };
type Settled = { reply: string; gate: Gate; actions: { id: string; label: string; message: string }[] };
type Door = 'factors' | 'outcomes';
const api = mod as Record<string, unknown>;
// FIRST assertion in every gate row: missing implementation is an assertion failure, never a missing named import.
const fn = <T extends (...args: never[]) => unknown>(name: string): T => {
  expect(typeof api[name], `P14 missing widen-turn export: ${name}`).toBe('function');
  return api[name] as T;
};
const gateFn = (door: Door) => fn<(turn: unknown, items: unknown) => Gate>(door === 'factors' ? 'factorGate' : 'outcomeGate');
const settleFn = (door: Door) => fn<(turn: unknown, draft: string) => Settled>(door === 'factors' ? 'settleFactorsTurn' : 'settleOutcomesTurn');
const turnOn = (door: Door, graph = seed()) =>
  fn<(rb: { graph: unknown }) => unknown>(`${door}TurnForReadback`)({ graph });
const method = (door: Door) => {
  const name = door === 'factors' ? 'FACTOR_METHOD' : 'OUTCOME_METHOD';
  expect(api[name], `P14 missing ${name}`).toBeTypeOf('object');
  return api[name] as { id: string; categories: string[] };
};
const seed = () => ({
  goal_node_id: 'goal', goal_constraints: [],
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Sustainable business', goal_threshold: 0.8 },
    { id: 'profit', kind: 'outcome', label: 'profit', unit: 'GBP', observed_state: { value: 0.4, unit: 'GBP' } },
    { id: 'revenue', kind: 'factor', label: 'revenue', category: 'external', observed_state: { value: 0.6, unit: 'GBP' } },
    { id: 'cost', kind: 'factor', label: 'cost', category: 'external', observed_state: { value: 0.2, unit: 'GBP' } },
    { id: 'lever', kind: 'factor', label: 'Service capacity', category: 'controllable', observed_state: { value: 0.3 } },
    { id: 'option', kind: 'option', label: 'Expand service', interventions: { lever: { value: 0.7 } } },
    { id: 'risk', kind: 'risk', label: 'Service interruption' },
  ],
  edges: [
    { from: 'revenue', to: 'profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8 },
    { from: 'cost', to: 'profit', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.8 },
    { from: 'profit', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8 },
  ],
});
const candidate = (door: Door, over: Rec = {}, categoryIndex = 0): Rec => ({
  label: door === 'factors' ? 'Customer retention' : 'Team morale',
  category: method(door).categories[categoryIndex], direction: 'positive', since: 'steadier relationships support the work',
  ...(door === 'factors' ? { anchor_id: 'profit' } : { from_id: 'revenue' }), ...over,
});
const appendix = (door: Door, items: unknown) => `<${door === 'factors' ? 'factor' : 'outcome'}_suggestions>${JSON.stringify(items)}</${door === 'factors' ? 'factor' : 'outcome'}_suggestions>`;
const labels = (g: Gate) => g.kept.map((x) => x.label);
const methodLine = (door: Door) => door === 'factors'
  ? 'I looked for what else could drive ‘profit’, across customers and demand, money and price, people and capacity, timing, how the work is done, and outside conditions (influence-diagram elicitation).'
  : 'I looked at what else could follow from ‘revenue’, across money, customers, people, time, reputation and future options (objective generation).';
const caveat = (door: Door) => door === 'factors'
  ? 'Possible drivers to consider, not established causes.' : 'Possible consequences to consider, not predictions.';

describe('P14 press identity', () => {
  it('PI-F: DGAI factor press opens factors', () => {
    expect(mod.widenTargetOf('ask:missing-factor', 'What else could change how this turns out that the model doesn’t have yet?')).toBe('factors');
  });
  it('PI-O: DGAI outcome press opens outcomes', () => {
    expect(mod.widenTargetOf('ask:missing-outcome', 'Where else could this lead that the model doesn’t have yet?')).toBe('outcomes');
  });
});

for (const door of ['factors', 'outcomes'] as const) {
  const prefix = door === 'factors' ? 'FD' : 'OD';
  describe(`P14 ${door} identity gate and deterministic reply`, () => {
    it(`${prefix}-NO-DUP pair: fold-equal dropped; distinct label kept`, () => {
      const gate = gateFn(door); const t = turnOn(door);
      expect(labels(gate(t, [candidate(door, { label: '  ReVeNuE  ' })]))).toEqual([]);
      expect(labels(gate(t, [candidate(door)]))).toEqual([door === 'factors' ? 'Customer retention' : 'Team morale']);
    });
    for (const field of ['label', 'since'] as const) {
      it(`${prefix}-NO-FIGURE ${field}: digit dropped; no-digit control kept`, () => {
        const gate = gateFn(door); const t = turnOn(door);
        expect(labels(gate(t, [candidate(door, { [field]: field === 'label' ? 'Retention phase 2' : 'relationships last 2 years' })]))).toEqual([]);
        expect(labels(gate(t, [candidate(door)]))).toEqual([door === 'factors' ? 'Customer retention' : 'Team morale']);
      });
    }
    it.each(['key', 'main', 'top', 'root cause', 'the real', 'best', 'winner', 'recommend', 'ahead', 'beats', 'leader',
      'you missed', 'incomplete', 'all the drivers', 'complete', 'will', 'proven', 'likely', 'probably', 'hidden risks',
      'unintended consequences', 'most important', 'primary', 'the answer', 'you forgot', 'your model is wrong',
      'the complete list', 'everything that matters', 'research shows'])
    (`${prefix}-WORDS: "%s" dropped in label AND since; neutral control kept`, (word) => {
      const gate = gateFn(door); const t = turnOn(door);
      for (const field of ['label', 'since']) expect(labels(gate(t, [candidate(door, { [field]: `${word} relationships` })])), field).toEqual([]);
      expect(labels(gate(t, [candidate(door)]))).toEqual([door === 'factors' ? 'Customer retention' : 'Team morale']);
    });
    it(`${prefix}-CATEGORY: six categories; distinct categories, at most three exact items`, () => {
      const gate = gateFn(door); const t = turnOn(door); const m = method(door);
      expect(m.categories).toHaveLength(6);
      expect(new Set(m.categories).size).toBe(6);
      expect(api[door === 'factors' ? 'FACTOR_MAX_ITEMS' : 'OUTCOME_MAX_ITEMS']).toBe(3);
      const items = ['Customer retention', 'Supplier flexibility', 'Team morale', 'Schedule slack']
        .map((label, i) => candidate(door, { label }, i));
      expect(labels(gate(t, items))).toEqual(['Customer retention', 'Supplier flexibility', 'Team morale']);
      expect(labels(gate(t, [items[0], { ...items[1], category: m.categories[0] }]))).toEqual(['Customer retention']);
      expect(labels(gate(t, [candidate(door, { category: 'unrecognised' })]))).toEqual([]);
    });
    it(`${prefix}-WORDS cap: thirteen-word since dropped; twelve-word control kept`, () => {
      const gate = gateFn(door); const t = turnOn(door);
      const words = 'steadier customer relationships support the team through long periods of changing outside conditions';
      expect(labels(gate(t, [candidate(door, { since: words })]))).toEqual([]);
      expect(labels(gate(t, [candidate(door, { since: words.split(' ').slice(0, 12).join(' ') })])))
        .toEqual([door === 'factors' ? 'Customer retention' : 'Team morale']);
    });
    it(`${prefix}-METHOD: named method and uncertainty lines VERBATIM`, () => {
      const settle = settleFn(door); const t = turnOn(door);
      expect(method(door).id).toBe(door === 'factors' ? 'influence_diagram_elicitation' : 'objective_generation');
      const s = settle(t, appendix(door, [candidate(door)]));
      expect(labels(s.gate)).toEqual([door === 'factors' ? 'Customer retention' : 'Team morale']);
      expect(s.reply.split('\n')).toContain(methodLine(door));
      expect(s.reply).toContain(caveat(door));
      expect(s.actions.map((a) => a.label)).toEqual([`Add ‘${s.gate.kept[0]!.label}’`, 'Something else']);
    });
    it(`${prefix}-RX: twenty-thousand whitespace in candidate words stays bounded and is dropped`, () => {
      const gate = gateFn(door); const t = turnOn(door);
      const time = (n: number) => {
        let best = Infinity;
        for (let i = 0; i < 5; i++) {
          const item = candidate(door, { since: `${' '.repeat(n)}probably` });
          const start = performance.now(); expect(labels(gate(t, [item]))).toEqual([]);
          best = Math.min(best, performance.now() - start);
        }
        return best;
      };
      const small = time(5_000); const big = time(20_000);
      expect((big + 0.05) / (small + 0.05)).toBeLessThan(8);
    });
  });
}

it('FD-NOT-DEFINED: profit = revenue − cost has held definitional carriers; redirect verbatim; revenue control gives items', () => {
  const gate = gateFn('factors'); const settle = settleFn('factors');
  const g = seed();
  g.edges = g.edges.map((e) => e.to !== 'profit' ? e : ({ ...e,
    strength: { mean: e.from === 'cost' ? -1 : 1, std: 0.01 }, exists_probability: 1,
    provenance: { source: 'user_specified', definitional: true, natural_effect: {
      amount: e.from === 'cost' ? -1 : 1, amount_unit: 'GBP', per_source_change: 1, per_source_change_unit: 'GBP',
      strength_mean: e.from === 'cost' ? -1 : 1,
      stated_range: e.from === 'cost' ? { low: -1.01, high: -0.99 } : { low: 0.99, high: 1.01 },
    } },
  }));
  // Profit/revenue/cost do not fold to the same quantity label: the stated-range hold keeps these carriers held.
  const ends = endsOfGraph(g);
  for (const e of g.edges.filter((e) => e.to === 'profit')) {
    expect(currentDefinitionalCarrier(e)).toBe('GBP');
    expect(heldLinkOf(e, ends(e))?.reason).toBe('user_range');
  }
  const t = turnOn('factors', g);
  expect(labels(gate(t, [candidate('factors')]))).toEqual([]);
  expect(settle(t, appendix('factors', [candidate('factors')])).reply)
    .toBe('‘profit’ is worked out from ‘revenue’ and ‘cost’, so a new cause would act on one of those. Press + on one of them.');
  expect(labels(gate(t, [candidate('factors', { anchor_id: 'revenue' })]))).toEqual(['Customer retention']);
});

it('OD-FROM / OD-NOT-GOAL: existing factor or outcome only; never the goal, option, risk or unknown id', () => {
  const gate = gateFn('outcomes'); const t = turnOn('outcomes');
  for (const from_id of ['revenue', 'lever', 'profit']) expect(labels(gate(t, [candidate('outcomes', { from_id })]))).toEqual(['Team morale']);
  for (const from_id of ['goal', 'option', 'risk', 'unknown']) expect(labels(gate(t, [candidate('outcomes', { from_id })])), from_id).toEqual([]);
});

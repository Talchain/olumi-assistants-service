import { describe, expect, it } from 'vitest';
import { disclosuresFor, withDisclosures } from '../../agent-lane/disclosure.js';
import { GOAL_INDEX_WEIGHTS_ASSUMED, indexGoalWeightsNoteOf, withIndexGoalWeightsNote } from '../index-goal-weights-note.js';

type Rec = Record<string, unknown>;
const node = (id: string, kind = 'outcome'): Rec => ({ id, kind, label: id });
const edge = (from: string, provenance: Rec = { magnitude: 'olumi_estimate' }): Rec =>
  ({ from, to: 'g', strength: { mean: 0.5, std: 0.1 }, provenance });
const graph = (edges: Rec[] = [edge('A'), edge('B')], goal: Rec = {}): Rec =>
  ({ nodes: [node('A'), node('B'), node('C'), { id: 'g', kind: 'goal', label: 'Shared progress', ...goal }], edges });
const message = (list = '‘A’ and ‘B’'): string =>
  `How much each of ${list} counts towards ‘Shared progress’ is Olumi's assumption, not your stated priority. Set them to match what matters to you.`;

describe('index goal methods note', () => {
  it.each([{ goal_threshold_unit: 'hours' }, { observed_state: { unit: '£/month' } },
    { goal_threshold_unit: '', observed_state: { unit: '%' } }])('a unit goal gives no note: %j', (goal) => {
    expect(indexGoalWeightsNoteOf(graph(undefined, goal), 'g')).toBeNull();
  });
  it('zero or one Olumi link gives no note; two give the exact words and link identities', () => {
    expect(indexGoalWeightsNoteOf(graph([]), 'g')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph([edge('A')]), 'g')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph(), 'g')).toEqual({
      code: GOAL_INDEX_WEIGHTS_ASSUMED, severity: 'info', message: message(), goal_id: 'g',
      links: [{ from: 'A', to: 'g' }, { from: 'B', to: 'g' }],
    });
  });
  it('three links use curly quotes and the ruled list', () => {
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('B'), edge('C')]), 'g')?.message)
      .toBe(message('‘A’, ‘B’ and ‘C’'));
  });
  it('a definitional link is excluded, including from the named list', () => {
    const definition = edge('C', { magnitude: 'olumi_estimate', definitional: true });
    expect(indexGoalWeightsNoteOf(graph([edge('A'), definition]), 'g')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('B'), definition]), 'g')?.message).toBe(message());
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('C', { magnitude: 'olumi_estimate', definitional: false })]), 'g')?.message)
      .toBe(message('‘A’ and ‘C’'));
  });
  it.each([{ source: 'user_specified', magnitude: 'olumi_estimate' }, { magnitude: 'user_stated' }])(
    'a user-set link is excluded by the existing sizing predicate: %j', (provenance) => {
      const user = { ...edge('C', provenance), defaulted: true };
      expect(indexGoalWeightsNoteOf(graph([edge('A'), user]), 'g')).toBeNull();
      expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('B'), user]), 'g')?.message).toBe(message());
    },
  );
  it.each([
    { magnitude: 'olumi_placeholder' },
    { magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } },
  ])('acceptance keeps Olumi authorship and placeholders count: %j', (provenance) => {
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('B', provenance)]), 'g')?.message).toBe(message());
  });
  it('the existing predicate includes old defaults, but no unmarked authorship is invented', () => {
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('B', {})]), 'g')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph([edge('A'), { ...edge('B', {}), defaulted: true }]), 'g')?.message).toBe(message());
  });
  it('uses the scored goal, only its incoming links, and source labels from the same graph', () => {
    expect(indexGoalWeightsNoteOf(graph(), 'other')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph([edge('A'), { ...edge('B'), to: 'other' }]), 'g')).toBeNull();
    expect(indexGoalWeightsNoteOf(graph([edge('A'), edge('missing')]), 'g')).toBeNull();
    const g = graph();
    (g.nodes as Rec[])[0]!.label = 'Evidence quality';
    expect(indexGoalWeightsNoteOf(g, 'g')?.message).toBe(message('‘Evidence quality’ and ‘B’'));
  });
  it('the info record rides the Run carrier and the owed path says it once without rewriting text', () => {
    const env = { inference_warnings: [{ code: 'EXISTING' }] };
    const out = withIndexGoalWeightsNote(env, graph(), 'g');
    expect(env.inference_warnings).toEqual([{ code: 'EXISTING' }]);
    expect(out.inference_warnings).toEqual([env.inference_warnings[0], indexGoalWeightsNoteOf(graph(), 'g')]);
    const result = { enrichment: out, inference_warnings: out.inference_warnings };
    const runs = [{ mutated: false, ran: true, result }, { mutated: false, ran: true, result }];
    expect(disclosuresFor(runs)).toEqual([message()]);
    expect(withDisclosures('The analysis ran.', disclosuresFor(runs))).toBe(`The analysis ran.\n\n${message()}`);
    expect(disclosuresFor(runs, `The analysis ran. ${message()}`)).toEqual([]);
    expect(disclosuresFor([{ mutated: false, ran: false, result }])).toEqual([]);
    expect(withIndexGoalWeightsNote(env, graph(undefined, { goal_threshold_unit: 'hours' }), 'g')).toBe(env);
  });
});

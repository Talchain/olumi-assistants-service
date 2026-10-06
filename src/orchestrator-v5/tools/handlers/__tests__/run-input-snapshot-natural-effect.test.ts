/**
 * ⭐ SD-1 cut 7 (schemas 0.78, lease #87 6008093205): the Run's snapshot records each link's size in the user's terms.
 *
 * WRITER — lands only once prod CEE serves 0.78 (DL order ruling, 6 Oct): CEE strictly re-parses stored facts, and staging
 * and prod share one database, so a 0.77 reader refuses a fact carrying this field.
 *
 * Rule: copy the edge's own `provenance.natural_effect` (no new carrier) — only while it still DESCRIBES the edge (the F1
 * guard's own test, `naturalEffectDescribesEdge`: its `strength_mean` equals the mean, or a stored clamp records it), only
 * when the Run was SENT that edge's mean, only for a point size (a range end's text is never recorded), and only the four
 * user-terms members (the engine `strength_mean` / frame never). A size the contract refuses is left out for that link
 * alone, never the whole snapshot.
 */
import { describe, expect, it } from 'vitest';

import { buildRunInputSnapshot } from '../run-input-snapshot.js';
import { userFigureHeld } from '../../../../cee/magnitude/user-figure-held.js';

const SIZE = { amount: 2, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: 'percentage point' };
const graph = (mean: number) => ({
  nodes: [
    { id: 'goal_mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 150000, goal_threshold_unit: 'GBP per month', goal_direction: '>=' },
    { id: 'fac_rise', kind: 'factor', label: 'Price rise', observed_state: { value: 0.1, raw_value: 10, unit: '%', source: 'user_override' } },
    { id: 'fac_lost', kind: 'factor', label: 'Customers lost', observed_state: { value: 0.3, raw_value: 30, unit: 'customers', source: 'cee_inference' } },
    { id: 'opt_raise', kind: 'option', label: 'Raise 10%' },
  ],
  edges: [{ from: 'fac_rise', to: 'fac_lost', strength: { mean, std: 0.1 } }],
});
const persisted = (mean: number, provenance: Record<string, unknown>) =>
  [{ from: 'fac_rise', to: 'fac_lost', strength: { mean, std: 0.1 }, provenance }];
const userStated = (natural_effect: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ source: 'user_specified', magnitude: 'user_stated', natural_effect, ...extra });
const snapshot = (wireMean: number, persistedEdges: unknown[]) => buildRunInputSnapshot({
  submittedOptions: [{ option_id: 'opt_raise', label: 'Raise 10%' }, { option_id: 'opt_hold', label: 'Hold', is_baseline: true }],
  rawObjectsPerOption: [{ fac_rise: { value: 0.1, raw_value: 10, unit: '%', source: 'user_override' } }, {}],
  wirePerOption: [{ fac_rise: 0.1 }, {}],
  heldFactorIdsByOptionId: new Map(),
  optionsNotSent: [],
  wireGraph: graph(wireMean),
  plotPayload: { graph: graph(wireMean), options: [], goal_node_id: 'goal_mrr', request_id: 'req-1' },
  persistedEdges,
});

describe('the snapshot records a link\'s CURRENT point size, in the user\'s terms', () => {
  it('⭐ RED: the edge\'s own natural size, the four user-terms members only (never strength_mean)', () => {
    const s = snapshot(0.4, persisted(0.4, userStated({ ...SIZE, strength_mean: 0.4, strength_mean_frame: 'edge_strength' })));
    expect(s).not.toBeNull();
    expect(s!.links[0]!.natural_effect).toStrictEqual(SIZE);
  });

  it('an Olumi estimate\'s size is recorded too (the author is the sizing field\'s job, not this one\'s)', () => {
    const s = snapshot(0.4, persisted(0.4, { source: 'cee_inference', magnitude: 'olumi_estimate', natural_effect: { ...SIZE, strength_mean: 0.4 } }));
    expect(s!.links[0]!.natural_effect).toStrictEqual(SIZE);
  });

  it('a stored clamp still describes the edge (mean ±1, clamped_from = the β it was written for)', () => {
    const s = snapshot(1, persisted(1, userStated({ ...SIZE, strength_mean: 1.4 }, { clamped_from: 1.4 })));
    expect(s!.links[0]!.natural_effect).toStrictEqual(SIZE);
  });
});

describe('anything not current, not a point, or not what the Run was sent → not recorded (that link only)', () => {
  it.each([
    ['CONTROL: no natural size on the edge', persisted(0.4, { source: 'user_specified', magnitude: 'user_stated' }), 0.4],
    ['a STALE size (written for another strength)', persisted(0.4, userStated({ ...SIZE, strength_mean: 0.3 })), 0.4],
    ['one end of a range the user wrote (free text, never held)', persisted(0.4, userStated({ ...SIZE, strength_mean: 0.4, stated_range: { low: 2, high: 4, text: '2-4', end: 'low' } })), 0.4],
    ['the Run was sent a different mean than the edge holds', persisted(0.5, userStated({ ...SIZE, strength_mean: 0.5 })), 0.4],
    ['a size per a zero change (the contract refuses it)', persisted(0.4, userStated({ ...SIZE, per_source_change: 0, strength_mean: 0.4 })), 0.4],
    ['a size with no unit (the contract refuses it)', persisted(0.4, userStated({ ...SIZE, amount_unit: '', strength_mean: 0.4 })), 0.4],
  ])('%s', (_name, edges, wireMean) => {
    const s = snapshot(wireMean, edges);
    expect(s).not.toBeNull();
    expect(s!.links).toHaveLength(1);
    expect(s!.links[0]).not.toHaveProperty('natural_effect');
  });
});

describe('the F1 guard reads the SAME predicate (extracted, unchanged)', () => {
  const edge = (mean: number, provenance: Record<string, unknown>) => ({ from: 'a', to: 'b', strength: { mean, std: 0.1 }, provenance });
  it('a current user figure is held; a stale one is not', () => {
    expect(userFigureHeld(edge(0.4, userStated({ ...SIZE, strength_mean: 0.4 })))).not.toBeNull();
    expect(userFigureHeld(edge(0.4, userStated({ ...SIZE, strength_mean: 0.3 })))).toBeNull();
  });
});

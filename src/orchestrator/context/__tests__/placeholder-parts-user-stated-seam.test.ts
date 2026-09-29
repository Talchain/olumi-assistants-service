/**
 * ⭐ THE SEAM BETWEEN THE USER-STATED LINK EFFECT WRITER (#2274, `applyLinkEffectEdit`) AND R-c's "IS THIS LINK SIZED"
 * (`placeholderPartsFinding`, #2268). Both read the sizer's own unit words (`targetUnitWords` / `naturalAmountUnitOf`),
 * so a link the USER sized must stop the withhold on the limit it moves, and a placeholder must not. Bound by node id,
 * on #2274's own stored-graph shape; the writer is the real one.
 */
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../orchestrator-v5/context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../../orchestrator-v5/system-events/link-effect-edit.js';
import { PLACEHOLDER_PARTS_REASON, placeholderPartsFinding } from '../placeholder-parts.js';

type Rec = Record<string, any>;
function graph(target: Rec): Rec {
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      target,
      { id: 'o-raise', kind: 'option', label: 'Raise to £59' },
    ],
    edges: [
      { from: 'price', to: target.id, strength: { mean: target.id === 'subs' ? -0.3 : 0.3, std: 0.1 }, exists_probability: 0.9,
        effect_direction: target.id === 'subs' ? 'negative' : 'positive', defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } },
      { from: target.id, to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  };
}
const OPTIONS = [{ interventions: { price: 59 } }];
const nodesOf = (g: Rec) => g.nodes as Rec[];
const edgesOf = (g: Rec) => g.edges as Rec[];
const write = (g: Rec, to: string, effect: Rec) => applyLinkEffectEdit({
  persistedGraph: g, from: 'price', to, effect: effect as never,
  expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', to)! },
  quote: 'stated by the user',
  reading_token: linkEffectReadingToken({ from: 'price', to, effect: effect as never, quote: 'stated by the user' }),
});

describe('a link the USER sized ends the R-c withhold on the limit it moves', () => {
  const SUBS = { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: 'subscribers', source: 'cee_inference' } };
  it('CONTROL: the placeholder price → subscribers link withholds a limit on subscribers', () => {
    const g = graph(SUBS);
    expect(placeholderPartsFinding('subs', nodesOf(g), edgesOf(g), OPTIONS)?.reason).toBe(PLACEHOLDER_PARTS_REASON);
  });
  it('SEAM: "every £1 loses about 50 subscribers", written by #2274, is sized for R-c: no withhold', () => {
    const r = write(graph(SUBS), 'subs', { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£' });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const g = r.mutatedGraph as Rec;
    expect(edgesOf(g).find((e) => e.from === 'price' && e.to === 'subs')?.provenance?.magnitude).toBe('user_stated');
    expect(placeholderPartsFinding('subs', nodesOf(g), edgesOf(g), OPTIONS)).toBeNull();
  });
  it('SEAM (a percentage LEVEL): "every £1 adds 0.1 percentage points of churn", written by #2274, is sized for R-c', () => {
    const CHURN = { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, cap: 100, unit: '%', source: 'user_override' } };
    const before = graph(CHURN);
    expect(placeholderPartsFinding('churn', nodesOf(before), edgesOf(before), OPTIONS)?.reason, 'CONTROL').toBe(PLACEHOLDER_PARTS_REASON);
    const r = write(before, 'churn', { amount: 0.1, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const g = r.mutatedGraph as Rec;
    expect(placeholderPartsFinding('churn', nodesOf(g), edgesOf(g), OPTIONS)).toBeNull();
  });
});

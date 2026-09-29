/**
 * The user-stated LINK EFFECT writer (DL #72 5882763151 item a; contract Canonical 5882780438). A user answers
 * "how much does X move Y?" in natural units; the canonical writer sizes the link with the construction path's own
 * converter (`sizeLink`, `user_stated: true`), stores who sized it and the natural effect, and refuses everything it
 * cannot do exactly — never a fabricated effect, never a strength-only edit.
 */
import { describe, expect, it } from 'vitest';

import { convertLinkEffect } from '../../../cee/magnitude/link-effect.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';

type Rec = Record<string, any>;

function storedGraph(): Rec {
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: 'subscribers', source: 'cee_inference' } },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [
      { from: 'price', to: 'subs', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative',
        defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', reasoning: 'Olumi: price sensitivity' } },
      { from: 'subs', to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  };
}

const STATED = { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£' } as const;

/** What an Agent proposal carries: the wire `graph_hash` (the analysis hash) and the prepared link's token. */
const revisionOf = (g: unknown, from = 'price', to = 'subs') =>
  ({ graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, from, to)! });

function params(over: Partial<ApplyLinkEffectEditParams> = {}, graph: Rec = storedGraph()): ApplyLinkEffectEditParams {
  return {
    persistedGraph: graph,
    from: 'price',
    to: 'subs',
    effect: { ...STATED },
    // The revision the ask was prepared on — the Agent proposal's `base_graph_identity_hash`.
    expected: revisionOf(graph),
    quote: 'every £1 on the price loses us about 50 subscribers',
    ...over,
  };
}

const edgeOf = (g: unknown) => (g as Rec).edges.find((e: Rec) => e.from === 'price' && e.to === 'subs') as Rec;

describe('link effect writer — a stated effect sizes the link exactly, as the user\'s', () => {
  it('RED: writes β from the construction converter, magnitude user_stated, source user_specified, and the natural effect', () => {
    const r = applyLinkEffectEdit(params());
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = edgeOf(r.mutatedGraph);
    const beta = convertLinkEffect(-50, 1, 10000, 100)!;
    expect(beta).toBeCloseTo(-0.5, 12);
    expect(e.strength.mean).toBeCloseTo(beta, 12);
    expect(e.effect_direction).toBe('negative');
    expect(e.provenance.source).toBe('user_specified');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(e.provenance.natural_effect.amount_unit).toBe('subscribers');
    expect(e.provenance.natural_effect.per_source_change_unit).toBe('£');
    expect(e.provenance.natural_effect.strength_mean).toBe(e.strength.mean);
    // Olumi's reasoning and its default flag do not survive a user's own statement.
    expect(e.provenance).not.toHaveProperty('reasoning');
    expect(e).not.toHaveProperty('defaulted');
    // One fact, the existing link-strength fact type, naming both ends.
    expect(r.handlerFacts).toHaveLength(1);
    expect((r.handlerFacts[0] as Rec).fact_type).toBe('adjust_edge_strength');
    expect((r.handlerFacts[0] as Rec).result.target_id).toBe('price→subs');
  });

  it('the analysis revision MOVES (who sized the link and its size are hash inputs), so a prior Run reads stale', () => {
    const base = storedGraph();
    const r = applyLinkEffectEdit(params({}, base));
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    expect(computeAnalysisAffectingGraphHash(r.mutatedGraph as never)).not.toBe(computeAnalysisAffectingGraphHash(base as never));
  });

  it('survives the strict parse and the persisted projection byte-for-byte (write → reload)', () => {
    const r = applyLinkEffectEdit(params());
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const written = edgeOf(r.mutatedGraph).provenance.natural_effect;
    const reloaded = edgeOf(projectGraphForPersistence(GraphV3.parse(r.mutatedGraph) as never)).provenance.natural_effect;
    expect(reloaded).toEqual(written);
  });

  it('touches only the stated link', () => {
    const base = storedGraph();
    const r = applyLinkEffectEdit(params({}, base));
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const other = (r.mutatedGraph as Rec).edges.find((e: Rec) => e.from === 'subs');
    expect(other).toEqual(base.edges[1]);
    expect((r.mutatedGraph as Rec).nodes).toEqual(base.nodes);
  });
});

describe('link effect writer — refuses what it cannot do exactly (fail closed, nothing fabricated)', () => {
  const refused = (p: ApplyLinkEffectEditParams, reason: string) => {
    const r = applyLinkEffectEdit(p);
    expect(r.kind, JSON.stringify(r)).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe(reason);
  };

  it('edge_not_found: no such link', () => refused(params({ to: 'mrr' }), 'edge_not_found'));

  // DL 5882808387: bound to the prepared REVISION, not only mean/direction/magnitude.
  const preparedThen = (edit: (g: Rec) => void): ApplyLinkEffectEditParams => {
    const prepared = storedGraph();
    const now = storedGraph();
    edit(now);
    return params({ expected: revisionOf(prepared) }, now);
  };

  it('superseded: another turn changed this link\'s natural effect with the SAME mean, direction and magnitude', () => {
    refused(preparedThen((g) => {
      g.edges[0].provenance.natural_effect = { amount: -30, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£',
        strength_mean: -0.3, strength_mean_frame: 'edge_strength' };
    }), 'superseded');
  });

  it('superseded: this link\'s std or provenance moved with the mean unchanged', () => {
    refused(preparedThen((g) => { g.edges[0].strength.std = 0.2; }), 'superseded');
    refused(preparedThen((g) => { g.edges[0].provenance.source = 'user_specified'; }), 'superseded');
  });

  it('superseded: an unrelated ANALYSIS edit since the ask (the level door\'s CAS base moved, so the approval is re-asked)', () => {
    refused(preparedThen((g) => { g.nodes[1].observed_state.raw_value = 59; g.nodes[1].observed_state.value = 0.59; }), 'superseded');
  });

  it('superseded: Olumi\'s reasoning on this link changed (a byte the analysis hash does not read — the edge token does)', () => {
    refused(preparedThen((g) => { g.edges[0].provenance.reasoning = 'Olumi: revised'; }), 'superseded');
  });

  it('CONTROL: a cosmetic rename elsewhere does NOT discard the approval (proposal-staleness doctrine: analysis hash)', () => {
    expect(applyLinkEffectEdit(preparedThen((g) => { g.nodes[3].label = 'Keep the price'; })).kind).toBe('mutated');
  });

  it('CONTROL: the unchanged revision writes', () => {
    expect(applyLinkEffectEdit(preparedThen(() => undefined)).kind).toBe('mutated');
  });

  it('a % LEVEL target answered in the ask\'s own words ("percentage points") is sized, not refused (Runtime 5882802252)', () => {
    const g: Rec = {
      goal_node_id: 'mrr',
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
        { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.032, raw_value: 3.2, unit: '%', source: 'cee_inference' } },
      ],
      edges: [{ from: 'price', to: 'churn', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
    };
    const r = applyLinkEffectEdit({ persistedGraph: g, from: 'price', to: 'churn', quote: 'every £1 on the price adds half a point of churn',
      effect: { amount: 0.5, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' },
      expected: revisionOf(g, 'price', 'churn') });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = (r.mutatedGraph as Rec).edges[0];
    expect(e.strength.mean).toBeCloseTo(convertLinkEffect(0.5, 1, 100, 100)!, 12);
    expect(e.provenance.natural_effect.amount_unit).toBe('percentage points');
  });

  it('unit_mismatch: the stated units must be the two ends\' own (folded), never converted by guess', () => {
    refused(params({ effect: { ...STATED, amount_unit: 'customers' } }), 'unit_mismatch');
    refused(params({ effect: { ...STATED, per_source_change_unit: '$' } }), 'unit_mismatch');
  });

  it('unconvertible: an end with no frame cannot turn a natural effect into a strength', () => {
    const g = storedGraph();
    // `resolveMagnitudeFrame` derives a frame from a cap, raw/value, a pinned unit or a [0,1] level — so the end
    // keeps only its unit: nothing to size against.
    g.nodes[2].observed_state = { unit: 'subscribers', source: 'cee_inference' };
    refused(params({}, g), 'unconvertible');
    refused(params({ effect: { ...STATED, per_source_change: 0 } }), 'unconvertible');
  });

  it('definitional_link: a link an identity in use defines is never sized by hand', () => {
    const g = storedGraph();
    g.nodes.push({ id: 'reach', kind: 'factor', label: 'Reach', observed_state: { value: 0.5, raw_value: 50, cap: 100, unit: 'k people', source: 'cee_inference' } });
    g.edges.push({ from: 'reach', to: 'subs', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
    g.nodes[2].nonlinear_identity = { operation: 'product', factor_ids: ['price', 'reach'], stated_in_brief: false };
    refused(params({}, g), 'definitional_link');
  });

  it('sign_conflict: a stated effect running AGAINST the stored link is refused, never a silent reversal (Runtime 5883054365)', () => {
    // Stored price → subs is negative; "+50 subscribers per £1" says the other way.
    refused(params({ effect: { ...STATED, amount: 50 } }), 'sign_conflict');
    // A link stored with no direction word reads its mean's sign.
    const g = storedGraph();
    delete g.edges[0].effect_direction;
    refused(params({ effect: { ...STATED, amount: 50 } }, g), 'sign_conflict');
  });

  it('quote_invalid: the approval must carry the user\'s own words (1..400 chars)', () => {
    refused(params({ quote: '' }), 'quote_invalid');
    refused(params({ quote: 'x'.repeat(401) }), 'quote_invalid');
  });

  it('the stored graph is never mutated by the writer, even on success', () => {
    const base = storedGraph();
    const before = JSON.stringify(base);
    applyLinkEffectEdit(params({}, base));
    expect(JSON.stringify(base)).toBe(before);
  });
});

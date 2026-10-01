/**
 * ⭐ A COUNT OUTCOME'S PLURAL HEAD NOUN IS ITS UNIT (R3 #75 5926215496; DL 5926238562: the step-2 unit wall).
 * Served `train-0643Z` (CEE 581c1873): Paul's "Each extra conversation brings in about £20,000 towards funding" passed
 * the authorship door (#2435) and was then refused `unit_mismatch`: the persisted outcome "Angel investor conversations"
 * keeps NO unit (the drafter's units live only in the construction path's `natural_effect`), so the writer's source unit
 * was '' and "per conversation" could never match. The frame IS stored (40), so the size itself is computable.
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';

type Rec = Record<string, any>;
const SRC = 'angel_investor_conversations';

/** The served 0643Z shape at the link-size turn: unitless count outcomes with stored frames; the goal's £ is its target unit. */
function served(label = 'Angel investor conversations'): Rec {
  return {
    goal_node_id: 'funding',
    nodes: [
      { id: 'funding', kind: 'goal', label: 'funding', goal_threshold_unit: '£', scale_frame: 20000000 },
      { id: SRC, kind: 'outcome', label, scale_frame: 40 },
      { id: 'o-hold', kind: 'option', label: 'Continue firm outreach' },
    ],
    edges: [
      { from: SRC, to: 'funding', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        defaulted: true, provenance: { source: 'cee_hypothesis' } },
    ],
  };
}
const EFFECT = { amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' };

function params(graph: Rec, effect: Rec = EFFECT): ApplyLinkEffectEditParams {
  const p = {
    persistedGraph: graph, from: SRC, to: 'funding', effect,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, SRC, 'funding')! },
    quote: 'Each extra conversation brings in about £20,000 towards funding',
  } as Omit<ApplyLinkEffectEditParams, 'reading_token'>;
  return { ...p, reading_token: linkEffectReadingToken(p) } as ApplyLinkEffectEditParams;
}
const edgeOf = (g: unknown) => (g as Rec).edges.find((e: Rec) => e.from === SRC && e.to === 'funding') as Rec;

describe('the step-2 unit wall: a unitless count outcome is counted in its plural head noun', () => {
  it('RED (served 0643Z): £20,000 per conversation on "Angel investor conversations" is written as the user\'s size, per conversation', () => {
    const r = applyLinkEffectEdit(params(served()));
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const ne = edgeOf(r.mutatedGraph).provenance.natural_effect;
    expect(ne).toMatchObject({ amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' });
    expect(edgeOf(r.mutatedGraph).provenance.magnitude).toBe('user_stated');
    // β = 20,000 × 40 / 20,000,000 = 0.04 — the stored frames, nothing guessed.
    expect(edgeOf(r.mutatedGraph).strength.mean).toBeCloseTo(0.04, 12);
  });

  it('the singular ("per conversation") is the same count', () => {
    expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: 'conversation' })).kind).toBe('mutated');
  });

  it('per a DIFFERENT count ("per deal") on that source is still a unit mismatch', () => {
    expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: 'deals' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a unitless source with no plural head noun ("Fundraising admin time") is never given one', () => {
    expect(applyLinkEffectEdit(params(served('Fundraising admin time'), { ...EFFECT, per_source_change_unit: 'times' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a word that only ENDS in s ("status", "process", "analysis") is not a count', () => {
    expect(applyLinkEffectEdit(params(served('Fundraising process status'), { ...EFFECT, per_source_change_unit: 'status' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a participle tail is not the noun: "Investment-firm deals closed" counts deals, never "closed"', () => {
    expect(applyLinkEffectEdit(params(served('Investment-firm deals closed'), { ...EFFECT, per_source_change_unit: 'deals' })).kind).toBe('mutated');
    expect(applyLinkEffectEdit(params(served('Investment-firm deals closed'), { ...EFFECT, per_source_change_unit: 'closed' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});

/**
 * ⛔ A CANVAS LEVEL EDIT KEEPS THE USER'S FIGURE (DL #75 5902916137 (3); P0 partner 5902892060; served W4 run2, CEE `f074916`).
 *
 * Signed-in `520aab46`: the option card's editor showed "£49 → £57 per subscriber / month" and sent the level on the model
 * scale (`option_intervention_edit`, value 0.285 on "Pro plan price", cap 200). The cell that held `raw_value: 59` was
 * rewritten as a bare `value: 0.285` — the user's £57 gone from the model — and the reply said
 * `"Raise to £59" now has an effect value of 0.285 on "Pro plan price".`, internal terms for a price the user typed.
 *
 * The level is read on the factor's OWN declared range (the frame every level on it was normalised by, and the one the
 * card reads to show £57), so the figure is kept on the cell and said in the user's units. A factor with no range of its
 * own, or a cell whose stored figure disagrees with that range, is written exactly as before (never an invented figure).
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { prepareOptionInterventionEdit } from '../option-intervention-edit.js';
import { formatOptionEffectWriteAck } from '../../routing/option-effect-write.js';

const cell = (value: number, raw: number | undefined, source = 'brief_extraction') => ({
  unit: '£ per subscriber per month', value, source, ...(raw !== undefined ? { raw_value: raw } : {}),
  target_match: { node_id: 'pro_plan_price', confidence: 'high', match_type: 'exact_id' } });
/** The served `520aab46` shape (W4 run2 pre-read): £49 today on a 0–200 range; "Raise to £59" at 0.295 / £59. */
function served(priceState: Record<string, unknown> = { cap: 200, unit: '£ per subscriber per month', value: 0.245, source: 'brief_extraction',
  raw_value: 49, declared_scale: 'unit_interval' }, raiseCell = cell(0.295, 59)) {
  return GraphV3.parse({
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' },
      { id: 'raise_to_59', kind: 'option', label: 'Raise to £59', interventions: { pro_plan_price: raiseCell } },
      { id: 'keep_49_price', kind: 'option', label: 'Keep £49 price' },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: priceState },
    ],
    edges: [['raise_to_59', 'pro_plan_price'], ['pro_plan_price', 'mrr']].map(([from, to]) => ({
      from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
  });
}
function written(g: ReturnType<typeof served>, modelValue: number): Record<string, unknown> | undefined {
  const r = prepareOptionInterventionEdit({ persistedGraph: g, optionId: 'raise_to_59', factorId: 'pro_plan_price', modelValue,
    expectedGraphHash: computeAnalysisAffectingGraphHash(g)! });
  expect(r.kind, JSON.stringify(r)).toBe('prepared');
  if (r.kind !== 'prepared') return undefined;
  const ops = parseEditGraphResponse(JSON.stringify({ operations: [r.operation], removed_edges: [], warnings: [], coaching: null })).operations as PatchOperation[];
  const encoded = encodeOptionInterventionsForEdit(applyPatchOperations(g, ops), new Set(['raise_to_59']));
  const merged = mergeAppliedGraphForPersistence({ appliedGraph: encoded.graph, persistedBase: g, ingressBase: g, scenarioId: 's', requestId: 'r' });
  const after = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(merged))));
  return after.nodes.find((n) => n.id === 'raise_to_59')?.interventions?.pro_plan_price as Record<string, unknown> | undefined;
}

describe('a canvas level edit keeps the user\'s figure (served W4 run2: £59 → £57 on a 0–200 range)', () => {
  it('RED (served): the card\'s 0.285 is stored WITH the £57 it shows — raw_value 57 in the factor\'s unit, the user\'s', () => {
    expect(written(served(), 0.285)).toMatchObject({ value: 0.285, raw_value: 57, unit: '£ per subscriber per month', source: 'user_specified' });
  });

  it('RED (served): the reply says £57 in the user\'s units, never "an effect value of 0.285"', () => {
    const said = formatOptionEffectWriteAck({ optionLabel: 'Raise to £59', factorLabel: 'Pro plan price', committedValue: 0.285,
      committedFigure: { raw_value: 57, unit: '£ per subscriber per month' } });
    expect(said).toContain('£57');
    expect(said).not.toMatch(/effect value|0\.285/);
  });

  it('CONTROL: a factor with no range of its own gets no invented figure (the cell is written as before)', () => {
    const cellAfter = written(served({ value: 0.245, source: 'brief_extraction' }, cell(0.295, undefined)), 0.285);
    expect(cellAfter).toMatchObject({ value: 0.285, source: 'user_specified' });
    expect(cellAfter).not.toHaveProperty('raw_value');
  });

  it('CONTROL: a stored figure that disagrees with the factor\'s range (£59 at 0.5, not 0.295) is not re-read on it', () => {
    expect(written(served(undefined, cell(0.5, 59)), 0.285)).not.toHaveProperty('raw_value');
  });

  it('CONTROL (MG 5903379881; the card\'s cap > 1 rule): a range of 1 is shown on the model scale, so no figure is read on it', () => {
    const cellAfter = written(served({ cap: 1, unit: 'share', value: 0.245, source: 'brief_extraction', raw_value: 0.245,
      declared_scale: 'unit_interval' }, cell(0.295, undefined)), 0.285);
    expect(cellAfter).not.toHaveProperty('raw_value');
  });

  it('CONTROL: with no figure on the committed cell the acknowledgement is unchanged', () => {
    expect(formatOptionEffectWriteAck({ optionLabel: 'Pilot', factorLabel: 'Coverage', committedValue: 0.3 }))
      .toBe('"Pilot" now has an effect value of 0.3 on "Coverage".');
  });
});

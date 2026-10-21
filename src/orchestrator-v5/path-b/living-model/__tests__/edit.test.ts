import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { applyExplicitEdit, type ExplicitEdit } from '../edit.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';
import { supplier } from './track2-f2-event-risk.fixtures.js';

const apply = (edit: ExplicitEdit): LivingModelT => {
  const out = applyExplicitEdit(KNOWN_ANSWER, edit);
  if (!('model' in out)) throw new Error(`refused: ${out.refused}`);
  return out.model;
};
const node = (m: LivingModelT, id: string) => mapLivingModel(m).graph.nodes.find((n) => n.id === id) as Record<string, any>;

describe('thin core explicit edit: a canvas gesture applied to the living model, then regenerated', () => {
  it('a factor value the person types becomes theirs, in their units, and the graph says they set it', () => {
    const m = apply({ kind: 'factor_value_edit', target_id: 'f', value: 0.7, raw_value: 0.7 });
    expect(m.factors[0]).toMatchObject({ value: 0.7, source: 'user', quote: null });
    expect(node(m, 'f').observed_state).toMatchObject({ value: 0.7, raw_value: 0.7, source: 'user_edited' });
    expect(KNOWN_ANSWER.factors[0]!.value, 'the saved model is never mutated').toBe(0.5);
  });

  it('a goal\'s current level is set on the goal; a model-scale option setting converts on the factor\'s own frame', () => {
    expect(apply({ kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75 }).aims[0]!.target!.current).toBe(75);
    const push = apply({ kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8 }).options.find((o) => o.id === 'push')!;
    expect(push.settings).toEqual([{ factor_id: 'f', value: 0.8, low: null, high: null, unit: null, source: 'user', party: null, quote: null }]);
  });

  it('a goal target and a link strength are kept in the person\'s units; the regenerated engine values match the gesture', () => {
    const target = apply({ kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' });
    expect(target.aims[0]!.target).toMatchObject({ comparator: '>=', value: 110, unit: 'units', current: 70 });
    const link = apply({ kind: 'edge_strength_edit', from: 'f', to: 'g', magnitude: 0.2, direction_intent: 'preserve' });
    expect(link.links[0]!.effect).toEqual({ form: 'point', value: 25, low: null, high: null, sd: null, unit: 'units', sign: '+' });
    const edge = mapLivingModel(link).graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(edge.strength.mean).toBeCloseTo(0.2, 10);
    expect(edge.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated' });
  });

  it('R1 6b148af5: a target edit never claims an inherited starting level, nor relabels its unit', () => {
    const olumis: LivingModelT = structuredClone(KNOWN_ANSWER);
    olumis.aims[0] = { ...olumis.aims[0]!, source: 'olumi', quote: null };
    const out = applyExplicitEdit(olumis, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' });
    const m = (out as { model: LivingModelT }).model;
    expect(m.aims[0]).toMatchObject({ source: 'user', target: { value: 110, current: null } });
    expect(m.history).toContainEqual(expect.objectContaining({ id: 'g', change: 'superseded' }));
    expect(node(m, 'g').observed_state).toBeUndefined();
    // CONTROL: the person's own starting level stays theirs.
    expect(apply({ kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' }).aims[0]!.target!.current).toBe(70);
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 80, unit: '%' }))
      .toEqual({ refused: 'unit_mismatch' });
  });

  it('s1: a figure the person sets on the canvas makes Olumi\'s suggested measure theirs, so it is read as their target', () => {
    const suggested: LivingModelT = structuredClone(KNOWN_ANSWER);
    suggested.aims[0] = { ...suggested.aims[0]!, target: { ...suggested.aims[0]!.target!, value: null, current: null, source: 'olumi' } };
    const target = (applyExplicitEdit(suggested, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' }) as { model: LivingModelT }).model;
    expect(target.aims[0]!.target!.source).toBeNull();
    expect(mapLivingModel(target).withheld.map((w) => w.reason)).not.toContain('target_not_theirs');
    const level = (applyExplicitEdit(suggested, { kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: 'units' }) as { model: LivingModelT }).model;
    expect(level.aims[0]!.target).toMatchObject({ current: 75, current_source: 'user', source: null });
  });

  it('Codex #3585 P1: on Olumi\'s measure only the figure the person sets is adopted; Olumi\'s figures go to history, never to the engine as theirs', () => {
    const olumiMeasure = (target: Record<string, unknown>): LivingModelT => {
      const x: LivingModelT = structuredClone(KNOWN_ANSWER);
      x.aims[0] = { ...x.aims[0]!, target: { ...x.aims[0]!.target!, source: 'olumi', ...target } };
      return x;
    };
    // (1) Olumi left a target figure (100); the person sets only today's level (75): the 100 is never their target.
    const level = (applyExplicitEdit(olumiMeasure({ current: null }), { kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: 'units' }) as { model: LivingModelT }).model;
    expect(level.aims[0]!.target).toMatchObject({ value: null, low: null, high: null, current: 75, current_source: 'user', source: null });
    expect(level.history.map((h) => h.old)).toContain('target 100 units (Olumi\u2019s figure, not confirmed by you)');
    expect(node(level, 'g').goal_threshold_raw).toBeUndefined();
    // (2) The person's aim, Olumi's measure with a level (70); the person sets only the target (110): the 70 is never theirs.
    const target = (applyExplicitEdit(olumiMeasure({ value: null }), { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' }) as { model: LivingModelT }).model;
    expect(target.aims[0]!.target).toMatchObject({ value: 110, current: null, source: null });
    expect(target.history.map((h) => h.old)).toContain('starting level 70 units (Olumi\u2019s estimate)');
    expect(node(target, 'g').observed_state?.raw_value).not.toBe(70);
    // CONTRAST: on the person's own measure their saved level stays theirs when they set the target (unchanged rule).
    const own = (applyExplicitEdit(KNOWN_ANSWER, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' }) as { model: LivingModelT }).model;
    expect(own.aims[0]!.target!.current).toBe(70);
  });

  it('R1 round 2: today\'s level the person set stays theirs when they then edit the target', () => {
    const olumis: LivingModelT = structuredClone(KNOWN_ANSWER);
    olumis.aims[0] = { ...olumis.aims[0]!, source: 'olumi', quote: null };
    const level = (applyExplicitEdit(olumis, { kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: 'units' }) as { model: LivingModelT }).model;
    expect(level.aims[0]!.target).toMatchObject({ current: 75, current_source: 'user' });
    expect(node(level, 'g').observed_state).toMatchObject({ raw_value: 75, source: 'user_edited' });
    const target = (applyExplicitEdit(level, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' }) as { model: LivingModelT }).model;
    expect(target.aims[0]!.target).toMatchObject({ value: 110, current: 75, current_source: 'user' });
    expect(target.history).toEqual([]);
  });

  it('rename, delete and add keep every reference whole', () => {
    expect(apply({ kind: 'structural_rename', node_id: 'f', label: 'Effort', expected_label: 'f' }).factors[0]!.label).toBe('Effort');
    const deleted = apply({ kind: 'structural_delete', removed_node_ids: ['f'], removed_edges: [] });
    expect(deleted.factors).toEqual([]);
    expect(deleted.links).toEqual([]);
    expect(deleted.options.find((o) => o.id === 'push')!.settings).toEqual([]);
    expect(apply({ kind: 'structural_add', node_id: 'h', node_kind: 'factor', label: 'Hours' }).factors.map((f) => f.id)).toEqual(['f', 'h']);
  });

  it('Track 3 Q2-02: a level given with a unit keeps it, on a goal whose target has no unit yet ("cut churn a lot")', () => {
    const noUnit: LivingModelT = structuredClone(KNOWN_ANSWER);
    noUnit.aims[0]!.target = { ...noUnit.aims[0]!.target!, unit: null, current: null, current_unit: null };
    const m = (applyExplicitEdit(noUnit, { kind: 'factor_value_edit', target_id: 'g', value: 0.3, raw_value: 30, unit: '%' }) as { model: LivingModelT }).model;
    expect(m.aims[0]!.target).toMatchObject({ current: 30, current_source: 'user', current_unit: '%' });
    // CONTROL: the same unit as the target's is not repeated.
    expect(apply({ kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: 'units' }).aims[0]!.target!.current_unit).toBeNull();
  });

  it('refuses, changing nothing: another unit, a label that moved, an unknown item, a kind not in this slice', () => {
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: '%' })).toEqual({ refused: 'unit_mismatch' });
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'structural_rename', node_id: 'f', label: 'x', expected_label: 'old' })).toEqual({ refused: 'label_moved' });
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'factor_value_edit', target_id: 'nope', value: 1 })).toEqual({ refused: 'not_in_model' });
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'structural_add', node_id: 'o', node_kind: 'outcome', label: 'Churn' })).toEqual({ refused: 'kind_not_in_slice' });
  });

  // Staging defect (21 Oct, Codex on #3555): an option's own effect is drawn from its `<option>__on` switch, so a gesture on
  // that drawn edge named no stored link. A strength edit was refused, and a delete was acknowledged, then redrawn.
  it('a gesture on an option\'s drawn effect edge reaches its stored link: the strength is edited, and a delete removes it', () => {
    const m = supplier('point');
    const drawn = { from: 'dual_source__on', to: 'gp' };
    expect(mapLivingModel(m).graph.edges.find((e) => e.from === drawn.from && e.to === drawn.to)).toMatchObject({ id: 'cost_gp' });
    const strength = applyExplicitEdit(m, { kind: 'edge_strength_edit', ...drawn, magnitude: 0.1, direction_intent: 'preserve' });
    if (!('model' in strength)) throw new Error(`refused: ${strength.refused}`);
    const cost = strength.model.links.find((l) => l.id === 'cost_gp')!;
    expect(cost).toMatchObject({ from: 'dual_source', to: 'gp', source: 'user', quote: null, effect: { sign: '-' } });
    const edge = mapLivingModel(strength.model).graph.edges.find((e) => e.from === drawn.from && e.to === drawn.to) as Record<string, any>;
    expect(edge.strength.mean).toBeCloseTo(-0.1, 10);
    const del = applyExplicitEdit(m, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [drawn] });
    if (!('model' in del)) throw new Error(`refused: ${del.refused}`);
    expect(del.model.links.map((l) => l.id)).toEqual(['fails_gp']);
    expect(mapLivingModel(del.model).graph.edges.some((e) => e.from === drawn.from)).toBe(false);
  });

  it('NEGATIVE (Codex): a generated edge is no stored link\'s, whether a link shares its id or alone gives rise to it', () => {
    const lever = mapLivingModel(OPTION_EFFECTS).graph.edges.find((e) => e.from === 'w__change' && e.to === 'w')!;
    const shared: LivingModelT = { ...OPTION_EFFECTS, links: OPTION_EFFECTS.links.map((l) => (l.id === 'a_w' ? { ...l, id: String(lever.id) } : l)) };
    // One exact option effect alone gives rise to the lever: editing the lever must not turn "adds exactly 30" into a point.
    const alone: LivingModelT = { ...OPTION_EFFECTS, links: OPTION_EFFECTS.links.slice(0, 1) };
    const drawn = { from: 'w__change', to: 'w' };
    for (const [name, m] of [['shared id', shared], ['alone', alone]] as const) {
      expect(mapLivingModel(m).graph.edges.some((e) => e.from === drawn.from && e.to === drawn.to), name).toBe(true);
      expect(applyExplicitEdit(m, { kind: 'edge_strength_edit', ...drawn, magnitude: 0.1, direction_intent: 'preserve' }), name).toEqual({ refused: 'not_in_model' });
      // Nothing is written either way: the delete is refused by name (below), never acknowledged as a no-op.
      expect(applyExplicitEdit(m, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [drawn] }), name).toEqual({ refused: 'link_is_generated' });
    }
  });

  it('NEGATIVE (Codex): one drawn edge two stored links make is deleted whole, and names no single strength', () => {
    const twice: LivingModelT = { ...supplier('point'), links: [...supplier('point').links,
      { ...supplier('point').links.find((l) => l.id === 'cost_gp')!, id: 'admin_gp', quote: 'and £200 a month of admin' }] };
    const drawn = { from: 'dual_source__on', to: 'gp' };
    expect(mapLivingModel(twice).graph.edges.filter((e) => e.from === drawn.from && e.to === drawn.to)).toHaveLength(2);
    expect(applyExplicitEdit(twice, { kind: 'edge_strength_edit', ...drawn, magnitude: 0.1, direction_intent: 'preserve' })).toEqual({ refused: 'link_ambiguous' });
    const del = applyExplicitEdit(twice, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [drawn] });
    expect('model' in del && del.model.links.map((l) => l.id)).toEqual(['fails_gp']);
  });

  it('CONTROL: a plain factor → goal edge is edited and deleted by its own endpoints; an edge nobody drew changes nothing', () => {
    expect(apply({ kind: 'edge_strength_edit', from: 'f', to: 'g', magnitude: 0.2, direction_intent: 'preserve' }).links[0]!.effect.value).toBe(25);
    expect(apply({ kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'f', to: 'g' }] }).links).toEqual([]);
    expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'edge_strength_edit', from: 'g', to: 'f', magnitude: 0.2, direction_intent: 'preserve' }))
      .toEqual({ refused: 'not_in_model' });
    expect(apply({ kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'nope', to: 'g' }] }).links).toEqual(KNOWN_ANSWER.links);
  });

  // An edge Olumi draws from no stored link (an option's setting, the decision's choice, an exact sum's lever, a goal's level
  // today) has nothing to remove: the delete was acknowledged, then the edge was redrawn on regeneration (a false "saved").
  it('a delete of an edge Olumi draws from no stored link is refused by name, never acknowledged', () => {
    for (const [m, from, to] of [[KNOWN_ANSWER, 'push', 'f'], [KNOWN_ANSWER, 'decision_g', 'push'], [OPTION_EFFECTS, 'w_today', 'w']] as const) {
      expect(mapLivingModel(m).graph.edges.some((e) => e.from === from && e.to === to), `${from} → ${to} is drawn`).toBe(true);
      expect(applyExplicitEdit(m, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from, to }] }), `${from} → ${to}`)
        .toEqual({ refused: 'link_is_generated' });
    }
    // Codex: naming the decision node (Olumi's own, redrawn every time) must not let it, or its edges, through as "saved".
    for (const removed_edges of [[], [{ from: 'decision_g', to: 'push' }]]) {
      expect(applyExplicitEdit(KNOWN_ANSWER, { kind: 'structural_delete', removed_node_ids: ['decision_g'], removed_edges }))
        .toEqual({ refused: 'node_is_generated' });
    }
  });

  it('Codex (core edit): a renamed risk keeps whose chance it is; a risk deleted takes its links and the conditions on them; an id in use anywhere is refused', () => {
    const m: LivingModelT = { ...supplier('point'), conditions: [{ id: 'c1', text: 'only if the supplier is the only source', applies_to: ['fails_gp'],
      kind: 'assumption', source: 'olumi', party: null, quote: null } as never] };
    const renamed = (applyExplicitEdit(m, { kind: 'structural_rename', node_id: 'supplier_fails', label: 'Key supplier stops', expected_label: 'Key supplier fails' }) as { model: LivingModelT }).model;
    // Codex R2: the author also owns the chance; a rename never makes Olumi's figure the person's.
    const olumis = (applyExplicitEdit({ ...m, risks: [{ ...m.risks[0]!, source: 'olumi', quote: null }] },
      { kind: 'structural_rename', node_id: 'supplier_fails', label: 'Key supplier stops', expected_label: 'Key supplier fails' }) as { model: LivingModelT }).model;
    expect([renamed.risks[0]!.label, olumis.risks[0]!.source]).toEqual(['Key supplier stops', 'olumi']);
    const del = (applyExplicitEdit(m, { kind: 'structural_delete', removed_node_ids: ['supplier_fails'], removed_edges: [] }) as { model: LivingModelT }).model;
    expect([del.risks, del.links.map((l) => l.id), del.conditions[0]!.applies_to]).toEqual([[], ['cost_gp'], []]);
    for (const id of ['fails_gp', 'decision_gp', 'dual_source__on']) {
      expect(applyExplicitEdit(m, { kind: 'structural_add', node_id: id, node_kind: 'risk', label: 'X' }), id).toEqual({ refused: 'id_exists' });
    }
  });

  it('CONTROL: deleting an item takes the edges drawn to it along, as before', () => {
    const deleted = apply({ kind: 'structural_delete', removed_node_ids: ['f'],
      removed_edges: [{ from: 'push', to: 'f' }, { from: 'hold', to: 'f' }, { from: 'f', to: 'g' }] });
    expect(deleted.factors).toEqual([]);
    expect(deleted.links).toEqual([]);
  });

  it('⛔ Codex R3 on #3575: the rounding allowance is per bound and relative, so no figure outside the range is kept', () => {
    const at = (value: number, min: number, max: number) => {
      const m = structuredClone(KNOWN_ANSWER);
      Object.assign(m.factors[0]!, { value, unit: null, source: 'user' });
      const cap = mapLivingModel(m).frames.get('f')!.cap;
      const out = applyExplicitEdit(m, { kind: 'prior_range_edit', target_id: 'f', range_min: min / cap, range_max: max / cap });
      return 'model' in out ? out.model.factors[0]!.value : 'refused';
    };
    expect(at(1, 2, 1e15)).toBeNull();
    expect(at(1e-16, 2e-16, 3e-16)).toBeNull();
    expect(at(1e12, 1e12 + 500, 1e12 + 2000)).toBeNull();
    expect(at(28, 28, 50)).toBe(28);
    expect(at(0.5, 0.2, 0.8)).toBe(0.5);
  });
});

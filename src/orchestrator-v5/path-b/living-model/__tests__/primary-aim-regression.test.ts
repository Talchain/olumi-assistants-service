import { describe, expect, it, vi } from 'vitest';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { structureGaps } from '../structure.js';
import { diffLivingModels } from '../diff.js';
import { applyKernel } from '../kernel.js';
import { noteOnItem } from '../../tools/note-on-item.js';
import { read } from '../../tools/__tests__/fixtures.js';
import captured from './fixtures/office-goal-priority-regression.json';

// Exact saved failure from the paired benchmark. The priority is explicit metadata,
// not a text heuristic or a numerical target that could outrank the person's aim.
function office(): LivingModelT {
  const m = LivingModel.parse(structuredClone(captured));
  Object.assign(m.aims.find(a => a.id === 'aim_collaboration')!, { priority: 'primary' });
  return m;
}
const goal = (m: LivingModelT, saved?: string) => mapLivingModel(m, saved ? { goal: saved } : {}).graph.nodes.find(n => n.kind === 'goal')?.id;

describe('recorded office priority regression', () => {
  it('selects the declared collaboration priority even when a bookkeeping aim occurs first', () => {
    expect(goal(office())).toBe('aim_collaboration');
  });
  it('is invariant to aim ordering and repairs a previously selected bookkeeping goal', () => {
    const m = office();
    for (const aims of [m.aims, [...m.aims].reverse()]) {
      expect(goal({ ...m, aims }, 'aim_choice')).toBe('aim_collaboration');
    }
  });
  it('keeps a qualitative primary aim even when another aim has a measurable target', () => {
    const m = office();
    m.aims.find(a => a.id === 'aim_collaboration')!.target = null;
    expect(goal(m)).toBe('aim_collaboration');
    expect(structureGaps(m).goal_not_measurable).toBe(true);
  });
  it('does not silently pick between conflicting primary declarations', () => {
    const m = office();
    Object.assign(m.aims[0]!, { priority: 'primary' });
    const mapped = mapLivingModel(m);
    expect(mapped.graph.nodes.some(n => n.kind === 'goal')).toBe(false);
    expect(mapped.withheld).toContainEqual({ id: 'goal', reason: 'goal_priority_ambiguous' });
  });
  it('the critic structure check follows the same primary aim as the mapper', () => {
    expect(structureGaps(office()).unreachable).not.toContain('office_a');
    expect(structureGaps(office()).unreachable).not.toContain('office_b');
  });
  it('the actual collaboration card accepts the original class of question', async () => {
    const model = office();
    const graph = { ...mapLivingModel(model).graph, living_model: model };
    const dispatch = vi.fn(async () => ({ status: 200, json: read({ graph }) }));
    const out = await noteOnItem({ dispatch }, { scenario_id: 'scn_1' }, {
      item_id: 'aim_collaboration', note: 'What measurable improvement would count as success for team collaboration?',
    }, { notes: 0 });
    expect(out).toMatchObject({ status: 'ok', data: { ui_directive: { targets: [{ id: 'aim_collaboration' }] } } });
  });
  it('an undrawn saved aim is distinguished from an item that does not exist', async () => {
    const model = office();
    const graph = { ...mapLivingModel(model).graph, living_model: model };
    const dispatch = vi.fn(async () => ({ status: 200, json: read({ graph }) }));
    expect(await noteOnItem({ dispatch }, { scenario_id: 'scn_1' }, { item_id: 'aim_choice', note: 'Is this deadline still current?' }, { notes: 0 }))
      .toMatchObject({ status: 'refused', reason: 'item_not_on_canvas' });
  });
  it('a priority change is visible to the existing human approval diff', () => {
    const before = LivingModel.parse(structuredClone(captured));
    expect(diffLivingModels(before, office())).toContainEqual(expect.objectContaining({ kind: 'aim', id: 'aim_collaboration', change: 'change' }));
  });
  it('legacy models without priority metadata keep the existing selected goal', () => {
    const before = LivingModel.parse(structuredClone(captured));
    expect(goal(before, 'aim_collaboration')).toBe('aim_collaboration');
  });
  it('declaring a priority does not re-author a saved canvas aim whose quote is absent', () => {
    const saved = LivingModel.parse(structuredClone(captured));
    saved.aims.find(a => a.id === 'aim_collaboration')!.quote = null;
    const proposed = structuredClone(saved);
    Object.assign(proposed.aims.find(a => a.id === 'aim_collaboration')!, { priority: 'primary' });
    expect(applyKernel(proposed, [], saved).model.aims.find(a => a.id === 'aim_collaboration'))
      .toMatchObject({ source: 'user', quote: null, priority: 'primary' });
  });
  it('neutral null priority does not create a fake change on an older saved aim', () => {
    const saved = LivingModel.parse(structuredClone(captured));
    const proposed = structuredClone(saved);
    Object.assign(proposed.aims[0]!, { priority: null });
    const words = proposed.aims.flatMap(a => a.quote ? [a.quote] : []);
    expect(diffLivingModels(saved, applyKernel(proposed, words, saved).model).filter(c => c.kind === 'aim')).toEqual([]);
  });
  it('withdrawn priority does not select a withdrawn aim', () => {
    const m = office();
    m.aims.find(a => a.id === 'aim_collaboration')!.status = 'withdrawn';
    expect(goal(m)).toBe('aim_choice');
  });
  it('priority metadata round-trips through the same strict model parser as construction', () => {
    expect(LivingModel.parse(office()).aims.find(a => a.id === 'aim_collaboration')).toMatchObject({ priority: 'primary' });
  });
});

/**
 * ⭐ G2 capacity (TL 17:51Z; served c9e07d83, e2e/VERIFY-c9e07d83-capacity.md): 0/4 chances. The drafter framed the intermediate
 * "Additional specialist capacity" at 100 (300 on 1a1a7907), so the user's "20 tickets a week per specialist" × 10 (β 2) did
 * not fit; the stated-effect refit refused it (`not_the_goal`: a FACTOR's frame was never widened) and the link was clamped,
 * so every chance through it was withheld. Replayed on the served graph: the refit's only refusal was that one.
 *
 * Fix (narrow, accepted by DL-3 for G2): the STATED pass widens a factor that holds exactly 0 today with no spread of its own,
 * which has no natural uncertainty to move. ⚠ STILL OPEN (TL to rule): a stated effect landing on a factor with a non-zero value
 * or a real std can still be clamped; PR Review's protected rows (refit-frames.test.ts) are unchanged. The user's figures:
 * capacity journey brief (seen; Paul's journey, not an unseen brief).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { frameOf, refitFramesForOlumiEstimates, refitFramesForStatedEffects } from '../refit-frames.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';

type Rec = Record<string, any>;

/** The served c9e07d83 frames and links, as stored (the user's link clamped to 1, `clamped_from: 2`). */
function servedShape(capacityCap: number, goalCap = 200): Rec {
  const beta = 20 * 10 / capacityCap;
  const stored = Math.min(beta, 1);
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Weekly support capacity', goal_threshold_cap: goalCap, goal_threshold_cap_provenance: 'stated_effect_fit',
        goal_direction: '>=', goal_threshold: 100 / goalCap, goal_threshold_raw: 100, goal_threshold_unit: 'tickets per week', goal_threshold_frame: 'level',
        observed_state: { value: 80 / goalCap, raw_value: 80, cap: goalCap, unit: 'tickets per week', source: 'brief_extraction' } },
      { id: 'keep', kind: 'option', label: 'Keep current staffing', interventions: { specialists: 0 } },
      { id: 'add', kind: 'option', label: 'Add one specialist', interventions: { specialists: 0.1 } },
      { id: 'existing', kind: 'factor', label: 'Existing team capacity', observed_state: { value: 0.4, raw_value: 80, cap: 200, unit: 'tickets per week', source: 'brief_extraction' } },
      { id: 'specialists', kind: 'factor', label: 'Additional support specialists', observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'specialists', source: 'cee_inference' } },
      { id: 'capacity', kind: 'factor', label: 'Additional specialist capacity', observed_state: { value: 0, raw_value: 0, cap: capacityCap, unit: 'tickets per week', source: 'cee_inference' } },
    ],
    edges: [
      { from: 'keep', to: 'specialists', strength: { mean: 1, std: 0.01 } }, { from: 'add', to: 'specialists', strength: { mean: 1, std: 0.01 } },
      { from: 'existing', to: 'goal', strength: { mean: 200 / goalCap, std: 0.000625 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated',
        natural_effect: { amount: 1, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'tickets per week', strength_mean: 200 / goalCap } } },
      { from: 'specialists', to: 'capacity', strength: { mean: stored, std: stored / 2 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated',
        ...(beta > 1 ? { clamped_from: beta } : {}),
        natural_effect: { amount: 20, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'specialists', strength_mean: beta } } },
      { from: 'capacity', to: 'goal', strength: { mean: capacityCap / goalCap, std: 0.001 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated',
        natural_effect: { amount: 1, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'tickets per week', strength_mean: capacityCap / goalCap } } },
    ],
  };
}
const link = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;
const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;

describe('a stated effect into a factor that holds nothing yet widens its frame instead of being clamped', () => {
  it('⭐ RED→GREEN (served c9e07d83 shape): frame 100 → 200 for the user\'s 20 × 10, no clamped_from, nothing refused', () => {
    const r = refitFramesForStatedEffects(servedShape(100), { goalOwnRows: true });
    expect(r.refused).toEqual([]);
    expect(r.refits).toEqual([{ node: 'capacity', from: 100, to: 200, for_link: 'specialists→capacity' }]);
    expect(frameOf(node(r.graph, 'capacity'))).toBe(200);
    const users = link(r.graph, 'specialists', 'capacity');
    expect(users.provenance.clamped_from).toBeUndefined();
    expect(users.strength.mean).toBe(1);
    // The user's natural size is unchanged: 20 tickets a week per specialist, β 1 on the wider frame.
    expect(users.provenance.natural_effect).toMatchObject({ amount: 20, per_source_change: 1, strength_mean: 1 });
    // The onward definitional link scales with it and stays inside the contract.
    expect(Math.abs(link(r.graph, 'capacity', 'goal').strength.mean)).toBeLessThanOrEqual(1);
  });
  it('⭐ the add-specialist option\'s chance is not withheld for an unsized link (nothing on its path is a placeholder)', () => {
    const r = refitFramesForStatedEffects(servedShape(100), { goalOwnRows: true });
    expect(unsizedLeaderGoalPaths(r.graph, ['add'])).toEqual([]);
    expect((r.graph.edges as Rec[]).every((e) => Math.abs(e.strength.mean) <= 1)).toBe(true);
  });
  it('CONTRAST: at the 1a1a7907 frames (capacity 300, goal 500) the size already fits: nothing is widened', () => {
    const g = servedShape(300, 500);
    const r = refitFramesForStatedEffects(g, { goalOwnRows: true });
    expect(r.refits).toEqual([]);
    expect(r.refused).toEqual([]);
    expect(frameOf(node(r.graph, 'capacity'))).toBe(300);
  });
  it('NEGATIVE (still OPEN, TL to rule): a factor that HOLDS a level is still refused, as PR Review set it', () => {
    const g = servedShape(100);
    node(g, 'capacity').observed_state = { ...node(g, 'capacity').observed_state, value: 0.4, raw_value: 40 };
    expect(refitFramesForStatedEffects(g, { goalOwnRows: true }).refused).toEqual([{ link: 'specialists→capacity', reason: 'not_the_goal' }]);
  });
  it('NEGATIVE: a factor at 0 with a spread of its own is still refused', () => {
    const g = servedShape(100);
    node(g, 'capacity').observed_state = { ...node(g, 'capacity').observed_state, std: 0.05 };
    expect(refitFramesForStatedEffects(g, { goalOwnRows: true }).refused).toEqual([{ link: 'specialists→capacity', reason: 'not_the_goal' }]);
  });
  it('NEGATIVE: Olumi\'s own estimates never widen a factor (the Olumi pass is unchanged)', () => {
    const g = servedShape(100);
    const e = link(g, 'specialists', 'capacity');
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      olumi_fit_candidate: { strength_mean: 2, strength_std: 1, natural_effect: { amount: 20, amount_unit: 'tickets per week', per_source_change: 1, strength_mean: 2 } } };
    e.strength = { mean: 0.5, std: 0.25 };
    const r = refitFramesForOlumiEstimates(g);
    expect(r.fitted).toEqual([]);
    expect(frameOf(node(r.graph, 'capacity'))).toBe(100);
  });
});

describe('through the real build: the drafter\'s tight intermediate frame no longer clamps the user\'s size', () => {
  // The served c9e07d83 draft (row 5efa42a0): its drafter framed "Additional specialist capacity" at 100 (`plausible_max`).
  const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/capacity-c9e07d83-first-draft.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
  async function built(capacityMax: number): Promise<Rec> {
    const model = JSON.parse(FIXTURE.raw_text) as Rec;
    for (const f of model.factors as Rec[]) if (f.label === 'Additional specialist capacity') f.plausible_max = capacityMax;
    let graph: Rec | undefined;
    const result = await buildModelFromBrief('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e', FIXTURE.brief, (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
    }) as never, (async () => ({ text: JSON.stringify(model), status: 'completed' })) as never) as Rec;
    expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
    return graph!;
  }
  const users = (g: Rec): Rec => {
    const cap = (g.nodes as Rec[]).find((n) => n.label === 'Additional specialist capacity')!;
    const spec = (g.nodes as Rec[]).find((n) => n.label === 'Additional support specialists')!;
    return { cap, link: link(g, spec.id, cap.id) };
  };
  it('⭐ a drafted frame of 100: the node is widened to hold 20 × the specialists, and the user\'s link is stored uncut', async () => {
    const g = await built(100);
    const { cap, link: l } = users(g);
    // The add-specialist option's chance is not withheld for an unsized link, and nothing on the graph is cut.
    const add = (g.nodes as Rec[]).find((n) => n.kind === 'option' && n.label === 'Add one specialist')!;
    expect(unsizedLeaderGoalPaths(g, [add.id])).toEqual([]);
    expect((g.edges as Rec[]).every((e) => e.provenance?.clamped_from === undefined)).toBe(true);
    expect(frameOf(cap)).toBeGreaterThanOrEqual(200);
    expect(l.provenance?.clamped_from).toBeUndefined();
    expect(Math.abs(l.strength.mean)).toBeLessThanOrEqual(1);
    expect(l.provenance?.natural_effect).toMatchObject({ amount: 20, per_source_change: 1 });
  });
  it('CONTRAST: a drafted frame of 300 (as on 1a1a7907) is left as it is', async () => {
    const { cap, link: l } = users(await built(300));
    expect(frameOf(cap)).toBe(300);
    expect(l.provenance?.clamped_from).toBeUndefined();
  });
});

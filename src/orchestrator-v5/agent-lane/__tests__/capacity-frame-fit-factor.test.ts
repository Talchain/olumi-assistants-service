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
import { clampForPersist, frameOf, refitFramesForOlumiEstimates, refitFramesForStatedEffects } from '../refit-frames.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { vi } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

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
  /**
   * ⛔ BUDDY-A #3313 B1 (R1, its own synthetic contrast): ANOTHER link into the same factor, Olumi's estimate already clamped
   * (stored 1 on frames 10 → 100, recorded 30 tickets a week per contractor, `clamped_from: 3`). Widening the factor to 200
   * would make that link act at 20 per contractor instead of 10; the factor move is refused and nothing changes.
   */
  const withContractors = (g: Rec, stored: number, recorded: number): Rec => {
    g.nodes.push({ id: 'contractors', kind: 'factor', label: 'Contractors', observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'contractors', source: 'cee_inference' } });
    g.edges.push({ from: 'contractors', to: 'capacity', strength: { mean: stored, std: stored / 2 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      ...(recorded / 10 > 1 ? { clamped_from: recorded / 10 } : {}),
      natural_effect: { amount: recorded, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'contractors', strength_mean: recorded / 10 } } });
    return g;
  };
  const analysed = (g: Rec, from: string, to: string): number => {
    const p = clampForPersist(g);
    return link(p, from, to).strength.mean * frameOf(node(p, to))! / frameOf(node(p, from))!;
  };
  it('⛔ B1 (BUDDY-A R1): another link already clamped into the factor → the factor move is REFUSED, nothing changes', () => {
    const g = withContractors(servedShape(100), 1, 30);
    expect(analysed(g, 'contractors', 'capacity')).toBe(10);
    const r = refitFramesForStatedEffects(g, { goalOwnRows: true });
    expect(r.refits).toEqual([]);
    expect(r.refused).toEqual([{ link: 'specialists→capacity', reason: 'new_cut' }]);
    expect(frameOf(node(r.graph, 'capacity'))).toBe(100);
    // As persisted: the other link still acts at 10 per contractor, and the user's link is clamped exactly as before.
    expect(analysed(r.graph, 'contractors', 'capacity')).toBe(10);
    expect(clampForPersist(r.graph)).toEqual(clampForPersist(g));
  });
  it('CONTROL (uncut other link): an Olumi link inside the contract is rescaled, its analysed size kept; the user\'s size fits', () => {
    const g = withContractors(servedShape(100), 0.8, 8);
    const r = refitFramesForStatedEffects(g, { goalOwnRows: true });
    expect(r.refused).toEqual([]);
    expect(r.refits).toEqual([{ node: 'capacity', from: 100, to: 200, for_link: 'specialists→capacity' }]);
    expect(link(r.graph, 'contractors', 'capacity').strength.mean).toBeCloseTo(0.4, 12);
    expect(analysed(r.graph, 'contractors', 'capacity')).toBeCloseTo(8, 12);
    expect(link(r.graph, 'specialists', 'capacity').provenance.clamped_from).toBeUndefined();
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

/**
 * ⭐ STEP 8 (capacity, served CEE 19ce8e4a, `redteam/lens-witness/runs/new-scenario.json`): the drafter gave the intermediate
 * part NO frame (no `plausible_max`, nothing held today), so `frameOf` had none, the stated pass never saw the pair, and
 * `clampForPersist` cut the user's 20 per specialist to 1 (`clamped_from: 20`): one specialist moved the goal by 1 ticket.
 * A part held at 0 with no spread now reads on the frame its link was sized on (1), so the stated pass widens it. Synthetic
 * text in the served shape; every hop is real, to the Run's PLoT request.
 */
describe('a stated per-unit effect into a part the drafter left unframed reaches the engine as the user\'s, uncut', () => {
  const BRIEF = 'We are comparing two crewing options, labelled exactly "Keep current crew" and "Add one packer". Use the exact goal '
    + 'label "Daily order throughput". Our current crew ships 50 orders per day. We need at least 70 orders per day. Keep current '
    + 'crew adds no packer. Add one packer adds one packer. Each packer adds 15 orders per day. Daily order throughput is the '
    + 'existing 50 orders per day plus the additional packer output.';
  const factor = (label: string, role: string, unit: string, baseline: number | null, max: number | null, provenance = 'inferred') =>
    ({ label, role, baseline_known: baseline !== null, baseline_value: baseline, unit, provenance, plausible_max: max });
  const link = (from: string, to: string, amount: number, definitional: true | null, quote: string | null, by = 'explicit') => ({ from, to, direction: 'positive',
    provenance: by, effect_amount: amount, effect_per_source_change: 1, effect_provenance: by, definitional, basis: null, source_quote: quote });
  const DRAFT = {
    goal: { metric: 'Daily order throughput', operator: '>=', target_stated: true, value: 70, unit: 'orders per day', horizon_months: null, provenance: 'explicit',
      frame: 'level', baseline_known: true, baseline_value: 50, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Keep current crew', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Add one packer', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Additional packers', value: 1, value_kind: 'absolute', unit: 'packers', provenance: 'explicit' }] },
    ],
    // The served shape: the existing part framed; the per-unit source and the intermediate part held at 0 with NO frame.
    factors: [factor('Existing crew output', 'observable', 'orders per day', 50, 100, 'explicit'),
      factor('Additional packers', 'controllable', 'packers', 0, null), factor('Additional packer output', 'observable', 'orders per day', 0, null)],
    risks: [], outcomes: [],
    links: [
      link('Existing crew output', 'Daily order throughput', 1, true, 'Daily order throughput is the existing 50 orders per day plus the additional packer output.'),
      link('Additional packers', 'Additional packer output', 15, null, 'Each packer adds 15 orders per day.'),
      // As served: the part's own link into the goal is not flagged definitional (a drafter loss, PROMPT-INT): Olumi's 1 per 1.
      link('Additional packer output', 'Daily order throughput', 1, null, null, 'inferred'),
    ],
    identities: [], unknowns: [], decision_question: null,
  };
  const SCENARIO = '5e8e8e8e-0000-4000-8000-0000000000b8';
  async function built(draft: Rec = DRAFT): Promise<{ graph: Rec; out: Rec }> {
    let graph: Rec | undefined;
    const out = await buildModelFromBrief(SCENARIO, BRIEF, (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    }) as never, (async () => ({ text: JSON.stringify(draft) })) as never) as Rec;
    expect(out.ok, JSON.stringify(out).slice(0, 1500)).toBe(true);
    return { graph: graph!, out };
  }
  const stored = async (draft: Rec = DRAFT): Promise<Rec> => (await built(draft)).graph;
  async function request(g: Rec): Promise<Rec> {
    const bytes = JSON.stringify(g);
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 2 })), readMostRecentPendingActions: vi.fn(async () => []) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-perunit', port as never);
    let payload: Rec | undefined;
    const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
      scenarioReader: async () => snapshot, probe: async (sent) => { payload = sent.plotPayload as Rec; } });
    await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-perunit', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ turn_id: 't-perunit', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-perunit', signal: new AbortController().signal, orientationText: '' } as never);
    expect(payload, 'the Run handler built a PLoT request').toBeDefined();
    return payload!;
  }
  /** Natural size of a link on the graph it sits in: β × F(target) / F(source), on the one frame authority. */
  const natural = (g: Rec, from: string, to: string): number => link2(g, from, to).strength.mean * frameOf(node(g, to))! / frameOf(node(g, from))!;
  const link2 = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;

  it('⭐ RED→GREEN: "each packer adds 15 orders per day" is stored as the user\'s, uncut, and the Run sends it inside the contract', async () => {
    const g = await stored();
    const users = link2(g, 'additional_packers', 'additional_packer_output');
    expect(users.provenance.magnitude).toBe('user_stated');
    expect(users.provenance.clamped_from).toBeUndefined();
    expect(Math.abs(users.strength.mean)).toBeLessThanOrEqual(1);
    expect(users.provenance.natural_effect).toMatchObject({ amount: 15, per_source_change: 1 });
    expect(natural(g, 'additional_packers', 'additional_packer_output')).toBeCloseTo(15, 9);
    const sent = (await request(g)).graph as Rec;
    const wire = link2(sent, 'additional_packers', 'additional_packer_output');
    expect(Math.abs(wire.strength.mean), 'the engine receives the user\'s effect inside the contract (PLoT does not cut it)').toBeLessThanOrEqual(1);
    expect(wire.strength.mean).toBeCloseTo(users.strength.mean, 12);
  });
  it('the part\'s own link into the goal keeps its size when the part is widened: one packer moves the goal by 15 orders per day', async () => {
    const g = await stored();
    expect(link2(g, 'additional_packer_output', 'daily_order_throughput').provenance.magnitude).toBe('olumi_estimate');
    expect(natural(g, 'additional_packer_output', 'daily_order_throughput')).toBeCloseTo(1, 9);
    expect(natural(g, 'additional_packers', 'additional_packer_output') * natural(g, 'additional_packer_output', 'daily_order_throughput')).toBeCloseTo(15, 9);
  });
});

/**
 * ⭐ STEP 8 (capacity, Codex SUMLEVELS pair AMEND; AIE: "use only the existing exact mechanism and retain its conditions"):
 * "the existing 50 plus the additional output" DECLARED as a sum (L2, `checkDeclaredSums`) over a part held at 0 that the
 * drafter left unframed. That part read as a 0–1 switch, so its definition said "per switch" and L2 refused the user's own
 * sum ("not linked … one for one in the same unit"). A definition now says its natural size per the part's own unit.
 * Route A is unchanged. Synthetic text in the served shape; every hop is real, to the Run's PLoT request.
 * ⭐ AUTHORSHIP (Codex #3440 BLOCK; AIE L2-RELATION 18bf4f8c): this draft carries no `statements`, so nothing in it states the
 * relation in the user's words; its sum is declared WITHOUT a quote, i.e. Olumi's reading (`stated_in_brief: false`). The carrier
 * is the same structural check on either path; the user's own stated sum is proven on the served SYSTEM 2 draft
 * (`declared-sum-identity.test.ts`, cfa31dfb).
 */
describe('a declared sum whose part is held at 0 with no frame is the goal\'s identity on the Run, each operand keeping its own inputs', () => {
  const BRIEF = 'We are comparing two crewing options, labelled exactly "Keep current crew" and "Add one packer". Use the exact goal '
    + 'label "Daily order throughput". Our current crew ships 50 orders per day. We need at least 70 orders per day. Keep current '
    + 'crew adds no packer. Add one packer adds one packer. Each packer adds 15 orders per day. Daily order throughput is the '
    + 'existing 50 orders per day plus the additional packer output.';
  const QUOTE = 'Daily order throughput is the existing 50 orders per day plus the additional packer output.';
  const factor = (label: string, role: string, unit: string, baseline: number | null, max: number | null, provenance = 'inferred') =>
    ({ label, role, baseline_known: baseline !== null, baseline_value: baseline, unit, provenance, plausible_max: max });
  const lk = (from: string, to: string, amount: number, definitional: true | null, quote: string | null, by = 'explicit') => ({ from, to, direction: 'positive',
    provenance: by, effect_amount: amount, effect_per_source_change: 1, effect_provenance: by, definitional, basis: null, source_quote: quote });
  const draft = (o: { declare: boolean; flag: boolean; existing?: number; quote?: string }) => ({
    goal: { metric: 'Daily order throughput', operator: '>=', target_stated: true, value: 70, unit: 'orders per day', horizon_months: null, provenance: 'explicit',
      frame: 'level', baseline_known: true, baseline_value: 50, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Keep current crew', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Add one packer', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Additional packers', value: 1, value_kind: 'absolute', unit: 'packers', provenance: 'explicit' }] },
    ],
    factors: [factor('Existing crew output', 'observable', 'orders per day', o.existing ?? 50, 100, 'explicit'),
      factor('Additional packers', 'controllable', 'packers', 0, null), factor('Additional packer output', 'observable', 'orders per day', 0, null)],
    risks: [], outcomes: [],
    links: [
      lk('Existing crew output', 'Daily order throughput', 1, true, QUOTE),
      lk('Additional packers', 'Additional packer output', 15, null, 'Each packer adds 15 orders per day.'),
      o.flag ? lk('Additional packer output', 'Daily order throughput', 1, true, QUOTE) : lk('Additional packer output', 'Daily order throughput', 1, null, null, 'inferred'),
    ],
    identities: o.declare ? [{ outcome: 'Daily order throughput', operation: 'sum', factors: ['Existing crew output', 'Additional packer output'],
      provenance: 'explicit', evidence: o.quote === undefined ? null : { quote: o.quote } }] : [],
    unknowns: [], decision_question: null,
  });
  const SCENARIO = '5e8e8e8e-0000-4000-8000-0000000000d8';
  async function built(d: Rec): Promise<{ graph: Rec; out: Rec }> {
    let graph: Rec | undefined;
    const out = await buildModelFromBrief(SCENARIO, BRIEF, (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    }) as never, (async () => ({ text: JSON.stringify(d) })) as never) as Rec;
    expect(out.ok, JSON.stringify(out).slice(0, 1500)).toBe(true);
    return { graph: graph!, out };
  }
  /** The Run's PLoT request from a COLD snapshot of the saved bytes (a fresh read, nothing carried over). */
  async function sent(g: Rec): Promise<Rec> {
    const bytes = JSON.stringify(g);
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 2 })), readMostRecentPendingActions: vi.fn(async () => []) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-sumlevels', port as never);
    let payload: Rec | undefined;
    const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
      scenarioReader: async () => snapshot, probe: async (s) => { payload = s.plotPayload as Rec; } });
    await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-sumlevels', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ turn_id: 't-sumlevels', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-sumlevels', signal: new AbortController().signal, orientationText: '' } as never);
    expect(payload, 'the Run handler built a PLoT request').toBeDefined();
    return payload!.graph as Rec;
  }
  const said = (out: Rec): string[] => { const f: string[] = []; const walk = (o: unknown): void => { if (typeof o === 'string') { if (o.includes('added together')) f.push(o); }
    else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.values(o).forEach(walk); }; walk(out); return [...new Set(f)]; };
  const goal = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  const e = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((x) => x.from === from && x.to === to)!;
  const SUM = { operation: 'sum', factor_ids: ['existing_crew_output', 'additional_packer_output'], stated_in_brief: false };

  it('⭐ RED→GREEN: declared and flagged, the identity survives construction → save → cold snapshot → Run', async () => {
    const { graph, out } = await built(draft({ declare: true, flag: true }));
    expect(said(out)).toEqual([]);
    expect(goal(graph).nonlinear_identity).toEqual(SUM);
    expect(e(graph, 'additional_packer_output', 'daily_order_throughput').provenance.natural_effect.per_source_change_unit).toBe('orders per day');
    const wire = await sent(graph);
    expect(goal(wire).nonlinear_identity).toEqual(SUM);
    for (const part of SUM.factor_ids) expect(e(wire, part, 'daily_order_throughput').exists_probability).toBe(1);
  });
  it('⭐ each operand keeps its own inputs: the levels, and the empirical link into the part, are sent exactly as without the sum', async () => {
    const withSum = await sent((await built(draft({ declare: true, flag: true }))).graph);
    const without = await sent((await built(draft({ declare: false, flag: false }))).graph);
    expect(goal(withSum).nonlinear_identity).toEqual(SUM);
    expect(goal(without).nonlinear_identity).toBeUndefined();
    const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
    for (const id of SUM.factor_ids) expect(node(withSum, id).observed_state).toEqual(node(without, id).observed_state);
    const empirical = (g: Rec): Rec => { const x = e(g, 'additional_packers', 'additional_packer_output'); return { strength: x.strength, exists: x.exists_probability, magnitude: x.provenance?.magnitude }; };
    expect(empirical(withSum)).toEqual(empirical(without));
    expect(empirical(withSum).magnitude).toBe('user_stated');
    // A change to that empirical link's own spread reaches the engine; the identity does not absorb it.
    const g = (await built(draft({ declare: true, flag: true }))).graph;
    e(g, 'additional_packers', 'additional_packer_output').strength.std /= 5;
    expect(e(await sent(g), 'additional_packers', 'additional_packer_output').strength.std).toBeCloseTo(empirical(withSum).strength.std / 5, 12);
  });
  it('NEGATIVE (fail-safe): declared, but the part\'s link is not flagged as a definition → refused and said, nothing assumed', async () => {
    const { graph, out } = await built(draft({ declare: true, flag: false }));
    expect(goal(graph).nonlinear_identity).toBeUndefined();
    expect(said(out).join(' ')).toContain('"Additional packer output" is not linked into "Daily order throughput" one for one in the same unit');
  });
  it('NEGATIVE (fail-safe): flagged but not declared → no sum (Route A is unchanged: a part with a level, or labels d5 does not hold, stay as drafted)', async () => {
    const { graph, out } = await built(draft({ declare: false, flag: true }));
    expect(goal(graph).nonlinear_identity).toBeUndefined();
    expect(said(out)).toEqual([]);
  });
  it('NEGATIVE (fail-safe): today\'s levels do not add up (50 ≠ 40 + 0) → refused and said', async () => {
    const { graph, out } = await built(draft({ declare: true, flag: true, existing: 40 }));
    expect(goal(graph).nonlinear_identity).toBeUndefined();
    expect(said(out).join(' ')).toContain('while those parts add up to');
  });
  /**
   * ⭐ Codex #3440 BLOCK (AIE L2-RELATION 18bf4f8c): with the carrier corrected, a declaration quoting a DENIAL or a mere
   * co-mention reached the Run as the user's exact sum. Codex's own two probe sentences, each the declaration's quoted source
   * and the brief's only defining sentence: no sum, the links as drafted, the reason said. The denial withholds Olumi's reading
   * too (no quote): a contradictory source is never overridden. A quoted sum is the user's: a capability still owed, so
   * temporarily fail-closed (Codex R3), whatever the sentence says.
   */
  const PROBES: [string, string | null, string][] = [
    ['Daily order throughput is not the existing 50 orders per day plus the additional packer output.', 'quoted', 'your brief says that is not so'],
    ['Daily order throughput is not the existing 50 orders per day plus the additional packer output.', null, 'your brief says that is not so'],
    ['Daily order throughput was discussed while existing crew output was 50 and additional packer output was 0.', 'quoted', 'Olumi can’t yet take a sum from your own words'],
  ];
  it.each(PROBES)('NEGATIVE (relation source): "%s" (%s) → no sum, the links as drafted, said', async (probe, how, reason) => {
    const swap = (d: Rec): Rec => JSON.parse(JSON.stringify(d).split(QUOTE).join(probe));
    const build = async (d: Rec): Promise<{ graph: Rec; out: Rec }> => {
      let graph: Rec | undefined;
      const out = await buildModelFromBrief(SCENARIO, BRIEF.replace(QUOTE, probe), (async (path: string, body: Rec) => {
        if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
        return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
      }) as never, (async () => ({ text: JSON.stringify(d) })) as never) as Rec;
      expect(out.ok, JSON.stringify(out).slice(0, 600)).toBe(true);
      return { graph: graph!, out };
    };
    const { graph, out } = await build(swap(draft({ declare: true, flag: true, ...(how === null ? {} : { quote: QUOTE }) })));
    const { graph: drafted } = await build(swap(draft({ declare: false, flag: true })));
    expect(goal(graph).nonlinear_identity).toBeUndefined();
    const [wire, base] = [await sent(graph), await sent(drafted)];
    expect(goal(wire).nonlinear_identity).toBeUndefined();
    // The links as drafted: each part's link into the goal is sent exactly as the same draft with no sum declared.
    const into = (g: Rec, part: string): Rec => { const x = e(g, part, 'daily_order_throughput'); return { exists: x.exists_probability, strength: x.strength }; };
    for (const part of SUM.factor_ids) expect(into(wire, part), part).toEqual(into(base, part));
    expect(said(out).join(' ')).toContain(reason);
  });
  it('the defining sentence QUOTED is the user\'s sum, a capability still owed (temporarily fail-closed): no sum, said', async () => {
    const { graph, out } = await built(draft({ declare: true, flag: true, quote: QUOTE }));
    expect(goal(graph).nonlinear_identity).toBeUndefined();
    expect(said(out).join(' ')).toContain('Olumi can’t yet take a sum from your own words');
  });

  it('CARRIER SCOPE: a link out of that part that is NOT a definition still says "per switch", as before', async () => {
    const { graph } = await built(draft({ declare: false, flag: false }));
    expect(e(graph, 'additional_packer_output', 'daily_order_throughput').provenance.natural_effect.per_source_change_unit).toBe('switch');
  });
});

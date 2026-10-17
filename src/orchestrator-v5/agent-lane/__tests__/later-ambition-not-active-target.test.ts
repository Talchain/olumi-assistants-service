/**
 * ⭐ G1 TURN 01 (TL 00:18Z; PL 00:16Z; e2e/VERIFY-78ca2232-founder.md): "both fast-paced angel and, eventually, a larger fund of at
 * least 1.3 million" was saved as an ACTIVE goal_target on an outcome feeding the goal, because the drafter could type a later aim
 * only as `target` or `limit`. A later ambition is never an active target: the AI reads it (`role: 'ambition'`), and admission
 * keeps it out of every constraint, keeping its figure and the user's sentence as Olumi's reading. The node and its links stay, outside
 * the current Run (DL-3 09:52Z: it no longer feeds today's goal).
 * SYNTHETIC brief (an analogue of the served founder brief, never the brief itself).
 */
import { describe, expect, it, vi } from 'vitest';
import { admitCandidateModel, admitOrdinaryCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';

type Rec = Record<string, any>;
const AIM = 'We need to raise £200,000 from angels in the next six months.';
const LATER = 'Eventually we also want a larger round of at least 2 million.';
const LEVEL = 'We have raised £50,000 so far.';
const BRIEF = `${AIM} ${LATER} ${LEVEL} We could focus on investor meetings or on finishing the product first.`;
const later = (role: 'ambition' | 'target'): Rec => ({ metric: 'Larger round raised', operator: '>=', value: 2, unit: 'million',
  provenance: 'explicit', frame: 'level', role });
function draft(role: 'ambition' | 'target' | null, withStatement = false): Rec {
  return {
    goal: { kind: null, deliverable: null, metric: 'Angel funding raised', operator: '>=', target_stated: true, value: 200000, unit: '£',
      horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 50000, baseline_provenance: 'explicit',
      scope: null, quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: role === null ? [] : [later(role)],
    options: [
      { label: 'Investor meetings first', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Investor meetings per week', value: 5, value_kind: 'absolute', unit: 'meetings', provenance: 'inferred' }] },
      { label: 'Product first', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: true,
        interventions: [{ factor_label: 'Investor meetings per week', value: 1, value_kind: 'absolute', unit: 'meetings', provenance: 'inferred' }] },
    ],
    factors: [{ label: 'Investor meetings per week', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'meetings', provenance: 'inferred', plausible_max: 10 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: 'Larger round raised', provenance: 'inferred' }],
    links: [
      { from: 'Investor meetings per week', to: 'Angel funding raised', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Investor meetings per week', to: 'Larger round raised', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    ],
    statements: [
      { quote: AIM, subject: { kind: 'goal', label: 'Angel funding raised', to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 200000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      { quote: LEVEL, subject: { kind: 'goal', label: 'Angel funding raised', to_label: null, factor_label: null }, field: 'level', form: 'point', value: 50000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      ...(withStatement ? [{ quote: LATER, subject: { kind: 'goal', label: 'Larger round raised', to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 2000000, low: null, high: null, unit: 'million', qualifier: 'eventually', conditions: null }] : []),
    ],
  };
}
const admitted = (model: Rec) => admitCandidateModel(model as CandidateModel, {}, BRIEF, (v, u) => figureTheUserWrote(v, u, BRIEF));
const outcomeId = (out: { nodes: readonly Rec[] }): string => out.nodes.find((n) => n.label === 'Larger round raised')!.id as string;
let aiCalls = 0;
let lastResult: Rec = {};
async function registered(model: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  aiCalls = 0;
  const r = await buildModelFromBrief('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e', BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => { aiCalls += 1; return { text: JSON.stringify(model), status: 'completed' }; }) as never) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 1200)).toBe(true);
  lastResult = r;
  return graph!;
}

describe('a later ambition is never an active target (G1 turn 01)', () => {
  it('⭐ the AI\'s "ambition" row is no goal_target, limit or constraint; its node, links and figure are kept, as Olumi\'s reading', () => {
    const out = admitted(draft('ambition', true));
    const id = outcomeId(out);
    expect(out.goal_constraints.filter((c) => c.node_id === id)).toEqual([]);
    expect(out.edges.some((e) => e.to === id)).toBe(true);
    const kept = out.loss.find((l) => l.after === 'retained_later_ambition');
    expect(kept, JSON.stringify(out.loss)).toBeDefined();
    expect(kept!.reason).toContain(`Later ambition, as Olumi reads your words: “${LATER}”`);
    expect(kept!.reason).toContain('at least 2 million');
    expect(kept!.reason).toContain('does not set a target this model tests');
    // The current aim is untouched: the goal keeps its own target, on the goal itself.
    expect(out.nodes.find((n) => n.kind === 'goal')).toMatchObject({ goal_threshold_raw: 200000 });
  });

  it('with no statement for it, the figure is still kept, and no sentence is claimed as the user\'s', () => {
    const out = admitted(draft('ambition'));
    const kept = out.loss.find((l) => l.after === 'retained_later_ambition')!;
    expect(kept.reason).toContain('(‘Larger round raised’, at least 2 million)');
    expect(kept.reason).not.toContain('“');
  });

  it('CONTRAST: a genuine further target the AI types "target" stays one of the goal\'s active targets (Batch C, unchanged)', () => {
    const out = admitted(draft('target'));
    expect(out.goal_constraints.filter((c) => c.node_id === outcomeId(out))).toEqual([expect.objectContaining({ role: 'goal_target', value: 2 })]);
    expect(out.loss.some((l) => l.after === 'retained_later_ambition')).toBe(false);
  });

  it('CONTRAST: a model with no later aim admits byte-identically', () => {
    expect(admitted(draft('ambition')).goal_constraints).toEqual(admitted(draft(null)).goal_constraints);
  });

  it('the build\'s fallback door (admitOrdinaryCandidateModel, called directly) keeps it out too; each door records it once', () => {
    const out = admitOrdinaryCandidateModel(draft('ambition', true) as CandidateModel, {}, BRIEF, (v, u) => figureTheUserWrote(v, u, BRIEF));
    expect(out.goal_constraints.filter((c) => c.node_id === outcomeId(out))).toEqual([]);
    expect(out.loss.filter((l) => l.after === 'retained_later_ambition')).toHaveLength(1);
    expect(admitted(draft('ambition', true)).loss.filter((l) => l.after === 'retained_later_ambition')).toHaveLength(1);
  });

  it('through the real build: a later ambition on a factor with no level asks the AI for none "for a limit" (same calls as no later aim)', async () => {
    // The gap reader (`findCoverageGaps`) asks for today's level of a LIMIT's factor; a later ambition is no limit.
    const onFactor = (role: 'ambition' | null): Rec => {
      const d = draft(null);
      d.factors.push({ label: 'Repeat investors', role: 'external', baseline_known: false, baseline_value: null, unit: 'investors', provenance: 'inferred', plausible_max: null });
      d.links.push({ ...d.links[0], from: 'Repeat investors' });
      if (role !== null) d.constraints = [{ metric: 'Repeat investors', operator: '>=', value: 10, unit: 'investors', provenance: 'explicit', frame: 'level', role }];
      return d;
    };
    await registered(onFactor(null));
    const without = aiCalls;
    await registered(onFactor('ambition'));
    expect(aiCalls).toBe(without);
    // The same for a later ambition held as a share on an OUTCOME (the reader re-kinds a percent-level outcome).
    const onShare = (role: 'ambition' | null): Rec => {
      const d = draft(null);
      d.outcomes.push({ label: 'Repeat investor share', provenance: 'inferred' });
      d.links.push({ ...d.links[0], to: 'Repeat investor share' });
      if (role !== null) d.constraints = [{ metric: 'Repeat investor share', operator: '>=', value: 40, unit: '%', provenance: 'explicit', frame: 'level', role }];
      return d;
    };
    await registered(onShare(null));
    const share = aiCalls;
    await registered(onShare('ambition'));
    expect(aiCalls).toBe(share);
  }, 60_000);

  it('⭐ B1: the reading reaches the saved node (cold GraphV3 read) and the build\'s returned explanation, as Olumi\'s, non-operative', async () => {
    const reading = `Later ambition, as Olumi reads your words: “${LATER}” (‘Larger round raised’, at least 2 million).`;
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(await registered(draft('ambition', true)))));
    const node = cold.nodes.find((n) => n.label === 'Larger round raised');
    expect(node?.description, JSON.stringify(node)).toContain(reading);
    expect(node!.description).toContain('does not set a target this model tests');
    expect((lastResult.not_represented ?? []) as string[]).toEqual(expect.arrayContaining([expect.stringContaining(reading)]));
    // CONTRAST: a genuine further target is no later ambition, and nothing says it is one.
    const target = GraphV3.parse(JSON.parse(JSON.stringify(await registered(draft('target', true)))));
    expect(target.nodes.find((n) => n.label === 'Larger round raised')?.description ?? '').not.toContain('Later ambition');
    expect(JSON.stringify(lastResult.not_represented ?? [])).not.toContain('Later ambition');
  }, 60_000);

  it('through the real build and register: the saved graph carries no active target for the later ambition', async () => {
    const g = await registered(draft('ambition', true));
    const id = (g.nodes as Rec[]).find((n) => n.label === 'Larger round raised')?.id;
    expect(id).toBeDefined();
    expect(((g.goal_constraints ?? []) as Rec[]).filter((c) => c.node_id === id)).toEqual([]);
    const contrast = await registered(draft('target', true));
    const cid = (contrast.nodes as Rec[]).find((n) => n.label === 'Larger round raised')?.id;
    expect(((contrast.goal_constraints ?? []) as Rec[]).filter((c) => c.node_id === cid)).toEqual([expect.objectContaining({ role: 'goal_target' })]);
  }, 60_000);
});

/**
 * ⭐ G1 TURN 01, second half (DL-3 09:52Z; e2e/VERIFY-8d9ef02e-founder-diagnosis.md): the later ambition was kept, but its outcome still
 * fed the current goal, so today's aim was computed through it. Its node, words and links stay; it leaves the calculation
 * (`retained_excluded`, which the Run's participation guard and the placeholder reader honour). SYNTHETIC, as above.
 */
describe('a later ambition stays in the model, outside the current Run', () => {
  /** The served shape: the drafter also links the later outcome into today's goal. */
  const intoGoal = (d: Rec): Rec => ({ ...d, links: [...d.links, { ...d.links[0], from: 'Larger round raised', to: 'Angel funding raised' }] });
  const node = (out: { nodes: readonly Rec[] }, label: string): Rec => out.nodes.find((n) => n.label === label)!;
  /** The real Run's PLoT request (the snapshot loader, then the handler up to the network). */
  const requestTheRunSends = async (graph: Rec): Promise<Rec | undefined> => {
    const scenarioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenarioId, 'g1-later-ambition', {
      loadGraphAndBriefText: async () => ({ graph, briefText: BRIEF }), readMostRecentPendingActions: async () => [],
    } as never);
    let request: Rec | undefined;
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
      probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
    await handler({ payload: { scenario_id: scenarioId, turn_id: 'g1-later-ambition', kind: 'message', message: 'Run analysis.' },
      requestId: 'g1-later-ambition', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch(() => undefined);
    return request;
  };

  it('⛔ RED → GREEN: the later outcome the drafter linked into today\'s goal is kept, with its words and links, outside the calculation', () => {
    const out = admitted(intoGoal(draft('ambition', true)));
    const later = node(out, 'Larger round raised');
    expect(later.analysis_participation).toBe('retained_excluded');
    expect(later.description).toContain(`Later ambition, as Olumi reads your words: “${LATER}”`);
    const goalId = node(out, 'Angel funding raised').id;
    expect(out.edges.some((e) => e.from === later.id && e.to === goalId), 'its link is kept, not deleted').toBe(true);
    expect(out.edges.some((e) => e.to === later.id)).toBe(true);
    // Everything else still participates: the goal, the options and the factor they set.
    expect(out.nodes.filter((n) => n.analysis_participation !== undefined).map((n) => n.label)).toEqual(['Larger round raised']);
  });

  it('⭐ through the real build, register and the real Run\'s PLoT request: saved outside the Run, and absent from what the engine receives', async () => {
    const g = await registered(intoGoal(draft('ambition', true)));
    const later = (g.nodes as Rec[]).find((n) => n.label === 'Larger round raised')!;
    expect(later.analysis_participation).toBe('retained_excluded');
    expect(GraphV3.parse(JSON.parse(JSON.stringify(g))).nodes.find((n) => n.id === later.id)?.analysis_participation).toBe('retained_excluded');
    expect((g.edges as Rec[]).some((e) => e.from === later.id), 'saved with its link').toBe(true);
    const sent = await requestTheRunSends(g);
    expect(sent, 'the Run reached the engine boundary').toBeDefined();
    expect((sent!.graph.nodes as Rec[]).some((n) => n.id === later.id)).toBe(false);
    expect((sent!.graph.edges as Rec[]).some((e) => e.from === later.id || e.to === later.id)).toBe(false);
    // CONTRAST: a genuine further target stays in what the engine receives.
    const target = await registered(intoGoal(draft('target', true)));
    const tid = (target.nodes as Rec[]).find((n) => n.label === 'Larger round raised')!.id;
    const tsent = await requestTheRunSends(target);
    expect((tsent?.graph.nodes as Rec[] | undefined)?.some((n) => n.id === tid)).toBe(true);
  }, 60_000);

  it('⛔ CONTRAST: a later ambition on today\'s goal itself never takes the goal out, even where nothing else reaches it', () => {
    // Framed so ONLY the goal rule refuses: with no link into the goal, leaving it out would cut nothing off.
    const d = draft(null);
    d.links = d.links.filter((l: Rec) => l.to !== 'Angel funding raised');
    d.constraints = [{ ...later('ambition'), metric: 'Angel funding raised' }];
    const out = admitted(d);
    expect(out.loss.some((l) => l.after === 'retained_later_ambition')).toBe(true);
    expect(node(out, 'Angel funding raised').analysis_participation).toBeUndefined();
  });

  it('⛔ CONTRAST: a later ambition on a quantity an option sets stays in (the Run would refuse to leave it out)', () => {
    // Framed so ONLY the option rule refuses: the options also set a second factor on the goal, so nothing would be cut off.
    const d = intoGoal(draft(null));
    d.factors.push({ label: 'Founder hours on investors', role: 'controllable', baseline_known: true, baseline_value: 4, unit: 'hours', provenance: 'inferred', plausible_max: 40 });
    d.links.push({ ...d.links[0], from: 'Founder hours on investors' });
    for (const o of d.options as Rec[]) o.interventions.push({ factor_label: 'Founder hours on investors', value: o.is_status_quo ? 4 : 12, value_kind: 'absolute', unit: 'hours', provenance: 'inferred' });
    d.constraints = [{ ...later('ambition'), metric: 'Investor meetings per week', unit: 'meetings', value: 8 }];
    const out = admitted(d);
    expect(out.loss.some((l) => l.after === 'retained_later_ambition')).toBe(true);
    expect(node(out, 'Investor meetings per week').analysis_participation).toBeUndefined();
  });

  it('⛔ CONTRAST: where leaving it out would cut another part off from the goal, it stays in, as before', () => {
    const d = intoGoal(draft('ambition', true));
    d.factors.push({ label: 'Pitch deck quality', role: 'external', baseline_known: true, baseline_value: 5, unit: 'score', provenance: 'inferred', plausible_max: 10 });
    d.links.push({ ...d.links[0], from: 'Pitch deck quality', to: 'Larger round raised' });
    const out = admitted(d);
    expect(node(out, 'Larger round raised').analysis_participation).toBeUndefined();
    expect(node(out, 'Pitch deck quality').analysis_participation).toBeUndefined();
  });

  it('⛔ CONTRAST: a genuine further target, and a model with no later aim, keep every node in the calculation', () => {
    expect(admitted(intoGoal(draft('target', true))).nodes.every((n) => n.analysis_participation === undefined)).toBe(true);
    expect(admitted(intoGoal(draft(null))).nodes.every((n) => n.analysis_participation === undefined)).toBe(true);
  });
});

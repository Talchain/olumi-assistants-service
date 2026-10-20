/**
 * THIN CORE ENGINE BOUNDARY (20 Oct 2026): the known-answer control, stated as a living model, through the mapper, the
 * core persistence projection, the real Run snapshot loader and `run_analysis`, up to the request PLoT receives. The
 * mapper's own suite proves the numbers; this proves the Run carries them unchanged, and that the living model (quotes,
 * views, history) stays CEE's: the engine never receives it.
 */
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { mapLivingModel } from '../mapper.js';
import { resolveRunAdmission } from '../../../tools/handlers/analysis-ready-core.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The stored core postimage, exactly as the register route writes it. */
const stored = (model = KNOWN_ANSWER): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

/** The real Run's PLoT request (the snapshot loader, then the handler up to the network), or its outcome when it sends none. */
async function requestTheRunSends(graph: Rec): Promise<{ request: Rec | undefined; outcome: unknown }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'thin-core-run', {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 'thin-core-run', kind: 'message', message: 'Run analysis.' },
    requestId: 'thin-core-run', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  return { request, outcome };
}

describe('thin core: the known-answer living model reaches the engine unchanged', () => {
  it('the Run sends the goal, both options and the sized link as mapped, and never the living model', async () => {
    const graph = stored();
    expect(graph.living_model, 'PRECONDITION: the stored graph carries the living model').toEqual(KNOWN_ANSWER);
    // The core Run tool's own gate (`run-tool.ts`) admits it: nothing is missing that the engine needs.
    const admission = resolveRunAdmission(graph);
    expect(admission.willProceed, JSON.stringify(admission.assessment.blockingIssues)).toBe(true);
    const { request, outcome } = await requestTheRunSends(graph);
    expect(request, JSON.stringify(outcome)).toBeDefined();
    expect(request!.graph).not.toHaveProperty('living_model');
    expect(request!.goal_node_id).toBe('g');
    const goal = (request!.graph.nodes as Rec[]).find((n) => n.id === 'g')!;
    expect(goal).toMatchObject({ goal_threshold: 0.8, goal_threshold_raw: 100, goal_threshold_cap: 125 });
    const options = Object.fromEntries((request!.options as Rec[]).map((o) => [o.option_id ?? o.id, o.interventions]));
    expect(Object.keys(options).sort()).toEqual(['hold', 'push']);
    expect(JSON.stringify(options.push)).toMatch(/"f":(1|\{[^}]*"value":1[,}])/);
    expect(JSON.stringify(options.hold)).toMatch(/"f":(0\.5|\{[^}]*"value":0\.5[,}])/);
    const link = (request!.graph.edges as Rec[]).find((e) => e.from === 'f' && e.to === 'g')!;
    expect(link.strength.mean).toBeCloseTo(0.4, 10);
    expect(link.strength.std).toBeCloseTo(0.08, 4);
  });

  it('options that state their own exact effect reach the engine as the goal\'s exact sum: today + each option\'s change', async () => {
    const graph = stored(OPTION_EFFECTS);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    const { request, outcome } = await requestTheRunSends(graph);
    expect(request, JSON.stringify(outcome)).toBeDefined();
    const nodes = request!.graph.nodes as Rec[];
    const goal = nodes.find((n) => n.id === 'w')!;
    expect(goal.nonlinear_identity).toEqual({ operation: 'sum', factor_ids: ['w_today', 'w__change'], stated_in_brief: false });
    expect(nodes.find((n) => n.id === 'w_today')!.observed_state).toMatchObject({ raw_value: 40 });
    const options = Object.fromEntries((request!.options as Rec[]).map((o) => [o.option_id ?? o.id, JSON.stringify(o.interventions)]));
    // The sum is added in the goal's own units, so each option sends its change as stated.
    expect(options.a).toContain('"w__change":30');
    expect(options.b).toContain('"w__change":19.9');
    for (const part of ['w_today', 'w__change']) {
      expect((request!.graph.edges as Rec[]).find((e) => e.from === part && e.to === 'w')).toMatchObject({ exists_probability: 1, provenance: { definitional: true } });
    }
  });

  it('served KA1 bcf2818c: a stated link carries its size in the person\'s units, so the target is testable (not "needs a size for the link")', () => {
    expect(targetTestabilityOf(stored())).toEqual({ kind: 'testable', goal_id: 'g' });
    const link = (stored().edges as Rec[]).find((e) => e.from === 'f' && e.to === 'g')!;
    expect(link.provenance.natural_effect).toEqual({ amount: 50, amount_unit: 'units', per_source_change: 1, per_source_change_unit: '',
      strength_mean: link.strength.mean, strength_mean_frame: 'edge_strength' });
    expect(targetTestabilityOf(stored(OPTION_EFFECTS))).toEqual({ kind: 'testable', goal_id: 'w' });
  });

  it('served capacity 20 Oct (Lenses): "about 20, between 10 and 30" keeps the target testable, never "needs a size for the link"', () => {
    const centred = structuredClone(KNOWN_ANSWER);
    centred.links[0]!.effect = { form: 'range', value: 50, low: 30, high: 70, sd: null, unit: 'units', sign: '+' };
    expect(targetTestabilityOf(stored(centred))).toEqual({ kind: 'testable', goal_id: 'g' });
    // CONTROL: a bare range still asks for a size.
    const bare = structuredClone(centred);
    bare.links[0]!.effect.value = null;
    expect(targetTestabilityOf(stored(bare)).kind).not.toBe('testable');
  });
});

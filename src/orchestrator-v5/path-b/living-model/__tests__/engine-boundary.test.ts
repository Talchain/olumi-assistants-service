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
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The stored core postimage, exactly as the register route writes it. */
const stored = (): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(KNOWN_ANSWER).graph, living_model: KNOWN_ANSWER })) as Rec;

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
});

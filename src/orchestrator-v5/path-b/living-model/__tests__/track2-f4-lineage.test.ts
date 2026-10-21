/**
 * TRACK 2 F4 (21 Oct 2026): "B was developed from A" is a record of where an option came from, never a cause. Lineage lives
 * in the living model only, so it changes no engine input, no Run request and no analysis fingerprint; a change to what
 * the option DOES changes all three. The person still sees the lineage change (the proposal's diff) and gets it back on
 * reopen. Proposal → approval writes exactly once (`living-change.test.ts`, unchanged here).
 */
import { tool } from '@openai/agents';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { BuildModelParams } from '../../tools/draft-tool.js';
import { diffLivingModels } from '../diff.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { livingViewOf } from '../view.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** The known-answer model plus "Push lite", a cheaper version of Push (f to 0.8), with or without its lineage. */
const withLite = (developed_from: string | null, level = 0.8): LivingModelT => ({ ...KNOWN_ANSWER,
  options: [...KNOWN_ANSWER.options, { id: 'push_lite', label: 'Push lite', developed_from, source: 'user', party: null, quote: 'a lighter push, f to 0.8',
    settings: [{ factor_id: 'f', value: level, low: null, high: null, unit: null, source: 'user', party: null, quote: 'a lighter push, f to 0.8' }] }] });
const PLAIN = withLite(null);
const DEVELOPED = withLite('push');

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

async function requestTheRunSends(model: LivingModelT): Promise<Rec> {
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'f4', {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 'f4', kind: 'message', message: 'Run analysis.' },
    requestId: 'f4', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  return request!;
}

describe('Track 2 F4: option lineage is a record, never a cause', () => {
  it('lineage alone changes no engine graph, no Run request and no analysis fingerprint', async () => {
    expect(mapLivingModel(DEVELOPED).graph).toEqual(mapLivingModel(PLAIN).graph);
    expect(await requestTheRunSends(DEVELOPED)).toEqual(await requestTheRunSends(PLAIN));
    const hash = computeAnalysisAffectingGraphHash(stored(DEVELOPED) as never);
    expect(hash).not.toBeNull();
    expect(hash).toBe(computeAnalysisAffectingGraphHash(stored(PLAIN) as never));
  });

  it('CONTROL: changing what the option DOES (f to 0.9) changes the fingerprint, so the Run is stale and recomputed', () => {
    expect(computeAnalysisAffectingGraphHash(stored(withLite('push', 0.9)) as never)).not.toBe(computeAnalysisAffectingGraphHash(stored(DEVELOPED) as never));
  });

  it('NEGATIVE: lineage is never compiled as a link, a node or any engine field', () => {
    const { graph } = mapLivingModel(DEVELOPED);
    expect((graph.edges as Rec[]).some((e) => [e.from, e.to].includes('push') && [e.from, e.to].includes('push_lite'))).toBe(false);
    expect(JSON.stringify(graph)).not.toContain('developed_from');
  });

  it('the person sees it: the proposal\'s diff names the one changed option, and a cold reopen reads the lineage back', () => {
    expect(diffLivingModels(PLAIN, DEVELOPED).map((c) => `${c.kind}:${c.id}:${c.change}`)).toEqual(['option:push_lite:change']);
    const reopened = livingViewOf(stored(DEVELOPED)) as Rec;
    expect(reopened.living_model.options.find((o: Rec) => o.id === 'push_lite').developed_from).toBe('push');
  });

  it('the kernel rewrites a lineage id with the option it names', () => {
    const raw = structuredClone(DEVELOPED);
    raw.options[1]!.id = 'Push';
    raw.options[2]!.developed_from = 'Push';
    expect(applyKernel(raw, []).model.options[2]!.developed_from).toBe('push');
  });

  it('the AI is told it is a record, not a cause; a model saved before reads null', () => {
    const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
    expect(sent).toContain('A record of where it came from, not a cause: it changes no figure.');
    const before = structuredClone(KNOWN_ANSWER) as Rec;
    delete before.options[0].developed_from;
    expect(LivingModel.parse(before).options[0]!.developed_from).toBeNull();
  });
});

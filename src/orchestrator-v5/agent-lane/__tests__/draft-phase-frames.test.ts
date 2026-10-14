/**
 * ⭐ P44 S2 — streamed draft phases mark real dispatches, using PROGRESS.
 * ⛔ P44 S2 — skipped runs, replayed builds and composed replies emit nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import * as stageStream from '../../../cee/unified-pipeline/stage-stream-context.js';
import type { PipelineStageEvent } from '../../../cee/unified-pipeline/types.js';
import { runFirstAnalysisAfterConstruction, type FirstAnalysisParams } from '../first-analysis.js';
import { runAgentTurn, type AgentTurnInput, type ModelCallRequest, type ModelCallResponse } from '../runtime/agent-loop.js';
import type { AgentCapabilities, ToolResult } from '../runtime/agent-tools.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { buildConstructionAutoRunProvenance, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { READY_GRAPH, BLOCKED_GRAPH } from './fixtures/first-analysis-graphs.js';

afterEach(() => vi.restoreAllMocks());

describe('P44 S2: ambient phase emission', () => {
  it('RED: emits exactly one empty-label PROGRESS frame with elapsed time', async () => {
    const frames: PipelineStageEvent[] = [];
    await stageStream.runWithStageStream((event) => frames.push(event), async () => {
      stageStream.emitAgentPhase('first_analysis');
    });
    expect(frames).toEqual([{
      kind: 'PROGRESS', labels: [], phase: 'first_analysis', elapsed_ms: expect.any(Number),
    }]);
    expect(frames[0]!.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('RED: elapsed time starts when the stream context starts', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_025);
    await stageStream.runWithStageStream(() => {}, async () => {
      expect(stageStream.stageElapsedMs()).toBe(25);
    });
  });

  it('CONTROL: outside a streamed turn, elapsed time is absent and emission is a no-op', () => {
    expect(stageStream.stageElapsedMs()).toBeUndefined();
    expect(() => stageStream.emitAgentPhase('first_analysis')).not.toThrow();
    expect(() => stageStream.emitAgentPhase('writing')).not.toThrow();
  });

  it('CONTROL: a throwing observer cannot cost the turn', async () => {
    const emit = vi.fn(() => { throw new Error('socket closed'); });
    await stageStream.runWithStageStream(emit, async () => {
      expect(() => stageStream.emitAgentPhase('first_analysis')).not.toThrow();
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

const SCENARIO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
const CONSTRUCTION = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));
const REVISION = 'revision-hash-after-construction';
const priorFact = {
  fact_type: 'run_analysis', fact_id: 'first-run', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO, graph_hash_at_run: REVISION, summary: 'A first pass.',
    enrichment: { [RUN_PROVENANCE_ENRICHMENT_KEY]: buildConstructionAutoRunProvenance(CONSTRUCTION) },
  },
} as unknown as HandlerFact;

function analysisHarness(overrides: Partial<FirstAnalysisParams> = {}) {
  const frames: PipelineStageEvent[] = [];
  const order: string[] = [];
  const dispatchRunAnalysis = vi.fn(async () => {
    order.push('dispatch');
    return {
      outcome: 'ok', response: { assistant_text: 'Ran.', blocks: [{ type: 'analysis_result', summary: 'A first pass.' }] },
      commitPerformed: true, analysisReady: { status: 'ready' }, graph: null, mayNameLeadingOption: false,
    } as never;
  });
  const params: FirstAnalysisParams = {
    scenarioId: SCENARIO, constructionTurnId: CONSTRUCTION, revisionGraph: READY_GRAPH,
    revisionHash: REVISION, requestId: 'p44-s2', deadlineAt: Date.now() + 60_000,
    readPriorFacts: async () => ({ status: 'ok', facts: [] }),
    onDispatch: () => { order.push('onDispatch'); }, dispatchRunAnalysis,
    ...overrides,
  };
  const run = () => stageStream.runWithStageStream((event) => {
    frames.push(event);
    if (event.kind === 'PROGRESS') order.push(event.phase);
  }, () => runFirstAnalysisAfterConstruction(params));
  return { frames, order, dispatchRunAnalysis, run };
}

describe('P44 S2: automatic first-analysis dispatch', () => {
  it('RED: first_analysis is emitted once, after onDispatch and before the real dispatch', async () => {
    const h = analysisHarness();
    expect((await h.run()).ran).toBe(true);
    expect(h.dispatchRunAnalysis).toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(['onDispatch', 'first_analysis', 'dispatch']);
    expect(h.frames).toEqual([expect.objectContaining({ kind: 'PROGRESS', labels: [], phase: 'first_analysis' })]);
  });

  it.each([
    ['not_admissible', () => ({ revisionGraph: BLOCKED_GRAPH })],
    ['no_time', () => ({ deadlineAt: Date.now() - 1 })],
    ['already_ran_for_construction', () => ({ readPriorFacts: async () => ({ status: 'ok' as const, facts: [priorFact] }) })],
  ] as const)('CONTROL: %s emits nothing', async (reason, overrides) => {
    const h = analysisHarness(overrides());
    expect(await h.run()).toMatchObject({ ran: false, reason });
    expect(h.dispatchRunAnalysis).not.toHaveBeenCalled();
    expect(h.frames).toEqual([]);
    expect(h.order).toEqual([]);
  });
});

const ANSWER: ModelCallResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is the model.' }] }] };
const toolCall = (name: string, id = 'c1'): ModelCallResponse => ({
  output: [{ type: 'function_call', name, call_id: id, arguments: JSON.stringify(name === 'build_model_from_brief'
    ? { brief: BRIEF }
    : { label: 'Delivery delay', affects: [{ target_label: 'Reliability', direction: 'negative' }], rationale: 'Hiring takes time.', whole_request: false }) }],
});

function turnHarness(result: ToolResult, options: {
  tool?: string; composeReply?: AgentTurnInput['composeReply']; hostFirstCall?: AgentTurnInput['hostFirstCall'];
  responses?: ModelCallResponse[];
} = {}) {
  const frames: PipelineStageEvent[] = [];
  const order: string[] = [];
  const tool = options.tool ?? 'build_model_from_brief';
  const capability = vi.fn(async () => { order.push('tool'); return result; });
  const caps = { buildModelFromBrief: capability, proposeNewRisk: capability } as unknown as AgentCapabilities;
  const responses = [...(options.responses ?? [toolCall(tool), ANSWER])];
  let calls = 0;
  const callModel = vi.fn(async (request: ModelCallRequest) => {
    if (request.purpose === 'prewarm') { order.push('prewarm'); return ANSWER; }
    order.push(`model:${++calls}`);
    return responses.shift()!;
  });
  const input: AgentTurnInput = {
    ctx: { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'p44-s2' },
    history: [], message: BRIEF, instructions: 'i', maxOutputTokens: 500,
    composeReply: options.composeReply ?? (() => null), hostFirstCall: options.hostFirstCall,
  };
  const run = () => runAgentTurn(input, caps, callModel);
  const streamed = () => stageStream.runWithStageStream((event) => {
    frames.push(event);
    if (event.kind === 'PROGRESS') order.push(event.phase);
  }, run);
  return { frames, order, capability, callModel, run, streamed };
}

describe('P44 S2: the provider reply call after a fresh build', () => {
  it('RED: writing is emitted once, before the second provider call', async () => {
    const h = turnHarness({ ok: true, mutated: true });
    expect((await h.streamed()).assistant_text).toBe('Here is the model.');
    expect(h.callModel).toHaveBeenCalledTimes(2);
    expect(h.capability).toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(['model:1', 'tool', 'writing', 'model:2']);
    expect(h.frames).toEqual([expect.objectContaining({ kind: 'PROGRESS', labels: [], phase: 'writing' })]);
  });

  it('RED: two successful build hops still emit writing only once per turn', async () => {
    const h = turnHarness({ ok: true, mutated: true }, {
      responses: [toolCall('build_model_from_brief'), toolCall('build_model_from_brief', 'c2'), ANSWER],
    });
    await h.streamed();
    expect(h.capability).toHaveBeenCalledTimes(2);
    expect(h.order).toEqual(['model:1', 'tool', 'writing', 'model:2', 'tool', 'model:3']);
    expect(h.frames).toHaveLength(1);
  });

  it('RED: a host build emits writing before its reply call, never before the prewarm', async () => {
    const h = turnHarness({ ok: true, mutated: true }, {
      hostFirstCall: { name: 'build_model_from_brief', args: { brief: BRIEF } }, responses: [ANSWER],
    });
    await h.streamed();
    expect(h.order).toEqual(['prewarm', 'tool', 'writing', 'model:1']);
    expect(h.frames).toHaveLength(1);
  });

  it.each([
    ['refused', { ok: false, mutated: false, refusal: 'construction_failed' }],
    ['unsuccessful despite mutation', { ok: false, mutated: true }],
    ['unmutated', { ok: true, mutated: false }],
    ['replayed', { ok: true, mutated: false, replayed: true }],
    ['registration replay', { ok: true, mutated: true, replayed: true }],
  ] as const)('CONTROL: %s build emits nothing', async (_label, result) => {
    const h = turnHarness(result);
    await h.streamed();
    expect(h.callModel).toHaveBeenCalledTimes(2);
    expect(h.capability).toHaveBeenCalledTimes(1);
    expect(h.frames).toEqual([]);
  });

  it('CONTROL: composeReply answers the build with one provider call and no writing frame', async () => {
    const h = turnHarness({ ok: true, mutated: true }, { composeReply: () => 'The model is ready.' });
    expect((await h.streamed()).assistant_text).toBe('The model is ready.');
    expect(h.callModel).toHaveBeenCalledTimes(1);
    expect(h.frames).toEqual([]);
  });

  it('CONTROL: a held non-build tool emits nothing', async () => {
    const h = turnHarness({ ok: true, mutated: false, proposal_id: 'held-risk' }, { tool: 'propose_new_risk' });
    await h.streamed();
    expect(h.callModel).toHaveBeenCalledTimes(2);
    expect(h.capability).toHaveBeenCalledTimes(1);
    expect(h.frames).toEqual([]);
  });

  it('CONTROL: a hop-zero answer emits nothing', async () => {
    const h = turnHarness({ ok: true, mutated: true }, { responses: [ANSWER] });
    await h.streamed();
    expect(h.callModel).toHaveBeenCalledTimes(1);
    expect(h.capability).not.toHaveBeenCalled();
    expect(h.frames).toEqual([]);
  });

  it('CONTROL: outside a streamed turn, the same build result returns without throwing', async () => {
    const streamed = turnHarness({ ok: true, mutated: true });
    const buffered = turnHarness({ ok: true, mutated: true });
    const expected = await streamed.streamed();
    const actual = await buffered.run();
    expect(actual.assistant_text).toBe(expected.assistant_text);
    expect(actual.tool_calls).toEqual(expected.tool_calls);
    expect(actual.tool_results).toEqual(expected.tool_results);
    expect(actual.items).toEqual(expected.items);
    expect(actual.mutated).toBe(expected.mutated);
    expect(actual.stopped_reason).toBe(expected.stopped_reason);
    expect(buffered.callModel).toHaveBeenCalledTimes(2);
  });
});

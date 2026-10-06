/** FR2: witnessed wire slices, real Run handler and projections; only the provider SDK is mocked. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import captures from './fixtures/factor-review-witness.json';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: sdk.create } }; } }));

import { config } from '../../../config/index.js';
import { OPENAI_ONLY, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { buildEnrichFactorsInput, extractControllableFactors } from '../../../services/review/enrichFactors.js';
import type { GraphT } from '../../../schemas/graph.js';
import { agentFactorEnrichments, factorReviewSensitivity, readFactorEnrichments } from '../factor-review.js';
import { decisionReviewFor, factorReviewPressLine } from '../decision-review-press.js';

type Capture = (typeof captures)[number];
type ProviderInput = { controllable_factors: { factor_id: string; label: string }[];
  factor_sensitivity: { factor_id: string; elasticity: number; rank: number }[] };
type ProviderRequest = { model: string; messages: { role: string; content: string }[] };
const QUESTION = 'What evidence would test this assumption in this model?';
const providerInputs: ProviderInput[] = [];
const enrichment = (factor_id: string, sensitivity_rank: number) => ({ factor_id, sensitivity_rank,
  observations: ['This factor affects the model result.'], perspectives: ['Evidence could test the assumption.'],
  ...(sensitivity_rank <= 3 ? { confidence_question: QUESTION } : {}) });

// Reflect only factors the real service actually supplies. A canned rank-1 answer would mask its input drop.
function providerResponse(request: ProviderRequest) {
  const prompt = request.messages.find(m => m.role === 'user')!.content;
  const input = JSON.parse(prompt.slice(prompt.indexOf('INPUT:\n') + 'INPUT:\n'.length,
    prompt.lastIndexOf('\n\nOutput ONLY'))) as ProviderInput;
  providerInputs.push(input);
  const ids = new Set(input.controllable_factors.map(f => f.factor_id));
  return { choices: [{ message: { content: JSON.stringify({ enrichments: input.factor_sensitivity
    .filter(f => ids.has(f.factor_id)).map(f => enrichment(f.factor_id, f.rank)) }) } }] };
}

async function runCapture(capture: Capture, options: { agent?: boolean; sensitivity?: unknown } = {}) {
  const graph = capture.graph;
  const goal = graph.nodes.find(n => n.kind === 'goal')!;
  // Envelope scaffolding from factor-review-served.test.ts's passing plotResponse.
  // Status/meta/results are test inputs, not fields recovered from the UI capture.
  // Keep the captured comparison and sensitivity verbatim: withheld win probabilities
  // cannot supply the usable-result fallback when analysis_status is absent.
  const response: Record<string, unknown> = {
    analysis_status: 'computed',
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    response_hash: 'h',
    results: [],
    ...structuredClone(capture.enrichment),
  };
  if (Object.hasOwn(options, 'sensitivity')) response.factor_sensitivity = options.sensitivity;
  // Replay the UI enrichment slice inside the valid PLoT envelope through the dependency seam.
  const handler = createRunAnalysisHandler({
    plotClient: { run: async () => response as never, validatePatch: async () => { throw new Error('Unexpected patch'); } },
    scenarioReader: async () => ({ graph, rawPersistedGraph: graph, goal_node_id: goal.id,
      options: graph.nodes.filter(n => n.kind === 'option').map(n => ({ ...n, option_id: n.id })) }),
  });
  const call: HandlerInvocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [], session_id: capture.request.scenario_id, request_id: 'fr2-witness',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: graph } as unknown as HandlerInvocation['context'],
    payload: { ...capture.request, turn_id: randomUUID() } as HandlerInvocation['payload'],
    requestId: 'fr2-witness', signal: new AbortController().signal, orientationText: '',
  };
  const policy = OPENAI_ONLY('agent_v1_turn');
  const outcome = options.agent === false ? await handler(call) : await runWithProviderPolicy(policy, () => handler(call));
  const produced = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
  expect(produced).toBeDefined();
  // Real fact schema after a JSON round trip: this proves storage compatibility, not a database commit.
  const stored = RunAnalysisHandlerFactSchema.parse(JSON.parse(JSON.stringify(produced)));
  const analysisResult = buildAnalysisResultBlock(stored);
  const read = { graph, graphHash: stored.result.graph_hash_at_run,
    analysisState: { ...capture.analysis_state, run_state: { kind: 'complete_current', computed_at: stored.result.computed_at } },
    analysisResult, analysisReady: buildCanonicalAnalysisReadyFromGraph(graph as never),
    factorEnrichments: readFactorEnrichments(stored.result.enrichment?.factor_enrichments) };
  return { outcome, stored, read, policy };
}

describe('FR2 factor review from witnessed Run shapes', () => {
  const saved = { provider: config.llm.provider, key: config.llm.openaiApiKey, model: config.cee.models.extraction };
  beforeEach(() => {
    sdk.create.mockReset(); providerInputs.length = 0;
    config.llm.provider = 'openai'; config.llm.openaiApiKey = 'test-openai';
    config.cee.models.extraction = 'claude-sonnet-5';
    sdk.create.mockImplementation(async (request: ProviderRequest) => providerResponse(request));
  });
  afterAll(() => {
    config.llm.provider = saved.provider; config.llm.openaiApiKey = saved.key; config.cee.models.extraction = saved.model;
  });

  it.each(captures.filter(c => !c.top_controllable))(
    'RED at base: $name supplies and stores its observable rank-1 driver', async capture => {
      const { stored, read, policy } = await runCapture(capture);
      const top = capture.top_factor_id;
      expect(providerInputs[0]!.factor_sensitivity).toContainEqual(expect.objectContaining({ factor_id: top, rank: 1 }));
      expect(providerInputs[0]!.controllable_factors).toContainEqual(expect.objectContaining({ factor_id: top }));
      expect(stored.result.enrichment).toHaveProperty('factor_enrichments', expect.arrayContaining([enrichment(top, 1)]));
      expect(policy.calls).toMatchObject([{ site: 'extraction.openai', model: 'gpt-4.1-2025-04-14', outcome: 'allowed' }]);
      const label = capture.graph.nodes.find(n => n.id === top)!.label;
      const words = `The result moves most with ‘${label}’. A question to test it: ${QUESTION}`;
      expect(factorReviewPressLine(read)).toBe(words);
      const before = sdk.create.mock.calls.length;
      const review = decisionReviewFor(capture.request.scenario_id, read);
      expect(review.bound).toBe(true); expect(review.reply.split(words)).toHaveLength(2);
      expect(sdk.create).toHaveBeenCalledTimes(before);
      // Transport omission is intentional: the persisted member is read separately.
      expect(read.analysisResult.enrichment).not.toHaveProperty('factor_enrichments');
    },
  );

  it.each(captures.filter(c => c.top_controllable))(
    'CONTROL: $name keeps the influence-ranked controllable driver despite zero elasticity', async capture => {
      const top = capture.enrichment.factor_sensitivity.find(f => f.factor_id === capture.top_factor_id)!;
      expect(top).toMatchObject({ elasticity: 0, influence_rank: 1, influence_score: 1 });
      const { read } = await runCapture(capture);
      expect(providerInputs[0]!.factor_sensitivity).toContainEqual({ factor_id: top.factor_id, elasticity: 0, rank: 1 });
      expect(read.factorEnrichments).toContainEqual(enrichment(top.factor_id, 1));
      expect(factorReviewPressLine(read)).toContain(QUESTION);
    },
  );

  it('CONTROL: legacy input and helper still exclude the same witnessed observable factor', () => {
    const capture = captures.find(c => c.name === 't1b-guest-evening')!;
    // The existing service's legacy GraphT annotation differs from the witnessed V3 wire; only nodes/edges are read.
    const graph = capture.graph as unknown as GraphT;
    expect(extractControllableFactors(graph).map(f => f.factor_id)).not.toContain(capture.top_factor_id);
    const input = buildEnrichFactorsInput(graph, factorReviewSensitivity(capture.enrichment.factor_sensitivity));
    expect(input.controllable_factors.map(f => f.factor_id)).not.toContain(capture.top_factor_id);
  });

  it('CONTROL: a conventional Run makes no enrichment call', async () => {
    const { stored } = await runCapture(captures[0]!, { agent: false });
    expect(stored.result.enrichment).not.toHaveProperty('factor_enrichments'); expect(sdk.create).not.toHaveBeenCalled();
  });

  it.each([undefined, []])('CONTROL: absent/empty sensitivity (%j) makes no call', async sensitivity => {
    const { stored } = await runCapture(captures[0]!, { sensitivity });
    expect(stored.result.enrichment).not.toHaveProperty('factor_enrichments'); expect(sdk.create).not.toHaveBeenCalled();
  });

  it('CONTROL: missing graph ids and non-factor nodes never enter the provider input', async () => {
    const capture = captures[0]!;
    const goalId = capture.graph.nodes.find(n => n.kind === 'goal')!.id;
    await runCapture(capture, { sensitivity: [
      ...capture.enrichment.factor_sensitivity,
      { factor_id: 'missing-factor', elasticity: 0, influence_score: 0.001 },
      { factor_id: goalId, elasticity: 0, influence_score: 0.001 },
    ] });
    expect(providerInputs[0]!.factor_sensitivity.map(f => f.factor_id)).not.toContain('missing-factor');
    expect(providerInputs[0]!.factor_sensitivity.map(f => f.factor_id)).not.toContain(goalId);
  });

  it.each(['identity', 'rank'])('CONTROL: the provider cannot change the driver %s', async mutant => {
    sdk.create.mockImplementationOnce(async (request: ProviderRequest) => {
      providerResponse(request);
      const top = captures[0]!.top_factor_id;
      return { choices: [{ message: { content: JSON.stringify({ enrichments: [
        enrichment(mutant === 'identity' ? 'missing-factor' : top, mutant === 'rank' ? 2 : 1),
      ] }) } }] };
    });
    const { stored, read } = await runCapture(captures[0]!);
    expect(stored.result.enrichment).not.toHaveProperty('factor_enrichments'); expect(factorReviewPressLine(read)).toBeNull();
  });

  it('CONTROL: failed enrichment preserves the completed Run without generated questions', async () => {
    sdk.create.mockRejectedValueOnce(new Error('Provider unavailable'));
    const { stored, read } = await runCapture(captures[0]!);
    expect(stored.fact_type).toBe('run_analysis'); expect(stored.result.enrichment).not.toHaveProperty('factor_enrichments');
    expect(factorReviewPressLine(read)).toBeNull();
  });

  it('CONTROL: the expired outer signal still skips optional work', async () => {
    const outer = new AbortController(); outer.abort();
    const capture = captures[0]!;
    expect(await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () =>
      agentFactorEnrichments(capture.graph, capture.enrichment.factor_sensitivity, 'expired', outer.signal))).toBeUndefined();
    expect(sdk.create).not.toHaveBeenCalled();
  });
});

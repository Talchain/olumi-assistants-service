/**
 * ⛔ THE AUTOMATIC FIRST ANALYSIS IS OPENAI-ONLY, EVEN WHERE THE CONVENTIONAL LANE AWAITS decision_review
 * (PR-B, test 8).
 *
 * The runner calls the REAL `dispatchChipClickRunAnalysis` in-process (no seam), with the persistence,
 * scenario read and PLoT handler stubbed exactly as `chip-click-dispatch.test.ts` stubs them. The legacy
 * decision_review (an Anthropic call) is skipped by ONE thing: `chip.id === AGENT_RUN_ANALYSIS_CHIP_ID`.
 * With `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true` any other id — including the existing post-draft
 * auto-run's `auto_run_post_draft` — would await it. The stubbed enricher behaves like the real one at
 * the provider boundary: it asks the provider policy for Anthropic, which the OpenAI-only policy
 * records (and refuses) — so a row on the ledger is the measurement, not an inference.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';

const { loadSnapshotMock, commitMock, enrichMock, runHandlerMock, buildTurnContextMock } = vi.hoisted(() => ({
  loadSnapshotMock: vi.fn(),
  commitMock: vi.fn(),
  enrichMock: vi.fn(),
  runHandlerMock: vi.fn(),
  buildTurnContextMock: vi.fn(),
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadSnapshotMock,
    buildTurnContext: buildTurnContextMock,
    loadPriorFactsWithReadState: async () => ({ status: 'ok', facts: [] }),
  };
});
vi.mock('../../commit.js', () => ({ commitDirectAnswer: commitMock, computeRequestHash: vi.fn().mockReturnValue('sha256:testhash') }));
vi.mock('../../coaching/decision-review-enricher.js', () => ({ enrichRunAnalysisWithDecisionReview: enrichMock }));
vi.mock('../../tools/registry.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createRegistry: () => new Map<string, unknown>([['run_analysis', runHandlerMock]]),
    resolveHandler: (registry: Map<string, unknown>, id: string) => registry.get(id) ?? null,
  };
});

import { runFirstAnalysisAfterConstruction } from '../first-analysis.js';
import { dispatchChipClickRunAnalysis, AUTO_RUN_POST_DRAFT_CHIP_ID } from '../../handlers/chip-click-dispatch.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { OPENAI_ONLY, assertProviderAllowed, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTEXT = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: { can_run_analysis: false, can_edit_graph: false, can_run_decision_review: false, can_generate_coaching: false, can_invoke_tools: false, can_commit_session_state: false },
  messages: [{ role: 'user' as const, content: 'x' }],
  session_id: SCENARIO,
  request_id: 'req-test',
  budgets: { turn_ms: 30000, handler_ms: 20000, plot_ms: 15000, anthropic_ms: 15000, openai_ms: 15000 },
  prior_turns: [],
  prior_facts: [] as unknown[],
  scenarioBriefText: 'Should we hire a tech lead or two developers?',
  persistedGraph: null,
};

describe('RED: the first analysis never reaches Anthropic (test 8)', () => {
  let prior: string | undefined;
  beforeEach(async () => {
    prior = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(CONTEXT);
    loadSnapshotMock.mockResolvedValue({ graph: READY_GRAPH, options: [], goal_node_id: 'goal_x', rawPersistedGraph: READY_GRAPH });
    runHandlerMock.mockResolvedValue({
      assistant_text: 'Ran analysis.',
      handler_facts: [{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: { scenario_id: SCENARIO, leading_option_id: 'opt_a', win_probabilities: { opt_a: 0.7, opt_b: 0.3 }, summary: 'Done.', enrichment: {} } }],
      llm_calls_used: 0,
    });
    // At the provider boundary the real enricher calls Anthropic: the policy records it.
    enrichMock.mockImplementation(async ({ handlerFacts }: { handlerFacts: unknown[] }) => {
      try { assertProviderAllowed('anthropic', 'decision-review-enricher', { model: 'claude', purpose: 'decision_review' }); } catch { /* refused before network */ }
      return handlerFacts;
    });
    commitMock.mockImplementation(async (r: unknown) => ({ response: r, performed: true, persisted_row_id: 'row-1', graphPersisted: false }));
  });
  afterEach(async () => {
    if (prior === undefined) delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    else process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = prior;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('RED: the Agent chip id is sent, the review is never invoked, and the ledger holds no non-OpenAI row', async () => {
    const { out, calls } = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
      const o = await runFirstAnalysisAfterConstruction({
        scenarioId: SCENARIO, constructionTurnId: 'graph_registration:k', revisionGraph: READY_GRAPH, revisionHash: 'h',
        requestId: 'req-fa', deadlineAt: Date.now() + 60_000,
      });
      return { out: o, calls: recordedProviderCalls() };
    });
    expect(out.ran, JSON.stringify(out)).toBe(true);
    expect(runHandlerMock, 'the canonical analysis still ran').toHaveBeenCalledTimes(1);
    const sentPayload = buildTurnContextMock.mock.calls[0]![0] as { chip?: { id?: unknown } };
    expect(sentPayload.chip?.id).toBe(AGENT_RUN_ANALYSIS_CHIP_ID);
    expect(enrichMock, 'decision_review is never invoked').not.toHaveBeenCalled();
    expect(calls.filter((c) => c.provider !== 'openai')).toEqual([]);
  });

  it('CONTRAST (the probe can see): the post-draft auto-run chip through the SAME dispatcher awaits the review and leaves an anthropic row', async () => {
    const calls = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
      await dispatchChipClickRunAnalysis({
        payload: { kind: 'message', scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', stage: 'analyse', turn_class: 'decide', source: 'chip_click', message: 'x', chip: { id: AUTO_RUN_POST_DRAFT_CHIP_ID, action_type: 'run_analysis' } } as never,
        requestId: 'req-contrast', autoRun: { draftTurnId: 'd' },
      });
      return recordedProviderCalls();
    });
    expect(enrichMock).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.provider === 'anthropic').length).toBeGreaterThan(0);
  });
});

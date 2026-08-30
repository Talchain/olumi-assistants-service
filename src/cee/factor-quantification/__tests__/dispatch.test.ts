/**
 * Executing vertical integration, with deterministic model output and IN-MEMORY
 * storage. This is not a live LLM, durable database, or mounted UI witness.
 * Only the draft producer is replaced by the existing records replay seam;
 * selection, model-call wrapper, parser, adoption, dispatcher and commit execute.
 * The replay seam's documented repair/LLM exclusions still apply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ChatArgs, CallOpts } from '../../../adapters/llm/types.js';
import type { SessionStore, SessionTurnWrite } from '../../../orchestrator-v5/session/store.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

const h = vi.hoisted(() => ({
  draft: vi.fn(), chat: vi.fn(), resolve: vi.fn(), store: undefined as SessionStore | undefined,
}));
vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({ handleDraftGraph: h.draft }));
vi.mock('../../../adapters/llm/router.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../adapters/llm/router.js')>(),
  getAdapterWithResolution: h.resolve,
}));
vi.mock('../../../orchestrator-v5/session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../orchestrator-v5/session/index.js')>(),
  getSessionStore: () => {
    if (!h.store) throw new Error('In-memory test store must be installed');
    return h.store;
  },
}));
// This post-commit sidecar can access another store/model. It is outside the
// asserted graph commit, and must not touch a remote service from this test.
vi.mock('../../../orchestrator-v5/rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: vi.fn(async () => undefined),
}));
vi.mock('../../../utils/telemetry.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/telemetry.js')>(), emit: vi.fn(),
}));

import { _resetConfigCache } from '../../../config/index.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { dispatchDraftGraph } from '../../../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { createNoopSessionStore } from '../../../orchestrator-v5/session/__tests__/fixtures.js';
import { emit } from '../../../utils/telemetry.js';
import { replayRecordSet } from '../../draft/records/replay.js';
import type { DraftRecordSet } from '../../draft/records/grammar.js';
import { projectGraphAndOptionsToV3 } from '../../transforms/schema-v3.js';
import { FACTOR_ESTIMATES_JSON_SCHEMA } from '../estimate-response.js';
import { FACTOR_QUANTIFICATION_PROMPT_VERSION, FACTOR_QUANTIFICATION_SYSTEM_PROMPT } from '../prompt.js';
import { diagnostic, insufficientInformation, liveRecordsFigureRichControl, liveRecordsPlanningDayControl } from './fixtures/corpus.js';

const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const turnId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'factor-quantification-records-dispatch';
const model = 'claude-sonnet-5';
const rationale = 'The historical daily available-agent mean 15 divided by the fixed scheduled count 20 gives .75. For a randomly selected planning day, reuse the logged daily spread .05 under the explicitly supplied same-process assumption; this is daily variation, not uncertainty in the mean. This is an Olumi inference from supplied context, not independently verified evidence.';
type ReplayFixture = { brief: string; records: DraftRecordSet; missing_label?: string };
let fixture: ReplayFixture;
let replayed: GraphV3T;
let writes: SessionTurnWrite[];
let events: string[];
let persisted: { graph: unknown | null; briefText: string | null };

const node = (graph: GraphV3T, label: string) => {
  const match = graph.nodes.find(item => item.label === label);
  if (!match) throw new Error(`Missing replayed node ${label}`);
  return match;
};
const proposed = () => ({ factor_id: node(replayed, fixture.missing_label!).id,
  estimate_type: 'estimated', value: 0.75, std: 0.05, reasoning: rationale, basis: ['brief'] });
function modelReply(estimates: unknown[]) {
  events.push('estimator');
  return { content: JSON.stringify({ estimates }), model, latencyMs: 17,
    usage: { input_tokens: 210, output_tokens: 85 } };
}
async function run() {
  return dispatchDraftGraph({
    payload: { kind: 'message', scenario_id: scenarioId, turn_id: turnId, stage: 'frame',
      message: fixture.brief, turn_class: 'frame', source: 'composer' },
    requestId, request: {} as FastifyRequest, requestStartMs: Date.now(),
  });
}
async function reload() {
  const loaded = await h.store!.loadGraphAndBriefText(scenarioId);
  expect(loaded.briefText).toBe(fixture.brief);
  return GraphV3.parse(loaded.graph);
}
function metrics(): Record<string, unknown> {
  const entry = vi.mocked(emit).mock.calls.find(([name]) => name === 'cee.factor_quantification');
  expect(entry, 'factor stage telemetry must have executed').toBeDefined();
  return entry![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_FACTOR_QUANTIFICATION_ENABLED', 'true');
  vi.stubEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'false');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'false');
  vi.stubEnv('CEE_ANTHROPIC_STRUCTURED_OUTPUTS', 'true');
  _resetConfigCache();
  fixture = liveRecordsPlanningDayControl;
  writes = []; events = []; persisted = { graph: null, briefText: null };
  h.store = {
    ...createNoopSessionStore(),
    async append(write) {
      events.push('commit_append');
      writes.push(structuredClone(write));
      persisted = { graph: structuredClone(write.graph ?? null), briefText: write.briefText ?? null };
      return { id: 'in-memory-turn-row' };
    },
    async loadGraphAndBriefText() { return structuredClone(persisted); },
    async loadGraph() { return structuredClone(persisted.graph); },
  };
  h.draft.mockImplementation(async (brief: string) => {
    expect(brief).toBe(fixture.brief);
    const replay = await replayRecordSet(fixture.records, { brief });
    if (!replay.ok) throw new Error(`Records replay failed: ${replay.reason}`);
    // This is the live terminal projection: it calls transformGraphToV3 and
    // then stamps canonical interventions from the records producer's data.
    // Calling transformGraphToV3 alone loses do() values and invents gaps.
    replayed = GraphV3.parse(projectGraphAndOptionsToV3(
      replay.graph as Parameters<typeof projectGraphAndOptionsToV3>[0], { brief },
    ).graph);
    events.push('records_replayed');
    return { blocks: [], assistantText: null, latencyMs: 1, strengthenItems: [],
      coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: replayed } satisfies DraftGraphResult;
  });
  h.resolve.mockReturnValue({ adapter: { chat: h.chat }, resolution: {
    task: 'factor_quantification', provider: 'anthropic', resolved_model: model, resolution_source: 'task_default',
  } });
  h.chat.mockImplementation(async () => modelReply([proposed()]));
});
afterEach(() => { h.store = undefined; vi.unstubAllEnvs(); _resetConfigCache(); });

describe('records replay → real dispatch/model wrapper → real commit → in-memory reload', () => {
  it('commits the supported missing point with uncertainty while preserving the stated value', async () => {
    const result = await run();
    expect(result.commitPerformed).toBe(true);
    expect(events).toEqual(['records_replayed', 'estimator', 'commit_append']);
    expect(writes).toHaveLength(1);
    expect(h.resolve).toHaveBeenCalledExactlyOnceWith('factor_quantification');
    expect(h.chat).toHaveBeenCalledTimes(1);
    const [args, opts] = h.chat.mock.calls[0] as [ChatArgs, CallOpts];
    expect(args.system).toBe(FACTOR_QUANTIFICATION_SYSTEM_PROMPT);
    expect(args.outputSchema).toBe(FACTOR_ESTIMATES_JSON_SCHEMA);
    expect(args.temperature).toBe(0);
    expect(args.userMessage).toContain(fixture.brief);
    expect(opts).toMatchObject({ requestId });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    const graph = await reload();
    const statedBefore = node(replayed, liveRecordsFigureRichControl.protected_label);
    expect(statedBefore.observed_state).toMatchObject({ value: 0.12, source: 'brief_extraction' });
    expect(node(graph, statedBefore.label).observed_state).toEqual(statedBefore.observed_state);
    const expected = { value: 0.75, std: 0.05, source: 'cee_inference', extractionType: 'inferred', reasoning: { rationale, context_basis: ['brief'] } };
    expect(node(graph, fixture.missing_label!).observed_state).toEqual(expected);
    expect(node(GraphV3.parse(result.response.draft_graph), fixture.missing_label!).observed_state).toEqual(expected);
    expect(writes[0]?.llm_calls_used).toBe(2); // dispatcher draft minimum + actual estimator wrapper call
    expect(metrics()).toMatchObject({ gaps_entering: 1, estimated: 1, explicit_unknown: 0,
      fallback: 0, protected_values_changed: 0, strict_evaluation_pass: true,
      call: { call_made: true, model, resolved_model: model, input_tokens: 210, output_tokens: 85,
        prompt_version: FACTOR_QUANTIFICATION_PROMPT_VERSION, structured_output_requested: true,
        structured_output_enforced: null, provider_latency_ms: 17, cost_usd: null } });
  });

  it('keeps an unestimable campaign rate numeric-free through the same commit and reload', async () => {
    fixture = { ...insufficientInformation, missing_label: 'Campaign conversion rate' };
    const reason = 'No campaign history, audience definition or conversion observations are supplied; the ratio scale alone does not support a rate or uncertainty.';
    h.chat.mockImplementation(async () => modelReply([{ factor_id: node(replayed, fixture.missing_label!).id,
      estimate_type: 'unknown', reasoning: reason, basis: ['brief'] }]));
    const result = await run();
    expect(result.commitPerformed).toBe(true);
    const unresolved = node(await reload(), fixture.missing_label!);
    expect(unresolved.observed_state).toBeUndefined();
    expect(unresolved.prior).toEqual({ prior_is_unquantified: true, source: 'cee_inference',
      reasoning: { rationale: reason, context_basis: ['brief'] } });
    expect(metrics()).toMatchObject({ gaps_entering: 1, estimated: 0, model_unknown: 1, explicit_unknown: 1, fallback: 0 });
    expect(result.analysisReady?.readiness_issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FACTOR_QUANTITY_UNKNOWN', factor_id: unresolved.id }),
    ]));
  });

  it('rejects a model attempt to overwrite the stated value and does not claim its malformed batch succeeded', async () => {
    h.chat.mockImplementation(async () => modelReply([proposed(), { ...proposed(),
      factor_id: node(replayed, liveRecordsFigureRichControl.protected_label).id, value: 0.99 }]));
    expect((await run()).commitPerformed).toBe(true);
    const graph = await reload();
    expect(node(graph, liveRecordsFigureRichControl.protected_label).observed_state)
      .toEqual(node(replayed, liveRecordsFigureRichControl.protected_label).observed_state);
    expect(node(graph, fixture.missing_label!).observed_state).toBeUndefined();
    expect(metrics()).toMatchObject({ outcome: 'parse_failed', estimated: 0, operational_unresolved: 1,
      protected_values_changed: 0, strict_evaluation_pass: false });
  });

  it.each(['missing_output', 'missing_uncertainty'] as const)('%s fails the positive quantitative predicate and remains operationally unresolved', async control => {
    h.chat.mockImplementation(async () => {
      const item = proposed();
      if (control === 'missing_output') return modelReply([]);
      const { std: _std, ...broken } = item;
      return modelReply([broken]);
    });
    expect((await run()).commitPerformed).toBe(true);
    const unresolved = node(await reload(), fixture.missing_label!);
    expect(unresolved.observed_state).toBeUndefined();
    expect(unresolved.prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
    expect(metrics()).toMatchObject({ estimated: 0, model_unknown: 0, operational_unresolved: 1,
      fallback: 0, strict_evaluation_pass: false });
  });

  it('does not invent comparison options or call an estimator for an open diagnostic model', async () => {
    fixture = diagnostic;
    expect((await run()).commitPerformed).toBe(true);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.chat).not.toHaveBeenCalled();
    expect((await reload()).nodes.some(item => item.kind === 'option')).toBe(false);
    expect(metrics()).toMatchObject({ gaps_entering: 0, estimated: 0, fallback: 0 });
  });

  it('does not call the estimator when the actual records draft supplies the only relevant factor', async () => {
    const recordSet = liveRecordsFigureRichControl.records;
    fixture = { ...liveRecordsFigureRichControl,
      records: { stated_items: recordSet.stated_items,
        claims: [recordSet.claims[1]!, recordSet.claims[2]!, recordSet.claims[3]!] } };
    expect((await run()).commitPerformed).toBe(true);
    expect(h.chat).not.toHaveBeenCalled();
    expect(node(await reload(), liveRecordsFigureRichControl.protected_label).observed_state)
      .toEqual(node(replayed, liveRecordsFigureRichControl.protected_label).observed_state);
    expect(metrics()).toMatchObject({ gaps_entering: 0, estimated: 0, protected_values_changed: 0 });
  });

  it('keeps the existing path untouched when activation is off', async () => {
    vi.stubEnv('CEE_FACTOR_QUANTIFICATION_ENABLED', 'false'); _resetConfigCache();
    expect((await run()).commitPerformed).toBe(true);
    expect(h.chat).not.toHaveBeenCalled();
    expect(node(await reload(), fixture.missing_label!).observed_state)
      .toEqual(node(replayed, fixture.missing_label!).observed_state);
    expect(vi.mocked(emit).mock.calls.some(([name]) => name === 'cee.factor_quantification')).toBe(false);
  });
});

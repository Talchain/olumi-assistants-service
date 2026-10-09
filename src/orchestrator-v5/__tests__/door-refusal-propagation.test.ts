/** Real executor/HTTP/SSE paths; only the provider and persistence ports are doubles. */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimingTurnFenceStore } from '../../../tests/utils/claiming-turn-fence-store.js';
import type { SessionStore } from '../session/store.js';
import { createMockSessionStore } from '../../../tests/utils/mock-session-store.js';
import { installOwnershipHarness, verifyFixtureIdentity } from '../../../tests/utils/ownership-route-harness.js';
import { ceeOrchestratorRouteV2 } from '../../orchestrator/route-v2.js';
import streamRoute from '../../routes/orchestrate.v2.turn-stream.js';

const state = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../session/index.js', async load => ({
  ...await load<typeof import('../session/index.js')>(), getSessionStore: () => state.store!,
}));
vi.mock('../../utils/supabase-user-jwt.js', async load => ({
  ...await load<typeof import('../../utils/supabase-user-jwt.js')>(),
  verifySupabaseUserJwt: (token: string) => verifyFixtureIdentity(token),
}));
vi.mock('../../adapters/llm/router.js', async load => {
  const actual = await load<typeof import('../../adapters/llm/router.js')>();
  const adapter = { name: 'ownership-wire', chat: vi.fn(), chatWithTools: vi.fn(async () => ({
    content: [{ type: 'text', text: 'Consider the assumptions together.' }],
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'ownership-wire', latencyMs: 0,
  })) };
  return { ...actual, getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { resolved_model: adapter.name, resolution_source: 'task_default' } }) };
});
vi.mock('../../adapters/llm/prompt-loader.js', async load => ({
  ...await load<typeof import('../../adapters/llm/prompt-loader.js')>(), getSystemPrompt: async () => 'fixture',
}));
vi.mock('../../config/index.js', async load => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false, assistApiKey: 'ownership-wire-fixture-key' },
    proxy: { ...actual.config.proxy, proxyV5Target: 'orchestrator', browserProxyEnabled: true,
      agentLaneEnabled: true, agentLanePreview: false, browserProxyAllowedOrigins: 'https://staging--olumi.netlify.app' },
  } };
});

import { readFileSync } from 'node:fs';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { ANALYSIS_REREAD_TIMEOUT_MS } from '../session/analysis-read-deadline.js';
import { agentV1TurnRoute } from '../../routes/agent-v1-turn.js';
import graphRoute from '../../routes/assist.v1.scenario-graph.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeProposalId, type StructuredProposal } from '../agent-lane/proposal.js';
import { proposalPendingAction } from '../agent-lane/durable-proposal.js';
import { approvalChipIdFor } from '../agent-lane/approval-chips.js';
import * as adoption from '../system-events/olumi-option-adoption.js';
import { assertDoorOwnership, bindWriteCaller, readWriteRefusal, readSuccessfulDoorEntries } from '../ownership/door-ownership.js';
import { runFencedInProcessWrite } from '../../orchestrator/turn-fence-prehandler.js';
import { runWithTurnFence } from '../session/turn-fence.js';
import { authorisationTurnId } from '../agent-lane/runtime/agent-capabilities.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../config/timeouts.js';
import { markDraftGraphWriteFailed } from '../build-turn-context.js';
import { log } from '../../utils/telemetry.js';
const provider = vi.hoisted(() => ({ draft: vi.fn() }));
vi.mock('../../orchestrator/tools/draft-graph.js', async load => ({
  ...await load<typeof import('../../orchestrator/tools/draft-graph.js')>(), handleDraftGraph: provider.draft,
}));
vi.mock('../../orchestrator/plot-client.js', async load => ({
  ...await load<typeof import('../../orchestrator/plot-client.js')>(), createPLoTClient: () => ({
    run: async () => JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')),
    validatePatch: async () => ({}),
  }),
}));
const SID = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const TID = 'b1111111-1111-4111-8111-111111111111';
const OWNER = 'u-owner';
const GRAPH = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Which strategy?' },
    { id: 'goal', kind: 'goal', label: 'Growth', goal_threshold: 0.1 },
    { id: 'factor', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5 } },
    { id: 'opt1', kind: 'option', label: 'Pilot', interventions: { factor: 0.7 } },
    { id: 'opt2', kind: 'option', label: 'Stay', interventions: { factor: 0.5 } },
    { id: 'suggested', kind: 'option', label: 'Expand', proposed_by: 'olumi', interventions: { factor: 0.8 } },
  ],
  edges: [['decision', 'opt1'], ['decision', 'opt2'], ['decision', 'suggested'], ['opt1', 'factor'],
    ['opt2', 'factor'], ['suggested', 'factor'], ['factor', 'goal']].map(([from, to]) =>
    ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
};
// Independent literals pin the DL-approved wire copy, rather than deriving expectations from production.
const BYTES = {
  not_owner: JSON.stringify({ error: 'model_write_ownership_refused', message: "Nothing was saved. You don't have access to change this model." }),
  owner_unreadable: JSON.stringify({ error: 'model_write_ownership_refused', message: "Nothing was saved. I couldn't check access to this model. Try again." }),
};
function payload(family: string) {
  if (family === 'system_event' || family === 'sse') return { kind: 'system_event', scenario_id: SID, turn_id: TID,
    stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'factor', value: 0.65 } };
  if (family === 'agent') return { scenario_id: SID, turn_id: TID, message: 'Consider the strategic framing.' };
  if (family === 'adoption') return { scenario_id: SID, message: 'Yes, include that suggestion.',
    source: 'chip', chip: { id: adoptionChip().id } };
  return { kind: 'message', scenario_id: SID, turn_id: TID, stage: family === 'draft' ? 'frame' : 'analyse',
    message: family === 'draft' ? 'We need to grow revenue by 20% this year. Should we launch a pilot or keep the current service? Our capacity is limited and we have a budget of £100000.' : 'Run the analysis.',
    turn_class: family === 'draft' ? 'frame' : 'decide', source: family === 'draft' ? 'composer' : 'chip_click',
    ...(family === 'chip' ? { chip: { action_type: 'run_analysis' } } : {}) };
}
function adoptionProposal(): StructuredProposal {
  const base = { scenario_id: SID, user_id: OWNER, base_graph_identity_hash: computeExpectedGraphCasHashes(GRAPH).expectedGraphAnalysisHash!,
    operations: [{ op: 'adopt_olumi_option' as const, path: 'suggested', value: { label: 'Expand', expected_interventions: { factor: 0.8 }, approval_message: 'Yes, include that suggestion.' } }],
    provenance: { authored_by: 'user_stated' as const }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Include Expand' };
  return { ...base, proposal_id: computeProposalId(base) };
}
function adoptionChip() { return { id: approvalChipIdFor(adoptionProposal().proposal_id), label: 'Include this suggestion', message: 'Yes, include that suggestion.' }; }
async function harness(family: string, afterCommit = false, hanging = false, options: {
  mark?: NonNullable<SessionStore['markGraphWriteFailed']>; configure?: (app: FastifyInstance) => void;
} = {}) {
  const append = vi.fn(async () => ({ id: 'row' }));
  const appendIfLatest = vi.fn(async () => ({ id: 'row' }));
  let release!: (owner: string | null) => void;
  const getScenarioOwner = vi.fn(async () => {
    if (afterCommit && getScenarioOwner.mock.calls.length === 1) return OWNER;
    if (hanging) return new Promise<string | null>(resolve => { release = resolve; });
    return 'u-other';
  });
  const fence = claimingTurnFenceStore();
  const markGraphWriteFailed = vi.fn(options.mark ?? fence.store.markGraphWriteFailed.bind(fence.store));
  const graph = family === 'draft' ? null : GRAPH;
  state.store = createMockSessionStore({ append, appendIfLatest, getScenarioOwner,
    claimTurnFence: fence.store.claimTurnFence.bind(fence.store), markGraphWriteFailed,
    hasOtherAdmittedLiveTurn: fence.store.hasOtherAdmittedLiveTurn.bind(fence.store),
    readExistingScenario: async () => ({ userId: OWNER, graph, briefText: null, analysisInvalidatedAt: null }),
    loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: null }),
    ...(family === 'adoption' ? { readMostRecentPendingActions: async () => [proposalPendingAction(adoptionProposal(), adoptionChip(), { scenario_id: SID, emitted_at_iso: new Date().toISOString() })] } : {}),
  });
  const app = Fastify();
  await installOwnershipHarness(app, () => ({ mode: 'verified', userId: OWNER }));
  if (afterCommit) app.addHook('preHandler', async () => {
    await appendCheckedGraphWrite({ store: state.store!, writesGraph: false, source: 'first_success', write: {
      scenario_id: SID, turn_id: 'first-success', turn_class: 'direct_answer', handler_id: null,
      request_hash: 'first', response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [],
    } });
  });
  await ceeOrchestratorRouteV2(app); await streamRoute(app); await agentV1TurnRoute(app); await graphRoute(app);
  options.configure?.(app);
  await app.ready();
  return { app, append, appendIfLatest, getScenarioOwner, fence, markGraphWriteFailed, release: () => release?.(OWNER) };
}
beforeEach(() => {
  vi.clearAllMocks();
  provider.draft.mockResolvedValue({ blocks: [], assistantText: 'A shared model.', latencyMs: 0, strengthenItems: [],
    coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null, draftWarnings: [], graphOutput: GRAPH });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider the assumptions together.' }] }] }), { status: 200 })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); state.store = undefined; });
function inject(h: Awaited<ReturnType<typeof harness>>, family: string) {
  return h.app.inject({ method: 'POST', url: family === 'sse' ? '/orchestrate/v2/turn/stream'
    : family === 'agent' || family === 'adoption' ? '/agent/v1/turn' : '/orchestrate/v2/turn', headers: { 'x-request-id': 'prop-request' }, payload: payload(family) });
}
it.each(['system_event', 'chip', 'draft', 'adoption', 'agent', 'sse'])('refusal propagation: %s', async family => {
  const adoptionDoor = vi.spyOn(adoption, 'commitOlumiOptionAdoptionInProcess');
  const h = await harness(family);
  try {
    const r = await inject(h, family);
    process.stdout.write(`PROP_BYTES ${family} ${r.statusCode} ${JSON.stringify(r.payload)}\n`);
    if (family === 'adoption') {
      process.stdout.write(`PROP_ADOPTION_CALLS ${adoptionDoor.mock.calls.length} ${JSON.stringify(await adoptionDoor.mock.results[0]?.value)}\n`);
      expect(adoptionDoor).toHaveBeenCalledOnce();
      await expect(adoptionDoor.mock.results[0]!.value).resolves.toEqual({ status: 'unconfirmed' });
    }
    let bytes = r.payload;
    if (family === 'sse') {
      expect(r.statusCode).toBe(200);
      const frames = r.payload.split('\n\n').filter(f => f.startsWith('event: stage\n')).map(f => JSON.parse(f.split('\ndata: ')[1]!));
      const terminal = frames.filter(f => f.stage === 'COMPLETE');
      expect(terminal).toHaveLength(1); expect(terminal[0].status_code).toBe(403);
      bytes = JSON.stringify(terminal[0].payload);
    } else expect(r.statusCode, r.payload).toBe(403);
    expect(bytes).toBe(BYTES.not_owner);
    // The approved literal itself says "saved". Forbid success claims and flattened outcomes, not that refusal sentence.
    expect(bytes.replace('Nothing was saved.', '')).not.toMatch(/saved|revision|unconfirmed/i);
    expect(h.append).not.toHaveBeenCalled(); expect(h.appendIfLatest).not.toHaveBeenCalled();
    expect(h.getScenarioOwner).toHaveBeenCalled();
    if (family !== 'agent') {
      expect(h.fence.rows[0]).toMatchObject({ scenario_id: SID,
        turn_id: family === 'adoption' ? authorisationTurnId(adoptionProposal().proposal_id) : TID, graph_write_failed_at: expect.any(String), graph_loss_disclosable_at: null,
        graph_write_failure_reason: 'model_write_ownership_refused' });
      await expect(state.store!.hasOtherAdmittedLiveTurn!(SID, 'another')).resolves.toBe(false);
    }
  } finally { await h.app.close(); }
}, 30_000);
it('after-commit exception keeps the existing catch bytes and logs the event', async () => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness('system_event', true);
  try {
    const r = await inject(h, 'system_event');
    process.stdout.write(`PROP_AFTER_COMMIT ${r.statusCode} ${JSON.stringify(r.payload)}\n`);
    expect(r.statusCode).toBe(500);
    expect(r.payload).toBe(JSON.stringify({ error: 'INTERNAL_ERROR', boundary: 'B1', direction: 'egress', validator: 'turn_commit',
      details: { retryable: true, reason: 'system_event_commit_failed', event_kind: 'factor_value_edit', stage: 'analyse' },
      request_id: 'prop-request', retryable: true }));
    expect(h.append).toHaveBeenCalledOnce(); expect(h.appendIfLatest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
    expect(h.markGraphWriteFailed).not.toHaveBeenCalled();
  } finally { await h.app.close(); }
});
it('never-settling owner read refuses at the session-read deadline and ignores a late owner', async () => {
  const h = await harness('system_event', false, true);
  try {
    vi.useFakeTimers();
    const pending = inject(h, 'system_event');
    // Start inject before advancing its deadline; socket-free Fastify setup uses real nextTick.
    let response: Awaited<typeof pending> | undefined;
    const started = pending.then(r => { response = r; return r; });
    await vi.waitFor(() => expect(h.getScenarioOwner).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    await vi.waitFor(() => expect(response, 'owner read deadline did not settle').toBeDefined(), { timeout: 1_000 });
    const r = await started;
    process.stdout.write(`PROP_DEADLINE ${r.statusCode} ${JSON.stringify(r.payload)}\n`);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES.owner_unreadable);
    h.release(); await vi.advanceTimersByTimeAsync(1);
    expect(h.append).not.toHaveBeenCalled(); expect(h.appendIfLatest).not.toHaveBeenCalled();
  } finally { h.release(); vi.useRealTimers(); await h.app.close(); }
}, 10_000);

const MARK_BUDGET = Math.min(ANALYSIS_REREAD_TIMEOUT_MS, TURN_RESPONSE_HEADROOM_MS);
const DECOY_SID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DECOY_TID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
it('P1 composition: unnamed nested-inject success protects the composing response from a later refusal', async () => {
  const warn = vi.spyOn(log, 'warn');
  let countAfterInner = -1;
  const h = await harness('system_event', false, false, { configure: app => {
    app.post('/composition-probe', { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, async (_req, reply) => {
      const inner = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload('system_event') });
      expect(inner.statusCode, inner.payload).toBe(200);
      countAfterInner = readSuccessfulDoorEntries();
      const hashes = computeExpectedGraphCasHashes(GRAPH);
      const outcome = await runFencedInProcessWrite(SID, 'composition-adoption', () => adoption.commitOlumiOptionAdoptionInProcess({
        scenario_id: SID, turn_id: 'composition-adoption', option_id: 'suggested', expected_label: 'Expand',
        expected_interventions: { factor: 0.8 }, base_graph_hash: hashes.expectedGraphAnalysisHash!,
        expected_graph_identity_hash: hashes.expectedGraphIdentityHash!,
      }, 'composition-probe'), () => ({ status: 'stale' as const }), () => ({ status: 'stale' as const }));
      return reply.code(200).send(outcome);
    });
  } });
  h.getScenarioOwner.mockResolvedValueOnce(OWNER);
  try {
    const r = await h.app.inject({ method: 'POST', url: '/composition-probe', payload: { scenario_id: SID } });
    process.stdout.write(`R2_COMPOSITION ${r.statusCode} ${r.payload} appends=${h.append.mock.calls.length} count=${countAfterInner}\n`);
    expect(h.append).toHaveBeenCalledOnce(); expect(h.appendIfLatest).not.toHaveBeenCalled();
    expect(countAfterInner).toBe(1);
    expect(r.statusCode, r.payload).toBe(200); expect(r.payload).toBe('{"status":"unconfirmed"}');
    expect(r.payload).not.toContain('Nothing was saved');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
    expect(h.markGraphWriteFailed).not.toHaveBeenCalled();
  } finally { await h.app.close(); }
});
it('P1 ambient context: early inner admission/validation bytes ignore an outer latch; child latches stay separate', async () => {
  const earlyBody = { error: 'early_admission_refused' };
  const h = await harness('system_event', false, false, { configure: app => {
    app.post('/early-admission', { config: { scenarioId: 'none' },
      onRequest: (_req, reply) => { reply.code(401).send(earlyBody); } }, async () => { throw new Error('must not reach handler'); });
    app.post('/early-validation', { config: { scenarioId: 'none' },
      schema: { body: { type: 'object', required: ['must'] } } }, async () => { throw new Error('must not reach handler'); });
  } });
  try {
    await bindWriteCaller({ userId: OWNER, verified: true }, async () => {
      await expect(assertDoorOwnership(state.store!, SID)).rejects.toMatchObject({ reason: 'not_owner' });
      const early = await h.app.inject({ method: 'POST', url: '/early-admission', payload: {} });
      expect(early.statusCode, early.payload).toBe(401); expect(early.payload).toBe(JSON.stringify(earlyBody));
      const invalid = await h.app.inject({ method: 'POST', url: '/early-validation', payload: {} });
      expect(invalid.statusCode, invalid.payload).toBe(400);
      expect(invalid.payload).toBe(JSON.stringify({ statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message: "body must have required property 'must'" }));
      expect(readWriteRefusal()).toMatchObject({ reason: 'not_owner' });
    });
    // Reverse isolation: a child HTTP refusal never populates its parent's latch.
    await bindWriteCaller({ userId: OWNER, verified: true }, async () => {
      const child = await inject(h, 'system_event');
      expect(child.statusCode).toBe(403); expect(child.payload).toBe(BYTES.not_owner);
      expect(readWriteRefusal()).toBeUndefined(); expect(readSuccessfulDoorEntries()).toBe(0);
    });
    expect(h.append).not.toHaveBeenCalled(); expect(h.appendIfLatest).not.toHaveBeenCalled();
  } finally { await h.app.close(); }
});
it('P1 fence identity: real Agent adoption marks its captured in-process fence, never an ambient decoy', async () => {
  const h = await harness('adoption');
  try {
    const decoy = await h.fence.store.claimTurnFence(DECOY_SID, DECOY_TID);
    expect(decoy).not.toBeNull();
    const r = await runWithTurnFence(decoy!, () => inject(h, 'adoption'));
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES.not_owner);
    const adoptionTurn = authorisationTurnId(adoptionProposal().proposal_id);
    expect(h.markGraphWriteFailed).toHaveBeenCalledExactlyOnceWith(SID, adoptionTurn, 'model_write_ownership_refused', 'turn_dead_only');
    expect(h.fence.rows.find(row => row.scenario_id === SID)).toMatchObject({ turn_id: adoptionTurn,
      graph_write_failed_at: expect.any(String), graph_write_failure_reason: 'model_write_ownership_refused', graph_loss_disclosable_at: null });
    expect(h.fence.rows.find(row => row.scenario_id === DECOY_SID)).toMatchObject({ graph_write_failed_at: null, graph_loss_disclosable_at: null });
    await expect(state.store!.hasOtherAdmittedLiveTurn!(SID, 'next-admitted-turn')).resolves.toBe(false);
    expect(h.append).not.toHaveBeenCalled(); expect(h.appendIfLatest).not.toHaveBeenCalled();
  } finally { await h.app.close(); }
});
it('captured refusal never reclassifies an unrelated draft loss', async () => {
  const h = await harness('system_event');
  try {
    await bindWriteCaller({ userId: OWNER, verified: true }, async () => {
      await expect(runFencedInProcessWrite(SID, TID, () => assertDoorOwnership(state.store!, SID),
        () => undefined, () => undefined)).rejects.toMatchObject({ reason: 'not_owner' });
      await markDraftGraphWriteFailed(DECOY_SID, DECOY_TID, 'draft_graph_pipeline_threw_after_preview', 'different-request', 'draft_loss');
    });
    expect(h.markGraphWriteFailed).toHaveBeenCalledExactlyOnceWith(DECOY_SID, DECOY_TID, 'draft_graph_pipeline_threw_after_preview', 'draft_loss');
  } finally { await h.app.close(); }
});
it.each(['resolve', 'reject'] as const)('P1 mark bound: never-settling mark delivers once; late %s cannot replace again', async late => {
  let release!: () => void;
  let getReplacements = () => 0;
  const mark = vi.fn(() => new Promise<void>((resolve, reject) => {
    release = late === 'resolve' ? resolve : () => reject(new Error('late mark failure'));
  }));
  const h = await harness('system_event', false, false, { mark, configure: app => {
    app.addHook('preHandler', (_req, reply, done) => {
      const code = vi.spyOn(reply, 'code');
      getReplacements = () => code.mock.calls.filter(([status]) => status === 403).length;
      done();
    });
  } });
  let started: ReturnType<typeof inject> | undefined;
  try {
    vi.useFakeTimers();
    let response: Awaited<ReturnType<typeof inject>> | undefined;
    started = inject(h, 'system_event').then(r => { response = r; return r; });
    await vi.waitFor(() => expect(mark).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(MARK_BUDGET);
    await vi.waitFor(() => expect(response, 'best-effort mark deadline did not settle').toBeDefined(), { timeout: 1_000 });
    const r = await started;
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES.not_owner);
    expect(getReplacements()).toBe(1);
    release(); await vi.advanceTimersByTimeAsync(1);
    expect(getReplacements()).toBe(1); expect(r.payload).toBe(BYTES.not_owner);
    expect(h.append).not.toHaveBeenCalled(); expect(h.appendIfLatest).not.toHaveBeenCalled();
  } finally { release?.(); vi.useRealTimers(); await started; await h.app.close(); }
}, 15_000);

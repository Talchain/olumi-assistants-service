/** B2: the selected Run's recorded participation reaches CURRENT MODEL STATE without recomputation. */
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

// Reuse served graph/read/result bytes; only the participation carrier is arranged by these rows.
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Array<{ id: string; kind: string; label: string; [key: string]: unknown }>; edges: unknown[] };
  graph_hash: string;
  analysis_state: Record<string, unknown>;
  analysis_result: unknown;
};
const SCENARIO = '7c1f8e3b-4d5a-4f6b-8c9d-0e1f2a3b4c5d';
const CTX = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'b2-participation' };
const EXCLUDED = { option_id: 'raise_to_54', state: 'excluded_olumi_proposed' };
const LABELLED_EXCLUDED = { ...EXCLUDED, label: 'Raise to £54' };

type State = { ok: boolean; mutated: boolean; analysis: Record<string, unknown> };
function readWith(stored: unknown = [EXCLUDED]): Record<string, unknown> {
  return { ...SERVED, ...(stored === undefined ? {} : { analysis_option_participation: stored }) };
}
async function canonicalState(read: Record<string, unknown>): Promise<State> {
  const dispatch = vi.fn<InternalDispatch>(async () => ({ status: 200, json: read }));
  const result = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(CTX);
  expect(result.ok, 'control: canonical read succeeded').toBe(true);
  expect(result.mutated, 'participation is read-only').toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0]?.[0]).toBe(`/assist/v1/scenarios/${SCENARIO}/graph`);
  return result as unknown as State;
}

describe('B2 stored option participation in the Agent context', () => {
  it('P1 excluded/unapproved: exact recorded states, graph labels, and missing graph options retained by id', async () => {
    const state = await canonicalState(readWith([
      EXCLUDED,
      { option_id: 'raise_to_59', state: 'excluded_infeasible' },
      { option_id: 'removed_option', state: 'excluded_removed' },
    ]));
    expect(state.analysis.option_participation).toEqual([
      LABELLED_EXCLUDED,
      { option_id: 'raise_to_59', label: 'Raise to £59', state: 'excluded_infeasible' },
      { option_id: 'removed_option', state: 'excluded_removed' },
    ]);
  });

  it('P2 included: provisional keep and unanalysable user ids carried verbatim with labels from this read', async () => {
    const kept = { option_id: 'raise_to_54', state: 'kept_olumi_provisional',
      unanalysable_user_option_ids: ['raise_to_59', 'missing_user_option'] };
    const read = readWith([kept]);
    const before = JSON.stringify(read);
    const state = await canonicalState(read);
    expect(state.analysis.option_participation).toEqual([
      { ...kept, label: 'Raise to £54', unanalysable_user_options: [
        { option_id: 'raise_to_59', label: 'Raise to £59' },
        { option_id: 'missing_user_option' },
      ] },
    ]);
    expect(JSON.stringify(read), 'no mutation of the stored record').toBe(before);
  });

  it('P3 duplicate ids: the reader refuses the whole record; removing the duplicate carries the key', async () => {
    const read = readWith([EXCLUDED, { option_id: EXCLUDED.option_id, state: 'kept_olumi_provisional' }]);
    expect((await canonicalState(read)).analysis).not.toHaveProperty('option_participation');
    expect((await canonicalState({ ...read, analysis_option_participation: [EXCLUDED] })).analysis.option_participation)
      .toEqual([LABELLED_EXCLUDED]);
  });

  it('P4 missing: no key for absent/refused records, while a recorded empty array stays empty', async () => {
    const missing = { ...SERVED };
    for (const read of [missing, readWith(null), readWith([
      { ...EXCLUDED, unanalysable_user_option_ids: ['raise_to_59'] },
    ])]) {
      expect((await canonicalState(read)).analysis).not.toHaveProperty('option_participation');
    }
    expect((await canonicalState(readWith([]))).analysis).toHaveProperty('option_participation', []);
  });

  it('P5 stale: withheld when the selected Run is stale, absent, or its result is not delivered', async () => {
    for (const read of [
      { ...readWith(), analysis_state: { ...SERVED.analysis_state, run_state: { kind: 'complete_stale' } } },
      { ...readWith(), analysis_state: {} },
      { ...readWith(), analysis_result: undefined },
      { ...readWith(), analysis_state: { ...SERVED.analysis_state, contradictions: ['fact_status_success_but_degraded_newer'] },
        analysis_result: undefined },
    ]) {
      expect((await canonicalState(read)).analysis).not.toHaveProperty('option_participation');
    }
  });

  it('P6 cold reload: fresh capabilities instances return byte-identical entries and the same recorded state', async () => {
    const read = readWith();
    const first = await canonicalState(read);
    const reloaded = await canonicalState(structuredClone(read));
    expect(first.analysis.option_participation).toEqual([LABELLED_EXCLUDED]);
    expect(JSON.stringify(reloaded.analysis.option_participation)).toBe(JSON.stringify(first.analysis.option_participation));
  });

  it('P7 no recompute: a now-adopted option still has the Run\'s historical exclusion', async () => {
    const read = readWith();
    read.graph = { ...SERVED.graph, nodes: SERVED.graph.nodes.map((n) => n.id === EXCLUDED.option_id
      ? { ...n, proposed_by: 'olumi', analysis_participation: 'included', option_status: 'feasible' } : n) };
    const before = JSON.stringify(read);
    expect((await canonicalState(read)).analysis.option_participation).toEqual([LABELLED_EXCLUDED]);
    expect(JSON.stringify(read)).toBe(before);
  });
});

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'b2-row' })),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('B2 live in-process /agent/v1/turn with a stubbed model', () => {
  let app: FastifyInstance;
  const requests: Array<{ input: Array<{ role?: string; content?: Array<{ type: string; text?: string }> }> }> = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Here is what the Run recorded.' }] },
      ] }), { status: 200 });
    }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => readWith());
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('Route: decode the model request JSON and find the recorded participation in CURRENT MODEL STATE', async () => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: SCENARIO, message: 'What did the saved Run leave out?' } });
    expect(response.statusCode).toBe(200);
    expect(requests, 'the stubbed model actually received a request').toHaveLength(1);
    const stateItems = requests[0]!.input.filter((item) => item.role === 'developer')
      .flatMap((item) => item.content ?? []).filter((part) => part.text?.startsWith('CURRENT MODEL STATE'));
    expect(stateItems).toHaveLength(1);
    const text = stateItems[0]!.text!;
    const state = JSON.parse(text.slice(text.indexOf('{'))) as State;
    expect(state.analysis.option_participation).toEqual([LABELLED_EXCLUDED]);
    expect(response.json().option_participation, 'control: existing wire sidecar already carries the record').toEqual([EXCLUDED]);
  });
});

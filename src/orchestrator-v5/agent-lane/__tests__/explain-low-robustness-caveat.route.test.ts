/**
 * DL BUILD, HIGH — a licensed leader is not proof of a robust result. Press the real
 * bound Explain control with fixed narrator words, through the served-readback/store
 * harness from agent-run-reply-answer-shape.test.ts. No provider is contacted.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFlipClaimPosture } from '../../context/flip-threshold-rows.js';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: Record<string, unknown>; analysis_ready: {
    analysis_admission: { semantic_signals: Record<string, unknown> };
  } };
};
const SERVED_RUN = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { computed_against_hash: string; enrichment: Record<string, unknown> } & Record<string, unknown> } };
};
const RESULT = SERVED_RUN.turns.t2.analysis_result;
const GRAPH_HASH = RESULT.computed_against_hash;
const SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f';
const NARRATOR = 'Raise Pro to £59 at release leads in this model.';
/** Exact public sentences, pinned independently of the selector so base/mutants cannot redefine the oracle. */
const SENTENCE = 'The result is not yet robust — small changes could flip it.';
const NO_FLIP_SENTENCE = 'The result is not yet robust — no single factor we tested would change the order on its own, but the margin is not settled.';
const count = (text: string, sentence: string) => text.split(sentence).length - 1;
const NO_FLIP = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/cross-service/witness-2267-attested-no-flip.json', import.meta.url), 'utf8')) as {
  runs: Record<string, { flip_thresholds: unknown[] }>;
};
/** The same producer-attested rows used by headline-flip-evidence-reconciliation.test.ts. */
const FLIP_ROWS = Object.values(NO_FLIP.runs)[0]!.flip_thresholds;

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash
      ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('Explain: a licensed raw-fragile Run carries one server-owned caveat', () => {
  let app: FastifyInstance;
  let narrator = NARRATOR;
  let providerCalls = 0;
  let emptyNarration = false;
  let readbackState: Record<string, unknown>;
  let readbackReady: typeof FX.state.analysis_ready;
  let readbackResult: typeof RESULT;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ output: emptyNarration ? [] : [
        { type: 'message', content: [{ type: 'output_text', text: narrator }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: GRAPH_HASH,
      blocks: [readbackResult], analysis_ready: readbackReady, analysis_state: readbackState,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: FX.state.draft_graph, graph_hash: GRAPH_HASH, analysis_state: readbackState,
      analysis_ready: readbackReady, analysis_result: readbackResult,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    rows.clear(); narrator = NARRATOR; providerCalls = 0; emptyNarration = false;
    readbackState = { ...FX.state.analysis_state,
      run_state: { ...(FX.state.analysis_state.run_state as Record<string, unknown>), computed_at: '2026-10-01T12:00:00.000Z' },
      leader_claim: { permitted: true, separation: 'separated' } };
    readbackReady = structuredClone(FX.state.analysis_ready);
    readbackReady.analysis_admission.semantic_signals.material_parameters_awaiting_user_node_ids = [];
    readbackResult = { ...RESULT, summary: 'Synthetic current result.', leading_option_id: 'raise_pro_to_59_at_release',
      enrichment: { robustness: { level: 'low', is_robust: false } } };
  });
  type Body = { assistant_text: string; narration?: { status: string }; _answer_shape?: unknown;
    analysis_state: { leader_claim: { permitted: boolean } }; _agent: { replayed?: boolean } };
  const run = async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    expect(providerCalls).toBe(0);
    const first = r.json();
    const chip = first.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, r.body).toBeDefined();
    return { scenario_id: SCENARIO, agent_session_id: first._agent.session_id, turn_id: randomUUID(),
      message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id } };
  };
  const press = async (payload: Record<string, unknown>, replay = false) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(r.statusCode, r.body).toBe(200);
    if (!replay) expect(r.json()._diagnostic_trace.fast_path).toBe('explain');
    return r.json() as Body;
  };
  const assertCaveat = (b: Body, sentence = SENTENCE) => {
    const prefix = `${NARRATOR} ${sentence}`;
    expect(b.assistant_text.slice(0, prefix.length)).toBe(prefix);
    expect(count(b.assistant_text, sentence)).toBe(1);
    expect(count(b.assistant_text, sentence === SENTENCE ? NO_FLIP_SENTENCE : SENTENCE)).toBe(0);
  };

  it('W1: licensed + low/false + no flip rows — caveat immediately after the narrator (RED at base)', async () => {
    const b = await press(await run());
    expect(b.analysis_state.leader_claim.permitted).toBe(true);
    assertCaveat(b);
    expect(b._answer_shape).toBeUndefined();
  });
  it('W2: licensed + high/true — neither caveat', async () => {
    readbackResult.enrichment.robustness = { level: 'high', is_robust: true };
    const b = await press(await run());
    expect(b.assistant_text.slice(0, NARRATOR.length)).toBe(NARRATOR);
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
  it('W3: withheld + low/false — neither caveat', async () => {
    readbackState.leader_claim = { permitted: false, separation: 'separated', withheld_reason: 'constraint_verdict_withheld' };
    const b = await press(await run());
    expect(b.analysis_state.leader_claim.permitted).toBe(false);
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
  it('W4: exact Explain retry and chipless retry return the same caveat once', async () => {
    const payload = await run();
    const once = await press(payload);
    assertCaveat(once);
    expect(rows.get(payload.turn_id)?.assistant_message).toBe(once.assistant_text);
    const exact = await press(payload, true);
    const { chip: _chip, ...chipless } = payload;
    const retry = await press({ ...chipless, source: 'retry' }, true);
    for (const b of [exact, retry]) {
      expect(b._agent.replayed).toBe(true);
      expect(b.assistant_text).toBe(once.assistant_text);
      assertCaveat(b);
    }
    expect(providerCalls).toBe(1);
  });
  it('W5: the narrator already ends with the exact sentence — no duplicate', async () => {
    narrator = `${NARRATOR} ${SENTENCE}`;
    assertCaveat(await press(await run()));
  });
  it('W6: positive no-flip attestation — the no-flip variant once, ordinary variant zero', async () => {
    readbackResult.enrichment.flip_thresholds = FLIP_ROWS;
    expect(readFlipClaimPosture(readbackResult.enrichment)).toBe('attested_no_flip');
    assertCaveat(await press(await run()), NO_FLIP_SENTENCE);
  });
  it('unavailable narration of a licensed fragile Run carries no caveat', async () => {
    emptyNarration = true;
    const b = await press(await run());
    expect(b.narration?.status).toBe('unavailable');
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
});

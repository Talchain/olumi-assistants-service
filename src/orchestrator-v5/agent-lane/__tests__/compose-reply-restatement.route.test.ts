/** Existing target-not-testable-beside-ranges.route harness: real route, fixed narrator, in-memory readback/store. */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { composeReplyShape, sentenceMultiset } from '../reply/compose-reply.js';
import { goalFigureCoHoldOf } from '../withheld-leader-fail-closed.js';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: { nodes: { id: string; label: string }[] }; analysis_state: Record<string, unknown>; analysis_ready: { analysis_admission: { semantic_signals: Record<string, unknown> } } };
};
const graph = structuredClone(FX.state.draft_graph);
graph.nodes.find(n => n.id === 'pro_plan_price')!.label = 'Support cost';
graph.nodes.find(n => n.id === 'mrr_per_pro_subscriber')!.label = 'MRR lost to support strain';
const links = [{ from: 'pro_plan_price', to: 'mrr_per_pro_subscriber' }];
const warning = { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', severity: 'warning', links, node_ids: links.flatMap(l => [l.from, l.to]),
  withheld_claims: ['win_share', 'goal_probability'], message: 'A link on the goal path is unsized.' };
const result = { type: 'analysis_result', computed_against_hash: 'restatement-h0', enrichment: { inference_warnings: [warning] } };
const state = { ...FX.state.analysis_state, run_state: { kind: 'complete_current', computed_at: '2026-10-07T12:00:00.000Z' },
  leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized', separation: 'unavailable' } };
let currentState = state;
const ready = structuredClone(FX.state.analysis_ready);
ready.analysis_admission.semantic_signals.material_parameters_awaiting_user_node_ids = [];
const closing = goalFigureCoHoldOf([result], graph)!.say!;
const narrator = 'The link from Support cost to MRR lost to support strain has no size yet.';
const prose = `${narrator} The model records an unresolved assumption.\n\nKeep the assumption visible while collecting evidence about its size. The figures describe the model as recorded and retain the assumptions for the team to challenge.`;
// Existing gate harness trigger: the unlawful ranking is removed upstream; the ordinary narrator words survive.
const ranking = 'Keep Pro at £49 produces the highest MRR outcome in this model.';
let modelReply = `${ranking} ${prose}`;
const SCENARIO = '1d2c3b4a-0000-4000-8000-000000000001';
const saved: string[] = [];
const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    if (w.assistantMessage !== undefined) saved.push(w.assistantMessage);
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash
      ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `restatement-row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('D-03 through the real Agent route on a placeholder-path Run', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelReply }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph, graph_hash: 'restatement-h0', analysis_result: result, analysis_state: currentState, analysis_ready: ready }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { currentState = state; rows.clear(); saved.length = 0; modelReply = `${ranking} ${prose}`; });

  it('the recorded warning links supply subjects; words and legacy graph links never supply subjects', () => {
    expect(goalFigureCoHoldOf([result], graph)).toMatchObject({ say: closing, subjects: ['pro_plan_price→mrr_per_pro_subscriber'] });
    const { links: _links, ...legacy } = warning;
    expect(goalFigureCoHoldOf([{ ...result, enrichment: { inference_warnings: [legacy] } }], graph)?.subjects ?? []).toEqual([]);
    const typedLink = { ...links[0]!, from_label: 'Support cost', to_label: 'MRR lost to support strain' };
    const persisted = { ...result, enrichment: { ...result.enrichment, __cee_unsized_path_leader_cause: typedLink } };
    expect(goalFigureCoHoldOf([persisted], graph)?.subjects).toEqual(['pro_plan_price→mrr_per_pro_subscriber']);
    const persistedPath = { ...persisted, enrichment: { ...persisted.enrichment,
      __cee_unsized_path_leader_cause: { ...typedLink, links: [typedLink, { from: 'mrr_per_pro_subscriber', to: 'mrr', from_label: 'MRR lost to support strain', to_label: 'MRR' }] } } };
    expect(goalFigureCoHoldOf([persistedPath], graph)?.subjects).toEqual(['pro_plan_price→mrr_per_pro_subscriber', 'mrr_per_pro_subscriber→mrr']);
  });

  it('CONTROL: a different typed claim cause gives the closing no unsized-link subjects', async () => {
    currentState = { ...state, leader_claim: { ...state.leader_claim, withheld_reason: 'constraint_verdict_withheld' } };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: 'What assumption remains unresolved?',
    } });
    expect(response.statusCode, response.body).toBe(200);
    const b = response.json() as { assistant_text: string; _answer_shape?: AnswerShape };
    const face = b._answer_shape === undefined ? b.assistant_text : [b._answer_shape.headline, ...b._answer_shape.bullets].join('\n');
    expect(face).toContain(narrator);
    expect(face).not.toContain(closing);
  });

  it.each(['gate appended', 'already present'] as const)('%s: the face carries the typed cause marker once; the full cause and restatement stay in detail and durable text', async (source) => {
    if (source === 'already present') modelReply = `${prose}\n\n${closing}`;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: 'What assumption remains unresolved?',
    } });
    expect(response.statusCode, response.body).toBe(200);
    const b = response.json() as { assistant_text: string; _answer_shape?: AnswerShape; blocks?: { type: string }[] };
    expect(b.assistant_text).not.toContain(ranking);
    expect(b.blocks).toContainEqual(expect.objectContaining({ type: 'analysis_result' }));
    expect(b._answer_shape, response.body).toBeDefined();
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join('\n');
    // The explicit typed placeholder warning owns this note; the marker never comes from its prose.
    const marker = "Not shown: some relationships aren't sized yet";
    expect(face).toContain(marker);
    expect(face.split(marker)).toHaveLength(2);
    expect(face).not.toContain(closing);
    expect(b._answer_shape!.detail.split(closing)).toHaveLength(2);
    expect(b.assistant_text.split(closing)).toHaveLength(2);
    expect(face).not.toContain(narrator);
    expect(b._answer_shape!.detail).toContain(narrator);
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
    expect(saved).toContain(b.assistant_text);
    for (const sentence of sentenceMultiset(prose)) expect(sentenceMultiset(b.assistant_text)).toContain(sentence);
    // The same route body without subjects remains a live positive control for narrator face eligibility.
    const untyped = composeReplyShape({ text: b.assistant_text, graph, obligations: [{ role: 'withheld_reason', text: closing }] });
    expect(untyped.measure?.restatements_to_detail).toBe(0);
  });
});

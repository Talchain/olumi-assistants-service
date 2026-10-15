import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { textAtRest } from '../decision-input-ask.js';
import { composeAnalysisStateV1 } from '../../compose/analysis-state-v1.js';
import { selectCanonicalAnalysisState } from '../../context/canonical-analysis-state.js';

// ⭐ S6 (Paul ≤¼, 15 Oct; SYSTEMS-REPLAN last section): on a reply the AI wrote, the AI decides what to ask from the user's
// words and canonical_state; the host adds no ask of its own. A host-written reply keeps every host ask.
// The actual route's composition and durable answer; the successful build result is supplied offline (two briefs).
const scripted = vi.hoisted(() => ({ text: '', ai: true, questions: [] as string[], rows: [] as Record<string, unknown>[] }));
vi.mock('../runtime/agent-loop.js', async original => ({
  ...await original<Record<string, unknown>>(),
  runAgentTurn: vi.fn(async () => ({ assistant_text: scripted.text, items: [],
    tool_calls: [{ name: 'build_model_from_brief', ok: true, mutated: true }],
    tool_results: [{ ok: true, mutated: true, ...(scripted.questions.length > 0 ? { open_questions: scripted.questions } : {}) }],
    mutated: true, hops: 1, stopped_reason: 'answered', timing: {}, ...(scripted.ai ? { reply_author: 'ai' } : {}),
  })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readRecent: vi.fn(async () => []),
  readCommittedTurn: vi.fn(async (_sid: string, tid: string) => scripted.rows.find(row => row.turn_id === tid) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (row: Record<string, unknown>) => { scripted.rows.push({ ...row, assistant_message: row.assistantMessage ?? null }); return { id: String(scripted.rows.length) }; }),
}) }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SID = '6e5c1f0a-3b51-4a43-9d1e-5b6a0c2f7e11';
const OBJECTIVE = 'What should this model help you explore?';
const QUESTIONS_LEAD = 'Questions this model does not answer yet';
const BRIEFS = {
  hiring: { goal: 'Team productivity', option: 'Hire a tech lead', question: 'When could the tech lead start?' },
  pricing: { goal: 'Monthly recurring revenue', option: 'Raise Pro price', question: 'Is the MRR target across all plans or Pro only?' },
} as const;

describe('S6: the AI decides what to ask on its own reply; the host adds no ask', () => {
  let app: FastifyInstance;
  let nodes: Record<string, unknown>[] = [];
  beforeAll(async () => {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes, edges: [] },
      graph_hash: 'h0', analysis_ready: { status: 'blocked', may_run: false },
      analysis_state: composeAnalysisStateV1({ canonical: selectCanonicalAnalysisState({ priorFacts: [],
        currentGraphHash: 'h0', currentGraph: { nodes, edges: [] }, priorFactsReadOk: true }), rawRobustness: null }),
    }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120000);
  afterAll(async () => { await app.close(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { scripted.rows = []; scripted.text = 'The model is a sketch to challenge.'; scripted.ai = true; scripted.questions = []; });
  const turn = async (brief: keyof typeof BRIEFS) => {
    const b = BRIEFS[brief];
    nodes = [{ id: 'goal', kind: 'goal', label: b.goal, provenance: 'ai_inferred', goal_threshold_raw: 100, threshold_source: 'user' },
      { id: 'opt', kind: 'option', label: b.option }];
    scripted.questions = [b.question];
    const turnId = randomUUID();
    const payload = { kind: 'message', scenario_id: SID, turn_id: turnId, message: 'Explore our next quarter.' };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body.slice(0, 1000)).toBe(200);
    const body = response.json() as { assistant_text: string; _agent?: { open_questions?: unknown } };
    const row = scripted.rows.find(r => r.turn_id === turnId)!;
    expect(row.assistantMessage, 'the stored answer is the words the user saw').toBe(body.assistant_text);
    return { text: body.assistant_text, wire: JSON.stringify(body), question: b.question };
  };

  it.each(['hiring', 'pricing'] as const)('RED (%s): an AI-written build reply that asks nothing gets no host ask, no questions line and no wire list', async (brief) => {
    const { text, wire, question } = await turn(brief);
    expect(text, 'the AI’s own words are the reply').toContain('The model is a sketch to challenge.');
    expect(text).not.toContain(QUESTIONS_LEAD);
    expect(text).not.toContain(question);
    expect(text).not.toContain(OBJECTIVE);
    expect(textAtRest(text)).not.toMatch(/\?/);
    expect(wire, 'no host questions list rides beside the AI’s reply').not.toContain(question);
  });

  it.each(['hiring', 'pricing'] as const)('CONTRAST (%s): the AI’s own ask is kept, exactly once', async (brief) => {
    scripted.text = `The model is a sketch to challenge. ${BRIEFS[brief].question}`;
    const { text, question } = await turn(brief);
    expect(text.split(question)).toHaveLength(2);
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
  });

  it.each(['hiring', 'pricing'] as const)('CONTRAST (%s): a host-written reply keeps the host’s asks (the build’s question and the objective)', async (brief) => {
    scripted.ai = false;
    const { text, wire, question } = await turn(brief);
    expect(`${text}\n${wire}`).toContain(question);
    expect(text).toContain(OBJECTIVE);
  });
});


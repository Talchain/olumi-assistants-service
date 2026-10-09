import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionInputAsk } from '../decision-input-ask.js';
import { composeReplyShape } from '../reply/compose-reply.js';
import type { AnswerShape } from '../../routing/answer-shape.js';

type Rec = Record<string, unknown>;
const script = vi.hoisted(() => ({ build: true, approval: false, calls: 0, messages: [] as string[], text: 'The shared model is ready. Which assumption matters most?' }));
vi.mock('../runtime/agent-loop.js', async original => ({
  ...await original<Record<string, unknown>>(),
  runAgentTurn: vi.fn(async (input: { message: string }) => {
    script.calls += 1; script.messages.push(input.message);
    return { assistant_text: script.text, items: [],
      tool_calls: script.build ? [{ name: 'build_model_from_brief', ok: true, mutated: true }] : [],
      tool_results: script.build ? [{ ok: true, mutated: true, current_level_left_out: { host_line: 'Which assumption matters most?' } }] : [],
      mutated: script.build, hops: 1, stopped_reason: 'answered', timing: {} };
  }),
}));
vi.mock('../approval-chips.js', async original => ({
  ...await original<Record<string, unknown>>(),
  approvalChipsFor: () => script.approval ? [{ id: 'agent-approve-proposal:prop_deadbeef', label: 'Approve', message: 'Yes, use those.', detail: 'Shall I use these estimates?' }] : [],
}));
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, tid: string) => rows.get(tid) ?? null),
  readRecent: vi.fn(async (sid: string, limit: number) => [...rows.values()].filter(r => r.scenario_id === sid).reverse().slice(0, limit)),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  append: vi.fn(async (w: Rec) => {
    rows.set(String(w.turn_id), { ...w, id: `row-${rows.size}`, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null });
    return { id: `row-${rows.size}` };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
const CONFIRM = "I've assumed the goal is ‘Annual revenue’. Is that what you want to improve?";
const DETAIL = 'I used "Annual revenue" as a provisional objective. What should this model help you explore?';
const CHIPS = [
  { id: 'agent-objective-confirm:yes', label: 'Yes', message: "Yes, that's the goal." },
  { id: 'agent-objective-confirm:change', label: 'Change it', message: 'I want to change the goal.' },
];
const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as { nodes: Rec[]; edges: Rec[] };
const goal = { ...paulGraph.nodes.find(n => n.id === 'mrr')!, id: 'goal_annual_revenue', kind: 'goal', label: 'Annual revenue', provenance: 'ai_inferred', threshold_source: 'user', goal_threshold_raw: 100 };
const inferredGraph = () => ({ ...structuredClone(paulGraph),
  nodes: paulGraph.nodes.map(n => n.id === 'mrr' ? { ...goal } : { ...n }),
  edges: paulGraph.edges.map(e => ({ ...e, to: e.to === 'mrr' ? goal.id : e.to, from: e.from === 'mrr' ? goal.id : e.from })),
});
const persistedGoal = () => graph.nodes.find(n => n.id === goal.id)!;
let graph: { nodes: Rec[]; edges: Rec[] };
let sid: string;
type Wire = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions?: Rec[]; _agent: { tool_calls: Rec[]; mutated: boolean } };
const face = (w: Wire) => w._answer_shape === undefined ? w.assistant_text : [w._answer_shape.headline, ...w._answer_shape.bullets].join('\n');

describe('Gate A: persisted goal identity, durable text and the served composer', () => {
  let app: FastifyInstance;
  let info: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    const { log } = await import('../../../utils/telemetry.js');
    info = vi.spyOn(log, 'info');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'gate-a-h0', analysis_state: { run_state: { kind: 'never_run' } } }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); info?.mockRestore(); vi.unstubAllEnvs(); });
  beforeEach(() => { rows.clear(); info.mockClear(); sid = randomUUID(); graph = inferredGraph(); script.build = true; script.approval = false; script.calls = 0; script.messages = []; script.text = 'The shared model is ready. Which assumption matters most?'; });
  async function turn(tid = randomUUID(), chip?: typeof CHIPS[number], message = 'Explore the two staffing approaches.') {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, turn_id: tid, message: chip?.message ?? message,
      ...(chip === undefined ? {} : { source: 'chip', chip }),
    } });
    expect(r.statusCode, r.body.slice(0, 500)).toBe(200);
    return r.json() as Wire;
  }
  it('SERVED SHAPE: first build ranks the exact confirm over another resting question, with detail and wire-only chips', async () => {
    const w = await turn();
    expect(w._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', mutated: true }));
    expect(face(w).split('\n').filter(s => s.includes('?'))).toEqual([CONFIRM]);
    expect(w._answer_shape?.detail).toContain(DETAIL);
    expect(face(w)).not.toContain('Which assumption matters most?');
    expect(w.suggested_actions?.filter(c => String(c.id).startsWith('agent-objective-confirm:'))).toEqual(CHIPS);
    expect(persistedGoal()).toEqual(goal);
  });
  it('PENDING APPROVAL: logs suppression, then recovers on an ordinary turn', async () => {
    script.approval = true;
    expect((await turn()).assistant_text).not.toContain(CONFIRM);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: 'cee.objective_confirm.suppressed', suppressor: 'awaiting_approval' }), expect.any(String));
    script.approval = false; script.build = false;
    expect(face(await turn())).toContain(CONFIRM);
  });
  it('CONTROL from_brief: Paul’s persisted MRR goal keeps the other face question', async () => {
    graph = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8'));
    expect(graph.nodes.find(n => n.id === 'mrr')?.provenance).toBe('from_brief');
    const w = await turn();
    expect(w.assistant_text).not.toContain('Is that what you want to improve?');
    expect(face(w)).toContain("What's today's level of MRR?");
  });
  it('Asked once: same-turn replay carries exactly one confirm and a later durable row prevents repetition', async () => {
    const tid = randomUUID(); const first = await turn(tid);
    const replay = await turn(tid);
    expect(replay.assistant_text.split(CONFIRM)).toHaveLength(2);
    expect(replay.suggested_actions?.filter(c => String(c.id).startsWith('agent-objective-confirm:'))).toEqual(CHIPS);
    expect((await turn()).assistant_text).not.toContain(CONFIRM);
    expect(store.readRecent).toHaveBeenCalledWith(sid, 100);
    expect(rows.get(tid)?.assistant_message).toBe(first.assistant_text);
  });
  it('Asked once: cold durable history containing the persisted confirm suppresses a later ordinary reply', async () => {
    rows.set('persisted-answer', { scenario_id: sid, turn_id: 'persisted-answer', assistant_message: `The shared model is ready.\n\n${CONFIRM}`, user_message: 'Earlier brief', request_hash: 'agent_turn:persisted-confirm' });
    script.build = false;
    const tid = randomUUID();
    expect((await turn(tid)).assistant_text).not.toContain(CONFIRM);
    expect(info.mock.calls.filter(([fields]: readonly unknown[]) => fields !== null && typeof fields === 'object' && 'event' in fields && fields.event === 'cee.objective_confirm.suppressed')).toEqual([]);
    info.mockClear();
    expect((await turn(tid)).assistant_text).not.toContain(CONFIRM);
    expect(info.mock.calls.filter(([fields]: readonly unknown[]) => fields !== null && typeof fields === 'object' && 'event' in fields && fields.event === 'cee.objective_confirm.suppressed')).toEqual([]);
  });
  it('LEGACY history: only the old objective sentence already counts as asked', async () => {
    rows.set('legacy-answer', { scenario_id: sid, turn_id: 'legacy-answer', assistant_message: DETAIL, user_message: 'Earlier brief', request_hash: 'agent_turn:legacy-confirm' });
    script.build = false;
    const w = await turn();
    expect(w.assistant_text).not.toContain(CONFIRM);
    expect(w.suggested_actions?.filter(c => String(c.id).startsWith('agent-objective-confirm:')) ?? []).toEqual([]);
    expect(info.mock.calls.filter(([fields]: readonly unknown[]) => fields !== null && typeof fields === 'object' && 'event' in fields && fields.event === 'cee.objective_confirm.suppressed')).toEqual([]);
  });
  it('[Yes]: ordinary agent turn with no tool/goal write and no repeat after the press', async () => {
    await turn(); script.build = false;
    const calls = script.calls; const before = structuredClone(graph);
    const yes = await turn(randomUUID(), CHIPS[0]);
    expect(script.calls).toBe(calls + 1); expect(script.messages.at(-1)).toBe(CHIPS[0]!.message); expect(yes.assistant_text).toContain(script.text); expect(yes._agent.tool_calls.every(call => call.mutated !== true)).toBe(true); expect(yes._agent.mutated).toBe(false); expect(graph).toEqual(before);
    expect(yes.assistant_text).not.toContain(CONFIRM);
    expect((await turn()).assistant_text).not.toContain(CONFIRM);
  });
  it('RENAME: user_set goal never asks the objective confirm', async () => {
    persistedGoal()!.provenance = 'user_set';
    expect((await turn()).assistant_text).not.toContain(CONFIRM);
  });
  it('[Change it]: typed ID owns the next reply’s sole face question, with no model or graph write', async () => {
    await turn(); script.build = false; const calls = script.calls;
    const w = await turn(randomUUID(), CHIPS[1]);
    expect(face(w).split('\n').filter(s => s.includes('?'))).toEqual(['What should this model help you explore?']);
    expect(script.calls).toBe(calls); expect(persistedGoal()).toEqual(goal);
  });
  it('words alone do not take the typed Change it path', async () => {
    persistedGoal()!.provenance = 'user_set'; script.build = false;
    const w = await turn(randomUUID(), undefined, CHIPS[1]!.message);
    expect(script.calls).toBe(1); expect(w.assistant_text).not.toContain('What should this model help you explore?');
  });
});

describe('Gate A reader and composer identity controls', () => {
  it('SERVED rank: the confirm outranks a later host ask; equal ranks keep the last ask', () => {
    const other = 'Which assumption matters most?';
    const text = `The shared model is ready.\n\n${CONFIRM}\n\n${other}`;
    const ranked = composeReplyShape({ text, faceContract: 'draft', obligations: [
      { role: 'ask', text: CONFIRM, rank: 100 }, { role: 'ask', text: other },
    ] });
    expect(ranked.shape?.bullets.filter(s => s.includes('?'))).toEqual([CONFIRM]);
    expect(ranked.text).toContain(other);
    expect(ranked.shape?.detail).toContain(other);
    const tied = composeReplyShape({ text, faceContract: 'draft', obligations: [
      { role: 'ask', text: CONFIRM, rank: 100 }, { role: 'ask', text: other, rank: 100 },
    ] });
    expect(tied.shape?.bullets.filter(s => s.includes('?'))).toEqual([other]);
  });

  it('LOSING ASK: ranked confirm owns the face and the unranked host question stays in detail', () => {
    const other = 'Which assumption should we check first?';
    const composed = composeReplyShape({ text: `Olumi built your pricing model.\n\n${CONFIRM}\n\n${other}`,
      faceContract: 'draft', obligations: [{ role: 'ask', text: CONFIRM, rank: 100 }, { role: 'ask', text: other }] });
    expect(composed.shape?.bullets.filter(s => s.includes('?'))).toEqual([CONFIRM]);
    expect(composed.text).toContain(other);
    expect(composed.shape?.detail).toBe(other);
  });

  it('ordinary turn recovers the objective, while target edits do not answer it', () => {
    expect(decisionInputAsk({ nodes: [goal] }, { restingText: 'Another question?', questionsToggle: false, awaitingApproval: false, builtOrRan: false })).toBe(CONFIRM);
  });
  // Captured with the composer at f6f9b7036d91afcedd0d029d9efcd496c98c8b94, before restoring the rank change.
  // Inputs are verbatim fragments/words from reply/__tests__/compose-reply.test.ts; every row reaches hostAsks.
  it.each([
  {
    "name": "Paul #3 proposal fragment",
    "input": {
      "text": "This is a time-to-value risk… The link’s strength is a placeholder, not an estimate. This adds the risk, but does not quantify either timing threshold. Shall I add it?",
      "faceContract": "draft",
      "obligations": [
        {
          "role": "ask",
          "text": "Shall I add it?"
        }
      ]
    },
    "expected": {
      "text": "This is a time-to-value risk…\n\n• Shall I add it?\n\nThe link’s strength is a placeholder, not an estimate. This adds the risk, but does not quantify either timing threshold.",
      "shape": {
        "headline": "This is a time-to-value risk…",
        "bullets": [
          "Shall I add it?"
        ],
        "detail": "The link’s strength is a placeholder, not an estimate. This adds the risk, but does not quantify either timing threshold."
      },
      "outcome": "shaped",
      "measure": {
        "words_in": 29,
        "units_in": 4,
        "bullets_in": 0,
        "questions_in": 1,
        "face_bullets": 1,
        "detail_units": 2,
        "restatements_to_detail": 0,
        "face_words": 9,
        "face_bullets_over_word_bar": 0,
        "obligations_on_face": 1,
        "face_over_cap": false,
        "face_over_word_budget": false,
        "open_questions_segment": false,
        "said_once_dropped": []
      }
    }
  },
  {
    "name": "Paul #13 overlapping-costs fragment",
    "input": {
      "text": "The £20,000 is earmarked for recruitment fees… The effect’s strength is a placeholder… This proposal does not record a budget limit. Is the £20,000 reserve included in the £200,000, or additional to it?",
      "faceContract": "run",
      "obligations": [
        {
          "role": "ask",
          "text": "Is the £20,000 reserve included in the £200,000, or additional to it?"
        }
      ]
    },
    "expected": {
      "text": "The £20,000 is earmarked for recruitment fees… The effect’s strength is a placeholder… This proposal does not record a budget limit. Is the £20,000 reserve included in the £200,000, or additional to it?",
      "shape": null,
      "outcome": "already_in_shape",
      "measure": {
        "words_in": 33,
        "units_in": 4,
        "bullets_in": 0,
        "questions_in": 1,
        "face_bullets": 1,
        "detail_units": 2,
        "restatements_to_detail": 0,
        "face_words": 19,
        "face_bullets_over_word_bar": 0,
        "obligations_on_face": 1,
        "face_over_cap": false,
        "face_over_word_budget": false,
        "open_questions_segment": false,
        "said_once_dropped": []
      }
    }
  },
  {
    "name": "existing pricing identity plus a second host ask",
    "input": {
      "text": "Olumi built your pricing model.\n\nThe model records the price and subscriber assumptions, with evidence still needed to establish how many people would stay after a price increase.\n\nOlumi reads ‘MRR’ as plan price × paying subscribers. Is that how you work it out?\n\nWhich assumption should we check first?",
      "faceContract": "draft",
      "obligations": [
        {
          "role": "ask",
          "text": "Olumi reads ‘MRR’ as plan price × paying subscribers. Is that how you work it out?"
        },
        {
          "role": "ask",
          "text": "Which assumption should we check first?"
        }
      ]
    },
    "expected": {
      "text": "Olumi built your pricing model.\n\n• Which assumption should we check first?\n\nThe model records the price and subscriber assumptions, with evidence still needed to establish how many people would stay after a price increase.\n\nOlumi reads ‘MRR’ as plan price × paying subscribers. Is that how you work it out?",
      "shape": {
        "headline": "Olumi built your pricing model.",
        "bullets": [
          "Which assumption should we check first?"
        ],
        "detail": "The model records the price and subscriber assumptions, with evidence still needed to establish how many people would stay after a price increase.\n\nOlumi reads ‘MRR’ as plan price × paying subscribers. Is that how you work it out?"
      },
      "outcome": "shaped",
      "measure": {
        "words_in": 50,
        "units_in": 5,
        "bullets_in": 0,
        "questions_in": 2,
        "face_bullets": 1,
        "detail_units": 3,
        "restatements_to_detail": 0,
        "face_words": 11,
        "face_bullets_over_word_bar": 0,
        "obligations_on_face": 1,
        "face_over_cap": false,
        "face_over_word_budget": false,
        "open_questions_segment": false,
        "said_once_dropped": []
      }
    }
  }
] satisfies readonly { name: string; input: Parameters<typeof composeReplyShape>[0]; expected: ReturnType<typeof composeReplyShape> }[])(
    'COMPOSER base byte identity: $name', ({ input, expected }) => {
      expect(input.obligations?.every(o => o.role === 'ask' && !('rank' in o))).toBe(true);
      expect(composeReplyShape(input)).toEqual(expected);
    });
});

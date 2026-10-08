/**
 * ⛔ #2233's FOLLOW-UPS (DL verdict 5868852006, "next PR"; AIQ 5868909577), on the same seam (`run-outcome.ts`):
 *   1. `analysis_snapshot_diverged` is recoverable, but it still went to the model, which could blame readiness, and its
 *      Retry was replaced by "what it still needs". A model that MOVED is its own typed outcome: CEE's words, and its Run.
 *   2. When the Agent ran the analysis ITSELF inside its loop, the outcome's chips were not offered. "Check the figures"
 *      reached the user only through the Run button.
 *   3. After "The figures don't add up … Which is right?", the break-even paragraph states one side of the conflict. It
 *      stays only as conditional arithmetic: it opens on "If MRR is …", with no lead-in that reads as an answer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { sentencesOf } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { breakEvenFor, breakEvenLine, withBreakEvenAnswer } from '../break-even.js';

const SCENARIO = '8103c8ce-1111-4222-8333-944455556666';
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const F8 = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
const MOVED_WORDS = 'Your model changed while this analysis was being prepared, so I stopped rather than mix two versions of it. Nothing was lost. Run the analysis again to use the current version.';
const RETRY_CHIP = { id: 'chip_action_retry_analysis', label: 'Retry', message: 'Run the analysis again.', action_type: 'run_analysis' };
const IDENTITY_WORDS = "The figures don't add up: Pro plan price × Pro paying subscribers gives £14,700/month, but you said MRR is £20,000/month. Which is right?";
const IDENTITY_CHIP = { id: 'chip_prompt_identity_identity_inconsistent', label: 'Check the figures', message: 'My MRR figure is right; the rest of MRR comes from elsewhere.' };
const MODEL_WORDS = 'The analysis could not run: the figures in your model conflict.';

type Mode = 'moved' | 'identity';
const RUN_TURN: Record<Mode, Record<string, unknown>> = {
  moved: { assistant_text: MOVED_WORDS, suggested_actions: [RETRY_CHIP], analysis_ready: { status: 'blocked', blocked_reason: 'analysis_snapshot_diverged' } },
  identity: { assistant_text: IDENTITY_WORDS, suggested_actions: [IDENTITY_CHIP], analysis_ready: { status: 'blocked', blocked_reason: 'analysis_blocked' } },
};

describe('⛔ #2233 follow-ups: a moved model, the Agent’s own Run, and the arithmetic after an identity ask', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let mode: Mode = 'moved';
  let loop = false;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      // The Agent's own loop: it first calls run_analysis, then answers.
      if (loop && modelCalls === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis', call_id: 'c1', arguments: JSON.stringify({ reason: 'asked' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: loop ? IDENTITY_WORDS : MODEL_WORDS }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, insights: [], graph_hash: 'h1', blocks: [], ...RUN_TURN[mode] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: JSON.parse(JSON.stringify(F8)),
      graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); });
  beforeEach(() => { modelCalls = 0; mode = 'moved'; loop = false; });

  const turn = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, ...payload } });
    expect(r.statusCode).toBe(200);
    return r.json() as { assistant_text: string; _answer_shape: AnswerShape; suggested_actions: { id: string; label: string; message: string; action_type?: string }[] };
  };
  const runButton = () => turn({ message: 'Run analysis.', source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });

  it('RED (1): a model that moved while the Run was prepared is said in CEE’s words, with its Retry, and no model call', async () => {
    const b = await runButton();
    expect(b.assistant_text.startsWith(MOVED_WORDS), b.assistant_text).toBe(true);
    expect(modelCalls).toBe(0);
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: RETRY_CHIP.id, action_type: 'run_analysis' }));
    expect(b.suggested_actions.map((a) => a.id)).not.toContain('agent-suggest-what-it-needs');
  });

  it('RED (2): the Agent’s OWN run_analysis in its loop offers the outcome’s "Check the figures"', async () => {
    mode = 'identity';
    loop = true;
    const b = await turn({ message: 'Can you run the analysis on this now?', source: 'composer' });
    expect(modelCalls, 'the loop decided to run').toBeGreaterThanOrEqual(1);
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: IDENTITY_CHIP.id, label: 'Check the figures' }));
  });

  it('RED (3, AIQ): after the identity ask on the Run button, the arithmetic opens "If MRR is …", with no lead-in', async () => {
    mode = 'identity';
    const b = await runButton();
    expect(b._answer_shape.headline).toBe(IDENTITY_WORDS.replace(' Which is right?', ''));
    expect(b._answer_shape.bullets).toEqual(['Which is right?']);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(b._answer_shape));
    for (const sentence of sentencesOf(IDENTITY_WORDS)) expect(b.assistant_text.split(sentence)).toHaveLength(2);
    expect(breakEvenFor(F8), 'precondition: this graph carries the arithmetic').not.toBeNull();
    const paras = b.assistant_text.split('\n\n');
    const arithmetic = paras.find((p) => p.startsWith('If MRR is'));
    expect(b._answer_shape.detail).toBe(breakEvenLine(breakEvenFor(F8)!, { afterIdentityAsk: true }));
    expect(arithmetic, b.assistant_text).toBeDefined();
    expect(arithmetic!.startsWith('If MRR is'), arithmetic).toBe(true);
    expect(b.assistant_text).not.toContain('The arithmetic still answers part of this');
  });

  it('CONTROL: elsewhere the arithmetic keeps its lead-in, word for word', () => {
    const be = breakEvenFor(F8)!;
    expect(breakEvenLine(be).startsWith('The arithmetic still answers part of this. If MRR is')).toBe(true);
    expect(withBreakEvenAnswer('Lead.', be)).toBe(`Lead.\n\n${breakEvenLine(be)}`);
    expect(breakEvenLine(be, { afterIdentityAsk: true })).toBe(breakEvenLine(be).replace('The arithmetic still answers part of this. ', ''));
  });
});

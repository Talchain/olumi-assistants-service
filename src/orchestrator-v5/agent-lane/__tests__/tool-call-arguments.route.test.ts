/**
 * ⭐ THE REPLY RECORDS WHAT THE AI SENT (honest scoreboard, step 0, 18 Oct 2026).
 *
 * `_agent.tool_calls` kept only name, ok and refusal, so a judge could not tell which item a correction was aimed at
 * (red-team R01 `steps/02-t2-correction.json`). Each AI call now carries its arguments, bounded: through the real route,
 * with the provider stubbed at `fetch`, the reply names the subject the AI aimed at, never copies the user's whole
 * message a second time, cuts long text, drops list entries past the bound, redacts secret-named keys, and stays under
 * the per-call size.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TOOL_ARGUMENTS_MAX_CHARS, TOOL_ARGUMENT_STRING_MAX, USER_MESSAGE_MARK, toolArgumentsAsSent } from '../runtime/agent-loop.js';

// The card door reads the session store: an empty one, so the route runs without a database.
const store = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined
  : key === 'append' ? vi.fn(async () => ({ id: 'row-1' })) : key === 'readMostRecentPendingActions' ? vi.fn(async () => []) : key === 'ensureScenarioExists' ? vi.fn(async () => ({ user_id: null }))
  : vi.fn(async () => null)) });
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));

// A synthetic correction, written for this row; no case or journey text.
const MESSAGE = 'Actually the weekly slot for the pottery class is 2 hours, not 3 hours.';
const SUBJECT = { kind: 'factor', id: 'fac_slot', label: 'Weekly class slot', field: 'level' };
const LONG_READING = 'The slot drops by one hour each week. '.repeat(12);
const SENT = {
  correction: {
    quote: MESSAGE,
    edits: [{ subject: SUBJECT, retirement: { quote: '3 hours', scope: 'part', disposition: 'historical' },
      retained: Array.from({ length: 9 }, (_, i) => `kept span ${i}`), reading_words: LONG_READING }],
  },
  subject: SUBJECT,
  api_key: 'never-shown-value',
  statements: [{ quote: '2 hours', reading_words: 'Bearer abcdefghijklmnop' }],
};

describe('the reply records the AI’s tool arguments, bounded', () => {
  let app: FastifyInstance;
  let call = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const output = call === 1
        ? [{ type: 'function_call', name: 'propose_statement', arguments: JSON.stringify(SENT), call_id: 'c1' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'I could not prepare that change.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('names the item the AI aimed at; never the whole message twice, a secret, or more than the bound', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', message: MESSAGE } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { _agent: { tool_calls: { name: string; arguments?: Record<string, unknown> }[] } };
    const row = body._agent.tool_calls.find((c) => c.name === 'propose_statement');
    expect(row).toBeDefined();
    const args = row!.arguments as { subject: unknown; api_key: unknown; correction: { quote: unknown; edits: { subject: unknown; retained: unknown[]; reading_words: string; retirement: unknown }[] }; statements: { quote: unknown; reading_words: unknown }[] };
    // Which item, by identity: the exact subject the AI sent, in both places it sent it.
    expect(args.subject).toEqual(SUBJECT);
    expect(args.correction.edits[0]!.subject).toEqual(SUBJECT);
    expect(args.correction.edits[0]!.retirement).toEqual({ quote: '3 hours', scope: 'part', disposition: 'historical' });
    expect(args.statements[0]!.quote).toBe('2 hours');
    // The user's whole message is in the request already: marked, not copied.
    expect(args.correction.quote).toBe(USER_MESSAGE_MARK);
    expect(JSON.stringify(body._agent)).not.toContain(MESSAGE);
    // Bounded: long text cut, a long list cut with its remainder counted, the whole call under the cap.
    expect(args.correction.edits[0]!.reading_words).toBe(`${LONG_READING.slice(0, TOOL_ARGUMENT_STRING_MAX)}…(+${LONG_READING.length - TOOL_ARGUMENT_STRING_MAX})`);
    expect(args.correction.edits[0]!.retained).toEqual([...Array.from({ length: 6 }, (_, i) => `kept span ${i}`), '…+3 more']);
    expect(JSON.stringify(row!.arguments).length).toBeLessThanOrEqual(TOOL_ARGUMENTS_MAX_CHARS);
    // No secrets: a secret-named key and a credential-shaped value are redacted.
    expect(args.api_key).toBe('[redacted]');
    expect(args.statements[0]!.reading_words).toBe('[redacted]');
    expect(JSON.stringify(body._agent)).not.toContain('never-shown-value');
    expect(JSON.stringify(body._agent)).not.toContain('abcdefghijklmnop');
  });
});

describe('the whole-call bound', () => {
  it('a gated view keeps its shape only: each text as its length', () => {
    expect(toolArgumentsAsSent('give_provisional_view', JSON.stringify({ view: 'abc', reasoning: 'code_token here' }), []))
      .toEqual({ arguments: { view: '[text, 3 characters]', reasoning: '[text, 15 characters]' } });
  });
  it('keeps keys in order until the cap, then names the ones left out', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field_${i}`, `${i} `.repeat(100)]));
    const { arguments: a } = toolArgumentsAsSent('propose_statement', JSON.stringify(many), []);
    expect(JSON.stringify(a).length).toBeLessThanOrEqual(TOOL_ARGUMENTS_MAX_CHARS);
    expect(a!.field_0).toBe(`${'0 '.repeat(100).slice(0, TOOL_ARGUMENT_STRING_MAX)}\u2026(+${200 - TOOL_ARGUMENT_STRING_MAX})`);
    const kept = Object.keys(a!).filter((k) => k !== '_omitted');
    expect(kept).toEqual(Object.keys(many).slice(0, kept.length));
    expect(kept.length).toBeGreaterThan(0);
    // The keys left out are named, in order, up to eight of them.
    expect(a!._omitted).toEqual(Object.keys(many).slice(kept.length, kept.length + 8));
  });
  it.each(['{', 'null', '[]', '42', '"text"'])('records nothing for arguments that are not a JSON object: %s', (raw) => {
    expect(toolArgumentsAsSent('propose_statement', raw, [])).toEqual({});
  });
});

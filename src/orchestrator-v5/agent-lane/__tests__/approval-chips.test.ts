/**
 * ⭐ One click approves the ONE proposal just offered (approval-chips.ts), and
 * the chip says exactly what typing "yes" would.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { approvalChipsFor } from '../approval-chips.js';

describe('approval chips', () => {
  it('one proposal offered, nothing authorised → an approve chip and an amend chip', () => {
    const chips = approvalChipsFor([{ name: 'propose_starting_point', ok: true, proposal_id: 'prop_1' }]);
    expect(chips.map((c) => [c.label, c.message])).toEqual([
      ['Use as starting assumptions', 'Yes, use those.'],
      ['Change something first', 'Before you apply it, I want to change some of it.'],
    ]);
    // A chip without an action_type is plain text on the Agent route.
    for (const c of chips) expect((c as { action_type?: unknown }).action_type).toBeUndefined();
  });

  /**
   * ⭐ An added option (#1788's `propose_new_option`) gets the same one-click, typed approval
   * as every other proposal, so its "yes" takes fast path 2 (0 model calls) rather than a
   * full Agent turn. Without an entry here the proposal was offered with NO chip at all.
   */
  it('RED: a proposed NEW OPTION → a typed approve chip carrying its proposal id, and the amend chip', () => {
    const chips = approvalChipsFor([{ name: 'propose_new_option', ok: true, proposal_id: 'prop_abc123' }]);
    expect(chips.map((c) => [c.id, c.label, c.message])).toEqual([
      ['agent-approve-proposal:prop_abc123', 'Add this option', 'Yes, add that option.'],
      ['agent-amend-proposal', 'Change something first', 'Before you apply it, I want to change some of it.'],
    ]);
  });

  it('CONTRAST: two proposals pending → no chip (a "yes" would be ambiguous)', () => {
    expect(approvalChipsFor([
      { name: 'propose_assumptions', ok: true, proposal_id: 'prop_1' },
      { name: 'propose_option_interventions', ok: true, proposal_id: 'prop_2' },
    ])).toEqual([]);
  });

  it('CONTRAST: a refused proposal, a turn that authorised, and a read-only turn → no chip', () => {
    expect(approvalChipsFor([{ name: 'propose_starting_point', ok: false }])).toEqual([]);
    expect(approvalChipsFor([
      { name: 'propose_starting_point', ok: true, proposal_id: 'prop_1' },
      { name: 'authorise_change', ok: true },
    ])).toEqual([]);
    expect(approvalChipsFor([{ name: 'get_canonical_state', ok: true }])).toEqual([]);
  });
});

/* ── the ROUTE: a real proposal reaches the user with its chip, and no id ── */
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

describe('the route offers one-click approval for the proposal it just made', () => {
  let app: FastifyInstance;
  let call = 0;
  let proposalId = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'More people ship more.' }),
        }] }), { status: 200 });
      }
      // The second model call sees the proposal's id in its tool output — and,
      // like the served replies, prints it.
      const sent = String(init?.body ?? '');
      proposalId = /prop_[0-9a-f]{6,}/.exec(sent)?.[0] ?? '';
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text',
        text: `**Proposal \`${proposalId}\`** would connect Team size to Velocity. Approve it if that is right.` }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
      graph_hash: 'h1',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the reply carries a "Make this change" chip whose message is the typed approval, and shows no id', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', message: 'Should team size drive velocity?' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assistant_text: string; suggested_actions: { label: string; message: string }[]; _agent: { tool_calls: { name: string; ok: boolean }[] } };
    // Vacuity guards: the proposal really was made, and the model really printed its id.
    expect(body._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_model_change', ok: true })]);
    expect(proposalId).toMatch(/^prop_[0-9a-f]{6,}$/);

    expect(body.suggested_actions.map((a) => [a.label, a.message])).toEqual([
      ['Make this change', 'Yes, make that change.'],
      ['Change something first', 'Before you apply it, I want to change some of it.'],
    ]);
    expect(body.assistant_text).not.toMatch(/prop_[0-9a-f]{6,}/);
    expect(body.assistant_text).toContain('**This proposal** would connect Team size to Velocity.');
  });
});

/**
 * ⛔ THE AGENT NEVER APPROVES A CHANGE IT PREPARED IN THE SAME REQUEST — the user sees it first, and the one
 * approval is theirs.
 *
 * The gap, CODE-READ and adversarially re-checked at 0479d0c5 (CEE staging + C46 + #1978 + #1982): tools are
 * withheld only on a chip turn (`withheldToolsOf` returns [] for a typed composer message), and `authoriseChange`
 * checks the proposal's subject, integrity and base revision — never WHICH request minted it. So a typed "connect
 * Morale to Velocity" (or "add a Premium tier") could call a proposer and then `authorise_change` with the id it
 * had just been handed, in ONE reply, and change the model before the user saw the exact change. The route's own
 * comment records the same shape measured once before, on a click (#63 5819380376: "a same-turn
 * propose-and-authorise (commits:1)").
 *
 * The rule: every id a proposer mints (`prop_…` into the proposal store, `gmh_…` held by the product) is recorded
 * against the request that minted it, and `authorise_change` refuses it in that request as
 * `awaiting_your_approval` — nothing written, the approve chip still offered, and Olumi's status line says so in
 * plain words. The NEXT request (the chip, or a typed "yes") applies it exactly as before.
 *
 * The model is a fetch stub (no provider, no network); the product is a stub that commits a link on
 * `structural_add_edge`. The held add-option (`gmh_…`) rows run against the REAL route-v2 in
 * `agent-add-option-held-seam.test.ts` ([sa1]).
 */
import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { narrateWriteOutcome } from '../write-outcome.js';

/** One scenario per test: the route's proposal and history state is per scenario. */
let SCENARIO = randomUUID();

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

type Body = Record<string, unknown> & { input?: unknown[]; tools?: { name: string }[] };
type Step = (body: Body) => unknown[];
const say = (text: string): Step => () => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const call = (name: string, args: (b: Body) => Record<string, unknown>): Step => (b) => [{ type: 'function_call', name, call_id: `c_${name}_${Math.random().toString(36).slice(2, 8)}`, arguments: JSON.stringify(args(b)) }];
/** The id the model was just handed: the last `proposal_id` in its own input, exactly as a real model would read it. */
const lastProposalId = (b: Body): string => {
  const outs = (b.input ?? []).filter((i) => (i as { type?: string }).type === 'function_call_output') as { output: string }[];
  for (let k = outs.length - 1; k >= 0; k--) { const id = (JSON.parse(outs[k]!.output) as { proposal_id?: string }).proposal_id; if (id) return id; }
  return 'none';
};

type ToolCall = { name: string; ok: boolean; mutated: boolean; proposal_id?: string; refusal?: string };
type Chip = { id: string; label: string; message: string };
type R = { assistant_text: string; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: ToolCall[]; mutated: boolean }; suggested_actions?: Chip[] };

const CONNECT = { from_label: 'Morale', to_label: 'Velocity', direction: 'positive', rationale: 'The user said morale drives velocity.' };

describe('a typed message: the Agent proposes and then tries to authorise the SAME proposal in one reply', () => {
  let app: FastifyInstance;
  let script: Step[] = [];
  let commits = 0;
  let edges: { from: string; to: string }[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Body;
      const step = script.shift() ?? say('Here is what that would change.');
      return new Response(JSON.stringify({ output: step(body) }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'f2', kind: 'factor', label: 'Morale' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) { edges = [...edges, { from: b.event.from, to: b.event.to }]; commits += 1; return { assistant_text: 'Added.' }; }
      return { assistant_text: 'ok' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { script = []; commits = 0; edges = []; SCENARIO = randomUUID(); });

  const send = async (payload: Record<string, unknown>): Promise<R> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, agent_session_id: `sess-${SCENARIO}`, ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as R;
  };
  /** The typed composer turn in which the Agent proposes the link and then authorises it itself. */
  const proposeAndSelfApprove = () => {
    script = [
      call('propose_model_change', () => CONNECT),
      call('authorise_change', (b) => ({ proposal_id: lastProposalId(b) })),
      say('This would connect Morale to Velocity, pushing it up. Shall I make that change?'),
    ];
    return send({ source: 'composer', message: 'Morale drives velocity — connect them.' });
  };
  const approveChipOf = (b: R) => (b.suggested_actions ?? []).find((c) => c.id.startsWith('agent-approve-proposal:'));

  it('RED: refused as awaiting_your_approval — nothing written, the approve chip for THAT proposal is offered, and Olumi says so in plain words', async () => {
    const t1 = await proposeAndSelfApprove();
    const pid = t1._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(pid, 'control: a real proposal was minted').toMatch(/^prop_[0-9a-f]{32}$/);
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok, c.mutated])).toEqual([['propose_model_change', true, false], ['authorise_change', false, false]]);
    expect(t1._agent.tool_calls[1]).toEqual(expect.objectContaining({ refusal: 'awaiting_your_approval', proposal_id: pid }));
    expect(commits, 'nothing was written').toBe(0);
    expect(edges).toEqual([]);
    expect(t1._agent.mutated).toBe(false);
    expect(approveChipOf(t1)?.id, JSON.stringify(t1.suggested_actions)).toBe(`agent-approve-proposal:${pid}`);
    expect(t1.assistant_text, t1.assistant_text).toMatch(/Not saved: nothing changes until you approve it/);
    expect(t1.assistant_text, 'no raw refusal code in user prose').not.toMatch(/awaiting_your_approval/);
  }, 120_000);

  it('CONTRAST: the approve chip on the NEXT turn applies exactly that proposal, with no model call', async () => {
    const t1 = await proposeAndSelfApprove();
    const chip = approveChipOf(t1);
    expect(chip, JSON.stringify(t1.suggested_actions)).toBeDefined();
    const t2 = await send({ source: 'chip', message: chip!.message, chip: { id: chip!.id } });
    expect(t2._diagnostic_trace.fast_path).toBe('approve');
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: chip!.id.slice('agent-approve-proposal:'.length) })]);
    expect(commits).toBe(1);
    expect(edges).toEqual([{ from: 'f2', to: 'o1' }]);
  }, 120_000);

  it('CONTRAST: a typed "yes" on the NEXT turn — the Agent authorises the waiting proposal by its id and it applies', async () => {
    const t1 = await proposeAndSelfApprove();
    const pid = t1._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    script = [call('authorise_change', () => ({ proposal_id: pid })), say('Done.')];
    const t2 = await send({ source: 'composer', message: 'Yes, connect them.' });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: pid }));
    expect(commits).toBe(1);
  }, 120_000);
});

describe('the record is per request, bound from the request — never global', () => {
  /** A product that commits a link on `structural_add_edge`, so an authorisation that runs is visible. */
  const product = () => {
    let edges: { from: string; to: string }[] = [];
    const events: unknown[] = [];
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as { kind?: string; event?: { kind?: string; from: string; to: string } };
      if (path === '/orchestrate/v2/turn' && b.kind === 'system_event' && b.event?.kind === 'structural_add_edge') {
        events.push(b.event);
        edges = [...edges, { from: b.event.from, to: b.event.to }];
        return { status: 200, json: { assistant_text: 'Added.' } };
      }
      return { status: 200, json: { graph: { nodes: [{ id: 'f2', kind: 'factor', label: 'Morale' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges }, graph_hash: `h${edges.length}` } };
    };
    return { d, events };
  };
  const ctxOf = (request_id: string) => ({ scenario_id: 'sc-1', authenticated_user_id: 'user-a', request_id });

  it('RED: the SAME capability set refuses the id in the request that minted it, and applies it under the next request', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const made = await caps.proposeModelChange(ctxOf('req-1'), CONNECT as never);
    expect(made.proposal_id).toMatch(/^prop_/);
    const same = await caps.authoriseChange(ctxOf('req-1'), { proposal_id: made.proposal_id as string });
    expect(same).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'awaiting_your_approval', proposal_id: made.proposal_id }));
    expect(String(same.detail), 'the Agent is told to show it and wait').toMatch(/show the user exactly what it changes/i);
    expect(p.events, 'nothing was sent').toEqual([]);
    const next = await caps.authoriseChange(ctxOf('req-2'), { proposal_id: made.proposal_id as string });
    expect(next, JSON.stringify(next)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(p.events).toHaveLength(1);
  });
});

describe('the ONE approval rule: a refusal that consumed nothing leaves the proposal waiting', () => {
  it('RED: approvalChipsFor still offers the chip after an awaiting_your_approval refusal of that same id', () => {
    const chips = approvalChipsFor([
      { name: 'propose_model_change', ok: true, mutated: false, proposal_id: 'prop_aaaaaaaa' },
      { name: 'authorise_change', ok: false, mutated: false, proposal_id: 'prop_aaaaaaaa', refusal: 'awaiting_your_approval' },
    ]);
    expect(chips.map((c) => c.id)).toEqual(['agent-approve-proposal:prop_aaaaaaaa', 'agent-amend-proposal']);
  });

  it('CONTRAST (unchanged): an authorisation of that id refused for any other reason still consumes it — no chip', () => {
    const chips = approvalChipsFor([
      { name: 'propose_model_change', ok: true, mutated: false, proposal_id: 'prop_aaaaaaaa' },
      { name: 'authorise_change', ok: false, mutated: false, proposal_id: 'prop_aaaaaaaa', refusal: 'superseded' },
    ]);
    expect(chips).toEqual([]);
  });

  it('RED: a build turn whose starting point the Agent tried to approve itself says the figures are NOT recorded — never "the model was saved" alone', () => {
    const out = narrateWriteOutcome('', [
      { name: 'build_model_from_brief' }, { name: 'propose_starting_point' }, { name: 'authorise_change' },
    ], [
      { ok: true, mutated: true, model_version: { version_number: 1 } },
      { ok: true, mutated: false, proposal_id: 'prop_bbbbbbbb' },
      { ok: false, mutated: false, refusal: 'awaiting_your_approval', proposal_id: 'prop_bbbbbbbb' },
    ]);
    expect(out.status, String(out.status)).toBe(
      'I saved the model I drafted as version 1. The figures above are not recorded until you approve them. '
      + 'Not saved: nothing changes until you approve it — check the change above, and approve it if it is right.',
    );
  });
});

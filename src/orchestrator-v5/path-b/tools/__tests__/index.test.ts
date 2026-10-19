/**
 * PATH-B TOOL SEAM (C5): the adapters as the SDK's own function tools. Strict schemas the API accepts; one record per call
 * (the kit's row and the route's result); approval only on `apply_change`; a Run after an applied approval in the same turn
 * is refused. The change adapter is stubbed here (its own suite drives the real door).
 */
import { describe, expect, it, vi } from 'vitest';
import { RunContext, type FunctionTool, type Tool } from '@openai/agents';

vi.mock('../change-tools.js', async (original) => ({
  ...(await original<typeof import('../change-tools.js')>()),
  applyChange: vi.fn(async () => ({ status: 'ok', mutated: true, ran: false, data: { saved: true } })),
}));

import { pathBTools, type OnToolCall } from '../index.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { read } from './fixtures.js';

const PROPOSAL = `prop_${'a'.repeat(32)}`;
const ctx = { scenario_id: 'scn_1', authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [], user_turn_text: '' };
function setup(mode: 'core' | 'preview' = 'core') {
  const dispatch = vi.fn(async () => ({ status: 200, json: read() }));
  const calls: Parameters<OnToolCall>[] = [];
  const tools = pathBTools({ dispatch, proposals: new ProposalStore() }, ctx, mode, (row, result) => { calls.push([row, result]); });
  return { dispatch, calls, tools };
}
const named = (tools: Tool[], name: string): FunctionTool => tools.find((t) => t.name === name) as FunctionTool;

describe('the adapters as SDK function tools', () => {
  it('core: the five tools, strict, with no string limits a strict schema cannot carry; only apply_change asks for approval', async () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual(['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis']);
    for (const t of tools as FunctionTool[]) {
      expect(t.type).toBe('function');
      expect(t.strict, t.name).toBe(true);
      expect(JSON.stringify(t.parameters), t.name).not.toMatch(/minLength|maxLength/);
      const asks = await t.needsApproval(new RunContext(), (t.name === 'apply_change' ? { proposal_id: PROPOSAL } : {}) as never, 'call_1');
      expect(asks, t.name).toBe(t.name === 'apply_change');
    }
  });

  it('preview: the reader only', () => {
    expect(setup('preview').tools.map((t) => t.name)).toEqual(['read_canonical_context']);
  });

  it('each call is recorded once, after its outcome: the kit row and the route result', async () => {
    const { tools, calls } = setup();
    const out = JSON.parse(String(await named(tools, 'read_canonical_context').invoke(new RunContext(), '{}'))) as { status: string };
    expect(out.status).toBe('ok');
    expect(calls).toEqual([[{ name: 'read_canonical_context', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: null },
      { ok: true, mutated: false, outcome: 'ok' }]]);
  });

  it('the schema the SDK sends carries every check it parses with (a dropped check would end the turn on a parse failure)', () => {
    for (const t of setup().tools as FunctionTool[]) expect(JSON.stringify(t.parameters), t.name).not.toMatch(/pattern|format/);
  });

  it('after an applied approval, a Run in the same turn is refused; the approved proposal\'s id is on its result', async () => {
    const { tools, calls, dispatch } = setup();
    await named(tools, 'apply_change').invoke(new RunContext(), JSON.stringify({ proposal_id: PROPOSAL }));
    expect(calls[0]?.[1]).toEqual({ ok: true, mutated: true, proposal_id: PROPOSAL, outcome: 'ok' });
    const run = await named(tools, 'run_analysis').invoke(new RunContext(), JSON.stringify({ reason: 'Run it.', effects_timing: null }));
    expect(JSON.parse(String(run))).toEqual({ status: 'refused', reason: 'run_not_requested' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

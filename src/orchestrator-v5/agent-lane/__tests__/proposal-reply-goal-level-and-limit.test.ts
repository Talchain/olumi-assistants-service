/**
 * ⭐ PJ-C1 LATENCY, JOURNEY C: A GOAL'S CURRENT LEVEL AND A LIMIT'S NEW FIGURE ARE ANSWERED FROM THEIR OWN RESULT —
 * ONE MODEL CALL, NOT TWO.
 *
 * Served on 651a7fd (MG's 3 × journey C): "Our current MRR is £72,000." (`propose_goal_current_level`) and "…we have
 * £30,000 to spend." (`propose_limit_change`) each took two model calls (5.9–17.8 s and 6.3–16.7 s) with about 1 s of
 * server time; the second call only narrated the result. Two of journey C's ten turns, and the run's median sat at
 * 6.7 s against the 6 s target.
 *
 * The rule, as for every template (`proposal-reply.ts`): the consent subject is the proposal's own `public_label`; each
 * TYPED disclosure gets one fixed line; anything untyped keeps the second call.
 *   - Goal level: the figure is the user's by construction (`user_stated`, refused otherwise). When the same approval
 *     re-derives Olumi's one estimated part of the product (`rederived`, #2214), that is said, and that it stays Olumi's.
 *     A figure recorded in another unit (`as_stated` ≠ `current_level`) or a revision (`replaces`) keeps the second call.
 *   - Limit change: the new figure is the user's by construction (`figure_not_stated` refuses any other).
 *
 * The producer rows run the REAL capability on the SERVED graphs of those turns, with the user's words verbatim.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeProposalReply } from '../proposal-reply.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { AGENT_TOOLS, dispatchTool, type AgentCapabilities } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

type Served = { message: string; served_reply: string; graph: { nodes: Array<Record<string, unknown>> } & Record<string, unknown> };
const load = (f: string): Served => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as Served;
const C03 = load('served-journey-c-c03-mrr-651a7fd.json');
const C05 = load('served-journey-c-c05-budget-651a7fd.json');
const WHOLE = { whole_request: true };
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c3';

/** The real capability on a served graph, called as the Agent calls it, with the user's words verbatim. */
async function produce(s: Served, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(s.graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } }
    : { status: 500, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: s.message, user_turn_text: s.message };
  return (await dispatchTool(tool, JSON.stringify(args), ctx as never, caps)) as Record<string, unknown>;
}
const GOAL_ARGS = { goal_label: 'MRR', value: 72000, unit: 'GBP/month', goal_is: 'at_least', user_stated: true };
const limitLabel = (C05.graph.goal_constraints as Array<{ label: string; value: number }>).find((c) => c.value === 20000)!.label;
const LIMIT_ARGS = { limit_label: limitLabel, operator: '<=', new_value: 30000, unit: 'GBP', rationale: C05.message };

const clean = (reply: string | null): void => {
  expect(reply).not.toBeNull();
  expect(findForbiddenPhraseHit(reply!)).toBeNull();
  expect(reply).not.toMatch(/prop_|proposal_id|authorise_change|propose_/);
};

describe('⭐ PJ-C1 journey C: a goal level and a limit figure are answered from their own result', () => {
  it('both tools offer the model its `whole_request` word', () => {
    for (const name of ['propose_goal_current_level', 'propose_limit_change']) {
      const t = AGENT_TOOLS.find((x) => x.name === name)!;
      expect(Object.keys((t.parameters as { properties: Record<string, unknown> }).properties), name).toContain('whole_request');
    }
  });

  it('RED (the PRODUCER, served C03 on 651a7fd): the user’s MRR, and Olumi’s re-derived subscriber estimate said as Olumi’s', async () => {
    const r = await produce(C03, 'propose_goal_current_level', GOAL_ARGS);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(r.rederived, 'precondition: the served graph re-derives Olumi’s part').toEqual(expect.objectContaining({ whose: "Olumi's estimate" }));
    const reply = composeProposalReply('propose_goal_current_level', { ...GOAL_ARGS, ...WHOLE }, r, C03.message);
    clean(reply);
    const parts = reply!.split('\n\n');
    // The consent subject itself says the re-derivation (#2214), so the reply adds no line of its own.
    expect(parts[0]).toBe(`I’ve prepared this change: ${String(r.public_label).charAt(0).toLowerCase()}${String(r.public_label).slice(1).replace(/\.$/, '')}.`);
    expect(parts[0]).toMatch(/your figure: £72,000 \/ month .*Olumi's estimate of "Pro paying subscribers" becomes about 1,469 .*\(was 1,300 .*it stays Olumi's estimate, not your figure — this assumes all of your "MRR" comes from "Pro plan monthly price" × "Pro paying subscribers"; tell me if some comes from elsewhere\.$/);
    expect(parts[1]).toBe('Approve this change?');
    expect(parts).toHaveLength(2);
    expect(reply).not.toMatch(/\.\./);
  });

  it('the goal level with nothing re-derived: the subject and the question only', async () => {
    const r = await produce(C03, 'propose_goal_current_level', GOAL_ARGS);
    const { rederived: _r, ...plain } = r;
    const label = 'Record the current level of "MRR" as your figure: 72000 GBP/month (target 100000 GBP per month)';
    expect(composeProposalReply('propose_goal_current_level', { ...GOAL_ARGS, ...WHOLE }, { ...plain, public_label: label }, C03.message))
      .toBe('I’ve prepared this change: record the current level of "MRR" as your figure: 72000 GBP/month (target 100000 GBP per month).\n\nApprove this change?');
  });

  it('RED (the PRODUCER, served C05 on 651a7fd): the limit’s new figure, said as the user’s', async () => {
    const r = await produce(C05, 'propose_limit_change', LIMIT_ARGS);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const reply = composeProposalReply('propose_limit_change', { ...LIMIT_ARGS, ...WHOLE }, r, C05.message);
    clean(reply);
    expect(reply).toBe(`I’ve prepared this change: ${String(r.public_label).charAt(0).toLowerCase()}${String(r.public_label).slice(1)}.\n\nThe new figure is the one you gave.\n\nApprove this change?`);
    expect(reply).toContain(limitLabel);
  });

  it('FALLBACK: every untyped or disclosing shape keeps the second call', async () => {
    const goal = await produce(C03, 'propose_goal_current_level', GOAL_ARGS);
    const limit = await produce(C05, 'propose_limit_change', LIMIT_ARGS);
    const g = (x: Record<string, unknown>) => composeProposalReply('propose_goal_current_level', { ...GOAL_ARGS, ...WHOLE }, { ...goal, ...x }, C03.message);
    expect(g({ replaces: { value: 75000, unit: 'GBP/month' } }), 'a revision').toBeNull();
    expect(g({ as_stated: { value: 72, unit: 'GBP thousands per month' } }), 'recorded in another unit').toBeNull();
    expect(g({ rederived: { ...(goal.rederived as object), whose: 'the user' } }), 'untyped whose').toBeNull();
    expect(g({ not_represented: 'x' }), 'an unknown key').toBeNull();
    expect(g({ public_label: 'Record the current level of "MRR" as your figure: 72000 GBP/month' }), 'a re-derivation the subject does not say').toBeNull();
    expect(composeProposalReply('propose_limit_change', { ...LIMIT_ARGS, ...WHOLE }, { ...limit, limit: { on: limitLabel } }, C05.message), 'no figures').toBeNull();
    expect(composeProposalReply('propose_limit_change', { ...LIMIT_ARGS, ...WHOLE }, { ...limit, extra_note: 'x' }, C05.message), 'an unknown key').toBeNull();
    expect(composeProposalReply('propose_limit_change', { whole_request: false }, limit, C05.message)).toBeNull();
    expect(composeProposalReply('propose_goal_current_level', {}, goal, C03.message)).toBeNull();
    expect(composeProposalReply('propose_limit_change', { ...LIMIT_ARGS, ...WHOLE }, limit, 'We have £30,000 now — is that enough?')).toBeNull();
  });

  it('RED (the loop): a single propose_limit_change marked whole → exactly ONE model call', async () => {
    const limit = await produce(C05, 'propose_limit_change', LIMIT_ARGS);
    let calls = 0;
    const callModel = async () => {
      calls += 1;
      return { output: [{ type: 'function_call', name: 'propose_limit_change', arguments: JSON.stringify({ ...LIMIT_ARGS, ...WHOLE }), call_id: 'c1' }] } as never;
    };
    const caps = { proposeLimitChange: async () => limit } as unknown as AgentCapabilities;
    const r = await runAgentTurn({
      instructions: 'i', message: C05.message, history: [], ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'r' }, maxHops: 4, maxOutputTokens: 100,
      composeReply: (tool: string, args: unknown, res: unknown) => composeProposalReply(tool, args, res, C05.message),
    } as never, caps, callModel);
    expect(calls).toBe(1);
    expect(r.assistant_text).toMatch(/^I’ve prepared this change: change the limit on /);
  });
});

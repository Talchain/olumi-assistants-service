/**
 * ⭐ A LIMIT'S COMPARATOR CHANGES ONLY WHEN THE USER'S OWN WORDS SAY ONE (served `593362a`, journey C run 3, C06–C07).
 *
 * "I've just found out that we've had a budget increase, and we have £30,000 to spend." The model sent
 * `stated_operator: ">="` for "to spend", against the at-most budget limit, and `propose_limit_change` refused
 * (`unreadable_limit`) twice: "is the £30,000 a maximum six-month spend, or a minimum?", then "the tool read the
 * comparator inconsistently". Two extra turns for a figure the user gave plainly. The same refusal was served 4/4 in
 * earlier runs.
 *
 * THE RULE: a comparator the model passes counts only when the user wrote one THIS turn — `comparatorTheUserWrote`,
 * the reader the goal-target writer already uses. With none written, the limit keeps its own comparator and only its
 * figure changes (the tool's own words: "Omit it for a new figure alone"). A comparator the user DID write against the
 * limit's direction ("at least £30,000" on an at-most limit) is still refused and asked about.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

const C05 = JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-c05-budget-651a7fd.json', import.meta.url), 'utf8')) as {
  message: string; graph: { goal_constraints: Array<{ label: string; value: number; operator: string }> } & Record<string, unknown>;
};
const LIMIT = C05.graph.goal_constraints.find((c) => c.value === 20000)!;
const SERVED_RUN3 = 'I’ve just found out that we’ve had a budget increase, and we have £30,000 to spend.';

async function propose(userText: string, extra: Record<string, unknown>) {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(C05.graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } }
    : { status: 500, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore());
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c6', authenticated_user_id: null, request_id: 'r', user_text: userText, user_turn_text: userText };
  return (await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: LIMIT.label, operator: '<=', new_value: 30000, unit: 'GBP', rationale: userText, ...extra }), ctx as never, caps)) as Record<string, unknown>;
}

describe('⭐ a limit’s comparator changes only when the user’s own words say one', () => {
  it('PRECONDITION: the served limit is an at-most limit at £20,000', () => {
    expect(LIMIT.operator).toBe('<=');
  });

  it('RED (served C06/C07): "we have £30,000 to spend" with the model’s ">=" → the figure changes, the limit stays at most', async () => {
    for (const msg of [C05.message, SERVED_RUN3, 'Please change the budget limit to £30,000.']) {
      const r = await propose(msg, { stated_operator: '>=' });
      expect(r, msg).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(String(r.public_label), msg).toMatch(/from at most .*20,?000.* to at most .*30,?000/);
    }
  });

  it('CONTRAST: a comparator the user WROTE against the limit’s direction is still refused and asked about', async () => {
    const r = await propose('Make the budget at least £30,000.', { stated_operator: '>=' });
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unreadable_limit' }));
  });

  it('CONTRAST: a comparator the user wrote in the limit’s direction is kept ("under" → less than)', async () => {
    const r = await propose('Keep the budget under £30,000.', { stated_operator: '<' });
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(String(r.public_label)).toMatch(/to less than .*30,?000/);
  });

  it('CONTROL: no comparator from the model and none written → the limit keeps its own (unchanged behaviour)', async () => {
    const r = await propose(C05.message, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(String(r.public_label)).toMatch(/to at most .*30,?000/);
  });
});

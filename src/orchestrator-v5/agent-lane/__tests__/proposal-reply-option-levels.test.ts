/**
 * ⭐ PJ-C1 LATENCY: AN OPTION-LEVELS PROPOSAL IS ANSWERED FROM ITS OWN RESULT — ONE MODEL CALL, NOT TWO.
 *
 * On 28 Sep, 10 of the 68 served two-call proposal turns were `propose_option_interventions`. It had no `whole_request`
 * word and no template, so every one paid a second model call only to narrate it. Six of the ten were clean shapes:
 * "Just add it with your assumptions" → Olumi's own levels, each with its basis.
 *
 * The rule: the consent subject is the proposal's own `public_label`. Each level Olumi estimated says so with its basis,
 * in the option template's words. Whose figure it is comes from the result's typed `stated_by`, the same flag the writer
 * stamps, and is never guessed. Every disclosure key (not the user's figure, no range, already set, a new link…) keeps
 * the second call, because each carries a reason the user needs.
 *
 * The fixture is the capability's REAL output on a served graph (live replay, pj-20260928T030304Z A06), plus the typed
 * `stated_by` this change adds.
 */
import { describe, expect, it } from 'vitest';
import { composeProposalReply } from '../proposal-reply.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { AGENT_TOOLS, type AgentCapabilities } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

const A06 = {
  ok: true, mutated: false, proposal_id: 'prop_d2b495c98c625644a1f7200d5f45ef69',
  public_label: 'Improve trial-to-Pro conversion sets Pro paying subscribers to 1200 subscribers; Retention intervention for at-risk accounts sets Monthly churn to 2 %',
  base_revision: 'a'.repeat(64),
  interventions: [
    { option: 'Improve trial-to-Pro conversion', factor: 'Pro paying subscribers', value: 1200, unit: 'subscribers', recorded_on_model_scale: 0.24, model_range: 5000,
      basis: 'Olumi assumption: a 20% increase from the current assumed 1,000 Pro subscribers, representing a material but achievable conversion improvement.', stated_by: 'olumi_estimate' },
    { option: 'Retention intervention for at-risk accounts', factor: 'Monthly churn', value: 2, unit: '%', recorded_on_model_scale: 0.02, model_range: 100,
      basis: 'Olumi assumption: reducing the current assumed 3% monthly churn by one percentage point for at-risk-account retention work.', stated_by: 'olumi_estimate' },
  ],
  note: 'Nothing has changed. Show the user the value in THEIR units and what it rests on, then call authorise_change with this proposal_id once they agree.',
};
const WHOLE = { interventions: [], whole_request: true };
const MSG = 'Just add it with your assumptions, and I’ll review it.';

describe('⭐ PJ-C1: an option-levels proposal is answered from its own result', () => {
  it('the tool offers the model its `whole_request` word', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_option_interventions')!;
    expect(Object.keys((t.parameters as { properties: Record<string, unknown> }).properties)).toContain('whole_request');
  });

  it('RED (served A06): the consent subject, each of Olumi’s levels with its basis, and one question', () => {
    const reply = composeProposalReply('propose_option_interventions', WHOLE, A06, MSG);
    expect(reply).not.toBeNull();
    const parts = reply!.split('\n\n');
    expect(parts[0]).toBe(`I’ve prepared this change: ${A06.public_label}.`);
    expect(parts[1]).toMatch(/^‘Pro paying subscribers’ under ‘Improve trial-to-Pro conversion’ is set to .*1,?200.*subscribers.*, Olumi’s estimate \(Olumi assumption: a 20% increase/);
    expect(parts[1]).toMatch(/\), for you to correct\.$/);
    expect(parts[2]).toMatch(/^‘Monthly churn’ under ‘Retention intervention for at-risk accounts’ is set to .*2.*%.*, Olumi’s estimate \(/);
    expect(parts[3]).toBe('Approve this change?');
    expect(findForbiddenPhraseHit(reply!)).toBeNull();
    expect(reply).not.toMatch(/prop_|proposal_id|authorise_change/);
  });

  it('a level the USER stated needs no line (the subject says it); an untyped level keeps the second call', () => {
    const user = { ...A06, interventions: A06.interventions.map((i) => ({ ...i, stated_by: 'user' })) };
    expect(composeProposalReply('propose_option_interventions', WHOLE, user, MSG)).toBe(`I’ve prepared this change: ${A06.public_label}.\n\nApprove this change?`);
    const untyped = { ...A06, interventions: A06.interventions.map(({ stated_by: _s, ...i }) => i) };
    expect(composeProposalReply('propose_option_interventions', WHOLE, untyped, MSG)).toBeNull();
  });

  it('FALLBACK: every disclosure the capability returns keeps the second call (served E03/E04 shapes)', () => {
    for (const extra of [
      { adds_links_note: 'x' }, { not_the_users_figure: [{}], not_the_users_figure_note: 'x' }, { already_set: [{}] },
      { no_stated_range: [{}] }, { levels_not_accepted: [{}] }, { unresolved: [{}] }, { ambiguous_targets: [{}], ambiguous_note: 'x' },
    ]) expect(composeProposalReply('propose_option_interventions', WHOLE, { ...A06, ...extra }, MSG), JSON.stringify(extra)).toBeNull();
    expect(composeProposalReply('propose_option_interventions', { ...WHOLE, whole_request: false }, A06, MSG)).toBeNull();
    expect(composeProposalReply('propose_option_interventions', WHOLE, A06, 'Add those — what would they do?')).toBeNull();
  });

  it('RED (the PRODUCER): the real capability types whose each level is — the user’s £54 is `user`, Olumi’s £59 is `olumi_estimate` — and only Olumi’s gets a line', async () => {
    const COHORT = 'Test £54 versus £59 by customer cohort before rollout';
    const RAISE = 'Raise to £59';
    const nodes = [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month' } },
      { id: 'opt_cohort', kind: 'option', label: COHORT },
      { id: 'opt_raise', kind: 'option', label: RAISE },
    ];
    const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes, edges: [e('opt_cohort', 'fac_price'), e('opt_raise', 'fac_price'), e('fac_price', 'goal_mrr')] }, graph_hash: 'h0' } });
    const text = `For "${COHORT}": use £54 per month as its Pro plan monthly price.`;
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await caps.proposeOptionInterventions({ scenario_id: 's1', authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text } as never, { interventions: [
      { option_label: COHORT, factor_label: 'Pro plan monthly price', value: 54, unit: '£ per month', basis: 'the user: £54 per month', user_stated: true },
      { option_label: RAISE, factor_label: 'Pro plan monthly price', value: 59, unit: '£ per month', basis: 'Olumi assumption: the raise the decision names', user_stated: false },
    ] });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const typed = (r.interventions as { option: string; stated_by?: string }[]).map((i) => [i.option, i.stated_by]);
    expect(typed).toEqual(expect.arrayContaining([[COHORT, 'user'], [RAISE, 'olumi_estimate']]));
    const reply = composeProposalReply('propose_option_interventions', WHOLE, r, text);
    expect(reply, JSON.stringify(Object.keys(r))).not.toBeNull();
    {
      expect(reply).toMatch(new RegExp(`under ‘${RAISE}’ is set to .*Olumi’s estimate`));
      expect(reply).not.toMatch(new RegExp(`under ‘${COHORT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}’ is set to`));
    }
  });

  it('RED (the loop): a single propose_option_interventions marked whole → exactly ONE model call', async () => {
    let calls = 0;
    const callModel = async () => {
      calls += 1;
      return { output: [{ type: 'function_call', name: 'propose_option_interventions', arguments: JSON.stringify(WHOLE), call_id: 'c1' }] } as never;
    };
    const caps = { proposeOptionInterventions: async () => A06 } as unknown as AgentCapabilities;
    const r = await runAgentTurn({
      instructions: 'i', message: MSG, history: [], ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'r' }, maxHops: 4, maxOutputTokens: 100,
      composeReply: (tool: string, args: unknown, res: unknown) => composeProposalReply(tool, args, res, MSG),
    } as never, caps, callModel);
    expect(calls).toBe(1);
    expect(r.assistant_text).toMatch(/^I’ve prepared this change: Improve trial-to-Pro conversion sets/);
  });
});

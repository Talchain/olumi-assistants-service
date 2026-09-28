/**
 * ⭐ PJ-C1 LATENCY: A NEW-RISK PROPOSAL IS ANSWERED FROM ITS OWN RESULT — ONE MODEL CALL, NOT TWO.
 *
 * On 28 Sep, 68 served turns made one successful proposal and then a SECOND model call only to narrate it
 * (2–4.6 s each). A live replay of those 68 turns on their served graphs, with the served history, attributed each
 * one to the first composer rule it failed. The largest share was `propose_new_risk`: it has no `whole_request` word
 * and no template, so every risk turn paid the second call.
 *
 * The risk result is fully typed: the product's own consent subject (`held_message`), what the risk threatens and what
 * drives it (`risk.threatens`, `risk.driven_by`, user-facing strings the capability composes), and the fixed
 * placeholder-strength disclosure (`risk.how_strongly`). So the reply is composed from those alone, in the option
 * template's form. It falls back to the second call on any other shape, or on a `how_strongly` the template does
 * not know.
 *
 * Fixtures are the capability's REAL output on served graphs (live replay, pj-20260928T004149Z A08 and 011147Z A09).
 */
import { describe, expect, it } from 'vitest';
import { composeProposalReply } from '../proposal-reply.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { AGENT_TOOLS, type AgentCapabilities } from '../runtime/agent-tools.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

const PLACEHOLDER = 'not known yet: Olumi uses a placeholder strength for each link, not an estimate';
/** Served 004149Z A08 ("add a risk: competitors cut price or bundle AI features"): a risk that threatens MRR. */
const A08 = {
  ok: true, mutated: false, proposal_id: 'gmh_4c1d2e3f4a5b',
  public_label: 'Approve 2 changes',
  held_message: "Yes, add risk 'Competitor price cut or AI-feature deal' and link 'Competitor price cut or AI-feature deal' to 'MRR'.",
  held_detail: "Add risk 'Competitor price cut or AI-feature deal'\nLink 'Competitor price cut or AI-feature deal' to 'MRR'",
  base_revision: 'a'.repeat(64),
  risk: { label: 'Competitor price cut or AI-feature deal', threatens: ['MRR (lowers it)'], driven_by: [], how_strongly: PLACEHOLDER },
  note: 'Nothing has changed yet. Tell the user it will add the risk, what it threatens and what drives it, and that how strongly is a placeholder for them to correct — never the id — and call authorise_change with this proposal_id once they agree.',
};
/** Served 011147Z A09: the same, driven by a factor. */
const A09 = {
  ...A08, proposal_id: 'gmh_5d6e7f8a9b0c', public_label: 'Approve 3 changes',
  held_message: "Yes, add risk 'Competitor price or AI-feature response', link 'Competitor price or AI-feature response' to 'MRR' and link 'Pro plan price' to 'Competitor price or AI-feature response'.",
  risk: { label: 'Competitor price or AI-feature response', threatens: ['MRR (lowers it)'], driven_by: ['Pro plan price (more of it makes the risk more likely)'], how_strongly: PLACEHOLDER },
};
const WHOLE = { label: 'x', affects: [], rationale: 'r', whole_request: true };
const MSG = 'Add a risk: competitors may cut price or bundle AI features.';

describe('⭐ PJ-C1: a new-risk proposal is answered from its own result', () => {
  it('the tool offers the model its `whole_request` word', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_new_risk')!;
    expect(Object.keys((t.parameters as { properties: Record<string, unknown> }).properties)).toContain('whole_request');
  });

  it('RED (served A08): the consent subject, what it threatens, the placeholder strength, and the chip’s count', () => {
    const reply = composeProposalReply('propose_new_risk', WHOLE, A08, MSG);
    expect(reply).toBe([
      "I’ve prepared this change: add risk 'Competitor price cut or AI-feature deal' and link 'Competitor price cut or AI-feature deal' to 'MRR'.",
      'It threatens MRR (lowers it).',
      'How strongly it acts is not known yet: Olumi uses a placeholder strength for each link, not an estimate, for you to correct.',
      'Approve these 2 changes?',
    ].join('\n\n'));
    expect(findForbiddenPhraseHit(reply!)).toBeNull();
    expect(reply).not.toMatch(/gmh_|proposal_id|authorise_change/);
  });

  it('RED (served A09): what drives it is said too', () => {
    const reply = composeProposalReply('propose_new_risk', WHOLE, A09, MSG)!;
    expect(reply).toContain('It is driven by Pro plan price (more of it makes the risk more likely).');
    expect(reply).toMatch(/Approve these 3 changes\?$/);
  });

  it('FALLBACK: without the model’s `whole_request` word, or with a question in the message, the second call runs', () => {
    expect(composeProposalReply('propose_new_risk', { ...WHOLE, whole_request: false }, A08, MSG)).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, A08, 'Add that risk — what does it do?')).toBeNull();
  });

  it('FALLBACK: a shape the template does not know keeps the second call (an extra key, another strength text, nothing threatened, no subject)', () => {
    expect(composeProposalReply('propose_new_risk', WHOLE, { ...A08, extra_disclosure: 'x' }, MSG)).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, { ...A08, risk: { ...A08.risk, how_strongly: 'Olumi’s estimate' } }, MSG)).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, { ...A08, risk: { ...A08.risk, threatens: [] } }, MSG)).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, { ...A08, held_message: '' }, MSG)).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, { ok: false, mutated: false, refusal: 'risk_exists' }, MSG)).toBeNull();
  });

  it('RED (the loop): a single propose_new_risk marked whole → exactly ONE model call, and the reply is the composed text', async () => {
    let calls = 0;
    const callModel = async () => {
      calls += 1;
      return { output: [{ type: 'function_call', name: 'propose_new_risk', arguments: JSON.stringify(WHOLE), call_id: 'c1' }] } as never;
    };
    const caps = { proposeNewRisk: async () => A08 } as unknown as AgentCapabilities;
    const r = await runAgentTurn({
      instructions: 'i', message: MSG, history: [], ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'r' },
      maxHops: 4, maxOutputTokens: 100,
      composeReply: (tool: string, args: unknown, res: unknown) => composeProposalReply(tool, args, res, MSG),
    } as never, caps, callModel);
    expect(calls).toBe(1);
    expect(r.assistant_text).toMatch(/^I’ve prepared this change: add risk 'Competitor price cut or AI-feature deal'/);
  });
});

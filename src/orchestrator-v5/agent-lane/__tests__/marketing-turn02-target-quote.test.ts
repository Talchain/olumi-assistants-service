/**
 * ⭐ MARKETING TURN 02: THE AI QUOTES EACH TARGET, THE HOST VERIFIES IT ON THE CARD (served witness on 00a51f7d, run
 * 2026-10-14T012658Z-marketing-post2998, turns/02.json; JUDGE-marketing-post2998-codex.md item 1/5). Paul typed "…a
 * conversion rate of over 15% and secure 20 new customers within the first 3 months." `propose_goal_target` prepared ONE
 * revised-draft card holding both targets, but `holds_this_target` (the exact-label binding) read "new customers" as NOT on
 * ‘New customers in first 3 months’; the note said "NOT in the revised draft", the AI withdrew the card, and the turn's
 * reused draft then returned the withdrawn id as offered: no card reached him and nothing was saved.
 *
 * Same served inputs and real path as MA3 (`ma3-revised-draft-unit-respelling.test.ts`: served base + served drafter text
 * for turn 02): `propose_goal_target` → the gates → C's construction (prepare-only) → the card → `authorise_change` →
 * `/graph/register` with compare-and-set → a cold read of the stored bytes. The ONLY authored input is each call's `quote`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { proposalsAwaitingApproval } from '../approval-chips.js';
import { targetTheQuoteStates } from '../stated-by-user.js';
import { ProposalStore } from '../proposal.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

// The drafter-raw recorder writes its own table; it is a recorder, not logic, so it passes the build straight through.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/marketing-2992-served-base-04658ebe.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; graph_hash: string; graph: Rec; l20: { turn_id: string; message: string };
};
const RAW = readFileSync(new URL('./fixtures/marketing-2992-drafter-raw-f81dfd89.json', import.meta.url), 'utf8');
const SID = FX.scenario_id;
const L20 = FX.l20.message;
const SPEND_ID = 'agent-lane:annual_campaign_spend:<=';
const baseSpend = (): Rec => structuredClone((FX.graph.goal_constraints as Rec[]).find((r) => r.constraint_id === SPEND_ID)!);

/** The in-memory store: the read route, the register route's compare-and-set and replay rules, and the committed ledger. */
function server(graph0: Rec = FX.graph) {
  let graph: Rec = structuredClone(graph0);
  const commits: string[] = [];
  const ledger = { write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, FX.brief_text))],
    user_message_turn_ids: ['brief-turn'], first_user_message: FX.brief_text.trim(), complete: true };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: FX.brief_text,
        graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    }
    if (path === `/assist/v1/scenarios/${SID}/graph/register`) {
      const b = body as { graph: Rec; expected_graph_hash?: unknown; expected_graph_identity_hash?: unknown; operation_id?: string };
      const stored = GraphV3.parse(b.graph) as Rec;
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(graph as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = stored;
      const turn = registrationTurnId(SID, b.operation_id);
      commits.push(turn);
      ledger.write_turn_ids.push(turn);
      return { status: 200, json: { registered: true, graph_identity_hash: computeGraphIdentityHash(stored as never) } };
    }
    return { status: 404, json: {} };
  };
  return { dispatch, commits, graph: () => graph, readCommittedTurnLedger: async () => structuredClone(ledger),
    /** A turn's answer row lands (its user message), as the route commits it before the next turn's press. */
    said: (turnId: string) => { ledger.user_message_turn_ids.push(turnId); } };
}

function lane(s: ReturnType<typeof server>, raw: string = RAW) {
  let drafted = 0;
  const proposals = new ProposalStore();
  const call = (async () => { drafted += 1; return { text: raw }; }) as unknown as CallStructuredModel;
  const caps = createAgentCapabilities(s.dispatch, proposals, call, 'full', undefined, {
    readCommittedTurnLedger: s.readCommittedTurnLedger, readStatedObjections: async () => [],
  });
  return { caps, proposals, drafts: () => drafted };
}

const turn = { scenario_id: SID, authenticated_user_id: null, request_id: 'req-l20', turn_id: FX.l20.turn_id,
  user_turn_text: L20, user_text: `${FX.brief_text}\n${L20}` };
const conversion = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: L20 };
const customers = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: L20 };
const pressed = (proposalId: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0001', user_turn_text: '', user_text: `${FX.brief_text}\n${L20}`, typed_approval_of: proposalId });


const CONVERSION_WORDS = 'a conversion rate of over 15%';
const CUSTOMER_WORDS = 'secure 20 new customers within the first 3 months';
const heldTargets = (graph: Rec) => (graph.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target')
  .map((r) => [r.node_id, r.operator_as_stated ?? r.operator, r.value, r.unit]);
const BOTH = [['conversion_rate', '>', 15, '%'], ['new_customers_in_first_3_months', '>=', 20, 'customers']];
const UNKNOWN_NOTE = /could not be checked against the user’s words: ask the user to check the targets on the card/;

describe('marketing turn 02: each quoted target is verified on the card, an unverifiable one is unknown, never "not in it"', () => {
  it('⭐ RED→GREEN: both targets quoted → ONE card that holds both; approve → the cold read holds both', async () => {
    const s = server();
    const { caps } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, { ...conversion, quote: CONVERSION_WORDS } as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, { ...customers, quote: CUSTOMER_WORDS } as never) as Rec;
    expect(b.proposal_id).toBe(a.proposal_id);
    expect([a.revised_draft, b.revised_draft]).toEqual([
      { replaces_goal: 'product feature launch', holds_this_target: true }, { replaces_goal: 'product feature launch', holds_this_target: true }]);
    for (const r of [a, b]) expect(String(r.note)).not.toMatch(/NOT in the revised draft|could not be checked/);
    expect([...proposalsAwaitingApproval([
      { name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(a.proposal_id) },
      { name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(b.proposal_id) }]).keys()]).toEqual([a.proposal_id]);
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(String(a.proposal_id)) as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    expect(heldTargets(structuredClone(s.graph()))).toEqual(expect.arrayContaining(BOTH));
  });

  it('the whole two-target sentence as a quote is never verified (two figures: whose each is cannot be read) — unknown, the card still offered', async () => {
    const { caps } = lane(server());
    const a = await caps.proposeGoalTarget!(turn as never, { ...customers, quote: L20 } as never) as Rec;
    expect(a).toMatchObject({ ok: true, revised_draft: { holds_this_target: 'unknown' } });
  });

  // ⛔ CHANGED EXPECTATION (old → new, MA3 (c)): no quote, and a label the card holds longer: false "NOT in the revised
  // draft" → 'unknown' "check the card". The card carries that figure, comparator and unit on a target, so "not in it" was
  // false, and it made the AI withdraw the card (DL, 14 Oct 01:4xZ: unverifiable is unknown, never "not included").
  it('no quote: the exact label still verifies conversion; customers is UNKNOWN — never "NOT in the revised draft"', async () => {
    const { caps } = lane(server());
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect([a.revised_draft?.holds_this_target, b.revised_draft?.holds_this_target]).toEqual([true, 'unknown']);
    expect(String(b.note)).toMatch(UNKNOWN_NOTE);
    expect(String(b.note)).not.toMatch(/NOT in the revised draft/);
  });

  it.each([
    ['a quote Paul never wrote', 'secure 30 new customers within the first 3 months'],
    ['a quote whose 20 sits in another target’s part', 'a conversion rate of over 15% and secure 20'],
    ['a quote without the figure', 'new customers within the first 3 months'],
  ])('NEGATIVE: %s is never verified — unknown', async (_case, quote) => {
    const { caps } = lane(server());
    const b = await caps.proposeGoalTarget!(turn as never, { ...customers, quote } as never) as Rec;
    expect(b.revised_draft?.holds_this_target).toBe('unknown');
    expect(String(b.note)).toMatch(UNKNOWN_NOTE);
  });

  it('NEGATIVE: a figure no card target carries stays NOT held, whatever the quote (25 customers)', async () => {
    const { caps } = lane(server());
    const b = await caps.proposeGoalTarget!({ ...turn, user_turn_text: L20.replace('20 new', '25 new') } as never,
      { ...customers, value: 25, quote: 'secure 25 new customers within the first 3 months' } as never) as Rec;
    if (b.ok === true) {
      expect(b.revised_draft?.holds_this_target).toBe(false);
      expect(String(b.note)).toMatch(/This target \(25 customers\) is NOT in the revised draft/);
    } else expect(b, JSON.stringify(b)).toMatchObject({ ok: false, mutated: false });
  });
  it('NEGATIVE (buddy): a quote of ANOTHER quantity’s target never verifies this call’s (customers at 15%, quoting conversion)', async () => {
    const { caps } = lane(server());
    const r = await caps.proposeGoalTarget!(turn as never, { constraint_type: 'at_least', value: 15, unit: '%', measures: 'customers', rationale: L20,
      quote: CONVERSION_WORDS } as never) as Rec;
    expect(r.revised_draft?.holds_this_target).toBe('unknown');
  });
  it('NEGATIVE: the card\u2019s same-figure target on ANOTHER quantity is never verified by the user\u2019s quote for this one', async () => {
    // The served drafter text with the customers target relabelled: the card now holds \u2018Partner sign-ups\u2019 at least 20.
    const { caps } = lane(server(), RAW.split('New customers in first 3 months').join('Partner sign-ups'));
    const b = await caps.proposeGoalTarget!(turn as never, { ...customers, quote: CUSTOMER_WORDS } as never) as Rec;
    expect(b, JSON.stringify(b)).toMatchObject({ ok: true, revised_draft: { holds_this_target: 'unknown' } });
  });
  it('a card gone from the store WITHOUT a withdrawal is this turn’s own preparation: offered again, same id', async () => {
    const { caps, proposals } = lane(server());
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    proposals.discard(String(a.proposal_id));
    const again = await caps.proposeGoalTarget!(turn as never, { ...customers, quote: CUSTOMER_WORDS } as never) as Rec;
    expect(again).toMatchObject({ ok: true, proposal_id: a.proposal_id, revised_draft: { holds_this_target: true } });
    expect(proposals.get(String(a.proposal_id))).toBeDefined();
  });

  it('⭐ RED→GREEN: a card withdrawn this turn is never re-offered as if shown (the served propose → withdraw → propose)', async () => {
    const { caps, proposals } = lane(server());
    const a = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    const w = await caps.withdrawProposal!(turn as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(w).toMatchObject({ ok: true, withdrawn: true });
    const again = await caps.proposeGoalTarget!(turn as never, { ...customers, quote: CUSTOMER_WORDS } as never) as Rec;
    expect(again, JSON.stringify(again)).toMatchObject({ ok: false, mutated: false, refusal: 'withdrawn' });
    expect(again.proposal_id).toBeUndefined();
    expect(proposals.get(String(a.proposal_id))).toBeUndefined();
  });
});

describe('targetTheQuoteStates: the literal checks, one per check', () => {
  const T = (figure: number, unit: string, operator: string, label: string) => ({ figure, unit, operator, label });
  it('the quote’s own comparator, strictness included', () => {
    expect(targetTheQuoteStates(CONVERSION_WORDS, L20, T(15, '%', '>', 'conversion rate'))).toBe(true);
    expect(targetTheQuoteStates(CONVERSION_WORDS, L20, T(15, '%', '>=', 'conversion rate'))).toBe(false);
    expect(targetTheQuoteStates(CUSTOMER_WORDS, L20, T(20, 'customers', '>=', 'new customers')), 'a duration is not a second figure').toBe(true);
  });
  it.each([
    ['two targets in one sentence (whose each figure is cannot be read)', L20, T(20, 'customers', '>=', 'new customers')],
    ['the same figure twice, each with its own comparator (buddy)', 'Conversion must be over 15% and churn at most 15%.', T(15, '%', '>', 'churn')],
    ['a percentage is never a count of customers (buddy)', 'New customers must be over 15%.', T(15, 'customers', '>', 'New customers')],
    ['a shared word is not the subject: "monthly" is not monthly recurring revenue (buddy)', 'Monthly churn must fall by at least 15%.', T(15, '%', '>=', 'Monthly recurring revenue')],
    ['another quantity’s words', 'secure 20 new customers', T(20, 'sign-ups', '>=', 'Partner sign-ups')],
  ] as const)('NEGATIVE: %s', (_case, quote, target) => {
    expect(targetTheQuoteStates(quote, quote === L20 ? L20 : `${quote} ${L20}`, target)).toBe(false);
  });
});

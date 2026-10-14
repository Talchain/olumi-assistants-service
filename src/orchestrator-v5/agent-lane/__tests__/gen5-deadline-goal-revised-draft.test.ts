/**
 * ⭐ GEN #5 — A DEADLINE GOAL STATED AFTER THE DRAFT (Paul's funding test, 13 Oct 23:1xZ; `recovery/gen/PLAN.md` row 5).
 *
 * The draft is the SERVED one (`fixtures/funding-0b62faab-served-draft.json`: the construction turn's draft graph and the
 * brief, verbatim from Paul's debug export, CEE ef3790e). It models "Development speed" in milestones/month. Paul's goal
 * is a deliverable by a deadline, which `propose_goal_target` (figures only) can never carry.
 *
 * What runs for real: the capability (`propose_goal_deadline` with `deliverable` → the draft gates → C's construction in
 * prepare-only mode → admission's event-by-date model → the card → `authorise_change` → `/graph/register` with
 * compare-and-set → the read-back). What is scripted: the drafter's words (hand-written, so this is TESTED, not
 * WIRE-WITNESSED) and the store (in memory, with the register route's compare-and-set rules and the committed turn ledger).
 *
 * The user's words are Paul's own, verbatim. Row 1 places his "deliver a high-quality MVP within 6 months" message as the
 * first after the brief (in his test it came later, after other messages, where the draft gate rightly refuses: row 3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { draftedTeamPartOf, eventModelAsk } from '../../goal-target/event-by-date-model.js';
import type { CommittedTurnLedger } from '../../session/store.js';

vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/funding-0b62faab-served-draft.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; goal_turn: string; deliver_turn: string; graph: Rec;
};
const SID = FX.scenario_id;
const BRIEF_TURN = 'funding-brief-turn-0001';

/** The drafter's answer for the brief + Paul's "deliver a high-quality MVP within 6 months" message (hand-written). */
const deliverCandidate = (): Rec => ({
  goal: { kind: 'event_by_date', deliverable: 'a high-quality MVP', metric: 'a high-quality MVP', operator: '>=',
    unit: '% of a high-quality MVP', value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null,
    horizon_months: 6, provenance: 'explicit' },
  options: [
    { label: 'Hire 2 developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 8, lead_months_low: 1, lead_months_high: 2 } },
    { label: 'Hire 3 developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 1, lead_months_high: 2 } },
    { label: 'Hire 4 developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 15, lead_months_low: 1, lead_months_high: 2 } },
    { label: 'Interim tech lead while raising', provenance: 'explicit', added_capacity: { monthly_share_pct: 5, lead_months_low: 0, lead_months_high: 1 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [], unknowns: [], decision_question: null,
});

/** The drafter's answer for the brief + Paul's own goal message ("…ready to pilot with initial customers within 6 months"). */
const goalCandidate = (): Rec => ({
  ...deliverCandidate(),
  goal: { ...deliverCandidate().goal, deliverable: 'an MVP version of our product ready to pilot with initial customers',
    metric: 'an MVP version of our product ready to pilot with initial customers',
    unit: '% of an MVP version of our product ready to pilot with initial customers' },
  factors: [{ label: 'Team size', role: 'controllable', baseline_known: false, baseline_value: 3, unit: 'people', provenance: 'ai_proposed', plausible_max: 10 }],
});

function server(opts: { messagesSinceBrief?: string[] } = {}) {
  let graph: Rec = structuredClone(FX.graph);
  let commits = 0;
  const ledger = {
    write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, FX.brief_text))],
    user_message_turn_ids: [BRIEF_TURN, ...(opts.messagesSinceBrief ?? [])],
    first_user_message: FX.brief_text.trim(), complete: true,
  };
  const identity = () => computeGraphIdentityHash(graph as never)!.value;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: FX.brief_text,
        graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    }
    if (path === `/assist/v1/scenarios/${SID}/graph/register`) {
      const b = body as { graph: Rec; expected_graph_hash?: unknown; expected_graph_identity_hash?: unknown; operation_id?: string };
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
        || b.expected_graph_identity_hash !== identity()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = GraphV3.parse(b.graph) as Rec;
      commits += 1;
      ledger.write_turn_ids.push(registrationTurnId(SID, b.operation_id));
      return { status: 200, json: { registered: true, graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    }
    return { status: 404, json: {} };
  };
  return {
    dispatch, graph: () => graph, commits: () => commits,
    /** A turn's answer row lands (its user message). */
    said: (turnId: string) => { ledger.user_message_turn_ids.push(turnId); },
    readCommittedTurnLedger: async (): Promise<CommittedTurnLedger> => structuredClone(ledger) as CommittedTurnLedger,
  };
}

function lane(s: ReturnType<typeof server>, draft: () => Rec) {
  const call = (async () => ({ text: JSON.stringify(draft()) })) as unknown as CallStructuredModel;
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(s.dispatch, proposals, call, 'full', undefined, {
    readCommittedTurnLedger: s.readCommittedTurnLedger,
    readStatedObjections: async () => [],
  });
  return { caps, proposals };
}

const turn = (text: string, turnId = 'funding-goal-turn-0002') => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-gen5',
  turn_id: turnId, user_turn_text: text, user_text: `${FX.brief_text}\n${text}` });
const pressed = (proposalId: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0003', user_turn_text: '', user_text: FX.brief_text, typed_approval_of: proposalId });
const deadline = { deadline_words: 'within 6 months', rationale: 'Paul: deliver a high-quality MVP within 6 months.', deliverable: 'a high-quality MVP' };

describe('GEN #5: a deadline goal typed after the draft opens the revised-draft card', () => {
  it('Paul\'s "deliver a high-quality MVP within 6 months" → ONE card replacing "Development speed"; nothing written until pressed', async () => {
    const s = server();
    const { caps, proposals } = lane(s, deliverCandidate);
    const before = JSON.stringify(s.graph());
    const r = await caps.proposeGoalDeadline!(turn(FX.deliver_turn) as never, deadline) as Rec;

    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(r.revised_draft).toEqual({ replaces_goal: 'Development speed', holds_deadline_goal: true });
    expect(r.public_label).toBe('Replace the early draft with a revised one built from your brief and the goal you just gave: '
      + '‘a high-quality MVP’ done by its deadline (the date is confirmed separately) (the draft modelled ‘Development speed’). '
      + 'Options: ‘Hire 2 developers’, ‘Hire 3 developers’, ‘Hire 4 developers’, ‘Interim tech lead while raising’, ‘Carry on as now’. '
      + 'Not carried: Olumi’s earlier estimates and links, which are drafted afresh. Check the targets, limits and options on this card before choosing.');
    expect(r.note).not.toContain('NOT in the revised draft');
    expect(s.commits()).toBe(0);
    expect(JSON.stringify(s.graph())).toBe(before);
    // The card's candidate IS the event model for Paul's deliverable (identity, not a value predicate).
    const op = proposals.get(r.proposal_id)!.operations[0]!;
    expect(op.op).toBe('replace_draft');
    expect(draftedTeamPartOf((op.value as Rec).candidate)?.deliverable).toBe('a high-quality MVP');

    s.said('funding-goal-turn-0002');
    const applied = await caps.authoriseChange(pressed(r.proposal_id) as never, { proposal_id: r.proposal_id } as never) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(s.commits()).toBe(1);
    expect(draftedTeamPartOf(s.graph())?.deliverable).toBe('a high-quality MVP');
    // Never "run the analysis again" on a goal with no date: the deadline Paul typed goes on its own card, not asked again.
    const ask = eventModelAsk(s.graph());
    expect(ask).not.toBeNull();
    expect(applied.follow_up).toBe('Your model is now the revised draft shown on the card you approved. The earlier analysis was of the old draft. '
      + `Its deadline date is not held yet: if the user has stated the deadline, call propose_goal_deadline with their exact words; otherwise ask: ${ask}`);
    // …and that card is on the replaced model's own goal, from his words in the earlier message.
    const next = await caps.proposeGoalDeadline!({ ...turn('Yes, that card is right.', 'funding-turn-0004'),
      user_text: `${FX.brief_text}\n${FX.deliver_turn}\nYes, that card is right.` } as never,
    { deadline_words: 'within 6 months', rationale: 'Paul: deliver a high-quality MVP within 6 months.' }) as Rec;
    expect(next.ok, JSON.stringify(next)).toBe(true);
    expect(next.revised_draft).toBeUndefined();
    expect(proposals.get(next.proposal_id)!.operations[0]).toMatchObject({ op: 'set_goal_deadline', path: 'event_goal' });
    expect(s.commits()).toBe(1);
  });

  it('KNOWN GAP (3): Paul\'s own goal words ("ready to pilot … within 6 months") name no event the brief reader attests → not offered, nothing written', async () => {
    const s = server();
    const { caps } = lane(s, goalCandidate);
    const r = await caps.proposeGoalDeadline!(turn(FX.goal_turn) as never,
      { ...deadline, deliverable: 'an MVP version of our product ready to pilot with initial customers' }) as Rec;
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('revised_draft_has_no_target');
    expect(s.commits()).toBe(0);
  });

  it('after other messages (Paul\'s real order) the draft gate refuses, naming the deadline goal; nothing written', async () => {
    const s = server({ messagesSinceBrief: ['funding-goal-turn-earlier'] });
    const { caps } = lane(s, deliverCandidate);
    const r = await caps.proposeGoalDeadline!(turn(FX.deliver_turn) as never, deadline) as Rec;
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('draft_holds_your_work');
    expect(r.detail).toContain('‘a high-quality MVP’ by its deadline');
    expect(s.commits()).toBe(0);
  });

  it('a deadline not typed in this message never opens the card (the revised draft reads only this message)', async () => {
    const s = server();
    let drafted = 0;
    const { caps } = lane(s, () => { drafted += 1; return deliverCandidate(); });
    const r = await caps.proposeGoalDeadline!(turn('Yes, go ahead.') as never, deadline) as Rec;
    expect(r.revised_draft).toBeUndefined();
    expect(drafted).toBe(0);
    expect(s.commits()).toBe(0);
  });
});

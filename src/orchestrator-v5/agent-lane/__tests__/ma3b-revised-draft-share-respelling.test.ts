/**
 * ⭐ MA3b — A REVISED DRAFT THAT RE-SPELLS A SAVED LIMIT IN AN EQUIVALENT UNIT IS NOT REFUSED (served cohort witness
 * 2026-10-15T053420Z, UI 2c43f563 · CEE c1e944a4).
 *
 * Inputs, byte for byte:
 *   · the served base before turn 02 (`fixtures/marketing-cohort-witness-served-base.json`: reads/01-03-before.json and
 *     turns/02.json's request), holding the founder limit as `% of founder time`;
 *   · the served drafter text for turn 02 (`fixtures/marketing-cohort-witness-drafter-retry-d3cf1a2e.txt`,
 *     cee_drafter_raw_responses 0d12d9ca call 2, sha256 d3cf1a2e…). It wrote that SAME limit as `%`, so `limitsKeptBy` set
 *     `conflict` and both of Paul's target calls were refused `revised_draft_not_prepared`: the goal stayed Olumi's
 *     provisional "Campaign performance" for the whole journey.
 * The class (DL 15 Oct): same id + same quantity in an equivalent unit is no conflict, read through the unit reader
 * (`sameUnitAsEarlier`), never a spelling list. A real conflict still refuses, naming the saved limit and the ask.
 * What runs for real: `propose_goal_target` → the gates → construction in prepare-only mode → admission → `limitsKeptBy` →
 * the card → `authorise_change` → `/graph/register` with compare-and-set. Scripted: the store and its turn ledger.
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
import { sameUnitAsEarlier } from '../same-unit.js';

// The drafter-raw recorder writes its own table; it is a recorder, not logic, so it passes the build straight through.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
type Fixture = { scenario_id: string; brief_text: string; graph_hash: string; graph: Rec; l20: { turn_id: string; message: string } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/marketing-cohort-witness-served-base.json', import.meta.url), 'utf8')) as Fixture;
/** The SECOND brief through the same branch (DL two-brief rule): served marketing-2992, 13 Oct (`GBP/year` → `£`, MA3's inputs). */
const FX2 = JSON.parse(readFileSync(new URL('./fixtures/marketing-2992-served-base-04658ebe.json', import.meta.url), 'utf8')) as Fixture;
const RAW2 = readFileSync(new URL('./fixtures/marketing-2992-drafter-raw-f81dfd89.json', import.meta.url), 'utf8');
const RAW = readFileSync(new URL('./fixtures/marketing-cohort-witness-drafter-retry-d3cf1a2e.txt', import.meta.url), 'utf8');
const SID = FX.scenario_id;
const L20 = FX.l20.message;
const TIME_ID = 'agent-lane:founder_campaign_time:<=';
const SPEND_ID = 'agent-lane:annual_campaign_spend:<=';
const baseRow = (id: string): Rec => structuredClone((FX.graph.goal_constraints as Rec[]).find((r) => r.constraint_id === id)!);

function server(graph0: Rec = FX.graph, fx: Fixture = FX) {
  const SID = fx.scenario_id;
  let graph: Rec = structuredClone(graph0);
  const commits: string[] = [];
  const ledger = { write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, fx.brief_text))],
    user_message_turn_ids: ['brief-turn'], first_user_message: fx.brief_text.trim(), complete: true };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: fx.brief_text,
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

const turnOf = (fx: Fixture) => ({ scenario_id: fx.scenario_id, authenticated_user_id: null, request_id: 'req-l20', turn_id: fx.l20.turn_id,
  user_turn_text: fx.l20.message, user_text: `${fx.brief_text}\n${fx.l20.message}` });
const turn = turnOf(FX);
const conversion = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: L20 };
const customers = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: L20 };
const pressed = (proposalId: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0001', user_turn_text: '', user_text: `${FX.brief_text}\n${L20}`, typed_approval_of: proposalId });
/** The served drafter text with the founder limit's row changed. */
const withTimeRow = (patch: Rec): string => {
  const raw = JSON.parse(RAW) as Rec;
  Object.assign((raw.constraints as Rec[]).find((c) => c.metric === 'Founder campaign time')!, patch);
  return JSON.stringify(raw);
};

describe('MA3b: the served cohort-witness turn 02 — the founder limit re-spelled "%" is carried, both targets reach one card', () => {
  it('precondition: the served base holds the founder limit as "% of founder time"; the served drafter wrote the same limit as "%"', () => {
    expect(baseRow(TIME_ID)).toMatchObject({ unit: '% of founder time', value: 25, operator: '<=' });
    expect(baseRow(SPEND_ID)).toMatchObject({ unit: '£/year', value: 100000, operator: '<=' });
    const drafted = (JSON.parse(RAW) as Rec).constraints as Rec[];
    expect(drafted.find((c) => c.metric === 'Founder campaign time')).toMatchObject({ unit: '%', value: 25, operator: '<=' });
  });

  it('the unit reader: a redraft\'s unstated base or period is the earlier unit\'s; any part both state must agree', () => {
    expect(sameUnitAsEarlier('% of founder time', '%')).toBe(true);
    expect(sameUnitAsEarlier('GBP/year', '£')).toBe(true);
    expect(sameUnitAsEarlier('£/year', 'GBP per year')).toBe(true);
    for (const [earlier, later] of [['% of founder time', '% of my time'], ['%', '% of founder time'], ['% of founder time', 'percentage points'],
      ['GBP/year', '£/month'], ['GBP/year', '$'], ['GBP/customer', '£'], ['GBP million', '£']] as const) {
      expect(sameUnitAsEarlier(earlier, later), `${earlier} | ${later}`).toBe(false);
    }
  });

  it('⭐ RED→GREEN: both calls get ONE card holding both targets, with the founder limit carried as the earlier row, once', async () => {
    const s = server();
    const { caps, proposals, drafts } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, mutated: false });
    expect(b.proposal_id).toBe(a.proposal_id);
    expect(drafts(), 'one construction for the turn').toBe(1);
    const card = String(a.public_label);
    expect(card).toContain('15%');
    expect(card).toContain('20 customers');
    const candidate = proposals.get(String(a.proposal_id))!.operations[0]!.value as Rec;
    const rows = candidate.candidate.goal_constraints as Rec[];
    expect(rows.filter((r) => r.constraint_id === TIME_ID)).toEqual([baseRow(TIME_ID)]);
    expect(rows.filter((r) => r.constraint_id === SPEND_ID)).toHaveLength(1);
    expect(s.graph()).toEqual(FX.graph);
  });

  it('real path: card → approve → the saved model holds both targets and the founder limit as the user\'s earlier row', async () => {
    const s = server();
    const { caps } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(String(a.proposal_id)) as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    expect(s.commits).toHaveLength(1);
    const rows = s.graph().goal_constraints as Rec[];
    const targets = rows.filter((r) => r.role === 'goal_target').map((r) => [r.operator_as_stated ?? r.operator, r.value, r.unit]);
    expect(targets).toEqual(expect.arrayContaining([['>', 15, '%'], ['>=', 20, 'customers']]));
    expect(rows.filter((r) => r.constraint_id === TIME_ID).map((r) => [r.value, r.unit])).toEqual([[25, '% of founder time']]);
    expect(rows.filter((r) => r.constraint_id === SPEND_ID).map((r) => [r.value, r.unit])).toEqual([[100000, '£/year']]);
  });

  it('NEGATIVE: a redraft that STATES a different base ("% of my time", "% of revenue") or a different figure on the same id still refuses — and says which saved limit and what to ask', async () => {
    // (A drafted "percentage points" never reaches the carry: admission reads the limit in its factor's own unit first.)
    for (const patch of [{ unit: '% of my time' }, { unit: '% of revenue' }, { value: 20 }]) {
      const s = server();
      const a = await lane(s, withTimeRow(patch)).caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
      expect(a, `${JSON.stringify(patch)}: ${JSON.stringify(a)}`).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_not_prepared' });
      expect(a.detail).toContain('the saved limit ‘Founder campaign time’ at most 25');
      expect(a.detail).toContain('Ask the user whether that limit still holds as saved');
      expect(s.graph()).toEqual(FX.graph);
    }
  });
});

describe('MA3b, the second brief through the same branch: served marketing-2992 (13 Oct), the budget re-spelled "£" on its id', () => {
  const conv2 = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: FX2.l20.message };
  const spendId = 'agent-lane:annual_campaign_spend:<=';
  const base2 = (): Rec => structuredClone((FX2.graph.goal_constraints as Rec[]).find((r) => r.constraint_id === spendId)!);

  it('precondition: the saved budget is "GBP/year" and the recorded redraft wrote the same limit as "£"', () => {
    expect(base2()).toMatchObject({ unit: 'GBP/year', value: 100000, operator: '<=' });
    expect(((JSON.parse(RAW2) as Rec).constraints as Rec[]).find((c) => c.metric === 'Annual campaign spend')).toMatchObject({ unit: '£', value: 100000 });
    expect(sameUnitAsEarlier('GBP/year', '£')).toBe(true);
  });

  it('GREEN through sameUnitAsEarlier: the card is offered, the budget carried as the earlier row once; CONTRAST: a stated other period refuses, naming the limit', async () => {
    const s = server(FX2.graph, FX2);
    const { caps, proposals } = lane(s, RAW2);
    const a = await caps.proposeGoalTarget!(turnOf(FX2) as never, conv2 as never) as Rec;
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, mutated: false });
    const candidate = proposals.get(String(a.proposal_id))!.operations[0]!.value as Rec;
    expect((candidate.candidate.goal_constraints as Rec[]).filter((r) => r.constraint_id === spendId)).toEqual([base2()]);
    const raw = JSON.parse(RAW2) as Rec;
    (raw.constraints as Rec[]).find((c) => c.metric === 'Annual campaign spend')!.unit = '£/month';
    const s2 = server(FX2.graph, FX2);
    const b = await lane(s2, JSON.stringify(raw)).caps.proposeGoalTarget!(turnOf(FX2) as never, conv2 as never) as Rec;
    expect(b, JSON.stringify(b)).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_not_prepared' });
    expect(b.detail).toContain('the saved limit ‘Annual campaign spend’ at most');
    expect(s2.graph()).toEqual(FX2.graph);
  });
});

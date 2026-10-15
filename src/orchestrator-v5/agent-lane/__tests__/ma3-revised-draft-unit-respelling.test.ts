/**
 * ⭐ MA3 — MARKETING'S REVISED DRAFT IS NOT REFUSED OVER A UNIT RE-SPELLING (served run 2026-10-13T230238Z-marketing-2992).
 *
 * Inputs, byte for byte (`DIAG-MARKETING-REVISED-DRAFT-20261014.md`):
 *   · the served base before turn 02 (`fixtures/marketing-2992-served-base-04658ebe.json`, reads/01-03-before.json; graph
 *     04658ebe = turn 02's graph_hash);
 *   · the served drafter text for turn 02 (`fixtures/marketing-2992-drafter-raw-f81dfd89.json`, cee_drafter_raw_responses
 *     697efc74, sha256 f81dfd89…). It re-spelled the budget's `GBP/year` as `£` on the SAME constraint id, so
 *     `limitsKeptBy` set `conflict` and both of Paul's target calls were refused `revised_draft_not_prepared`.
 * What runs for real: `propose_goal_target` → the gates → C's construction in prepare-only mode → admission →
 * `limitsKeptBy` → the card → `authorise_change` → `/graph/register` with compare-and-set → the production Run loader.
 * Scripted: the store (in memory, with the register route's compare-and-set) and its committed turn ledger.
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
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

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

/** The production Run loader and handler over the stored bytes, in probe mode: the exact PLoT request body. */
async function plotBodyFromStore(graph: Rec): Promise<Rec> {
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(graph), briefText: FX.brief_text, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snap = await loadScenarioSnapshotForRunAnalysis(SID, 'req-run', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snap,
    probe: async (sent: { plotPayload: unknown }) => { payload = sent.plotPayload as Rec; },
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SID, request_id: 'req-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return payload!;
}

describe('MA3: the served marketing turn 02 — the re-spelled budget row is carried, both targets reach one card', () => {
  it('precondition: the served base holds the budget as GBP/year and the served drafter re-spelled it "£" on the same id', () => {
    expect(baseSpend()).toMatchObject({ unit: 'GBP/year', value: 100000, operator: '<=' });
    const drafted = (JSON.parse(RAW) as Rec).constraints as Rec[];
    expect(drafted.find((c) => c.metric === 'Annual campaign spend')).toMatchObject({ unit: '£', value: 100000, operator: '<=' });
  });

  it('(a) RED→GREEN: both calls get ONE card holding both targets, the budget as the earlier row, and the founder question', async () => {
    const s = server();
    const { caps, proposals, drafts } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, mutated: false });
    expect(b.proposal_id).toBe(a.proposal_id);
    expect(drafts(), 'one construction for the turn').toBe(1);
    const card = String(a.public_label);
    expect(card).toContain('‘conversion rate’ above 15% and ‘New customers in first 3 months’ at least 20 customers');
    expect(card).toContain('Limits in the revised draft: ‘Annual campaign spend’ at most £100,000 / year; ‘Founder time on campaign’ at most 25%.');
    expect(card).toContain('Previous: ‘Founder marketing time’ at most 25%; proposed: ‘Founder time on campaign’ at most 25%. Do these describe the same limit?');
    expect(card).not.toMatch(/at most £100,000(?! \/ year)/);
    // The earlier row is carried unchanged: the candidate the card approves holds the base row, byte for byte, once.
    const candidate = proposals.get(String(a.proposal_id))!.operations[0]!.value as Rec;
    expect((candidate.candidate.goal_constraints as Rec[]).filter((r) => r.constraint_id === SPEND_ID)).toEqual([baseSpend()]);
    expect(s.graph()).toEqual(FX.graph);
  });

  it('(b) the same id at another figure (£80,000) is still refused — "£" never stands in for a different limit', async () => {
    const raw = JSON.parse(RAW) as Rec;
    (raw.constraints as Rec[]).find((c) => c.metric === 'Annual campaign spend')!.value = 80000;
    const s = server();
    const a = await lane(s, JSON.stringify(raw)).caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    expect(a, JSON.stringify(a)).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_not_prepared' });
    expect(s.graph()).toEqual(FX.graph);
  });

  it('(b) the same id in another currency or with its own period ("$", "£/month") is still refused — only a dropped period is carried', async () => {
    for (const unit of ['$', '£/month']) {
      const raw = JSON.parse(RAW) as Rec;
      (raw.constraints as Rec[]).find((c) => c.metric === 'Annual campaign spend')!.unit = unit;
      const s = server();
      const a = await lane(s, JSON.stringify(raw)).caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
      expect(a, `${unit}: ${JSON.stringify(a)}`).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_not_prepared' });
      expect(s.graph()).toEqual(FX.graph);
    }
  });

  it('(b) only the currency over ONE period is carried for a bare "£": per-customer, scaled or qualified earlier units still refuse (Codex buddy)', async () => {
    for (const [unit, carried] of [['GBP/customer', false], ['GBP million', false], ['GBP MRR/year', false], ['£ per year', true], ['GBP/month', true]] as const) {
      const base = structuredClone(FX.graph);
      (base.goal_constraints as Rec[]).find((r) => r.constraint_id === SPEND_ID)!.unit = unit;
      const s = server(base);
      const a = await lane(s).caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
      if (carried) expect(a, `${unit}: ${JSON.stringify(a)}`).toMatchObject({ ok: true, mutated: false });
      else expect(a, `${unit}: ${JSON.stringify(a)}`).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_not_prepared' });
      expect(s.graph()).toEqual(base);
    }
  });

  it('(c) holds_this_target is the exact-label binding: a name the card holds under a longer label is UNKNOWN, never "not held"', async () => {
    const s = server();
    const { caps } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(b.proposal_id).toBe(a.proposal_id);
    expect(a.revised_draft).toEqual({ replaces_goal: 'product feature launch', holds_this_target: true });
    // ⛔ CHANGED EXPECTATION (old → new; DL 14 Oct 01:4xZ): false → 'unknown'. "new customers" vs the card's ‘New customers
    // in first 3 months’ cannot be verified, and the card carries that figure on a target, so "not in it" was false: it made
    // the AI withdraw the card (served turn 02 on 00a51f7d, `marketing-turn02-card.test.ts`). The card shows both targets.
    expect(b.revised_draft).toEqual({ replaces_goal: 'product feature launch', holds_this_target: 'unknown' });
    expect(String(b.public_label)).toContain('‘New customers in first 3 months’ at least 20 customers');
  });

  it('(d) real path: card → approve → the saved model holds both targets and both limits → cold read → withheld for its one unvalued risk; valued, the PLoT body', async () => {
    const s = server();
    const { caps } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(String(a.proposal_id)) as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    expect(s.commits).toHaveLength(1);
    // Cold read: a fresh lane over the stored bytes.
    const stored = structuredClone(s.graph());
    const rows = stored.goal_constraints as Rec[];
    const targets = rows.filter((r) => r.role === 'goal_target').map((r) => [r.node_id, r.operator_as_stated ?? r.operator, r.value, r.unit]);
    expect(targets).toEqual(expect.arrayContaining([['conversion_rate', '>', 15, '%'], ['new_customers_in_first_3_months', '>=', 20, 'customers']]));
    // The budget is the earlier row, byte for byte, exactly once; the founder limit is held as both rows, the earlier one unscored.
    expect(rows.filter((r) => r.constraint_id === SPEND_ID)).toEqual([baseSpend()]);
    expect(rows.filter((r) => /founder/.test(String(r.node_id))).map((r) => [r.node_id, r.value, r.unit, r.retained_unresolved_limit?.role]))
      .toEqual([['founder_time_on_campaign', 25, '%', undefined], ['founder_marketing_time', 25, '%', 'original']]);
    const again = await lane(server(stored)).caps.proposeGoalTarget!({ ...turn, turn_id: 'later-turn' } as never, conversion as never) as Rec;
    expect(again.refusal).not.toBe('revised_draft_not_prepared');
    // AMENDED (T4 #2999, DL ruling; old expectation: a PLoT body from these bytes). The saved revised draft holds
    // ‘Campaign execution risk’ on the goal path with no level and no cause. The drafter (f81dfd89) gave the risk no value,
    // and its two incoming links carried no effect (`effect_amount: null`), so none was saved; every other root holds a
    // level. The engine would sample it at 0 (unknown treated as zero), so the real Run loader withholds and asks.
    const RISK = 'campaign_execution_risk';
    expect((stored.nodes as Rec[]).find((n) => n.id === RISK)).toEqual({ id: RISK, kind: 'risk', label: 'Campaign execution risk', provenance: 'ai_inferred' });
    expect((stored.edges as Rec[]).filter((e) => e.to === RISK)).toEqual([]);
    expect((stored.edges as Rec[]).filter((e) => e.from === RISK).map((e) => e.to)).toEqual(['conversion_rate']);
    // AMENDED (DL 15 Oct 23:19Z; AIE #94 6177505214; old expectation: withheld on MISSING_FACTOR_LEVEL for this risk). The risk
    // is Olumi's own suggestion by the drafter's label (`ai_inferred`) and nobody has sized it, so it no longer holds the Run: it
    // is kept in the saved model and left out of the calculation, never sampled at zero, and the host says so in the AIE's words.
    expect(assessCanonicalAnalysisReadiness(stored).blockingIssues).toEqual([]);
    const unsizedBody = await plotBodyFromStore(stored);
    expect((unsizedBody.graph as Rec).nodes.map((n: Rec) => n.id)).not.toContain(RISK);
    // The Run's own body carries the budget as GBP/year once that risk has a level (the original assertion, unchanged).
    const valued = { ...stored, nodes: (stored.nodes as Rec[]).map((n) => (n.id === RISK ? { ...n, observed_state: { value: 0.35, source: 'brief_extraction' } } : n)) };
    const body = await plotBodyFromStore(valued);
    expect((body.goal_constraints as Rec[]).filter((c) => c.constraint_id === SPEND_ID).map((c) => [c.value, c.unit, c.operator]))
      .toEqual([[100000, 'GBP/year', '<=']]);
  });
});

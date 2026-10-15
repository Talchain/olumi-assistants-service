/**
 * ⭐ MA3c — A REVISED DRAFT'S LIMIT THAT CITES THE SAME VERIFIED USER SENTENCE AS A SAVED LIMIT *IS* THE SAVED LIMIT (DL 15 Oct
 * 07:03Z; served widen4 2026-10-15T072000Z and widen3 2026-10-15T070254Z, CEE 87d5f90e).
 *
 * Inputs, byte for byte:
 *   · the served base before turn 02 (`fixtures/marketing-widen{4,3}-served-base.json`: reads/01-02-before-approve.json and
 *     turns/02.json's request);
 *   · the served drafter text for turn 02 (cee_drafter_raw_responses 5e8f1d96 call 1, sha256 9dae44fa…; 64d2ebc4 call 1,
 *     sha256 9facce04…). Each wrote Paul's founder-time and budget limits under NEW names ("Founder time on launch marketing",
 *     "Founder marketing time", "Annual marketing spend") citing the SAME sentences of his brief. `limitsKeptBy` did not see them
 *     as the saved limits: widen4 carried both saved rows unscored (`retained_limit_quantity_unresolved`, the result withheld);
 *     widen3 asked "Do these describe the same limit?" about two readings of one sentence of his.
 * The rule: same verified source statement (same quote and source line, the user's) + same comparator, figure and frame + the
 * same unit through the unit reader (`sameUnitAsEarlier`) = the saved limit. Its id and bindings are kept, no question. A limit
 * from a DIFFERENT sentence, or a unit both state differently, still asks.
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

// The drafter-raw recorder writes its own table; it is a recorder, not logic, so it passes the build straight through.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
type Fixture = { scenario_id: string; brief_text: string; graph_hash: string; graph: Rec; l20: { turn_id: string; message: string } };
const read = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const W4 = JSON.parse(read('marketing-widen4-served-base.json')) as Fixture;
const RAW4 = read('marketing-widen4-drafter-retry-9dae44fa.txt');
const W3 = JSON.parse(read('marketing-widen3-served-base.json')) as Fixture;
const RAW3 = read('marketing-widen3-drafter-retry-9facce04.txt');
const TIME_QUOTE = "I can't spend more than 25% of my time on this, and I'm not that experienced with marketing.";

function server(fx: Fixture) {
  const SID = fx.scenario_id;
  let graph: Rec = structuredClone(fx.graph);
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

function lane(s: ReturnType<typeof server>, raw: string) {
  const proposals = new ProposalStore();
  const call = (async () => ({ text: raw })) as unknown as CallStructuredModel;
  const caps = createAgentCapabilities(s.dispatch, proposals, call, 'full', undefined, {
    readCommittedTurnLedger: s.readCommittedTurnLedger, readStatedObjections: async () => [],
  });
  return { caps, proposals };
}

const turnOf = (fx: Fixture, message = fx.l20.message) => ({ scenario_id: fx.scenario_id, authenticated_user_id: null, request_id: 'req-l20',
  turn_id: fx.l20.turn_id, user_turn_text: message, user_text: `${fx.brief_text}\n${message}` });
const conversionOf = (fx: Fixture) => ({ constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: fx.l20.message });
const pressed = (fx: Fixture, proposalId: string) => ({ scenario_id: fx.scenario_id, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0001', user_turn_text: '', user_text: `${fx.brief_text}\n${fx.l20.message}`, typed_approval_of: proposalId });
const limitRows = (g: Rec): Rec[] => (g.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target' && ['<=', '>='].includes(r.operator)
  && typeof r.label === 'string' && !/conversion|customers/i.test(r.label));
const baseRow = (fx: Fixture, id: string): Rec => structuredClone((fx.graph.goal_constraints as Rec[]).find((r) => r.constraint_id === id)!);
const quotesOn = (g: Rec, nodeId: string): string[] => ((g.nodes as Rec[]).find((n) => n.id === nodeId)?.user_statements ?? [])
  .flatMap((r: Rec) => (r.statements as Rec[]).map((s) => s.quote));

/**
 * One brief: its saved limits' ids, and the redraft's own name for the founder limit (by the same sentence of the user's).
 * `kept` are held by their saved id with no question; `asked` still ask. widen3's saved budget holds NO recorded sentence of the
 * user's (construction recorded none on it), so nothing proves the redraft's budget is the same limit: it is asked, in-capture.
 */
const CASES = [
  { name: 'widen4', fx: W4, raw: RAW4, time: 'agent-lane:founder_time_on_campaign:<=', spend: 'agent-lane:annual_campaign_spend:<=',
    redraftTime: 'Founder time on launch marketing', timeNode: 'founder_time_on_campaign', timeUnit: '% of founder time',
    kept: ['agent-lane:founder_time_on_campaign:<=', 'agent-lane:annual_campaign_spend:<='], asked: [] as string[] },
  { name: 'widen3', fx: W3, raw: RAW3, time: 'agent-lane:user_time_on_campaign:<=', spend: 'agent-lane:total_annual_campaign_investment:<=',
    redraftTime: 'Founder marketing time', timeNode: 'user_time_on_campaign', timeUnit: '%',
    kept: ['agent-lane:user_time_on_campaign:<='], asked: ['agent-lane:total_annual_campaign_investment:<='] },
] as const;

/** The served drafter text with the founder limit's statement and row changed. */
const patched = (raw: string, label: string, patch: { quote?: string; unit?: string }): string => {
  const r = JSON.parse(raw) as Rec;
  if (patch.unit !== undefined) {
    (r.constraints as Rec[]).find((c) => c.metric === label)!.unit = patch.unit;
    for (const f of r.factors as Rec[]) if (f.label === label) f.unit = patch.unit;
  }
  for (const s of r.statements as Rec[]) {
    if (s.subject?.label !== label) continue;
    if (patch.quote !== undefined) s.quote = patch.quote;
    if (patch.unit !== undefined) s.unit = patch.unit;
  }
  return JSON.stringify(r);
};

describe.each(CASES)('MA3c $name: the redraft\'s founder-time and budget limits cite the saved limits\' own sentences', (c) => {
  it('precondition: the saved limit and the redraft\'s renamed limit cite the same sentence of the user\'s brief', () => {
    expect(baseRow(c.fx, c.time)).toMatchObject({ value: 25, operator: '<=', unit: c.timeUnit });
    expect(quotesOn(c.fx.graph, c.timeNode)).toContain(TIME_QUOTE);
    const drafted = JSON.parse(c.raw) as Rec;
    expect((drafted.constraints as Rec[]).find((x) => x.metric === c.redraftTime)).toMatchObject({ value: 25, operator: '<=', role: 'limit' });
    expect((drafted.statements as Rec[]).find((s) => s.subject.label === c.redraftTime)?.quote).toBe(TIME_QUOTE);
  });

  it('⭐ RED→GREEN: the card holds each same-sentence limit by its saved id once, unscored by nothing, with no question about it', async () => {
    const s = server(c.fx);
    const { caps, proposals } = lane(s, c.raw);
    const a = await caps.proposeGoalTarget!(turnOf(c.fx) as never, conversionOf(c.fx) as never) as Rec;
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, mutated: false });
    const card = String(a.public_label);
    const candidate = (proposals.get(String(a.proposal_id))!.operations[0]!.value as Rec).candidate as Rec;
    const rows = limitRows(candidate);
    for (const id of c.kept) {
      const saved = baseRow(c.fx, id);
      expect(rows.filter((r) => r.constraint_id === id), id).toEqual([saved]);
      expect(card, id).not.toContain(`Previous: \u2018${saved.label}\u2019`);
    }
    for (const id of c.asked) {
      expect(rows.filter((r) => r.constraint_id === id).map((r) => r.retained_unresolved_limit?.role), id).toEqual(['original']);
      expect(card).toContain('Do these describe the same limit?');
    }
    if (c.asked.length === 0) {
      expect(card).not.toContain('Do these describe the same limit?');
      expect(card).not.toMatch(/retained|withheld|not scored/i);
      expect((candidate.goal_constraints as Rec[]).some((r) => r.retained_unresolved_limit !== undefined)).toBe(false);
    }
    // Its bindings: the saved node holds the user's sentence and carries the redraft's own mechanism for founder time.
    expect((candidate.nodes as Rec[]).filter((n) => n.id === c.timeNode)).toHaveLength(1);
    expect(quotesOn(candidate, c.timeNode)).toContain(TIME_QUOTE);
    expect((candidate.nodes as Rec[]).some((n) => n.label === c.redraftTime), 'no second node for the same quantity').toBe(false);
    expect(rows.filter((r) => r.value === 25), 'no second row for the same sentence').toHaveLength(1);
    const edges = (candidate.edges as Rec[]).filter((e) => e.from === c.timeNode || e.to === c.timeNode);
    const set = (candidate.nodes as Rec[]).some((n) => n.kind === 'option' && Object.keys(n.interventions ?? {}).includes(c.timeNode));
    expect(edges.length > 0 || set, 'the redraft\'s founder-time mechanism is bound to the saved limit').toBe(true);
    expect(s.graph()).toEqual(c.fx.graph);
  });

  it('real path: card → approve → the saved model holds each same-sentence limit as the user\'s earlier row, scored, once', async () => {
    const s = server(c.fx);
    const { caps } = lane(s, c.raw);
    const a = await caps.proposeGoalTarget!(turnOf(c.fx) as never, conversionOf(c.fx) as never) as Rec;
    s.said(c.fx.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(c.fx, String(a.proposal_id)) as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    expect(s.commits).toHaveLength(1);
    const rows = limitRows(s.graph());
    for (const id of c.kept) {
      expect(rows.filter((r) => r.constraint_id === id).map((r) => [r.value, r.unit, r.retained_unresolved_limit]), id)
        .toEqual([[baseRow(c.fx, id).value, baseRow(c.fx, id).unit, undefined]]);
    }
    expect(rows.filter((r) => r.constraint_id === c.time).map((r) => [r.value, r.unit])).toEqual([[25, c.timeUnit]]);
    expect(rows.filter((r) => r.value === 25)).toHaveLength(1);
    for (const id of c.asked) expect(rows.find((r) => r.constraint_id === id)?.retained_unresolved_limit, id).toBeDefined();
  });

  it('CONTRAST: the same figure from a DIFFERENT sentence of the user\'s, or a unit both state differently, still asks', async () => {
    const other = 'Separately, I can\'t give more than 25% of my week to launch work.';
    const message = `${c.fx.l20.message} ${other}`;
    for (const [what, raw] of [['different sentence', patched(c.raw, c.redraftTime, { quote: other })],
      ['different stated unit', patched(c.raw, c.redraftTime, { unit: '% of revenue' })]] as const) {
      const s = server(c.fx);
      const { caps, proposals } = lane(s, raw);
      const a = await caps.proposeGoalTarget!(turnOf(c.fx, message) as never, { ...conversionOf(c.fx), rationale: message } as never) as Rec;
      const asked = a.ok === true
        ? limitRows((proposals.get(String(a.proposal_id))!.operations[0]!.value as Rec).candidate as Rec)
          .some((r) => r.constraint_id === c.time && r.retained_unresolved_limit !== undefined)
          || String(a.public_label).includes('Do these describe the same limit?')
        : a.refusal === 'revised_draft_not_prepared';
      expect(asked, `${what}: ${JSON.stringify(a).slice(0, 600)}`).toBe(true);
      expect(s.graph()).toEqual(c.fx.graph);
    }
  });
});

/**
 * ⭐ SCIENCE PR-4b — THE USER'S COHORT FORECAST, CAPTURED (AIE same-cohort law; AIE #94 6174707160: no automatic percentile).
 * Marketing's two targets are scored together only on one cohort: the people an option reaches over the window and the range
 * the user says its conversion is as likely to fall inside as outside. These rows run the real capabilities, the real atomic
 * batch writer and a store, on the saved marketing model after L20 (`tests/fixtures/marketing-withheld-once/run-08.json`,
 * `_source`: both target rows and both limits as served), then hand the written option to #3103's Run wire.
 *
 * The user's three sentences are written for this row (Paul's brief states no cohort or conversion range); the readers they
 * exercise are the S2 quote binding and two figure readers, each with refusal contrasts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { targetForecastWireOf } from '../cohort-forecast.js';
import { applyCohortForecastEdit, COHORT_MIDDLE_HALF_QUESTION, percentRangesIn, peopleFiguresIn, storedTargetRowsOf } from '../cohort-forecast-write.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const SID = 'c0f0c0f0-0000-4000-8000-00000000c0f0';
const SAME = 'Yes, the new customers will come from the same people we measure the conversion rate on.';
const PEOPLE = 'Hiring a marketing manager would reach about 500 people in the first three months.';
const RANGE = 'Between 12 and 18%.';
const CONVERSATION = [SAME, PEOPLE, RANGE].join('\n\n');
const PRESS = 'Yes, record that forecast.';
const CONV = 'agent-lane:conversion_rate:>=';
const CUST = 'agent-lane:new_customers_in_first_3_months:>=';

const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;

function world(start: Rec = plain(F.graph)) {
  let json = JSON.stringify(start);
  const graph = (): Rec => JSON.parse(json) as Rec;
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async (write) => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `cf-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: x }) => makeSessionTurnRow({ id, scenario_id: x.scenario_id, turn_id: x.turn_id,
      turn_class: x.turn_class, handler_id: x.handler_id, request_hash: x.request_hash, response_emitted: x.response_emitted, llm_calls_used: x.llm_calls_used, duration_ms: x.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-14T19:30:05.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'cf', requestHash: `cf:${input.turn_id}`,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      cohortForecast: input.cohort_forecast }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      graph_identity_hash: computeGraphIdentityHash(graph() as never), brief_text: null } };
  };
  const proposals = new ProposalStore();
  return { graph, rows, proposals, replace: (g: Rec) => { json = JSON.stringify(g); },
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-14T19:30:00Z') }) };
}
const ctx = (turn: string = RANGE, conversation: string = CONVERSATION): Rec =>
  ({ scenario_id: SID, authenticated_user_id: null, request_id: 'cf', user_text: conversation, user_turn_text: turn });
const args = (over: Rec = {}): Rec => ({
  option_label: 'Hire marketing manager',
  people: { quote: PEOPLE, value: 500 },
  conversion: { quote: RANGE, low: 12, high: 18, answering: COHORT_MIDDLE_HALF_QUESTION },
  same_cohort: { quote: SAME },
  ...over,
});
const option = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === 'hire_marketing_manager');
const press = (w: ReturnType<typeof world>, id: string) =>
  w.caps.authoriseChange({ ...ctx(PRESS), typed_approval_of: id, typed_approval_words: PRESS } as never, { proposal_id: id }) as Promise<Rec>;

describe("the user's cohort forecast: their words → one card → their press → the option holds it → the Run sends it", () => {
  it('PRECONDITION: the saved marketing model holds both targets and no forecast', () => {
    const g = plain(F.graph);
    expect(storedTargetRowsOf(g).map((r) => r.constraint_id)).toEqual([CONV, CUST]);
    expect(option(g)).not.toHaveProperty('cohort_forecast');
  });

  it('RED: the card quotes their words, says the even-chance reading, writes nothing until pressed; the press records it as theirs', async () => {
    const w = world();
    const before = JSON.stringify(w.graph());
    const card = await w.caps.proposeCohortForecast!(ctx() as never, args() as never) as Rec;
    expect(card).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain(`From your messages: ‘${PEOPLE}’ · ‘${RANGE}’ · ‘${SAME}’`);
    expect(card.public_label).toContain('it reaches 500 people over the first three months after launch, and its ‘Conversion rate’ is as likely to fall inside 12–18% as outside it');
    expect(JSON.stringify(w.graph())).toBe(before);
    // Card-only: a typed yes the Agent reads is not the press.
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: card.proposal_id })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(JSON.stringify(w.graph())).toBe(before);
    const res = await press(w, card.proposal_id);
    expect(res).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toBe('Recorded from your words: ‘Hire marketing manager’ reaches 500 people, and its conversion is as likely to fall inside 12–18% as outside it.');
    expect(option(w.graph()).cohort_forecast).toEqual({ people_reached: 500, conversion_middle_half_pct: [12, 18],
      same_cohort: { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' }, author: 'user' });
    // Only that option changed; the targets and limits are as saved.
    expect(storedTargetRowsOf(w.graph())).toEqual(storedTargetRowsOf(plain(F.graph)));
    // #3103's Run wire reads the stored option: ISL gets the user's own figures, in its units.
    expect(targetForecastWireOf(option(w.graph()), storedTargetRowsOf(w.graph()))).toEqual({ law: 'same_cohort_beta_binomial', exposure: 500,
      rate_quartiles: [0.12, 0.18], conditions: [{ constraint_id: CONV, quantity: 'rate', threshold: 0.15 }, { constraint_id: CUST, quantity: 'count', threshold: 20 }] });
  });

  it('CONTRAST: a range not given as the answer to the even-chance question is never read as one: refused, nothing held', async () => {
    const w = world();
    const { answering: _a, ...plainRange } = args().conversion;
    const r = await w.caps.proposeCohortForecast!(ctx() as never, args({ conversion: plainRange }) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'middle_half_not_asked' });
    expect(r.detail).toContain(COHORT_MIDDLE_HALF_QUESTION);
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });

  it('CONTRAST: a figure the quote does not state, words the user never typed, or no same-cohort answer → refused', async () => {
    const w = world();
    const cases: [Rec, string][] = [
      [args({ people: { quote: PEOPLE, value: 600 } }), 'figure_not_in_quote'],
      [args({ conversion: { ...args().conversion, low: 10 } }), 'figure_not_in_quote'],
      [args({ people: { quote: 'It would reach about 500 people.', value: 500 } }), 'statement_not_found'],
      [args({ same_cohort: { quote: 'They are the same people.' } }), 'statement_not_found'],
      [args({ option_label: 'Hire a marketing person' }), 'option_not_found'],
    ];
    for (const [a, refusal] of cases) {
      expect([refusal, (await w.caps.proposeCohortForecast!(ctx() as never, a as never) as Rec).refusal]).toEqual([refusal, refusal]);
    }
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });

  it('CONTRAST: a target changed after the card (15% → 14%) → the press writes nothing', async () => {
    const w = world();
    const card = await w.caps.proposeCohortForecast!(ctx() as never, args() as never) as Rec;
    const moved = w.graph();
    moved.goal_constraints.find((r: Rec) => r.constraint_id === CONV).value = 14;
    w.replace(moved);
    const res = await press(w, card.proposal_id);
    expect(res.ok).toBe(false);
    expect(option(w.graph())).not.toHaveProperty('cohort_forecast');
  });

  it('the writer never writes Olumi\'s figures as this record, nor a range that answered no question', () => {
    const g = plain(F.graph);
    const base = { option_id: 'hire_marketing_manager', expected_node: option(g), expected_targets: storedTargetRowsOf(g) };
    const st = (form: string, extra: Rec) => ({ speaker: 'user', quote: 'q', source: 'q', subject: { quantity: 'x' }, form, reading: 'olumi', ...extra });
    const statements = { people: st('point', { low: 500, high: 500 }), conversion: st('range', { low: 12, high: 18, answering: COHORT_MIDDLE_HALF_QUESTION }),
      same_cohort: st('holds_now', {}) };
    const f = { people_reached: 500, conversion_middle_half_pct: [12, 18],
      same_cohort: { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' }, author: 'user' };
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: f, statements } as never).kind).toBe('mutated');
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: { ...f, author: 'olumi' }, statements } as never)).toEqual({ kind: 'refused', reason: 'invalid_forecast' });
    const noQuestion = { ...statements, conversion: st('range', { low: 12, high: 18 }) };
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: f, statements: noQuestion } as never)).toEqual({ kind: 'refused', reason: 'invalid_forecast' });
  });

  it('the readers: whole people and percentage ranges only', () => {
    expect(peopleFiguresIn(PEOPLE)).toEqual([{ low: 500, high: 500 }]);
    expect(peopleFiguresIn('about 1,200 people')).toEqual([{ low: 1200, high: 1200 }]);
    expect(peopleFiguresIn('a 15% conversion')).toEqual([]);
    expect(percentRangesIn(RANGE)).toEqual([{ low: 12, high: 18 }]);
    expect(percentRangesIn('12–18%')).toEqual([{ low: 12, high: 18 }]);
    expect(percentRangesIn('12% to 18%')).toEqual([{ low: 12, high: 18 }]);
    expect(percentRangesIn('between 12 and 18 people')).toEqual([]);
    expect(percentRangesIn('18–12%')).toEqual([]);
  });
});

/**
 * ⭐ SCIENCE PR-4b — THE USER'S COHORT FORECAST, CAPTURED (AIE same-cohort law; AIE #94 6174707160: no automatic percentile).
 * Marketing's two targets are scored together only on one cohort: the people an option reaches over the window and the user's
 * own two estimates of its underlying conversion rate, one chance in four below and one in four above (AIE 6176433015). These rows run the real capabilities, the real atomic
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
import { applyCohortForecastEdit, cohortQuartileQuestion, percentRangesIn, peopleFiguresIn, storedTargetRowsOf } from '../cohort-forecast-write.js';
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts } from '../../admission/target-testability.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const SID = 'c0f0c0f0-0000-4000-8000-00000000c0f0';
const SAME = 'Yes, the new customers will come from the same people we measure the conversion rate on.';
const PEOPLE = 'Hiring a marketing manager would reach about 500 people in the first three months.';
const RANGE = 'Between 12 and 18%.';
const CONVERSATION = [SAME, PEOPLE, RANGE].join('\n\n');
const PRESS = 'Yes, record that forecast.';
const WINDOW = 'the first three months after launch';
const Q = cohortQuartileQuestion('Hire marketing manager', WINDOW);
/** #3115's even-chance question: 50% coverage, never the quartiles (AIE 6176433015). An answer to it is never re-read. */
const EVEN_CHANCE = 'Which range is the conversion as likely to fall inside as outside (an even chance)?';
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
  conversion: { quote: RANGE, low: 12, high: 18, answering: Q },
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

  it('RED: the card records their answer as their one-in-four estimates in the AIE\'s words, says the Beta curve is Olumi\'s, writes nothing until pressed; the press records it as theirs', async () => {
    const w = world();
    const before = JSON.stringify(w.graph());
    const card = await w.caps.proposeCohortForecast!(ctx() as never, args() as never) as Rec;
    expect(card).toMatchObject({ ok: true, mutated: false });
    expect(Q).toBe('For ‘Hire marketing manager’, among the people it reaches during the first three months after launch, what lower and upper '
      + 'estimates of the underlying conversion rate would leave, in your judgement, about a one-in-four chance that the rate is below the lower '
      + 'estimate and a one-in-four chance that it is above the upper estimate?');
    expect(String(card.public_label).split('\n')).toEqual([
      `From your answer to the question about one chance in four below and one chance in four above: “${RANGE}”. Record your estimates as about `
        + 'one chance in four below 12% and one chance in four above 18% for ‘Hire marketing manager’, among the people it reaches, during the first '
        + 'three months after launch? These are your estimates, not a minimum and maximum.',
      `From your messages: ‘${PEOPLE}’ · ‘${SAME}’. Your forecast is that it reaches 500 people during the first three months after launch, and `
        + '‘New customers in first 3 months’ counts the people who convert among those same people, as you said.',
      // AIE 6180618773 C4: holding the reach fixed is Olumi's explicit conditional scenario, on the card the press adopts.
      'Olumi’s scenario, not yours: the chance is worked out as if exactly 500 people are reached during the first three months after launch; '
        + 'how many it actually reaches may differ, and that uncertainty is not included.',
      'Olumi’s approximation, not yours: the underlying ‘Conversion rate’ is treated as a smooth curve (a Beta distribution) through your two '
        + 'estimates, and each person converts or not at that same chance. If no such curve fits them, no chance is given for this option.',
    ]);
    expect(card.public_label).not.toMatch(/as likely to fall inside|even chance|middle half/);
    expect(JSON.stringify(w.graph())).toBe(before);
    // Card-only: a typed yes the Agent reads is not the press.
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: card.proposal_id })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(JSON.stringify(w.graph())).toBe(before);
    const res = await press(w, card.proposal_id);
    expect(res).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toBe('Recorded from your words: your forecast that ‘Hire marketing manager’ reaches 500 people, with about one chance in four that its '
      + 'underlying conversion rate is below 12% and one in four that it is above 18%.');
    expect(option(w.graph()).cohort_forecast).toEqual({ people_reached: 500, conversion_middle_half_pct: [12, 18],
      same_cohort: { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' }, author: 'user' });
    // Only that option changed; the targets and limits are as saved.
    expect(storedTargetRowsOf(w.graph())).toEqual(storedTargetRowsOf(plain(F.graph)));
    // #3103's Run wire reads the stored option: ISL gets the user's own figures, in its units.
    expect(targetForecastWireOf(option(w.graph()), storedTargetRowsOf(w.graph()))).toEqual({ law: 'same_cohort_beta_binomial', exposure: 500,
      rate_quartiles: [0.12, 0.18], conditions: [{ constraint_id: CONV, quantity: 'rate', threshold: 0.15 }, { constraint_id: CUST, quantity: 'count', threshold: 20 }] });
  });

  it('CONTRAST: a range that is not their answer, this turn, to the one-in-four question for THIS option is never read as quartiles: refused, nothing held', async () => {
    const w = world();
    const { answering: _a, ...plainRange } = args().conversion;
    const cases: [Rec, Rec][] = [
      [ctx(), args({ conversion: plainRange })],
      // #3115's even-chance answer is 50% coverage, not the quartiles: never relabelled (AIE 6176433015).
      [ctx(), args({ conversion: { ...args().conversion, answering: EVEN_CHANCE } })],
      // The question asked for another option, cohort or window is not this option's.
      [ctx(), args({ conversion: { ...args().conversion, answering: cohortQuartileQuestion('Carry on as now', WINDOW) } })],
      [ctx(), args({ conversion: { ...args().conversion, answering: cohortQuartileQuestion('Hire marketing manager', 'the first six months after launch') } })],
      // Their range from an earlier message is kept as they said it; only the message that answers the question binds.
      [ctx(SAME), args()],
    ];
    for (const [c, a] of cases) {
      const r = await w.caps.proposeCohortForecast!(c as never, a as never) as Rec;
      expect(r).toMatchObject({ ok: false, refusal: 'quartiles_not_asked' });
      expect(r.detail).toContain(Q);
      expect(r.detail).toContain('comparable past campaign');
    }
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
    // Same question, other quote marks and spacing: still the question asked.
    const ok = await w.caps.proposeCohortForecast!(ctx() as never, args({ conversion: { ...args().conversion, answering: `  ${Q.replace(/[‘’]/g, "'")} ` } }) as never) as Rec;
    expect(ok).toMatchObject({ ok: true });
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
    const statements = { people: st('point', { low: 500, high: 500 }), conversion: st('range', { low: 12, high: 18, answering: Q }),
      same_cohort: st('holds_now', {}) };
    const f = { people_reached: 500, conversion_middle_half_pct: [12, 18],
      same_cohort: { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' }, author: 'user' };
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: f, statements } as never).kind).toBe('mutated');
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: { ...f, author: 'olumi' }, statements } as never)).toEqual({ kind: 'refused', reason: 'invalid_forecast' });
    const noQuestion = { ...statements, conversion: st('range', { low: 12, high: 18 }) };
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: f, statements: noQuestion } as never)).toEqual({ kind: 'refused', reason: 'invalid_forecast' });
    // A held #3115 card (the even-chance answer) never writes quartiles at the press.
    const evenChance = { ...statements, conversion: st('range', { low: 12, high: 18, answering: EVEN_CHANCE }) };
    expect(applyCohortForecastEdit(g, { ...base, cohort_forecast: f, statements: evenChance } as never)).toEqual({ kind: 'refused', reason: 'invalid_forecast' });
  });

  it('the next step asks only what is still missing: the cohort answer, then the next option\'s forecast, then nothing about the window', () => {
    const forecast = { people_reached: 500, conversion_middle_half_pct: [12, 18],
      same_cohort: { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' }, author: 'user' };
    const stepOf = (g: Rec) => { const parts = untestableTargetParts(g, targetTestabilityOf(g)); return parts === null ? null : targetBlockerOf(parts); };
    const g = plain(F.graph);
    expect(stepOf(g)).toEqual({ kind: 'missing_input', ask: 'Do your ‘New customers in first 3 months’ come from the same people your ‘Conversion rate’ is measured on?' });
    option(g).cohort_forecast = forecast;
    expect(stepOf(g)).toEqual({ kind: 'missing_input', ask: 'For ‘Carry on as now’: how many people would it reach over the first three months after launch? '
      + `${cohortQuartileQuestion('Carry on as now', WINDOW)} Here the underlying conversion rate is the chance that any one of those people converts.` });
    for (const n of g.nodes as Rec[]) if (n.kind === 'option') n.cohort_forecast = forecast;
    // Nothing about the window is asked again; the model's own link gap (case c) is still its own, separate question.
    const parts = untestableTargetParts(g, targetTestabilityOf(g))!;
    expect(parts.clauses.filter((c) => /forecast|same people/.test(c))).toEqual([]);
    expect(stepOf(g)).toEqual({ kind: 'missing_input', ask: 'Roughly how much Conversion rate in % does a change in Launch messaging mismatch bring?' });
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

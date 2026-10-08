/** Paul's served 6582edbc brief; drafter output is stubbed. No LLM, network or DB. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3Schema } from '@talchain/schemas';
import { Graph } from '../../../schemas/graph.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { withShareByDateChanceGate } from '../goal-chance-range.js';
import { goalChanceLicenceOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { loadPersistedGraphStrict, loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { narrateWriteOutcome } from '../../agent-lane/write-outcome.js';
import { shareGoalChanceWords } from '../../agent-lane/goal-chance-screen-lines.js';
import { goalChanceFactsForAgent } from '../goal-chance-range-agent.js';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { buildModelFromBrief, BUILD_INSTRUCTIONS, buildCandidateSchema, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool } from '../../agent-lane/runtime/agent-tools.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { draftedTeamPartOf, eventShareCarrierOf, withEventShareDate, briefAttestsEventByDate, EVENT_WORDS, EVENT_DEADLINE } from '../event-by-date-model.js';
import { shareByDateGoalOf, goalKindOf } from '../goal-kind.js';
import * as shareMath from '../event-by-date-share.js';
import { teamShareMoments, extraShareMoments } from '../event-by-date-share.js';
import { withShareByDateFrame } from '../share-by-date-run.js';
import { decisionInputLines, decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { noDeadEndAsks } from '../../agent-lane/goal-certainty.js';
import { readTeamTime, TEAM_TIME, teamTimeCard, applyTeamShareEdit, type ApprovedTeamTime } from '../team-share-write.js';
import { goalChanceRangeRecordOf } from '../goal-chance-range-record.js';
import { validatedDefinition, endsOfGraph } from '../held-user-links.js';
import { applyAndValidateMutation, mergeMutatedGraphForPersistence } from '../../tools/handlers/d1-shared/apply-graph-mutation.js';
import { commitDirectAnswer } from '../../commit.js';
import { composeDirectAnswerResponse } from '../../compose.js';
import { createRunAnalysisHandler, withholdGoalFiguresForChanceGoal } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
const DATE = '2027-04-07', REF = '2026-10-07', UNIT = '% of the feature launch';
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'the feature launch', metric: 'the feature launch', operator: '>=',
    unit: UNIT, value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null,
    horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 7, lead_months_low: 3, lead_months_high: 5 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
});
const plainGraph = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const admitted = (): Rec => { const a = admitCandidateModel(candidate(), {}, BRIEF); return plainGraph({ nodes: a.nodes, edges: a.edges }); };
const dated = (): Rec => plainGraph(withEventShareDate(admitted(), DATE, REF));
const part = (g: Rec) => draftedTeamPartOf(g)!;
const approved = (g: Rec = dated()): ApprovedTeamTime => ({ goal_id: String(part(g).goal.id), team_id: part(g).team.id,
  low_months: 6, high_months: 10, deadline: DATE, reference_date: REF });
const ctx = (text: string): Rec => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 's2b', user_text: text, user_turn_text: text });
const askContext = { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false, recentReplies: [] };

async function build(c = candidate(), resultOnly = false): Promise<Rec> {
  let saved: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      saved = plainGraph((body as Rec).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = vi.fn(async () => ({ text: JSON.stringify(c) }));
  const r = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call) as Rec;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(call).toHaveBeenCalledOnce();
  expect(saved).toBeDefined();
  return resultOnly ? r : saved!;
}

/** Serialised real batch-store/read-back boundary, with no external I/O. */
function world(initial = dated(), unconfirmFirst = false, now = '2026-10-07T09:13:13Z') {
  let json = JSON.stringify(initial);
  const graph = (): Rec => JSON.parse(json);
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const proposals = new ProposalStore();
  let failedReadbacks = 0, failAfterCommit = false;
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async write => {
      const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `s2b-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id };
    },
    readRecent: async () => rows.map(({ id, write: w }) => makeSessionTurnRow({ id, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => rows.filter(r => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-07T09:14:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const out = await executeOptionInterventionBatch({ scenarioId: SCENARIO, turnId: input.turn_id, requestId: 's2b',
      requestHash: `s2b:${input.turn_id}`, stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false,
      expectedGraphHash: input.base_graph_hash, targets: [], teamTime: input.team_time, goalHorizon: input.goal_horizon }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!,
      receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    expect(out.kind, JSON.stringify(out)).toBe('committed');
    if (out.kind !== 'committed') throw new Error('unverified');
    if (failAfterCommit && commits.length === 1) failedReadbacks = 1;
    if (unconfirmFirst && commits.length === 1) return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async path => {
    if (failedReadbacks > 0) { failedReadbacks--; return { status: 503, json: {} }; }
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never) } };
  };
  return { graph, failNextPostWriteRead: () => { failAfterCommit = true; }, replace: (g: Rec) => { json = JSON.stringify(g); }, rows, commits, proposals, commit,
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit,
      now: () => new Date(now) }) };
}

describe('S2b draft -> canonical forecast parts', () => {
  it('drafter schema/rule and tool registration name the event quantity and estimate', () => {
    const schema = buildCandidateSchema() as Rec;
    expect(schema.properties.goal.properties.kind.anyOf[0].enum).toEqual(['event_by_date']);
    expect(schema.properties.options.items.properties.added_capacity.anyOf[1].required)
      .toEqual(['monthly_share_pct', 'lead_months_low', 'lead_months_high']);
    expect(BUILD_INSTRUCTIONS).toContain('QUANTITY with a deadline');
    expect(AGENT_TOOLS.find(t => t.name === 'propose_team_time')?.parameters.required).toEqual(['low_months', 'high_months']);
  });
  it('served brief + stubbed event drafter: persisted skeleton, then exactly the held canonical sum', async () => {
    const g = await build();
    expect(g).toEqual(admitted());
    expect(part(g).goal).toMatchObject({ goal_threshold_raw: 100, goal_threshold_cap: 100, threshold_source: 'definitional', goal_direction: '>=' });
    expect(part(g).goal.observed_state).toBeUndefined();
    expect(part(g).team.observed_state?.value).toBeUndefined();
    const after = plainGraph(withEventShareDate(g, DATE, REF));
    expect(part(after).goal.label).toBe('Share of the feature launch done by 7 April 2027');
    expect(part(after).team.label).toBe("Share today's team finishes by 7 April 2027");
    const switches = after.nodes.filter((n: Rec) => n.observed_state?.extra_share_by_date);
    expect(switches).toHaveLength(2);
    for (const sw of switches) {
      const c = sw.observed_state.extra_share_by_date;
      expect(c).toEqual({ monthly_share: sw.id === 'event_capacity_1' ? 7 : 10, lead_low: 3, lead_high: 5,
        unit: `${UNIT} per month`, deadline: DATE, reference_date: REF });
      const m = extraShareMoments(c.monthly_share / 100, 6, 3, 5);
      expect(after.edges.find((e: Rec) => e.from === sw.id && e.to === part(after).goal.id)).toMatchObject({
        strength: { mean: m.mean, std: m.sd }, exists_probability: 1, provenance: { magnitude: 'olumi_estimate',
          natural_effect: { amount_unit: UNIT, per_source_change: 1, strength_mean: m.mean } } });
      for (const o of after.nodes.filter((n: Rec) => n.kind === 'option')) {
        expect(o.interventions[sw.id].value).toBe(o.id === sw.id.replace('capacity', 'option') ? 1 : 0);
        expect(after.edges.find((e: Rec) => e.from === o.id && e.to === sw.id)?.strength.mean).toBe(1);
        expect(after.edges.find((e: Rec) => e.from === 'event_decision' && e.to === o.id)?.strength.mean).toBe(1);
      }
    }
    expect(after.edges.find((e: Rec) => e.from === part(after).team.id && e.to === part(after).goal.id)).toMatchObject({
      exists_probability: 1, strength: { mean: 1, std: 0.01 }, provenance: { definitional: true } });
    expect(shareByDateGoalOf(after)).toBeNull();
    const written = applyTeamShareEdit(after, approved(after), computeAnalysisAffectingGraphHash(after as never)!);
    expect(written.kind).toBe('mutated');
    if (written.kind !== 'mutated') throw new Error('refused');
    expect(shareByDateGoalOf(written.mutatedGraph)?.team_part_id).toBe(part(after).team.id);
    expect(withShareByDateFrame(written.mutatedGraph, written.mutatedGraph).nodes.find((n: Rec) => n.id === part(after).goal.id))
      .toMatchObject({ goal_threshold_frame: 'delta', goal_threshold: 1 });
  });
  it('quantity-with-deadline twin stays level; S1 chance guard refuses propagation', () => {
    const c: CandidateModel = { ...candidate(), goal: { metric: 'MRR', value: 150000, unit: 'GBP', operator: '>=', provenance: 'explicit', horizon_months: 6 } };
    const g = admitCandidateModel(c, {}, '£150k MRR by March');
    const goal = g.nodes.find(n => n.kind === 'goal')!;
    expect(goalKindOf(goal)).toBe('level'); expect(goal.goal_threshold_raw).toBe(150000);
    const chance = { nodes: [{ id: 'chance', kind: 'goal', goal_threshold_unit: 'chance of hitting the date' }], edges: [] };
    expect(goalKindOf(chance.nodes[0])).toBe('chance_of_event');
    const out = withholdGoalFiguresForChanceGoal({ option_comparison: [{ option_id: 'hire', probability_of_goal: 0.4 }] }, chance) as Rec;
    expect(out.option_comparison[0].probability_of_goal).toBeUndefined();
  });
  it('date -> team-time: one ask, own deliverable words, replay suppressed, none when held', () => {
    expect(decisionInputAsk(admitted(), askContext)).toContain('What is the deadline');
    const g = dated(), ask = 'How long would the feature launch take with the team you have now?';
    expect(decisionInputLines(g, askContext).filter(s => s.endsWith('?'))).toEqual([ask]);
    expect(decisionInputAsk(g, { ...askContext, recentReplies: [ask] })).toBeNull();
    expect(decisionInputAsk(g, { ...askContext, restingText: 'Anything else?' })).toBeNull();
    const links = g.edges.filter((e: Rec) => e.to === part(g).goal.id);
    expect(noDeadEndAsks(g, links, id => id)?.first).toBeUndefined();
    const written = applyTeamShareEdit(g, approved(g), computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error('refused');
    expect(decisionInputAsk(written.mutatedGraph, askContext)).toBeNull();
    expect(JSON.stringify(decisionInputLines(g, askContext))).not.toContain("today's level");
  });
});

describe('S2b team-time door', () => {
  it.each([['It’ll take 6–10 months', 6, 10], ['6 to 10 months', 6, 10], ['about 8 months', 8, 8]])('THIS message: %s', async (text, low, high) => {
    const w = world();
    const r = await w.caps.proposeTeamTime!(ctx(text) as never, { low_months: low, high_months: high }) as Rec;
    expect(r.ok).toBe(true); expect(r.team_time).toMatchObject({ low_months: low, high_months: high });
    expect(part(w.graph()).team.observed_state?.value).toBeUndefined();
  });
  it.each(['16 months ago we started', '6 developers', 'half a year', 'Yes, use that.', 'recruitment may take over 3 months'])('must not fire: %s', async text => {
    const w = world();
    expect((await w.caps.proposeTeamTime!(ctx(text) as never, { low_months: 6, high_months: 10 }) as Rec).ok).toBe(false);
    expect(w.rows).toHaveLength(0);
  });
  it('exact card + registered dispatch/chips -> approval -> same computed persisted state -> retry unchanged', async () => {
    const w = world();
    const r = await dispatchTool('propose_team_time', JSON.stringify({ low_months: 6, high_months: 10 }), ctx("It'll take 6–10 months") as never, w.caps) as Rec;
    expect(r.public_label).toBe("Use 6–10 months for today's team? By 7 April 2027 that is about 77% of the feature launch.");
    const chips = approvalChipsFor([{ name: 'propose_team_time', ok: true, mutated: false, proposal_id: r.proposal_id }], id => ({ proposal: w.proposals.get(id)!, result: r as never }));
    expect(chips.map(c => c.label)).toEqual(['Yes', 'Change']); expect(chips[0]!.detail).toBe(r.public_label);
    const result = await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: r.proposal_id } as never, { proposal_id: r.proposal_id }) as Rec;
    expect(result).toMatchObject({ ok: true, applied: true });
    const m = teamShareMoments(6, 6, 10), held = part(w.graph()).team.observed_state;
    expect(held).toEqual({ value: m.mean, std: m.sd, raw_value: m.mean * 100, unit: UNIT, cap: 100, source: 'cee_inference',
      stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months', deadline: DATE, reference_date: REF } });
    expect(result.observed_state).toEqual(held); expect(w.rows).toHaveLength(1);
    const retry = await w.commit(w.commits[0]!); expect(retry.status).toBe('committed');
    expect(retry).toMatchObject({ already_applied: true }); expect(w.rows).toHaveLength(1);
    expect(shareByDateGoalOf(w.graph())?.team_part_id).toBe(part(w.graph()).team.id);
    const wire = withShareByDateFrame(w.graph(), w.graph()) as Rec;
    expect(wire.nodes.find((n: Rec) => n.id === part(w.graph()).goal.id).goal_threshold_frame).toBe('delta');
    expect(part(w.graph()).goal.goal_threshold_frame).toBe('level');
    expect(MUTATION_TOOLS).toContain('propose_team_time');
  });
  it('an unconfirmed landed write can retry this same proposal, with one append', async () => {
    const w = world(dated(), true);
    const r = await w.caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(w.rows).toHaveLength(1);
  });
  it('stale approval and stale writer refuse; no earlier message can supply the figures', async () => {
    const w = world();
    const prior = { ...ctx('Yes'), user_text: 'It takes 6–10 months. Yes.' };
    expect((await w.caps.proposeTeamTime!(prior as never, { low_months: 6, high_months: 10 }) as Rec).ok).toBe(false);
    const r = await w.caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    const g = w.graph(); g.edges.find((e: Rec) => e.from === 'event_capacity_1' && e.to === 'event_goal').strength.mean = 0.4; w.replace(g);
    expect((await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: r.proposal_id } as never, { proposal_id: r.proposal_id }) as Rec).ok).toBe(false);
    expect(applyTeamShareEdit(g, approved(g), r.base_revision)).toEqual({ kind: 'refused', reason: 'stale_graph' });
    expect(w.rows).toHaveLength(0);
  });
  it('S1 deadline approval materialises dates before the team-time door can fire', async () => {
    const w = world(admitted());
    expect((await w.caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec).refusal).toBe('deadline_not_held');
    const r = await w.caps.proposeGoalDeadline!(ctx('The deadline is 6 months away.') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
    expect((await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: r.proposal_id } as never, { proposal_id: r.proposal_id }) as Rec).ok).toBe(true);
    expect(w.graph()).toEqual(dated());
  });
  it('TEAM_TIME whitespace 5k -> 20k timing row <8x', () => {
    const elapsed = (n: number) => { const input = ' '.repeat(n), start = performance.now();
      for (let i = 0; i < 10000; i++) { TEAM_TIME.lastIndex = 0; TEAM_TIME.test(input); } return performance.now() - start; };
    elapsed(5000); elapsed(20000);
    const small = elapsed(5000), large = elapsed(20000);
    process.stdout.write(`TEAM_TIME whitespace ms ${JSON.stringify({ small, large, growth: large / small })}\n`);
    expect(large / small).toBeLessThan(8);
    expect(readTeamTime(' '.repeat(20000))).toBeNull();
  });
});


describe('R2 identity-bound regression rows', () => {
  it.each(['Deliver 100 tickets by March', 'Ship 12 reports by March', 'Reach 500 accounts by March for the launch', 'Launch by March; goal: reach 100 contracts'])('P1-1 arbitrary quantity-unit goal twin: %s', brief => {
    const c = candidate(); c.goal.metric = brief;
    const control = structuredClone(c); delete control.goal.kind;
    expect(() => admitCandidateModel(c, {}, brief)).toThrow('event_goal_needs_redraft');
    expect(admitCandidateModel(control, {}, brief).nodes).toBeDefined();
  });
  it('P1-1 an event elsewhere in the brief does not attest a productivity goal', () => {
    const c = candidate(); c.goal.metric = 'productivity';
    const control = structuredClone(c); delete control.goal.kind;
    const brief = 'Our goal is to increase productivity. We have a feature launch deadline.';
    expect(() => admitCandidateModel(c, {}, brief)).toThrow('event_goal_needs_redraft');
    expect(admitCandidateModel(control, {}, brief).nodes).toBeDefined();
  });
  it('P1-1 admission regex near-miss 5k -> 20k timing rows <8x', () => {
    for (const regex of [EVENT_WORDS, EVENT_DEADLINE]) {
      const elapsed = (n: number) => { const input = '9 '.repeat(n), start = performance.now();
        for (let i = 0; i < 1000; i++) regex.test(input); return performance.now() - start; };
      elapsed(5000); elapsed(20000);
      const small = elapsed(5000), large = elapsed(20000);
      process.stdout.write(`admission regex ${regex.source} ms ${JSON.stringify({ small, large, growth: large / small })}\n`);
      expect(large / small).toBeLessThan(8);
    }
  });
  it.each(['£150k MRR by March', 'increase productivity', 'Launch by March; goal: £150k MRR by March', 'Reach 500 customers by March'])('P1-1 flagged quantity/non-event uses normal admission: %s', brief => {
    const c = candidate(); c.goal.metric = brief;
    const control = structuredClone(c); delete control.goal.kind;
    expect(() => admitCandidateModel(c, {}, brief)).toThrow('event_goal_needs_redraft');
    expect(admitCandidateModel(control, {}, brief).nodes).toBeDefined();
  });
  it('P1-2 missing capacity keeps option-scoped start gap and withholds only that chance', () => {
    const c = candidate(); c.options[0]!.added_capacity = null;
    const a = admitCandidateModel(c, {}, BRIEF);
    const g = plainGraph(withEventShareDate({ nodes: a.nodes, edges: a.edges }, DATE, REF));
    const write = applyTeamShareEdit(g, approved(g), computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('refused');
    const out = withShareByDateChanceGate({ option_comparison: [
      { option_id: 'event_option_1', probability_of_goal: 0.3 },
      { option_id: 'event_option_2', probability_of_goal: 0.4 },
      { option_id: 'event_option_3', probability_of_goal: 0.02 },
    ] }, write.mutatedGraph, 'event_goal') as Rec;
    expect(out.inference_warnings).toContainEqual(expect.objectContaining({ code: 'GOAL_FIGURES_SHARE_APPROXIMATION',
      option_ids: ['event_option_1'], message: "This doesn't yet model when new people start contributing, which decides a deadline. When would they start?" }));
    expect(out.option_comparison[0].probability_of_goal).toBeUndefined();
    expect(out.option_comparison[1].probability_of_goal).toBe(0.4);
    expect(JSON.stringify(out.inference_warnings.filter((w: Rec) => w.code === 'GOAL_CHANCE_RANGE'))).not.toContain('event_option_1');
    expect(goalChanceLicenceOf({ option_comparison: [{ option_id: 'event_option_1', probability_of_goal: 0.3 },
      { option_id: 'event_option_2', probability_of_goal: 0.4 }] }, write.mutatedGraph, 'event_goal')?.pct_by_option).toEqual({ event_option_2: 40 });
  });
  it.each(['between 6 and 10 months', '6—10 months', '6 - 10 months', '6–10 months', '6 to 10 months'])('P1-3 whole range: %s', words => {
    expect(readTeamTime(words)).toEqual({ low_months: 6, high_months: 10 });
  });
  it.each(['about 8 months', 'around 8 months', 'roughly 8 months'])('P1-3 whole approximation: %s', words => {
    expect(readTeamTime(words)).toEqual({ low_months: 8, high_months: 8 });
  });
  it.each(['6 / 10 months', '6 or 10 months', '6 months to 10 months', '6—10 months ago',
    'between 6 and 10 months away', 'around 8 months ago', 'roughly 8 months away', '6 - 10 months notice',
    'between 6 and 10 months onboarding', '6 to 10 months recruitment'])('P1-3 must not suffix: %s', words => {
    expect(readTeamTime(words)).toBeNull();
  });
  it('P1-4 renamed team durable identity survives every S2a parse hop and snapshot', async () => {
    const g = dated(), a = approved(g);
    const write = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('refused');
    const renamed = write.mutatedGraph; renamed.nodes.find((n: Rec) => n.id === a.team_id).label = 'Remaining team work';
    const edge = renamed.edges.find((e: Rec) => e.from === a.team_id && e.to === a.goal_id);
    expect(edge.provenance.share_by_date).toMatchObject({ role: 'team', deliverable: 'the feature launch' });
    let current = renamed;
    for (const parse of [GraphV3.parse.bind(GraphV3), GraphV3Schema.parse.bind(GraphV3Schema), GraphStateIngressSchema.parse.bind(GraphStateIngressSchema), Graph.parse.bind(Graph)]) {
      current = parse(current) as Rec;
      expect(draftedTeamPartOf(current)?.team.id).toBe(a.team_id);
      expect(shareByDateGoalOf(current)?.team_part_id).toBe(a.team_id);
      expect(current.edges.find((e: Rec) => e.from === a.team_id && e.to === a.goal_id).provenance.share_by_date).toEqual(edge.provenance.share_by_date);
    }
    current = projectGraphForPersistence(GraphV3.parse(current)) as Rec;
    const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: current, briefText: null }), loadGraph: async () => current };
    const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'r2', store as never);
    expect(shareByDateGoalOf(snap.rawPersistedGraph)?.team_part_id).toBe(a.team_id);
  });
  it('P1-4 unrecognisable forecast withholds instead of licensing a level', () => {
    const g = dated(), a = approved(g), write = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('refused');
    const broken = write.mutatedGraph;
    broken.edges.find((e: Rec) => e.from === a.team_id && e.to === a.goal_id).strength.mean = 0.7;
    expect(shareByDateGoalOf(broken)).toBeNull();
    const raw = { option_comparison: [{ option_id: 'event_option_2', probability_of_goal: 0.4 }] };
    expect((withShareByDateChanceGate(raw, broken, a.goal_id) as Rec).option_comparison[0].probability_of_goal).toBeUndefined();
    expect(goalChanceLicenceOf(raw, broken, a.goal_id)).toBeNull();
  });
  it('P1-5 later deadline approval preserves each estimate reference date', async () => {
    const g = dated(), a = approved(g), write = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('refused');
    const w = world(write.mutatedGraph, false, '2026-11-07T09:13:13Z');
    const proposal = await w.caps.proposeGoalDeadline!(ctx('The deadline is 7 May 2027.') as never, { deadline_words: '7 May 2027', rationale: '' }) as Rec;
    expect(proposal.ok).toBe(true);
    expect(await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: proposal.proposal_id } as never, { proposal_id: proposal.proposal_id })).toMatchObject({ ok: true, applied: true });
    const later = w.graph();
    expect(part(later).team.observed_state.stated_time.reference_date).toBe(REF);
    expect(part(later).team.observed_state.value).toBeCloseTo(teamShareMoments(7, 6, 10).mean, 12);
    for (const n of later.nodes.filter((n: Rec) => n.observed_state?.extra_share_by_date)) {
      expect(n.observed_state.extra_share_by_date.reference_date).toBe(REF);
      const m = extraShareMoments(n.observed_state.extra_share_by_date.monthly_share / 100, 7, 3, 5);
      expect(later.edges.find((e: Rec) => e.from === n.id && e.to === 'event_goal').strength.mean).toBeCloseTo(m.mean, 12);
    }
  });
  it('P1-6 unconfirmed deadline forecast lands once and same proposal retry succeeds', async () => {
    const w = world(admitted(), true);
    const r = await w.caps.proposeGoalDeadline!(ctx('The deadline is 6 months away.') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(w.rows).toHaveLength(1); expect(w.commits).toHaveLength(2);
  });
  it('P2-7 shows Olumi estimates on added-capacity chance lines, absent on carry-on', async () => {
    const c = { ...candidate(), unknowns: ['What evidence supports the productivity assumption?', 'Lead time is an Olumi estimate.'] };
    const r = await build(c, true);
    expect(r.open_questions).toContain('What evidence supports the productivity assumption?');
    expect(r.open_questions).toContain('Lead time is an Olumi estimate.');
    expect(r.open_questions[0]).toContain('What is the deadline');
    const narration = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as never]).status!;
    expect(narration).toContain('What is the deadline');
    expect(narration).not.toContain('What evidence supports');
    const g = dated(), write = applyTeamShareEdit(g, approved(g), computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('No team range');
    const raw = withShareByDateChanceGate({ option_comparison: [
      { option_id: 'event_option_1', probability_of_goal: 0.25 },
      { option_id: 'event_option_2', probability_of_goal: 0.390 },
      { option_id: 'event_option_3', probability_of_goal: 0.0199 },
    ] }, write.mutatedGraph, 'event_goal');
    const lines = goalChanceScreenLinesForAgent({ enrichment: withGoalChanceLicence(raw, write.mutatedGraph, 'event_goal') }, write.mutatedGraph, true);
    expect(lines.find(l => l.option_id === 'event_option_2')?.chance).toContain("using Olumi's estimates of hiring time (3–5 months) and the new team's pace (10% of the feature launch a month)");
    expect(lines.find(l => l.option_id === 'event_option_1')?.chance).toContain("Olumi's estimates");
    expect(lines.find(l => l.option_id === 'event_option_3')?.chance).not.toContain("Olumi's estimates");
  });
  it('WORDS share range names the deliverable and date in screen and chat', () => {
    const graph = { nodes: [{ id: 'o', kind: 'option', label: 'Carry on as now' },
      { id: 'team', label: 'Team work', observed_state: { stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months' } } },
      { id: 'goal', label: 'Feature launch' }] };
    const result = { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.', option_ids: ['o'],
      target: { comparator: 'at_least', value: 100, unit: UNIT, by_date: DATE }, range_by_option: { o: { kind: 'stated_time', basis: 'stated_time',
        quantity: 'months_to_finish', stated_estimate: { low: 6, high: 10, unit: 'months' }, low: 0.2, high: 0.8, low_pct: 20, high_pct: 80, low_rounding: 'whole', high_rounding: 'whole', from: 'team', to: 'goal', among: 'all' } } }] };
    expect(shareGoalChanceWords('the feature launch', DATE)).toBe('chance of launching by 7 April 2027');
    expect(goalChanceFactsForAgent(result, graph, true).goal_chance_range_display?.o.stated_time?.chance_words).toBe(shareGoalChanceWords('the feature launch', DATE));
    expect(goalChanceScreenLinesForAgent(result, graph, true)[0]!.chance).toBe('‘Carry on as now’: between about 20% and 80% chance of launching by 7 April 2027, in this model, from the slow end of your 6–10 months to the fast end.');
  });
});

// R3 base identity: dl/goals-s2b-share-drafter @ 62603856286bcfb3ac37f88da18f8f0dafce7e56 (PR #2762).
describe('R3 identity-bound RED rows', () => {
  const withCausalContext = (c: CandidateModel): CandidateModel => ({ ...c,
    factors: [{ label: 'Team size', role: 'controllable', baseline_known: false, baseline_value: 5,
      unit: 'people', plausible_max: 10, provenance: 'ai_proposed' }],
    links: [{ from: 'Team size', to: c.goal.metric, direction: 'positive', provenance: 'ai_proposed' }],
    options: c.options.map((o, i) => ({ ...o, ...(o.is_status_quo ? {} : {
      interventions: [{ factor_label: 'Team size', value: 6 + i, unit: 'people', provenance: 'ai_proposed' }],
    }) })),
  });
  it('P1-A deadline alone is normal admission; feature-launch deadline is an event', () => {
    const empty = candidate(); empty.goal.metric = 'Improve productivity by the next deadline'; empty.goal.deliverable = 'productivity';
    // An unattested event skeleton must redraft (Lens 3 P1-3); normal admission needs its causal model.
    expect(() => admitCandidateModel(empty, {}, empty.goal.metric)).toThrow('event_goal_needs_redraft');
    const c = withCausalContext(empty);
    const normal = structuredClone(c); delete normal.goal.kind;
    const a = admitCandidateModel(c, {}, c.goal.metric);
    expect(a).toEqual(admitCandidateModel(normal, {}, c.goal.metric));
    const factor = a.nodes.find(n => n.kind === 'factor' && n.label === 'Team size')!;
    const goal = a.nodes.find(n => n.kind === 'goal')!;
    expect(factor).toBeDefined(); expect(a.edges).toContainEqual(expect.objectContaining({ from: factor.id, to: goal.id }));
    expect(admitCandidateModel(candidate(), {}, BRIEF).nodes.find(n => n.kind === 'goal')).toMatchObject({ threshold_source: 'definitional' });
  });
  it('P2-B ship the app on time attests deliverable words in its event sentence', () => {
    const c = candidate(); c.goal.metric = 'the app'; c.goal.deliverable = 'the app';
    expect(admitCandidateModel(c, {}, 'ship the app on time').nodes.find(n => n.kind === 'goal')).toMatchObject({ threshold_source: 'definitional', goal_threshold_unit: '% of the app' });
    const unrelated = 'Ship the report on time. The app is useful.';
    expect(() => admitCandidateModel(c, {}, unrelated)).toThrow('event_goal_needs_redraft');
    const causal = withCausalContext(c), normal = structuredClone(causal); delete normal.goal.kind;
    const a = admitCandidateModel(causal, {}, unrelated);
    expect(a).toEqual(admitCandidateModel(normal, {}, unrelated));
    const factor = a.nodes.find(n => n.kind === 'factor' && n.label === 'Team size')!;
    const goal = a.nodes.find(n => n.kind === 'goal')!;
    expect(factor).toBeDefined(); expect(a.edges).toContainEqual(expect.objectContaining({ from: factor.id, to: goal.id }));
  });
  const heldMissing = () => {
    const c = candidate(); c.options[0]!.added_capacity = null;
    const a = admitCandidateModel(c, {}, BRIEF);
    const g = plainGraph(withEventShareDate({ nodes: a.nodes, edges: a.edges }, DATE, REF));
    const write = applyTeamShareEdit(g, approved(g), computeAnalysisAffectingGraphHash(g as never)!);
    if (write.kind !== 'mutated') throw new Error('refused');
    return write.mutatedGraph;
  };
  const teamEdge = (g: Rec) => g.edges.find((e: Rec) => e.from === 'event_team' && e.to === 'event_goal');
  it('P1-C forge unresolved [] moves analysis hash and generic mutation refuses it', () => {
    const g = heldMissing(), forged = structuredClone(g);
    teamEdge(forged).provenance.share_by_date.unresolved_option_ids = [];
    expect(computeAnalysisAffectingGraphHash(forged as never)).not.toBe(computeAnalysisAffectingGraphHash(g as never));
    expect(() => applyAndValidateMutation(g, clone => { teamEdge(clone).provenance.share_by_date.unresolved_option_ids = []; return { before: null, after: null }; })).toThrow(/share_by_date/);
  });
  it('P1-C dropped carrier with matching quantity labels is withheld, never level', () => {
    const g = heldMissing(); delete teamEdge(g).provenance.share_by_date;
    g.nodes.find((n: Rec) => n.id === 'event_team').label = 'Share of the feature launch';
    g.nodes.find((n: Rec) => n.id === 'event_goal').label = 'Share of the feature launch';
    expect(shareByDateGoalOf(g)).toBeNull();
    const raw = { option_comparison: [{ option_id: 'event_option_1', probability_of_goal: 0.3 }] };
    expect((withShareByDateChanceGate(raw, g, 'event_goal') as Rec).option_comparison[0].probability_of_goal).toBeUndefined();
    expect(goalChanceLicenceOf(raw, g, 'event_goal')).toBeNull();
  });
  it('P1-C minted endpoint mismatch and missing actual node are not recognised', () => {
    const g = heldMissing(), e = teamEdge(g);
    e.provenance.share_by_date.team_id = 'event_capacity_2';
    expect(draftedTeamPartOf(g)).toBeNull(); expect(shareByDateGoalOf(g)).toBeNull();
    expect(validatedDefinition(e, endsOfGraph(g)(e))).toBeUndefined();
    e.provenance.share_by_date.team_id = e.from;
    g.nodes = g.nodes.filter((n: Rec) => n.id !== e.from);
    expect(validatedDefinition(e, endsOfGraph(g)(e))).toBeUndefined();
  });
  it.each(['forge', 'drop'])('P1-C generic mutation refuses %s carrier independently of hash', mode => {
    const g = heldMissing();
    expect(() => applyAndValidateMutation(g, clone => {
      if (mode === 'forge') teamEdge(clone).provenance.share_by_date.unresolved_option_ids = [];
      else delete teamEdge(clone).provenance.share_by_date;
      return { before: null, after: null };
    })).toThrow(/share_by_date/);
  });
  it.each(['forge', 'drop', 'new', 'remove edge'])('P1-C generic D1 persisted merge refuses %s carrier', mode => {
    const base = heldMissing(), next = structuredClone(base);
    if (mode === 'forge') teamEdge(next).provenance.share_by_date.unresolved_option_ids = [];
    if (mode === 'drop') delete teamEdge(next).provenance.share_by_date;
    if (mode === 'new') next.edges.find((e: Rec) => e.from === 'event_capacity_2' && e.to === 'event_goal').provenance.share_by_date = teamEdge(base).provenance.share_by_date;
    if (mode === 'remove edge') next.edges = next.edges.filter((e: Rec) => e !== teamEdge(next));
    expect(() => mergeMutatedGraphForPersistence({ mutatedGraph: next, persistedBase: base, requestId: 'r3', scenarioId: SCENARIO })).toThrow(/share_by_date/);
  });
  it.each(['forge', 'drop'])('P1-C generic commit refuses %s carrier before append', async mode => {
    const base = heldMissing(), next = structuredClone(base), append = vi.fn(async () => ({ id: 'bad' }));
    if (mode === 'forge') teamEdge(next).provenance.share_by_date.unresolved_option_ids = [];
    else delete teamEdge(next).provenance.share_by_date;
    const store = createMockSessionStore({ loadGraph: async () => base, append, readMostRecentPendingActions: async () => [] });
    await expect(commitDirectAnswer(composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Changed', stage: 'frame' }), {
      scenario_id: SCENARIO, turn_id: 'r3-commit', turn_class: 'direct_answer', handler_id: null, request_hash: 'r3', llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: next,
    }, store)).rejects.toThrow(/share_by_date/);
    expect(append).not.toHaveBeenCalled();
  });
  it.each([false, true])('P1-D deadline lands then read-back fails; unconfirmed=%s retry succeeds once', async unconfirmed => {
    const w = world(admitted(), unconfirmed); w.failNextPostWriteRead();
    const r = await w.caps.proposeGoalDeadline!(ctx('The deadline is 6 months away.') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, already_applied: true });
    expect(w.rows).toHaveLength(1);
  });
  it.each(['months_to_finish', 'share_per_month'])('DGAI stated_time record requires original stated_estimate: %s', quantity => {
    const g = heldMissing(), team = g.nodes.find((n: Rec) => n.id === 'event_team');
    if (quantity === 'months_to_finish') {
      const m = teamShareMoments(6, 4, 10);
      team.observed_state = { ...team.observed_state, value: m.mean, std: m.sd, raw_value: m.mean * 100,
        stated_time: { ...team.observed_state.stated_time, low: 4, high: 10 } };
    } else {
      const low = 8, high = 20, mean = 6 * (low + high) / 200, sd = 6 * (high - low) / 100 / Math.sqrt(12);
      team.observed_state = { ...team.observed_state, value: mean, std: sd, raw_value: mean * 100,
        stated_time: { quantity, low, high, unit: `${UNIT} per month`, deadline: DATE, reference_date: REF } };
    }
    const out = withShareByDateChanceGate({ option_comparison: [{ option_id: 'event_option_3', probability_of_goal: 0.4 }] }, g, 'event_goal') as Rec;
    const record = out.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_RANGE');
    const stated = team.observed_state.stated_time;
    expect(record.range_by_option.event_option_3.stated_estimate).toEqual({ low: stated.low, high: stated.high, unit: stated.unit });
    expect(goalChanceRangeRecordOf(record)).toBeDefined();
    const broken = structuredClone(record); delete broken.range_by_option.event_option_3.stated_estimate;
    expect(goalChanceRangeRecordOf(broken)).toBeUndefined();
    for (const estimate of [{ low: 10, high: 6, unit: 'months' }, { low: 6, high: 10, unit: '%' }, { low: -1, high: 10, unit: stated.unit }]) {
      broken.range_by_option.event_option_3.stated_estimate = estimate;
      expect(goalChanceRangeRecordOf(broken)).toBeUndefined();
    }
  });
});

describe('R3 carrier ownership and licence recovery controls', () => {
  // Scoped (lane review of r3): an unreadable base refuses only a write that CARRIES a carrier (it could be forged).
  // A write with none lands as before (commit-assigns-refs-without-a-base CONTROL, unchanged); a carrier it dropped
  // leaves the forecast unrecognisable, which S2a withholds (row "dropped carrier … is withheld, never level").
  it.each([
    ['carries a carrier', false, true],
    ['carries none (the carrier was dropped)', true, false],
  ] as const)('P1-C unavailable server read: a write that %s', async (_case, drop, refused) => {
    const next = dated(); if (drop) delete next.edges.find((e: Rec) => e.from === 'event_team').provenance.share_by_date;
    const append = vi.fn(async () => ({ id: 'ok' }));
    const store = createMockSessionStore({ loadGraph: async () => { throw new Error('unavailable'); }, append, readMostRecentPendingActions: async () => [] });
    const write = commitDirectAnswer(composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Changed', stage: 'frame' }), {
      scenario_id: SCENARIO, turn_id: 'r3-read-failure', turn_class: 'direct_answer', handler_id: null, request_hash: 'r3', llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: next,
    }, store);
    if (refused) { await expect(write).rejects.toThrow(/share_by_date/); expect(append).not.toHaveBeenCalled(); return; }
    await write.catch(() => undefined);
    expect(shareByDateGoalOf(next)).toBeNull();
  });
  it('DGAI shared validator rejects missing stated_estimate independently of producer', () => {
    const entry = { kind: 'stated_time', basis: 'stated_time', quantity: 'months_to_finish', low: 0.2, high: 0.8,
      low_pct: 20, high_pct: 80, low_rounding: 'whole', high_rounding: 'whole', from: 'event_team', to: 'event_goal', among: 'all' };
    const record = { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.', option_ids: ['event_option_3'], range_by_option: { event_option_3: entry } };
    expect(goalChanceRangeRecordOf(record)).toBeUndefined();
  });
  it.each(['same hash label', 'analysis change'])('P1-D recovery never accepts an unrelated %s', async change => {
    const w = world(admitted()); w.failNextPostWriteRead();
    const r = await w.caps.proposeGoalDeadline!(ctx('The deadline is 6 months away.') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id });
    const other = w.graph();
    if (change === 'same hash label') other.nodes.find((n: Rec) => n.id === 'event_option_1').label = 'Another choice';
    else other.edges.find((e: Rec) => e.from === 'event_capacity_1' && e.to === 'event_goal').strength.mean = 0.4;
    w.replace(other);
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: false, applied: false, refusal: 'superseded' });
    expect(w.rows).toHaveLength(1); expect(w.commits).toHaveLength(1);
  });
});

it('R3 event-span tokenisation 5k -> 20k timing row <8x', () => {
  const c = candidate(); c.goal.metric = 'the app'; c.goal.deliverable = 'the app';
  const elapsed = (n: number) => {
    const prefix = 'ship the app on time ', input = prefix + 'x'.repeat(n - prefix.length), start = performance.now();
    for (let i = 0; i < 1000; i++) briefAttestsEventByDate(input, c.goal);
    return performance.now() - start;
  };
  elapsed(5000); elapsed(20000);
  const small = elapsed(5000), large = elapsed(20000);
  process.stdout.write(`event-span tokenisation ms ${JSON.stringify({ small, large, growth: large / small })}\n`);
  expect(large / small).toBeLessThan(8);
});


describe('DL accepted root rows and controls', () => {
  it.each([[4, 8, 93], [3, 9, 91]])('S3-card-and-confirmation-capped %s–%s -> %s with uncapped control', (low, high, pct) => {
    const g = dated(), a = { ...approved(g), low_months: low, high_months: high };
    expect(teamTimeCard(a, UNIT, part(g).deliverable)).toContain(`about ${pct}%`);
    const out = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error('No write');
    expect(out.confirmation).toContain(`about ${pct}%`);
    expect(part(out.mutatedGraph).team.observed_state.value).toBeCloseTo(teamShareMoments(6, low, high).mean, 12);
    const modelBeforeCard = JSON.stringify(out.mutatedGraph);
    const pog = JSON.stringify(withShareByDateChanceGate({ option_comparison: [{ option_id: 'event_option_2', probability_of_goal: 0.390 }] }, out.mutatedGraph, 'event_goal'));
    teamTimeCard(a, UNIT, part(g).deliverable);
    expect(JSON.stringify(out.mutatedGraph)).toBe(modelBeforeCard);
    expect(JSON.stringify(withShareByDateChanceGate({ option_comparison: [{ option_id: 'event_option_2', probability_of_goal: 0.390 }] }, out.mutatedGraph, 'event_goal'))).toBe(pog);
    const uncappedDisplay = vi.spyOn(shareMath, 'cappedTeamShareMean').mockImplementation((D, a, b) => teamShareMoments(D, a, b).mean);
    try {
      const uncapped = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
      if (uncapped.kind !== 'mutated') throw new Error('No control write');
      expect(JSON.stringify(uncapped.mutatedGraph)).toBe(modelBeforeCard);
      expect(JSON.stringify(withShareByDateChanceGate({ option_comparison: [{ option_id: 'event_option_2', probability_of_goal: 0.390 }] }, uncapped.mutatedGraph, 'event_goal'))).toBe(pog);
    } finally { uncappedDisplay.mockRestore(); }
  });
  it('S1-single-most-likely-range-pending with range control', async () => {
    const w = world(), r = await w.caps.proposeTeamTime!(ctx('about 6 months') as never, { low_months: 6, high_months: 6 }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    const saved = await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id }) as Rec;
    expect(saved.ok).toBe(true);
    expect(eventShareCarrierOf(w.graph())!.provenance.share_by_date.stated_time).toMatchObject({ most_likely: 6, quantity: 'months_to_finish' });
    expect(part(w.graph()).team.observed_state).toBeUndefined();
    const parsed = GraphV3.parse(w.graph());
    expect(eventShareCarrierOf(parsed)!.provenance.share_by_date.stated_time).toMatchObject({ most_likely: 6 });
    const store = createMockSessionStore({ loadGraph: async () => w.graph(), loadGraphAndBriefText: async () => ({ graph: w.graph(), briefText: null }) });
    // Persistence reload must retain the estimate; a Run snapshot must remain refused until the range arrives.
    const reloaded = GraphV3.parse(await loadPersistedGraphStrict(SCENARIO, store));
    expect(eventShareCarrierOf(reloaded)!.provenance.share_by_date.stated_time).toMatchObject({ most_likely: 6 });
    const run = vi.fn(), handler = createRunAnalysisHandler({ plotClient: { run } as never,
      scenarioReader: (id: string) => loadScenarioSnapshotForRunAnalysis(id, 'single-run', store) });
    await expect(handler({ context: { session_id: SCENARIO },
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'single-run', signal: new AbortController().signal } as never)).rejects.toMatchObject({
      cause_kind: 'analysis_not_ready', details: { reason_code: 'team_time_range_required',
        next_step: 'Not shown. Add the soonest and latest times with the team you have now; your most likely time is not a range.' },
    });
    expect(run).not.toHaveBeenCalled();
    const ask = 'Roughly how long could it take at the soonest, and at the latest, with the team you have now?';
    expect(saved.follow_up).toBe(ask);
    expect(decisionInputAsk(w.graph(), askContext)).toBe(ask);
    expect(decisionInputAsk(w.graph(), { ...askContext, recentReplies: [ask] })).toBeNull();
    const held = await w.caps.proposeTeamTime!(ctx('about 6 months') as never, { low_months: 6, high_months: 6 }) as Rec;
    expect(held.refusal).toBe('already_held'); expect(held.detail).toContain('soonest and latest');
    const range = await w.caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    expect((await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: range.proposal_id } as never, { proposal_id: range.proposal_id }) as Rec).ok).toBe(true);
    expect(part(w.graph()).team.observed_state.stated_time).toMatchObject({ low: 6, high: 10 });
    expect(eventShareCarrierOf(w.graph())!.provenance.share_by_date.stated_time).toBeUndefined();
    expect(decisionInputAsk(w.graph(), askContext)).toBeNull();
    const rangeSnapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'range-reload', store);
    expect(part(rangeSnapshot.rawPersistedGraph as Rec).team.observed_state.stated_time).toMatchObject({ low: 6, high: 10 });
  });
  it('P1-B-refusal-recovery-words with accepted control', async () => {
    const notStated = await world().caps.proposeTeamTime!(ctx('soon') as never, { low_months: 6, high_months: 10 }) as Rec;
    const noDate = await world(admitted()).caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    const passed = await world(dated(), false, '2028-01-01').caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    for (const r of [notStated, noDate, passed]) { expect(r.ok).toBe(false); expect(r.detail).toMatch(/Type|type/); }
    expect((await world().caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec).ok).toBe(true);
  });
  it('P2-one-team-proposal-and-change-words with separate deadline control', async () => {
    const w = world();
    const a = await w.caps.proposeTeamTime!(ctx('6–10 months') as never, { low_months: 6, high_months: 10 }) as Rec;
    const b = await w.caps.proposeTeamTime!(ctx('6–9 months') as never, { low_months: 6, high_months: 9 }) as Rec;
    expect(w.proposals.outstanding(SCENARIO, null).map(p => p.proposal_id)).toEqual([b.proposal_id]);
    expect(w.proposals.get(a.proposal_id)).toBeUndefined();
    const chips = approvalChipsFor([{ name: 'propose_team_time', ok: true, mutated: false, proposal_id: b.proposal_id }], id => ({ proposal: w.proposals.get(id)!, result: b as never }));
    expect(chips[1]!.message).toBe('I want to change the time estimate for my current team.');
    const d = await w.caps.proposeGoalDeadline!(ctx('by 8 April 2027') as never, { deadline_words: '8 April 2027', rationale: '' }) as Rec;
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(2); expect(d.ok).toBe(true);
  });
  it('P2-forecast-readers-refuse-level-and-target with ordinary level control', async () => {
    const w = world(), label = part(w.graph()).goal.label;
    const level = await w.caps.proposeGoalCurrentLevel!(ctx("we’re 30% done") as never, { goal_label: label, value: 30, unit: '%', user_stated: true } as never) as Rec;
    expect(level.refusal).toBe('goal_measures_a_forecast'); expect(level.detail).toContain('soonest and latest');
    const target = await w.caps.proposeGoalTarget!(ctx('at least 30%') as never, { constraint_type: 'at_least', value: 30, unit: '%', rationale: '' }) as Rec;
    expect(target.refusal).toBe('goal_measures_a_forecast'); expect(part(w.graph()).goal.threshold_source).toBe('definitional');
    const canonical = await w.caps.getCanonicalState(ctx('show model') as never) as Rec;
    expect(JSON.stringify(canonical)).toContain('forecast share');
    expect(w.rows).toHaveLength(0);
    const plain = { nodes: [{ id: 'g', kind: 'goal', label: 'Monthly revenue', goal_threshold_raw: 100, goal_threshold_cap: 100, goal_threshold_unit: 'GBP', goal_threshold_frame: 'level' }], edges: [] };
    expect(goalKindOf(plain.nodes[0])).toBe('level');
    const ordinary = world(plain);
    const levelControl = await ordinary.caps.proposeGoalCurrentLevel!(ctx('Our monthly revenue is £30 today.') as never, { goal_label: 'Monthly revenue', value: 30, unit: 'GBP', user_stated: true } as never) as Rec;
    expect(levelControl.ok, JSON.stringify(levelControl)).toBe(true);
    const targetControl = await ordinary.caps.proposeGoalTarget!(ctx('at least £150') as never, { constraint_type: 'at_least', value: 150, unit: 'GBP', rationale: '' }) as Rec;
    expect(targetControl.ok, JSON.stringify(targetControl)).toBe(true);
  });
  it('P2-deadline-confirmation-current-label with unchanged-label control', async () => {
    for (const rename of [false, true]) {
      const w = world(admitted()), r = await w.caps.proposeGoalDeadline!(ctx('deadline in 6 months') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
      if (rename) { const g = w.graph(); part(g).goal.label = 'Our renamed launch'; w.replace(g); }
      const saved = await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: r.proposal_id } as never, { proposal_id: r.proposal_id }) as Rec;
      expect(saved.ok).toBe(true); expect(saved.follow_up).toContain(part(w.graph()).goal.label);
    }
  });
});


describe('ordinary deadline retry control', () => {
  it('L3-P2-ordinary-deadline-retry-no-new-superseded with event strict control retained', async () => {
    // Use an ordinary quantity goal; changing an event unit invalidates draftedTeamPartOf mid-fixture.
    const g = { nodes: [{ id: 'g', kind: 'goal', label: 'Monthly revenue', goal_threshold_raw: 100,
      goal_threshold_cap: 100, goal_threshold_unit: 'GBP', goal_threshold_frame: 'level', threshold_source: 'user' }], edges: [] };
    expect(goalKindOf(g.nodes[0])).toBe('level');
    const w = world(g); w.failNextPostWriteRead();
    const r = await w.caps.proposeGoalDeadline!(ctx('deadline in 6 months') as never, { deadline_words: '6 months', rationale: '' }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    const renamed = w.graph(); renamed.nodes.find((n: Rec) => n.kind === 'goal').label = 'Our updated goal'; w.replace(renamed);
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(w.rows).toHaveLength(1);
  });
});


describe('week conversion at the real proposal door', () => {
  it('L1-WEEKS-DOOR: rounded tool rendering stores exact server months with mismatch control', async () => {
    const w = world();
    const r = await w.caps.proposeTeamTime!(ctx('4–8 weeks with the current team') as never, { low_months: 0.92, high_months: 1.84 }) as Rec;
    expect(r.ok).toBe(true);
    expect(r.team_time.low_months).toBe(4 * 7 * 12 / 365.25);
    expect(r.team_time.high_months).toBe(8 * 7 * 12 / 365.25);
    expect((await w.caps.proposeTeamTime!(ctx('4–8 weeks with the current team') as never, { low_months: 0.9, high_months: 1.8 }) as Rec).refusal).toBe('team_time_not_stated');
  });
});


describe('singleton recovery at the atomic door', () => {
  it('S1-single-unconfirmed-retry-noop with range retry control above', async () => {
    const w = world(dated(), true), r = await w.caps.proposeTeamTime!(ctx('about 8 months') as never, { low_months: 8, high_months: 8 }) as Rec;
    const yes = { ...ctx('Yes'), typed_approval_of: r.proposal_id };
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    expect(await w.caps.authoriseChange(yes as never, { proposal_id: r.proposal_id })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(w.rows).toHaveLength(1); expect(eventShareCarrierOf(w.graph())!.provenance.share_by_date.stated_time.most_likely).toBe(8);
    expect(await w.commit(w.commits[0]!)).toMatchObject({ status: 'committed', already_applied: true });
    expect(w.rows).toHaveLength(1);
  });
});


describe('documentation boundaries', () => {
  it('P2-doc-comments-at-own-functions with deadline and option controls', () => {
    const caps = readFileSync(new URL('../../agent-lane/runtime/agent-capabilities.ts', import.meta.url), 'utf8');
    const doc = (source: string, marker: string): string => { const at = source.indexOf(marker); return source.slice(source.lastIndexOf('/**', at), at); };
    expect(doc(caps, '    async proposeTeamTime')).toContain('current-team duration');
    expect(doc(caps, '  const applyTeamTime')).toContain('current-team duration');
    expect(doc(caps, '    async proposeGoalDeadline')).toContain('THE USER');
    expect(doc(caps, '  const applyGoalDeadline')).toContain('approved deadline card');
    const tools = readFileSync(new URL('../../agent-lane/runtime/agent-tools.ts', import.meta.url), 'utf8');
    expect(doc(tools, '  proposeTeamTime?')).toContain('current-team duration');
    expect(doc(tools, '  proposeGoalDeadline?')).toContain('stated deadline');
    expect(doc(tools, '  proposeOptionStatus?')).toContain('MG F1 T6');
  });
});

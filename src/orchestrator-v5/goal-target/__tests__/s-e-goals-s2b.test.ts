/** Paul's served 6582edbc brief; drafter output is stubbed. No LLM, network or DB. */
import { describe, expect, it, vi } from 'vitest';
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
import { draftedTeamPartOf, withEventShareDate } from '../event-by-date-model.js';
import { shareByDateGoalOf, goalKindOf } from '../goal-kind.js';
import { teamShareMoments, extraShareMoments } from '../event-by-date-share.js';
import { withShareByDateFrame } from '../share-by-date-run.js';
import { decisionInputLines, decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { noDeadEndAsks } from '../../agent-lane/goal-certainty.js';
import { readTeamTime, TEAM_TIME, applyTeamShareEdit, teamObservedState, type ApprovedTeamTime } from '../team-share-write.js';
import { withholdGoalFiguresForChanceGoal } from '../../tools/handlers/run-analysis.js';

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

async function build(): Promise<Rec> {
  let saved: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      saved = plainGraph((body as Rec).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = vi.fn(async () => ({ text: JSON.stringify(candidate()) }));
  const r = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call) as Rec;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(call).toHaveBeenCalledOnce();
  expect(saved).toBeDefined();
  return saved!;
}

/** Serialised real batch-store/read-back boundary, with no external I/O. */
function world(initial = dated(), unconfirmFirst = false) {
  let json = JSON.stringify(initial);
  const graph = (): Rec => JSON.parse(json);
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const proposals = new ProposalStore();
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
    if (unconfirmFirst && commits.length === 1) return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async path => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never) } };
  };
  return { graph, replace: (g: Rec) => { json = JSON.stringify(g); }, rows, commits, proposals, commit,
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit,
      now: () => new Date('2026-10-07T09:13:13Z') }) };
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
    expect(held).toEqual({ value: m.mean, std: m.sd, raw_value: m.mean * 100, unit: UNIT, cap: 100, source: 'user_override',
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

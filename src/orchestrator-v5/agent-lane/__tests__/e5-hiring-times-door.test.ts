/**
 * ⭐ E5 DOOR (Paul's manual test, 12 Oct 2026; scenario 4184e877, turn 8e6f256f): his hiring-time sentence becomes ONE card,
 * the press writes each option's starts into its existing carriers through `/graph/register` with compare-and-set on both
 * hashes, and "set" is said only once the stored model holds every planned start. Before E5 no door wrote them: Olumi
 * said "I'd use your timings provisionally" and nothing was applied (REGRESSION-FINDINGS row b).
 * Serialised in-process register/read boundary; no database, network or language model.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { withEventShareDate } from '../../goal-target/event-by-date-model.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { sharePartsForOption, shareOptionEstimateWords } from '../../goal-target/share-by-date-run.js';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';

type Rec = Record<string, any>;
const SCENARIO = '4184e877-0000-4000-8000-00000000e5e5';
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
const PAUL = "What hiring estimate would you give for a tech lead versus two developers? I would think, but I'm not sure, that a tech lead would take at least 3 months to get in the door. With two developers, we might be able to get one in within 2 months and then another a month or so later, as an estimate to use.";
const DATE = '2027-04-12', REF = '2026-10-12', UNIT = '% of next feature launch';
const TECH = 'event_option_1', DEVS = 'event_option_2';
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'next feature launch', operator: '>=',
    unit: UNIT, value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null,
    horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
} as never);
const plainGraph = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
/** What the register route stores: its own identity-preserving ingress, then the persistence projection. */
const stored = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(g) as never), { nodes: [], edges: [] }).graph as Rec;
function paulsModel(): Rec {
  const a = admitCandidateModel(candidate(), {}, BRIEF);
  const dated = plainGraph(withEventShareDate(plainGraph({ nodes: a.nodes, edges: a.edges }), DATE, REF));
  const written = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 6, high_months: 10,
    deadline: DATE, reference_date: REF } as never, computeAnalysisAffectingGraphHash(dated as never)!);
  if (written.kind !== 'mutated') throw new Error('team time not written');
  return plainGraph(written.mutatedGraph);
}
const PAULS_ARGS = { options: [
  { option_id: TECH, starts: [{ quote: 'at least 3 months' }] },
  { option_id: DEVS, starts: [{ quote: 'within 2 months' }, { quote: 'another a month or so later' }] },
] };
const ctx = (text: string): Rec => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'e5', user_text: text, user_turn_text: text });

function world(initial = paulsModel()) {
  let json = JSON.stringify(initial);
  const graph = (): Rec => JSON.parse(json);
  const registers: Rec[] = [];
  const knobs = { registerStatus: 200, afterStore: undefined as ((g: Rec) => void) | undefined };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const b = body as Rec, now = graph();
      registers.push(b);
      if (knobs.registerStatus !== 200) return { status: knobs.registerStatus, json: { details: { code: 'GRAPH_STALE' } } };
      // The route's compare-and-set: analysis space AND identity space, against what is stored now.
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(now as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(now as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      const next = stored(b.graph);
      knobs.afterStore?.(next);
      json = JSON.stringify(next);
      return { status: 200, json: { registered: true, model_version: { version_number: 2, version_id: 'v-e5', mutation_id: 'm-e5' } } };
    }
    if (path.endsWith('/graph')) {
      const g = graph();
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never), brief_text: BRIEF } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(`Unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { graph, replace: (g: Rec) => { json = JSON.stringify(g); }, registers, knobs, proposals,
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-12T09:06:57Z') }) };
}
const press = (w: ReturnType<typeof world>, pid: string) =>
  w.caps.authoriseChange({ ...ctx('Yes, use these hiring times.'), typed_approval_of: pid } as never, { proposal_id: pid }) as Promise<Rec>;

describe('Paul\'s hiring-time sentence → ONE card → his starts in the model', () => {
  it('RED before E5: the sentence is offered on one card, in his words, with Olumi\'s figures said as Olumi\'s', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toBe('Use your hiring times? ‘Hire a Tech lead’: starts after 3–4 months (you said “at least 3 months”; 4 months is Olumi’s estimate of the latest start). '
      + '‘Hire two developers’: one person after 2 months and another after 3 months (you said “within 2 months”, then “another a month or so later”); '
      + 'Olumi’s estimate of its pace, 20% of next feature launch a month, is split equally between them.');
    expect(w.registers).toHaveLength(0);
  });

  it('the press writes them; "set" only once the model holds every start; the staggered start is kept as two starts', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const done = await press(w, r.proposal_id);
    expect(done).toMatchObject({ ok: true, applied: true, mutated: true, receipts: [{ version: 2, version_id: 'v-e5' }] });
    expect(w.registers).toHaveLength(1);
    expect(w.registers[0]).toMatchObject({ expected_graph_hash: expect.any(String), expected_graph_identity_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const after = w.graph();
    expect(sharePartsForOption(after, DEVS)).toMatchObject({ extra: { monthlyShare: 0.1, leadLow: 2, leadHigh: 2 },
      furtherExtras: [{ monthlyShare: 0.1, leadLow: 3, leadHigh: 3 }] });
    expect(sharePartsForOption(after, TECH)).toMatchObject({ extra: { monthlyShare: 0.12, leadLow: 3, leadHigh: 4 } });
    // The provisional chance says whose each figure is.
    expect(shareOptionEstimateWords(after, TECH)).toBe('using your hiring time (at least 3 months), Olumi’s estimate of the latest start (4 months), '
      + 'and Olumi’s estimate of the new team’s pace (12% of next feature launch a month)');
    expect(shareOptionEstimateWords(after, DEVS)).toBe('using your hiring times (within 2 months, then another a month or so later), '
      + 'and Olumi’s estimate of the new team’s pace (10% + 10% of next feature launch a month)');
    // The model summary the Agent reads carries each option's starts and pace, with whose.
    const summary = projectModelContext({ nodes: after.nodes, edges: after.edges, raw: after, analysis_state: null, analysis_ready: null } as never) as Rec;
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === DEVS).starts).toEqual([
      { soonest_months: { value: 2, whose: 'Olumi’s estimate' }, latest_months: { value: 2, whose: 'yours', quote: 'within 2 months' }, pace_percent_a_month: { value: 10, whose: 'Olumi’s estimate' } },
      { soonest_months: { value: 3, whose: 'Olumi’s estimate' }, latest_months: { value: 3, whose: 'yours', quote: 'another a month or so later' }, pace_percent_a_month: { value: 10, whose: 'Olumi’s estimate' } },
    ]);
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === TECH).starts).toEqual([
      { soonest_months: { value: 3, whose: 'yours', quote: 'at least 3 months' }, latest_months: { value: 4, whose: 'Olumi’s estimate' }, pace_percent_a_month: { value: 12, whose: 'Olumi’s estimate' } }]);
    // A retry of the same press applies nothing twice.
    expect(await press(w, r.proposal_id)).toMatchObject({ ok: true, applied: true, already_applied: true });
    expect(w.registers).toHaveLength(1);
  });

  it('a quoted figure is his only while the model still holds that number: changed later, it is said as Olumi\'s', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    await press(w, r.proposal_id);
    const g = w.graph();
    g.nodes.find((n: Rec) => n.id === 'event_capacity_1').observed_state.extra_share_by_date.lead_low = 2.5;
    const moved = withEventShareDate(g, DATE, REF) as Rec;
    expect(shareOptionEstimateWords(moved, TECH)).toBe("using Olumi's estimates of hiring time (2.5–4 months) and the new team's pace (12% of next feature launch a month)");
    const summary = projectModelContext({ nodes: moved.nodes, edges: moved.edges, raw: moved, analysis_state: null, analysis_ready: null } as never) as Rec;
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === TECH).starts[0].soonest_months).toEqual({ value: 2.5, whose: 'Olumi’s estimate' });
  });

  it('a typed "yes" is not the press: nothing is written', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const typed = await w.caps.authoriseChange(ctx('yes') as never, { proposal_id: r.proposal_id }) as Rec;
    expect(typed.ok).toBe(false);
    expect(w.registers).toHaveLength(0);
  });

  it('⛔ attribution: his Tech-lead time is never offered for the developers', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: DEVS, starts: [{ quote: 'at least 3 months' }] }] }),
      ctx(PAUL) as never, w.caps) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'hiring_time_not_for_option' });
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('a figure he did not type is refused; "at least" past Olumi\'s latest is refused and asks for the latest', async () => {
    const w = world();
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote: 'at least 4 months' }] }] }),
      ctx(PAUL) as never, w.caps)).toMatchObject({ ok: false, refusal: 'hiring_time_not_stated' });
    const later = 'For the tech lead it would be at least 6 months.';
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote: 'at least 6 months' }] }] }),
      ctx(later) as never, w.caps)).toMatchObject({ ok: false, refusal: 'least_beyond_latest' });
  });

  it('field-scoped stale: a carrier changed after the offer (outside the analysis hash) refuses; nothing is written', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const g = w.graph(), before = computeAnalysisAffectingGraphHash(g as never);
    g.nodes.find((n: Rec) => n.id === 'event_capacity_2').observed_state.extra_share_by_date.lead_high = 5;
    expect(computeAnalysisAffectingGraphHash(g as never)).toBe(before);
    w.replace(g);
    expect(await press(w, r.proposal_id)).toMatchObject({ ok: false, applied: false, refusal: 'superseded' });
    expect(w.registers).toHaveLength(0);
  });

  it('a write conflict at the row writes nothing; a write the model does not hold is never said to be set', async () => {
    const conflict = world();
    const r1 = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, conflict.caps) as Rec;
    conflict.knobs.registerStatus = 409;
    expect(await press(conflict, r1.proposal_id)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    const lost = world();
    const r2 = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, lost.caps) as Rec;
    lost.knobs.afterStore = g => { delete g.nodes.find((n: Rec) => n.id === 'event_capacity_2_start_2').observed_state.extra_share_by_date.figures; };
    expect(await press(lost, r2.proposal_id)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
  });
});

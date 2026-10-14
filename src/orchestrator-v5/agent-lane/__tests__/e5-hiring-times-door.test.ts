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
import { UNKNOWN_ORIGIN_DETAIL } from '../runtime/statement-origin.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';

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
  const knobs = { registerStatus: 200, statusAfterStore: 200, afterStore: undefined as ((g: Rec) => void) | undefined };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const b = body as Rec, now = graph();
      registers.push(b);
      if (knobs.registerStatus !== 200) return { status: knobs.registerStatus, json: knobs.registerStatus === 409 ? { details: { code: 'GRAPH_STALE' } } : {} };
      // The route's compare-and-set: analysis space AND identity space, against what is stored now.
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(now as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(now as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      const next = stored(b.graph);
      knobs.afterStore?.(next);
      json = JSON.stringify(next);
      if (knobs.statusAfterStore !== 200) return { status: knobs.statusAfterStore, json: {} };
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
    expect(r.public_label).toBe('Use these hiring assumptions? ‘Hire a Tech lead’: you said “at least 3 months”. Modelled timing: starts after 3–4 months, '
      + 'with Olumi’s estimate of the latest start (4 months), and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month). '
      + '‘Hire two developers’: you said “within 2 months”, then “another a month or so later”. Modelled timing: one person after 2 months and another after 3 months, '
      + 'with an assumption that this start is exactly 2 months from the reference date, Olumi’s estimate of the soonest start (2 months), the second start taken as 1 month after the first (Olumi’s reading of “another a month or so later”), '
      + 'and Olumi’s estimate of the additional progress from the hires (20% of next feature launch per month, split equally between the two starts).');
    expect(w.registers).toHaveLength(0);
  });

  it('the card\'s two buttons (AIE 6122738619: approved chips): [Use these times] presses THIS card; [Change] asks to change the times', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const chips = approvalChipsFor([{ name: 'propose_hiring_times', ok: true, mutated: false, proposal_id: r.proposal_id }],
      () => ({ proposal: w.proposals.get(r.proposal_id), result: r } as never));
    expect(chips).toEqual([
      { id: approvalChipIdFor(r.proposal_id), label: 'Use these times', message: 'Yes, use these hiring times.', detail: r.public_label },
      { id: 'agent-hiring-times-change', label: 'Change', message: 'I want to change the hiring times.' }]);
  });

  it('the press writes them; "set" only once the model holds every start; the staggered start is kept as two starts', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const done = await press(w, r.proposal_id);
    expect(done).toMatchObject({ ok: true, applied: true, mutated: true, receipts: [{ version: 2, version_id: 'v-e5' }] });
    // Reply-face P1: `follow_up` is what the user reads, so it holds the user's sentence only. The direction for the Agent is
    // `note`, and the committed change's automatic Run is never asked for (the served legacy press showed such text verbatim).
    expect(done.follow_up).toBe("These hiring assumptions are saved, with your inputs and Olumi's estimates distinguished.");
    expect(String(done.follow_up)).not.toMatch(/\b(?:Run the analysis|do not state|speak only)\b/i);
    expect(done.note).toBe('The analysis runs on the saved model; speak only to its result, and state no chance before it returns.');
    expect(w.registers).toHaveLength(1);
    expect(w.registers[0]).toMatchObject({ expected_graph_hash: expect.any(String), expected_graph_identity_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const after = w.graph();
    expect(sharePartsForOption(after, DEVS)).toMatchObject({ extra: { monthlyShare: 0.1, leadLow: 2, leadHigh: 2 },
      furtherExtras: [{ monthlyShare: 0.1, leadLow: 3, leadHigh: 3 }] });
    expect(sharePartsForOption(after, TECH)).toMatchObject({ extra: { monthlyShare: 0.12, leadLow: 3, leadHigh: 4 } });
    // The provisional chance says whose each figure is.
    expect(shareOptionEstimateWords(after, TECH)).toBe('using your hiring time (“at least 3 months”) as modelled: 3–4 months, with Olumi’s estimate of the latest start (4 months), '
      + 'and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month)');
    expect(shareOptionEstimateWords(after, DEVS)).toBe('using your hiring times (“within 2 months”, then “another a month or so later”) as modelled: 2 and 3 months, '
      + 'with an assumption that this start is exactly 2 months from the reference date, Olumi’s estimate of the soonest start (2 months), the second start taken as 1 month after the first (Olumi’s reading of “another a month or so later”), '
      + 'and Olumi’s estimate of the additional progress from the hires (20% of next feature launch per month, split equally between the two starts)');
    // The model summary the Agent reads carries each option's starts and pace, with whose.
    const summary = projectModelContext({ nodes: after.nodes, edges: after.edges, raw: after, analysis_state: null, analysis_ready: null } as never) as Rec;
    const acc = (value: number, role: string, quote?: string) => ({ value, whose: 'olumi_accepted', role, ...(quote === undefined ? {} : { quote }) });
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === DEVS).starts).toEqual([
      { statement: { quote: 'within 2 months', form: 'within' }, soonest_months: acc(2, 'olumi_estimate'),
        latest_months: { value: 2, whose: 'yours', role: 'stated', quote: 'within 2 months' }, pace_percent_per_month: acc(10, 'olumi_estimate') },
      { statement: { quote: 'another a month or so later', form: 'after_previous' }, soonest_months: acc(3, 'derived', 'another a month or so later'),
        latest_months: acc(3, 'derived', 'another a month or so later'), pace_percent_per_month: acc(10, 'olumi_estimate') },
    ]);
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === TECH).starts).toEqual([
      { statement: { quote: 'at least 3 months', form: 'at_least' }, soonest_months: { value: 3, whose: 'yours', role: 'stated', quote: 'at least 3 months' },
        latest_months: acc(4, 'olumi_estimate'), pace_percent_per_month: acc(12, 'olumi_estimate') }]);
    // A retry of the same press applies nothing twice.
    expect(await press(w, r.proposal_id)).toMatchObject({ ok: true, applied: true, already_applied: true });
    expect(w.registers).toHaveLength(1);
  });

  it('a quoted figure is his only while the model still holds that number: changed later, its source is UNKNOWN, never Olumi\'s', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    await press(w, r.proposal_id);
    const g = w.graph();
    g.nodes.find((n: Rec) => n.id === 'event_capacity_1').observed_state.extra_share_by_date.lead_low = 2.5;
    const moved = withEventShareDate(g, DATE, REF) as Rec;
    expect(shareOptionEstimateWords(moved, TECH)).toBe('using your hiring time (“at least 3 months”) as modelled: 2.5–4 months, with a figure whose source could not be confirmed (2.5 months), '
      + 'Olumi’s estimate of the latest start (4 months), and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month)');
    const summary = projectModelContext({ nodes: moved.nodes, edges: moved.edges, raw: moved, analysis_state: null, analysis_ready: null } as never) as Rec;
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === TECH).starts[0].soonest_months).toEqual({ value: 2.5, whose: 'unknown', role: 'unknown' });
  });

  it('an ambiguous save failure is read back, never "not set": landed → set; not held → unknown (A5), no raw http', async () => {
    const landed = world();
    const r1 = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, landed.caps) as Rec;
    landed.knobs.statusAfterStore = 502;
    expect(await press(landed, r1.proposal_id)).toMatchObject({ ok: true, applied: true });
    const lost = world();
    const r2 = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, lost.caps) as Rec;
    lost.knobs.registerStatus = 502;
    const out = await press(lost, r2.proposal_id);
    expect(out).toMatchObject({ ok: false, applied: false, refusal: 'not_confirmed' });
    expect(JSON.stringify(out)).not.toMatch(/http|502/);
  });

  it('an option he gave no timing for keeps Olumi\'s own words, byte-unchanged', async () => {
    const w = world();
    expect(shareOptionEstimateWords(w.graph(), TECH)).toBe("using Olumi’s estimates of hiring time (2–4 months) and of the additional progress from the hires (12% of next feature launch per month)");
  });

  it('AIE R6: a change to one of two held starts re-quotes the other from the model; fewer starts get the AIE\'s own words', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    await press(w, r.proposal_id);
    const later = 'Actually the second developer would join two months after the first.';
    // Only one start for an option that holds two: the AIE's R6, verbatim.
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: DEVS, starts: [{ quote: 'two months after the first' }] }] }),
      ctx(later) as never, w.caps)).toMatchObject({ ok: false, refusal: 'fewer_starts_than_held',
      detail: 'This card replaces all 2 hiring timings for ‘Hire two developers’ together, so nothing was prepared. Retain the unchanged timings and their sources and prepare the complete card for the requested change. If a held timing cannot be verified, ask only about that missing input.' });
    // The complete card: the held, verified statement is re-quoted from the model (not in this message), the change is new.
    const again = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: DEVS,
      starts: [{ quote: 'within 2 months' }, { quote: 'the second developer would join two months after the first' }] }] }), ctx(later) as never, w.caps) as Rec;
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(again.public_label).toContain('one person after 2 months and another after 4 months');
    // AIE bound science: a model-origin bound cannot clamp the held earliest start to a point.
    const before = w.graph(), pending = w.proposals.outstanding(SCENARIO, null), registers = [...w.registers];
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: DEVS,
      starts: [{ quote: 'within 1 month' }, { quote: 'the second developer would join two months after the first' }] }] }), ctx(later) as never, w.caps))
      .toEqual({ ok: false, mutated: false, refusal: 'hiring_bound_conflict', calculation_supported: false,
        statement: { quote: 'within 1 month', source: 'model_proposed', bound: 'upper', value: 1 },
        detail: "Olumi proposed ‘within 1 month’. That gives a upper bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation." });
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual(pending);
    expect(w.registers).toEqual(registers);
    expect(w.graph()).toEqual(before);
  });

  it('"about N" is offered as Olumi\'s reading of the user\'s approximate time, never as an exact human figure', async () => {
    const w = world();
    const said = 'For the tech lead, about 3 months.';
    const r = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote: 'about 3 months' }] }] }), ctx(said) as never, w.caps) as Rec;
    expect(r.public_label).toBe('Use these hiring assumptions? ‘Hire a Tech lead’: you said “about 3 months”. Modelled timing: starts after 3 months, '
      + 'with “about 3 months” taken as 3 months (Olumi’s reading), and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month).');
  });

  it('a typed "yes" is not the press: nothing is written', async () => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(PAULS_ARGS), ctx(PAUL) as never, w.caps) as Rec;
    const typed = await w.caps.authoriseChange(ctx('yes') as never, { proposal_id: r.proposal_id }) as Rec;
    expect(typed.ok).toBe(false);
    expect(w.registers).toHaveLength(0);
  });

  it.each([true, false])('A2i4 NB-c: verified words retain their subject and qualifications; only the new option pairing is Olumi’s (source complete: %s)', async complete => {
    const w = world(), before = w.graph();
    const source = "For a tech lead, I think it would take at least 3 months, but I am not sure; this depends on funding.";
    const quote = 'at least 3 months';
    const context = { ...ctx(source), user_text_complete: complete };
    const args = { options: [{ option_id: DEVS, starts: [{ quote }] }] };
    const r = await dispatchTool('propose_hiring_times', JSON.stringify(args), context as never, w.caps) as Rec;
    const face = `Your words: “${source}”. Olumi proposes using this timing for ‘Hire two developers’; your message did not establish that pairing.`;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toBe(`Use these hiring assumptions? ‘Hire two developers’: ${face} Modelled timing: starts after 3–4 months, with Olumi’s estimate of the soonest start (3 months), Olumi’s estimate of the latest start (4 months), and Olumi’s estimate of the additional progress from the hires (20% of next feature launch per month).`);
    const statement = { quote, form: 'at_least', source: 'user_stated',
      original_source: { text: source, authored_by: 'user_stated' },
      pairing: { option_id: DEVS, authored_by: 'model_proposed' } };
    const proposal = w.proposals.get(r.proposal_id)!;
    expect(proposal.provenance.authored_by).toBe('model_proposed');
    expect((proposal.operations[0]!.value as Rec).options[0].parts[0].statement).toEqual(statement);
    expect(w.graph()).toEqual(before);
    expect(w.registers).toEqual([]);
    expect(await press(w, r.proposal_id)).toMatchObject({ ok: true, applied: true });
    const after = w.graph(); // JSON reload through the register ingress and persistence projection.
    const carrier = after.nodes.find((n: Rec) => n.id === 'event_capacity_2').observed_state.extra_share_by_date;
    expect(carrier.statement).toEqual(statement);
    expect(shareOptionEstimateWords(after, DEVS)).toBe(`using Olumi’s proposed timing for this option from your words “${source}”, as modelled: 3–4 months, with Olumi’s estimate of the soonest start (3 months), Olumi’s estimate of the latest start (4 months), and Olumi’s estimate of the additional progress from the hires (20% of next feature launch per month)`);
    expect(carrier.figures.lead_low).toEqual({ value: 3, role: 'olumi_estimate', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } });
    expect(after.nodes.find((n: Rec) => n.id === 'event_capacity_1')).toEqual(before.nodes.find((n: Rec) => n.id === 'event_capacity_1'));
    const summary = projectModelContext({ nodes: after.nodes, edges: after.edges, raw: after, analysis_state: null, analysis_ready: null } as never) as Rec;
    expect(summary.hiring_times.options.find((o: Rec) => o.option_id === DEVS).starts[0].statement).toEqual(statement);
    expect(await press(w, r.proposal_id)).toMatchObject({ ok: true, applied: true, already_applied: true });
    expect(w.registers).toHaveLength(1);
    const cold = world(after);
    expect(await dispatchTool('propose_hiring_times', JSON.stringify(args),
      { ...ctx('Keep the selected timing.'), user_text_complete: false } as never, cold.caps))
      .toMatchObject({ ok: false, mutated: false, refusal: 'already_held' });
    expect(cold.graph()).toEqual(after);
    expect(cold.registers).toEqual([]);
  });

  it('A2i4 NB-c: unverified words and an incomplete-source miss stay unknown, with no pairing or write', async () => {
    for (const unverified of ['', 'For a tech lead, at least 3 months, if funding is available.']) {
      const w = world(), before = w.graph();
      const r = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: DEVS, starts: [{ quote: 'at least 3 months' }] }] }),
        { ...ctx('Consider a timing.'), user_text_complete: false, unverified_user_text: unverified } as never, w.caps);
      expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
      expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.graph()).toEqual(before);
      expect(w.registers).toEqual([]);
    }
  });

  it('W12/W13 an unbound figure is labelled; "at least" past Olumi\'s latest refuses without a write', async () => {
    const w = world();
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote: 'at least 4 months' }] }] }),
      ctx(PAUL) as never, w.caps)).toMatchObject({ ok: true, mutated: false, public_label: expect.stringContaining('Olumi proposed') });
    const later = 'For the tech lead it would be at least 6 months.';
    const before = w.graph(), pending = w.proposals.outstanding(SCENARIO, null);
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote: later }] }] }),
      ctx(later) as never, w.caps)).toEqual({ ok: false, mutated: false, refusal: 'hiring_bound_conflict', calculation_supported: false,
        statement: { quote: later, source: 'user_stated', bound: 'lower', value: 6 },
        detail: `You gave ‘${later}’. That gives a lower bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation.` });
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual(pending);
    expect(w.registers).toEqual([]);
    expect(w.graph()).toEqual(before);
  });

  it.each([['at least 6 months', 'lower', 6], ['within 1 month', 'upper', 1]])(
    'A2i incompatible %s keeps the complete source, never prepares a point', async (phrase, bound, value) => {
      const w = world(), before = w.graph();
      const quote = `For the tech lead, ${phrase}, though I am uncertain`;
      const out = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH, starts: [{ quote }] }] }),
        ctx(quote) as never, w.caps) as Rec;
      expect(out).toEqual({ ok: false, mutated: false, refusal: 'hiring_bound_conflict', calculation_supported: false,
        statement: { quote, source: 'user_stated', bound, value },
        detail: `You gave ‘${quote}’. That gives a ${bound} bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation.` });
      expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.registers).toEqual([]);
      expect(w.graph()).toEqual(before);
    });

  it('A2i incomplete-source miss stays unknown; an explicit new unquoted estimate is its own act', async () => {
    const w = world();
    const context = { ...ctx('Consider a timing estimate.'), user_text_complete: false };
    const unknown = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'in 6 months', months: 6 }] }] }), context as never, w.caps);
    expect(unknown).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
    const own = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: '', months: 6 }] }] }), context as never, w.caps) as Rec;
    expect(own).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.get(own.proposal_id)?.provenance.authored_by).toBe('model_proposed');
    expect(own.public_label).toBe('Use these hiring assumptions? ‘Hire a Tech lead’: Olumi proposed “in 6 months”. Modelled timing: starts after 6 months, with an assumption that this start is exactly 6 months from the reference date, Olumi’s estimate of the soonest start (6 months), Olumi’s estimate of the latest start (6 months), and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month).');
    expect(await press(w, own.proposal_id)).toMatchObject({ ok: true, applied: true });
    const carrier = w.graph().nodes.find((n: Rec) => n.id === 'event_capacity_1').observed_state.extra_share_by_date;
    expect(carrier.statement).toEqual({ quote: 'in 6 months', form: 'about', source: 'model_proposed' });
    expect(carrier.figures.lead_low).toEqual({ value: 6, role: 'olumi_estimate', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } });
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'in 6 months' }] }] }), context as never, w.caps))
      .toMatchObject({ ok: false, mutated: false, refusal: 'already_held' });

  });

  it('W13 typed months travel through dispatch, approval, storage and provenance readback', async () => {
    const w = world();
    const out = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'after onboarding', months: 5 }] }] }), ctx('Consider onboarding time.') as never, w.caps) as Rec;
    expect(out).toMatchObject({ ok: true, public_label: expect.stringContaining('Olumi proposed') });
    expect(w.registers).toHaveLength(0);
    expect(await press(w, out.proposal_id)).toMatchObject({ applied: true });
    const c = w.graph().nodes.find((n: Rec) => n.id === 'event_capacity_1').observed_state.extra_share_by_date;
    expect(c).toMatchObject({ lead_low: 5, lead_high: 5, statement: { source: 'model_proposed' },
      figures: { lead_low: { role: 'olumi_estimate', source: 'user_assumption' }, lead_high: { role: 'olumi_estimate' } } });
    expect(shareOptionEstimateWords(w.graph(), TECH)).not.toContain('your hiring time');
    const follow = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'after onboarding' }, { quote: 'another a month later' }] }] }), ctx('Add another start for the tech lead.') as never, w.caps) as Rec;
    expect(follow).toMatchObject({ ok: true, public_label: expect.stringContaining('one person after 5 months and another after 6 months') });
    expect(follow.public_label).toContain('Olumi proposed');

  });
  it.each([null, '5', -1, 61])('W13 invalid typed months %j never prepares or writes', async months => {
    const w = world();
    expect(await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'in 3 months', months }] }] }), ctx('For a tech lead in 3 months.') as never, w.caps))
      .toMatchObject({ ok: false, mutated: false, refusal: 'hiring_timings_unusable' });
    expect(w.registers).toHaveLength(0);
  });

  // Paul's test (DL, 12 Oct): a refusal that is not a §7.4 blocking class names ONE next step and what the model keeps.
  it.each([
    ['too many starts', 'With two developers, one in 2 months, then in 3 months, then in 4 months.', DEVS, ['in 2 months', 'in 3 months', 'in 4 months'], 'too_many_starts'],
    ['a start tied to a ranged one', 'With two developers, one in 2-3 months and another a month later.', DEVS, ['in 2-3 months', 'another a month later'], 'relative_to_range'],
  ])('a refusal never ends the turn without a next step: %s → ONE ask, and Olumi\'s estimate stays, labelled', async (_n, said, option, quotes, refusal) => {
    const w = world();
    const r = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: option, starts: quotes.map(quote => ({ quote })) }] }),
      ctx(said) as never, w.caps) as Rec;
    expect(r).toMatchObject({ ok: false, refusal });
    expect(String(r.detail)).toMatch(/ask once (for|which)/);
    expect(String(r.detail)).toMatch(/Olumi’s own hiring estimates? (for ‘[^’]+’ )?stays? in the model, labelled as Olumi’s/);
    expect(w.registers).toHaveLength(0);
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

// Fresh Claude probes H1–H4, promoted to exact regression assertions (A2i8).
describe('A2i8 fresh Claude hiring regressions', () => {
  it('B1 H3: a short bound quote retains the complete qualified source', async () => {
    const w = world(), before = w.graph();
    const text = "For the tech lead it would be at least 6 months, though I'm not sure and it depends on funding.";
    const out = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'at least 6 months' }] }] }), ctx(text) as never, w.caps) as Rec;
    expect(out).toEqual({ ok: false, mutated: false, refusal: 'hiring_bound_conflict', calculation_supported: false,
      statement: { quote: text, source: 'user_stated', bound: 'lower', value: 6 },
      detail: `You gave ‘${text}’. That gives a lower bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation.` });
    expect(w.graph()).toEqual(before);
    expect(w.registers).toEqual([]);
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it.each([true, false])('B2 H4: a pairing conflict keeps user authorship (source complete: %s)', async complete => {
    const w = world(), before = w.graph();
    const text = 'With two developers, I think it would take at least 6 months.';
    const out = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote: 'at least 6 months' }] }] }), { ...ctx(text), user_text_complete: complete } as never, w.caps) as Rec;
    expect(out).toEqual({ ok: false, mutated: false, refusal: 'hiring_bound_conflict', calculation_supported: false,
      statement: { quote: text, source: 'user_stated', bound: 'lower', value: 6 },
      detail: `You gave ‘${text}’. That gives a lower bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation.` });
    expect(w.graph()).toEqual(before);
    expect(w.registers).toEqual([]);
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it.each([
    ['H1', 'at least 4 months', 4, 4, 'an assumption that this start is exactly 4 months from the reference date, Olumi’s estimate of the latest start (4 months)'],
    ['H2', 'within 2 months', 2, 2, 'an assumption that this start is exactly 2 months from the reference date, Olumi’s estimate of the soonest start (2 months)'],
    ['interval', 'at least 3 months', 3, 4, 'Olumi’s estimate of the latest start (4 months)'],
  ] as const)('B3 %s: disclose an exact start exactly when the modelled interval is degenerate', async (_row, quote, low, high, assumptions) => {
    const w = world();
    const text = `For the tech lead it would be ${quote}.`;
    const out = await dispatchTool('propose_hiring_times', JSON.stringify({ options: [{ option_id: TECH,
      starts: [{ quote }] }] }), ctx(text) as never, w.caps) as Rec;
    expect(out.ok).toBe(true);
    const timing = low === high ? `${low}` : `${low}–${high}`;
    expect(out.public_label).toBe(`Use these hiring assumptions? ‘Hire a Tech lead’: you said “${quote}”. Modelled timing: starts after ${timing} months, with ${assumptions}, and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month).`);
    const part = (w.proposals.get(out.proposal_id)!.operations[0]!.value as Rec).options[0].parts[0];
    expect([part.lead_low.value, part.lead_high.value]).toEqual([low, high]);
    expect(await press(w, out.proposal_id)).toMatchObject({ ok: true, applied: true });
    const carrier = w.graph().nodes.find((n: Rec) => n.id === 'event_capacity_1').observed_state.extra_share_by_date;
    expect([carrier.lead_low, carrier.lead_high]).toEqual([low, high]);
    expect(shareOptionEstimateWords(w.graph(), TECH).includes('an assumption that this start is exactly')).toBe(low === high);
  });
});

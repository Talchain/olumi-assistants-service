/**
 * ⭐ THE COACHING LOOP (DL, 14 Oct) on Paul's SERVED graph (legacy brief, CEE de659cfd, read after the Run and a cold reopen;
 * `fixtures/paul-legacy-de659cfd-served-graph-20261014.json`, byte-pinned). "Reduce legacy-fix time" showed "No chance is shown
 * for this option yet … Worth discussing: how much it would speed up the work, and from when." His answer "it would cut legacy
 * work from 25% to 15%" becomes ONE card; the press adds the capacity carrier as ONE registered revision, and the option acts
 * through the time it frees (r = 85/75), with his figure kept as his statement and the freed-time reading kept as Olumi's.
 * Serialised in-process register/read boundary (the E5 harness); no database, network or language model.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { unresolvedEventOptionIds } from '../../goal-target/event-by-date-model.js';
import { unsupportedEventOptionWhy } from '../../goal-target/goal-chance-range.js';
import { optionCapacityChangeStillApplies, shareFiguresFor, sharePercentsIn, type ApprovedOptionCapacityChange } from '../../goal-target/option-capacity-change.js';
import { capacityRatioOutOfReach, shareChanceInputFailure, shareOptionEstimateWords, sharePartsForOption } from '../../goal-target/share-by-date-run.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { approvalChipsFor } from '../approval-chips.js';
import { withoutAgentDirections } from '../write-outcome.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { withShareByDateChanceGate } from '../../goal-target/goal-chance-range.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import { resolveRunAdmission, NO_COMPARISON_NEXT_STEP } from '../../tools/handlers/analysis-ready-core.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-de659cfd-served-graph-20261014.json', import.meta.url), 'utf8')) as {
  graph_text: string; graph_sha256: string };
const SCENARIO = '5b52ff13-0000-4000-8000-0000000c0a7c';
const LEGACY = 'event_option_2', LEGACY_TIME = 'event_context_7', CARRIER = 'event_capacity_2';
const PAUL = 'it would cut legacy work from 25% to 15%';
const ARGS = { option_id: LEGACY, statements: [{ quote: PAUL, form: 'point', value: 15 }] };
const stored = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(g) as never), { nodes: [], edges: [] }).graph as Rec;
const ctx = (text: string): Rec => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'coach', user_text: text, user_turn_text: text });
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);

function world(initial: Rec = JSON.parse(FX.graph_text) as Rec) {
  let json = JSON.stringify(initial);
  const graph = (): Rec => JSON.parse(json);
  const registers: Rec[] = [];
  const knobs = { registerStatus: 200 };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const b = body as Rec, now = graph();
      registers.push(b);
      if (knobs.registerStatus !== 200) return { status: knobs.registerStatus, json: knobs.registerStatus === 409 ? { details: { code: 'GRAPH_STALE' } } : {} };
      // The route's compare-and-set: analysis space AND identity space, against what is stored now.
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(now as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(now as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      json = JSON.stringify(stored(b.graph));
      return { status: 200, json: { registered: true, model_version: { version_number: 9, version_id: 'v-coach', mutation_id: 'm-coach' } } };
    }
    if (path.endsWith('/graph')) {
      const g = graph();
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(`Unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { graph, registers, knobs, proposals,
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-14T21:30:00Z') }) };
}
const offer = async (w: ReturnType<typeof world>, args: unknown = ARGS, text = PAUL): Promise<Rec> =>
  dispatchTool('propose_option_capacity_change', JSON.stringify(args), ctx(text) as never, w.caps) as Promise<Rec>;
const press = (w: ReturnType<typeof world>, pid: string) =>
  w.caps.authoriseChange({ ...ctx('Yes, use this for the option.'), typed_approval_of: pid } as never, { proposal_id: pid }) as Promise<Rec>;

describe('the coaching loop: Paul\'s answer to "how much it would speed up the work" resolves the option (served de659cfd)', () => {
  it('PRECONDITION: the served graph, byte-pinned; "Reduce legacy-fix time" is unresolved with the coaching step; legacy time is 25%', () => {
    expect(createHash('sha256').update(FX.graph_text, 'utf8').digest('hex')).toBe(FX.graph_sha256);
    const g = JSON.parse(FX.graph_text) as Rec;
    expect(unresolvedEventOptionIds(g)).toEqual([LEGACY]);
    expect(unsupportedEventOptionWhy(g, LEGACY)).toMatch(/Worth discussing: how much it would speed up the work, and from when\.$/);
    expect(node(g, LEGACY_TIME).observed_state).toMatchObject({ raw_value: 25, unit: '% of developer time' });
    expect(node(g, CARRIER)).toBeUndefined();
  });

  it('⭐ RED→GREEN: his answer → ONE card in plain words → the press → ONE revision, read back → the option acts (r = 85/75), labelled', async () => {
    const w = world();
    const r = await offer(w);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toBe('Use this for ‘Reduce legacy-fix time’? You said “it would cut legacy work from 25% to 15%”. Olumi reads this as: the option '
      + 'sets ‘Legacy-code fixing time’ to 15% of developer time (25% of developer time today). Olumi also assumes that all the rest of the team’s time '
      + '(75% today) goes to next feature launch, so freeing 10 points raises the team’s capacity for it to about 113% of today’s. Olumi assumes this takes '
      + 'effect from now; say if it would start later. The model gains one part, ‘Reduce legacy-fix time frees time for next feature launch’, linked to the goal.');
    expect(w.registers).toHaveLength(0); // nothing is written by the offer
    const chips = approvalChipsFor([{ name: 'propose_option_capacity_change', ok: true, mutated: false, proposal_id: r.proposal_id }] as never,
      (id: string) => ({ proposal: w.proposals.get(id), result: r }) as never);
    // A card-only card: its press carries the card's own words; the second chip changes it first.
    expect(chips.map((c: Rec) => c.label), JSON.stringify(chips)).toEqual(['Use this', 'Change something first']);
    expect(chips[0]!.detail).toBe(r.public_label);

    const done = await press(w, r.proposal_id);
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true, applied: true, mutated: true });
    // ⛔ What the USER reads (served 7f5659fd: the Agent's direction was shown verbatim, the user's sentence dropped): the
    // fast path shows `follow_up` through `withoutAgentDirections`; the direction for the Agent rides in `note` only.
    expect(withoutAgentDirections(String(done.follow_up)).text).toBe('‘Reduce legacy-fix time’ is saved: it now acts in the deadline '
      + 'forecast through the time it frees, with your figure and Olumi’s assumptions kept distinct.');
    expect(String(done.follow_up)).not.toMatch(/speak only|state no chance|the user/i);
    expect(done.note).toBe('The analysis runs on the saved model; speak only to its result, and state no chance before it returns.');
    expect(w.registers).toHaveLength(1); // ONE compare-and-set registration
    const g = w.graph();
    // The canvas reads this graph: the new part and its links are there.
    expect(node(g, CARRIER)).toMatchObject({ kind: 'factor', label: 'Reduce legacy-fix time frees time for next feature launch' });
    expect(g.edges.some((e: Rec) => e.from === CARRIER && e.to === 'event_goal')).toBe(true);
    for (const id of ['event_option_1', LEGACY, 'event_option_3']) {
      expect(g.edges.some((e: Rec) => e.from === id && e.to === CARRIER), id).toBe(true);
      expect(node(g, id).interventions[CARRIER], id).toEqual({ value: id === LEGACY ? 1 : 0 });
    }
    // The option acts: no longer unresolved, one mechanism (the capacity ratio), r = 85/75, sized from the team's own share.
    expect(unresolvedEventOptionIds(g)).toEqual([]);
    const extra = node(g, CARRIER).observed_state.extra_share_by_date;
    expect(extra.capacity_ratio).toBeCloseTo(85 / 75, 12);
    expect(sharePartsForOption(g, LEGACY)?.ratio).toBeCloseTo(85 / 75, 12);
    expect(g.edges.find((e: Rec) => e.from === CARRIER && e.to === 'event_goal').defaulted).toBeUndefined();
    expect(shareOptionEstimateWords(g, LEGACY)).toBe('using your figure of 15% of developer time for ‘Legacy-code fixing time’ with this option '
      + '(25% of developer time today), Olumi’s assumption that all the rest of the team’s time (75% today, 85% with this option) goes to ‘next feature '
      + 'launch’, so the team’s capacity for it is about 113% of today’s, and Olumi’s provisional assumption that delivery pace changes in proportion to '
      + 'that capacity from now');
    // On his own 7–8 months the user's bound decides (PL 6135017311 item 1): out of reach, with the arithmetic, never a tail figure.
    expect(shareChanceInputFailure(g, LEGACY)).toBeNull();
    expect(capacityRatioOutOfReach(g, LEGACY)).toMatch(/^No chance is shown for this option: on your own soonest estimate it can’t reach 100% of next feature launch by 14 April 2027\. Even at 7 months, it gets about 97% done by then/);
    // ⛔ Served 7f5659fd (22:50Z, wrong author): carrying on as now said "rests on figures Olumi can’t yet confirm" and offered
    // a speed-up step, over HIS 7–8 months. Today's team (no part on, k = 1) gets the same bound reason, with its arithmetic.
    expect(capacityRatioOutOfReach(g, 'event_option_1')).toBe('No chance is shown for this option: on your own soonest estimate it can’t '
      + 'reach 100% of next feature launch by 14 April 2027. Even at 7 months, it gets about 85% done by then (7 months of work, past the '
      + '6 months to the deadline).');
  });

  it('⛔ authorship: the carrier and the r reading are Olumi\'s (adopted by the press); "25% → 15%" is kept as HIS statement', async () => {
    const w = world();
    await press(w, (await offer(w)).proposal_id);
    const c = node(w.graph(), CARRIER);
    expect(c.provenance).toBe('ai_inferred');
    expect(c.observed_state.source).toBe('cee_inference');
    expect(c.observed_state.extra_share_by_date.ratio_relation).toEqual({ kind: 'freed_time', reading: 'olumi', adopted_by: 'user_press' });
    expect(c.observed_state.extra_share_by_date.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: PAUL, source: PAUL,
      form: 'point', low: 15, high: 15, unit: '%', reading: 'olumi', subject: { quantity: 'share_of_time', node_id: LEGACY_TIME, option_id: LEGACY } })]);
    // His saved 25% is untouched: the option's 15% rides on the carrier, never written over today's figure.
    expect(node(w.graph(), LEGACY_TIME).observed_state).toMatchObject({ raw_value: 25 });
  });

  it('CONTRAST: no press → nothing written and the option stays unresolved; a typed yes is not the press', async () => {
    const w = world();
    const r = await offer(w);
    expect(w.registers).toHaveLength(0);
    expect(unresolvedEventOptionIds(w.graph())).toEqual([LEGACY]);
    const typed = await w.caps.authoriseChange(ctx('yes') as never, { proposal_id: r.proposal_id }) as Rec;
    expect(typed.applied).not.toBe(true);
    expect(w.registers).toHaveLength(0);
    expect(unresolvedEventOptionIds(w.graph())).toEqual([LEGACY]);
  });

  it('⛔ a compare-and-set conflict writes nothing and tells the user; a duplicate press applies nothing twice', async () => {
    const conflict = world();
    const r = await offer(conflict);
    conflict.knobs.registerStatus = 409;
    const before = JSON.stringify(conflict.graph());
    expect(await press(conflict, r.proposal_id)).toMatchObject({ ok: false, mutated: false, applied: false, refusal: 'superseded',
      detail: 'The model changed just before this was written, so nothing was set for ‘Reduce legacy-fix time’. Offer it again only if it still applies.' });
    expect(JSON.stringify(conflict.graph())).toBe(before);

    const twice = world();
    const p = await offer(twice);
    expect(await press(twice, p.proposal_id)).toMatchObject({ ok: true, mutated: true });
    const once = JSON.stringify(twice.graph());
    expect(await press(twice, p.proposal_id)).toMatchObject({ ok: true, mutated: false });
    expect(twice.registers).toHaveLength(1);
    expect(JSON.stringify(twice.graph())).toBe(once);
  });

  it('⭐ the live compiler: an edit to his 25% (→ 20%) re-derives r = 85/80 from the saved figure; his 15% stays his', async () => {
    const w = world();
    await press(w, (await offer(w)).proposal_id);
    const g = w.graph();
    Object.assign(node(g, LEGACY_TIME).observed_state, { raw_value: 20, value: 0.2 });
    const after = projectGraphForPersistence(g as never) as Rec;
    expect(node(after, CARRIER).observed_state.extra_share_by_date.capacity_ratio).toBeCloseTo(85 / 80, 12);
    expect(shareOptionEstimateWords(after, LEGACY)).toContain('your figure of 15% of developer time for ‘Legacy-code fixing time’ with this option (20% of developer time today)');
  });

  it('⛔ rollback fails closed: without the freed-time branch, the carrier reads as unreadable (withheld), never r = 1', async () => {
    const w = world();
    await press(w, (await offer(w)).proposal_id);
    const g = w.graph();
    delete node(g, CARRIER).observed_state.extra_share_by_date.ratio_source.complement_of; // what a reverted compiler sees
    const after = projectGraphForPersistence(g as never) as Rec;
    expect(node(after, CARRIER).observed_state.extra_share_by_date.ratio_source_unreadable).toBe(true);
    expect(shareChanceInputFailure(after, LEGACY)).toMatch(/missing or unreadable now\.$/);
  });

  it('⭐ in reach (team time 5–7 months): the option shows its own licensed chance, with what it rests on', async () => {
    const w = world();
    await press(w, (await offer(w)).proposal_id);
    const g = w.graph();
    const edited = applyTeamShareEdit(g, { goal_id: 'event_goal', team_id: 'event_team', low_months: 5, high_months: 7,
      deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(g as never)!);
    if (edited.kind !== 'mutated') throw new Error(JSON.stringify(edited));
    const m = edited.mutatedGraph as Rec;
    expect(capacityRatioOutOfReach(m, LEGACY)).toBeNull();
    const run = { option_comparison: ['event_option_1', LEGACY, 'event_option_3'].map((id, i) => ({ option_id: id,
      probability_of_goal: [0.2, 0.55, 0.7][i], outcome: { p10: 0.8, p50: 0.95, p90: 1.1, std: 0.1 } })), inference_warnings: [] as Rec[] };
    const gated = withShareByDateChanceGate(run, m, 'event_goal') as Rec;
    const licence = goalChanceLicenceOf(gated, m, 'event_goal')!;
    expect(licence.pct_by_option[LEGACY]).toBe(55);
  });

  // ⛔ PL (14 Oct, #3142 first pass, wrong-number class): a timing in the same sentence is the option's LEAD, never a figure of the share.
  it('⛔ "in 3 months, cut legacy from 25% to 15%" → 25→15 with a 3-month lead (session 4\'s reader), never a conflicting 3%', async () => {
    const SENTENCE = 'in 3 months, cut legacy from 25% to 15%';
    const share = shareFiguresFor('Legacy-code fixing time', '% of developer time', []);
    expect(share(SENTENCE)).toEqual([{ low: 25, high: 25 }, { low: 15, high: 15 }]);
    // CONTRAST: every numeral (the reading the PL found) would have taken the 3.
    expect([...SENTENCE.matchAll(/\d+/g)].map((m) => Number(m[0]))).toContain(3);
    const w = world();
    const r = await offer(w, { option_id: LEGACY, statements: [{ quote: SENTENCE, form: 'point', value: 15 }] }, SENTENCE);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toContain('sets ‘Legacy-code fixing time’ to 15% of developer time (25% of developer time today)');
    expect(r.public_label).toContain('Full effect 3 months from now: your start in 3 months');
    expect(r.public_label).not.toMatch(/\b3%/);
    await press(w, r.proposal_id);
    const extra = node(w.graph(), CARRIER).observed_state.extra_share_by_date;
    expect(extra).toMatchObject({ lead_low: 3, lead_high: 3, lead_reading: { start: { low: 3, high: 3, role: 'stated' } } });
    expect(extra.capacity_ratio).toBeCloseTo(85 / 75, 12);
    expect(shareOptionEstimateWords(w.graph(), LEGACY)).toMatch(/in proportion to that capacity from 3 months in$/);
  });

  it('⛔ population: a "% of" another whole is not this share\'s figure; a bare count never is', () => {
    const share = shareFiguresFor('Legacy-code fixing time', '% of developer time', []);
    expect(share('cut legacy to 15% of revenue')).toEqual([]);
    expect(share('cut legacy to 15% of their time')).toEqual([{ low: 15, high: 15 }]);
    expect(sharePercentsIn('3 developers at 25%')).toEqual([25]);
  });

  it('⛔ staleness is about MEANING: a changed deliverable, deadline, reference, unit or whole refreshes the card; nothing is written', async () => {
    const w = world();
    const r = await offer(w);
    const a = w.proposals.get(r.proposal_id)!.operations[0]!.value as ApprovedOptionCapacityChange;
    expect(optionCapacityChangeStillApplies(a, w.graph())).toBe(true);
    for (const [what, moved] of [['deliverable', { ...a, deliverable: 'a different launch' }], ['deadline', { ...a, deadline: '2027-06-30' }],
      ['reference', { ...a, reference_date: '2026-09-01' }], ['unit', { ...a, unit: '% of budget' }], ['whole', { ...a, total: 50 }]] as const) {
      expect(optionCapacityChangeStillApplies(moved as ApprovedOptionCapacityChange, w.graph()), what).toBe(false);
    }
    // The goal's deadline moved after the card was offered (outside the analysis hash, so only the card's own meaning gate sees
    // it): the press writes nothing under the old reading.
    const g = w.graph();
    node(g, 'event_goal').goal_horizon = { ...node(g, 'event_goal').goal_horizon, deadline: '2027-06-30' };
    const moved = world(g);
    const p = w.proposals.get(r.proposal_id)!;
    moved.proposals.put(p);
    const before = JSON.stringify(moved.graph());
    const out = await press(moved, r.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(out.expected, 'the analysis hash did not move: the meaning gate refused it').toBeUndefined();
    expect(moved.registers).toHaveLength(0);
    expect(JSON.stringify(moved.graph())).toBe(before);
    const budget = w.graph();
    node(budget, LEGACY_TIME).observed_state.unit = '% of budget';
    // CONTRAST: offered on a share of budget, no card is made at all (not a share of the team's time).
    expect(await offer(world(budget))).toMatchObject({ ok: false, refusal: 'no_share_to_change' });
  });

  it('the share\'s percent family is the unit authority\'s (`classifyUnitScaleClass`): "percent of developer time" is a share; points never are', async () => {
    const spelled = (unit: string): Rec => { const g = JSON.parse(FX.graph_text) as Rec; node(g, LEGACY_TIME).observed_state.unit = unit; return g; };
    expect(await offer(world(spelled('percent of developer time')))).toMatchObject({ ok: true });
    expect(await offer(world(spelled('percent')))).toMatchObject({ ok: true });
    // CONTRAST: the authority's prefix layer reads "percentage points" as percent; a change in points is not a share of time.
    expect(await offer(world(spelled('percentage points')))).toMatchObject({ ok: false, refusal: 'no_share_to_change' });
  });

  it.each([
    ['words the user never typed', { ...ARGS, statements: [{ quote: 'it would cut legacy work to 10%', form: 'point', value: 10 }] }, PAUL, 'statement_not_found'],
    ['a higher share (frees no time)', { ...ARGS, statements: [{ quote: 'legacy work would go up to 30%', form: 'point', value: 30 }] }, 'legacy work would go up to 30%', 'not_lower'],
    ['a different "today" from the model\'s 25%', { ...ARGS, statements: [{ quote: 'it would cut legacy work from 20% to 15%', form: 'point', value: 15 }] }, 'it would cut legacy work from 20% to 15%', 'not_today'],
    ['an option that already acts (the hire)', { option_id: 'event_option_3', statements: ARGS.statements }, PAUL, 'option_not_unresolved'],
  ] as const)('REFUSES %s: nothing is prepared', async (_name, args, text, refusal) => {
    const w = world();
    expect(await offer(w, args, text)).toMatchObject({ ok: false, refusal });
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
  });
});

/**
 * ⭐ DL ruling (A), 15 Oct: the served legacy model after the team-time card (capture 2026-10-14T224350Z, CEE 7f5659fd, turn 06)
 * refused the Run with "An option has no factor connections and cannot be analysed. Connect it to at least one factor." on all
 * three options, because no option was sized and their only links went to the kept-aside sketch. Such an option is UNSIZED:
 * the ONE readiness authority asks for its effect, in the door's subject, and the answer → card → write admits the Run.
 */
const UNSIZED = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-7f5659fd-unsized-options-graph-20261014.json', import.meta.url), 'utf8')) as {
  graph_text: string; graph_sha256: string };
const STRUCTURAL = /no factor connections|cannot reach the goal|Connect it to at least one factor/;
const issuesOf = (g: unknown): Rec[] => resolveRunAdmission(g).assessment.issues as unknown as Rec[];

describe('an unsized deadline-forecast option is asked for its effect, never called unconnected (served 7f5659fd turn 06)', () => {
  it('PRECONDITION: the served graph after team time, byte-pinned; no option is sized and every option links only to the sketch', () => {
    expect(createHash('sha256').update(UNSIZED.graph_text, 'utf8').digest('hex')).toBe(UNSIZED.graph_sha256);
    const g = JSON.parse(UNSIZED.graph_text) as Rec;
    expect(g.nodes.some((n: Rec) => n.observed_state?.extra_share_by_date !== undefined)).toBe(false);
    expect(node(g, 'event_team').observed_state.stated_time).toMatchObject({ low: 7, high: 8 });
  });

  it('⭐ RED→GREEN: one ask per unsized option in the door subject → his answer → ONE card → the press → the Run is admitted', async () => {
    const g = JSON.parse(UNSIZED.graph_text) as Rec;
    const before = resolveRunAdmission(g);
    expect(before.willProceed).toBe(false);
    expect(before.blockedNextStep).not.toBe(NO_COMPARISON_NEXT_STEP); // identical only because unsized: never "fewer than two"
    const issues = issuesOf(g);
    expect(issues.map(i => i.message).join(' ')).not.toMatch(STRUCTURAL);
    expect(issues.map(i => [i.code, i.message, i.statement_subject])).toEqual([
      ['MISSING_OPTION_VALUE', 'Factor "Legacy-code time share" is currently 25%. What should option "Reduce legacy-fix time" set it to?',
        { kind: 'factor', id: LEGACY_TIME, option_id: LEGACY, field: 'level' }],
      ['MISSING_OPTION_VALUE', 'What would option "Increase development velocity" set "Development velocity" to?',
        { kind: 'factor', id: 'event_context_8', option_id: 'event_option_3', field: 'level' }],
    ]);
    // Carrying on as now is the reference, never asked for an effect.
    expect(issues.some(i => i.option_id === 'event_option_1')).toBe(false);

    // His answer to the ask, bound to the ask's own subject → ONE card → the press → ONE write → the Run is admitted.
    const w = world(g);
    const subject = issues[0]!.statement_subject as Rec;
    const r = await offer(w, { option_id: subject.option_id, factor_id: subject.id, statements: ARGS.statements });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(String(r.public_label)).toContain(`You said “${PAUL}”`);
    expect(await press(w, String(r.proposal_id))).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.registers).toHaveLength(1);
    const after = resolveRunAdmission(w.graph());
    expect(after.willProceed, JSON.stringify(after.assessment.issues)).toBe(true);
  });

  it('⛔ CONTRAST: an option with no link to any factor really is unconnected and keeps the structural message', () => {
    const g = JSON.parse(UNSIZED.graph_text) as Rec;
    g.edges = g.edges.filter((e: Rec) => !(e.from === 'event_option_3' && e.to === 'event_context_8'));
    const issues = issuesOf(g);
    expect(issues.find(i => i.option_id === 'event_option_3' && i.code === 'OPTION_NO_FACTOR_EDGES')?.message)
      .toBe('An option has no factor connections and cannot be analysed. Connect it to at least one factor.');
    expect(resolveRunAdmission(g).willProceed).toBe(false);
    // The unsized option beside it is still asked for its effect.
    expect(issues.find(i => i.option_id === LEGACY)?.statement_subject).toEqual({ kind: 'factor', id: LEGACY_TIME, option_id: LEGACY, field: 'level' });
  });
});

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
import { capacityRatioOutOfReach, shareChanceInputFailure, shareOptionEstimateWords, sharePartsForOption } from '../../goal-target/share-by-date-run.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { approvalChipsFor } from '../approval-chips.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { withShareByDateChanceGate } from '../../goal-target/goal-chance-range.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';

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
      + 'sets ‘Legacy-code fixing time’ to 15% of developer time (25% of developer time today), and the time freed goes to next feature launch, so the '
      + 'team’s capacity for it becomes about 113% of today’s. Olumi assumes this takes effect from now; say if it would start later. The model gains '
      + 'one part, ‘Reduce legacy-fix time frees time for next feature launch’, linked to the goal.');
    expect(w.registers).toHaveLength(0); // nothing is written by the offer
    const chips = approvalChipsFor([{ name: 'propose_option_capacity_change', ok: true, mutated: false, proposal_id: r.proposal_id }] as never,
      (id: string) => ({ proposal: w.proposals.get(id), result: r }) as never);
    // A card-only card: its press carries the card's own words; the second chip changes it first.
    expect(chips.map((c: Rec) => c.label), JSON.stringify(chips)).toEqual(['Use this', 'Change something first']);
    expect(chips[0]!.detail).toBe(r.public_label);

    const done = await press(w, r.proposal_id);
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true, applied: true, mutated: true });
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
      + '(25% of developer time today), Olumi’s reading that the time freed goes to ‘next feature launch’, so the team’s capacity for it is about 113% '
      + 'of today’s, and Olumi’s provisional assumption that delivery pace changes in proportion to that capacity from now');
    // On his own 7–8 months the user's bound decides (PL 6135017311 item 1): out of reach, with the arithmetic, never a tail figure.
    expect(shareChanceInputFailure(g, LEGACY)).toBeNull();
    expect(capacityRatioOutOfReach(g, LEGACY)).toMatch(/^No chance is shown for this option: on your own soonest estimate it can’t reach 100% of next feature launch by 14 April 2027\. Even at 7 months, it gets about 97% done by then/);
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

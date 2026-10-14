/**
 * Paul's legacy-code brief (14 Oct, scenario c1494f4d): an event-by-date option with no Olumi pace acts through the brief's own
 * capacity chain (`eventCapacityRatios`). Real construction (`buildModelFromBrief`) on the persisted drafter answer; the
 * provider is scripted. L2 (admission): the option gets its own switch. L3: its size comes from the team's own share once that
 * is held (`withRatioCarrierSizes`), and only then may a chance rest on it. L4: the licence (DL ruling (A), conditions 1–4).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { eventByDateAdmissionRefusal, unresolvedEventOptionIds, withEventShareDate, withRatioCarrierSizes } from '../../goal-target/event-by-date-model.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { CAPACITY_RATIO_COMPARISON_WITHHELD, withoutCapacityRatioComparison, withShareByDateChanceGate } from '../../goal-target/goal-chance-range.js';
import { CAPACITY_RATIO_ASSUMPTION_NOTE, CAPACITY_RATIO_COMPARISON_NOTE, capacityRatioOutOfReach, shareChanceInputFailure, shareOptionEstimateWords, sharePartsForOption } from '../../goal-target/share-by-date-run.js';
import { normalChance } from '../../goal-target/event-by-date-share.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import { goalChanceWithheldReasonsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-c1494f4d-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; brief_sha256: string; raw_text: string; raw_sha256: string };
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;

async function construct(answer: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('c1494f4d-13f9-4216-ac62-35871c7ff207', FX.brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  }) as never, (async () => ({ text: JSON.stringify(answer), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return graph!;
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
/** Paul's 7–8 months, saved through the real team-time write (which sizes the ratio link, L3). */
/** Paul's own words for his team's time (capture 5b52ff13): "At least 7 months" (a hard lower end), then "8 months" for the likely upper end. */
const PAUL_TEAM_STATEMENTS = [
  { speaker: 'user', quote: 'At least 7 months', source: 'At least 7 months', subject: { quantity: 'months_to_finish' }, form: 'lower_bound',
    low: 7, unit: 'months', reading: 'olumi' },
  { speaker: 'user', quote: '8 months', source: '8 months', subject: { quantity: 'months_to_finish' }, form: 'upper_bound', high: 8,
    unit: 'months', qualifier: 'likely', qualifier_in_quote: false, answering: 'the likely upper end', reading: 'olumi' },
];
async function saved(low = 7, high = 8, extra: Rec = { statements: PAUL_TEAM_STATEMENTS }): Promise<Rec> {
  const dated = withEventShareDate(await construct(draft()), '2027-04-14', '2026-10-14') as Rec;
  const result = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: low, high_months: high,
    deadline: '2027-04-14', reference_date: '2026-10-14', ...extra } as never, computeAnalysisAffectingGraphHash(dated as never)!);
  if (result.kind !== 'mutated') throw new Error(JSON.stringify(result));
  return result.mutatedGraph as Rec;
}
const envelope = (): Rec => ({ option_comparison: [['event_option_1', 0.2], ['event_option_2', 0.3], ['event_option_3', 0.5]]
  .map(([id, w]) => ({ option_id: id, probability_of_goal: 0.004, win_probability: w, outcome: { p10: 0.6, p50: 0.8, p90: 0.95 },
    probability_of_goal_drivers: { rows: [] } })),
  inference_warnings: [] as Rec[] });
/** The engine's chance read off the graph CEE sends: goal = C·T + X, C the team link, X the option's ratio link (Normal). */
function engineChance(g: Rec, switchId: string): number {
  const team = node(g, 'event_team').observed_state, c = g.edges.find((e: Rec) => e.from === 'event_team').strength;
  const X = g.edges.find((e: Rec) => e.from === switchId).strength;
  const mean = c.mean * team.value + X.mean;
  const sd = Math.sqrt(c.mean ** 2 * team.std ** 2 + c.std ** 2 * (team.value ** 2 + team.std ** 2) + X.std ** 2);
  return upperTail((1 - mean) / sd);
}
/** Normal upper tail, written independently of the engine (Numerical Recipes erfc, fractional error < 1.2e-7). */
function upperTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
const LEGACY = 'event_option_2', CARRY_ON = 'event_option_1', LEGACY_SWITCH = 'event_capacity_2';

describe('L2: an event option with no Olumi pace acts through the brief\'s own capacity chain', () => {
  it('PRECONDITION: the persisted answer is byte-exact; the legacy option has no pace and a stated product identity reaches the goal', () => {
    expect(createHash('sha256').update(FX.brief, 'utf8').digest('hex')).toBe(FX.brief_sha256);
    expect(createHash('sha256').update(FX.raw_text, 'utf8').digest('hex')).toBe(FX.raw_sha256);
    expect(draft().options[1]).toMatchObject({ label: 'Legacy-code reduction', added_capacity: null });
    expect(draft().identities[0]).toMatchObject({ outcome: 'Feature development capacity', operation: 'product' });
  });

  it('⭐ RED→GREEN: the legacy option gets its own switch carrying its ratio (510/450); it is no longer a clone of carrying on', async () => {
    const g = await construct(draft());
    const sw = node(g, LEGACY_SWITCH);
    expect(sw.observed_state.extra_share_by_date).toMatchObject({ capacity_ratio: 510 / 450, lead_low: 0, lead_high: 0 });
    expect(node(g, LEGACY).interventions[LEGACY_SWITCH]).toEqual({ value: 1 });
    expect(node(g, CARRY_ON).interventions[LEGACY_SWITCH]).toEqual({ value: 0 });
    expect(node(g, LEGACY).interventions).not.toEqual(node(g, CARRY_ON).interventions);
    expect(unresolvedEventOptionIds(g)).toEqual([]);
    // One mechanism per option (DL ruling): the hire keeps its pace switch and gets no ratio carrier.
    expect(node(g, 'event_capacity_3').observed_state.extra_share_by_date).toMatchObject({ monthly_share: 8 });
    expect(node(g, 'event_capacity_3').observed_state.extra_share_by_date.capacity_ratio).toBeUndefined();
  });

  it('⭐ L3 + PL 6135017311 (bounds beat the tail): with Paul\'s 7–8 months the link is sized, and his own 7-month floor puts 100% out of reach, so the arithmetic is said, not a tail chance', async () => {
    const dated = withEventShareDate(await construct(draft()), '2027-04-14', '2026-10-14') as Rec;
    // Before the team time is held, nothing sizes the link and no chance rests on it.
    expect(dated.edges.find((e: Rec) => e.from === LEGACY_SWITCH).defaulted).toBe(true);
    expect(sharePartsForOption(dated, LEGACY)).toBeNull();
    const g = await saved();
    const link = g.edges.find((e: Rec) => e.from === LEGACY_SWITCH);
    expect(link.defaulted).toBeUndefined();
    expect(node(g, LEGACY_SWITCH).observed_state.extra_share_by_date.ratio_sizing.rule).toBe('marginal_normal');
    expect(sharePartsForOption(g, LEGACY)).toMatchObject({ ratio: 510 / 450 });
    // 6 months × 17/15 ÷ 7 months = 34/35: even at the soonest time the option gets about 97% done by the deadline.
    const gated = withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec;
    const legacy = (gated.inference_warnings as Rec[]).filter((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION
      && Array.isArray(w.option_ids) && w.option_ids.includes(LEGACY));
    expect(legacy.map((w) => w.message)).toEqual(['No chance is shown for this option: on your own soonest estimate it can’t reach '
      + '100% of next feature launch by 14 April 2027. Even at 7 months, it gets about 97% done by then (7 months of work at 113% of '
      + 'today’s capacity is still about 6.2 months, past the 6 months to the deadline).']);
    expect(gated.option_comparison.find((r: Rec) => r.option_id === LEGACY).probability_of_goal).toBeUndefined();
    // CONTRAST: on a reachable estimate (5–7 months) the same option is licensed and keeps its chance.
    const reachable = withShareByDateChanceGate(envelope(), await saved(5, 7), 'event_goal') as Rec;
    expect((reachable.inference_warnings as Rec[]).filter((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION
      && Array.isArray(w.option_ids) && w.option_ids.includes(LEGACY))).toEqual([]);
    expect(reachable.option_comparison.find((r: Rec) => r.option_id === LEGACY).probability_of_goal).toBe(0.004);
  });

  it('⛔ PL (wrong-author class): an OLUMI endpoint is never "your own soonest estimate" — Olumi\'s 7–9 from a bare "8" makes no out-of-reach claim', async () => {
    const g = await saved(7, 9, { forecast_months: 8, forecast_words: '8 months', range_origin: 'olumi_estimate',
      statements: [{ speaker: 'user', quote: '8 months', source: '8 months', subject: { quantity: 'months_to_finish' }, form: 'point',
        low: 8, high: 8, unit: 'months', reading: 'olumi' }] });
    expect(node(g, 'event_team').observed_state.stated_time).toMatchObject({ low: 7, high: 9, range_origin: 'olumi_estimate' });
    // The same arithmetic as Paul's (6 × 17/15 ÷ 7 < 1), but the 7 is Olumi's: no "your own" claim; the engine's result stands.
    expect(capacityRatioOutOfReach(g, LEGACY)).toBeNull();
    const gated = withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec;
    expect(JSON.stringify(gated.inference_warnings)).not.toContain('your own soonest estimate');
    expect(gated.option_comparison.find((r: Rec) => r.option_id === LEGACY).probability_of_goal).toBe(0.004);
  });

  it('⭐ NUMERICAL (local Normal-CDF match, AIE 6175233964; not the engine, not a shown figure): the sized link gives the Normal approximation of k × the team\'s contribution, for a fixed k', async () => {
    const g = await saved();
    // Hand: 6 months to 14 April 2027; T = 6/U, U uniform on 7–8 months. E[T] = 6·ln(8/7), E[T²] = 36·(1/7 − 1/8).
    // r = (6 × 85%) / (6 × 75%) = 510/450, fully effective from now (L = 0), so k = r. The team's contribution is B = C·T with
    // the engine's held coefficient C ~ (1, 0.01): Var(B) = sd² + 0.01²·E[T²]. Under the Normal approximation k·B has mean
    // k·m and sd k·σB. (The exact uniform-time reference differs: 0 here, since 6.8 months of work is under the 7-month floor.)
    const r = 510 / 450, m = 6 * Math.log(8 / 7), sd = Math.sqrt(36 * (1 / 7 - 1 / 8) - m * m);
    const sB = Math.sqrt(sd * sd + 0.01 ** 2 * (m * m + sd * sd));
    const hand = upperTail((1 - r * m) / (r * sB));
    expect(engineChance(g, LEGACY_SWITCH)).toBeCloseTo(hand, 6);
    // Never shown on these figures: the 7-month floor makes 100% unreachable (the L3 row), so this is a sizing check only.
    // CEE's own Normal reference for the licence agrees.
    expect(normalChance(sharePartsForOption(g, LEGACY)!, 1)).toBeCloseTo(hand, 6);
  });

  it('⭐ AIE 6175233964: an effect fully effective L months into the window uses k = 1+(r−1)·max(0,H−L)/H, never r', async () => {
    const g = await saved();
    Object.assign(node(g, LEGACY_SWITCH).observed_state.extra_share_by_date, { lead_low: 2, lead_high: 2 });
    withRatioCarrierSizes(g);
    const r = 510 / 450, k = 1 + (r - 1) * (6 - 2) / 6;
    expect(sharePartsForOption(g, LEGACY)!.ratio).toBeCloseTo(k, 12);
    const m = 6 * Math.log(8 / 7), sd = Math.sqrt(36 * (1 / 7 - 1 / 8) - m * m), sB = Math.sqrt(sd * sd + 0.01 ** 2 * (m * m + sd * sd));
    expect(engineChance(g, LEGACY_SWITCH)).toBeCloseTo(upperTail((1 - k * m) / (k * sB)), 6);
    expect(shareOptionEstimateWords(g, LEGACY)).toContain('in proportion to ‘Feature development capacity’ from 2 months in');
    // CONTRAST (fail closed): an uncertain start has no single k, so the link is unsized and the chance withheld with its reason.
    Object.assign(node(g, LEGACY_SWITCH).observed_state.extra_share_by_date, { lead_low: 1, lead_high: 3 });
    withRatioCarrierSizes(g);
    expect(g.edges.find((e: Rec) => e.from === LEGACY_SWITCH).defaulted).toBe(true);
    expect(sharePartsForOption(g, LEGACY)).toBeNull();
    const gated = withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec;
    expect((gated.inference_warnings as Rec[]).find((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION
      && Array.isArray(w.option_ids) && w.option_ids.includes(LEGACY))?.message).toMatch(/^Not shown\. This option's start is given as a range/);
  });

  it('⛔ DL ruling (A) 2: no win share or leader for a compared ratio option, with one reason; every chance stays', async () => {
    const g = await saved(5, 7);
    const out = withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec;
    for (const row of out.option_comparison as Rec[]) {
      expect(row.win_probability, row.option_id).toBeUndefined();
      expect(row.probability_of_goal, row.option_id).toBe(0.004);
    }
    const reason = (out.inference_warnings as Rec[]).filter((w) => w.code === CAPACITY_RATIO_COMPARISON_WITHHELD);
    expect(reason).toHaveLength(1);
    expect(reason[0]).toMatchObject({ option_ids: [LEGACY], message: CAPACITY_RATIO_COMPARISON_NOTE, win_shares_withheld: true });
    // AIE 6175233964: the ratio option's main-driver block rests on the lost coupling, so it goes; the others keep theirs.
    expect((out.option_comparison as Rec[]).map((r) => r.probability_of_goal_drivers === undefined))
      .toEqual([false, true, false]);
    // The card says why once, and what the ratio chance leaves out (PL L3), beside the licensed chances.
    const licence = goalChanceLicenceOf(out, g, 'event_goal')!;
    expect(licence.notes).toEqual([CAPACITY_RATIO_ASSUMPTION_NOTE, CAPACITY_RATIO_COMPARISON_NOTE]);
    // CONTRAST: the same envelope on the model without the legacy option's ratio keeps every share.
    const noRatio = withoutCapacityRatioComparison(envelope(), { ...g, nodes: g.nodes.filter((n: Rec) => n.id !== LEGACY_SWITCH) }) as Rec;
    expect((noRatio.option_comparison as Rec[]).map((r) => r.win_probability)).toEqual([0.2, 0.3, 0.5]);
  });

  it('⭐ DL ruling (A) 3 + AIE 6174736249: the chance line names each Olumi assumption: the identity, the derived 75%, the 15% and proportional pace', async () => {
    expect(shareOptionEstimateWords(await saved(), LEGACY)).toBe('using Olumi’s reading that ‘Feature development capacity’ = '
      + '‘Mid-weight developers’ × ‘Time on feature work’ (with ‘Time on feature work’ at 75% of development time today, worked out on '
      + 'Olumi’s assumption that the time is split only between it and ‘Time on legacy fixes’), Olumi’s proposed setting of '
      + '‘Time on legacy fixes’ at 15% of development time, and Olumi’s provisional assumption that delivery pace changes in '
      + 'proportion to ‘Feature development capacity’ from now');
  });

  it('⛔ CONTRAST (fail closed): a hand-edited ratio size no longer matches the team share, so no chance rests on it', async () => {
    const g = await saved();
    g.edges.find((e: Rec) => e.from === LEGACY_SWITCH).strength.std *= 0.25;
    expect(sharePartsForOption(g, LEGACY)).toBeNull();
  });

  it('CONTRAST (fail closed): a ratio below 1 gives no switch, with its reason; the option stays unresolved', async () => {
    const d = draft();
    d.options[1].interventions[0].value = 35; // legacy 25% → 35%: feature time 75% → 65%, r < 1
    const g = await construct(d);
    expect(node(g, LEGACY_SWITCH)).toBeUndefined();
    expect(unresolvedEventOptionIds(g)).toEqual([LEGACY]);
  });
});

describe('PL 6135017311 item 3: a live compiler — r follows the SAVED figures on every committed revision', () => {
  const LEGACY_FIX = 'event_context_6', FEATURE = 'event_context_7', DEVS = 'event_context_8';
  const commit = (g: Rec): Rec => projectGraphForPersistence(g) as Rec;
  const extra = (g: Rec): Rec => node(g, LEGACY_SWITCH).observed_state.extra_share_by_date;

  it('PRECONDITION: r is compiled by id from the saved capacity factors (kept out of the computed graph) and the option\'s 15% held on its carrier', async () => {
    const g = await saved();
    for (const id of [LEGACY_FIX, FEATURE, DEVS]) expect(node(g, id).analysis_participation, id).toBe('retained_excluded');
    // No lever on a kept-out factor (the participation guard would refuse the Run); the setting rides on the carrier.
    expect(node(g, LEGACY).interventions[LEGACY_FIX]).toBeUndefined();
    expect(extra(g).ratio_source).toEqual({ factor_ids: [DEVS, FEATURE], set_ids: [LEGACY_FIX], settings: { [LEGACY_FIX]: 15 },
      derived: { [FEATURE]: { source_id: LEGACY_FIX, total: 100 } } });
    expect(extra(g).capacity_ratio).toBeCloseTo(85 / 75, 12);
    // A committed revision is a fixed point (stored bases stay editable).
    expect(commit(g)).toEqual(normaliseAbsenceOnly(g));
    expect(commit(commit(g))).toEqual(commit(g));
  });

  it('⭐ RED→GREEN: an edit to the 25% re-derives feature time (two-way split) and recompiles r and the link size', async () => {
    const g = await saved();
    const before = structuredClone(g.edges.find((e: Rec) => e.from === LEGACY_SWITCH).strength);
    Object.assign(node(g, LEGACY_FIX).observed_state, { raw_value: 20, value: 0.2 });
    const after = commit(g);
    expect(extra(after).capacity_ratio).toBeCloseTo(85 / 80, 12); // feature time 80% today → 85% with the option
    expect(extra(after).ratio_basis.factors[1]).toMatchObject({ label: 'Time on feature work', today: 80, withOption: 85 });
    expect(after.edges.find((e: Rec) => e.from === LEGACY_SWITCH).strength.mean).toBeLessThan(before.mean);
    expect(shareOptionEstimateWords(after, LEGACY)).toContain('‘Time on feature work’ at 80% of development time today');
    // PL (14 Oct): one value everywhere — feature time's OWN saved figure follows (the card and the AI input read it), still Olumi's.
    expect(node(after, FEATURE).observed_state).toMatchObject({ raw_value: 80, value: 0.8, source: 'cee_inference' });
  });

  it('⛔ PL (14 Oct): the user\'s own edit to feature time (70%) wins — kept, never overwritten, and the derivation ends', async () => {
    const g = await saved();
    Object.assign(node(g, FEATURE).observed_state, { raw_value: 70, value: 0.7, source: 'user_override' });
    const after = commit(g);
    expect(node(after, FEATURE).observed_state).toMatchObject({ raw_value: 70, source: 'user_override' });
    expect(extra(after).ratio_source.derived).toEqual({});
    // 70% today; the option's 15% legacy frees 10 points through the drafted −1-per-1 link: 80% with it.
    expect(extra(after).capacity_ratio).toBeCloseTo(80 / 70, 12);
    expect(extra(after).ratio_basis.factors[1]).toMatchObject({ label: 'Time on feature work', today: 70, withOption: 80 });
    expect(extra(after).ratio_basis.factors[1].derived).toBeUndefined();
    expect(shareOptionEstimateWords(after, LEGACY)).not.toContain('worked out on Olumi’s assumption');
  });

  // ⛔ PL (14 Oct, #3127 first pass): whose figure it is comes from POSITIVE evidence only (`valueAuthorshipOf`).
  it.each([
    // `valueAuthorshipOf` defers an unrecognised or missing source to the node's own extraction type (an `inferred` figure is
    // Olumi's by that stamp); with no recognised stamp of either kind, whose figure it is is unknown.
    ['an unrecognised source and no extraction type', (os: Rec) => { os.source = 'store'; delete os.extractionType; }],
    ['no source and no extraction type', (os: Rec) => { delete os.source; delete os.extractionType; }],
    ['no source and an unrecognised extraction type', (os: Rec) => { delete os.source; os.extractionType = 'pasted'; }],
  ] as const)('⛔ PL: feature time with %s is neither relabelled nor overwritten; the option\'s chance waits for it to be confirmed', async (_name, stamp) => {
    const g = await saved();
    stamp(node(g, FEATURE).observed_state);
    const was = structuredClone(node(g, FEATURE).observed_state);
    const basisWas = structuredClone(extra(g).ratio_basis.factors[1]);
    Object.assign(node(g, LEGACY_FIX).observed_state, { raw_value: 20, value: 0.2 });
    const after = commit(g);
    expect(node(after, FEATURE).observed_state, 'never overwritten as Olumi-owned').toEqual(was);
    expect(extra(after).ratio_basis.factors[1], 'never relabelled (neither as the person\'s nor re-derived)').toEqual(basisWas);
    expect(extra(after).ratio_source_owner_unknown).toEqual(['Time on feature work']);
    expect(shareChanceInputFailure(after, LEGACY)).toBe("Not shown. This option's effect is worked out from ‘Time on feature work’, and the "
      + "model doesn't record whether that figure is yours or Olumi's estimate. Confirm or edit ‘Time on feature work’ to show this option's chance.");
  });

  it('⛔ PL: Olumi\'s 75% that the user ACCEPTED stays Olumi\'s estimate and keeps the accepted figure (never overwritten)', async () => {
    const g = await saved();
    Object.assign(node(g, FEATURE).observed_state, { source: 'user_assumption', reviewed_by_user: { intent: 'confirm', at: '2026-10-14T20:00:00Z' } });
    Object.assign(node(g, LEGACY_FIX).observed_state, { raw_value: 20, value: 0.2 });
    const after = commit(g);
    expect(node(after, FEATURE).observed_state).toMatchObject({ raw_value: 75, source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } });
    expect(extra(after).ratio_source_owner_unknown).toBeUndefined();
    expect(extra(after).ratio_basis.factors[1]).toMatchObject({ label: 'Time on feature work', today: 75, estimated: true });
    expect(shareOptionEstimateWords(after, LEGACY)).toContain('‘Time on feature work’ at 75% of development time today, Olumi’s estimate');
    expect(shareOptionEstimateWords(after, LEGACY)).not.toContain('worked out on Olumi’s assumption');
  });

  it('⭐ the option\'s setting (15% → 10%) recompiles r; an edit to the 6 developers is read live and cancels in this option\'s ratio', async () => {
    const g = await saved();
    extra(g).ratio_source.settings[LEGACY_FIX] = 10;
    expect(extra(commit(g)).capacity_ratio).toBeCloseTo(90 / 75, 12);
    expect(extra(commit(g)).ratio_basis.settings[0]).toMatchObject({ label: 'Time on legacy fixes', value: 10 });
    const h = await saved();
    Object.assign(node(h, DEVS).observed_state, { raw_value: 7, value: 7 / 30 });
    expect(extra(commit(h)).ratio_basis.factors[0]).toMatchObject({ label: 'Mid-weight developers', today: 7, withOption: 7 });
    expect(extra(commit(h)).capacity_ratio).toBeCloseTo(85 / 75, 12);
  });

  it('⛔ CONTRAST (fail closed): a setting that slows the team, or an unreadable figure, shows no chance, each with its reason', async () => {
    const g = await saved(5, 7);
    extra(g).ratio_source.settings[LEGACY_FIX] = 30;
    const slower = commit(g);
    expect(extra(slower).capacity_ratio).toBeCloseTo(70 / 75, 12);
    expect(sharePartsForOption(slower, LEGACY)).toBeNull();
    expect(shareChanceInputFailure(slower, LEGACY)).toBe("Not shown. With the model's current figures this option lowers the team's "
      + "capacity (to 93% of today), and this deadline forecast doesn't yet model an option that slows the team down.");
    const h = await saved(5, 7);
    delete node(h, LEGACY_FIX).observed_state.raw_value;
    const unreadable = commit(h);
    expect(extra(unreadable).ratio_source_unreadable).toBe(true);
    expect(shareChanceInputFailure(unreadable, LEGACY)).toBe("Not shown. This option's effect is worked out from the model's capacity "
      + 'figures, and one of them is missing or unreadable now.');
  });

  it('⭐ DL: the exact node and edge set the Run sends to PLoT for Paul\'s graph (the capacity factors stay out; only the compiled carrier is sent)', async () => {
    const g = await saved(5, 7);
    const store = { readMostRecentPendingActions: async () => [], loadGraph: async () => structuredClone(g),
      loadGraphAndBriefText: async () => ({ graph: structuredClone(g), briefText: null }) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis('c1494f4d-13f9-4216-ac62-35871c7ff207', 'req-l5', store as never);
    const golden = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
    golden.results = [CARRY_ON, LEGACY, 'event_option_3'].map((id) => ({ ...golden.results[0], option_id: id, probability_of_goal: 0.4 }));
    const run = vi.fn(async (_body: unknown) => structuredClone(golden));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn(async () => ({})) } as never,
      scenarioReader: vi.fn(async () => snapshot) });
    await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: 'c1494f4d-13f9-4216-ac62-35871c7ff207', request_id: 'req-l5', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ scenario_id: 'c1494f4d-13f9-4216-ac62-35871c7ff207', message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-l5', signal: new AbortController().signal, orientationText: '',
    } as never);
    expect(run).toHaveBeenCalledOnce();
    const sent = (run.mock.calls[0]![0] as Rec).graph as Rec;
    expect(sent.nodes.map((n: Rec) => n.id).sort()).toEqual(['event_capacity_2', 'event_capacity_3', 'event_decision', 'event_goal',
      'event_option_1', 'event_option_2', 'event_option_3', 'event_team']);
    expect(sent.edges.map((e: Rec) => `${e.from}->${e.to}`).sort()).toEqual(['event_capacity_2->event_goal', 'event_capacity_3->event_goal',
      'event_decision->event_option_1', 'event_decision->event_option_2', 'event_decision->event_option_3',
      'event_option_1->event_capacity_2', 'event_option_1->event_capacity_3', 'event_option_2->event_capacity_2',
      'event_option_2->event_capacity_3', 'event_option_3->event_capacity_2', 'event_option_3->event_capacity_3', 'event_team->event_goal']);
    // The legacy switch's link carries the size compiled from the saved figures (the persisted graph's own).
    expect(sent.edges.find((e: Rec) => e.from === LEGACY_SWITCH).strength.mean)
      .toBeCloseTo(g.edges.find((e: Rec) => e.from === LEGACY_SWITCH).strength.mean, 12);
  });
});

describe('Paul\'s legacy brief on the served drafter (capture e635a126, 14 Oct): a stated deadline keeps its forecast when the options act only through the capacity chain', () => {
  const SERVED = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-e635a126-raw-20261014.json', import.meta.url), 'utf8')) as {
    brief: string; brief_sha256: string; raw_text: string; raw_sha256: string };
  it('PRECONDITION: the served answer is byte-exact, kind event_by_date, and no option carries a pace', () => {
    expect(createHash('sha256').update(SERVED.raw_text, 'utf8').digest('hex')).toBe(SERVED.raw_sha256);
    expect(createHash('sha256').update(SERVED.brief, 'utf8').digest('hex')).toBe(SERVED.brief_sha256);
    const d = JSON.parse(SERVED.raw_text) as Rec;
    expect(d.goal).toMatchObject({ kind: 'event_by_date', deliverable: 'next feature launch', horizon_months: 6 });
    expect(d.options.map((o: Rec) => o.added_capacity)).toEqual([null, null, null]);
  });

  it('⭐ RED→GREEN: the deadline forecast is built, and each option acts through the chain (90/75 and 95/75), not the ordinary model', async () => {
    const g = await construct(JSON.parse(SERVED.raw_text) as Rec);
    expect(node(g, 'event_team')).toBeDefined();
    expect(node(g, 'event_goal')).toMatchObject({ goal_threshold_unit: '% of next feature launch' });
    expect(node(g, 'event_capacity_2').observed_state.extra_share_by_date.capacity_ratio).toBeCloseTo(90 / 75, 12);
    expect(node(g, 'event_capacity_3').observed_state.extra_share_by_date.capacity_ratio).toBeCloseTo(95 / 75, 12);
    expect(unresolvedEventOptionIds(g)).toEqual([]);
  });
});

describe('DL (14 Oct): a stated deadline keeps its forecast whatever options the AI drafts — six real drafts of Paul\'s brief', () => {
  const PROBE = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-probe-drafts-20261014.json', import.meta.url), 'utf8')) as {
    drafts: { id: string; raw_text: string; raw_sha256: string }[] };
  it('PRECONDITION: six byte-pinned drafts, each typed event_by_date with the brief\'s deadline words; five have no option with a pace', () => {
    expect(PROBE.drafts).toHaveLength(6);
    for (const d of PROBE.drafts) expect(createHash('sha256').update(d.raw_text, 'utf8').digest('hex'), d.id).toBe(d.raw_sha256);
    const parsed = PROBE.drafts.map((d) => JSON.parse(d.raw_text) as Rec);
    for (const c of parsed) expect(c.goal.kind).toBe('event_by_date');
    expect(parsed.filter((c) => c.options.some((o: Rec) => o.added_capacity != null)).length).toBe(1);
  });

  it('⭐ RED→GREEN: every draft builds the deadline forecast; an option with no mechanism is unresolved with its coaching reason, never a clone of carrying on', async () => {
    for (const d of PROBE.drafts) {
      const g = await construct(JSON.parse(d.raw_text) as Rec);
      expect(node(g, 'event_team'), d.id).toBeDefined();
      const options = g.nodes.filter((n: Rec) => n.kind === 'option');
      for (const o of options.filter((x: Rec) => x.is_baseline !== true)) {
        const acts = Object.entries(o.interventions ?? {}).some(([, v]) => (v as Rec)?.value === 1);
        expect(acts || unresolvedEventOptionIds(g).includes(o.id), `${d.id} ${o.label}`).toBe(true);
      }
    }
    // The first #3112 draft: its options set nothing, so each is withheld with the coaching step once the team's time is held.
    const first = PROBE.drafts.find((d) => d.id === 'p3112fix-1')!;
    const dated = withEventShareDate(await construct(JSON.parse(first.raw_text) as Rec), '2027-04-14', '2026-10-14') as Rec;
    const saved1 = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 7, high_months: 8,
      deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(dated as never)!);
    if (saved1.kind !== 'mutated') throw new Error(JSON.stringify(saved1));
    const ids = saved1.mutatedGraph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id as string);
    const gated = withShareByDateChanceGate({ option_comparison: ids.map((id: string) => ({ option_id: id, probability_of_goal: 0.2 })),
      inference_warnings: [] as Rec[] }, saved1.mutatedGraph, 'event_goal') as Rec;
    const why = (id: string) => (gated.inference_warnings as Rec[]).find((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION
      && Array.isArray(w.option_ids) && w.option_ids.includes(id))?.message;
    expect(why('event_option_1')).toBeUndefined(); // carrying on as now keeps its chance
    // #3092's reason names the kept-out part the option changes, then the coaching step.
    expect(why('event_option_2')).toBe('No chance is shown for this option yet: it changes ‘Legacy-code fix time share’, which this deadline '
      + "forecast doesn't use yet. Worth discussing: how much it would speed up the work, and from when.");
  });

  // DL ruling C (14 Oct): "whatever options" only with a capacity basis from the brief. Measured on recorded real drafts:
  // all 6 of Paul's state the team (6 developers / 25% of their time, quoted); none of T5 D2's 7 marketing-launch drafts
  // (first, served retry, reps 6–10) does, so they keep their ordinary model and its outcome goals.
  it('⭐ ruling C measure: Paul\'s 6 drafts are admitted; T5 D2\'s 7 marketing drafts (deadline stated, no capacity basis) are refused', () => {
    for (const d of PROBE.drafts) expect(eventByDateAdmissionRefusal(JSON.parse(d.raw_text) as never), d.id).toBeNull();
    const first = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
    const reps = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
    const d2: [string, unknown][] = [['draft_call1', first.draft_call1], ['draft_call2', first.draft_call2],
      ...Object.keys(reps).filter((k) => k.startsWith('retry_rep')).map((k): [string, unknown] => [k, reps[k]])];
    expect(d2).toHaveLength(7);
    for (const [k, raw] of d2) {
      const c = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Rec;
      expect(c.goal.kind === 'event_by_date' && c.goal.horizon_months > 0, `PRECONDITION ${k}: typed event, deadline stated`).toBe(true);
      expect(eventByDateAdmissionRefusal(c as never), k).not.toBeNull();
    }
  });
});

describe('AIE 6174736249 (retained origins) + PL (14 Oct): a figure the brief did not state is Olumi\'s; a split only from a DECLARED relation', () => {
  const served = (): Rec => JSON.parse(JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-e635a126-raw-20261014.json', import.meta.url), 'utf8')).raw_text) as Rec;
  const withTeam = async (d: Rec): Promise<Rec> => {
    const dated = withEventShareDate(await construct(d), '2027-04-14', '2026-10-14') as Rec;
    const r = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 5, high_months: 7,
      deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(dated as never)!);
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    return r.mutatedGraph as Rec;
  };

  it('⭐ the served draft (no declared split): the 75% feature time is "Olumi’s estimate", with NO dependency on the 25%', async () => {
    const g = await withTeam(served());
    expect(shareOptionEstimateWords(g, 'event_option_2')).toBe('using Olumi’s reading that ‘Feature development capacity’ = '
      + '‘Development team headcount’ × ‘Time on feature work’ (with ‘Time on feature work’ at 75% today, Olumi’s estimate), '
      + 'Olumi’s proposed setting of ‘Time on legacy fixes’ at 10% and ‘Time on feature work’ at 90%, and Olumi’s provisional '
      + 'assumption that delivery pace changes in proportion to ‘Feature development capacity’ from now');
    // ⛔ CONTRAST (PL): 25% + 75% = 100% by coincidence creates no link — an edit to the 25% leaves the ratio at 90/75.
    Object.assign(g.nodes.find((n: Rec) => n.label === 'Time on legacy fixes').observed_state, { raw_value: 20, value: 0.2 });
    expect(node(projectGraphForPersistence(g) as Rec, 'event_capacity_2').observed_state.extra_share_by_date.capacity_ratio).toBeCloseTo(90 / 75, 12);
  });

  it('⭐ a DECLARED sum of the two shares (total 100%) is Olumi\'s split: named, and re-derived when the stated 25% is edited', async () => {
    const d = served();
    d.factors.push({ label: 'Development time', role: 'observable', baseline_known: true, baseline_evidence: null, baseline_value: 100,
      unit: '%', provenance: 'inferred', plausible_max: 100 });
    d.identities.push({ outcome: 'Development time', operation: 'sum', factors: ['Time on legacy fixes', 'Time on feature work'],
      provenance: 'inferred', reading: null, evidence: null });
    const g = await withTeam(d);
    expect(shareOptionEstimateWords(g, 'event_option_2')).toContain('(with ‘Time on feature work’ at 75% today, worked out on Olumi’s '
      + 'assumption that the time is split only between it and ‘Time on legacy fixes’)');
    Object.assign(g.nodes.find((n: Rec) => n.label === 'Time on legacy fixes').observed_state, { raw_value: 20, value: 0.2 });
    expect(node(projectGraphForPersistence(g) as Rec, 'event_capacity_2').observed_state.extra_share_by_date.capacity_ratio).toBeCloseTo(90 / 80, 12);
  });
});

describe('DL (14 Oct): the hire WITH a pace read "Chance not shown yet" with no reason (capture de659cfd, turn 7)', () => {
  const HIRE = 'event_option_3';
  // The served Run's rows, in shape: the hire's every draw meets the target (p10 1.24, spread 0.07), so its 1 is exact but
  // not zero-spread; the Run's goal certainty did not earn it (no decision ⇒ unearned).
  const run = (hire: Rec): Rec => ({ option_comparison: [
    { option_id: CARRY_ON, probability_of_goal: 0.2, outcome: { p10: 0.7, p50: 0.85, p90: 0.98, std: 0.1 } },
    { option_id: LEGACY, probability_of_goal: 0.3, outcome: { p10: 0.75, p50: 0.9, p90: 1.02, std: 0.1 } },
    { option_id: HIRE, probability_of_goal: 1, ...hire }], inference_warnings: [] as Rec[] });
  const spread = { outcome: { p10: 1.2350859803491727, p50: 1.3259448831432001, p90: 1.4178740146926914, std: 0.07113488512172908 } };
  const LINE = 'No chance is shown for this option: this model has it reaching 100% of next feature launch by 14 April 2027 in every run, '
    + 'but that rests on Olumi’s estimates of hiring time (2–4 months) and of the additional progress from the hires (8% of next feature '
    + 'launch per month). Check Olumi’s estimates: how long hiring would take, and how much each hire adds per month.';

  it('⭐ RED→GREEN: the unearned 1 stays withheld (rule unchanged) and carries its reason, what it rests on and one step', async () => {
    const g = await saved(5, 7);
    const licence = goalChanceLicenceOf(run(spread), g, 'event_goal')!;
    expect(licence.withheld_option_ids).toContain(HIRE);
    expect(licence.pct_by_option[HIRE]).toBeUndefined();
    expect(licence.withheld_reason_by_option?.[HIRE]).toEqual({ reason: 'unearned_certainty', side: 'meets', line: LINE });
    // The cell's reader: the typed reason with its words, never `reason_not_recorded`.
    expect(goalChanceWithheldReasonsForAgent({ inference_warnings: [licence] }, HIRE)).toEqual([{ code: 'unearned_certainty', message: LINE }]);
  });

  it('CONTRASTS: an EARNED 1 is licensed (no reason); a zero-spread 1 keeps its own zero-spread reason', async () => {
    const g = await saved(5, 7);
    const earned = goalChanceLicenceOf(run(spread), g, 'event_goal', (id, p) => id === HIRE && p === 1)!;
    expect(earned.pct_by_option[HIRE]).toBe(100);
    expect(earned.withheld_reason_by_option?.[HIRE]).toBeUndefined();
    const flat = goalChanceLicenceOf(run({ outcome: { p10: 1.3, p50: 1.3, p90: 1.3, std: 0 } }), g, 'event_goal')!;
    expect(flat.withheld_reason_by_option?.[HIRE]?.reason).toBe('zero_spread');
    // DL: the step targets what the result rests on. A capacity-change option's unearned 1 → check Olumi's reading of it.
    const ratioRun = run(spread);
    Object.assign((ratioRun.option_comparison as Rec[])[1], { probability_of_goal: 1, ...spread });
    const ratioLine = goalChanceLicenceOf(ratioRun, g, 'event_goal')!.withheld_reason_by_option?.[LEGACY]?.line;
    expect(ratioLine).toMatch(/^No chance is shown for this option: this model has it reaching 100% of next feature launch by 14 April 2027 in every run, but that rests on Olumi’s reading that /);
    expect(ratioLine).toMatch(/ Check Olumi’s reading: how much this option changes the team’s capacity, and from when\.$/);
  });
});

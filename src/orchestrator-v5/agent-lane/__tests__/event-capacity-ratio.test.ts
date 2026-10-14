/**
 * Paul's legacy-code brief (14 Oct, scenario c1494f4d): an event-by-date option with no Olumi pace acts through the brief's own
 * capacity chain (`eventCapacityRatios`). Real construction (`buildModelFromBrief`) on the persisted drafter answer; the
 * provider is scripted. L2 (admission): the option gets its own switch. L3: its size comes from the team's own share once that
 * is held (`withRatioCarrierSizes`), and only then may a chance rest on it. L4: the licence (DL ruling (A), conditions 1–4).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { unresolvedEventOptionIds, withEventShareDate, withRatioCarrierSizes } from '../../goal-target/event-by-date-model.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { CAPACITY_RATIO_COMPARISON_WITHHELD, withoutCapacityRatioComparison, withShareByDateChanceGate } from '../../goal-target/goal-chance-range.js';
import { CAPACITY_RATIO_ASSUMPTION_NOTE, CAPACITY_RATIO_COMPARISON_NOTE, shareOptionEstimateWords, sharePartsForOption } from '../../goal-target/share-by-date-run.js';
import { normalChance } from '../../goal-target/event-by-date-share.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
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
async function saved(): Promise<Rec> {
  const dated = withEventShareDate(await construct(draft()), '2027-04-14', '2026-10-14') as Rec;
  const result = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 7, high_months: 8,
    deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(dated as never)!);
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

  it('⭐ L3: with the team\'s 7–8 months saved, the ratio link is sized from that same team share and the legacy option is licensed', async () => {
    const dated = withEventShareDate(await construct(draft()), '2027-04-14', '2026-10-14') as Rec;
    // Before the team time is held, nothing sizes the link and no chance rests on it.
    expect(dated.edges.find((e: Rec) => e.from === LEGACY_SWITCH).defaulted).toBe(true);
    expect(sharePartsForOption(dated, LEGACY)).toBeNull();
    const g = await saved();
    const link = g.edges.find((e: Rec) => e.from === LEGACY_SWITCH);
    expect(link.defaulted).toBeUndefined();
    expect(node(g, LEGACY_SWITCH).observed_state.extra_share_by_date.ratio_sizing.rule).toBe('marginal_normal');
    expect(sharePartsForOption(g, LEGACY)).toMatchObject({ ratio: 510 / 450 });
    const gated = withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec;
    expect((gated.inference_warnings as Rec[]).filter((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION),
      JSON.stringify(gated.inference_warnings)).toEqual([]);
    expect(gated.option_comparison.find((r: Rec) => r.option_id === LEGACY).probability_of_goal).toBe(0.004);
  });

  it('⭐ NUMERICAL (DL ruling (A) 1, AIE 6175233964): under the model\'s Normal approximation, the engine\'s legacy chance matches a hand-calculated P(r·T ≥ 100%) on 7–8 months, for a fixed r', async () => {
    const g = await saved();
    // Hand: 6 months to 14 April 2027; T = 6/U, U uniform on 7–8 months. E[T] = 6·ln(8/7), E[T²] = 36·(1/7 − 1/8).
    // r = (6 × 85%) / (6 × 75%) = 510/450, fully effective from now (L = 0), so k = r. The team's contribution is B = C·T with
    // the engine's held coefficient C ~ (1, 0.01): Var(B) = sd² + 0.01²·E[T²]. Under the Normal approximation k·B has mean
    // k·m and sd k·σB. (The exact uniform-time reference differs: 0 here, since 6.8 months of work is under the 7-month floor.)
    const r = 510 / 450, m = 6 * Math.log(8 / 7), sd = Math.sqrt(36 * (1 / 7 - 1 / 8) - m * m);
    const sB = Math.sqrt(sd * sd + 0.01 ** 2 * (m * m + sd * sd));
    const hand = upperTail((1 - r * m) / (r * sB));
    expect(engineChance(g, LEGACY_SWITCH)).toBeCloseTo(hand, 6);
    expect(hand).toBeGreaterThan(0.003); expect(hand).toBeLessThan(0.008); // under 1%
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
    const g = await saved();
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

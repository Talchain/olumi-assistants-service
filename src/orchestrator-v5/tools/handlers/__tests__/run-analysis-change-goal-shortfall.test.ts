/**
 * ⭐ HIRING ROW 3 (judge `codex/JUDGE-hiring-post3000-codex.md`, 14 Oct; DL GO, HIGH): THE WORST 1 IN 20 IS SAID FOR A CHANGE GOAL.
 *
 * Served hiring-post3000 (CEE d9b6f799), the "Run analysis" turn 17: the Run licensed each hiring option's conditional chance of
 * ‘Productivity’ up at least 10% from today (25%, 24%), and stored each option's worst 1 in 20 (`downside.p05`). But no
 * shortfall line was ever said, though capacity's level goal says it. First loss: `sentGoalThresholdOf` re-read the licence with
 * `sentRun` alone. A change goal whose effects are not stated at the period end is licensed only on its conditional reading,
 * which needs the brief and Olumi's timing reading (`periodEndConditionalOf`). So no threshold was recorded, and
 * `shortfallNotesOf` stopped at its first gate.
 *
 * The corpus is that Run's own graph, brief and option rows (`tests/fixtures/hiring-shortfall/…`, `_source`), through the REAL
 * Run handler with PLoT answering those rows. The first row asserts what was served.
 * ⭐ The words are the AIE's (#94 6160376175): on the bound percent change from today, the shortfall is a share of today's level
 * of the goal, "21% of today’s productivity": not percentage points, not a share of the target. Level targets keep today's words.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { goalChanceLicenceForAgent, goalChanceLicenceOf } from '../../../goal-target/goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from '../../../agent-lane/goal-chance-screen-lines.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/hiring-shortfall/served-hiring-post3000-run-turn17-20261014.json', 'utf8')) as Rec;
const SCENARIO = '2eb6131e-eef9-49da-bfb8-cd50888d2c58';
const LEAD = 'hire_a_tech_lead';
const TWO = 'hire_two_developers';
const rowOf = (id: string): Rec => (FX.option_comparison as Rec[]).find((r) => r.option_id === id)!;

/** The real Run handler on the served stored graph and brief; PLoT answers with the served rows. */
async function runServed(briefText: string | null, graph: Rec = FX.graph): Promise<Rec> {
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(graph), briefText, revision: 7 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-hiring-shortfall', port as never);
  const run = vi.fn(async () => ({ ...structuredClone(minimalFixture), option_comparison: structuredClone(FX.option_comparison) }));
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot });
  // The served licence records Olumi's reading for this Run: effects_timing 'not_stated' (origin 'olumi').
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-hiring-shortfall', kind: 'message',
    chip: { parameters: { effects_timing: FX.served_licence.effects_timing } } }, requestId: 'req-hiring-shortfall',
    signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
  expect(run).toHaveBeenCalledTimes(1);
  const fact = (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!;
  return fact.result as Rec;
}
const licenceOf = (result: Rec): Rec | undefined =>
  (result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_CHANCE_LICENSED');

describe('hiring row 3: the Run records its threshold on the licence it states, so a change goal says its worst 1 in 20', () => {
  it('precondition (served): each option licensed on its change target, its worst 1 in 20 stored, and no shortfall line', () => {
    expect(FX.served_licence).toMatchObject({ form: 'each', effects_timing: 'not_stated', effects_timing_origin: 'olumi',
      target: { unit: '%', frame: 'change_abs', value: 10, comparator: 'at_least' }, pct_by_option: { [LEAD]: 25, [TWO]: 24 } });
    expect(FX.served_licence).not.toHaveProperty('sent_threshold');
    expect(FX.served_licence).not.toHaveProperty('shortfall_note_by_option');
    expect(rowOf(LEAD).downside.p05).toBeCloseTo(-0.114, 3);
    expect(rowOf(TWO).downside.p05).toBeCloseTo(-0.152, 3);
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === 'productivity')!;
    expect(goal).toMatchObject({ goal_threshold: 0.1, goal_threshold_raw: 10, goal_threshold_cap: 100, goal_threshold_unit: '%',
      goal_target_basis: { target_frame: 'change_abs', effects_at_period_end: false, period_months: 3 } });
  });

  it('GREEN: the real Run records the one agreeing threshold, and each option says how far its worst 1 in 20 falls short', async () => {
    const result = await runServed(FX.brief);
    const licence = licenceOf(result)!;
    // The same licence as served: nothing about the chance itself moves.
    expect(licence).toMatchObject({ form: 'each', pct_by_option: FX.served_licence.pct_by_option, target: FX.served_licence.target });
    // The samples' frame: 0.1 lies inside each licensed option's p10..p90 (e.g. -0.079..0.319); 10 lies above every p90.
    expect(licence.sent_threshold).toEqual({ value: 0.1, field: 'goal_threshold', frame: 'delta' });
    // By hand from the served rows: target +10% of today's productivity minus the worst 1 in 20 on the target's scale
    // (p05 × cap 100): 10 − (−11.41) = 21.41 → "21% … or more"; 10 − (−15.20) = 25.20 → "25% … or more" (never rounded up).
    // The AIE's exact words (#94 6160376175), byte for byte for the tech lead.
    const lines = {
      [LEAD]: 'In its worst 1 in 20 runs of this model, ‘Hire a Tech Lead’ falls short of your target by 21% of today’s productivity or more.',
      [TWO]: 'In its worst 1 in 20 runs of this model, ‘Hire Two Developers’ falls short of your target by 25% of today’s productivity or more.',
    };
    expect(licence.shortfall_note_by_option).toEqual(lines);
    // What the Agent says: the screen line of each licensed option carries its shortfall.
    const said = Object.fromEntries(goalChanceScreenLinesForAgent(result.enrichment, FX.graph, true)
      .filter((l) => l.shortfall_note !== undefined).map((l) => [l.option_id, l.shortfall_note]));
    expect(said).toEqual(lines);
    expect(goalChanceLicenceForAgent({ type: 'analysis_result', enrichment: result.enrichment })?.shortfall_note_by_option).toEqual(lines);
  });

  it('CONTRAST (AIE binding): a "%" change measured from the launch, not today, says no shortfall, never an ambiguous "21%"', async () => {
    const graph = structuredClone(FX.graph) as Rec;
    const goal = (graph.nodes as Rec[]).find((n) => n.id === 'productivity')!;
    goal.goal_target_basis = { ...goal.goal_target_basis, reference: 'launch' };
    const licence = licenceOf(await runServed(FX.brief, graph));
    expect(licence?.pct_by_option, 'the chance itself is still licensed').toEqual(FX.served_licence.pct_by_option);
    expect(licence).not.toHaveProperty('shortfall_note_by_option');
  });

  /**
   * The served rows are in the NORMALISED frame this Run recorded (`goal_threshold` 0.1: p10 −0.079 is −7.9% of today's
   * productivity). The licence read with the Run's own inputs and that recorded threshold, on edited copies of those rows.
   */
  const licenceOnRows = (edit: (rows: Rec[]) => void, earned: (id: string, p: 0 | 1) => boolean = () => false): Rec => {
    const rows = structuredClone(FX.option_comparison) as Rec[]; edit(rows);
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === 'productivity')!;
    return goalChanceLicenceOf({ option_comparison: rows, inference_warnings: [] }, FX.graph, 'productivity', earned,
      { value: goal.goal_threshold, field: 'goal_threshold', frame: 'delta' }, FX.graph,
      { sentRun: { graph: FX.graph, goal_direction: 'maximise' }, brief: FX.brief, effects_timing: 'not_stated' }) as Rec;
  };

  it('FRAME: a worst 1 in 20 above its own p10 in the recorded frame says no line for that option (it passed by its sign before)', () => {
    // Tech lead's p05 −0.05 sits ABOVE its p10 −0.079: not a tail. As a raw −5 it was "below" the normalised −0.079.
    const l = licenceOnRows((rows) => { rows.find((r) => r.option_id === LEAD)!.downside.p05 = -0.05; });
    expect(l.pct_by_option).toEqual(FX.served_licence.pct_by_option);
    expect(l.shortfall_note_by_option).toEqual({
      [TWO]: 'In its worst 1 in 20 runs of this model, ‘Hire Two Developers’ falls short of your target by 25% of today’s productivity or more.' });
  });

  it('FRAME: an option with an earned 0% says its typical shortfall from its median in the recorded frame, by hand', () => {
    // Two developers, every run below +10%: median +5% of today's productivity → 10 − 5 = 5 (was 10 − 0.05 = 9.95: two frames).
    const l = licenceOnRows((rows) => {
      Object.assign(rows.find((r) => r.option_id === TWO)!, { probability_of_goal: 0,
        outcome: { p10: -0.02, p50: 0.05, p90: 0.08, mean: 0.05, std: 0.03, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1,
          percentiles_source: 'samples' }, downside: { p05: -0.04 } });
    }, (id, p) => id === TWO && p === 0);
    expect(l.pct_by_option).toMatchObject({ [TWO]: 0 });
    expect(l.shortfall_note_by_option?.[TWO]).toBe('In this model, ‘Hire Two Developers’ falls short of your target in almost every run, '
      + 'typically by about 5% of today’s productivity.');
  });

  /** The served graph with the goal's recorded fields changed (Codex #3008 r1's two probes, through the real handler). */
  const withGoalFields = (fields: Rec, basis: Rec = {}): Rec => {
    const graph = structuredClone(FX.graph) as Rec;
    const goal = (graph.nodes as Rec[]).find((n) => n.id === 'productivity')!;
    Object.assign(goal, fields, { goal_target_basis: { ...goal.goal_target_basis, ...basis } });
    return graph;
  };

  it('Codex #3008 r1 (unit): a change recorded in "percentage points" says no shortfall, never "21 percentage points of today’s …"', async () => {
    const licence = licenceOf(await runServed(FX.brief, withGoalFields({ goal_threshold_unit: 'percentage points' })));
    expect(licence?.pct_by_option, 'the chance itself is still licensed').toEqual(FX.served_licence.pct_by_option);
    expect(licence).not.toHaveProperty('shortfall_note_by_option');
    // Even with a basis that says the same unit of today's level, the unit itself is not a percent token.
    const consistent = withGoalFields({ goal_threshold_unit: 'percentage points' }, { effect_unit: "percentage points of today's productivity" });
    expect(licenceOf(await runServed(FX.brief, consistent))).not.toHaveProperty('shortfall_note_by_option');
  });

  it('Codex #3008 r1 (denominator): a % change of something other than today\'s level of the goal says no shortfall', async () => {
    const graph = withGoalFields({}, { denominator: 'maximum rated productivity', effect_unit: '% of maximum rated productivity' });
    const licence = licenceOf(await runServed(FX.brief, graph));
    expect(licence?.pct_by_option, 'the chance itself is still licensed').toEqual(FX.served_licence.pct_by_option);
    expect(licence).not.toHaveProperty('shortfall_note_by_option');
    // One recorded field is enough to withhold: the effect unit alone, or the denominator alone.
    for (const basis of [{ effect_unit: '% of maximum rated productivity' }, { denominator: 'maximum rated productivity' }]) {
      expect(licenceOf(await runServed(FX.brief, withGoalFields({}, basis))), JSON.stringify(basis)).not.toHaveProperty('shortfall_note_by_option');
    }
  });

  it('CONTRAST: the same Run with no brief read has no conditional licence, so no figure and no shortfall line (fail-safe)', async () => {
    const result = await runServed(null);
    expect(licenceOf(result)).toBeUndefined();
    expect(JSON.stringify(result.enrichment)).not.toContain('worst 1 in 20');
    expect(goalChanceScreenLinesForAgent(result.enrichment, FX.graph, true).filter((l) => l.shortfall_note !== undefined)).toEqual([]);
  });
});

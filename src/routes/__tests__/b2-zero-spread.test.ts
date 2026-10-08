/**
 * B2 d2, scenario 5e0fbc03, served by CEE f8ed674d: every point is withheld,
 * but Keep's zero-spread reason must still reach the canonical cell.
 * These are the lane's own stored witness bytes, not a new model or engine draw.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  GOAL_CHANCE_LICENSED, agentLicenceRecordOf, goalChanceDisplayForAgent,
  goalChanceDriverAvailabilityForAgent, goalChanceLicenceForAgent, goalChanceLicenceOf,
  nearestFiveGoalChancesForAgent, sentGoalThresholdOf, withGoalChanceLicence,
} from '../../orchestrator-v5/goal-target/goal-chance-licence.js';
import * as horizonLine from '../../orchestrator-v5/goal-target/zero-spread-horizon-line.js';
import {
  goalChanceFactsForAgent, goalChanceWithheldReasonsForAgent,
} from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { goalChanceScreenLinesForAgent } from '../../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { analysisResultForAgent } from '../../orchestrator-v5/agent-lane/decision-sensitivity.js';
import { projectGoalProbabilitiesForTransport } from '../../orchestrator-v5/compose/goal-probability-transport.js';
import { projectCanonicalAnalysisView } from '../canonical-analysis-view.js';

type Rec = Record<string, any>;
const ROOT = new URL('./fixtures/b2-zero-spread/', import.meta.url);
const bytes = (name: string): Buffer => readFileSync(new URL(name, ROOT));
const json = (name: string): Rec => JSON.parse(bytes(name).toString('utf8'));
const RUN = json('run.json');
const WIRE = json('read-graph-1791489457020.json');
const READ = WIRE.j;
const STAGING_CONTROL = json('starter-point-staging.json');
const GOAL = 'monthly_recurring_revenue';
const KEEP = 'keep_current_pricing';
const STARTER = 'launch_starter_tier';
const LINE = 'Not shown yet: needs month-by-month changes';
const IDS = ['raise_prices_10', STARTER, KEEP];
const keepReason = { reason: 'zero_spread', side: 'falls_short', line: LINE };
const sourceBlock = RUN.blocks.find((block: Rec) => block.type === 'analysis_result');

/**
 * The public fixture deliberately has no Keep P(goal): transport stripped its
 * unearned exact 0. Restore precisely that lane-observed producer input, then
 * send it through the real producer and transport again. No new engine draw.
 */
function producerEnvelope(starterPoint = false): Rec {
  const envelope = structuredClone(sourceBlock.enrichment);
  envelope.option_comparison.find((row: Rec) => row.option_id === KEEP).probability_of_goal = 0;
  if (starterPoint) envelope.option_comparison.find((row: Rec) => row.option_id === STARTER).probability_of_goal = 0.97;
  return envelope;
}

function reviewerEnvelope(): Rec {
  const envelope = producerEnvelope();
  envelope.option_comparison = envelope.option_comparison.filter((row: Rec) => [KEEP, STARTER].includes(row.option_id));
  const starter = envelope.option_comparison.find((row: Rec) => row.option_id === STARTER);
  starter.probability_of_goal = 1;
  starter.outcome = { p10: 130000, p50: 140000, p90: 150000, std: 10000, mean: 140000 };
  envelope.inference_warnings = [];
  return envelope;
}

function produced(envelope = producerEnvelope(), graph = READ.graph): Rec {
  const enrichment = withGoalChanceLicence(envelope, graph, GOAL);
  const publicEnrichment = projectGoalProbabilitiesForTransport(enrichment, RUN.goal_certainty);
  if (publicEnrichment === undefined) throw new Error('The stored B2 Run has no enrichment');
  const currentResult = { ...sourceBlock, enrichment: publicEnrichment };
  const runFact = { fact_type: 'run_analysis', result: {
    scenario_id: READ.scenario_id, run_id: READ.current_read.run_id,
    graph_hash_at_run: READ.current_read.computed_against_hash,
    computed_at: READ.current_read.run_state.computed_at,
    goal_certainty: RUN.goal_certainty, summary: currentResult.summary, enrichment,
  } };
  const canonicalView = projectCanonicalAnalysisView({ revision: 2, graph, runFact,
    derivation: { freshness: 'fresh', reason: 'graph_hash_match' },
    analysisState: READ.analysis_state, analysisReady: READ.current_read.analysis_ready,
    currentResult } as never);
  return { enrichment, public_enrichment: publicEnrichment, canonical_view: canonicalView,
    agent_facts: goalChanceFactsForAgent(currentResult, graph, true),
    screen_lines: goalChanceScreenLinesForAgent(currentResult, graph, true) };
}

const licenceRecord = (enrichment: Rec): Rec | undefined => enrichment.inference_warnings
  .find((warning: Rec) => warning.code === GOAL_CHANCE_LICENSED);
const keepCell = (view: Rec): Rec => view.options.find((row: Rec) => row.option_id === KEEP).cell;
const otherwise = (view: Rec): Rec => ({ ...view, options: view.options.filter((row: Rec) => row.option_id !== KEEP) });

describe('B2 d2: zero spread when no option has a licensed point', () => {
  it('pins the lane witness bytes and the original generic-empty-cell defect', () => {
    expect(createHash('sha256').update(bytes('run.json')).digest('hex'))
      .toBe('efc9c5380431027aec9d7d902bc91d1a496af2c74258b8846d9ac4339ed2e2e5');
    expect(createHash('sha256').update(bytes('read-graph-1791489457020.json')).digest('hex'))
      .toBe('b2a372adca05d3eb0baa91c9eb6b76a7cfa04cd7ce42328d8de8e80bfb5c47e4');
    expect(WIRE.build).toBe('f8ed674');
    expect(READ.scenario_id).toBe('5e0fbc03-8af8-488e-b02f-82c25499e59e');
    expect(STAGING_CONTROL.source_head).toBe('f8ed674dec63758a2945acaffebe67e26a5f0a4a');
    expect(READ.graph.nodes.find((node: Rec) => node.id === GOAL).goal_horizon_months).toBe(9);
    expect(READ.graph.nodes.some((node: Rec) => node.nonlinear_identity?.operation === 'accumulation')).toBe(false);
    expect(sourceBlock.enrichment.option_comparison.find((row: Rec) => row.option_id === KEEP))
      .not.toHaveProperty('probability_of_goal');
    expect(keepCell(READ.canonical_analysis_view)).toEqual({ kind: 'none' });
  });

  it('all-withheld Run: preserves Keep’s reason and face without any licensed point claim', () => {
    const envelope = producerEnvelope();
    const licence = goalChanceLicenceOf(envelope, READ.graph, GOAL);
    expect(licence).not.toBeNull();
    expect(licence).toMatchObject({ form: 'each', message: '', option_ids: IDS,
      pct_by_option: {}, withheld_option_ids: IDS, withheld_reason_by_option: { [KEEP]: keepReason } });
    for (const key of ['leader_option_id', 'next_option_id', 'similar_option_ids', 'summary_withheld',
      'sent_threshold', 'olumi_estimate_link_count']) {
      expect(licence).not.toHaveProperty(key);
    }
    const output = produced(envelope);
    const stored = licenceRecord(output.enrichment)!;
    const publicResult = { enrichment: output.public_enrichment };
    expect(stored.withheld_reason_by_option).toEqual({ [KEEP]: keepReason });
    expect(output.public_enrichment.option_comparison.find((row: Rec) => row.option_id === KEEP))
      .not.toHaveProperty('probability_of_goal');
    expect(goalChanceLicenceForAgent(publicResult)?.withheld_reason_by_option).toEqual({ [KEEP]: keepReason });
    expect(agentLicenceRecordOf(publicResult)).toBeDefined();
    expect(goalChanceDisplayForAgent(publicResult)).toBeUndefined();
    expect(goalChanceDriverAvailabilityForAgent(publicResult)).toBeUndefined();
    expect(nearestFiveGoalChancesForAgent(publicResult).size).toBe(0);
    expect(output.agent_facts).not.toHaveProperty('goal_chance_licence');
    expect(goalChanceWithheldReasonsForAgent(publicResult, KEEP)).toEqual([{ code: 'zero_spread', message: LINE }]);
    expect(keepCell(output.canonical_view)).toEqual({ kind: 'withheld',
      reasons: [{ code: 'zero_spread', message: LINE }], face: LINE });
    expect(keepCell(output.canonical_view).face.toLowerCase()).not.toContain('not shown yet in this model');
    expect(JSON.stringify(otherwise(output.canonical_view))).toBe(JSON.stringify(otherwise(READ.canonical_analysis_view)));
    expect(JSON.stringify(output)).not.toMatch(/Each option’s chance|has the highest|have similar chances|more likely to miss/);
    const forAgent = analysisResultForAgent({ ...sourceBlock, enrichment: output.public_enrichment }, READ.graph) as Rec;
    expect(JSON.stringify(forAgent)).not.toMatch(/Each option’s chance|has the highest|have similar chances|more likely to miss/);
    for (const row of forAgent.enrichment.option_comparison) expect(row).not.toHaveProperty('probability_of_goal');
  });

  it('reviewer row: an empty licence preserves Keep’s zero-spread reason and leaves unearned Starter none', () => {
    const output = produced(reviewerEnvelope());
    expect(licenceRecord(output.enrichment)).toMatchObject({ message: '', option_ids: [STARTER, KEEP],
      pct_by_option: {}, withheld_option_ids: [STARTER, KEEP], withheld_reason_by_option: { [KEEP]: keepReason } });
    const result = { enrichment: output.public_enrichment };
    expect(goalChanceWithheldReasonsForAgent(result, STARTER)).toEqual([]);
    expect(output.canonical_view.options.find((row: Rec) => row.option_id === STARTER).cell).toEqual({ kind: 'none' });
    expect(goalChanceWithheldReasonsForAgent(result, KEEP)).toEqual([{ code: 'zero_spread', message: LINE }]);
    expect(keepCell(output.canonical_view)).toEqual({ kind: 'withheld',
      reasons: [{ code: 'zero_spread', message: LINE }], face: LINE });
  });

  it('licensed-point control: a withheld option without a warning still has reason_not_recorded', () => {
    const envelope = reviewerEnvelope();
    envelope.option_comparison.find((row: Rec) => row.option_id === STARTER).probability_of_goal = 0.97;
    envelope.option_comparison.find((row: Rec) => row.option_id === KEEP).outcome = {
      p10: 110000, p50: 120000, p90: 130000, std: 10000, mean: 120000,
    };
    const output = produced(envelope);
    const stored = licenceRecord(output.enrichment)!;
    expect(stored.pct_by_option).toEqual({ [STARTER]: 97 });
    expect(stored.withheld_option_ids).toEqual([KEEP]);
    expect(stored).not.toHaveProperty('withheld_reason_by_option');
    expect(goalChanceWithheldReasonsForAgent({ enrichment: output.public_enrichment }, KEEP))
      .toEqual([{ code: 'reason_not_recorded', message: null }]);
    expect(keepCell(output.canonical_view)).toMatchObject({ kind: 'withheld',
      reasons: [{ code: 'reason_not_recorded', message: null }] });
  });

  it('Starter-point control: producer and transport stay byte-identical to staging; only Keep’s canonical reason and face gain the stored line', () => {
    const envelope = producerEnvelope(true);
    expect(JSON.stringify(goalChanceLicenceOf(envelope, READ.graph, GOAL)))
      .toBe(JSON.stringify(STAGING_CONTROL.licence));
    const output = produced(envelope);
    expect(JSON.stringify(output.enrichment)).toBe(JSON.stringify(STAGING_CONTROL.enrichment));
    expect(JSON.stringify(output.public_enrichment)).toBe(JSON.stringify(STAGING_CONTROL.public_enrichment));
    expect(JSON.stringify(output.agent_facts)).toBe(JSON.stringify(STAGING_CONTROL.agent_facts));
    expect(JSON.stringify(output.screen_lines)).toBe(JSON.stringify(STAGING_CONTROL.screen_lines));
    expect(licenceRecord(output.enrichment)!.withheld_reason_by_option).toEqual({ [KEEP]: keepReason });
    expect(JSON.stringify(otherwise(output.canonical_view)))
      .toBe(JSON.stringify(otherwise(STAGING_CONTROL.canonical_view)));
    expect(keepCell(output.canonical_view)).toEqual({ kind: 'withheld',
      reasons: [{ code: 'zero_spread', message: LINE }], face: LINE });
  });

  it('no zero-spread option and none licensed: keeps the null/no-new-record control unchanged', () => {
    const envelope = producerEnvelope();
    envelope.option_comparison.find((row: Rec) => row.option_id === KEEP).outcome = {
      p10: 110000, p50: 120000, p90: 130000, std: 10000, mean: 120000,
    };
    expect(goalChanceLicenceOf(envelope, READ.graph, GOAL)).toBeNull();
    expect(withGoalChanceLicence(envelope, READ.graph, GOAL)).toBe(envelope);
    const output = produced(envelope);
    expect(licenceRecord(output.enrichment)).toBeUndefined();
    expect(keepCell(output.canonical_view)).toEqual({ kind: 'none' });
  });

  it('no licensed point means no scoring-threshold or estimated-link claim, even with one threshold candidate', () => {
    const graph = structuredClone(READ.graph);
    delete graph.nodes.find((node: Rec) => node.id === GOAL).goal_threshold_raw;
    expect(sentGoalThresholdOf(producerEnvelope(), graph, GOAL)).toBeUndefined();
    const explicitSent = { field: 'goal_threshold' as const, frame: 'delta' as const, value: 0.8 };
    const licence = goalChanceLicenceOf(producerEnvelope(), READ.graph, GOAL, () => false, explicitSent);
    expect(licence).not.toBeNull();
    expect(licence).not.toHaveProperty('sent_threshold');
    expect(licence).not.toHaveProperty('olumi_estimate_link_count');
  });

  const malformed: { name: string; mutate: (record: Rec) => void; expectedReasons?: { code: string; message: null }[] }[] = [
    { name: 'unknown option identity', mutate: record => { record.withheld_reason_by_option = { unknown: keepReason }; } },
    { name: 'reason on a non-withheld option', mutate: record => { record.withheld_option_ids = IDS.filter(id => id !== KEEP); } },
    { name: 'conflicting displayed percentage', mutate: record => { record.pct_by_option[KEEP] = 0; },
      expectedReasons: [{ code: 'reason_not_recorded', message: null }] },
    { name: 'unrecognised reason kind', mutate: record => { record.withheld_reason_by_option[KEEP].reason = 'other'; } },
    { name: 'unrecognised target side', mutate: record => { record.withheld_reason_by_option[KEEP].side = 'unknown'; } },
    { name: 'empty stored line', mutate: record => { record.withheld_reason_by_option[KEEP].line = ''; } },
    { name: 'non-string stored line', mutate: record => { record.withheld_reason_by_option[KEEP].line = 42; } },
    { name: 'multiline stored line', mutate: record => { record.withheld_reason_by_option[KEEP].line = `${LINE}\nextra`; } },
  ];

  it.each(malformed)('fails closed for a malformed zero-spread reason: $name', ({ mutate, expectedReasons }) => {
    const record = structuredClone(goalChanceLicenceOf(producerEnvelope(), READ.graph, GOAL)) as Rec;
    mutate(record);
    const result = { inference_warnings: [record] };
    expect(goalChanceLicenceForAgent(result)).not.toHaveProperty('withheld_reason_by_option');
    expect(goalChanceWithheldReasonsForAgent(result, KEEP)).toEqual(expectedReasons ?? []);
  });

  it('duplicate licence records speak no zero-spread reason through the Agent reader', () => {
    const record = goalChanceLicenceOf(producerEnvelope(), READ.graph, GOAL);
    const result = { inference_warnings: [record, structuredClone(record)] };
    expect(goalChanceLicenceForAgent(result)).toBeUndefined();
    expect(agentLicenceRecordOf(result)).toBeUndefined();
    expect(goalChanceWithheldReasonsForAgent(result, KEEP)).toEqual([]);
  });

  it('selector row: changing the no-carrier + horizon selector changes only Keep’s line', () => {
    const before = produced();
    // Existing no-horizon wording, used only as a temporary selector control.
    // Science 93 keeps the production selector on the §(o′) wording above.
    const alternate = 'Falls short of £126,000 a month if today’s figures hold.';
    const selector = vi.spyOn(horizonLine, 'zeroSpreadNoCarrierHorizonLine').mockReturnValue(alternate);
    try {
      const after = produced();
      const expected = structuredClone(before);
      for (const key of ['enrichment', 'public_enrichment']) {
        licenceRecord(expected[key])!.withheld_reason_by_option[KEEP].line = alternate;
      }
      keepCell(expected.canonical_view).reasons[0].message = alternate;
      keepCell(expected.canonical_view).face = alternate;
      expect(after).toEqual(expected);
      expect(selector).toHaveBeenCalledOnce();
    } finally {
      selector.mockRestore();
    }
    expect(produced()).toEqual(before);
  });
});

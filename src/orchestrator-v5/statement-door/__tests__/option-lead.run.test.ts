/**
 * ⭐ M3c through the REAL Run handler (DL 15 Oct: the HIGH change's Run behaviour must be proven on the Run path, not only at
 * the withhold function). Served hiring negative r4 (turn 9) with each option's own lead recorded through the door; the
 * snapshot is loaded as served; PLoT is faked. L > M → the option's chance at month 3 is withheld and named, its outcome kept,
 * no ranking. CONTRAST: every lead in place → nothing withheld for timing. As served, the effect options' links are Olumi's
 * unsized placeholders, so their chances are ALSO withheld for that separate reason (GOAL_FIGURES_PLACEHOLDER_PATH); only the
 * timing warning, its named options and its words are M3c's, and only the Run's M3c call produces them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyStatementRecordEdit } from '../../goal-target/cohort-forecast-write.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { readStatement } from '../read.js';
import { doorRowFor } from '../role-table.js';

type Rec = Record<string, any>;
const HIRING = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/hiring-negative-r4-turn09.json', import.meta.url), 'utf8')).graph as Rec;
const SID = 'e7f95dc6-0000-4000-8000-000000003c01';

function record(g: Rec, id: string, label: string, quote: string, words: string): Rec {
  const subject = { kind: 'option' as const, id, field: 'lead' as const };
  const v = readStatement(g, subject, label, [{ quote, reading_words: words }], { now: quote } as never, {});
  if (v.kind !== 'read') throw new Error(`${id}: ${JSON.stringify(v)}`);
  const w = doorRowFor(subject, g)!.writer.approve(v.reading, g) as Rec;
  const r = applyStatementRecordEdit(g, w.payload) as Rec;
  expect(r.kind).toBe('mutated');
  return r.mutatedGraph;
}
const withLeads = (quote: string, devWords: string): Rec => {
  let g = record(HIRING(), 'hire_a_tech_lead', 'Hire a Tech lead', quote, 'lift productivity from month 2');
  g = record(g, 'hire_two_developers', 'Hire two developers', quote, devWords);
  return record(g, 'hire_one_developer', 'Hire one developer', quote, devWords);
};

/** The REAL Run handler on the stored graph; PLoT returns a goal chance, win share and outcome for every option it is sent. */
async function run(stored: Rec): Promise<{ sent: string[]; enrichment: Rec }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: null }),
    loadGraph: async () => structuredClone(stored),
  } as never);
  let sent: string[] = [];
  const plotRun = vi.fn(async (payload: Rec) => {
    sent = payload.options.map((o: Rec) => String(o.id ?? o.option_id));
    return { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
      option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
        win_probability: 1 / payload.options.length, probability_of_goal: 0.4 + i / 10,
        outcome: { p10: 0, p50: 1 + i, p90: 3, mean: 1 + i, std: 1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
    } as unknown as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run' },
    requestId: 'req-run', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation) as unknown as Rec;
  expect(plotRun).toHaveBeenCalledOnce();
  return { sent, enrichment: (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!.result.enrichment as Rec };
}
const rowOf = (e: Rec, id: string): Rec | undefined => (e.option_comparison as Rec[] | undefined)?.find((r) => r.option_id === id);
const warning = (e: Rec, code: string): Rec | undefined => (e.inference_warnings as Rec[]).find((w) => w.code === code);

describe('M3c on the Run path: an option not fully in place at the goal\'s month is withheld by the Run, visible, unranked', () => {
  it('RED (L > M, served hiring r4): the developers "not until month 4" → the Run names them, keeps their row and outcome, drops their chance and every share', async () => {
    const { sent, enrichment } = await run(withLeads('The tech lead would lift productivity from month 2, but each developer not until month 4.', 'each developer not until month 4'));
    expect(sent).toEqual(expect.arrayContaining(['hire_a_tech_lead', 'hire_two_developers']));
    const w = warning(enrichment, 'GOAL_FIGURES_OPTION_NOT_IN_PLACE');
    expect(w, JSON.stringify(enrichment.inference_warnings)).toBeDefined();
    expect(w!.option_ids).toContain('hire_two_developers');
    expect(w!.option_ids).not.toContain('hire_a_tech_lead');
    expect(w!.say).toContain('‘Hire two developers’ is not fully in place by month three from today on your forecast (not before month four)');
    expect(rowOf(enrichment, 'hire_two_developers')).toBeDefined();
    expect(rowOf(enrichment, 'hire_two_developers')).not.toHaveProperty('probability_of_goal');
    expect(rowOf(enrichment, 'hire_two_developers')!.outcome).toBeDefined();
    // The baseline (no effect, no lead) keeps its chance: the timing rule withholds only the options it names.
    expect(rowOf(enrichment, 'keep_current_team')!.probability_of_goal).toBe(0.4);
    for (const r of enrichment.option_comparison as Rec[]) expect(r).not.toHaveProperty('win_probability');
  });

  it('CONTRAST: every lead in place by month 2 → the Run withholds nothing for timing; the placeholder links still withhold, for their own reason', async () => {
    const { enrichment } = await run(withLeads('The tech lead would lift productivity from month 2, and each developer from month 2.', 'each developer from month 2'));
    expect(warning(enrichment, 'GOAL_FIGURES_OPTION_NOT_IN_PLACE')).toBeUndefined();
    expect(rowOf(enrichment, 'keep_current_team')!.probability_of_goal).toBe(0.4);
    expect(warning(enrichment, 'GOAL_FIGURES_PLACEHOLDER_PATH')?.option_ids).toEqual(['hire_a_tech_lead', 'hire_two_developers']);
  });
});

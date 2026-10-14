/**
 * ⭐ THE STATUS QUO ROW SAYS WHAT "NO CHANGE" MEANS, AND THE ONE STEP (capacity judge row 3, DL GO 14 Oct; AIE_TEXT_PENDING,
 * `recovery/prompt/STATUS-QUO-ROW-DRAFT.txt`).
 *
 * Served capacity-post2996 (CEE 351eeda0): ‘Keep current staffing’ showed "No change, by assumption" and only "Doing nothing:
 * no change to ‘Weekly support capacity’ in this model, by assumption." The judge: neither an actionable step nor a plain
 * statement. The model already held today's 80 tickets per week and the target of at least 100.
 * The corpus is that Run's own envelope and graph (`tests/fixtures/status-quo-row/served-capacity-post2996-20261014.json`,
 * `_source`); each row first asserts what was served.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, type SentGoalThreshold } from '../goal-chance-licence.js';
import { statusQuoRowWords } from '../goal-target-basis.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/status-quo-row/served-capacity-post2996-20261014.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served: { status_quo: Rec; sent_threshold: SentGoalThreshold; cell: Rec } };
const GOAL = 'weekly_support_capacity';
const SQ = 'keep_current_staffing';
const OLD = 'Doing nothing: no change to ‘Weekly support capacity’ in this model, by assumption.';
const NEW = 'Carrying on as now: ‘Weekly support capacity’ stays at 80 tickets per week in this model, which does not meet your '
  + 'target of at least 100 tickets per week, by assumption. If it would change anyway, without any of these options, tell me '
  + 'what would change it and by how much, and Olumi can add that to the model.';

/** The envelope as the Run's licence reads it: the served licence removed (it is this code's output). */
const runEnvelope = (): Rec => ({ ...FX.envelope,
  inference_warnings: (FX.envelope.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED') });
const licence = (graph: Rec = FX.graph) => goalChanceLicenceOf(runEnvelope(), graph, GOAL, () => false, FX.served.sent_threshold, graph, {});

describe('the status quo row: today\'s level against the target, and the one step (served capacity, run 2026-10-14)', () => {
  it('precondition: served, the row said only the convention; the model held 80 today and a target of at least 100', () => {
    expect(FX.served.status_quo).toEqual({ option_id: SQ, line: OLD });
    expect(FX.served.cell).toEqual({ kind: 'withheld', face: 'No change, by assumption', why: OLD,
      reasons: [{ code: 'status_quo_by_assumption', message: OLD }] });
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;
    expect(goal.observed_state).toMatchObject({ raw_value: 80, unit: 'tickets per week' });
    expect(goal).toMatchObject({ goal_threshold_raw: 100, goal_direction: '>=', goal_threshold_unit: 'tickets per week' });
    // Carrying on is today's level in every run (the Run's own row, normalised: 0.16 = 80/500, no spread).
    expect((FX.envelope.option_comparison as Rec[]).find((o) => o.option_id === SQ)!.outcome).toMatchObject({ p50: 0.16, mean: 0.16 });
  });

  it('the Run\'s licence says what no change means here and the step; the cell carries it; never a chance or a recommendation', () => {
    const l = licence();
    expect(l!.status_quo).toEqual({ option_id: SQ, line: NEW });
    const env = { ...runEnvelope(), inference_warnings: [...(runEnvelope().inference_warnings as Rec[]), l] };
    const cell = projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, FX.graph)
      .find((c) => c.option_id === SQ)!.cell;
    expect(cell).toEqual({ kind: 'withheld', face: 'No change, by assumption', why: NEW,
      reasons: [{ code: 'status_quo_by_assumption', message: NEW }] });
    expect(NEW).not.toMatch(/chance|%|recommend|best|should/i);
  });

  it('CONTRAST: a level held in another unit than the target\'s keeps the convention\'s words (never two units in one line)', () => {
    const graph = { ...FX.graph, nodes: (FX.graph.nodes as Rec[]).map((n) => n.id === GOAL
      ? { ...n, observed_state: { ...n.observed_state, unit: 'tickets per day' } } : n) };
    expect(licence(graph)!.status_quo).toEqual({ option_id: SQ, line: OLD });
  });

  it('the words follow the held comparator: meets / does not meet, for every bound', () => {
    const say = (today: number, comparator: string) => statusQuoRowWords('Cost', { today, comparator, target: 100, unit: '£' });
    expect(say(100, '>=')).toContain('which meets your target of at least £100');
    expect(say(100, '>')).toContain('which does not meet your target of above £100');
    expect(say(90, '<=')).toContain('stays at £90 in this model, which meets your target of at most £100');
    expect(say(100, '<')).toContain('which does not meet your target of below £100');
    expect(statusQuoRowWords('Cost')).toBe('Doing nothing: no change to ‘Cost’ in this model, by assumption.');
    expect(statusQuoRowWords('Cost', { today: 1, comparator: '==', target: 1, unit: '£' })).toBe('Doing nothing: no change to ‘Cost’ in this model, by assumption.');
  });
});

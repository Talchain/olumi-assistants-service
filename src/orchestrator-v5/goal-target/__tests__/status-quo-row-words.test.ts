/**
 * ⭐ THE STATUS QUO ROW SAYS WHAT ITS UNCHANGED REFERENCE IS, AND THE ONE STEP (capacity judge row 3, DL GO 14 Oct). The words
 * are the AIE's, byte for byte (#94 6160089127; `recovery/codex/AIE-STATUS-QUO-REFERENCE-AND-NEXT-STEP-RULING-20261014.json`):
 * a LEVEL line naming the held reference value and the target as recorded values, and a generic line. Neither compares them
 * as a future event ("stays at", "meets") and neither promises Olumi will add anything.
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
const NEW = 'Carrying on as now: this Run uses ‘Weekly support capacity’ as its unchanged reference. The model\'s held reference '
  + 'value is 80 tickets per week; the target for this Run is at least 100 tickets per week. This option\'s own chance of '
  + 'meeting that target is not shown. You can review what could make ‘Weekly support capacity’ change if you carried on as now.';
/** The AIE's generic line, for the same recorded assumed-reference row where the LEVEL figures do not hold. */
const generic = (goal: string): string => `Carrying on as now: this Run uses ‘${goal}’ as its unchanged reference, by assumption. `
  + `Its own chance of meeting the recorded target is not shown. You can review what could make ‘${goal}’ change if you carried on as now.`;
const GENERIC = generic('Weekly support capacity');
/** AIE: no future-event comparison, no promise, no chance figure, no recommendation. */
const NEVER = /stays at|\bmeets\b|does not meet|short of|Olumi can add|%|recommend|best|should/i;

/** The envelope as the Run's licence reads it: the served licence removed (it is this code's output). */
const runEnvelope = (): Rec => ({ ...FX.envelope,
  inference_warnings: (FX.envelope.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED') });
const licence = (graph: Rec = FX.graph) => goalChanceLicenceOf(runEnvelope(), graph, GOAL, () => false, FX.served.sent_threshold, graph, {});

describe('the status quo row: the held reference value and the target as recorded, and the one step (served capacity, run 2026-10-14)', () => {
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

  it('the Run\'s licence names the held reference value and the target, and the step; the cell carries it', () => {
    const l = licence();
    expect(l!.status_quo).toEqual({ option_id: SQ, line: NEW });
    const env = { ...runEnvelope(), inference_warnings: [...(runEnvelope().inference_warnings as Rec[]), l] };
    const cell = projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, FX.graph)
      .find((c) => c.option_id === SQ)!.cell;
    expect(cell).toEqual({ kind: 'withheld', face: 'No change, by assumption', why: NEW,
      reasons: [{ code: 'status_quo_by_assumption', message: NEW }] });
    expect(NEW).not.toMatch(NEVER);
  });

  it('CONTRAST (AMENDED: was the convention\'s words, now the AIE\'s generic line): a level held in another unit, or with no unit', () => {
    const withLevelUnit = (unit: unknown): Rec => ({ ...FX.graph, nodes: (FX.graph.nodes as Rec[]).map((n) => n.id === GOAL
      ? { ...n, observed_state: { ...n.observed_state, unit } } : n) });
    expect(licence(withLevelUnit('tickets per day'))!.status_quo).toEqual({ option_id: SQ, line: GENERIC });
    // AIE: the SAME unit must be held, not assumed.
    expect(licence(withLevelUnit(undefined))!.status_quo).toEqual({ option_id: SQ, line: GENERIC });
    expect(GENERIC).not.toMatch(NEVER);
  });

  it('the LEVEL line says the held comparator as recorded, never "meets"; anything unreadable gets the generic line', () => {
    const say = (today: number, comparator: string) => statusQuoRowWords('Cost', { today, comparator, target: 100, unit: '£' });
    expect(say(100, '>=')).toContain('The model\'s held reference value is £100; the target for this Run is at least £100.');
    expect(say(100, '>')).toContain('the target for this Run is above £100.');
    expect(say(90, '<=')).toContain('The model\'s held reference value is £90; the target for this Run is at most £100.');
    expect(say(100, '<')).toContain('the target for this Run is below £100.');
    for (const c of ['>=', '>', '<=', '<']) expect(say(100, c)).not.toMatch(NEVER);
    expect(statusQuoRowWords('Cost')).toBe(generic('Cost'));
    expect(statusQuoRowWords('Cost', { today: 1, comparator: '==', target: 1, unit: '£' })).toBe(generic('Cost'));
    expect(statusQuoRowWords('Cost', { today: NaN, comparator: '>=', target: 1, unit: '£' })).toBe(generic('Cost'));
    expect(statusQuoRowWords('Cost', { today: 1, comparator: '>=', target: 1, unit: ' ' })).toBe(generic('Cost'));
  });
});
